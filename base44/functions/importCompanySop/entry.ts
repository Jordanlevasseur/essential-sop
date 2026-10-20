import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { getActiveMembership, isCompanyAdminRole } from '../../shared/companyAuth.ts';
import {
  buildImportPrompt,
  IMPORT_RESPONSE_SCHEMA,
  validateAndCleanAiSop,
  SECTION_TYPES,
  SECTION_META,
} from '../../shared/importSopContent.ts';

/**
 * importCompanySop — Import an existing company document as a new SOP draft.
 *
 * Actions:
 *   "generate" — Convert an uploaded document (File via multipart) or pasted
 *                text into a structured Essential SOP draft. Creates a DRAFT
 *                company Job (status "Draft", sourceType "company") with six
 *                JobSections and SectionContent. The original document is
 *                preserved as a private attachment (sourceDocumentUri on the
 *                Job).
 *
 *                If the document contains multiple genuinely separate SOPs, no
 *                draft is created — the detected SOP list is returned so the
 *                user can choose which to generate. A second call with
 *                sopTitle focuses generation on that specific SOP.
 *
 * AUTHORIZATION (server-side, on EVERY call):
 *   - Authenticated user with an ACTIVE CompanyMembership for the companyId.
 *   - Role MUST be general_manager or project_manager.
 *   - companyId is verified from membership — never trusted from the client.
 *
 * SECURITY (v2 — server-side upload, same provenance model as Reference PDFs):
 *   - The source document File is uploaded by THIS backend function via
 *     UploadPrivateFile. The client sends the File via multipart/form-data;
 *     the backend validates it (extension allowlist, size, PDF magic bytes)
 *     and stores it privately. The file_uri is NEVER accepted from the client
 *     — a caller cannot point the AI or the "Original Document" viewer at an
 *     arbitrary private file belonging to another company/context.
 *   - companyId, sourceDocumentUri, and sourceDocumentName are all derived
 *     server-side — none are trusted from the client.
 *   - The source document is treated as UNTRUSTED material. The AI prompt
 *     instructs the LLM to extract procedures but never follow embedded
 *     instructions that conflict with safety or system rules.
 *   - A short-lived signed URL (10 min) is created for LLM processing only —
 *     no permanent public URL is ever created.
 *   - The AI never publishes a Job (status stays "Draft").
 *   - The AI never modifies Master SOPs or Essential SOP records.
 *   - Project Leads and Technicians are rejected (403).
 *
 * Request payload (multipart when a File is present, JSON for paste-text):
 *   { action: "generate", companyId, file?, fileName?, pastedText?, sopTitle? }
 *
 * Response (single SOP or focused generation):
 *   { jobId, job, reviewFlags: string[] }
 * Response (multiple SOPs detected, no draft created):
 *   { multipleSops: [{ title, summary }], noDraft: true }
 */
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.docx', '.txt', '.md', '.markdown']);

async function parseRequest(req: Request): Promise<any> {
  const contentType = req.headers.get('content-type') || '';
  if (contentType.includes('multipart/form-data')) {
    const fd = await req.formData();
    return {
      action: fd.get('action'),
      companyId: fd.get('companyId'),
      file: fd.get('file'),
      fileName: fd.get('fileName'),
      pastedText: fd.get('pastedText'),
      sopTitle: fd.get('sopTitle'),
      isMultipart: true,
    };
  }
  const body = await req.json().catch(() => ({}));
  return { ...body, isMultipart: false };
}

