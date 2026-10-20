import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * removeFromCompanyLibrary — Company REMOVAL of an adopted provisioned Master SOP.
 *
 * Phase 2 (PREPARED, not yet wired to UI). Phase 3/4 will connect the
 * "Remove from Company Library" button to this endpoint.
 *
 * Architecture (no schema change):
 *   COMPANY ADOPTION = a linked Job exists with sourceType='essential_sop',
 *                      status='Published', isArchived=false.
 *   Company-level removal = set that Job's isArchived=true (and status='Draft').
 *
 * This function performs the company-side removal act ONLY. It:
 *   - Requires the caller to be a general_manager/project_manager of the Job's
 *     company (companyId is derived from the Job, never trusted from the client).
 *   - Only applies to provisioned Essential SOP Jobs (sourceType='essential_sop').
 *     Company-created Jobs have their own archive path and are rejected here.
 *   - Archives the Job (isArchived=true, status='Draft'). The Job row, its
 *     JobOverride, and its version-decision history are preserved — nothing is
 *     deleted. The Master SOP, its Version, and the ProvisioningRecord are NOT
 *     touched. Platform provisioning remains intact.
 *   - Idempotent: re-calling when already archived returns alreadyRemoved=true.
 *
 * Effect of archival on existing read paths (no resolver changes in Phase 2):
 *   - resolveJobsForCompany filters !isArchived && status==='Published' → removed
 *     Jobs disappear from the Company Library list.
 *   - resolveAssistantContext uses the same filter → removed Jobs are not cited.
 *   - resolveJob still loads an archived Job by id (deep link); Phase 4 may add a
 *     "removed" presentation. No data is lost.
 *
 * Sync safety (Phase 2 hardening in syncCompanyLibrary): an archived linked Job
 * is treated as intentionally removed — sync will NOT recreate it and will NOT
 * create a version-update decision for it. Re-adoption via addToCompanyLibrary
 * un-archives the same Job (no duplicate).
 *
 * Request:  { jobId: string }
 * Response: { success, removed|alreadyRemoved, jobId }
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);

    const body = await req.json().catch(() => ({}));
    const { jobId } = body;
    if (!jobId || typeof jobId !== 'string' || !jobId.trim()) {
      return Response.json({ error: 'jobId is required', code: 'INVALID_INPUT' }, { status: 400 });
    }

    const SR = base44.asServiceRole;

    // ── Load the Job ──────────────────────────────────────────────────────────
    let job: any;
    try { job = await SR.entities.Job.get(jobId); } catch (_) {}
    if (!job) return Response.json({ error: 'Job not found', code: 'NOT_FOUND' }, { status: 404 });

    // ── Must be a provisioned Essential SOP ───────────────────────────────────
    if (job.sourceType !== 'essential_sop') {
      return Response.json({
        error: 'Only provisioned Essential SOP Jobs can be removed via the company library removal path.',
        code: 'NOT_ESSENTIAL_SOP',
      }, { status: 409 });
    }

    // ── Authorization: GM/PM of the Job's company (companyId derived from Job) ─
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }, { status: 401 });
    const memberships = await base44.entities.CompanyMembership.filter({
      userId: user.id,
      companyId: job.companyId,
      status: 'active',
    });
    if (!memberships || memberships.length === 0) {
      return Response.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }
    const membership = memberships[0];
    const isCompanyAdmin = membership.role === 'general_manager' || membership.role === 'project_manager';
    if (!isCompanyAdmin) {
      return Response.json({ error: 'Insufficient role to remove company library procedures', code: 'INSUFFICIENT_ROLE' }, { status: 403 });
    }

    // ── Idempotent ────────────────────────────────────────────────────────────
    if (job.isArchived) {
      return Response.json({ success: true, alreadyRemoved: true, jobId: job.id });
    }

    // ── Archive only — preserve Job, override, version history, master, assignment ─
    const now = new Date().toISOString();
    await SR.entities.Job.update(job.id, { isArchived: true, status: 'Draft' });

    try {
      await SR.entities.ActivityLog.create({
        companyId: job.companyId,
        actingUserId: user.id,
        actionType: 'job_archived',
        targetType: 'job',
        targetId: job.id,
        summary: `Removed Essential SOP "${job.title}" from company library`,
        metadata: {
          masterId: job.sourceMasterId,
          versionId: job.sourceVersionId,
          removal: true,
          companyInitiated: true,
        },
        timestamp: now,
      });
    } catch (_) { /* non-fatal */ }

    return Response.json({ success: true, removed: true, jobId: job.id });
  } catch (error: any) {
    return Response.json({ error: 'An unexpected error occurred.', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}