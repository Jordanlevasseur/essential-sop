/**
 * countCompanySopJobs — Authorized count of provisioned SOP Jobs.
 *
 * Replaces direct frontend Job.filter({ companyId, sourceType: 'essential_sop' })
 * calls from SyncSettings.jsx, which only needs a count for the library stats
 * display.
 *
 * Authorization (server-side):
 *   - Authenticated user with an ACTIVE CompanyMembership for the companyId.
 *   - Role MUST be general_manager or project_manager.
 *
 * Returns: { count }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { getActiveMembership, isCompanyAdminRole } from '../../shared/companyAuth.ts';

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

    // ── Authorization: active membership + GM/PM role ───────────────────────
    const membership = await getActiveMembership(base44, user.id, companyId);
    if (!membership) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!isCompanyAdminRole(membership.role)) {
      return Response.json({ error: 'Insufficient role' }, { status: 403 });
    }

    // Use filter (not count) because count is not available on the service-role
    // client in this SDK version. The SOP job set is small (typically < 50).
    const sopJobs = await base44.asServiceRole.entities.Job.filter({
      companyId,
      sourceType: 'essential_sop',
    }, '-created_date', 500);

    return Response.json({ count: (sopJobs || []).length });

  } catch (error: any) {
    return Response.json({ error: 'An unexpected error occurred.' }, { status: 500 });
  }
}