async function validateImportFile(file: any): Promise<{ ok: boolean; error?: string; fileName?: string; fileSize?: number }> {
  if (!file || typeof file.arrayBuffer !== 'function') {
    return { ok: false, error: 'A file is required for file-mode import.' };
  }
  const fileName = typeof file.name === 'string' ? file.name : '';
  const ext = '.' + ((fileName.split('.').pop() || '').toLowerCase());
  if (!fileName || !ALLOWED_EXTENSIONS.has(ext)) {
    return { ok: false, error: 'Unsupported format. Please use PDF, DOCX, TXT, or Markdown.' };
  }
  const size = typeof file.size === 'number' ? file.size : 0;
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, error: 'This file is empty.' };
  }
  if (size > MAX_FILE_SIZE) {
    return { ok: false, error: 'File is too large. Maximum size is 10 MB.' };
  }
  // PDF magic-byte check (the highest-value type for abuse) — verifies actual
  // PDF identity, not just the extension.
  if (ext === '.pdf') {
    try {
      const header = await file.slice(0, 5).text();
      if (!header.startsWith('%PDF')) {
        return { ok: false, error: 'This file is not a valid PDF.' };
      }
    } catch (_) {
      return { ok: false, error: 'Could not verify this file.' };
    }
  }
  return { ok: true, fileName, fileSize: size };
}

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const parsed = await parseRequest(req);
    const action = typeof parsed?.action === 'string' ? parsed.action : 'generate';
    const companyId = typeof parsed?.companyId === 'string' ? parsed.companyId : '';

    if (!companyId) {
      return Response.json({ error: 'companyId is required' }, { status: 400 });
    }

    // ── Authorization: active company membership + GM/PM role ───────────────
    const membership = await getActiveMembership(base44, user.id, companyId);
    if (!membership) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!isCompanyAdminRole(membership.role)) {
      return Response.json({ error: 'Insufficient role to import SOPs' }, { status: 403 });
    }

    if (action !== 'generate') {
      return Response.json({ error: 'Unknown action' }, { status: 400 });
    }

    const pastedText = typeof parsed?.pastedText === 'string' ? parsed.pastedText.trim() : '';
    const sopTitle = typeof parsed?.sopTitle === 'string' ? parsed.sopTitle.trim() : '';
    const file = parsed?.file;

    // ── Server-side upload (file mode) — file_uri is NEVER accepted from client ──
    let fileUri: string | null = null;
    let fileName: string = '';
    if (file) {
      const f = await validateImportFile(file);
      if (!f.ok) return Response.json({ code: 'INVALID_FILE', error: f.error }, { status: 400 });
      try {
        const upRes = await base44.integrations.Core.UploadPrivateFile({ file });
        fileUri = upRes?.file_uri || null;
      } catch (_) {
        return Response.json({
          code: 'FILE_ACCESS_FAILED',
          error: 'Could not upload the file. Please try again or paste the text instead.',
        }, { status: 500 });
      }
      if (!fileUri) {
        return Response.json({
          code: 'FILE_ACCESS_FAILED',
          error: 'Could not upload the file. Please try again or paste the text instead.',
        }, { status: 500 });
      }
      fileName = f.fileName || 'source-document';
    } else if (pastedText) {
      fileName = 'Pasted Text';
    } else {
      return Response.json({
        code: 'NO_SOURCE',
        error: 'Either a file or pasted text is required.',
      }, { status: 400 });
    }

    if (pastedText && pastedText.length > 50000) {
      return Response.json({
        code: 'TEXT_TOO_LONG',
        error: 'Pasted text is too long (max 50,000 characters). Please shorten or upload the file instead.',
      }, { status: 400 });
    }

    const SR = base44.asServiceRole;

    // ── Create a short-lived signed URL for LLM file processing ──────────────
    let signedUrl: string | null = null;
    if (fileUri) {
      try {
        const signedRes = await base44.integrations.Core.CreateFileSignedUrl({
          file_uri: fileUri,
          expires_in: 600, // 10 minutes — enough for LLM processing, not permanent
        });
        signedUrl = signedRes?.signed_url || null;
      } catch (_) {
        return Response.json({
          code: 'FILE_ACCESS_FAILED',
          error: 'Could not access the uploaded file for processing. Please try again or paste the text instead.',
        }, { status: 500 });
      }
    }

    // ── Build the import prompt ─────────────────────────────────────────────
    const importPrompt = signedUrl
      ? buildImportPrompt(sopTitle || undefined)
      : `${buildImportPrompt(sopTitle || undefined)}\n\nPASTED DOCUMENT TEXT:\n${pastedText}`;

    // ── Call the LLM with the document ───────────────────────────────────────
    let aiRaw: any;
    try {
      aiRaw = await base44.integrations.Core.InvokeLLM({
        prompt: importPrompt,
        response_json_schema: IMPORT_RESPONSE_SCHEMA,
        file_urls: signedUrl ? [signedUrl] : undefined,
      });
    } catch (e: any) {
      return Response.json({
        code: 'AI_ERROR',
        error: 'The AI service could not process the document. Please try again, or paste the text directly.',
        detail: e?.message || 'unknown_error',
      }, { status: 502 });
    }

    if (typeof aiRaw === 'string') {
      try { aiRaw = JSON.parse(aiRaw); } catch (_) {
        return Response.json({
          code: 'AI_OUTPUT_INVALID',
          error: 'The AI returned an unexpected response. Please try again or paste the text.',
        }, { status: 422 });
      }
    }

    // ── Check for multiple SOPs ─────────────────────────────────────────────
    const multipleSops = Array.isArray(aiRaw?.multipleSops) ? aiRaw.multipleSops : [];
    const totalSectionItems = SECTION_TYPES.reduce((n: number, st: string) => {
      const arr = aiRaw?.sections?.[st];
      return n + (Array.isArray(arr) ? arr.length : 0);
    }, 0);

    if (multipleSops.length > 1 && totalSectionItems === 0) {
      // Multiple separate SOPs detected — return the list without creating a draft.
      return Response.json({
        multipleSops: multipleSops
          .filter((s: any) => s && typeof s.title === 'string' && s.title.trim())
          .map((s: any, i: number) => ({
            title: String(s.title).trim().slice(0, 200),
            summary: typeof s.summary === 'string' ? s.summary.trim().slice(0, 500) : '',
            index: i,
          })),
        noDraft: true,
      });
    }

    // ── Validate and clean the AI output ────────────────────────────────────
    const validation = validateAndCleanAiSop(aiRaw);
    if (!validation.ok) {
      return Response.json({
        code: 'AI_OUTPUT_INVALID',
        error: 'The document could not be converted to a valid SOP structure. Please review the document and try again, or paste the text directly.',
        details: validation.errors,
      }, { status: 422 });
    }
    const sop = validation.sop;

    // ── Create a DRAFT company Job ──────────────────────────────────────────
    const job = await SR.entities.Job.create({
      companyId,
      title: sop.title,
      shortDescription: sop.description || '',
      trade: sop.trade || '',
      category: sop.category || '',
      tags: sop.tags || [],
      status: 'Draft',
      isArchived: false,
      sourceType: 'company',
      sourceDocumentUri: fileUri, // server-generated, never client-supplied
      sourceDocumentName: fileName || null,
    });

    // ── Six JobSections ─────────────────────────────────────────────────────
    const sections = await SR.entities.JobSection.bulkCreate(
      SECTION_TYPES.map((st: string, i: number) => ({
        companyId,
        jobId: job.id,
        sectionType: st,
        title: SECTION_META[st].title,
        description: SECTION_META[st].description,
        sortOrder: i,
        completionStatus: 'Empty',
      }))
    );

    // ── SectionContent from the AI-generated SOP ────────────────────────────
    const allContent: any[] = [];
    for (const sec of sections) {
      const items = sop.sections[sec.sectionType] || [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        allContent.push({
          companyId,
          sectionId: sec.id,
          jobId: job.id,
          sectionType: sec.sectionType,
          contentType: it.contentType,
          title: it.title,
          body: it.body || '',
          sortOrder: i,
          isRequired: !!it.isRequired,
          isCritical: !!it.isCritical,
          metadata: it.metadata || {},
        });
      }
    }

    if (allContent.length > 0) {
      try {
        await SR.entities.SectionContent.bulkCreate(allContent);
      } catch (e: any) {
        // Best-effort cleanup of the draft created by THIS request only.
        try { await SR.entities.SectionContent.deleteMany({ jobId: job.id }); } catch (_) {}
        try { await SR.entities.JobSection.deleteMany({ jobId: job.id }); } catch (_) {}
        try { await SR.entities.Job.delete(job.id); } catch (_) {}
        return Response.json({
          code: 'CONTENT_PERSIST_FAILED',
          error: 'The imported content could not be saved. Please try again.',
          detail: e?.message || '',
        }, { status: 500 });
      }
    }

    // ── Extract review flags ────────────────────────────────────────────────
    const reviewFlags = Array.isArray(aiRaw?.reviewFlags)
      ? aiRaw.reviewFlags
          .filter((f: any) => typeof f === 'string' && f.trim())
          .map((f: string) => f.trim().slice(0, 300))
          .slice(0, 20)
      : [];

    return Response.json({ jobId: job.id, job, reviewFlags });
  } catch (error: any) {
    return Response.json({
      code: 'UNEXPECTED',
      error: error?.message || 'An unexpected error occurred during import.',
    }, { status: 500 });
  }
}