import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyResourceJobAccess } from '../../shared/companyResourceAuth.ts';

/**
 * resolveCompanyPdfs — Authorized read of Reference PDF attachments for a Job.
 *
 * Returns the PDF metadata list for any active company member with SOP
 * visibility. The canManage flag tells the frontend whether the caller
 * (GM/PM) may mutate attachments — manageCompanyPdf re-verifies on write.
 *
 * Only metadata (id, title, fileName, fileSize, displayOrder) is returned here.
 * The private fileUri is NEVER sent to the client. A short-lived signed URL is
 * generated on demand by resolveCompanyPdfFile when a user opens a PDF.
 *
 * Request payload: { jobId: string }
 * Response: { pdfs: [...], canManage: boolean }
 */
export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { jobId } = body;
    if (!jobId || typeof jobId !== 'string') {
      return Response.json({ error: 'jobId is required' }, { status: 400 });
    }

    const SR = base44.asServiceRole;
    const access = await verifyResourceJobAccess(base44, SR, user, jobId, false);
    if (access.error) return access.error;

    const pdfs = await SR.entities.CompanyPdfAttachment.filter(
      { companyId: access.job.companyId, jobId }, 'displayOrder', 200
    );

    return Response.json({
      pdfs: (pdfs || []).map((p: any) => ({
        id: p.id,
        title: p.title,
        fileName: p.fileName,
        fileSize: p.fileSize,
        displayOrder: p.displayOrder,
        created_date: p.created_date,
        updated_date: p.updated_date,
      })),
      canManage: access.isCompanyAdmin,
    });
  } catch (error: any) {
    return Response.json({ error: 'An unexpected error occurred.' }, { status: 500 });
  }
}