import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import {
  VALID_SECTION_TYPES,
  sanitizeStoredOverride,
  buildResolvedItems,
} from '../../shared/overrideSchema.js';

/**
 * resolveJobsForAssistant — Resolver-backed search service for the Assistant.
 *
 * Replaces direct entity reads in Assistant.jsx.
 * Returns company Jobs + resolved content for search — including provisioned
 * Essential SOP content merged with company overrides.
 *
 * Request: { companyId: string }
 * Response: { jobs: JobSummary[], contentIndex: ContentIndexEntry[] }
 *
 * This is intentionally identical in structure to resolveJobsForCompany so both
 * consumers share the same resolved data shape without duplicating merge logic.
 */

const SECTION_DISPLAY_ORDER = ['tools', 'materials', 'scope', 'procedure', 'safety', 'quality'];

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { companyId } = body;
    if (!companyId || typeof companyId !== 'string') {
      return Response.json({ error: 'companyId is required' }, { status: 400 });
    }

    const SR = base44.asServiceRole;

    // Verify caller is an active member of this company
    const memberships = await base44.entities.CompanyMembership.filter({
      userId: user.id,
      companyId,
      status: 'active',
    });
    if (!memberships || memberships.length === 0) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Load all published, non-archived Jobs for this company
    const allJobs = await SR.entities.Job.filter({ companyId }, '-updated_date', 200);
    const publishedJobs = (allJobs || []).filter((j: any) => !j.isArchived && j.status === 'Published');

    const sopJobs = publishedJobs.filter((j: any) => j.sourceType === 'essential_sop');
    const companyJobs = publishedJobs.filter((j: any) => j.sourceType !== 'essential_sop');

    // Batch load all overrides for this company
    const allOverrides = await SR.entities.JobOverride.filter({ companyId }, '-updatedAt', 500);
    const overrideByJobId: Record<string, any> = {};
    for (const o of (allOverrides || [])) {
      if (!overrideByJobId[o.jobId]) overrideByJobId[o.jobId] = o;
    }

    // Batch load master sections per unique (masterId, versionId)
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

    // Batch load SectionContent for company-owned Jobs
    const allContent = await SR.entities.SectionContent.filter({ companyId }, 'sortOrder', 2000);
    const contentByJobId: Record<string, any[]> = {};
    for (const c of (allContent || [])) {
      if (c.sectionType === 'documentation') continue;
      if (!contentByJobId[c.jobId]) contentByJobId[c.jobId] = [];
      contentByJobId[c.jobId].push(c);
    }

    const jobs: any[] = [];
    const contentIndex: any[] = [];

    // Resolved SOP Jobs
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

    // Company-owned Jobs
    for (const job of companyJobs) {
      jobs.push(job);
      const jobContent = contentByJobId[job.id] || [];
      for (const item of jobContent) {
        contentIndex.push({ jobId: job.id, sectionType: item.sectionType, title: item.title, body: item.body || '' });
      }
    }

    return Response.json({ jobs, contentIndex });

  } catch (error: any) {
    return Response.json({ error: 'An unexpected error occurred.' }, { status: 500 });
  }
}