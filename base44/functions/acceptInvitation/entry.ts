/**
 * acceptInvitation — secure, server-side invitation acceptance.
 *
 * Moves the seat-limit check and all membership/invitation writes off the
 * client (the old client-side check in AcceptInvitation.jsx was bypassable).
 *
 * Input:  { invitationId: string, token: string }
 * Output: { success: true, companyId, companyName, intendedRole }
 *         | { error }
 *
 * Authorization preserved:
 *  - The invitation token (hashed, from the invite link) must match the
 *    stored tokenHash — only someone holding the link can accept.
 *  - The accepting user's email must match the invited email.
 *  - The invitation must be pending and unexpired.
 *  - The user must not already be an active member.
 *
 * Concurrency safety (Base44 has no multi-record transactions / unique
 * constraints), so we use compensating writes:
 *  - Re-count active members AFTER creating the membership; if the company is
 *    now over its (finite) limit, the just-created membership is deleted and
 *    the acceptance is refused — the same final seat cannot be taken twice.
 *  - Re-read the invitation AFTER creating the membership; if another
 *    acceptance raced ahead and it is no longer pending, undo our membership.
 *
 * Prototype billing is unchanged. No payment is processed. AI access is not
 * gated here. seatLimit === null means unlimited profiles (no cap).
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { getSeatLimit } from '../../shared/planUtils.js';

function hashToken(token: string): string {
  // Same deterministic hash as inviteMember — verifies the invite link secret.
  let hash = 0;
  for (let i = 0; i < token.length; i++) {
    const c = token.charCodeAt(i);
    hash = ((hash << 5) - hash) + c;
    hash |= 0;
  }
  return 'h_' + Math.abs(hash).toString(36) + '_' + token.slice(-8);
}

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { invitationId, token } = body;
    if (!invitationId || !token) {
      return Response.json({ error: 'Invalid invitation link.' }, { status: 400 });
    }

    const SR = base44.asServiceRole;

    // 1. Load invitation (service-role get throws on not-found — treat as 404)
    let invitation: any = null;
    try {
      invitation = await SR.entities.CompanyInvitation.get(invitationId);
    } catch (_) {
      invitation = null;
    }
    if (!invitation) return Response.json({ error: 'Invitation not found.' }, { status: 404 });
    if (invitation.status !== 'pending') {
      return Response.json({ error: `This invitation has already been ${invitation.status}.` }, { status: 409 });
    }
    if (new Date(invitation.expiresAt) < new Date()) {
      return Response.json({ error: 'This invitation has expired.' }, { status: 410 });
    }

    // 2. Validate the invite-link token secret
    if (!invitation.tokenHash || invitation.tokenHash !== hashToken(token)) {
      return Response.json({ error: 'Invalid invitation link.' }, { status: 403 });
    }

    // 3. The accepting user must match the invited email
    if ((user.email || '').toLowerCase() !== (invitation.invitedEmail || '').toLowerCase()) {
      return Response.json({
        error: `This invitation was sent to ${invitation.invitedEmail}. You are signed in as ${user.email}. Please sign in with the correct account.`,
      }, { status: 403 });
    }

    const companyId = invitation.companyId;

    // 4. Must not already be an active member
    const existing = await SR.entities.CompanyMembership.filter({ companyId, userId: user.id, status: 'active' });
    if ((existing || []).length > 0) {
      return Response.json({ error: 'You are already a member of this workspace.' }, { status: 409 });
    }

    // 5. Load company + enforce server-side seat limit before creating
    const company = await SR.entities.Company.get(companyId);
    if (!company || company.status !== 'active') {
      return Response.json({ error: 'Company not found or inactive.' }, { status: 404 });
    }
    const seatLimit = getSeatLimit(company.subscriptionPlanCode); // null = unlimited
    const beforeActive = await SR.entities.CompanyMembership.filter({ companyId, status: 'active' });
    if (seatLimit != null && (beforeActive || []).length >= seatLimit) {
      return Response.json({
        error: "This invitation cannot currently be accepted because the workspace has reached its profile limit. Contact the company's General Manager.",
        seatLimit, activeCount: (beforeActive || []).length,
      }, { status: 409 });
    }

    // 6. Create the membership
    const now = new Date().toISOString();
    const membership = await SR.entities.CompanyMembership.create({
      companyId,
      userId: user.id,
      role: invitation.intendedRole,
      status: 'active',
      joinedAt: now,
    });

    // 7. Concurrency guard A: re-count after create; rollback if over the finite limit
    if (seatLimit != null) {
      const afterActive = await SR.entities.CompanyMembership.filter({ companyId, status: 'active' });
      if ((afterActive || []).length > seatLimit) {
        await SR.entities.CompanyMembership.delete(membership.id);
        return Response.json({
          error: "This invitation cannot currently be accepted because the workspace has reached its profile limit. Contact the company's General Manager.",
          seatLimit, activeCount: (afterActive || []).length,
        }, { status: 409 });
      }
    }

    // 8. Concurrency guard B: invitation must still be pending; otherwise undo
    const refreshed = await SR.entities.CompanyInvitation.get(invitationId);
    if (refreshed && refreshed.status !== 'pending') {
      await SR.entities.CompanyMembership.delete(membership.id);
      return Response.json({ error: `This invitation has already been ${refreshed.status}.` }, { status: 409 });
    }
    await SR.entities.CompanyInvitation.update(invitationId, { status: 'accepted', acceptedAt: now });

    // 9. Best-effort activity log
    try {
      await SR.entities.ActivityLog.create({
        companyId,
        actingUserId: user.id,
        actionType: 'invitation_accepted',
        targetType: 'invitation',
        targetId: invitationId,
        summary: `${user.full_name || user.email} accepted invitation to join as ${(invitation.intendedRole || '').replace('_', ' ')}`,
        timestamp: now,
      });
    } catch (_) {
      // non-critical
    }

    return Response.json({
      success: true,
      companyId,
      companyName: company?.name || '',
      intendedRole: invitation.intendedRole,
    });
  } catch (error: any) {
    console.error('acceptInvitation error:', error?.message);
    return Response.json({ error: error.message || 'Failed to accept invitation.' }, { status: 500 });
  }
}