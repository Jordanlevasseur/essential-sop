import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import {
  sanitizeStoredOverride,
  buildResolvedItems,
  VALID_SECTION_TYPES,
} from '../../shared/overrideSchema.js';
import { isMasterAssignedActive } from '../../shared/activeCompanyContent.ts';

/**
 * resolveJob — Centralized Job resolver for the Essential SOP Master Library architecture.
 *
 * Uses the shared overrideSchema for all validation and ID generation,
 * ensuring identical behavior between save (saveJobOverride) and resolve paths.
 *
 * Request payload: { jobId: string }
 * Response: { job, sections, contentBySection, capabilities, override }
 */

const SECTION_DISPLAY_ORDER = ['tools', 'materials', 'scope', 'procedure', 'safety', 'quality'];
const SECTION_TITLES: Record<string, string> = {
  tools: 'Tools', materials: 'Materials', scope: 'Scope',
  procedure: 'Procedure', safety: 'Safety', quality: 'Quality Standards',
};

export default async function(req: Request): Promise<Response> {
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

    let job: any;
    try { job = await SR.entities.Job.get(jobId); } catch (_) {}
    if (!job) return Response.json({ error: 'Job not found' }, { status: 404 });

    // Company isolation check
    const memberships = await base44.entities.CompanyMembership.filter({
      userId: user.id,
      companyId: job.companyId,
      status: 'active',
    });
    if (!memberships || memberships.length === 0) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const membership = memberships[0];
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
      return await resolveCompanyJob(job, SR, capabilities);
    }
    return await resolveEssentialSOPJob(job, SR, capabilities);

  } catch (error: any) {
    return Response.json({ error: 'An unexpected error occurred.' }, { status: 500 });
  }
}

async function resolveCompanyJob(job: any, SR: any, capabilities: any): Promise<Response> {
  const [sections, rawContent] = await Promise.all([
    SR.entities.JobSection.filter({ jobId: job.id }, 'sortOrder', 10),
    SR.entities.SectionContent.filter({ jobId: job.id }, 'sortOrder', 500),
  ]);
  const content = (rawContent || []).filter((item: any) => item.sectionType !== 'documentation');
  const contentBySection: Record<string, any[]> = {};
  for (const item of content) {
    if (!contentBySection[item.sectionType]) contentBySection[item.sectionType] = [];
    contentBySection[item.sectionType].push(item);
  }
  for (const key of Object.keys(contentBySection)) {
    contentBySection[key].sort((a: any, b: any) => a.sortOrder - b.sortOrder);
  }
  return Response.json({
    job,
    sections: (sections || []).filter((s: any) => s.sectionType !== 'documentation'),
    contentBySection,
    capabilities,
  });
}

