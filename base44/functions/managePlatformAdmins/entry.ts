import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { requirePlatformSuperAdmin, writePlatformAudit } from '../../shared/platformAuth.ts';

/**
 * managePlatformAdmins — Platform Super Admin management.
 *
 * Actions:
 *   list         — List all PlatformMembership records.
 *   invite       — Invite a user by email to become a Platform Super Admin.
 *   activate     — Reactivate a suspended membership.
 *   suspend      — Suspend an active membership.
 *   revoke       — Permanently revoke a membership (status=REVOKED).
 *   get_audit    — Read PlatformAuditLog entries (paginated).
 *
 * Safety rules enforced:
 *   - Cannot suspend or revoke the last active Platform Super Admin.
 *   - Cannot operate on your own membership (demote self).
 *   - All actions create audit records.
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { action } = body;
    if (!action) return Response.json({ error: 'action is required' }, { status: 400 });

    const { user, error: authError } = await requirePlatformSuperAdmin(base44);
    if (authError) return authError;

    const SR = base44.asServiceRole;
    const now = new Date().toISOString();

    // ── LIST ─────────────────────────────────────────────────────────────────
    if (action === 'list') {
      const memberships = await SR.entities.PlatformMembership.filter({}, '-createdAt', 100);
      // Enrich with User display names
      const enriched = await Promise.all((memberships || []).map(async (m: any) => {
        const u = await SR.entities.User.get(m.userId).catch(() => null);
        return { ...m, userEmail: u?.email || null, userFullName: u?.full_name || null };
      }));
      return Response.json({ memberships: enriched });
    }

    // ── GET AUDIT ─────────────────────────────────────────────────────────────
    if (action === 'get_audit') {
      const { limit = 50, skip = 0 } = body;
      const entries = await SR.entities.PlatformAuditLog.list('-timestamp', Math.min(limit, 200));
      return Response.json({ entries: entries || [] });
    }

    // ── INVITE ────────────────────────────────────────────────────────────────
    if (action === 'invite') {
      const { targetEmail } = body;
      if (!targetEmail || typeof targetEmail !== 'string' || !targetEmail.includes('@')) {
        return Response.json({ error: 'Valid targetEmail is required' }, { status: 400 });
      }

      // Find the user by email via User entity
      const allUsers = await SR.entities.User.filter({ email: targetEmail.trim().toLowerCase() }, '-created_date', 1).catch(() => []);
      if (!allUsers || allUsers.length === 0) {
        return Response.json({
          error: 'No registered user found with that email. They must create an account first.',
          code: 'USER_NOT_FOUND',
        }, { status: 404 });
      }
      const targetUser = allUsers[0];

      if (targetUser.id === user.id) {
        return Response.json({ error: 'Cannot invite yourself' }, { status: 400 });
      }

      // Check for existing membership
      const existing = await SR.entities.PlatformMembership.filter({ userId: targetUser.id }, '-createdAt', 1).catch(() => []);
      if (existing && existing.length > 0) {
        const m = existing[0];
        if (m.status === 'ACTIVE') {
          return Response.json({ success: true, alreadyActive: true, membershipId: m.id });
        }
        // Reactivate suspended
        await SR.entities.PlatformMembership.update(m.id, {
          status: 'ACTIVE',
          grantedByUserId: user.id,
          grantedAt: now,
          suspendedAt: null,
          suspendedByUserId: null,
          suspensionReason: null,
          updatedAt: now,
        });
        await writePlatformAudit(SR, {
          actingUserId: user.id, actingUserRole: 'SUPER_ADMIN',
          action: 'platform_role_assigned',
          targetUserId: targetUser.id,
          extra: { metadata: { reactivatedFromInvite: true } },
        });
        return Response.json({ success: true, membershipId: m.id, reactivated: true });
      }

      // Create new membership
      const membership = await SR.entities.PlatformMembership.create({
        userId: targetUser.id,
        platformRole: 'SUPER_ADMIN',
        status: 'ACTIVE',
        grantedByUserId: user.id,
        grantedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      await writePlatformAudit(SR, {
        actingUserId: user.id, actingUserRole: 'SUPER_ADMIN',
        action: 'platform_role_assigned',
        targetUserId: targetUser.id,
        extra: { metadata: { invitedByEmail: true, targetEmail } },
      });

      return Response.json({ success: true, membershipId: membership.id, created: true });
    }

    // ── ACTIVATE / SUSPEND / REVOKE ───────────────────────────────────────────
    if (action === 'activate' || action === 'suspend' || action === 'revoke') {
      const { membershipId } = body;
      if (!membershipId) return Response.json({ error: 'membershipId is required' }, { status: 400 });

      const membership = await SR.entities.PlatformMembership.get(membershipId).catch(() => null);
      if (!membership) return Response.json({ error: 'Membership not found' }, { status: 404 });

      // Cannot operate on your own membership
      if (membership.userId === user.id) {
        return Response.json({ error: 'Cannot modify your own Platform membership' }, { status: 403 });
      }

      // Safety: cannot remove the last active Platform Super Admin
      if (action === 'suspend' || action === 'revoke') {
        const activeAdmins = await SR.entities.PlatformMembership.filter({
          status: 'ACTIVE', platformRole: 'SUPER_ADMIN',
        }, '-createdAt', 10).catch(() => []);
        const otherActives = (activeAdmins || []).filter((m: any) => m.id !== membershipId);
        if (otherActives.length === 0) {
          return Response.json({
            error: 'Cannot remove the last active Platform Super Admin. Promote another admin first.',
            code: 'LAST_ADMIN',
          }, { status: 409 });
        }
      }

      if (action === 'activate') {
        await SR.entities.PlatformMembership.update(membershipId, {
          status: 'ACTIVE', grantedByUserId: user.id, grantedAt: now,
          suspendedAt: null, suspendedByUserId: null, suspensionReason: null, updatedAt: now,
        });
        await writePlatformAudit(SR, {
          actingUserId: user.id, actingUserRole: 'SUPER_ADMIN',
          action: 'platform_role_assigned', targetUserId: membership.userId,
          extra: { newPlatformStatus: 'ACTIVE', previousPlatformStatus: membership.status },
        });
      } else if (action === 'suspend') {
        await SR.entities.PlatformMembership.update(membershipId, {
          status: 'SUSPENDED', suspendedByUserId: user.id, suspendedAt: now, updatedAt: now,
        });
        await writePlatformAudit(SR, {
          actingUserId: user.id, actingUserRole: 'SUPER_ADMIN',
          action: 'platform_role_removed', targetUserId: membership.userId,
          extra: { previousPlatformStatus: 'ACTIVE', newPlatformStatus: 'SUSPENDED' },
        });
      } else if (action === 'revoke') {
        await SR.entities.PlatformMembership.update(membershipId, {
          status: 'SUSPENDED', suspendedByUserId: user.id, suspendedAt: now,
          suspensionReason: 'REVOKED', updatedAt: now,
        });
        await writePlatformAudit(SR, {
          actingUserId: user.id, actingUserRole: 'SUPER_ADMIN',
          action: 'platform_role_removed', targetUserId: membership.userId,
          extra: { previousPlatformStatus: membership.status, newPlatformStatus: 'REVOKED' },
        });
      }

      return Response.json({ success: true });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}