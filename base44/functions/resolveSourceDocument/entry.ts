import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyResourceJobAccess } from '../../shared/companyResourceAuth.ts';

/**
 * resolveSourceDocument — Authorized retrieval of the original imported
 * source document for a company Job.
 *
 * Returns a time-limited signed URL (5-minute expiry) for the private file
 * stored on the Job's sourceDocumentUri. The URL is created fresh on each
 * request — no permanent public URL is ever exposed.
 *
 * Authorization (server-side, on EVERY call):
 *   - Authenticated user with an ACTIVE CompanyMembership for the job's
 *     company (any role — GM, PM, Project Lead, or Technician — may view).
 *   - The Job must pass the same visibility checks as resolveJob and
 *     resolveCompanyResources: not archived, and for essential_sop jobs must
 *     be Published with an active Master + ACTIVE platform assignment.
 *   - Only jobs with a sourceDocumentUri return a URL; others get 404.
 *
 * Request payload: { jobId: string }
 * Response: { signed_url: string, fileName: string }
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

    const { job } = access;

    if (!job.sourceDocumentUri) {
      return Response.json({ error: 'No source document for this job.' }, { status: 404 });
    }

    let signedUrl: string | null = null;
    try {
      const signedRes = await base44.integrations.Core.CreateFileSignedUrl({
        file_uri: job.sourceDocumentUri,
        expires_in: 300, // 5 minutes — enough to open and view
      });
      signedUrl = signedRes?.signed_url || null;
    } catch (_) {
      return Response.json({
        error: 'Could not generate a link to the source document. Please try again.',
      }, { status: 500 });
    }

    if (!signedUrl) {
      return Response.json({
        error: 'The source document is no longer available.',
      }, { status: 404 });
    }

    return Response.json({
      signed_url: signedUrl,
      fileName: job.sourceDocumentName || 'source-document',
    });
  } catch (error: any) {
    return Response.json({ error: 'An unexpected error occurred.' }, { status: 500 });
  }
}