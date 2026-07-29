import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * saveJobOverride — Centralized company customization save path.
 *
 * The ONLY authorized path for saving company overrides on provisioned Essential SOP Jobs.
 * React components must never write directly to JobOverride or trigger capability changes.
 *
 * Every save:
 *   1. Authenticates the calling user
 *   2. Derives company from backend (never trusts client-supplied companyId)
 *   3. Verifies active company membership with admin role
 *   4. Calls the validateJobMutation logic inline (same rules)
 *   5. Validates the override payload (allowed fields only, rejects unknowns)
 *   6. Validates revision for optimistic concurrency
 *   7. Validates mutationKey for idempotency
 *   8. Upserts one JobOverride (creates or updates)
 *   9. Increments revision exactly once per accepted save
 *  10. Creates an ActivityLog audit record
 *  11. Marks Job.isCustomized = true if this is the first override
 *  12. Returns updated resolveJob() payload so the frontend reflects the new state
 *
 * Request payload:
 *   {
 *     jobId: string,
 *     overrideData: {
 *       title?: string,
 *       shortDescription?: string,
 *       sectionOverrides?: { [sectionType]: contentItem[] }
 *     },
 *     expectedRevision: number,   // 0 if creating for the first time
 *     mutationKey: string         // client-generated UUID for idempotency
 *   }
 *
 * Response:
 *   { success: true, override: JobOverride, resolvedJob: resolveJob() payload }
 *   or { error: string, code: string } with appropriate HTTP status
 */

// Fields the company is allowed to override.
const ALLOWED_OVERRIDE_FIELDS = new Set(['title', 'shortDescription', 'sectionOverrides']);

// Section types that are valid in sectionOverrides.
const VALID_SECTION_TYPES = new Set(['tools', 'materials', 'scope', 'procedure', 'safety', 'quality']);

// Fields the company may set on each content item in sectionOverrides.
const ALLOWED_CONTENT_ITEM_FIELDS = new Set([
  'contentType', 'title', 'body', 'sortOrder', 'isRequired', 'isCritical', 'metadata'
]);

