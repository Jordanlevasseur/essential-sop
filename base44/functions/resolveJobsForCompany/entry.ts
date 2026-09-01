import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import {
  VALID_SECTION_TYPES,
  sanitizeStoredOverride,
  buildResolvedItems,
} from '../../shared/overrideSchema.js';

/**
 * resolveJobsForCompany — Resolver-backed Jobs list and search service.
 *
 * Replaces direct entity reads in Jobs.jsx. Returns all company-accessible Jobs
 * with overrides applied to provisioned Essential SOP Jobs so the list always
 * shows the company-resolved title and shortDescription.
 *
 * Request: { companyId: string, search?: string }
 * Response: { jobs: ResolvedJobSummary[], contentIndex: ContentIndexEntry[] }
 *
 * ResolvedJobSummary: same shape as a Job entity record but with override-resolved
 * title/shortDescription for essential_sop Jobs. Internal origin fields stripped.
 *
 * ContentIndex: flat array of { jobId, sectionType, title, body } for search.
 * For essential_sop Jobs: sourced from master+override content.
 * For company Jobs: sourced from SectionContent entities.
 *
 * Batching: all overrides and master sections loaded in bulk, not N+1 per job.
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
    const { companyId } = body;
    if (!companyId || typeof companyId !== 'string') {
      return Response.json({ error: 'companyId is required' }, { status: 400 });
    }

    const SR = base44.asServiceRole;

    // Verify the caller is an active member of this company
    const memberships = await base44.entities.CompanyMembership.filter({
      userId: user.id,
      companyId,
      status: 'active',
    });
    if (!memberships || memberships.length === 0) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    const membership = memberships[0];
    const isCompanyAdmin = membership.role === 'general_manager' || membership.role === 'project_manager';

    // Load all Jobs for this company
    const allJobs = await SR.entities.Job.filter({ companyId }, '-updated_date', 200);
    const publishedJobs = (allJobs || []).filter((j: any) => !j.isArchived && j.status === 'Published');

    const _rawSopJobs = publishedJobs.filter((j: any) => j.sourceType === 'essential_sop');
    const companyJobs = publishedJobs.filter((j: any) => j.sourceType !== 'essential_sop');

    // ── Defense-in-depth: drop SOP jobs whose source Master is gone or not active ──
    // The deletion cascade hard-deletes the master + archives derived jobs; this
    // resolver check is a second gate so an orphaned/derived job never reaches the
    // company. Requires an existing, active (published) source Master.
    const _sopMasterIds = Array.from(new Set(_rawSopJobs.map((j: any) => j.sourceMasterId).filter(Boolean)));
    const _masterCache: Record<string, any> = {};
    await Promise.all(_sopMasterIds.map(async (mid: string) => {
      try { _masterCache[mid] = await SR.entities.EssentialSOPMaster.get(mid); } catch { _masterCache[mid] = null; }
    }));
    const sopJobs = _rawSopJobs.filter((j: any) => {
      const m = j.sourceMasterId ? _masterCache[j.sourceMasterId] : null;
      return !!m && m.status === 'active';
    });

    // ── Batch load all overrides for this company ────────────────────────────
    const allOverrides = await SR.entities.JobOverride.filter({ companyId }, '-updatedAt', 500);
    const overrideByJobId: Record<string, any> = {};
    for (const o of (allOverrides || [])) {
      if (!overrideByJobId[o.jobId]) overrideByJobId[o.jobId] = o;
    }

    // ── Batch load master sections for all SOP Jobs ──────────────────────────
    // Group SOP jobs by their (masterId, versionId) pair to avoid repeated fetches
    const versionSectionCache: Record<string, any[]> = {};
    const versionStatusCache: Record<string, boolean> = {};

    for (const job of sopJobs) {
      const vk = `${job.sourceMasterId}__${job.sourceVersionId}`;
      if (versionSectionCache[vk] !== undefined) continue;
      try {
        const version = await SR.entities.EssentialSOPVersion.get(job.sourceVersionId);
        if (!version || version.status !== 'published') {
          versionStatusCache[vk] = false;
          versionSectionCache[vk] = [];
          continue;
        }
        versionStatusCache[vk] = true;
        const sections = await SR.entities.EssentialSOPSection.filter(
          { masterId: job.sourceMasterId, versionId: job.sourceVersionId }, 'sortOrder', 10
        );
        versionSectionCache[vk] = sections || [];
      } catch {
        versionSectionCache[vk] = [];
        versionStatusCache[vk] = false;
      }
    }

    // ── Batch load SectionContent for company-owned Jobs ─────────────────────
    const allContent = await SR.entities.SectionContent.filter({ companyId }, 'sortOrder', 2000);
    const contentByJobId: Record<string, any[]> = {};
    for (const c of (allContent || [])) {
      if (c.sectionType === 'documentation') continue;
      if (!contentByJobId[c.jobId]) contentByJobId[c.jobId] = [];
      contentByJobId[c.jobId].push(c);
    }

    // ── Build resolved job list + content index ──────────────────────────────
    const resolvedJobs: any[] = [];
    const contentIndex: any[] = [];

    // Capabilities template
    const makeCaps = (isEssential: boolean) => ({
      canEditContent:         isCompanyAdmin && !isEssential,
      canCreateContent:       isCompanyAdmin && !isEssential,
      canDeleteContent:       isCompanyAdmin && !isEssential,
      canReorderContent:      isCompanyAdmin && !isEssential,
      canChangeSectionStatus: isCompanyAdmin && !isEssential,
      canEditJobMetadata:     isCompanyAdmin && !isEssential,
      canCustomize:           isCompanyAdmin && isEssential,
    });

    // Process Essential SOP Jobs
    for (const job of sopJobs) {
      const vk = `${job.sourceMasterId}__${job.sourceVersionId}`;
      const masterSections = versionSectionCache[vk] || [];
      const override = overrideByJobId[job.id] || null;

      // Sanitize stored override using shared schema
      let sanitizedOverrideData: any = null;
      if (override?.overrideData) {
        const { sanitized, warnings } = sanitizeStoredOverride(override.overrideData, job.id);
        if (warnings.length > 0) console.warn(warnings.join('\n'));
        sanitizedOverrideData = sanitized;
      }

      const resolvedTitle = sanitizedOverrideData?.title || job.title;
      const resolvedShortDescription = sanitizedOverrideData?.shortDescription || job.shortDescription;

      // Strip internal fields
      const { sourceMasterId: _a, sourceVersionId: _b, sourceType: _c, isCustomized: _d,
              customizedAt: _e, customizedBy: _f, ...publicFields } = job;

      resolvedJobs.push({
        ...publicFields,
        title: resolvedTitle,
        shortDescription: resolvedShortDescription,
        _resolvedFrom: 'essential_sop',
        capabilities: makeCaps(true),
        overrideMeta: override ? { revision: override.revision, customizedFields: override.customizedFields } : null,
      });

      // Content index: include both master and override content for search
      for (const ms of masterSections) {
        const st = ms.sectionType;
        if (!VALID_SECTION_TYPES.has(st)) continue;
        const sectionOverride = sanitizedOverrideData?.sectionOverrides?.[st];
        const sourceItems = sectionOverride || ms.contentItems || [];
        const resolved = buildResolvedItems(ms.id, ms.contentItems || [], sectionOverride || null, job.id, companyId);
        for (const item of resolved) {
          contentIndex.push({ jobId: job.id, sectionType: st, title: item.title, body: item.body || '' });
        }
      }
    }

    // Process company-owned Jobs (unchanged path)
    for (const job of companyJobs) {
      resolvedJobs.push({
        ...job,
        _resolvedFrom: 'company',
        capabilities: makeCaps(false),
        overrideMeta: null,
      });

      const jobContent = contentByJobId[job.id] || [];
      for (const item of jobContent) {
        contentIndex.push({ jobId: job.id, sectionType: item.sectionType, title: item.title, body: item.body || '' });
      }
    }

    return Response.json({ jobs: resolvedJobs, contentIndex });

  } catch (error: any) {
    return Response.json({ error: 'An unexpected error occurred.' }, { status: 500 });
  }
}