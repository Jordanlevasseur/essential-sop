/**
 * resolveCompanyJobTitles — Authorized company Job title lookup.
 *
 * Replaces direct frontend Job.filter({ companyId }) calls from
 * ActivityHistory.jsx, EditRequests.jsx, and RequestsAndReviews.jsx, which
 * only need { id, title } pairs to resolve log/request display names.
 *
 * Authorization (server-side):
 *   - Authenticated user with an ACTIVE CompanyMembership for the companyId
 *     (any role — technicians, PMs, PLs, and GMs all need title lookups).
 *
 * Returns: { jobs: [{ id, title, isArchived, status }] }
 *
 * Returns ALL jobs for the company (Draft + Published, archived + active)
 * because activity logs and edit requests reference jobs in any state.
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
    const jobs = await SR.entities.Job.filter({ companyId }, '-created_date', 500);
    const titles = (jobs || []).map((j: any) => ({
      id: j.id,
      title: j.title,
      isArchived: j.isArchived,
      status: j.status,
    }));

    return Response.json({ jobs: titles });

  } catch (error: any) {
    return Response.json({ error: 'An unexpected error occurred.' }, { status: 500 });
  }
}