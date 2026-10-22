/**
 * resolveTeamRoster — returns the calling member's company team roster.
 *
 * SECURITY: Replaces direct client `CompanyMembership.filter({ companyId })`
 * and `CompanyInvitation.filter({ companyId })` reads. Both entities are now
 * RLS-restricted (CompanyMembership to self-only reads; CompanyInvitation
 * fully closed), so the roster is read via the service role here.
 *
 * Authorization: the caller must hold an ACTIVE CompanyMembership in the
 * requested companyId (any role). This preserves the pre-existing behavior
 * where any company member could view the team list — it does NOT broaden
 * permissions, and it does not allow cross-company enumeration (membership is
 * verified server-side; a caller cannot pass another company's id).
 *
 * Field isolation:
 *   - members: id, userId, role, status, joinedAt, suspendedAt (no isTestMembership).
 *   - invitations: id, invitedEmail, intendedRole, status, expiresAt, cancelledAt.
 *     tokenHash and invitedByUserId are NEVER returned.
 *   - users: { id, full_name, email } for member userIds only — replaces the
 *     previous platform-wide User.list() over-fetch.
 *
 * Input:  { companyId }
 * Output: { members, invitations, users }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { companyId } = body;
    if (!companyId) {
      return Response.json({ error: 'companyId is required.' }, { status: 400 });
    }

    const SR = base44.asServiceRole;

    // Authorization: active member of this company (any role).
    const callerMemberships = await SR.entities.CompanyMembership.filter({
      companyId, userId: user.id, status: 'active',
    });
    if (!(callerMemberships || []).length) {
      return Response.json(
        { error: 'You are not a member of this company.' },
        { status: 403 }
      );
    }

    const memberships = await SR.entities.CompanyMembership.filter({ companyId });
    const invitations = await SR.entities.CompanyInvitation.filter({ companyId });

    // Resolve user details only for member userIds.
    const userIds = [...new Set((memberships || []).map(m => m.userId))];
    const userFetches = await Promise.all(
      userIds.map(id => SR.entities.User.get(id).catch(() => null))
    );
    const users = userFetches
      .filter(Boolean)
      .map(u => ({ id: u.id, full_name: u.full_name, email: u.email }));

    const membersOut = (memberships || []).map(m => ({
      id: m.id,
      userId: m.userId,
      role: m.role,
      status: m.status,
      joinedAt: m.joinedAt,
      suspendedAt: m.suspendedAt,
    }));

    // Normalize expired pending invitations to 'expired' in the RESPONSE only.
    // The database record and its original expiration timestamp are preserved.
    // The backend (acceptInvitation) already rejects expired tokens at
    // acceptance time (HTTP 410) — this is a display-only fix so the GM does not
    // see stale invitations listed as actionable. Accepted and cancelled
    // invitations retain their real status even if their timestamp has passed.
    const now = new Date();
    const invitesOut = (invitations || []).map(i => {
      const isExpiredPending = i.status === 'pending' && i.expiresAt && new Date(i.expiresAt) < now;
      return {
        id: i.id,
        invitedEmail: i.invitedEmail,
        intendedRole: i.intendedRole,
        status: isExpiredPending ? 'expired' : i.status,
        expiresAt: i.expiresAt,
        cancelledAt: i.cancelledAt,
      };
    });

    return Response.json({ members: membersOut, invitations: invitesOut, users });
  } catch (e) {
    return Response.json({ error: 'Failed to load team roster.' }, { status: 500 });
  }
}