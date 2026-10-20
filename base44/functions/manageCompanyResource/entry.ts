import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import {
  verifyResourceJobAccess,
  sanitizeResourceData,
  sanitizeHttpsUrl,
  isValidResourceType,
} from '../../shared/companyResourceAuth.ts';

/**
 * manageCompanyResource — Authorized company resource mutations (GM/PM only).
 *
 * Actions:
 *   "create"  — Create a new resource link on the job.
 *   "update"  — Update an existing resource's editable fields.
 *   "delete"  — Delete a resource.
 *   "reorder" — Reorder resources (takes orderedIds array).
 *
 * Authorization (server-side, on EVERY call):
 *   - Authenticated user with an ACTIVE CompanyMembership for the job's company.
 *   - Role MUST be general_manager or project_manager.
 *   - The Job must belong to the caller's company, not be archived, and for
 *     essential_sop jobs must be Published with an active Master + ACTIVE
 *     platform assignment (verified by verifyResourceJobAccess).
 *   - For update/delete: the resource must belong to the specified jobId
 *     (parent-child verification).
 *   - For reorder: every ID in orderedIds must belong to the job.
 *
 * Fields are whitelisted: companyId, jobId, createdByUserId, displayOrder are
 * derived server-side — never accepted from the client. Only title, url,
 * resourceType, and description are client-settable.
 *
 * URL validation: only HTTPS URLs are accepted. javascript:, data:, vbscript:,
 * file: and other non-https schemes are rejected. The server never retrieves
 * or executes the linked content.
 */
export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { action, jobId, resourceId, data, orderedIds } = body;

    if (!action || !jobId) {
      return Response.json({ error: 'action and jobId are required' }, { status: 400 });
    }

    const SR = base44.asServiceRole;
    const access = await verifyResourceJobAccess(base44, SR, user, jobId, true);
    if (access.error) return access.error;

    const { job } = access;

    switch (action) {
      case 'create': {
        const sanitized = sanitizeResourceData(data);
        const title = (sanitized.title || '').toString().trim();
        if (!title) return Response.json({ error: 'Title is required' }, { status: 400 });
        const url = sanitizeHttpsUrl(sanitized.url);
        if (!url) return Response.json({ error: 'A valid HTTPS URL is required' }, { status: 400 });
        const resourceType = isValidResourceType(sanitized.resourceType) ? sanitized.resourceType : 'other';
        const description = typeof sanitized.description === 'string' ? sanitized.description.trim() : '';

        const existing = await SR.entities.CompanyResource.filter(
          { companyId: job.companyId, jobId }, 'displayOrder', 200
        );
        const created = await SR.entities.CompanyResource.create({
          companyId: job.companyId,
          jobId,
          title,
          url,
          resourceType,
          description,
          displayOrder: (existing || []).length,
          createdByUserId: user.id,
        });
        return Response.json({ resource: created });
      }

      case 'update': {
        if (!resourceId) return Response.json({ error: 'resourceId is required' }, { status: 400 });
        const existing = await SR.entities.CompanyResource.get(resourceId).catch(() => null);
        if (!existing || existing.jobId !== jobId || existing.companyId !== job.companyId) {
          return Response.json({ error: 'Resource not found for this job' }, { status: 404 });
        }
        const sanitized = sanitizeResourceData(data);
        const update: any = {};
        if (sanitized.title !== undefined) {
          const t = sanitized.title.toString().trim();
          if (!t) return Response.json({ error: 'Title cannot be empty' }, { status: 400 });
          update.title = t;
        }
        if (sanitized.url !== undefined) {
          const url = sanitizeHttpsUrl(sanitized.url);
          if (!url) return Response.json({ error: 'A valid HTTPS URL is required' }, { status: 400 });
          update.url = url;
        }
        if (sanitized.resourceType !== undefined) {
          update.resourceType = isValidResourceType(sanitized.resourceType) ? sanitized.resourceType : 'other';
        }
        if (sanitized.description !== undefined) {
          update.description = typeof sanitized.description === 'string' ? sanitized.description.trim() : '';
        }
        const updated = await SR.entities.CompanyResource.update(resourceId, update);
        return Response.json({ resource: updated });
      }

      case 'delete': {
        if (!resourceId) return Response.json({ error: 'resourceId is required' }, { status: 400 });
        const existing = await SR.entities.CompanyResource.get(resourceId).catch(() => null);
        if (!existing || existing.jobId !== jobId || existing.companyId !== job.companyId) {
          return Response.json({ error: 'Resource not found for this job' }, { status: 404 });
        }
        await SR.entities.CompanyResource.delete(resourceId);
        return Response.json({ success: true });
      }

      case 'reorder': {
        if (!Array.isArray(orderedIds)) {
          return Response.json({ error: 'orderedIds array is required' }, { status: 400 });
        }
        const all = await SR.entities.CompanyResource.filter(
          { companyId: job.companyId, jobId }, 'displayOrder', 200
        );
        const validIds = new Set((all || []).map((r: any) => r.id));
        for (const id of orderedIds) {
          if (!validIds.has(id)) {
            return Response.json({ error: 'Invalid resource ID in reorder list' }, { status: 400 });
          }
        }
        await Promise.allSettled(
          orderedIds.map((id: string, i: number) =>
            SR.entities.CompanyResource.update(id, { displayOrder: i })
          )
        );
        return Response.json({ success: true });
      }

      default:
        return Response.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error: any) {
    return Response.json({ error: 'An unexpected error occurred.' }, { status: 500 });
  }
}