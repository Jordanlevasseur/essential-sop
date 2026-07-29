import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { sanitizeStoredOverride, VALID_SECTION_TYPES } from '../../shared/overrideSchema.js';

/**
 * adoptMasterVersion — Version Management Engine: version adoption authority.
 *
 * Adopts a target published Master Version for a provisioned Essential SOP Job.
 *
 * INVARIANTS PRESERVED:
 * - Stable Company Job ID (Job.id never changes)
 * - Single pinned Master Version (Job.sourceVersionId updated to target)
 * - Company Override preserved exactly as-is (never merged, never rewritten)
 * - Immutable Master Versions (EssentialSOPVersion records never touched)
 * - No Master data copied into Job or Override records
 * - resolveJob() remains the single merge engine — adoption only changes the pin
 *
 * ATOMICITY:
 * - The single mutation is Job.sourceVersionId update.
 * - If audit fails, the override auditPending pattern is NOT used here (audit is informational).
 * - The job's new pinned version is the only state that matters.
 *
 * Request: { jobId, targetVersionId, expectedRevision, mutationKey }
 *   expectedRevision: the override.revision (if override exists) or 0 (no override)
 *   mutationKey: client-generated idempotency key
 *
 * Response: { success, resolvedJob, versionStatus } or { error, code }
 */

