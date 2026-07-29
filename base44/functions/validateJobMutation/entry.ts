import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * validateJobMutation — Backend mutation safety guard.
 *
 * Called before any client-side SectionContent or JobSection write operation.
 * Ensures that platform-provisioned Essential SOP Jobs cannot be mutated
 * through direct company-content write paths, regardless of frontend state.
 *
 * The frontend controls (canEdit) are the first gate; this function is the
 * second, backend-enforced gate that prevents bypass via direct API calls.
 *
 * Request payload: { jobId: string }
 * Response on success: { allowed: true }
 * Response on failure: { allowed: false, reason: string } with 4xx status
 *
 * Mutation is blocked when:
 *   1. The calling user does not have an active company membership for the job's company.
 *   2. The job is a provisioned Essential SOP (sourceType === 'essential_sop' && !isCustomized).
 *
 * This function does NOT modify any data — it is a pure authorization check.
 */

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);

    // ── Authentication ───────────────────────────────────────────────────────
    const user = await base44.auth.me().catch(() => null);
    if (!user) {
      return Response.json({ allowed: false, reason: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { jobId } = body;
    if (!jobId || typeof jobId !== 'string') {
      return Response.json({ allowed: false, reason: 'jobId is required' }, { status: 400 });
    }

    const SR = base44.asServiceRole;

    // ── Load the Job ─────────────────────────────────────────────────────────
    let job: any;
    try {
      job = await SR.entities.Job.get(jobId);
    } catch (_) {
      return Response.json({ allowed: false, reason: 'Job not found' }, { status: 404 });
    }
    if (!job) {
      return Response.json({ allowed: false, reason: 'Job not found' }, { status: 404 });
    }

    // ── Company membership check ─────────────────────────────────────────────
    const memberships = await base44.entities.CompanyMembership.filter({
      userId: user.id,
      companyId: job.companyId,
      status: 'active',
    });
    if (!memberships || memberships.length === 0) {
      return Response.json({ allowed: false, reason: 'Forbidden' }, { status: 403 });
    }

    // ── Role check: only general_manager or project_manager may mutate content ──
    const membership = memberships[0];
    const isCompanyAdmin = membership.role === 'general_manager' || membership.role === 'project_manager';
    if (!isCompanyAdmin) {
      return Response.json({ allowed: false, reason: 'Insufficient role to modify job content' }, { status: 403 });
    }

    // ── Provisioned SOP guard ────────────────────────────────────────────────
    // Essential SOP Jobs that have not been customized are platform-owned content.
    // No company-side mutation is permitted — this is enforced here regardless of
    // what the frontend shows or any client-side capability check.
    if (job.sourceType === 'essential_sop' && !job.isCustomized) {
      return Response.json({
        allowed: false,
        reason: 'Platform-provisioned Essential SOP content may not be modified through company write paths.',
      }, { status: 403 });
    }

    return Response.json({ allowed: true });

  } catch (error: any) {
    return Response.json({ allowed: false, reason: 'An unexpected error occurred.' }, { status: 500 });
  }
}