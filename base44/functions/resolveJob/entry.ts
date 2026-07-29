import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * resolveJob — Centralized Job resolver for the Essential SOP Master Library architecture.
 *
 * Returns one complete Job object in the same shape the frontend already expects.
 * The frontend does NOT need to know or care whether a Job came from the Essential SOP
 * Master Library or was created directly by the company.
 *
 * Request payload: { jobId: string }
 *
 * Response: { job, sections, contentBySection, capabilities }
 *   - job: Job record (companyId, title, trade, category, etc.)
 *   - sections: array of section descriptor objects ({ sectionType, title, sortOrder })
 *   - contentBySection: { [sectionType]: SectionContent[] }
 *   - capabilities: explicit action permissions the frontend must consume instead of
 *     inferring from job origin fields. The backend is the single source of truth.
 *     {
 *       canEditContent: boolean,
 *       canCreateContent: boolean,
 *       canDeleteContent: boolean,
 *       canReorderContent: boolean,
 *       canChangeSectionStatus: boolean,
 *       canEditJobMetadata: boolean
 *     }
 *
 * Resolution paths:
 *
 *   sourceType === 'company'  (Version 4.0 path — unchanged)
 *     → Load JobSection + SectionContent for the company Job.
 *     → Filter documentation sectionType (preserved from v4.0).
 *
 *   sourceType === 'essential_sop' AND isCustomized === false  (Version 4.1 path)
 *     → Load the pinned EssentialSOPVersion via job.sourceVersionId.
 *     → Load EssentialSOPSection records for that version.
 *     → Map EssentialSOPSection.contentItems → contentBySection.
 *     → Return the company Job's stable ID + company-facing fields.
 *     → Never expose draft content. Reject if version is not published.
 *
 *   Invalid / unavailable references:
 *     → Controlled 404 / 409 response. No stack traces.
 */

const SECTION_DISPLAY_ORDER = ['tools', 'materials', 'scope', 'procedure', 'safety', 'quality'];

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

    // ── Load the company Job ─────────────────────────────────────────────────
    let job: any;
    try {
      job = await SR.entities.Job.get(jobId);
    } catch (_) {
      return Response.json({ error: 'Job not found' }, { status: 404 });
    }
    if (!job) return Response.json({ error: 'Job not found' }, { status: 404 });

    // ── Company isolation check — user must belong to the same company ───────
    const memberships = await base44.entities.CompanyMembership.filter({
      userId: user.id,
      companyId: job.companyId,
      status: 'active',
    });
    if (!memberships || memberships.length === 0) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // ── Derive capabilities from membership role + job origin ────────────────
    // The backend is the single authority on what a user may do to this Job.
    // The frontend must consume these flags; it must NOT infer permissions from
    // job.sourceType, sourceMasterId, sourceVersionId, or isCustomized.
    const membership = memberships[0];
    const isCompanyAdmin = membership.role === 'general_manager' || membership.role === 'project_manager';
    const isProvisionedSOP = job.sourceType === 'essential_sop' && !job.isCustomized;

    const capabilities = {
      // Content mutation — fully blocked for provisioned SOPs regardless of role.
      // For company jobs, requires admin-level company role.
      canEditContent:         isCompanyAdmin && !isProvisionedSOP,
      canCreateContent:       isCompanyAdmin && !isProvisionedSOP,
      canDeleteContent:       isCompanyAdmin && !isProvisionedSOP,
      canReorderContent:      isCompanyAdmin && !isProvisionedSOP,
      // Section completion status lives on JobSection records which don't exist
      // for provisioned SOPs — always false for them.
      canChangeSectionStatus: isCompanyAdmin && !isProvisionedSOP,
      // Job-level metadata edits follow the same rule.
      canEditJobMetadata:     isCompanyAdmin && !isProvisionedSOP,
    };

    // ── Resolution: Essential SOP provisioned job (uncustomized) ────────────
    if (isProvisionedSOP) {
      return await resolveEssentialSOPJob(job, SR, capabilities);
    }

    // ── Resolution: Company-created job (Version 4.0 path, unchanged) ───────
    return await resolveCompanyJob(job, SR, capabilities);

  } catch (error: any) {
    return Response.json({ error: 'An unexpected error occurred.' }, { status: 500 });
  }
}

// ── Version 4.0 company-owned Job resolution (unchanged) ───────────────────

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

// ── Version 4.1 Essential SOP provisioned Job resolution ────────────────────
// Reads platform-owned section content from the pinned published version.
// Does NOT expose draft content. Does NOT silently switch versions.

async function resolveEssentialSOPJob(job: any, SR: any, capabilities: any): Promise<Response> {
  const versionId = job.sourceVersionId;
  if (!versionId) {
    return Response.json({ error: 'Provisioned job is missing a version reference.' }, { status: 409 });
  }

  // Load the pinned published version — reject drafts and unpublished content
  let version: any;
  try {
    version = await SR.entities.EssentialSOPVersion.get(versionId);
  } catch (_) {
    return Response.json({ error: 'Source version not found.' }, { status: 404 });
  }
  if (!version) return Response.json({ error: 'Source version not found.' }, { status: 404 });
  if (version.status !== 'published') {
    return Response.json({ error: 'Source version is not available.' }, { status: 409 });
  }

  // Load the sections for the pinned version
  const masterSections = await SR.entities.EssentialSOPSection.filter(
    { masterId: job.sourceMasterId, versionId },
    'sortOrder',
    10
  );

  const SECTION_TITLES: Record<string, string> = {
    tools: 'Tools',
    materials: 'Materials',
    scope: 'Scope',
    procedure: 'Procedure',
    safety: 'Safety',
    quality: 'Quality Standards',
  };

  // Build sections array in display order (mirrors JobSection shape for frontend compat)
  const sections = SECTION_DISPLAY_ORDER
    .map((st, i) => {
      const masterSection = (masterSections || []).find((s: any) => s.sectionType === st);
      if (!masterSection) return null;
      return {
        id: masterSection.id,
        jobId: job.id,
        companyId: job.companyId,
        sectionType: st,
        title: masterSection.title || SECTION_TITLES[st] || st,
        sortOrder: i,
        completionStatus: 'Empty', // read-only provisioned sections start empty
      };
    })
    .filter(Boolean);

  // Build contentBySection from EssentialSOPSection.contentItems
  // Each contentItem is shaped like a SectionContent record.
  // We re-map it to the same shape the frontend already expects.
  const contentBySection: Record<string, any[]> = {};
  for (const masterSection of (masterSections || [])) {
    const st = masterSection.sectionType;
    if (!st || st === 'documentation') continue;
    const items = (masterSection.contentItems || []).map((item: any, idx: number) => ({
      // Stable virtual ID using section + index (no company SectionContent records exist)
      id: `${masterSection.id}_${idx}`,
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
    }));
    items.sort((a: any, b: any) => a.sortOrder - b.sortOrder);
    contentBySection[st] = items;
  }

  // Return the company Job's stable identity + platform content.
  // Strip ALL internal platform-admin origin fields — the frontend must not use them
  // for permission inference. Capabilities object is the authoritative contract.
  const { sourceMasterId: _sm, sourceVersionId: _sv, sourceType: _st, isCustomized: _ic,
          customizedAt: _ca, customizedBy: _cb, ...publicJobFields } = job;

  return Response.json({ job: publicJobFields, sections, contentBySection, capabilities });
}