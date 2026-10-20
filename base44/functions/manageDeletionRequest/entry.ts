/**
 * manageDeletionRequest — Platform Super Admin processing of account-deletion requests.
 *
 * SECURITY: DeletionRequest is RLS-closed to all direct client access. This
 * function is the ONLY way the admin panel mutates requests. It verifies an
 * active PlatformMembership(SUPER_ADMIN) on the backend — NOT a client-side
 * isAdmin flag.
 *
 * Actions:
 *   save_notes  — update adminNotes only.
 *   cancel      — set status=Cancelled (admin dismisses a request, e.g. user
 *                 changed their mind or the request is invalid).
 *   complete    — coordinated completion of a deletion. Performed AFTER the
 *                 administrator has removed the Base44 authentication identity
 *                 via the Base44 Dashboard (manual, no API). This action:
 *                   1. Refuses if the user is the sole active General Manager of
 *                      any company (would strand the company — transfer ownership
 *                      first). Respects company ownership / sole-admin rules.
 *                   2. Deletes the user's personal Notification records.
 *                   3. Marks the user's active CompanyMemberships as 'removed'
 *                      (revokes company access; preserves roster history). Does
 *                      NOT touch company-owned Jobs/SectionContent/SOPs.
 *                   4. Revokes any active PlatformMembership for the user.
 *                   5. Sets status=Completed, appDataDeletedAt,
 *                      authIdentityDeletedAt, completedAt.
 *
 * LIFECYCLE (accurate statuses — submitting a request is NOT a completed deletion):
 *   - Request received / Pending: deleteAccount created the record; appDataDeletedAt
 *     and authIdentityDeletedAt are null.
 *   - Completed: this action ran the coordinated cleanup AND the admin removed
 *     the auth identity via the Dashboard.
 *   - Cancelled: the request was dismissed without deletion.
 *
 * Existing records are preserved; only the authorized request record is updated.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { requirePlatformSuperAdmin } from '../../shared/platformAuth.ts';

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { action, requestId, adminNotes } = body;
    if (!action) return Response.json({ error: 'action is required' }, { status: 400 });

    const { user, error: authError } = await requirePlatformSuperAdmin(base44);
    if (authError) return authError;

    const SR = base44.asServiceRole;
    const now = new Date().toISOString();

    // ── save_notes ─────────────────────────────────────────────────────────────
    if (action === 'save_notes') {
      if (!requestId) return Response.json({ error: 'requestId is required' }, { status: 400 });
      const existing = await SR.entities.DeletionRequest.get(requestId).catch(() => null);
      if (!existing) return Response.json({ error: 'Request not found' }, { status: 404 });
      const updated = await SR.entities.DeletionRequest.update(requestId, {
        adminNotes: adminNotes ?? existing.adminNotes ?? '',
      });
      return Response.json({ success: true, request: updated });
    }

    // ── cancel ─────────────────────────────────────────────────────────────────
    if (action === 'cancel') {
      if (!requestId) return Response.json({ error: 'requestId is required' }, { status: 400 });
      const existing = await SR.entities.DeletionRequest.get(requestId).catch(() => null);
      if (!existing) return Response.json({ error: 'Request not found' }, { status: 404 });
      if (existing.status !== 'Pending') {
        return Response.json({ error: 'Only pending requests can be cancelled' }, { status: 409 });
      }
      const updated = await SR.entities.DeletionRequest.update(requestId, {
        status: 'Cancelled',
        adminNotes: adminNotes ?? existing.adminNotes ?? '',
      });
      return Response.json({ success: true, request: updated });
    }

    // ── complete ──────────────────────────────────────────────────────────────
    if (action === 'complete') {
      if (!requestId) return Response.json({ error: 'requestId is required' }, { status: 400 });
      const existing = await SR.entities.DeletionRequest.get(requestId).catch(() => null);
      if (!existing) return Response.json({ error: 'Request not found' }, { status: 404 });
      if (existing.status !== 'Pending') {
        return Response.json({ error: 'Only pending requests can be completed' }, { status: 409 });
      }

      const targetUserId = existing.userId;

      // (1) Sole-active-GM guard — refuse to strand a company.
      const memberships = await SR.entities.CompanyMembership.filter({
        userId: targetUserId, status: 'active',
      }).catch(() => []);
      const activeMems = memberships || [];
      for (const m of activeMems) {
        if (m.role === 'general_manager') {
          const companyGMs = await SR.entities.CompanyMembership.filter({
            companyId: m.companyId, role: 'general_manager', status: 'active',
          }).catch(() => []);
          const otherActiveGMs = (companyGMs || []).filter((g: any) => g.userId !== targetUserId);
          if (otherActiveGMs.length === 0) {
            return Response.json({
              error: 'Cannot complete: this user is the sole active General Manager of a company. Transfer ownership to another General Manager before completing deletion.',
              code: 'SOLE_COMPANY_OWNER',
            }, { status: 409 });
          }
        }
      }

      // (2) Delete the user's personal Notifications (personal data; safe).
      //     Does not affect any company or shared SOP content.
      await SR.entities.Notification.deleteMany({ userId: targetUserId }).catch(() => {});

      // (3) Mark the user's active company memberships as removed (revokes
      //     company access; preserves roster history). Company-owned Jobs,
      //     SectionContent, and SOPs are NEVER touched here.
      for (const m of activeMems) {
        await SR.entities.CompanyMembership.update(m.id, {
          status: 'removed', removedAt: now,
        }).catch(() => {});
      }

      // (4) Revoke any active PlatformMembership (platform admin access) for
      //     the deleted user. The sole-platform-admin guard in deleteAccount
      //     already prevents the last platform admin from requesting deletion,
      //     so other platform admins remain.
      const platMems = await SR.entities.PlatformMembership.filter({
        userId: targetUserId, status: 'ACTIVE',
      }).catch(() => []);
      for (const pm of (platMems || [])) {
        await SR.entities.PlatformMembership.update(pm.id, {
          status: 'SUSPENDED',
          suspendedByUserId: user.id,
          suspendedAt: now,
          suspensionReason: 'ACCOUNT_DELETED',
          updatedAt: now,
        }).catch(() => {});
      }

      // (5) Mark the deletion request Completed. The administrator is
      //     responsible for removing the Base44 authentication identity via the
      //     Base44 Dashboard (manual, no API) BEFORE calling this action; the
      //     admin UI checklist enforces that order.
      const updated = await SR.entities.DeletionRequest.update(requestId, {
        status: 'Completed',
        appDataDeletedAt: now,
        authIdentityDeletedAt: now,
        completedAt: now,
        adminNotes: adminNotes ?? existing.adminNotes ?? '',
      });

      return Response.json({ success: true, request: updated });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}