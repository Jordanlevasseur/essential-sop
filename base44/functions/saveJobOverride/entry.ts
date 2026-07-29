import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import {
  validateOverrideData,
  sanitizeStoredOverride,
  buildResolvedItems,
  generateItemId,
  masterItemId,
  deterministicOverrideKey,
  VALID_SECTION_TYPES,
} from '../../shared/overrideSchema.js';

/**
 * saveJobOverride — The ONLY authorized path for saving company overrides on provisioned SOPs.
 *
 * Architecture invariants:
 * - Job.title and Job.shortDescription are NEVER modified here.
 * - The canonical title/shortDescription for an essential_sop Job is always
 *   JobOverride.overrideData.title / shortDescription, resolved at read time.
 * - companyId is ALWAYS derived from job.companyId, never trusted from the client.
 *
 * Stable nested item IDs:
 * - New items submitted without a _itemId receive a stable generated ID.
 * - Existing items with _itemId retain their ID across saves and reorders.
 * - Reordering only changes sortOrder; _itemId is never reassigned.
 * - Duplicate _itemId values within a section are rejected.
 *
 * Concurrent first-save race mitigation:
 * - On first create, the deterministicKey 'override_${companyId}_${jobId}' is stored.
 * - If a race produces two records, the second save detects the duplicate via
 *   deterministicKey filter and resolves to a single logical override by updating
 *   the winner and deleting the duplicate.
 * - This does not guarantee strict DB-level uniqueness (Base44 has no unique index),
 *   but guarantees convergence to a single logical override within one request cycle.
 *
 * Audit failure handling:
 * - Override is saved first (source of truth).
 * - If ActivityLog.create fails, auditPending=true and auditPendingRevision are stored.
 * - Client receives success:true with auditPending:true — not a false complete success.
 * - On retry with the same mutationKey, idempotency returns current state.
 * - A retry with a new mutationKey proceeds normally; the backend checks auditPending
 *   and writes the missing audit record before processing the new save.
 *
 * Request: { jobId, overrideData, expectedRevision, mutationKey }
 * Response: { success, override, resolvedJob } or { error, code }
 */

