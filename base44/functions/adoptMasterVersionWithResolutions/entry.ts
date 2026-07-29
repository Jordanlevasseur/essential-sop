import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { sanitizeStoredOverride, validateOverrideData, VALID_SECTION_TYPES, deterministicOverrideKey } from '../../shared/overrideSchema.js';
import {
  diffSection, diffMetadata, computePreviewFingerprint,
  buildSummary, rebaseOverride, validateResolutions,
  CHANGE_TYPES,
} from '../../shared/versionDiff.ts';

/**
 * adoptMasterVersionWithResolutions — Atomic adoption with three-way rebase.
 *
 * This is the canonical adoption mutation when conflicts exist or the review
 * flow is used. It:
 *   1. Recalculates the diff server-side (never trusts client diff)
 *   2. Verifies the preview fingerprint is still current
 *   3. Validates all required conflict resolutions
 *   4. Rebases the override onto TARGET
 *   5. Updates Job.sourceVersionId
 *   6. Persists the rebased override (or deletes it if empty)
 *   7. Writes audit with full resolution metadata
 *   8. Returns the final resolved job
 *
 * ATOMICITY STRATEGY (Base44 single-entity constraint):
 * - Step A: Write rebased override (update or create or delete)
 * - Step B: Update Job.sourceVersionId
 * - If Step B fails: the override is now relative to an old version — tracked via
 *   a 'rebaseIncomplete' flag on the override so recovery can complete it.
 * - If Step A fails: nothing changed; safe to retry.
 * - Idempotency key prevents double-adoption on retry.
 *
 * Request: {
 *   jobId, targetVersionId,
 *   expectedJobRevision, expectedOverrideRevision,
 *   previewFingerprint, resolutions, mutationKey
 * }
 */