// System fields that must never be set by the client.
const FORBIDDEN_FIELDS = new Set([
  'id', 'companyId', 'jobId', 'sourceMasterId', 'sourceVersionId',
  'revision', 'mutationKey', 'lastMutationKey', 'createdByUserId',
  'lastModifiedByUserId', 'createdAt', 'updatedAt', 'created_date',
  'updated_date', 'created_by_id', 'sourceType', 'isCustomized',
  'customizedAt', 'customizedBy', 'capabilities',
]);

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);

    // ── 1. Authentication ────────────────────────────────────────────────────
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }, { status: 401 });

    // ── 2. Parse and validate request body ──────────────────────────────────
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
    if (!overrideData || typeof overrideData !== 'object') {
      return Response.json({ error: 'overrideData is required', code: 'INVALID_INPUT' }, { status: 400 });
    }

    // ── 3. Validate overrideData shape — reject unknown/forbidden fields ─────
    const providedKeys = Object.keys(overrideData);
    for (const key of providedKeys) {
      if (FORBIDDEN_FIELDS.has(key)) {
        return Response.json({ error: `Field '${key}' is not allowed in overrideData`, code: 'FORBIDDEN_FIELD' }, { status: 400 });
      }
      if (!ALLOWED_OVERRIDE_FIELDS.has(key)) {
        return Response.json({ error: `Unknown field '${key}' in overrideData`, code: 'UNKNOWN_FIELD' }, { status: 400 });
      }
    }
    if (overrideData.title !== undefined && typeof overrideData.title !== 'string') {
      return Response.json({ error: 'title must be a string', code: 'INVALID_INPUT' }, { status: 400 });
    }
    if (overrideData.shortDescription !== undefined && typeof overrideData.shortDescription !== 'string') {
      return Response.json({ error: 'shortDescription must be a string', code: 'INVALID_INPUT' }, { status: 400 });
    }
    if (overrideData.sectionOverrides !== undefined) {
      if (typeof overrideData.sectionOverrides !== 'object') {
        return Response.json({ error: 'sectionOverrides must be an object', code: 'INVALID_INPUT' }, { status: 400 });
      }
      for (const [sectionType, items] of Object.entries(overrideData.sectionOverrides)) {
        if (!VALID_SECTION_TYPES.has(sectionType)) {
          return Response.json({ error: `Invalid sectionType '${sectionType}'`, code: 'INVALID_SECTION_TYPE' }, { status: 400 });
        }
        if (!Array.isArray(items)) {
          return Response.json({ error: `sectionOverrides.${sectionType} must be an array`, code: 'INVALID_INPUT' }, { status: 400 });
        }
        for (const item of items as any[]) {
          for (const itemKey of Object.keys(item)) {
            if (!ALLOWED_CONTENT_ITEM_FIELDS.has(itemKey)) {
              return Response.json({ error: `Unknown field '${itemKey}' in content item`, code: 'UNKNOWN_FIELD' }, { status: 400 });
            }
          }
        }
      }
    }

    const SR = base44.asServiceRole;

    // ── 4. Load the Job (never trust client-supplied companyId) ──────────────
    let job: any;
    try { job = await SR.entities.Job.get(jobId); } catch (_) {}
    if (!job) return Response.json({ error: 'Job not found', code: 'NOT_FOUND' }, { status: 404 });

    // ── 5. Company membership check (server-derived) ─────────────────────────
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

    // ── 6. Job must be a provisioned Essential SOP ───────────────────────────
    if (job.sourceType !== 'essential_sop') {
      return Response.json({
        error: 'Only provisioned Essential SOP Jobs support the override system.',
        code: 'NOT_ESSENTIAL_SOP',
      }, { status: 409 });
    }

    // ── 7. Load existing override (if any) ──────────────────────────────────
    const existingOverrides = await SR.entities.JobOverride.filter({
      companyId: job.companyId,
      jobId: job.id,
    });
    const existingOverride: any = existingOverrides?.[0] || null;

    // ── 8. Idempotency check — reject resubmission of the same mutation key ──
    if (existingOverride && existingOverride.lastMutationKey === mutationKey) {
      // This exact mutation was already applied — return the current resolved state without modification.
      const resolveRes = await resolveJobInternal(job, SR, membership);
      return Response.json({ success: true, idempotent: true, override: existingOverride, resolvedJob: resolveRes });
    }

    // ── 9. Optimistic concurrency — validate expected revision ───────────────
    const currentRevision = existingOverride?.revision ?? 0;
    if (expectedRevision !== currentRevision) {
      return Response.json({
        error: 'Conflict: another change was made since you loaded this job. Reload and retry.',
        code: 'REVISION_CONFLICT',
        currentRevision,
      }, { status: 409 });
    }

    // ── 10. Compute customized fields list ───────────────────────────────────
    const customizedFields: string[] = [];
    if (overrideData.title) customizedFields.push('title');
    if (overrideData.shortDescription) customizedFields.push('shortDescription');
    if (overrideData.sectionOverrides) {
      for (const st of Object.keys(overrideData.sectionOverrides)) {
        customizedFields.push(`section:${st}`);
      }
    }

    const now = new Date().toISOString();
    const newRevision = currentRevision + 1;

    // ── 11. Upsert the override record ───────────────────────────────────────
    let savedOverride: any;
    if (existingOverride) {
      // Merge: preserve any existing sectionOverrides not touched in this save
      const mergedSectionOverrides = {
        ...(existingOverride.overrideData?.sectionOverrides || {}),
        ...(overrideData.sectionOverrides || {}),
      };
      const mergedOverrideData = {
        ...existingOverride.overrideData,
        ...overrideData,
        sectionOverrides: mergedSectionOverrides,
      };
      // Recompute customizedFields from merged state
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
        updatedAt: now,
      });
    } else {
      savedOverride = await SR.entities.JobOverride.create({
        companyId: job.companyId,
        jobId: job.id,
        sourceMasterId: job.sourceMasterId,
        sourceVersionId: job.sourceVersionId,
        overrideData,
        customizedFields,
        revision: newRevision,
        mutationKey,
        lastMutationKey: mutationKey,
        createdByUserId: user.id,
        lastModifiedByUserId: user.id,
        createdAt: now,
        updatedAt: now,
      });
    }

    // ── 12. Mark Job.isCustomized = true on first override ──────────────────
    if (!job.isCustomized) {
      await SR.entities.Job.update(job.id, {
        isCustomized: true,
        customizedAt: now,
        customizedBy: user.id,
      });
    }

    // ── 13. Write audit record ───────────────────────────────────────────────
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

    // ── 14. Return resolved job payload ──────────────────────────────────────
    const updatedJob = await SR.entities.Job.get(job.id);
    const resolveRes = await resolveJobInternal(updatedJob, SR, membership);

    return Response.json({ success: true, override: savedOverride, resolvedJob: resolveRes });

  } catch (error: any) {
    return Response.json({ error: 'An unexpected error occurred.', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

// ── Internal resolution helper (mirrors resolveJob logic, no HTTP round-trip) ─

const SECTION_DISPLAY_ORDER = ['tools', 'materials', 'scope', 'procedure', 'safety', 'quality'];
const SECTION_TITLES: Record<string, string> = {
  tools: 'Tools', materials: 'Materials', scope: 'Scope',
  procedure: 'Procedure', safety: 'Safety', quality: 'Quality Standards',
};

async function resolveJobInternal(job: any, SR: any, membership: any): Promise<any> {
  const isCompanyAdmin = membership.role === 'general_manager' || membership.role === 'project_manager';
  const isProvisionedSOP = job.sourceType === 'essential_sop';

  const capabilities = {
    canEditContent: isCompanyAdmin && !isProvisionedSOP,
    canCreateContent: isCompanyAdmin && !isProvisionedSOP,
    canDeleteContent: isCompanyAdmin && !isProvisionedSOP,
    canReorderContent: isCompanyAdmin && !isProvisionedSOP,
    canChangeSectionStatus: isCompanyAdmin && !isProvisionedSOP,
    canEditJobMetadata: isCompanyAdmin && !isProvisionedSOP,
    canCustomize: isCompanyAdmin && isProvisionedSOP,
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

  // Provisioned SOP path with override merge
  const versionId = job.sourceVersionId;
  const version = await SR.entities.EssentialSOPVersion.get(versionId).catch(() => null);
  if (!version || version.status !== 'published') {
    throw new Error('Source version not available');
  }
  const masterSections = await SR.entities.EssentialSOPSection.filter(
    { masterId: job.sourceMasterId, versionId }, 'sortOrder', 10
  );

  // Load company override (if exists)
  const overrides = await SR.entities.JobOverride.filter({ companyId: job.companyId, jobId: job.id });
  const override: any = overrides?.[0] || null;

  const sections = SECTION_DISPLAY_ORDER.map((st, i) => {
    const ms = (masterSections || []).find((s: any) => s.sectionType === st);
    if (!ms) return null;
    return { id: ms.id, jobId: job.id, companyId: job.companyId, sectionType: st, title: SECTION_TITLES[st] || st, sortOrder: i, completionStatus: 'Empty' };
  }).filter(Boolean);

  const contentBySection: Record<string, any[]> = {};
  for (const masterSection of (masterSections || [])) {
    const st = masterSection.sectionType;
    if (!st || st === 'documentation') continue;
    const sectionOverride = override?.overrideData?.sectionOverrides?.[st];
    const sourceItems = sectionOverride || masterSection.contentItems || [];
    contentBySection[st] = sourceItems.map((item: any, idx: number) => ({
      id: sectionOverride ? `override_${masterSection.id}_${idx}` : `${masterSection.id}_${idx}`,
      jobId: job.id,
      companyId: job.companyId,
      sectionId: masterSection.id,
      sectionType: st,
      contentType: item.contentType || 'text',
      title: item.title || '',
      body: item.body || '',
      sortOrder: item.sortOrder !== undefined ? item.sortOrder : idx,
      isRequired: item.isRequired !== undefined ? item.isRequired : false,
      isCritical: item.isCritical !== undefined ? item.isCritical : false,
      metadata: item.metadata || {},
    })).sort((a: any, b: any) => a.sortOrder - b.sortOrder);
  }

  const resolvedTitle = override?.overrideData?.title || job.title;
  const resolvedShortDescription = override?.overrideData?.shortDescription || job.shortDescription;
  const { sourceMasterId: _sm, sourceVersionId: _sv, sourceType: _st, isCustomized: _ic,
          customizedAt: _ca, customizedBy: _cb, ...publicJobFields } = job;

  return {
    job: { ...publicJobFields, title: resolvedTitle, shortDescription: resolvedShortDescription },
    sections,
    contentBySection,
    capabilities,
    override: override ? { revision: override.revision, customizedFields: override.customizedFields } : null,
  };
}