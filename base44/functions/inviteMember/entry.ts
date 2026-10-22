import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { getSeatLimit } from '../../shared/planUtils.js';

const ALLOWED_ROLES = ['general_manager', 'project_manager', 'project_lead', 'technician'];
const INVITE_EXPIRY_DAYS = 7;

// The canonical PUBLISHED production origin. `req.headers.get('origin')` is
// unreliable — it reflects wherever the inviter's browser happens to be
// (Base44 editor preview, localhost, an obsolete domain), so a link baked
// into an email must always point to the real published app. Update this
// constant if the production domain changes.
const PRODUCTION_ORIGIN = 'https://essentialsop-job-flow.com';

function hashToken(token: string): string {
  // Same deterministic hash as acceptInvitation — verifies the invite-link secret.
  let hash = 0;
  for (let i = 0; i < token.length; i++) {
    const c = token.charCodeAt(i);
    hash = ((hash << 5) - hash) + c;
    hash |= 0;
  }
  return 'h_' + Math.abs(hash).toString(36) + '_' + token.slice(-8);
}

function generateToken(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

function buildInviteLink(token: string, invitationId: string): string {
  return `${PRODUCTION_ORIGIN}/accept-invitation?token=${token}&invitationId=${invitationId}`;
}

// Send the invitation email. Returns { delivered, error }. Never claims
// delivered when the sending service did not accept the request. A failure
// here does NOT create or modify any data — the caller decides whether to
// keep the pending invitation and offer a manual-share fallback.
async function sendInvitationEmail(
  base44: any,
  opts: { to: string; companyName: string; roleLabel: string; inviterName: string; inviteLink: string; expiresAt: string }
): Promise<{ delivered: boolean; error: string }> {
  const roleText = opts.roleLabel.replace(/_/g, ' ');
  const expiryDate = new Date(opts.expiresAt).toLocaleDateString();
  const subject = `You're invited to join ${opts.companyName} on Essential SOP`;
  const body =
    `Hello,\n\n` +
    `${opts.inviterName} has invited you to join "${opts.companyName}" on Essential SOP as a ${roleText}.\n\n` +
    `Tap the link below from your phone to accept the invitation and join the team:\n` +
    `${opts.inviteLink}\n\n` +
    `This invitation expires on ${expiryDate}.\n\n` +
    `If you did not expect this invitation, you can ignore this email.\n\n` +
    `— Essential SOP`;
  try {
    const r: any = await base44.integrations.Core.SendEmail({ to: opts.to, subject, body });
    if (r && (r.error || r.success === false)) {
      return { delivered: false, error: String(r.error || 'The email service rejected the request.') };
    }
    return { delivered: true, error: '' };
  } catch (e: any) {
    return { delivered: false, error: e?.message || 'The email service threw an error.' };
  }
}

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { action } = body;
    const SR = base44.asServiceRole;

    // ── RESEND a pending invitation ─────────────────────────────────────────
    // Rotates the token (invalidates the old link), resets the expiry, and
    // re-sends the email. Authorized to the active GM of the invitation's
    // company (companyId read server-side from the record, never the client).
    if (action === 'resend') {
      const { invitationId } = body;
      if (!invitationId) return Response.json({ error: 'invitationId is required' }, { status: 400 });

      const inv = await SR.entities.CompanyInvitation.get(invitationId).catch(() => null);
      if (!inv) return Response.json({ error: 'Invitation not found.' }, { status: 404 });

      const mems = await SR.entities.CompanyMembership.filter({
        companyId: inv.companyId, userId: user.id, status: 'active',
      });
      if (!(mems || []).some((m: any) => m.role === 'general_manager')) {
        return Response.json({ error: 'Only General Managers may resend invitations.' }, { status: 403 });
      }
      if (inv.status !== 'pending') {
        return Response.json({ error: 'Only pending invitations can be resent.' }, { status: 409 });
      }

      const company = await SR.entities.Company.get(inv.companyId).catch(() => null);
      if (!company || company.status !== 'active') {
        return Response.json({ error: 'Company not found or inactive.' }, { status: 404 });
      }

      const token = generateToken();
      const tokenHash = hashToken(token);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
      const inviteLink = buildInviteLink(token, inv.id);

      const { delivered, error: emailError } = await sendInvitationEmail(base44, {
        to: inv.invitedEmail,
        companyName: company.name,
        roleLabel: inv.intendedRole,
        inviterName: user.full_name || user.email,
        inviteLink,
        expiresAt: expiresAt.toISOString(),
      });

      if (!delivered) {
        // Keep the invitation pending (old token still valid until expiry) so the
        // GM can retry or share manually. Do not claim the email was sent.
        return Response.json({
          success: true,
          emailDelivered: false,
          emailError,
          inviteLink,
          invitation: { id: inv.id, invitedEmail: inv.invitedEmail, intendedRole: inv.intendedRole, expiresAt: inv.expiresAt },
        });
      }

      await SR.entities.CompanyInvitation.update(inv.id, {
        tokenHash,
        expiresAt: expiresAt.toISOString(),
        sentAt: now.toISOString(),
        lastResentAt: now.toISOString(),
      });

      try {
        await SR.entities.ActivityLog.create({
          companyId: inv.companyId,
          actingUserId: user.id,
          actionType: 'invitation_resent',
          targetType: 'invitation',
          targetId: inv.id,
          summary: `${user.full_name || user.email} resent invitation to ${inv.invitedEmail}`,
          timestamp: now.toISOString(),
        });
      } catch (_) { /* best-effort */ }

      return Response.json({
        success: true,
        emailDelivered: true,
        invitation: { id: inv.id, invitedEmail: inv.invitedEmail, intendedRole: inv.intendedRole, expiresAt: expiresAt.toISOString() },
      });
    }

    // ── INVITE (default action) ─────────────────────────────────────────────
    const { companyId, email, intendedRole } = body;

    if (!companyId || !email || !intendedRole) {
      return Response.json({ error: 'companyId, email, and intendedRole are required' }, { status: 400 });
    }
    if (!ALLOWED_ROLES.includes(intendedRole)) {
      return Response.json({ error: 'Invalid role' }, { status: 400 });
    }

    // 1. Verify inviter is an active GM in this company
    const memberships = await SR.entities.CompanyMembership.filter({
      companyId, userId: user.id, status: 'active',
    });
    const myMembership = (memberships || []).find((m: any) => m.role === 'general_manager');
    if (!myMembership) {
      return Response.json({ error: 'Only General Managers may invite members' }, { status: 403 });
    }

    // 2. Verify company is active and not Homeowner
    const company = await SR.entities.Company.get(companyId);
    if (!company || company.status !== 'active') {
      return Response.json({ error: 'Company not found or inactive' }, { status: 404 });
    }
    if (company.subscriptionPlanCode === 'homeowner') {
      return Response.json({ error: 'Homeowner accounts cannot invite team members' }, { status: 403 });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // 3. Verify not already a member
    const existingMembers = await SR.entities.CompanyMembership.filter({ companyId, status: 'active' });
    const allUsers = await SR.entities.User.list();
    const existingUserIds = (existingMembers || []).map((m: any) => m.userId);
    const existingUsers = (allUsers || []).filter((u: any) => existingUserIds.includes(u.id));
    const alreadyMember = existingUsers.some((u: any) => (u.email || '').toLowerCase() === normalizedEmail);
    if (alreadyMember) {
      return Response.json({ error: 'This person is already an active member' }, { status: 409 });
    }

    // 4. Verify no active pending invitation for this email
    const existingInvites = await SR.entities.CompanyInvitation.filter({
      companyId, invitedEmail: normalizedEmail, status: 'pending',
    });
    if (existingInvites && existingInvites.length > 0) {
      return Response.json({ error: 'An active invitation already exists for this email' }, { status: 409 });
    }

    // 5. Check seat capacity (active + pending) — null seatLimit means unlimited
    const seatLimit = getSeatLimit(company.subscriptionPlanCode);
    const activeCount = (existingMembers || []).length;
    const pendingInvites = await SR.entities.CompanyInvitation.filter({ companyId, status: 'pending' });
    const pendingCount = (pendingInvites || []).filter((i: any) => new Date(i.expiresAt) > new Date()).length;
    if (seatLimit != null && activeCount + pendingCount >= seatLimit) {
      return Response.json({
        error: 'This workspace has no profiles available. Cancel a pending invitation, remove an active member, or upgrade the plan.',
        seatLimit, activeCount, pendingCount,
      }, { status: 409 });
    }

    // 6. Create invitation
    const token = generateToken();
    const tokenHash = hashToken(token);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    const invitation = await SR.entities.CompanyInvitation.create({
      companyId,
      invitedEmail: normalizedEmail,
      intendedRole,
      invitedByUserId: user.id,
      tokenHash,
      status: 'pending',
      expiresAt: expiresAt.toISOString(),
      sentAt: now.toISOString(),
    });

    // 7. Log activity
    await SR.entities.ActivityLog.create({
      companyId,
      actingUserId: user.id,
      actionType: 'member_invited',
      targetType: 'invitation',
      targetId: invitation.id,
      summary: `${user.full_name || user.email} invited ${normalizedEmail} as ${intendedRole.replace('_', ' ')}`,
      timestamp: now.toISOString(),
    });

    // 8. Notify other GMs
    const gmMemberships = (existingMembers || []).filter((m: any) => m.role === 'general_manager');
    for (const gm of gmMemberships) {
      if (gm.userId !== user.id) {
        await SR.entities.Notification.create({
          companyId,
          userId: gm.userId,
          type: 'invitation_received',
          title: 'Member Invited',
          body: `${user.full_name || user.email} invited ${normalizedEmail} as ${intendedRole.replace('_', ' ')}`,
          targetType: 'invitation',
          targetId: invitation.id,
        }).catch(() => {});
      }
    }

    // 9. Send the actual invitation email to the recipient.
    const inviteLink = buildInviteLink(token, invitation.id);
    const { delivered, error: emailError } = await sendInvitationEmail(base44, {
      to: normalizedEmail,
      companyName: company.name,
      roleLabel: intendedRole,
      inviterName: user.full_name || user.email,
      inviteLink,
      expiresAt: expiresAt.toISOString(),
    });

    if (!delivered) {
      // The invitation record exists and is pending. Report the email failure
      // honestly (do NOT say "Invitation sent") and provide the link as a
      // manual-share fallback so the GM can still onboard the recipient.
      return Response.json({
        success: true,
        emailDelivered: false,
        emailError,
        inviteLink,
        invitation: { id: invitation.id, invitedEmail: normalizedEmail, intendedRole, expiresAt: expiresAt.toISOString() },
      });
    }

    return Response.json({
      success: true,
      emailDelivered: true,
      invitation: { id: invitation.id, invitedEmail: normalizedEmail, intendedRole, expiresAt: expiresAt.toISOString() },
    });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}