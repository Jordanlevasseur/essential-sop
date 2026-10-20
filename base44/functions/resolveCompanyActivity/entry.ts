/**
 * resolveCompanyActivity — Authorized activity log listing with user and job
 * resolution.
 *
 * Replaces direct frontend ActivityLog.filter, Job.filter, and User.list
 * calls from ActivityHistory.jsx.
 *
 * Authorization (server-side):
 *   - Authenticated user with an ACTIVE CompanyMembership for the companyId.
 *   - Role MUST be general_manager, project_manager, or project_lead.
 *     Technicians receive 403.
 *
 * Role-based filtering (enforced server-side, not just in the UI):
 *   - GM: all activity logs for the company.
 *   - PM: job-related + edit-access logs only (PM_VISIBLE_ACTIONS).
 *   - PL: edit-access logs where actingUserId === caller only.
 *
 * Returns: { logs, jobs, users, role }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { getActiveMembership } from '../../shared/companyAuth.ts';

const PM_VISIBLE_ACTIONS = new Set([
  'job_created', 'job_edited', 'job_published', 'job_archived', 'job_restored',
  'revision_published',
  'edit_request_submitted', 'edit_request_approved', 'edit_request_denied',
  'temporary_access_granted', 'temporary_access_revoked', 'temporary_access_expired',
  'revision_submitted', 'revision_changes_requested', 'revision_rejected',
]);

const PL_VISIBLE_ACTIONS = new Set([
  'edit_request_submitted', 'edit_request_approved', 'edit_request_denied',
  'temporary_access_granted', 'temporary_access_revoked', 'temporary_access_expired',
  'revision_submitted', 'revision_changes_requested', 'revision_rejected', 'revision_published',
]);

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

    // ── Authorization: active membership ────────────────────────────────────
    const membership = await getActiveMembership(base44, user.id, companyId);
    if (!membership) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const role = membership.role;

    // Technicians cannot view activity history.
    if (role === 'technician') {
      return Response.json({ error: 'Activity History is not available for your role.' }, { status: 403 });
    }

    const SR = base44.asServiceRole;

    const [logs, jobs, membershipsAll] = await Promise.all([
      SR.entities.ActivityLog.filter({ companyId }, '-timestamp', 200),
      SR.entities.Job.filter({ companyId }, '-created_date', 500),
      SR.entities.CompanyMembership.filter({ companyId, status: 'active' }),
    ]);

    // ── Role-based filtering (server-side) ──────────────────────────────────
    let filteredLogs = logs || [];
    if (role === 'project_manager') {
      filteredLogs = filteredLogs.filter((l: any) => PM_VISIBLE_ACTIONS.has(l.actionType));
    }
    if (role === 'project_lead') {
      filteredLogs = filteredLogs.filter((l: any) =>
        PL_VISIBLE_ACTIONS.has(l.actionType) && l.actingUserId === user.id
      );
    }

    // ── Resolve user names ──────────────────────────────────────────────────
    const userIds = new Set<string>();
    for (const m of (membershipsAll || [])) userIds.add(m.userId);
    for (const l of filteredLogs) { if (l.actingUserId) userIds.add(l.actingUserId); }

    const userFetches = await Promise.all(
      [...userIds].map(id => SR.entities.User.get(id).catch(() => null))
    );
    const users = userFetches
      .filter(Boolean)
      .map((u: any) => ({ id: u.id, full_name: u.full_name, email: u.email }));

    const jobTitles = (jobs || []).map((j: any) => ({ id: j.id, title: j.title }));

    return Response.json({
      logs: filteredLogs,
      jobs: jobTitles,
      users,
      role,
    });

  } catch (error: any) {
    return Response.json({ error: 'An unexpected error occurred.' }, { status: 500 });
  }
}