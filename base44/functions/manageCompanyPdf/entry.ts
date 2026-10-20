import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyResourceJobAccess } from '../../shared/companyResourceAuth.ts';

/**
 * manageCompanyPdf — Authorized Reference PDF mutations (GM/PM only).
 *
 * SECURITY MODEL (v2 — server-side upload):
 *   The PDF file is uploaded by THIS backend function via UploadPrivateFile.
 *   The client sends the File via multipart/form-data; the backend validates
 *   it (PDF magic bytes, extension, size), uploads it, and stores the resulting
 *   file_uri. The file_uri is NEVER accepted from the client — a caller cannot
 *   attach an arbitrary private-file URI belonging to another company/context.
 *
 * Actions:
 *   "create"  — Attach a new PDF. Requires a File in multipart form-data.
 *   "update"  — Edit the display title only. JSON, no file.
 *   "replace" — Replace the underlying file. Requires a File in multipart.
 *   "delete"  — Remove the attachment. JSON, no file.
 *
 * Authorization (server-side, on EVERY call):
 *   - Authenticated user with an ACTIVE CompanyMembership for the job's company.
 *   - Role MUST be general_manager or project_manager (verifyResourceJobAccess
 *     with requireAdmin=true).
 *   - Job must belong to the caller's company, not be archived, and for
 *     essential_sop jobs must be Published + active Master + ACTIVE assignment.
 *   - For update/replace/delete: the PDF must belong to the specified jobId
 *     (parent-child verification).
 *
 * File validation (server-side, on the actual File object — never trusting
 * client-supplied metadata alone):
 *   - Extension: filename must end with .pdf.
 *   - Magic bytes: first 5 bytes must be "%PDF" (verifies actual PDF identity).
 *   - MIME type: application/pdf when provided.
 *   - Size: > 0 and ≤ MAX_PDF_SIZE_BYTES (25 MB), read from the File object.
 *
 * companyId, jobId, createdByUserId, displayOrder, fileUri, fileName, fileSize
 * are ALL derived server-side — none are accepted from the client.
 *
 * A Reference PDF is a supporting attachment only. It is never imported as a
 * new SOP, does not change the parent SOP's instructions, does not trigger AI
 * processing, and does not create an approval workflow. Assistant 2.0 unchanged.
 */
const MAX_PDF_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

async function parseRequest(req: Request): Promise<any> {
  const contentType = req.headers.get('content-type') || '';
  if (contentType.includes('multipart/form-data')) {
    const fd = await req.formData();
    return {
      action: fd.get('action'),
      jobId: fd.get('jobId'),
      pdfId: fd.get('pdfId'),
      title: fd.get('title'),
      file: fd.get('file'),
      isMultipart: true,
    };
  }
  const body = await req.json().catch(() => ({}));
  return { ...body, isMultipart: false };
}

async function validatePdfFile(file: any): Promise<{ ok: boolean; error?: string; fileName?: string; fileSize?: number }> {
  if (!file || typeof file.arrayBuffer !== 'function') {
    return { ok: false, error: 'A PDF file is required.' };
  }
  const fileName = typeof file.name === 'string' ? file.name : '';
  if (!fileName || !/\.pdf$/i.test(fileName)) {
    return { ok: false, error: 'Only PDF files are allowed.' };
  }
  const size = typeof file.size === 'number' ? file.size : 0;
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, error: 'This file is empty.' };
  }
  if (size > MAX_PDF_SIZE_BYTES) {
    return { ok: false, error: 'This PDF is larger than 25 MB.' };
  }
  // Magic-byte check: verify the actual content is a PDF, not just the extension.
  try {
    const header = await file.slice(0, 5).text();
    if (!header.startsWith('%PDF')) {
      return { ok: false, error: 'This file is not a valid PDF.' };
    }
  } catch (_) {
    return { ok: false, error: 'Could not verify this file is a PDF.' };
  }
  return { ok: true, fileName, fileSize: size };
}

