/**
 * cancelInvitation — GM-authorized cancellation of a pending company invitation.
 *
 * SECURITY: Replaces the direct client `CompanyInvitation.update(inviteId,
 * { status: 'cancelled' })` write. The CompanyInvitation entity is now
 * RLS-closed to all direct client writes, so cancellation is performed via the
 * service role here with explicit GM authorization.
 *
 * Authorization: the caller must be an active general_manager of the
 * invitation's company. The invitation's companyId is read server-side and
 * never trusted from the client. Only a still-pending invitation can be
 * cancelled. The tokenHash is never read or returned.
 *
 * Input:  { invitationId }
 * Output: { success: true }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { invitationId } = body;
    if (!invitationId) {
      return Response.json({ error: 'invitationId is required.' }, { status: 400 });
    }

    const SR = base44.asServiceRole;
    const inv = await SR.entities.CompanyInvitation.get(invitationId).catch(() => null);
    if (!inv) {
      return Response.json({ error: 'Invitation not found.' }, { status: 404 });
    }
    if (inv.status !== 'pending') {
      return Response.json({ error: 'Invitation is no longer pending.' }, { status: 400 });
    }

    // Authorization: active general_manager of the invitation's company.
    const memberships = await SR.entities.CompanyMembership.filter({
      companyId: inv.companyId, userId: user.id, status: 'active',
    });
    const m = (memberships || [])[0];
    if (!m || m.role !== 'general_manager') {
      return Response.json(
        { error: 'Only a General Manager can cancel invitations.' },
        { status: 403 }
      );
    }

    const now = new Date().toISOString();
    await SR.entities.CompanyInvitation.update(invitationId, {
      status: 'cancelled',
      cancelledAt: now,
    });

    // Best-effort audit log (consistent with manageMember invitation actions).
    try {
      await SR.entities.ActivityLog.create({
        companyId: inv.companyId,
        actingUserId: user.id,
        actionType: 'invitation_cancelled',
        targetType: 'invitation',
        targetId: invitationId,
        summary: `${user.full_name || user.email} cancelled invitation to ${inv.invitedEmail}`,
        timestamp: now,
      });
    } catch (_) { /* best effort */ }

    return Response.json({ success: true });
  } catch (e) {
    return Response.json({ error: 'Failed to cancel invitation.' }, { status: 500 });
  }
}