async function resolveEssentialSOPJob(job: any, SR: any, capabilities: any): Promise<Response> {
  const versionId = job.sourceVersionId;
  if (!versionId) {
    return Response.json({ error: 'Provisioned job is missing a version reference.' }, { status: 409 });
  }

  let version: any;
  try { version = await SR.entities.EssentialSOPVersion.get(versionId); } catch (_) {}
  if (!version) return Response.json({ error: 'Source version not found.' }, { status: 404 });
  if (version.status !== 'published') {
    return Response.json({ error: 'Source version is not available.' }, { status: 409 });
  }

  // ── Defense-in-depth: require an existing, active source Master ─────────────
  // Deletion cascade hard-deletes the master; this gate blocks any orphaned
  // derived job (and any job whose master was archived) from being opened.
  let sourceMaster: any = null;
  if (job.sourceMasterId) {
    try { sourceMaster = await SR.entities.EssentialSOPMaster.get(job.sourceMasterId); } catch (_) {}
  }
  if (!sourceMaster || sourceMaster.status !== 'active') {
    return Response.json({ error: 'This job is no longer available.', code: 'SOURCE_MASTER_UNAVAILABLE' }, { status: 410 });
  }

  // ── Phase 5: require an ACTIVE platform assignment for this company ────────
  // A platform-unassigned Master (assignmentStatus REMOVED) must NOT remain
  // accessible as an active company procedure via a stale deep link, even if
  // the adopted published Job still exists. Return a controlled unavailable
  // response instead of leaking the SOP content. Company data (Job, overrides,
  // history) is preserved — only visibility is revoked. See activeCompanyContent.ts.
  const assignmentActive = await isMasterAssignedActive(SR, job.companyId, job.sourceMasterId);
  if (!assignmentActive) {
    return Response.json({ error: 'This procedure is no longer available to your company.', code: 'ASSIGNMENT_REVOKED' }, { status: 410 });
  }

  const masterSections = await SR.entities.EssentialSOPSection.filter(
    { masterId: job.sourceMasterId, versionId }, 'sortOrder', 10
  );

  // Load and sanitize company override using shared schema
  const overrides = await SR.entities.JobOverride.filter({ companyId: job.companyId, jobId: job.id });
  const override: any = overrides?.[0] || null;

  // ── Adoption-incomplete guard ──────────────────────────────────────────────
  // If the three-step write sequence was interrupted between Step 1 and Step 3,
  // the override carries rebaseIncomplete=true. The Job's version pin may or may
  // not have been written. Serving content here would risk mixing override data
  // from the new version with master sections from the old version (or vice versa).
  // Block resolution and instruct the caller to retry the adoption with the same
  // mutationKey — the engine will route to the correct recovery step.
  if (override?.rebaseIncomplete === true) {
    const pendingTarget = override.pendingTargetVersionId || null;
    const jobAlreadyPinned = pendingTarget && job.sourceVersionId === pendingTarget;
    return Response.json({
      error: 'This job has a pending version adoption that did not complete. Retry adoptVersionFromAnalysis with the original mutationKey to recover.',
      code: 'ADOPTION_INCOMPLETE',
      recoverable: true,
      // Server-authoritative recovery identifiers — read by VersionAdoptionIncomplete
      lastAdoptionMutationKey: override.lastAdoptionMutationKey || null,
      pendingAnalysisId: override.pendingAnalysisId || null,
      pendingTargetVersionId: pendingTarget,
      // jobAlreadyPinned tells the client which recovery step is needed:
      // true  → only Step 3 (clear marker) is needed
      // false → Step 2 (pin job) + Step 3 are needed
      jobAlreadyPinned,
    }, { status: 409 });
  }

  let sanitizedOverrideData: any = null;
  if (override?.overrideData) {
    const { sanitized, warnings } = sanitizeStoredOverride(override.overrideData, job.id);
    if (warnings.length > 0) console.warn(warnings.join('\n'));
    sanitizedOverrideData = sanitized;
  }

  // Build sections using shared ID generation
  const sections = SECTION_DISPLAY_ORDER
    .map((st, i) => {
      const ms = (masterSections || []).find((s: any) => s.sectionType === st);
      if (!ms) return null;
      return { id: ms.id, jobId: job.id, companyId: job.companyId, sectionType: st,
               title: ms.title || SECTION_TITLES[st] || st, sortOrder: i, completionStatus: 'Empty' };
    })
    .filter(Boolean);

  // Build contentBySection using shared buildResolvedItems (stable IDs)
  const contentBySection: Record<string, any[]> = {};
  for (const masterSection of (masterSections || [])) {
    const st = masterSection.sectionType;
    if (!st || !VALID_SECTION_TYPES.has(st)) continue;
    const sectionOverride = sanitizedOverrideData?.sectionOverrides?.[st] || null;
    const resolved = buildResolvedItems(masterSection.id, masterSection.contentItems || [], sectionOverride, job.id, job.companyId);
    contentBySection[st] = resolved.map(item => ({ ...item, sectionType: st }));
  }

  // Override-resolved title/shortDescription — Job entity fields are NEVER modified
  const resolvedTitle = sanitizedOverrideData?.title || job.title;
  const resolvedShortDescription = sanitizedOverrideData?.shortDescription || job.shortDescription;

  // Strip internal platform-admin origin fields
  const { sourceMasterId: _sm, sourceVersionId: _sv, sourceType: _st, isCustomized: _ic,
          customizedAt: _ca, customizedBy: _cb, ...publicJobFields } = job;

  const overrideMeta = override
    ? { revision: override.revision, customizedFields: override.customizedFields, auditPending: override.auditPending || false }
    : null;

  return Response.json({
    job: { ...publicJobFields, title: resolvedTitle, shortDescription: resolvedShortDescription },
    sections,
    contentBySection,
    capabilities,
    override: overrideMeta,
  });
}