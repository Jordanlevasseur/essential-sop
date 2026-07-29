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
 * Response: { job, sections, contentBySection }
 *   - job: Job record (sourceType / sourceMasterId / sourceVersionId hidden fields included
 *          for platform-admin use; safe to pass through — frontend ignores unknown fields)
 *   - sections: JobSection[]
 *   - contentBySection: { [sectionType]: SectionContent[] }
 *
 * Resolution logic (v4.1 foundation — future edits extend this):
 *   1. Load the company Job record.
 *   2. If sourceType === 'essential_sop' AND isCustomized === false:
 *      → In a future edit: load content from EssentialSOPSection instead of SectionContent.
 *      → For now: fall through to company content (no Essential SOP content exists yet).
 *   3. Load JobSection + SectionContent for the company Job.
 *   4. Filter out documentation sectionType (preserved from v4.0).
 *   5. Return the resolved Job object.
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { jobId } = body;
    if (!jobId || typeof jobId !== 'string') {
      return Response.json({ error: 'jobId is required' }, { status: 400 });
    }

    // Load the company Job
    const job = await base44.entities.Job.get(jobId);
    if (!job) return Response.json({ error: 'Job not found' }, { status: 404 });

    // Company isolation check — user must belong to the same company
    const memberships = await base44.entities.CompanyMembership.filter({
      userId: user.id,
      companyId: job.companyId,
      status: 'active',
    });
    if (!memberships || memberships.length === 0) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Load sections and content (v4.0-compatible path)
    const [sections, rawContent] = await Promise.all([
      base44.entities.JobSection.filter({ jobId }, 'sortOrder', 10),
      base44.entities.SectionContent.filter({ jobId }, 'sortOrder', 500),
    ]);

    // Filter documentation — preserved from v4.0
    const content = (rawContent || []).filter((item: any) => item.sectionType !== 'documentation');

    // Build contentBySection map
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
    });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}