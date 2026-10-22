import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { requireCompanyAdmin } from '../../shared/platformAuth.ts';
import { buildProvisioningKey } from '../../shared/companyLibraryProvisioning.ts';

/**
 * addToCompanyLibrary — Company ADOPTION of a provisioned Master SOP.
 *
 * Phase 2 (PREPARED, not yet wired to UI). Phase 3/4 will connect the
 * "Add to Company Library" button to this endpoint.
 *
 * Architecture (no schema change):
 *   PLATFORM PROVISIONING = ProvisioningRecord.assignmentStatus === 'ACTIVE'
 *   COMPANY ADOPTION      = a linked Job exists with sourceType='essential_sop',
 *                           sourceMasterId=<masterId>, status='Published',
 *                           isArchived=false.
 *
 * This function performs the adoption act ONLY. It:
 *   - Requires the caller to be a general_manager/project_manager of the company
 *     (the same users who can already create AND edit company Jobs/SOPs).
 *   - Requires an ACTIVE ProvisioningRecord for (companyId, masterId) — i.e. the
 *     Master must have been provisioned to this company by a Platform Super Admin.
 *     Adoption can NEVER grant access to an unprovisioned Master.
 *   - Creates the linked Job, OR re-activates (un-archives) an existing linked Job.
 *     Duplicate-safe: keyed by (companyId, sourceMasterId) — never creates a second
 *     active Job for the same Master.
 *   - Does NOT modify the ProvisioningRecord, the Master, or the Version.
 *   - Does NOT change platform assignment status. Adoption is company-side only.
 *
 * Idempotent: re-calling when already adopted returns alreadyAdopted=true with no
 * write. Re-calling after a company-level removal un-archives (re-adopt) the
 * existing Job instead of creating a duplicate.
 *
 * Request:  { companyId: string, masterId: string }
 * Response: { success, adopted|reAdopted|alreadyAdopted, jobId }
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { companyId, masterId } = body;

    if (!companyId || typeof companyId !== 'string' || !companyId.trim()) {
      return Response.json({ error: 'companyId is required', code: 'INVALID_INPUT' }, { status: 400 });
    }
    if (!masterId || typeof masterId !== 'string' || !masterId.trim()) {
      return Response.json({ error: 'masterId is required', code: 'INVALID_INPUT' }, { status: 400 });
    }

    // ── Authorization: GM/PM of this company (create+edit permission) ──────────
    const { user, error: authError } = await requireCompanyAdmin(base44, companyId);
    if (authError) return authError;

    const SR = base44.asServiceRole;

    // ── Load the Master SOP ───────────────────────────────────────────────────
    let master: any;
    try { master = await SR.entities.EssentialSOPMaster.get(masterId); } catch (_) {}
    if (!master) return Response.json({ error: 'Master SOP not found', code: 'NOT_FOUND' }, { status: 404 });
    if (master.status !== 'active') {
      return Response.json({ error: 'Master SOP is not active', code: 'MASTER_NOT_ACTIVE' }, { status: 409 });
    }
    if (master.distributionStatus === 'retired') {
      return Response.json({ error: 'This Master SOP has been retired and is no longer available for adoption.', code: 'MASTER_RETIRED' }, { status: 409 });
    }

    // ── Require an ACTIVE platform assignment (provisioning) ──────────────────
    // Adoption can never bypass provisioning. If no ACTIVE ProvisioningRecord
    // exists, the Master was never assigned to this company by a Platform Super
    // Admin — reject. This preserves platform control and company isolation.
    const provisioningKey = buildProvisioningKey(companyId, masterId);
    let assignment: any = null;
    try {
      const recs = await SR.entities.ProvisioningRecord.filter({ provisioningKey }, '-createdAt', 10);
      assignment = (recs || []).find((r: any) => r.assignmentStatus === 'ACTIVE') || null;
    } catch (_) {}
    if (!assignment) {
      return Response.json({
        error: 'This Master SOP has not been provisioned to your company. Only a Platform Super Admin can assign it.',
        code: 'NOT_PROVISIONED',
      }, { status: 403 });
    }

    // ── Published version check ───────────────────────────────────────────────
    if (!master.currentPublishedVersionId) {
      return Response.json({ error: 'Master SOP has no published version', code: 'NO_PUBLISHED_VERSION' }, { status: 409 });
    }
    let publishedVersion: any;
    try { publishedVersion = await SR.entities.EssentialSOPVersion.get(master.currentPublishedVersionId); } catch (_) {}
    if (!publishedVersion || publishedVersion.status !== 'published') {
      return Response.json({ error: 'Published version is not available', code: 'VERSION_UNAVAILABLE' }, { status: 409 });
    }

    // ── Duplicate-safe adoption: existing linked Job for (companyId, masterId) ─
    let existingJob: any = null;
    try {
      const jobs = await SR.entities.Job.filter(
        { companyId, sourceType: 'essential_sop', sourceMasterId: masterId },
        '-created_date', 10
      );
      existingJob = (jobs || [])[0] || null;
    } catch (_) {}

    const now = new Date().toISOString();

    if (existingJob) {
      if (!existingJob.isArchived && existingJob.status === 'Published') {
        // Already adopted — idempotent, zero writes.
        return Response.json({ success: true, alreadyAdopted: true, jobId: existingJob.id });
      }
      // Re-adopt: restore the existing linked Job to active, published state.
      // Never create a duplicate. Preserve the existing sourceVersionId — do NOT
      // force-upgrade on re-adoption. The company's overrides were built against
      // this version; a newer version, if any, is adopted separately via the
      // version-adoption flow (which reconciles overrides properly). This
      // preserves identity, source-version relationship, overrides,
      // customization, and version history.
      const updated = await SR.entities.Job.update(existingJob.id, {
        isArchived: false,
        status: 'Published',
      });
      await _audit(SR, companyId, user.id, existingJob.id, masterId, publishedVersion.id, 're_adopted', master.title);
      return Response.json({ success: true, reAdopted: true, jobId: updated.id });
    }

    // ── Create the adopted linked Job (mirrors provisionMasterToOneCompany shape) ──
    const createdJob = await SR.entities.Job.create({
      companyId,
      title: master.title,
      shortDescription: master.description || '',
      trade: master.trade || '',
      category: master.category || '',
      status: 'Published',
      isArchived: false,
      sourceType: 'essential_sop',
      sourceMasterId: masterId,
      sourceVersionId: publishedVersion.id,
      isCustomized: false,
      customizedAt: null,
      customizedBy: null,
    });

    await _audit(SR, companyId, user.id, createdJob.id, masterId, publishedVersion.id, 'adopted', master.title);

    return Response.json({ success: true, adopted: true, jobId: createdJob.id });
  } catch (error: any) {
    return Response.json({ error: 'An unexpected error occurred.', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

// ── Internal: company activity audit (reuses existing ActivityLog actionType, no schema change) ─
async function _audit(
  SR: any, companyId: string, userId: string, jobId: string,
  masterId: string, versionId: string, phase: string, title: string
): Promise<void> {
  try {
    await SR.entities.ActivityLog.create({
      companyId,
      actingUserId: userId,
      actionType: 'job_created',
      targetType: 'job',
      targetId: jobId,
      summary: `${phase === 'adopted' ? 'Added' : 'Re-added'} Essential SOP "${title}" to company library`,
      metadata: { masterId, versionId, adoption: true, phase },
      timestamp: new Date().toISOString(),
    });
  } catch (_) { /* non-fatal */ }
}