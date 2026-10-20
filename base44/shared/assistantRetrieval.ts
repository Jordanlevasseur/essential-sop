import {
  VALID_SECTION_TYPES,
  sanitizeStoredOverride,
  buildResolvedItems,
} from './overrideSchema.js';
import { loadActiveAssignmentMasterIds } from './activeCompanyContent.ts';

/**
 * resolveAssistantContext — shared retrieval for the Assistant.
 *
 * Loads all PUBLISHED, non-archived Jobs for a company and builds a resolved
 * content index that merges provisioned Essential SOP master/version content
 * with any company overrides. Company-owned Jobs are included directly.
 *
 * This is the single retrieval routine reused by both the
 * `resolveJobsForAssistant` resolver and the `askAssistant` AI assistant so
 * retrieval logic is never duplicated. The caller is responsible for
 * authorization (active company membership) before calling.
 *
 * Returns: { jobs, contentIndex, resources, metrics }
 *   - jobs: public job fields with resolved title
 *   - contentIndex: [{ jobId, sectionType, itemId, contentType, title, body,
 *       sortOrder, isRequired, isCritical, metadata }]
 *   - resources: [{ id, jobId, title, url, resourceType, description, displayOrder }]
 *     filtered to eligible Jobs only
 *   - metrics: { eligibleJobCount, contentItemCount, resourceCount,
 *       retrievalDurationMs, complete, limits, errors }
 */
