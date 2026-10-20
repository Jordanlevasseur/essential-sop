/**
 * requestCompanyClosure — Authorized workspace-closure request.
 *
 * Replaces the direct frontend ActivityLog.create call in OwnershipAndAccount.jsx.
 *
 * Authorization:
 *   - Authenticated user with an ACTIVE CompanyMembership for the companyId.
 *   - Role MUST be general_manager (company owner). Other roles receive 403.
 *
 * Creates a single ActivityLog record with actionType='account_deletion_requested',
 * using the authenticated user's ID and the verified companyId. The client cannot
 * specify an arbitrary companyId, actingUserId, or actionType.
 *
 * Response: { success: true }
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

    // ── Authorization: active GM membership ──────────────────────────────────
    const membership = await getActiveMembership(base44, user.id, companyId);
    if (!membership) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (membership.role !== 'general_manager') {
      return Response.json({ error: 'Only the company owner can request closure.' }, { status: 403 });
    }

    // ── Resolve company name for the summary ────────────────────────────────
    const SR = base44.asServiceRole;
    const company = await SR.entities.Company.get(companyId).catch(() => null);
    const companyName = company?.name || 'this workspace';

    // ── Create audit record (service role) ──────────────────────────────────
    await SR.entities.ActivityLog.create({
      companyId,
      actingUserId: user.id,
      actionType: 'account_deletion_requested',
      summary: `${user.full_name || user.email} requested closure of ${companyName}`,
      timestamp: new Date().toISOString(),
    });

    return Response.json({ success: true });

  } catch (error: any) {
    return Response.json({ error: 'An unexpected error occurred.' }, { status: 500 });
  }
}