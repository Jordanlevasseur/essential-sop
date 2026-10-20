/**
 * resolveJobAdoptionHistory — Authorized read of version-adoption audit events
 * for a single Company Job.
 *
 * Replaces the direct frontend ActivityLog.filter call in VersionHistory.jsx.
 *
 * Authorization:
 *   - Authenticated user with an ACTIVE CompanyMembership for the job's company.
 *   - Any active role (general_manager, project_manager, project_lead, technician)
 *     may view adoption history — it is informational, shown inside JobDetail.
 *
 * Returns only adoption-event logs (actionType='job_edited' with adoption
 * metadata events). Does NOT expose the full company activity log.
 *
 * Response: { records: ActivityLog[] }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

const ADOPTION_EVENTS = new Set([
  'COMPANY_MASTER_VERSION_ADOPTED_FROM_ANALYSIS',
  'COMPANY_MASTER_VERSION_ADOPTED',
]);

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

    // ── Load the job (service role — Job is RLS-locked) ──────────────────────
    let job: any;
    try { job = await SR.entities.Job.get(jobId); } catch (_) {}
    if (!job) return Response.json({ error: 'Job not found' }, { status: 404 });

    // ── Company membership check ─────────────────────────────────────────────
    const memberships = await base44.entities.CompanyMembership.filter({
      userId: user.id, companyId: job.companyId, status: 'active',
    }).catch(() => []);
    if (!memberships || memberships.length === 0) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // ── Read adoption-event logs for this job ────────────────────────────────
    const logs = await SR.entities.ActivityLog.filter(
      { companyId: job.companyId, targetId: jobId, actionType: 'job_edited' },
      '-timestamp', 50
    ).catch(() => []);

    const records = (logs || []).filter((l: any) =>
      l.metadata && ADOPTION_EVENTS.has(l.metadata.event)
    );

    return Response.json({ records });

  } catch (error: any) {
    return Response.json({ error: 'An unexpected error occurred.' }, { status: 500 });
  }
}