/**
 * saveSectionContent — Authorized company SectionContent mutations.
 *
 * Replaces direct frontend SectionContent.create / update / delete / bulkCreate
 * / deleteMany calls from JobDetail.jsx and SectionDetail.jsx, consolidating
 * the validateJobMutation + direct-write two-step pattern into a single
 * atomic backend operation.
 *
 * Actions:
 *   "create"          — Create a new content item in a section.
 *   "update"          — Update an existing content item.
 *   "delete"          — Delete a content item.
 *   "duplicate"       — Duplicate a content item.
 *   "reorder"         — Reorder items in a section (takes orderedIds).
 *   "replace_section" — Replace all items in a section (AI regenerate).
 *
 * Authorization (server-side, on EVERY call):
 *   - Authenticated user with an ACTIVE CompanyMembership for the job's company.
 *   - Role MUST be general_manager or project_manager.
 *   - The Job must belong to the caller's company and must NOT be a provisioned
 *     Essential SOP (sourceType === 'essential_sop'). Legacy Jobs with unset
 *     sourceType are treated as company-owned.
 *   - For update/delete/duplicate: the content item must belong to the
 *     specified jobId (parent-child verification).
 *   - For reorder: every ID in orderedIds must belong to the job+section.
 *
 * Payload fields are whitelisted: companyId, sectionId, jobId, sectionType
 * are derived server-side from the job — never accepted from the client.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { getActiveMembership, isCompanyAdminRole } from '../../shared/companyAuth.ts';

const ALLOWED_CONTENT_FIELDS = [
  'contentType', 'title', 'body', 'isRequired', 'isCritical', 'metadata',
];

function sanitizeContentData(raw: any): any {
  const out: any = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const k of ALLOWED_CONTENT_FIELDS) {
    if (raw[k] !== undefined) out[k] = raw[k];
  }
  return out;
}

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { action, jobId, sectionType, contentId, data, orderedIds, items } = body;

    if (!action || !jobId || !sectionType) {
      return Response.json({ error: 'action, jobId, and sectionType are required' }, { status: 400 });
    }

    const SR = base44.asServiceRole;

    // ── Load the Job ─────────────────────────────────────────────────────────
    const job = await SR.entities.Job.get(jobId).catch(() => null);
    if (!job) return Response.json({ error: 'Job not found' }, { status: 404 });

    // ── Authorization: active membership + GM/PM role ───────────────────────
    const membership = await getActiveMembership(base44, user.id, job.companyId);
    if (!membership) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!isCompanyAdminRole(membership.role)) {
      return Response.json({ error: 'Insufficient role to modify job content' }, { status: 403 });
    }

    // ── Provisioned SOP guard ────────────────────────────────────────────────
    if (job.sourceType === 'essential_sop') {
      return Response.json({
        error: 'Essential SOP jobs must be customized through the override system, not through direct content writes.',
      }, { status: 403 });
    }

    // ── Verify section exists for this job+sectionType ───────────────────────
    const sections = await SR.entities.JobSection.filter({ jobId, sectionType });
    const section = (sections || [])[0];
    if (!section) return Response.json({ error: 'Section not found for this job' }, { status: 404 });

    // ── Helper: verify a content item belongs to this job ────────────────────
    const verifyContentBelongsToJob = async (cid: string) => {
      const existing = await SR.entities.SectionContent.get(cid).catch(() => null);
      if (!existing || existing.jobId !== jobId) return null;
      return existing;
    };

    // ── Dispatch ────────────────────────────────────────────────────────────
    switch (action) {
      case 'create': {
        const existing = await SR.entities.SectionContent.filter({ jobId, sectionType }, 'sortOrder', 500);
        const created = await SR.entities.SectionContent.create({
          ...sanitizeContentData(data),
          companyId: job.companyId,
          sectionId: section.id,
          jobId,
          sectionType,
          sortOrder: (existing || []).length,
        });
        return Response.json({ item: created });
      }

      case 'update': {
        if (!contentId) return Response.json({ error: 'contentId is required' }, { status: 400 });
        const existing = await verifyContentBelongsToJob(contentId);
        if (!existing) return Response.json({ error: 'Content not found in this job' }, { status: 404 });
        const updated = await SR.entities.SectionContent.update(contentId, sanitizeContentData(data));
        return Response.json({ item: updated });
      }

      case 'delete': {
        if (!contentId) return Response.json({ error: 'contentId is required' }, { status: 400 });
        const existing = await verifyContentBelongsToJob(contentId);
        if (!existing) return Response.json({ error: 'Content not found in this job' }, { status: 404 });
        await SR.entities.SectionContent.delete(contentId);
        return Response.json({ success: true });
      }

      case 'duplicate': {
        if (!contentId) return Response.json({ error: 'contentId is required' }, { status: 400 });
        const existing = await verifyContentBelongsToJob(contentId);
        if (!existing) return Response.json({ error: 'Content not found in this job' }, { status: 404 });
        const all = await SR.entities.SectionContent.filter({ jobId, sectionType }, 'sortOrder', 500);
        const { id, created_date, updated_date, created_by_id, ...rest } = existing;
        const created = await SR.entities.SectionContent.create({
          ...rest,
          title: `${existing.title} (Copy)`,
          sortOrder: (all || []).length,
        });
        return Response.json({ item: created });
      }

      case 'reorder': {
        if (!Array.isArray(orderedIds)) {
          return Response.json({ error: 'orderedIds array is required' }, { status: 400 });
        }
        const all = await SR.entities.SectionContent.filter({ jobId, sectionType }, 'sortOrder', 500);
        const validIds = new Set((all || []).map(i => i.id));
        for (const id of orderedIds) {
          if (!validIds.has(id)) {
            return Response.json({ error: 'Invalid content ID in reorder list' }, { status: 400 });
          }
        }
        await Promise.allSettled(
          orderedIds.map((id: string, i: number) => SR.entities.SectionContent.update(id, { sortOrder: i }))
        );
        return Response.json({ success: true });
      }

      case 'replace_section': {
        if (!Array.isArray(items)) {
          return Response.json({ error: 'items array is required' }, { status: 400 });
        }
        await SR.entities.SectionContent.deleteMany({ jobId, sectionType });
        const created = await SR.entities.SectionContent.bulkCreate(
          items.map((it: any, i: number) => ({
            companyId: job.companyId,
            sectionId: section.id,
            jobId,
            sectionType,
            contentType: it.contentType || 'text',
            title: it.title || '',
            body: it.body || '',
            sortOrder: i,
            isRequired: !!it.isRequired,
            isCritical: !!it.isCritical,
            metadata: it.metadata || {},
          }))
        );
        return Response.json({ items: created });
      }

      default:
        return Response.json({ error: 'Unknown action' }, { status: 400 });
    }

  } catch (error: any) {
    return Response.json({ error: 'An unexpected error occurred.' }, { status: 500 });
  }
}