const SECTION_DISPLAY_ORDER = ['tools', 'materials', 'scope', 'procedure', 'safety', 'quality'];
const SECTION_TITLES: Record<string, string> = {
  tools: 'Tools', materials: 'Materials', scope: 'Scope',
  procedure: 'Procedure', safety: 'Safety', quality: 'Quality Standards',
};

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);

    // ── 1. Authentication ──────────────────────────────────────────────────────
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }, { status: 401 });

    // ── 2. Parse + validate input ─────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const { jobId, targetVersionId, expectedRevision, mutationKey } = body;

    if (!jobId || typeof jobId !== 'string') {
      return Response.json({ error: 'jobId is required', code: 'INVALID_INPUT' }, { status: 400 });
    }
    if (!targetVersionId || typeof targetVersionId !== 'string') {
      return Response.json({ error: 'targetVersionId is required', code: 'INVALID_INPUT' }, { status: 400 });
    }
    if (typeof expectedRevision !== 'number') {
      return Response.json({ error: 'expectedRevision is required', code: 'INVALID_INPUT' }, { status: 400 });
    }
    if (!mutationKey || typeof mutationKey !== 'string') {
      return Response.json({ error: 'mutationKey is required', code: 'INVALID_INPUT' }, { status: 400 });
    }

    const SR = base44.asServiceRole;

    // ── 3. Load job — derive companyId server-side ────────────────────────────
    let job: any;
    try { job = await SR.entities.Job.get(jobId); } catch (_) {}
    if (!job) return Response.json({ error: 'Job not found', code: 'NOT_FOUND' }, { status: 404 });

    // ── 4. Membership + role check ────────────────────────────────────────────
    const memberships = await base44.entities.CompanyMembership.filter({
      userId: user.id, companyId: job.companyId, status: 'active',
    });
    if (!memberships || memberships.length === 0) {
      return Response.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }
    const membership = memberships[0];
    const isCompanyAdmin = membership.role === 'general_manager' || membership.role === 'project_manager';
    if (!isCompanyAdmin) {
      return Response.json({ error: 'Insufficient role to adopt a new version', code: 'INSUFFICIENT_ROLE' }, { status: 403 });
    }

    // ── 5. Must be a provisioned Essential SOP ────────────────────────────────
    if (job.sourceType !== 'essential_sop') {
      return Response.json({ error: 'Only provisioned Essential SOP Jobs support version adoption', code: 'NOT_ESSENTIAL_SOP' }, { status: 409 });
    }

    // ── 6. Validate target version ────────────────────────────────────────────
    let targetVersion: any;
    try { targetVersion = await SR.entities.EssentialSOPVersion.get(targetVersionId); } catch (_) {}
    if (!targetVersion) {
      return Response.json({ error: 'Target version not found', code: 'VERSION_NOT_FOUND' }, { status: 404 });
    }
    if (targetVersion.status !== 'published') {
      return Response.json({ error: 'Target version is not published', code: 'VERSION_NOT_PUBLISHED' }, { status: 409 });
    }
    if (targetVersion.masterId !== job.sourceMasterId) {
      return Response.json({ error: 'Target version belongs to a different Master SOP', code: 'VERSION_MASTER_MISMATCH' }, { status: 409 });
    }

    // ── 7. Idempotency: check override record ─────────────────────────────────
    const existingOverrides = await SR.entities.JobOverride.filter({ companyId: job.companyId, jobId: job.id });
    const override: any = existingOverrides?.[0] || null;

    // If already on target version, return current resolved state
    if (job.sourceVersionId === targetVersionId) {
      const resolvedJob = await resolveAdoptedJob(job, SR, membership);
      return Response.json({ success: true, idempotent: true, resolvedJob });
    }

    // Idempotency: check if this mutationKey was the last recorded adoption
    // We store lastAdoptionMutationKey on the Job entity for this purpose
    // (Job has a metadata field; we use a dedicated tracking via audit log check instead)
    // Simpler: check if the current job version + mutationKey already match what was requested
    // We track this on the override record if present, otherwise fall through.
    if (override?.lastAdoptionMutationKey === mutationKey) {
      const resolvedJob = await resolveAdoptedJob(job, SR, membership);
      return Response.json({ success: true, idempotent: true, resolvedJob });
    }

    // ── 8. Optimistic concurrency on override ─────────────────────────────────
    const currentRevision = override?.revision ?? 0;
    if (expectedRevision !== currentRevision) {
      return Response.json({
        error: 'Conflict: the override was modified since you loaded this job. Reload and retry.',
        code: 'REVISION_CONFLICT',
        currentRevision,
      }, { status: 409 });
    }

    const previousVersionId = job.sourceVersionId;
    const now = new Date().toISOString();

    // ── 9. Atomic adoption — update ONLY the pinned version on the Job ─────────
    // This is the single mutation. Company Override is preserved unchanged.
    // No master data is copied. No sections are rewritten. No job fields beyond
    // sourceVersionId are touched here (title, shortDescription never modified).
    await SR.entities.Job.update(job.id, {
      sourceVersionId: targetVersionId,
    });

    // ── 10. Record adoption mutationKey on override (for idempotency) ─────────
    if (override) {
      try {
        await SR.entities.JobOverride.update(override.id, {
          lastAdoptionMutationKey: mutationKey,
          updatedAt: now,
        });
      } catch (_) {}
    }

    // ── 11. Conflict prediction (snapshot at time of adoption) ────────────────
    let adoptionConflicts: any[] = [];
    if (override?.overrideData) {
      const { sanitized: sanitizedOverride } = sanitizeStoredOverride(override.overrideData, job.id);
      const overriddenSections = new Set(Object.keys(sanitizedOverride?.sectionOverrides || {}));

      if (overriddenSections.size > 0) {
        const [prevSections, newSections] = await Promise.all([
          SR.entities.EssentialSOPSection.filter({ masterId: job.sourceMasterId, versionId: previousVersionId }, 'sortOrder', 10),
          SR.entities.EssentialSOPSection.filter({ masterId: job.sourceMasterId, versionId: targetVersionId }, 'sortOrder', 10),
        ]);
        for (const st of overriddenSections) {
          if (!VALID_SECTION_TYPES.has(st)) continue;
          const prev = (prevSections || []).find((s: any) => s.sectionType === st);
          const next = (newSections || []).find((s: any) => s.sectionType === st);
          if (prev && next && JSON.stringify(prev.contentItems || []) !== JSON.stringify(next.contentItems || [])) {
            adoptionConflicts.push({ sectionType: st, field: 'sectionContent' });
          }
        }
      }
    }

    // ── 12. Audit record ──────────────────────────────────────────────────────
    try {
      await SR.entities.ActivityLog.create({
        companyId: job.companyId,
        actingUserId: user.id,
        actionType: 'job_edited',
        targetType: 'job',
        targetId: job.id,
        summary: `Adopted Master Version ${targetVersion.versionNumber} for "${job.title}"`,
        metadata: {
          event: 'COMPANY_MASTER_VERSION_ADOPTED',
          previousVersionId,
          targetVersionId,
          targetVersionNumber: targetVersion.versionNumber,
          masterId: job.sourceMasterId,
          overridePresent: !!override,
          predictedConflictCount: adoptionConflicts.length,
          mutationKey,
        },
        timestamp: now,
      });
    } catch (_) {}

    // ── 13. Return resolved job (using updated version) ───────────────────────
    const updatedJob = await SR.entities.Job.get(job.id);
    const resolvedJob = await resolveAdoptedJob(updatedJob, SR, membership);

    return Response.json({
      success: true,
      resolvedJob,
      adoptionMeta: {
        previousVersionId,
        targetVersionId,
        targetVersionNumber: targetVersion.versionNumber,
        predictedConflicts: adoptionConflicts,
      },
    });

  } catch (error: any) {
    return Response.json({ error: 'An unexpected error occurred.', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

// ── Internal: resolve job after adoption ─────────────────────────────────────

async function resolveAdoptedJob(job: any, SR: any, membership: any): Promise<any> {
  const isCompanyAdmin = membership.role === 'general_manager' || membership.role === 'project_manager';
  const capabilities = {
    canEditContent: false, canCreateContent: false, canDeleteContent: false,
    canReorderContent: false, canChangeSectionStatus: false, canEditJobMetadata: false,
    canCustomize: isCompanyAdmin,
  };

  const version = await SR.entities.EssentialSOPVersion.get(job.sourceVersionId).catch(() => null);
  if (!version || version.status !== 'published') {
    return { job, sections: [], contentBySection: {}, capabilities, override: null };
  }

  const masterSections = await SR.entities.EssentialSOPSection.filter(
    { masterId: job.sourceMasterId, versionId: job.sourceVersionId }, 'sortOrder', 10
  );

  const overrides = await SR.entities.JobOverride.filter({ companyId: job.companyId, jobId: job.id });
  const override: any = overrides?.[0] || null;

  let sanitizedOverrideData: any = null;
  if (override?.overrideData) {
    const { sanitized } = sanitizeStoredOverride(override.overrideData, job.id);
    sanitizedOverrideData = sanitized;
  }

  const sections = SECTION_DISPLAY_ORDER.map((st, i) => {
    const ms = (masterSections || []).find((s: any) => s.sectionType === st);
    if (!ms) return null;
    return { id: ms.id, jobId: job.id, companyId: job.companyId, sectionType: st, title: SECTION_TITLES[st] || st, sortOrder: i, completionStatus: 'Empty' };
  }).filter(Boolean);

  const contentBySection: Record<string, any[]> = {};
  for (const ms of (masterSections || [])) {
    const st = ms.sectionType;
    if (!st || !VALID_SECTION_TYPES.has(st)) continue;
    const sectionOverride = sanitizedOverrideData?.sectionOverrides?.[st] || null;
    const sourceItems = sectionOverride || ms.contentItems || [];
    const isOverride = !!sectionOverride;
    contentBySection[st] = sourceItems.map((item: any, idx: number) => ({
      id: item._itemId || (isOverride ? `o_${ms.id}_${idx}` : `m_${ms.id}_${idx}`),
      jobId: job.id, companyId: job.companyId, sectionId: ms.id, sectionType: st,
      contentType: item.contentType || 'text',
      title: typeof item.title === 'string' ? item.title : '',
      body: typeof item.body === 'string' ? item.body : '',
      sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : idx,
      isRequired: typeof item.isRequired === 'boolean' ? item.isRequired : false,
      isCritical: typeof item.isCritical === 'boolean' ? item.isCritical : false,
      metadata: (item.metadata && typeof item.metadata === 'object') ? item.metadata : {},
    })).sort((a: any, b: any) => a.sortOrder - b.sortOrder);
  }

  const resolvedTitle = sanitizedOverrideData?.title || job.title;
  const resolvedShortDescription = sanitizedOverrideData?.shortDescription || job.shortDescription;
  const { sourceMasterId: _sm, sourceVersionId: _sv, sourceType: _st, isCustomized: _ic,
          customizedAt: _ca, customizedBy: _cb, ...publicJobFields } = job;

  return {
    job: { ...publicJobFields, title: resolvedTitle, shortDescription: resolvedShortDescription },
    sections, contentBySection, capabilities,
    override: override ? { revision: override.revision, customizedFields: override.customizedFields, auditPending: override.auditPending || false } : null,
  };
}