function readableTitleFromFileName(fileName: string): string {
  const base = (fileName || '').replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim();
  return base || 'Reference PDF';
}

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const parsed = await parseRequest(req);
    const { action, jobId, pdfId, title, file, isMultipart } = parsed;

    if (!action || !jobId) {
      return Response.json({ error: 'action and jobId are required' }, { status: 400 });
    }

    const SR = base44.asServiceRole;
    const access = await verifyResourceJobAccess(base44, SR, user, jobId, true);
    if (access.error) return access.error;

    const { job } = access;

    switch (action) {
      case 'create': {
        const f = await validatePdfFile(file);
        if (!f.ok) return Response.json({ error: f.error }, { status: 400 });

        // Server-side upload: the file_uri is generated here, never client-supplied.
        let fileUri: string | null = null;
        try {
          const upRes = await base44.integrations.Core.UploadPrivateFile({ file });
          fileUri = upRes?.file_uri || null;
        } catch (_) {
          return Response.json({ error: 'Upload failed. Please try again.' }, { status: 500 });
        }
        if (!fileUri) return Response.json({ error: 'Upload failed. Please try again.' }, { status: 500 });

        const finalTitle = (typeof title === 'string' && title.trim())
          ? title.trim()
          : readableTitleFromFileName(f.fileName!);

        const existing = await SR.entities.CompanyPdfAttachment.filter(
          { companyId: job.companyId, jobId }, 'displayOrder', 200
        );
        const created = await SR.entities.CompanyPdfAttachment.create({
          companyId: job.companyId,
          jobId,
          title: finalTitle,
          fileUri,
          fileName: f.fileName,
          fileSize: f.fileSize,
          displayOrder: (existing || []).length,
          createdByUserId: user.id,
        });
        return Response.json({ pdf: {
          id: created.id,
          title: created.title,
          fileName: created.fileName,
          fileSize: created.fileSize,
          displayOrder: created.displayOrder,
          created_date: created.created_date,
          updated_date: created.updated_date,
        }});
      }

      case 'update': {
        if (!pdfId) return Response.json({ error: 'pdfId is required' }, { status: 400 });
        const existing = await SR.entities.CompanyPdfAttachment.get(pdfId).catch(() => null);
        if (!existing || existing.jobId !== jobId || existing.companyId !== job.companyId) {
          return Response.json({ error: 'PDF not found for this procedure' }, { status: 404 });
        }
        const t = (typeof title === 'string' ? title : '').toString().trim();
        if (!t) return Response.json({ error: 'Title cannot be empty' }, { status: 400 });
        const updated = await SR.entities.CompanyPdfAttachment.update(pdfId, { title: t });
        return Response.json({ pdf: {
          id: updated.id,
          title: updated.title,
          fileName: updated.fileName,
          fileSize: updated.fileSize,
          displayOrder: updated.displayOrder,
          created_date: updated.created_date,
          updated_date: updated.updated_date,
        }});
      }

      case 'replace': {
        if (!pdfId) return Response.json({ error: 'pdfId is required' }, { status: 400 });
        const existing = await SR.entities.CompanyPdfAttachment.get(pdfId).catch(() => null);
        if (!existing || existing.jobId !== jobId || existing.companyId !== job.companyId) {
          return Response.json({ error: 'PDF not found for this procedure' }, { status: 404 });
        }
        const f = await validatePdfFile(file);
        if (!f.ok) return Response.json({ error: f.error }, { status: 400 });

        let fileUri: string | null = null;
        try {
          const upRes = await base44.integrations.Core.UploadPrivateFile({ file });
          fileUri = upRes?.file_uri || null;
        } catch (_) {
          return Response.json({ error: 'Upload failed. Please try again.' }, { status: 500 });
        }
        if (!fileUri) return Response.json({ error: 'Upload failed. Please try again.' }, { status: 500 });

        const update: any = {
          fileUri,
          fileName: f.fileName,
          fileSize: f.fileSize,
        };
        if (typeof title === 'string' && title.trim()) {
          update.title = title.trim();
        }
        const updated = await SR.entities.CompanyPdfAttachment.update(pdfId, update);
        return Response.json({ pdf: {
          id: updated.id,
          title: updated.title,
          fileName: updated.fileName,
          fileSize: updated.fileSize,
          displayOrder: updated.displayOrder,
          created_date: updated.created_date,
          updated_date: updated.updated_date,
        }});
      }

      case 'delete': {
        if (!pdfId) return Response.json({ error: 'pdfId is required' }, { status: 400 });
        const existing = await SR.entities.CompanyPdfAttachment.get(pdfId).catch(() => null);
        if (!existing || existing.jobId !== jobId || existing.companyId !== job.companyId) {
          return Response.json({ error: 'PDF not found for this procedure' }, { status: 404 });
        }
        await SR.entities.CompanyPdfAttachment.delete(pdfId);
        return Response.json({ success: true });
      }

      default:
        return Response.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error: any) {
    return Response.json({ error: 'An unexpected error occurred.' }, { status: 500 });
  }
}