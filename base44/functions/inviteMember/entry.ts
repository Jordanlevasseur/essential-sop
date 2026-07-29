import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

const ALLOWED_ROLES = ['general_manager', 'project_manager', 'project_lead', 'technician'];
const INVITE_EXPIRY_DAYS = 7;

function hashToken(token) {
  // Simple deterministic hash for prototype — production should use SubtleCrypto SHA-256
  let hash = 0;
  for (let i = 0; i < token.length; i++) {
    const c = token.charCodeAt(i);
    hash = ((hash << 5) - hash) + c;
    hash |= 0;
  }
  return 'h_' + Math.abs(hash).toString(36) + '_' + token.slice(-8);
}

function generateToken() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { companyId, email, intendedRole } = body;

    if (!companyId || !email || !intendedRole) {
      return Response.json({ error: 'companyId, email, and intendedRole are required' }, { status: 400 });
    }
    if (!ALLOWED_ROLES.includes(intendedRole)) {
      return Response.json({ error: 'Invalid role' }, { status: 400 });
    }

    // 1. Verify inviter is an active GM in this company
    const memberships = await base44.asServiceRole.entities.CompanyMembership.filter({
      companyId, userId: user.id, status: 'active'
    });
    const myMembership = (memberships || []).find(m => m.role === 'general_manager');
    if (!myMembership) {
      return Response.json({ error: 'Only General Managers may invite members' }, { status: 403 });
    }

    // 2. Verify company is active and not Homeowner
    const company = await base44.asServiceRole.entities.Company.get(companyId);
    if (!company || company.status !== 'active') {
      return Response.json({ error: 'Company not found or inactive' }, { status: 404 });
    }
    if (company.subscriptionPlanCode === 'homeowner') {
      return Response.json({ error: 'Homeowner accounts cannot invite team members' }, { status: 403 });
    }

    // 3. Verify not already a member
    const existingMembers = await base44.asServiceRole.entities.CompanyMembership.filter({ companyId, status: 'active' });
    const allUsers = await base44.asServiceRole.entities.User.list();
    const existingUserIds = (existingMembers || []).map(m => m.userId);
    const existingUsers = (allUsers || []).filter(u => existingUserIds.includes(u.id));
    const alreadyMember = existingUsers.some(u => u.email?.toLowerCase() === email.toLowerCase());
    if (alreadyMember) {
      return Response.json({ error: 'This person is already an active member' }, { status: 409 });
    }

    // 4. Verify no active pending invitation for this email
    const existingInvites = await base44.asServiceRole.entities.CompanyInvitation.filter({
      companyId, invitedEmail: email.toLowerCase(), status: 'pending'
    });
    if (existingInvites && existingInvites.length > 0) {
      return Response.json({ error: 'An active invitation already exists for this email' }, { status: 409 });
    }

    // 5. Check seat capacity (active + pending)
    const PLAN_LIMITS = { homeowner: 1, handyman: 2, contractor: 15, contractor_plus: 40 };
    const seatLimit = PLAN_LIMITS[company.subscriptionPlanCode] || 40;
    const activeCount = (existingMembers || []).length;
    const pendingInvites = await base44.asServiceRole.entities.CompanyInvitation.filter({ companyId, status: 'pending' });
    const pendingCount = (pendingInvites || []).filter(i => new Date(i.expiresAt) > new Date()).length;
    if (activeCount + pendingCount >= seatLimit) {
      return Response.json({
        error: 'This workspace has no profiles available. Cancel a pending invitation, remove an active member, or upgrade the plan.',
        seatLimit, activeCount, pendingCount
      }, { status: 409 });
    }

    // 6. Create invitation
    const token = generateToken();
    const tokenHash = hashToken(token);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    const invitation = await base44.asServiceRole.entities.CompanyInvitation.create({
      companyId,
      invitedEmail: email.toLowerCase(),
      intendedRole,
      invitedByUserId: user.id,
      tokenHash,
      status: 'pending',
      expiresAt: expiresAt.toISOString(),
      sentAt: now.toISOString(),
    });

    // 7. Log activity
    await base44.asServiceRole.entities.ActivityLog.create({
      companyId,
      actingUserId: user.id,
      actionType: 'member_invited',
      targetType: 'invitation',
      targetId: invitation.id,
      summary: `${user.full_name || user.email} invited ${email} as ${intendedRole.replace('_', ' ')}`,
      timestamp: now.toISOString(),
    });

    // 8. Notify GMs
    const gmMemberships = (existingMembers || []).filter(m => m.role === 'general_manager');
    for (const gm of gmMemberships) {
      if (gm.userId !== user.id) {
        await base44.asServiceRole.entities.Notification.create({
          companyId,
          userId: gm.userId,
          type: 'invitation_received',
          title: 'Member Invited',
          body: `${user.full_name || user.email} invited ${email} as ${intendedRole.replace('_', ' ')}`,
          targetType: 'invitation',
          targetId: invitation.id,
        });
      }
    }

    // In prototype mode: return a copyable invite link since email is Base44-registered-only
    const inviteLink = `${req.headers.get('origin') || ''}/accept-invitation?token=${token}&invitationId=${invitation.id}`;

    return Response.json({
      success: true,
      invitation: { id: invitation.id, invitedEmail: email, intendedRole, expiresAt: expiresAt.toISOString() },
      inviteLink,
      emailNote: 'Prototype mode: invitation email not sent. Share the invite link manually.',
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}