const SECTION_ORDER = ['tools', 'materials', 'scope', 'procedure', 'safety', 'quality'];
const SECTION_TITLES: Record<string, string> = {
  tools: 'Tools', materials: 'Materials', scope: 'Scope',
  procedure: 'Procedure', safety: 'Safety', quality: 'Quality Standards',
};

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { jobId, targetVersionId, expectedJobRevision, expectedOverrideRevision, previewFingerprint, resolutions, mutationKey } = body;

    if (!jobId || typeof jobId !== 'string') return Response.json({ error: 'jobId is required', code: 'INVALID_INPUT' }, { status: 400 });
    if (!targetVersionId || typeof targetVersionId !== 'string') return Response.json({ error: 'targetVersionId is required', code: 'INVALID_INPUT' }, { status: 400 });
    if (!mutationKey || typeof mutationKey !== 'string') return Response.json({ error: 'mutationKey is required', code: 'INVALID_INPUT' }, { status: 400 });
    if (!previewFingerprint || typeof previewFingerprint !== 'string') return Response.json({ error: 'previewFingerprint is required', code: 'INVALID_INPUT' }, { status: 400 });
    if (!resolutions || typeof resolutions !== 'object') return Response.json({ error: 'resolutions is required', code: 'INVALID_INPUT' }, { status: 400 });
    if (typeof expectedOverrideRevision !== 'number') return Response.json({ error: 'expectedOverrideRevision is required', code: 'INVALID_INPUT' }, { status: 400 });

    const SR = base44.asServiceRole;

    let job: any;
    try { job = await SR.entities.Job.get(jobId); } catch (_) {}
    if (!job) return Response.json({ error: 'Job not found', code: 'NOT_FOUND' }, { status: 404 });

    const memberships = await base44.entities.CompanyMembership.filter({ userId: user.id, companyId: job.companyId, status: 'active' });
    if (!memberships || memberships.length === 0) return Response.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    const membership = memberships[0];
    const isCompanyAdmin = membership.role === 'general_manager' || membership.role === 'project_manager';
    if (!isCompanyAdmin) return Response.json({ error: 'Insufficient role', code: 'INSUFFICIENT_ROLE' }, { status: 403 });

    if (job.sourceType !== 'essential_sop') return Response.json({ error: 'Only provisioned Essential SOP Jobs support version adoption', code: 'NOT_ESSENTIAL_SOP' }, { status: 409 });

    let targetVersion: any;
    try { targetVersion = await SR.entities.EssentialSOPVersion.get(targetVersionId); } catch (_) {}
    if (!targetVersion) return Response.json({ error: 'Target version not found', code: 'VERSION_NOT_FOUND' }, { status: 404 });
    if (targetVersion.status !== 'published') return Response.json({ error: 'Target version is not published', code: 'VERSION_NOT_PUBLISHED' }, { status: 409 });
    if (targetVersion.masterId !== job.sourceMasterId) return Response.json({ error: 'Target version master mismatch', code: 'VERSION_MASTER_MISMATCH' }, { status: 409 });

    // Load current override
    const overrideRecords = await SR.entities.JobOverride.filter({ companyId: job.companyId, jobId: job.id });
    const override: any = overrideRecords?.[0] || null;

    // ── Idempotency — checked BEFORE concurrency/fingerprint guards ───────────
    // lastAdoptionMutationKey is stored on the Job entity itself so it survives
    // override deletion (empty rebase scenario).
    // If the exact same mutationKey was previously completed successfully, return
    // the original result without re-applying any changes.
    if (job.lastAdoptionMutationKey === mutationKey) {
      const resolvedJob = await resolveJobInternal(job, SR, membership);
      const versionStatus = await getVersionStatusInternal(job, SR, isCompanyAdmin);
      return Response.json({ success: true, idempotent: true, resolvedJob, versionStatus });
    }

    // ── Already-current: different key but job already on target ──────────────
    // This is NOT idempotency — it is a new request that arrived after another
    // adoption completed. Return ALREADY_CURRENT so callers know no action was taken.
    if (job.sourceVersionId === targetVersionId) {
      return Response.json({ success: false, code: 'ALREADY_CURRENT', error: 'Job is already on the target version.' }, { status: 409 });
    }

    // ── Concurrency checks ─────────────────────────────────────────────────────
    const currentOverrideRevision = override?.revision ?? 0;
    if (expectedOverrideRevision !== currentOverrideRevision) {
      return Response.json({ error: 'Override was modified. Reload and retry.', code: 'REVISION_CONFLICT', currentOverrideRevision }, { status: 409 });
    }

    // ── Recalculate preview server-side to verify fingerprint ─────────────────
    let sanitizedOverrideData: any = null;
    if (override?.overrideData) {
      const { sanitized } = sanitizeStoredOverride(override.overrideData, job.id);
      sanitizedOverrideData = sanitized;
    }

    const [baseSections, targetSections] = await Promise.all([
      SR.entities.EssentialSOPSection.filter({ masterId: job.sourceMasterId, versionId: job.sourceVersionId }, 'sortOrder', 10),
      SR.entities.EssentialSOPSection.filter({ masterId: job.sourceMasterId, versionId: targetVersionId }, 'sortOrder', 10),
    ]);

    let masterRecord: any = null;
    try { masterRecord = await SR.entities.EssentialSOPMaster.get(job.sourceMasterId); } catch (_) {}

    const changesBySection: Record<string, any[]> = {};
    for (const st of SECTION_ORDER) {
      const baseSection = (baseSections || []).find((s: any) => s.sectionType === st);
      const targetSection = (targetSections || []).find((s: any) => s.sectionType === st);
      const companyItems = sanitizedOverrideData?.sectionOverrides?.[st] ?? null;
      const changes = diffSection(st, baseSection?.id || st, targetSection?.id || st, baseSection?.contentItems || [], targetSection?.contentItems || [], companyItems);
      if (changes.length > 0) changesBySection[st] = changes;
    }

    const baseTitle = job.title || '';
    const targetTitle = masterRecord?.title || job.title || '';
    const metaChanges = diffMetadata(baseTitle, targetTitle, job.shortDescription || '', job.shortDescription || '', sanitizedOverrideData?.title || null, sanitizedOverrideData?.shortDescription || null);
    if (metaChanges.length > 0) changesBySection['metadata'] = metaChanges;

    const jobRevision = job.updated_date || job.updatedAt || '0';
    const currentFingerprint = computePreviewFingerprint(job.id, job.sourceVersionId, targetVersionId, jobRevision, currentOverrideRevision, changesBySection);

    if (currentFingerprint !== previewFingerprint) {
      return Response.json({
        error: 'The job or update changed since you generated the preview. Please reload and review again.',
        code: 'STALE_PREVIEW',
        currentFingerprint,
      }, { status: 409 });
    }

    // ── Validate resolutions ───────────────────────────────────────────────────
    const resolutionErrors = validateResolutions(changesBySection, resolutions);
    if (resolutionErrors.length > 0) {
      return Response.json({ error: `Resolution validation failed: ${resolutionErrors[0]}`, code: 'INVALID_RESOLUTIONS', details: resolutionErrors }, { status: 400 });
    }

    // ── Rebase override ────────────────────────────────────────────────────────
    const rebasedOverrideData = rebaseOverride(changesBySection, resolutions, sanitizedOverrideData || {}, targetSections || []);

    // ── Validate rebased override through overrideSchema ──────────────────────
    if (rebasedOverrideData) {
      const validation = validateOverrideData(rebasedOverrideData);
      if (!validation.valid) {
        return Response.json({ error: `Rebased override failed validation: ${validation.error}`, code: 'REBASE_VALIDATION_FAILED' }, { status: 500 });
      }
    }

    const previousVersionId = job.sourceVersionId;
    const now = new Date().toISOString();
    const summary = buildSummary(changesBySection);
    const keepCompanyCount = Object.values(resolutions).filter((r: any) => r === 'KEEP_COMPANY').length;
    const useNewCount = Object.values(resolutions).filter((r: any) => r === 'USE_NEW_ESSENTIAL_SOP').length;
    const overrideWillBeEmpty = rebasedOverrideData === null;

    // ── ATOMIC SEQUENCE ────────────────────────────────────────────────────────
    // Step A: Persist rebased override BEFORE pinning new version
    // This way if Step B fails, we still have the rebase state; the rebaseIncomplete
    // flag signals to recovery that the version pin needs to be completed.
    let savedOverride: any = null;

    if (override) {
      if (overrideWillBeEmpty) {
        // Delete override (Edit 5 convention: empty override = deleted)
        try {
          await SR.entities.JobOverride.delete(override.id);
        } catch (deleteErr: any) {
          return Response.json({ error: 'Failed to finalize override during adoption. No changes made.', code: 'OVERRIDE_UPDATE_FAILED' }, { status: 500 });
        }
      } else {
        // Update override with rebased data
        try {
          const customizedFields: string[] = [];
          if (rebasedOverrideData.title) customizedFields.push('title');
          if (rebasedOverrideData.shortDescription) customizedFields.push('shortDescription');
          for (const st of Object.keys(rebasedOverrideData.sectionOverrides || {})) {
            customizedFields.push(`section:${st}`);
          }
          savedOverride = await SR.entities.JobOverride.update(override.id, {
            overrideData: rebasedOverrideData,
            customizedFields,
            revision: currentOverrideRevision + 1,
            lastMutationKey: mutationKey,
            lastAdoptionMutationKey: mutationKey,
            lastModifiedByUserId: user.id,
            sourceMasterId: job.sourceMasterId,
            sourceVersionId: targetVersionId, // rebased to target
            auditPending: false,
            rebaseIncomplete: false,
            updatedAt: now,
          });
        } catch (updateErr: any) {
          return Response.json({ error: 'Failed to rebase override. No changes made.', code: 'OVERRIDE_UPDATE_FAILED' }, { status: 500 });
        }
      }
    } else if (rebasedOverrideData) {
      // No existing override but rebase produced one (edge case: company had title/desc override)
      try {
        const customizedFields: string[] = [];
        if (rebasedOverrideData.title) customizedFields.push('title');
        if (rebasedOverrideData.shortDescription) customizedFields.push('shortDescription');
        for (const st of Object.keys((rebasedOverrideData as any).sectionOverrides || {})) {
          customizedFields.push(`section:${st}`);
        }
        savedOverride = await SR.entities.JobOverride.create({
          companyId: job.companyId, jobId: job.id,
          deterministicKey: deterministicOverrideKey(job.companyId, job.id),
          sourceMasterId: job.sourceMasterId, sourceVersionId: targetVersionId,
          overrideData: rebasedOverrideData, customizedFields,
          revision: 1, mutationKey, lastMutationKey: mutationKey,
          lastAdoptionMutationKey: mutationKey,
          auditPending: false, rebaseIncomplete: false,
          createdByUserId: user.id, lastModifiedByUserId: user.id,
          createdAt: now, updatedAt: now,
        });
      } catch (createErr: any) {
        return Response.json({ error: 'Failed to create rebased override. No changes made.', code: 'OVERRIDE_CREATE_FAILED' }, { status: 500 });
      }
    }

    // Step B: Pin the new version on the Job + record idempotency key
    try {
      await SR.entities.Job.update(job.id, { sourceVersionId: targetVersionId, lastAdoptionMutationKey: mutationKey });
    } catch (jobUpdateErr: any) {
      // Step B failed — mark rebaseIncomplete for recovery if we updated/created an override
      if (savedOverride?.id) {
        try {
          await SR.entities.JobOverride.update(savedOverride.id, { rebaseIncomplete: true, updatedAt: now });
        } catch (_) {}
      }
      return Response.json({
        error: 'Failed to update job version after override rebase. The system will attempt recovery on next access.',
        code: 'JOB_VERSION_UPDATE_FAILED',
      }, { status: 500 });
    }

    // Step C: Audit
    const newOverrideRevision = overrideWillBeEmpty ? 0 : (savedOverride?.revision ?? currentOverrideRevision + 1);
    let auditPending = false;
    try {
      await SR.entities.ActivityLog.create({
        companyId: job.companyId,
        actingUserId: user.id,
        actionType: 'job_edited',
        targetType: 'job',
        targetId: job.id,
        summary: `Adopted Master Version ${targetVersion.versionNumber} for "${job.title}" with ${summary.conflicts} conflict(s) resolved`,
        metadata: {
          event: 'COMPANY_MASTER_VERSION_ADOPTED_WITH_RESOLUTIONS',
          previousVersionId,
          targetVersionId,
          previousVersionNumber: (baseSections as any)?.[0]?.versionId ? undefined : undefined,
          targetVersionNumber: targetVersion.versionNumber,
          masterId: job.sourceMasterId,
          previousOverrideRevision: currentOverrideRevision,
          resultingOverrideRevision: newOverrideRevision,
          conflictCount: summary.conflicts,
          resolutionCount: summary.conflicts,
          keptAsCompanyCount: keepCompanyCount,
          acceptedFromSopCount: useNewCount,
          overrideRemovedBecauseEmpty: overrideWillBeEmpty,
          previewFingerprint,
          mutationKey,
        },
        timestamp: now,
      });
    } catch (_) {
      auditPending = true;
    }

    // Return final resolved job
    const updatedJob = await SR.entities.Job.get(job.id);
    const resolvedJob = await resolveJobInternal(updatedJob, SR, membership);
    const versionStatus = await getVersionStatusInternal(updatedJob, SR, isCompanyAdmin);

    return Response.json({
      success: true,
      auditPending,
      resolvedJob,
      versionStatus,
      adoptionMeta: {
        previousVersionId,
        targetVersionId,
        targetVersionNumber: targetVersion.versionNumber,
        overrideRebased: !!override || !!rebasedOverrideData,
        overrideRemoved: overrideWillBeEmpty,
        conflictCount: summary.conflicts,
        keepCompanyCount,
        useNewCount,
      },
    });

  } catch (error: any) {
    return Response.json({ error: 'An unexpected error occurred.', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function resolveJobInternal(job: any, SR: any, membership: any): Promise<any> {
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

  const sectionOrder = ['tools', 'materials', 'scope', 'procedure', 'safety', 'quality'];
  const sectionTitles: Record<string, string> = { tools: 'Tools', materials: 'Materials', scope: 'Scope', procedure: 'Procedure', safety: 'Safety', quality: 'Quality Standards' };

  const sections = sectionOrder.map((st, i) => {
    const ms = (masterSections || []).find((s: any) => s.sectionType === st);
    if (!ms) return null;
    return { id: ms.id, jobId: job.id, companyId: job.companyId, sectionType: st, title: sectionTitles[st] || st, sortOrder: i, completionStatus: 'Empty' };
  }).filter(Boolean);

  const contentBySection: Record<string, any[]> = {};
  for (const ms of (masterSections || [])) {
    const st = ms.sectionType;
    if (!st || !(VALID_SECTION_TYPES as Set<string>).has(st)) continue;
    const sectionOverride = sanitizedOverrideData?.sectionOverrides?.[st] || null;
    const sourceItems = sectionOverride || ms.contentItems || [];
    const isOv = !!sectionOverride;
    contentBySection[st] = sourceItems.map((item: any, idx: number) => ({
      id: item._itemId || (isOv ? `o_${ms.id}_${idx}` : `m_${ms.id}_${idx}`),
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
  const { sourceMasterId: _sm, sourceVersionId: _sv, sourceType: _st, isCustomized: _ic, customizedAt: _ca, customizedBy: _cb, ...publicJobFields } = job;

  return {
    job: { ...publicJobFields, title: resolvedTitle, shortDescription: resolvedShortDescription },
    sections, contentBySection, capabilities,
    override: override ? { revision: override.revision, customizedFields: override.customizedFields, auditPending: override.auditPending || false } : null,
  };
}

async function getVersionStatusInternal(job: any, SR: any, isCompanyAdmin: boolean): Promise<any> {
  if (job.sourceType !== 'essential_sop') return { updateAvailable: false };
  const allVersions = await SR.entities.EssentialSOPVersion.filter({ masterId: job.sourceMasterId, status: 'published' }, '-versionNumber', 50).catch(() => []);
  const sorted = (allVersions || []).sort((a: any, b: any) => b.versionNumber - a.versionNumber);
  const newest = sorted[0];
  const pinned = sorted.find((v: any) => v.id === job.sourceVersionId);
  return {
    updateAvailable: !!pinned && !!newest && newest.id !== job.sourceVersionId,
    pinnedVersion: pinned ? { id: pinned.id, versionNumber: pinned.versionNumber } : null,
    newestVersion: newest ? { id: newest.id, versionNumber: newest.versionNumber } : null,
    capabilities: { canAdoptVersion: isCompanyAdmin },
  };
}