export async function resolveAssistantContext(SR: any, companyId: string): Promise<{ jobs: any[]; contentIndex: any[]; resources: any[]; metrics: any }> {
  const _startTime = Date.now();
  const _errors: string[] = [];

  // Query-limit detection: the backend SDK (0.8.40) returns arrays for both
  // filter forms — there is no has_more flag. We detect potential incompleteness
  // by checking if the returned array length equals the limit, surfacing it in
  // metrics so callers never silently claim an SOP does not exist when
  // qualifying records may have been omitted.
  const allJobs = await SR.entities.Job.filter({ companyId }, '-updated_date', 200);
  const _jobsHasMore = (allJobs || []).length >= 200;
  if (_jobsHasMore) _errors.push('Job query limit (200) reached — some company Jobs may be omitted.');
  const publishedJobs = (allJobs || []).filter((j: any) => !j.isArchived && j.status === 'Published');
  const sopJobs = publishedJobs.filter((j: any) => j.sourceType === 'essential_sop');
  const companyJobs = publishedJobs.filter((j: any) => j.sourceType !== 'essential_sop');

  // ── Phase 5: filter sopJobs to active-company-content eligible ───────────────
  // An essential_sop Job is active company content ONLY if its platform
  // assignment is ACTIVE and its source Master is active. This excludes
  // platform-unassigned Masters (even with an adopted published Job) and
  // orphaned jobs whose Master was deleted/archived. This is the EXCLUSIVE
  // source for the AI Assistant — there is no Master Library fallback.
  // See activeCompanyContent.ts for the authoritative rule.
  const activeMasterIds = await loadActiveAssignmentMasterIds(SR, companyId);
  const _masterIds = Array.from(new Set(sopJobs.map((j: any) => j.sourceMasterId).filter(Boolean)));
  const _masterCache: Record<string, any> = {};
  await Promise.all(_masterIds.map(async (mid: string) => {
    try { _masterCache[mid] = await SR.entities.EssentialSOPMaster.get(mid); } catch { _masterCache[mid] = null; }
  }));
  const eligibleSopJobs = sopJobs.filter((j: any) => {
    if (!j.sourceMasterId || !activeMasterIds.has(j.sourceMasterId)) return false;
    const m = _masterCache[j.sourceMasterId];
    return !!m && m.status === 'active';
  });

  const allOverrides = await SR.entities.JobOverride.filter({ companyId }, '-updatedAt', 500);
  const _overridesHasMore = (allOverrides || []).length >= 500;
  if (_overridesHasMore) _errors.push('JobOverride query limit (500) reached — some overrides may be omitted.');
  const overrideByJobId: Record<string, any> = {};
  for (const o of (allOverrides || [])) {
    if (!overrideByJobId[o.jobId]) overrideByJobId[o.jobId] = o;
  }

  const versionSectionCache: Record<string, any[]> = {};
  for (const job of eligibleSopJobs) {
    const vk = `${job.sourceMasterId}__${job.sourceVersionId}`;
    if (versionSectionCache[vk] !== undefined) continue;
    try {
      const version = await SR.entities.EssentialSOPVersion.get(job.sourceVersionId);
      if (!version || version.status !== 'published') { versionSectionCache[vk] = []; continue; }
      const sections = await SR.entities.EssentialSOPSection.filter(
        { masterId: job.sourceMasterId, versionId: job.sourceVersionId }, 'sortOrder', 10
      );
      versionSectionCache[vk] = sections || [];
    } catch { versionSectionCache[vk] = []; }
  }

  const allContent = await SR.entities.SectionContent.filter({ companyId }, 'sortOrder', 2000);
  const _contentHasMore = (allContent || []).length >= 2000;
  if (_contentHasMore) _errors.push('SectionContent query limit (2000) reached — some content items may be omitted.');
  const contentByJobId: Record<string, any[]> = {};
  for (const c of (allContent || [])) {
    if (c.sectionType === 'documentation') continue;
    if (!contentByJobId[c.jobId]) contentByJobId[c.jobId] = [];
    contentByJobId[c.jobId].push(c);
  }

  const jobs: any[] = [];
  const contentIndex: any[] = [];

  for (const job of eligibleSopJobs) {
    const vk = `${job.sourceMasterId}__${job.sourceVersionId}`;
    const masterSections = versionSectionCache[vk] || [];
    const override = overrideByJobId[job.id] || null;

    let sanitizedOverrideData: any = null;
    if (override?.overrideData) {
      const { sanitized, warnings } = sanitizeStoredOverride(override.overrideData, job.id);
      if (warnings.length > 0) console.warn(warnings.join('\n'));
      sanitizedOverrideData = sanitized;
    }

    const resolvedTitle = sanitizedOverrideData?.title || job.title;
    const { sourceMasterId: _a, sourceVersionId: _b, sourceType: _c,
            isCustomized: _d, customizedAt: _e, customizedBy: _f, ...publicFields } = job;

    jobs.push({ ...publicFields, title: resolvedTitle });

    for (const ms of masterSections) {
      const st = ms.sectionType;
      if (!VALID_SECTION_TYPES.has(st)) continue;
      const sectionOverride = sanitizedOverrideData?.sectionOverrides?.[st] || null;
      const resolved = buildResolvedItems(ms.id, ms.contentItems || [], sectionOverride, job.id, companyId);
      for (const item of resolved) {
        contentIndex.push({
          jobId: job.id,
          sectionType: st,
          itemId: item.id,
          contentType: item.contentType || 'text',
          title: item.title,
          body: item.body || '',
          sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : 0,
          isRequired: !!item.isRequired,
          isCritical: !!item.isCritical,
          metadata: (item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)) ? item.metadata : {},
        });
      }
    }
  }

  for (const job of companyJobs) {
    jobs.push(job);
    const jobContent = contentByJobId[job.id] || [];
    for (const item of jobContent) {
      contentIndex.push({
        jobId: job.id,
        sectionType: item.sectionType,
        itemId: item.id,
        contentType: item.contentType || 'text',
        title: item.title,
        body: item.body || '',
        sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : 0,
        isRequired: !!item.isRequired,
        isCritical: !!item.isCritical,
        metadata: (item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)) ? item.metadata : {},
      });
    }
  }

  // ── Company Resources: bulk-load, filter to eligible Jobs only ────────────
  // Resources are metadata references (title, URL, type, description). They
  // are never ingested as procedural content. Only resources attached to
  // currently-eligible Jobs are included — mirroring the visibility gates in
  // resolveJob and verifyResourceJobAccess. No external URL content is fetched.
  const eligibleJobIds = new Set<string>();
  for (const j of eligibleSopJobs) eligibleJobIds.add(j.id);
  for (const j of companyJobs) eligibleJobIds.add(j.id);

  let resources: any[] = [];
  let _resourcesHasMore = false;
  try {
    const allResources = await SR.entities.CompanyResource.filter(
      { companyId }, 'displayOrder', 200
    );
    _resourcesHasMore = (allResources || []).length >= 200;
    if (_resourcesHasMore) _errors.push('CompanyResource query limit (200) reached — some resources may be omitted.');
    resources = (allResources || [])
      .filter((r: any) => eligibleJobIds.has(r.jobId))
      .map((r: any) => ({
        id: r.id,
        jobId: r.jobId,
        title: r.title || '',
        url: r.url || '',
        resourceType: r.resourceType || 'other',
        description: r.description || '',
        displayOrder: typeof r.displayOrder === 'number' ? r.displayOrder : 0,
      }));
  } catch (_) {
    _errors.push('CompanyResource retrieval failed — resources omitted.');
  }

  const _complete = !_jobsHasMore && !_contentHasMore && !_overridesHasMore && !_resourcesHasMore;

  const metrics = {
    eligibleJobCount: jobs.length,
    contentItemCount: contentIndex.length,
    resourceCount: resources.length,
    retrievalDurationMs: Date.now() - _startTime,
    complete: _complete,
    limits: {
      jobs: _jobsHasMore,
      content: _contentHasMore,
      overrides: _overridesHasMore,
      resources: _resourcesHasMore,
    },
    errors: _errors,
  };

  return { jobs, contentIndex, resources, metrics };
}