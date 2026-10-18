import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { getSeatLimit } from '../../shared/planUtils.js';

const VALID_ROLES = ['general_manager', 'project_manager', 'project_lead', 'technician'];

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { action, companyId, targetMembershipId, newRole, reviewerNote } = body;

    // Action: change_role | suspend | restore | remove
    if (!action || !companyId || !targetMembershipId) {
      return Response.json({ error: 'action, companyId, and targetMembershipId are required' }, { status: 400 });
    }

    // Verify actor is an active GM
    const actorMemberships = await base44.asServiceRole.entities.CompanyMembership.filter({
      companyId, userId: user.id, status: 'active'
    });
    const isGM = (actorMemberships || []).some(m => m.role === 'general_manager');
    if (!isGM) {
      return Response.json({ error: 'Only General Managers may manage team members' }, { status: 403 });
    }

    // Load target membership
    const target = await base44.asServiceRole.entities.CompanyMembership.get(targetMembershipId);
    if (!target || target.companyId !== companyId) {
      return Response.json({ error: 'Membership not found in this company' }, { status: 404 });
    }

    const now = new Date().toISOString();

    if (action === 'change_role') {
      if (!newRole || !VALID_ROLES.includes(newRole)) {
        return Response.json({ error: 'Valid newRole required' }, { status: 400 });
      }
      // Safeguard: cannot demote last GM
      if (target.role === 'general_manager' && newRole !== 'general_manager') {
        const allGMs = await base44.asServiceRole.entities.CompanyMembership.filter({
          companyId, role: 'general_manager', status: 'active'
        });
        if ((allGMs || []).length <= 1) {
          return Response.json({ error: 'Cannot demote the last active General Manager' }, { status: 409 });
        }
      }
      const previousRole = target.role;
      await base44.asServiceRole.entities.CompanyMembership.update(targetMembershipId, { role: newRole });
      await base44.asServiceRole.entities.ActivityLog.create({
        companyId, actingUserId: user.id, actionType: 'member_role_changed',
        targetType: 'membership', targetId: targetMembershipId,
        summary: `${user.full_name || user.email} changed role from ${previousRole.replace('_',' ')} to ${newRole.replace('_',' ')}`,
        metadata: { previousRole, newRole, targetUserId: target.userId },
        timestamp: now,
      });
      await base44.asServiceRole.entities.Notification.create({
        companyId, userId: target.userId, type: 'role_changed',
        title: 'Your role has changed',
        body: `Your role has been updated to ${newRole.replace('_', ' ')}.`,
        targetType: 'membership', targetId: targetMembershipId,
      });
      return Response.json({ success: true, action, previousRole, newRole });
    }

    if (action === 'suspend') {
      if (target.status !== 'active') {
        return Response.json({ error: 'Member is not currently active' }, { status: 409 });
      }
      // Safeguard: cannot suspend last GM
      if (target.role === 'general_manager') {
        const allGMs = await base44.asServiceRole.entities.CompanyMembership.filter({
          companyId, role: 'general_manager', status: 'active'
        });
        if ((allGMs || []).length <= 1) {
          return Response.json({ error: 'Cannot suspend the last active General Manager' }, { status: 409 });
        }
      }
      await base44.asServiceRole.entities.CompanyMembership.update(targetMembershipId, { status: 'suspended', suspendedAt: now });
      await base44.asServiceRole.entities.ActivityLog.create({
        companyId, actingUserId: user.id, actionType: 'member_suspended',
        targetType: 'membership', targetId: targetMembershipId,
        summary: `${user.full_name || user.email} suspended a team member`,
        timestamp: now,
      });
      await base44.asServiceRole.entities.Notification.create({
        companyId, userId: target.userId, type: 'membership_suspended',
        title: 'Your access has been suspended',
        body: 'Your access to this workspace has been temporarily suspended.',
        targetType: 'membership', targetId: targetMembershipId,
      });
      return Response.json({ success: true, action });
    }

    if (action === 'restore') {
      if (target.status !== 'suspended') {
        return Response.json({ error: 'Member is not suspended' }, { status: 409 });
      }
      // Recheck seat capacity — null seatLimit means unlimited
      const company = await base44.asServiceRole.entities.Company.get(companyId);
      const seatLimit = getSeatLimit(company?.subscriptionPlanCode);
      const activeMembers = await base44.asServiceRole.entities.CompanyMembership.filter({ companyId, status: 'active' });
      if (seatLimit != null && (activeMembers || []).length >= seatLimit) {
        return Response.json({ error: 'No available seats. Remove or suspend another member first.' }, { status: 409 });
      }
      await base44.asServiceRole.entities.CompanyMembership.update(targetMembershipId, { status: 'active', suspendedAt: null });
      await base44.asServiceRole.entities.ActivityLog.create({
        companyId, actingUserId: user.id, actionType: 'member_restored',
        targetType: 'membership', targetId: targetMembershipId,
        summary: `${user.full_name || user.email} restored a suspended member`,
        timestamp: now,
      });
      await base44.asServiceRole.entities.Notification.create({
        companyId, userId: target.userId, type: 'membership_restored',
        title: 'Your access has been restored',
        body: 'Your access to this workspace has been restored.',
        targetType: 'membership', targetId: targetMembershipId,
      });
      return Response.json({ success: true, action });
    }

    if (action === 'remove') {
      // Safeguard: cannot remove last GM
      if (target.role === 'general_manager') {
        const allGMs = await base44.asServiceRole.entities.CompanyMembership.filter({
          companyId, role: 'general_manager', status: 'active'
        });
        if ((allGMs || []).length <= 1) {
          return Response.json({ error: 'Cannot remove the last active General Manager' }, { status: 409 });
        }
      }
      // Cannot remove owner without transfer
      const company = await base44.asServiceRole.entities.Company.get(companyId);
      if (company?.ownerUserId === target.userId) {
        return Response.json({ error: 'Cannot remove the company owner. Transfer ownership first.' }, { status: 409 });
      }
      await base44.asServiceRole.entities.CompanyMembership.update(targetMembershipId, { status: 'removed', removedAt: now });
      // Cancel active edit grants
      const grants = await base44.asServiceRole.entities.TemporaryEditGrant.filter({ companyId, userId: target.userId, status: 'active' });
      for (const grant of (grants || [])) {
        await base44.asServiceRole.entities.TemporaryEditGrant.update(grant.id, { status: 'revoked', revokedAt: now });
      }
      await base44.asServiceRole.entities.ActivityLog.create({
        companyId, actingUserId: user.id, actionType: 'member_removed',
        targetType: 'membership', targetId: targetMembershipId,
        summary: `${user.full_name || user.email} removed a team member`,
        timestamp: now,
      });
      return Response.json({ success: true, action });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}