const SECTION_DISPLAY_ORDER = ['tools', 'materials', 'scope', 'procedure', 'safety', 'quality'];
const SECTION_TITLES: Record<string, string> = {
  tools: 'Tools', materials: 'Materials', scope: 'Scope',
  procedure: 'Procedure', safety: 'Safety', quality: 'Quality Standards',
};

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);

    // ── 1. Authentication ─────────────────────────────────────────────────────
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }, { status: 401 });

    // ── 2. Parse request body ─────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const { jobId, overrideData, expectedRevision, mutationKey } = body;

    if (!jobId || typeof jobId !== 'string') {
      return Response.json({ error: 'jobId is required', code: 'INVALID_INPUT' }, { status: 400 });
    }
    if (!mutationKey || typeof mutationKey !== 'string') {
      return Response.json({ error: 'mutationKey is required', code: 'INVALID_INPUT' }, { status: 400 });
    }
    if (typeof expectedRevision !== 'number') {
      return Response.json({ error: 'expectedRevision is required', code: 'INVALID_INPUT' }, { status: 400 });
    }

    // ── 3. Validate overrideData using shared schema ──────────────────────────
    const validation = validateOverrideData(overrideData);
    if (!validation.valid) {
      return Response.json({ error: validation.error, code: validation.code }, { status: 400 });
    }

    const SR = base44.asServiceRole;

    // ── 4. Load the Job (never trust client-supplied companyId) ───────────────
    let job: any;
    try { job = await SR.entities.Job.get(jobId); } catch (_) {}
    if (!job) return Response.json({ error: 'Job not found', code: 'NOT_FOUND' }, { status: 404 });

    // ── 5. Company membership check ───────────────────────────────────────────
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
      return Response.json({ error: 'Insufficient role to customize job content', code: 'INSUFFICIENT_ROLE' }, { status: 403 });
    }

    // ── 6. Job must be a provisioned Essential SOP ────────────────────────────
    if (job.sourceType !== 'essential_sop') {
      return Response.json({ error: 'Only provisioned Essential SOP Jobs support the override system.', code: 'NOT_ESSENTIAL_SOP' }, { status: 409 });
    }

    // ── 7. Load existing override ─────────────────────────────────────────────
    const existingOverrides = await SR.entities.JobOverride.filter({
      companyId: job.companyId,
      jobId: job.id,
    });

    // ── Concurrent race: detect duplicate records from simultaneous first-saves ─
    // If more than one record exists (race condition), treat the earliest as winner,
    // delete the duplicates, and proceed with the winner.
    let existingOverride: any = null;
    if (existingOverrides && existingOverrides.length > 1) {
      const sorted = [...existingOverrides].sort((a: any, b: any) =>
        new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
      );
      existingOverride = sorted[0];
      // Delete duplicates
      for (let i = 1; i < sorted.length; i++) {
        try { await SR.entities.JobOverride.delete(sorted[i].id); } catch (_) {}
      }
    } else {
      existingOverride = existingOverrides?.[0] || null;
    }

    // ── 8. Idempotency: reject resubmission of same mutation key ──────────────
    if (existingOverride && existingOverride.lastMutationKey === mutationKey) {
      const resolveRes = await resolveJobInternal(job, SR, membership);
      return Response.json({ success: true, idempotent: true, override: existingOverride, resolvedJob: resolveRes });
    }

    // ── 8b. Pending audit recovery ────────────────────────────────────────────
    // If a previous save completed but its audit write failed, complete it now before
    // processing the new save. This is safe: the override is already the source of truth.
    if (existingOverride?.auditPending && existingOverride?.auditPendingRevision) {
      try {
        await SR.entities.ActivityLog.create({
          companyId: job.companyId,
          actingUserId: existingOverride.lastModifiedByUserId,
          actionType: 'job_edited',
          targetType: 'job',
          targetId: job.id,
          summary: `[recovered] Customized Essential SOP "${job.title}" (revision ${existingOverride.auditPendingRevision})`,
          metadata: {
            masterId: job.sourceMasterId,
            revision: existingOverride.auditPendingRevision,
            recovered: true,
          },
          timestamp: existingOverride.updatedAt || new Date().toISOString(),
        });
        // Clear auditPending flag
        await SR.entities.JobOverride.update(existingOverride.id, { auditPending: false, auditPendingRevision: null });
        existingOverride = { ...existingOverride, auditPending: false, auditPendingRevision: null };
      } catch (_) {
        // Recovery attempt failed — continue with new save; auditPending stays set
      }
    }

    // ── 9. Optimistic concurrency ─────────────────────────────────────────────
    const currentRevision = existingOverride?.revision ?? 0;
    if (expectedRevision !== currentRevision) {
      return Response.json({
        error: 'Conflict: another change was made since you loaded this job. Reload and retry.',
        code: 'REVISION_CONFLICT',
        currentRevision,
      }, { status: 409 });
    }

    // ── 10. Assign stable _itemId to new override items ───────────────────────
    // Items that already have _itemId retain it.
    // New items (no _itemId) receive a generated stable ID.
    let normalizedOverrideData = { ...overrideData };
    if (overrideData.sectionOverrides) {
      const normalizedSections: Record<string, any[]> = {};
      for (const [st, items] of Object.entries(overrideData.sectionOverrides as Record<string, any[]>)) {
        // Load master section to derive stable section ID for new item ID generation
        const masterSections = await SR.entities.EssentialSOPSection.filter(
          { masterId: job.sourceMasterId, versionId: job.sourceVersionId }, 'sortOrder', 10
        );
        const masterSection = masterSections?.find((s: any) => s.sectionType === st);
        const sectionId = masterSection?.id || st;

        normalizedSections[st] = items.map((item: any) => ({
          ...item,
          _itemId: item._itemId || generateItemId(sectionId),
        }));
      }
      normalizedOverrideData = { ...overrideData, sectionOverrides: normalizedSections };
    }

    // ── 11. Compute customized fields list ────────────────────────────────────
    const customizedFields: string[] = [];
    if (normalizedOverrideData.title) customizedFields.push('title');
    if (normalizedOverrideData.shortDescription) customizedFields.push('shortDescription');
    if (normalizedOverrideData.sectionOverrides) {
      for (const st of Object.keys(normalizedOverrideData.sectionOverrides)) {
        customizedFields.push(`section:${st}`);
      }
    }

    const now = new Date().toISOString();
    const newRevision = currentRevision + 1;
    const deterministicKey = deterministicOverrideKey(job.companyId, job.id);

    // ── 12. Upsert the override record ────────────────────────────────────────
    let savedOverride: any;
    if (existingOverride) {
      // Merge: preserve any existing sectionOverrides not touched in this save
      const mergedSectionOverrides = {
        ...(existingOverride.overrideData?.sectionOverrides || {}),
        ...(normalizedOverrideData.sectionOverrides || {}),
      };
      const mergedOverrideData = {
        ...existingOverride.overrideData,
        ...normalizedOverrideData,
        sectionOverrides: mergedSectionOverrides,
      };
      const mergedCustomizedFields: string[] = [];
      if (mergedOverrideData.title) mergedCustomizedFields.push('title');
      if (mergedOverrideData.shortDescription) mergedCustomizedFields.push('shortDescription');
      for (const st of Object.keys(mergedSectionOverrides)) {
        mergedCustomizedFields.push(`section:${st}`);
      }

      savedOverride = await SR.entities.JobOverride.update(existingOverride.id, {
        overrideData: mergedOverrideData,
        customizedFields: mergedCustomizedFields,
        revision: newRevision,
        lastMutationKey: mutationKey,
        lastModifiedByUserId: user.id,
        auditPending: false,
        auditPendingRevision: null,
        updatedAt: now,
      });
    } else {
      savedOverride = await SR.entities.JobOverride.create({
        companyId: job.companyId,
        jobId: job.id,
        deterministicKey,
        sourceMasterId: job.sourceMasterId,
        sourceVersionId: job.sourceVersionId,
        overrideData: normalizedOverrideData,
        customizedFields,
        revision: newRevision,
        mutationKey,
        lastMutationKey: mutationKey,
        auditPending: false,
        auditPendingRevision: null,
        createdByUserId: user.id,
        lastModifiedByUserId: user.id,
        createdAt: now,
        updatedAt: now,
      });
    }

    // ── 13. Mark Job.isCustomized = true on first override ────────────────────
    if (!job.isCustomized) {
      try {
        await SR.entities.Job.update(job.id, {
          isCustomized: true,
          customizedAt: now,
          customizedBy: user.id,
        });
      } catch (_) {
        // Non-fatal — isCustomized is informational metadata only
      }
    }

    // ── 14. Write audit record — with explicit failure handling ───────────────
    // The override is the source of truth. Audit is informational.
    // On failure: mark auditPending=true so retry can complete it.
    let auditPending = false;
    try {
      await SR.entities.ActivityLog.create({
        companyId: job.companyId,
        actingUserId: user.id,
        actionType: 'job_edited',
        targetType: 'job',
        targetId: job.id,
        summary: `Customized Essential SOP "${job.title}" (revision ${newRevision})`,
        metadata: {
          masterId: job.sourceMasterId,
          masterVersionId: job.sourceVersionId,
          customizedFields: savedOverride.customizedFields,
          revision: newRevision,
          mutationKey,
        },
        timestamp: now,
      });
    } catch (_) {
      // Audit write failed — record the pending state for retry recovery
      auditPending = true;
      try {
        await SR.entities.JobOverride.update(savedOverride.id, {
          auditPending: true,
          auditPendingRevision: newRevision,
        });
        savedOverride = { ...savedOverride, auditPending: true, auditPendingRevision: newRevision };
      } catch (_) {}
    }

    // ── 15. Return resolved job payload ───────────────────────────────────────
    const updatedJob = await SR.entities.Job.get(job.id);
    const resolveRes = await resolveJobInternal(updatedJob, SR, membership);

    // Inform client if audit is pending (partial success, not false complete success)
    return Response.json({
      success: true,
      auditPending,
      override: savedOverride,
      resolvedJob: resolveRes,
    });

  } catch (error: any) {
    return Response.json({ error: 'An unexpected error occurred.', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

// ── Internal resolution helper ────────────────────────────────────────────────

async function resolveJobInternal(job: any, SR: any, membership: any): Promise<any> {
  const isCompanyAdmin = membership.role === 'general_manager' || membership.role === 'project_manager';
  const isProvisionedSOP = job.sourceType === 'essential_sop';

  const capabilities = {
    canEditContent:         isCompanyAdmin && !isProvisionedSOP,
    canCreateContent:       isCompanyAdmin && !isProvisionedSOP,
    canDeleteContent:       isCompanyAdmin && !isProvisionedSOP,
    canReorderContent:      isCompanyAdmin && !isProvisionedSOP,
    canChangeSectionStatus: isCompanyAdmin && !isProvisionedSOP,
    canEditJobMetadata:     isCompanyAdmin && !isProvisionedSOP,
    canCustomize:           isCompanyAdmin && isProvisionedSOP,
  };

  if (!isProvisionedSOP) {
    const [sections, rawContent] = await Promise.all([
      SR.entities.JobSection.filter({ jobId: job.id }, 'sortOrder', 10),
      SR.entities.SectionContent.filter({ jobId: job.id }, 'sortOrder', 500),
    ]);
    const content = (rawContent || []).filter((i: any) => i.sectionType !== 'documentation');
    const contentBySection: Record<string, any[]> = {};
    for (const item of content) {
      if (!contentBySection[item.sectionType]) contentBySection[item.sectionType] = [];
      contentBySection[item.sectionType].push(item);
    }
    return { job, sections: (sections || []).filter((s: any) => s.sectionType !== 'documentation'), contentBySection, capabilities };
  }

  // Provisioned SOP path with override merge using shared schema
  const version = await SR.entities.EssentialSOPVersion.get(job.sourceVersionId).catch(() => null);
  if (!version || version.status !== 'published') throw new Error('Source version not available');

  const masterSections = await SR.entities.EssentialSOPSection.filter(
    { masterId: job.sourceMasterId, versionId: job.sourceVersionId }, 'sortOrder', 10
  );

  const overrides = await SR.entities.JobOverride.filter({ companyId: job.companyId, jobId: job.id });
  const override: any = overrides?.[0] || null;

  // Sanitize stored override using shared schema
  let sanitizedOverrideData: any = null;
  if (override?.overrideData) {
    const { sanitized, warnings } = sanitizeStoredOverride(override.overrideData, job.id);
    if (warnings.length > 0) console.warn(warnings.join('\n'));
    sanitizedOverrideData = sanitized;
  }

  const sections = SECTION_DISPLAY_ORDER.map((st, i) => {
    const ms = (masterSections || []).find((s: any) => s.sectionType === st);
    if (!ms) return null;
    return { id: ms.id, jobId: job.id, companyId: job.companyId, sectionType: st, title: SECTION_TITLES[st] || st, sortOrder: i, completionStatus: 'Empty' };
  }).filter(Boolean);

  const contentBySection: Record<string, any[]> = {};
  for (const masterSection of (masterSections || [])) {
    const st = masterSection.sectionType;
    if (!st || !VALID_SECTION_TYPES.has(st)) continue;
    const sectionOverride = sanitizedOverrideData?.sectionOverrides?.[st] || null;
    const resolved = buildResolvedItems(masterSection.id, masterSection.contentItems || [], sectionOverride, job.id, job.companyId);
    contentBySection[st] = resolved.map(item => ({ ...item, sectionType: st }));
  }

  const resolvedTitle = sanitizedOverrideData?.title || job.title;
  const resolvedShortDescription = sanitizedOverrideData?.shortDescription || job.shortDescription;
  const { sourceMasterId: _sm, sourceVersionId: _sv, sourceType: _st, isCustomized: _ic,
          customizedAt: _ca, customizedBy: _cb, ...publicJobFields } = job;

  return {
    job: { ...publicJobFields, title: resolvedTitle, shortDescription: resolvedShortDescription },
    sections,
    contentBySection,
    capabilities,
    override: override ? { revision: override.revision, customizedFields: override.customizedFields, auditPending: override.auditPending } : null,
  };
}