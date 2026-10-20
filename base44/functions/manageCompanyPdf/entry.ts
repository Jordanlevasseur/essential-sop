import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyResourceJobAccess } from '../../shared/companyResourceAuth.ts';

/**
 * manageCompanyPdf — Authorized Reference PDF mutations (GM/PM only).
 *
 * Actions:
 *   "create"  — Attach a new PDF. Client uploads via UploadPrivateFile first,
 *               then sends { fileUri, fileName, fileSize, title? }.
 *   "update"  — Edit the display title only.
 *   "replace" — Replace the underlying file (new fileUri/fileName/fileSize).
 *               Title is preserved unless a new one is provided.
 *   "delete"  — Remove the attachment.
 *
 * Authorization (server-side, on EVERY call):
 *   - Authenticated user with an ACTIVE CompanyMembership for the job's company.
 *   - Role MUST be general_manager or project_manager (verifyResourceJobAccess
 *     with requireAdmin=true).
 *   - The Job must belong to the caller's company, not be archived, and for
 *     essential_sop jobs must be Published + active Master + ACTIVE assignment.
 *   - For update/replace/delete: the PDF must belong to the specified jobId
 *     (parent-child verification).
 *
 * companyId, jobId, createdByUserId, displayOrder are derived server-side —
 * never accepted from the client. Only title, fileUri, fileName, fileSize are
 * client-settable, and fileUri/fileName/fileSize are validated.
 *
 * Upload limits:
 *   - File extension MUST be .pdf.
 *   - File size MUST be > 0 and ≤ MAX_PDF_SIZE_BYTES (25 MB).
 *
 * A Reference PDF is a supporting attachment only. Uploading one does NOT
 * import it as a new SOP, change the parent SOP's instructions, trigger AI
 * processing, or create an approval workflow. Assistant 2.0 is unchanged.
 */
const MAX_PDF_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB — documented upload limit

const ALLOWED_PDF_FIELDS = ['title', 'fileUri', 'fileName', 'fileSize'];

function sanitizePdfData(raw: any): any {
  const out: any = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const k of ALLOWED_PDF_FIELDS) {
    if (raw[k] !== undefined) out[k] = raw[k];
  }
  return out;
}

function isValidPdfFile(fileName: any, fileSize: any, fileUri: any): string | null {
  if (typeof fileUri !== 'string' || !fileUri.trim()) return 'Missing file reference.';
  if (typeof fileName !== 'string' || !fileName.trim()) return 'Missing file name.';
  if (!/\.pdf$/i.test(fileName.trim())) return 'Only PDF files are allowed.';
  const size = Number(fileSize);
  if (!Number.isFinite(size) || size <= 0) return 'Invalid file size.';
  if (size > MAX_PDF_SIZE_BYTES) return 'PDF is larger than 25 MB.';
  return null;
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

    const body = await req.json().catch(() => ({}));
    const { action, jobId, pdfId, data } = body;

    if (!action || !jobId) {
      return Response.json({ error: 'action and jobId are required' }, { status: 400 });
    }

    const SR = base44.asServiceRole;
    const access = await verifyResourceJobAccess(base44, SR, user, jobId, true);
    if (access.error) return access.error;

    const { job } = access;

    switch (action) {
      case 'create': {
        const sanitized = sanitizePdfData(data);
        const fileErr = isValidPdfFile(sanitized.fileName, sanitized.fileSize, sanitized.fileUri);
        if (fileErr) return Response.json({ error: fileErr }, { status: 400 });

        const title = (typeof sanitized.title === 'string' && sanitized.title.trim())
          ? sanitized.title.trim()
          : readableTitleFromFileName(sanitized.fileName);

        const existing = await SR.entities.CompanyPdfAttachment.filter(
          { companyId: job.companyId, jobId }, 'displayOrder', 200
        );
        const created = await SR.entities.CompanyPdfAttachment.create({
          companyId: job.companyId,
          jobId,
          title,
          fileUri: sanitized.fileUri,
          fileName: sanitized.fileName.trim(),
          fileSize: Number(sanitized.fileSize),
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
        const sanitized = sanitizePdfData(data);
        const update: any = {};
        if (sanitized.title !== undefined) {
          const t = sanitized.title.toString().trim();
          if (!t) return Response.json({ error: 'Title cannot be empty' }, { status: 400 });
          update.title = t;
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

      case 'replace': {
        if (!pdfId) return Response.json({ error: 'pdfId is required' }, { status: 400 });
        const existing = await SR.entities.CompanyPdfAttachment.get(pdfId).catch(() => null);
        if (!existing || existing.jobId !== jobId || existing.companyId !== job.companyId) {
          return Response.json({ error: 'PDF not found for this procedure' }, { status: 404 });
        }
        const sanitized = sanitizePdfData(data);
        const fileErr = isValidPdfFile(sanitized.fileName, sanitized.fileSize, sanitized.fileUri);
        if (fileErr) return Response.json({ error: fileErr }, { status: 400 });

        const update: any = {
          fileUri: sanitized.fileUri,
          fileName: sanitized.fileName.trim(),
          fileSize: Number(sanitized.fileSize),
        };
        if (typeof sanitized.title === 'string' && sanitized.title.trim()) {
          update.title = sanitized.title.trim();
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