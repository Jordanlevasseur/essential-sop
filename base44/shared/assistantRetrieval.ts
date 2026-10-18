import {
  VALID_SECTION_TYPES,
  sanitizeStoredOverride,
  buildResolvedItems,
} from './overrideSchema.js';

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
 * Returns: { jobs: JobSummary[], contentIndex: ContentIndexEntry[] }
 *   - jobs: public job fields with resolved title
 *   - contentIndex: [{ jobId, sectionType, title, body }]
 */
export async function resolveAssistantContext(SR: any, companyId: string): Promise<{ jobs: any[]; contentIndex: any[] }> {
  const allJobs = await SR.entities.Job.filter({ companyId }, '-updated_date', 200);
  const publishedJobs = (allJobs || []).filter((j: any) => !j.isArchived && j.status === 'Published');
  const sopJobs = publishedJobs.filter((j: any) => j.sourceType === 'essential_sop');
  const companyJobs = publishedJobs.filter((j: any) => j.sourceType !== 'essential_sop');

  const allOverrides = await SR.entities.JobOverride.filter({ companyId }, '-updatedAt', 500);
  const overrideByJobId: Record<string, any> = {};
  for (const o of (allOverrides || [])) {
    if (!overrideByJobId[o.jobId]) overrideByJobId[o.jobId] = o;
  }

  const versionSectionCache: Record<string, any[]> = {};
  for (const job of sopJobs) {
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
  const contentByJobId: Record<string, any[]> = {};
  for (const c of (allContent || [])) {
    if (c.sectionType === 'documentation') continue;
    if (!contentByJobId[c.jobId]) contentByJobId[c.jobId] = [];
    contentByJobId[c.jobId].push(c);
  }

  const jobs: any[] = [];
  const contentIndex: any[] = [];

  for (const job of sopJobs) {
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
        contentIndex.push({ jobId: job.id, sectionType: st, title: item.title, body: item.body || '' });
      }
    }
  }

  for (const job of companyJobs) {
    jobs.push(job);
    const jobContent = contentByJobId[job.id] || [];
    for (const item of jobContent) {
      contentIndex.push({ jobId: job.id, sectionType: item.sectionType, title: item.title, body: item.body || '' });
    }
  }

  return { jobs, contentIndex };
}