import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyResourceJobAccess } from '../../shared/companyResourceAuth.ts';

/**
 * resolveCompanyPdfFile — Generate a short-lived signed URL for one PDF.
 *
 * The URL is created fresh on each request (5-minute expiry) — no permanent
 * public URL is ever exposed. The private fileUri never leaves the server.
 *
 * Authorization (server-side, on EVERY call):
 *   - Authenticated user with an ACTIVE CompanyMembership for the job's
 *     company (any role may view).
 *   - The parent Job passes the same visibility checks as resolveJob and
 *     resolveCompanyResources: not archived, and for essential_sop jobs must
 *     be Published (adopted-SOP ownership rule — platform Master status and
 *     ProvisioningRecord assignment are not required for existing adopted SOPs).
 *   - The requested PDF must belong to the specified jobId + company
 *     (parent-child verification), so a guessed PDF ID from another company
 *     job is rejected.
 *
 * Request payload: { jobId: string, pdfId: string }
 * Response: { signed_url: string, fileName: string }
 */
export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { jobId, pdfId } = body;
    if (!jobId || typeof jobId !== 'string') {
      return Response.json({ error: 'jobId is required' }, { status: 400 });
    }
    if (!pdfId || typeof pdfId !== 'string') {
      return Response.json({ error: 'pdfId is required' }, { status: 400 });
    }

    const SR = base44.asServiceRole;
    const access = await verifyResourceJobAccess(base44, SR, user, jobId, false);
    if (access.error) return access.error;

    const { job } = access;

    const pdf = await SR.entities.CompanyPdfAttachment.get(pdfId).catch(() => null);
    if (!pdf || pdf.jobId !== jobId || pdf.companyId !== job.companyId) {
      return Response.json({ error: 'PDF not found for this procedure.' }, { status: 404 });
    }

    let signedUrl: string | null = null;
    try {
      const signedRes = await base44.integrations.Core.CreateFileSignedUrl({
        file_uri: pdf.fileUri,
        expires_in: 300, // 5 minutes — enough to open and view
      });
      signedUrl = signedRes?.signed_url || null;
    } catch (_) {
      return Response.json({
        error: 'Could not generate a link to this PDF. Please try again.',
      }, { status: 500 });
    }

    if (!signedUrl) {
      return Response.json({ error: 'This PDF is no longer available.' }, { status: 404 });
    }

    return Response.json({
      signed_url: signedUrl,
      fileName: pdf.fileName || pdf.title || 'reference.pdf',
    });
  } catch (error: any) {
    return Response.json({ error: 'An unexpected error occurred.' }, { status: 500 });
  }
}