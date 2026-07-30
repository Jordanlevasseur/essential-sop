import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * manageVersionDeferral — Persist or clear a company admin's version deferral.
 *
 * Actions:
 *   DEFER   — Creates a NOT_NOW record with expiresAt = now + 7 days.
 *   DISMISS — Creates a DISMISSED record (no expiry). Suppresses this exact version permanently.
 *   CLEAR   — Clears all active deferrals for a given jobId + deferredVersionId (called after successful adoption).
 *
 * Authorization:
 *   Caller must have an active CompanyMembership with role general_manager or project_manager.
 *   Technicians and project_leads are rejected.
 *   Company scope is always derived from the Job record — never trusted from the request body.
 *
 * Idempotency:
 *   DEFER/DISMISS: uses deterministicKey to prevent duplicate active records.
 *   CLEAR: marks all matching records cleared; safe to call multiple times.
 *
 * Request body:
 *   { action: 'DEFER' | 'DISMISS' | 'CLEAR', jobId: string, deferredVersionId: string }
 *
 * Response:
 *   { success: true, created?: boolean, cleared?: number, deferralId?: string }
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const SR = base44.asServiceRole;

    // Auth
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { action, jobId, deferredVersionId } = body;

    // Validate inputs
    if (!action || !jobId || typeof jobId !== 'string') {
      return Response.json({ error: 'action and jobId are required', code: 'INVALID_INPUT' }, { status: 400 });
    }
    if (!['DEFER', 'DISMISS', 'CLEAR'].includes(action)) {
      return Response.json({ error: 'action must be DEFER, DISMISS, or CLEAR', code: 'INVALID_ACTION' }, { status: 400 });
    }
    if ((action === 'DEFER' || action === 'DISMISS') && !deferredVersionId) {
      return Response.json({ error: 'deferredVersionId is required for DEFER and DISMISS', code: 'INVALID_INPUT' }, { status: 400 });
    }

    // Load job — company scope derived server-side
    let job: any;
    try { job = await SR.entities.Job.get(jobId); } catch (_) {}
    if (!job) return Response.json({ error: 'Job not found', code: 'NOT_FOUND' }, { status: 404 });

    // Authorization: verify active membership with adoption-capable role
    const memberships = await base44.entities.CompanyMembership.filter({
      userId: user.id, companyId: job.companyId, status: 'active',
    });
    if (!memberships || memberships.length === 0) {
      return Response.json({ error: 'No active membership in this company', code: 'FORBIDDEN' }, { status: 403 });
    }
    const membership = memberships[0];
    const canDefer = membership.role === 'general_manager' || membership.role === 'project_manager';
    if (!canDefer) {
      return Response.json({ error: 'Insufficient role. Only company admins may defer version updates.', code: 'INSUFFICIENT_ROLE' }, { status: 403 });
    }

    const now = new Date().toISOString();

    // ── CLEAR action ────────────────────────────────────────────────────────────
    if (action === 'CLEAR') {
      // Find all non-cleared deferrals for this job (optionally scoped to a specific version)
      const query: any = { companyId: job.companyId, jobId };
      if (deferredVersionId) query.deferredVersionId = deferredVersionId;

      const existing = await SR.entities.CompanyVersionDeferral.filter(query).catch(() => []);
      const active = (existing || []).filter((d: any) => !d.clearedAt);

      let cleared = 0;
      for (const d of active) {
        await SR.entities.CompanyVersionDeferral.update(d.id, {
          clearedAt: now,
          clearedReason: 'ADOPTION_COMPLETED',
          updatedAt: now,
        }).catch(() => {});
        cleared++;
      }

      // Audit
      await SR.entities.PlatformAuditLog.create({
        actingUserId: user.id,
        actingUserRole: 'company_admin',
        action: 'version_decision_superseded',
        masterId: job.sourceMasterId,
        metadata: {
          event: 'deferral_cleared',
          jobId,
          companyId: job.companyId,
          deferredVersionId: deferredVersionId || null,
          clearedCount: cleared,
          clearedReason: 'ADOPTION_COMPLETED',
        },
        timestamp: now,
      }).catch(() => {});

      return Response.json({ success: true, cleared });
    }

    // ── DEFER / DISMISS actions ─────────────────────────────────────────────────

    // Verify the version exists and belongs to this master
    let version: any;
    try { version = await SR.entities.EssentialSOPVersion.get(deferredVersionId); } catch (_) {}
    if (!version || version.masterId !== job.sourceMasterId) {
      return Response.json({ error: 'Version not found or does not match this job', code: 'VERSION_NOT_FOUND' }, { status: 404 });
    }

    const deferralAction = action === 'DEFER' ? 'NOT_NOW' : 'DISMISSED';
    const deterministicKey = `deferral_${job.companyId}_${jobId}_${deferredVersionId}_${deferralAction}`;

    // Idempotency: check for existing active record with the same key
    const existing = await SR.entities.CompanyVersionDeferral.filter({
      companyId: job.companyId,
      jobId,
      deferredVersionId,
    }).catch(() => []);

    const activeMatch = (existing || []).find(
      (d: any) => d.action === deferralAction && !d.clearedAt
    );
    if (activeMatch) {
      // Already exists — return as idempotent success
      return Response.json({ success: true, created: false, deferralId: activeMatch.id });
    }

    // Compute expiry for NOT_NOW (7 days from now)
    let expiresAt: string | null = null;
    if (deferralAction === 'NOT_NOW') {
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + 7);
      expiresAt = expiry.toISOString();
    }

    // Create the deferral record
    const record = await SR.entities.CompanyVersionDeferral.create({
      companyId: job.companyId,
      jobId,
      masterId: job.sourceMasterId,
      deferredVersionId,
      userId: user.id,
      action: deferralAction,
      expiresAt,
      deterministicKey,
      createdAt: now,
      updatedAt: now,
    });

    // Audit
    const auditAction = deferralAction === 'NOT_NOW' ? 'version_decision_created' : 'version_decision_created';
    await SR.entities.PlatformAuditLog.create({
      actingUserId: user.id,
      actingUserRole: 'company_admin',
      action: auditAction,
      masterId: job.sourceMasterId,
      versionId: deferredVersionId,
      versionNumber: version.versionNumber,
      metadata: {
        event: deferralAction === 'NOT_NOW' ? 'version_deferred' : 'version_dismissed',
        jobId,
        companyId: job.companyId,
        deferralAction,
        expiresAt,
      },
      timestamp: now,
    }).catch(() => {});

    return Response.json({ success: true, created: true, deferralId: record.id });

  } catch (error: any) {
    return Response.json({ error: 'An unexpected error occurred.', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}