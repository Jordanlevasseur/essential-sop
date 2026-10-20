/**
 * resolveNotifications — Authorized Notification access for the current user.
 *
 * Replaces all direct frontend Notification.filter / Notification.update calls.
 * User identity is ALWAYS derived from base44.auth.me() — never from the client.
 * Ownership is verified server-side before any mutation.
 *
 * Actions:
 *   "list"         — Return up to 50 most recent notifications for the caller.
 *   "unread_count" — Return { count } of unread notifications.
 *   "mark_read"    — Mark ONE notification as read. Requires notificationId.
 *                    Verifies notification.userId === caller.id server-side.
 *   "mark_all_read" — Mark ALL of the caller's unread notifications as read.
 *
 * Authorization (server-side, on EVERY call):
 *   - Authenticated user.
 *   - Active CompanyMembership for the companyId (any role).
 *
 * companyId is accepted from the client but verified against the caller's
 * membership. It is NEVER used as the sole ownership key — userId is derived
 * from auth and used as the authoritative filter.
 *
 * Server-side notification creation (by other backend functions) continues
 * unchanged via asServiceRole.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { getActiveMembership } from '../../shared/companyAuth.ts';

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { action, companyId, notificationId } = body;

    if (!action) return Response.json({ error: 'action is required' }, { status: 400 });
    if (!companyId || typeof companyId !== 'string') {
      return Response.json({ error: 'companyId is required' }, { status: 400 });
    }

    // ── Authorization: active membership for this company ────────────────────
    const membership = await getActiveMembership(base44, user.id, companyId);
    if (!membership) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const role = membership.role;
    const SR = base44.asServiceRole;
    const nowIso = new Date().toISOString();

    // Sensitive account notifications are restricted to GM server-side.
    const ACCOUNT_RESTRICTED_TYPES = ['subscription_status_changed', 'plan_limit_reached'];
    const isGM = role === 'general_manager';

    switch (action) {
      case 'list': {
        const all = await SR.entities.Notification.filter(
          { companyId, userId: user.id },
          '-created_date',
          50
        );
        const filtered = (all || []).filter((n: any) =>
          !(ACCOUNT_RESTRICTED_TYPES.includes(n.type) && !isGM)
        );
        return Response.json({ notifications: filtered });
      }

      case 'unread_count': {
        const unread = await SR.entities.Notification.filter(
          { companyId, userId: user.id, isRead: false },
          '-created_date',
          200
        );
        const filtered = (unread || []).filter((n: any) =>
          !(ACCOUNT_RESTRICTED_TYPES.includes(n.type) && !isGM)
        );
        return Response.json({ count: filtered.length });
      }

      case 'mark_read': {
        if (!notificationId) {
          return Response.json({ error: 'notificationId is required' }, { status: 400 });
        }
        // ── Server-side ownership verification ──────────────────────────────
        const notif = await SR.entities.Notification.get(notificationId).catch(() => null);
        if (!notif) return Response.json({ error: 'Notification not found' }, { status: 404 });
        if (notif.userId !== user.id || notif.companyId !== companyId) {
          // Do not reveal existence of other users' notifications.
          return Response.json({ error: 'Notification not found' }, { status: 404 });
        }
        if (notif.isRead) {
          return Response.json({ success: true, alreadyRead: true });
        }
        await SR.entities.Notification.update(notificationId, { isRead: true, readAt: nowIso });
        return Response.json({ success: true });
      }

      case 'mark_all_read': {
        const unread = await SR.entities.Notification.filter(
          { companyId, userId: user.id, isRead: false },
          '-created_date',
          200
        );
        const ids = (unread || []).map((n: any) => n.id);
        if (ids.length === 0) return Response.json({ success: true, updated: 0 });
        await SR.entities.Notification.bulkUpdate(
          ids.map((id: string) => ({ id, isRead: true, readAt: nowIso }))
        );
        return Response.json({ success: true, updated: ids.length });
      }

      default:
        return Response.json({ error: 'Unknown action' }, { status: 400 });
    }

  } catch (error: any) {
    return Response.json({ error: 'An unexpected error occurred.' }, { status: 500 });
  }
}