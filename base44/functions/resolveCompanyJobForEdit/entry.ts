/**
 * resolveCompanyJobForEdit — Authorized load of a company Job for editing.
 *
 * Replaces direct frontend Job.get + JobSection.filter calls from CreateJob.jsx
 * (the ?edit=<jobId> flow). Returns the Job record and its JobSections so the
 * CreateJob page can populate its form and show section statuses.
 *
 * Authorization (server-side):
 *   - Authenticated user with an ACTIVE CompanyMembership for the job's company.
 *   - Role MUST be general_manager or project_manager.
 *   - The Job must NOT be a provisioned Essential SOP (sourceType ===
 *     'essential_sop'). Legacy Jobs with unset sourceType are treated as
 *     company-owned and are editable.
 *
 * Returns: { job, sections }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { getActiveMembership, isCompanyAdminRole } from '../../shared/companyAuth.ts';

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
    const job = await SR.entities.Job.get(jobId).catch(() => null);
    if (!job) return Response.json({ error: 'Job not found' }, { status: 404 });

    // ── Authorization: active membership + GM/PM role ───────────────────────
    const membership = await getActiveMembership(base44, user.id, job.companyId);
    if (!membership) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!isCompanyAdminRole(membership.role)) {
      return Response.json({ error: 'Insufficient role to edit company jobs' }, { status: 403 });
    }

    // ── Essential SOP guard ──────────────────────────────────────────────────
    if (job.sourceType === 'essential_sop') {
      return Response.json({ error: 'Essential SOP jobs cannot be edited here' }, { status: 403 });
    }

    const sections = await SR.entities.JobSection.filter({ jobId }, 'sortOrder', 10);
    return Response.json({ job, sections: sections || [] });

  } catch (error: any) {
    return Response.json({ error: 'An unexpected error occurred.' }, { status: 500 });
  }
}