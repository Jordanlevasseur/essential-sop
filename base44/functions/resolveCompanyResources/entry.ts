import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyResourceJobAccess } from '../../shared/companyResourceAuth.ts';

/**
 * resolveCompanyResources — Authorized read of company resources for a Job.
 *
 * Returns the resource list for any active company member with SOP visibility.
 * The canManage flag in the response tells the frontend whether the caller
 * (GM/PM) may mutate resources — manageCompanyResource re-verifies on write.
 *
 * Resource metadata (title, url, resourceType, description) is exposed here
 * through this authorized path for future Assistant integration. The Assistant
 * will call this same endpoint; the existing askAssistant retrieval is unchanged.
 * A resource URL is NOT an authoritative AI procedural source — linking to an
 * external manual does not mean its contents have been ingested or approved.
 *
 * Request payload: { jobId: string }
 * Response: { resources: [...], canManage: boolean }
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

    const resources = await SR.entities.CompanyResource.filter(
      { companyId: access.job.companyId, jobId }, 'displayOrder', 200
    );

    return Response.json({
      resources: (resources || []).map((r: any) => ({
        id: r.id,
        title: r.title,
        url: r.url,
        resourceType: r.resourceType,
        description: r.description || '',
        displayOrder: r.displayOrder,
        createdByUserId: r.createdByUserId,
        created_date: r.created_date,
        updated_date: r.updated_date,
      })),
      canManage: access.isCompanyAdmin,
    });
  } catch (error: any) {
    return Response.json({ error: 'An unexpected error occurred.' }, { status: 500 });
  }
}