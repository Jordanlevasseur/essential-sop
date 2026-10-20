/**
 * resolveCompanyEditRequests — Authorized edit request and revision listing.
 *
 * Replaces direct frontend EditRequest.filter, JobRevision.filter,
 * TemporaryEditGrant.filter, Job.filter, and User.list calls from
 * EditRequests.jsx and RequestsAndReviews.jsx.
 *
 * Authorization (server-side):
 *   - Authenticated user with an ACTIVE CompanyMembership for the companyId
 *     (any role — GMs, PMs, and PLs all need to view edit requests).
 *
 * Field isolation:
 *   - requests: full EditRequest records (no sensitive fields on this entity).
 *   - revisions: JobRevision records with draftContentSnapshot and
 *     publishedContentSnapshot STRIPPED. Snapshot content is only returned
 *     through a separate, role-gated function when a reviewer needs it.
 *   - grants: TemporaryEditGrant records (access metadata only, no content).
 *   - jobs: [{ id, title }] for display.
 *   - users: [{ id, full_name, email }] for member userIds + request
 *     participants only — replaces the previous platform-wide User.list()
 *     over-fetch.
 *
 * Returns: { requests, revisions, grants, jobs, users }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { getActiveMembership } from '../../shared/companyAuth.ts';

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { companyId } = body;
    if (!companyId || typeof companyId !== 'string') {
      return Response.json({ error: 'companyId is required' }, { status: 400 });
    }

    // ── Authorization: active membership (any role) ────────────────────────
    const membership = await getActiveMembership(base44, user.id, companyId);
    if (!membership) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const SR = base44.asServiceRole;

    const [requests, revisions, grants, jobs, membershipsAll] = await Promise.all([
      SR.entities.EditRequest.filter({ companyId }, '-created_date', 500),
      SR.entities.JobRevision.filter({ companyId }, '-created_date', 500),
      SR.entities.TemporaryEditGrant.filter({ companyId }, '-created_date', 500),
      SR.entities.Job.filter({ companyId }, '-created_date', 500),
      SR.entities.CompanyMembership.filter({ companyId, status: 'active' }),
    ]);

    // ── Resolve user names (members + request participants) ────────────────
    const userIds = new Set<string>();
    for (const m of (membershipsAll || [])) userIds.add(m.userId);
    for (const r of (requests || [])) {
      if (r.requestedByUserId) userIds.add(r.requestedByUserId);
      if (r.reviewedByUserId) userIds.add(r.reviewedByUserId);
    }

    const userFetches = await Promise.all(
      [...userIds].map(id => SR.entities.User.get(id).catch(() => null))
    );
    const users = userFetches
      .filter(Boolean)
      .map((u: any) => ({ id: u.id, full_name: u.full_name, email: u.email }));

    // ── Strip snapshots from revisions ──────────────────────────────────────
    const safeRevisions = (revisions || []).map((r: any) => {
      const { draftContentSnapshot, publishedContentSnapshot, ...rest } = r;
      return rest;
    });

    const jobTitles = (jobs || []).map((j: any) => ({ id: j.id, title: j.title }));

    return Response.json({
      requests: requests || [],
      revisions: safeRevisions,
      grants: grants || [],
      jobs: jobTitles,
      users,
    });

  } catch (error: any) {
    return Response.json({ error: 'An unexpected error occurred.' }, { status: 500 });
  }
}