/**
 * manageDeletionRequest — Platform Super Admin processing of account-deletion requests.
 *
 * SECURITY: DeletionRequest is RLS-closed to all direct client access. This
 * function is the ONLY way the admin panel reads/processed requests. It
 * verifies an active PlatformMembership(SUPER_ADMIN) on the backend — NOT a
 * client-side flag.
 *
 * CORRECTED DELETION SEQUENCE (issue 2):
 *   preflight  — checks EVERY precondition BEFORE the admin removes the auth
 *                identity. The admin must NOT remove the identity until this
 *                returns canProceed=true. Checks: sole-active-GM protection,
 *                last-platform-super-admin protection, current membership state.
 *   complete   — re-runs preflight (defense in depth), then performs the
 *                personal-data cleanup, then marks Completed. Requires the
 *                admin to explicitly attest (authIdentityRemoved: true) that
 *                they removed the Base44 auth identity in the Dashboard.
 *                authIdentityDeletedAt is a MANUAL ATTESTATION — Base44 exposes
 *                no API to verify identity removal, so the timestamp records the
 *                admin's confirmation, not an automatically verified event.
 *                If any REQUIRED cleanup fails, the request is NOT marked
 *                Completed (returns 500 with cleanupErrors; admin retries).
 *   save_notes — update adminNotes only.
 *   cancel     — set status=Cancelled (admin dismisses a request).
 *
 * PERSONAL-DATA CLEANUP (issue 3) — what is deleted vs retained:
 *   DELETED (personal): the user's Notification records.
 *   REVOKED, record retained (personal access grants; retained for roster/audit):
 *     CompanyMembership -> 'removed'; PlatformMembership -> SUSPENDED.
 *   CANCELLED (personal email reference): pending CompanyInvitations to the
 *     user's email.
 *   MANUAL (auth identity): removed by the admin in the Base44 Dashboard;
 *     attested here, not verified by API.
 *   RETAINED (shared company operational / audit data — references the user but
 *     is NOT the user's personal data): Jobs, JobSections, SectionContent,
 *     ActivityLog, PlatformAuditLog, EditRequest, JobRevision, JobOverride,
 *     CompanyResource, CompanyPdfAttachment, CompanyVersionAnalysis/Decision/
 *     Deferral, TemporaryEditGrant, DistributionEvent, ProvisioningRecord,
 *     CompanyLibraryProvisioningRun, RollbackMutation. Membership status
 *     changing to 'removed' revokes access; it is NOT claimed as data deletion.
 *
 * COMPLETION CONFIRMATION: when cleanup succeeds, a best-effort email is sent to
 * the user's registered address (their account can no longer receive in-app
 * notifications). SendEmail to a non-registered address requires a connected
 * custom email domain on a paid plan; if unavailable the send is skipped
 * silently and the admin sees the Completed status in the panel.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { requirePlatformSuperAdmin } from '../../shared/platformAuth.ts';

// ── Preflight: check every precondition BEFORE the auth identity is removed ──
// Runs in BOTH the `preflight` action (so the admin sees blockers first) and
// the `complete` action (defense in depth, right before cleanup).
async function runPreflight(SR: any, targetUserId: string) {
  const blockers: { code: string; message: string }[] = [];

  // (a) Sole-active-GM guard — refuse to strand a company.
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
        blockers.push({
          code: 'SOLE_COMPANY_OWNER',
          message: 'This user is the sole active General Manager of a company. Transfer ownership to another General Manager before deleting.',
        });
        break;
      }
    }
  }

  // (b) Last-platform-super-admin guard — refuse to leave the platform with no
  //     active super admin. If the target holds an active SUPER_ADMIN
  //     PlatformMembership, there must be at least one OTHER active super admin.
  const targetPlatMems = await SR.entities.PlatformMembership.filter({
    userId: targetUserId, status: 'ACTIVE',
  }).catch(() => []);
  const isPlatformAdmin = (targetPlatMems || []).some((pm: any) => pm.platformRole === 'SUPER_ADMIN');
  if (isPlatformAdmin) {
    const allActiveAdmins = await SR.entities.PlatformMembership.filter({
      status: 'ACTIVE', platformRole: 'SUPER_ADMIN',
    }).catch(() => []);
    const otherActiveAdmins = (allActiveAdmins || []).filter((pm: any) => pm.userId !== targetUserId);
    if (otherActiveAdmins.length === 0) {
      blockers.push({
        code: 'SOLE_PLATFORM_ADMIN',
        message: 'This user is the last active Platform Super Admin. Appoint another Platform Super Admin before deleting.',
      });
    }
  }

  return { canProceed: blockers.length === 0, blockers, activeMemberships: activeMems };
}

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

    // ── preflight ────────────────────────────────────────────────────────────
    if (action === 'preflight') {
      if (!requestId) return Response.json({ error: 'requestId is required' }, { status: 400 });
      const existing = await SR.entities.DeletionRequest.get(requestId).catch(() => null);
      if (!existing) return Response.json({ error: 'Request not found' }, { status: 404 });
      if (existing.status !== 'Pending') {
        return Response.json({ error: 'Only pending requests can be prefchecked' }, { status: 409 });
      }
      const preflight = await runPreflight(SR, existing.userId);
      return Response.json({
        success: true,
        canProceed: preflight.canProceed,
        blockers: preflight.blockers,
        target: { userId: existing.userId, userEmail: existing.userEmail, userName: existing.userName },
      });
    }

    // ── save_notes ───────────────────────────────────────────────────────────
    if (action === 'save_notes') {
      if (!requestId) return Response.json({ error: 'requestId is required' }, { status: 400 });
      const existing = await SR.entities.DeletionRequest.get(requestId).catch(() => null);
      if (!existing) return Response.json({ error: 'Request not found' }, { status: 404 });
      const updated = await SR.entities.DeletionRequest.update(requestId, {
        adminNotes: adminNotes ?? existing.adminNotes ?? '',
      });
      return Response.json({ success: true, request: updated });
    }

    // ── cancel ───────────────────────────────────────────────────────────────
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

    // ── complete ─────────────────────────────────────────────────────────────
    if (action === 'complete') {
      if (!requestId) return Response.json({ error: 'requestId is required' }, { status: 400 });
      const existing = await SR.entities.DeletionRequest.get(requestId).catch(() => null);
      if (!existing) return Response.json({ error: 'Request not found' }, { status: 404 });
      if (existing.status !== 'Pending') {
        return Response.json({ error: 'Only pending requests can be completed' }, { status: 409 });
      }

      // The admin must attest that they removed the auth identity in the
      // Dashboard. Base44 exposes no API to verify identity removal, so this is
      // a MANUAL ATTESTATION; authIdentityDeletedAt records that attestation,
      // not an automatically verified platform event.
      if (!body.authIdentityRemoved) {
        return Response.json({
          error: 'You must confirm that the authentication identity has been removed in the Base44 Dashboard before completing.',
          code: 'ATTESTATION_REQUIRED',
        }, { status: 400 });
      }

      const targetUserId = existing.userId;

      // Re-run preflight (defense in depth) BEFORE any cleanup / status change.
      const preflight = await runPreflight(SR, targetUserId);
      if (!preflight.canProceed) {
        return Response.json({
          error: 'Prerequisites not met. Resolve the blockers before completing.',
          code: 'PREFLIGHT_FAILED',
          blockers: preflight.blockers,
        }, { status: 409 });
      }

      // ── Coordinated cleanup of personal data ──
      const cleanupErrors: string[] = [];

      // (1) DELETE personal Notifications (personal data; hard-deleted).
      try {
        await SR.entities.Notification.deleteMany({ userId: targetUserId });
      } catch (e: any) {
        cleanupErrors.push(`notifications: ${e?.message || 'delete failed'}`);
      }

      // (2) REVOKE active company memberships (access revoked; record retained
      //     for roster/audit history). Company-owned Jobs/SectionContent/SOPs
      //     are NEVER touched.
      for (const m of preflight.activeMemberships) {
        try {
          await SR.entities.CompanyMembership.update(m.id, {
            status: 'removed', removedAt: now,
          });
        } catch (e: any) {
          cleanupErrors.push(`membership ${m.id}: ${e?.message || 'update failed'}`);
        }
      }

      // (3) REVOKE active PlatformMembership (platform admin access; retained).
      const platMems = await SR.entities.PlatformMembership.filter({
        userId: targetUserId, status: 'ACTIVE',
      }).catch(() => []);
      for (const pm of (platMems || [])) {
        try {
          await SR.entities.PlatformMembership.update(pm.id, {
            status: 'SUSPENDED',
            suspendedByUserId: user.id,
            suspendedAt: now,
            suspensionReason: 'ACCOUNT_DELETED',
            updatedAt: now,
          });
        } catch (e: any) {
          cleanupErrors.push(`platformMembership ${pm.id}: ${e?.message || 'update failed'}`);
        }
      }

      // (4) CANCEL pending invitations to the user's email (best-effort personal
      //     email reference; does not block completion if it fails).
      try {
        const pendingInvites = await SR.entities.CompanyInvitation.filter({
          invitedEmail: existing.userEmail, status: 'pending',
        }).catch(() => []);
        for (const inv of (pendingInvites || [])) {
          await SR.entities.CompanyInvitation.update(inv.id, {
            status: 'cancelled', cancelledAt: now,
          }).catch(() => {});
        }
      } catch (_) { /* best-effort */ }

      // (5) If any REQUIRED cleanup failed, do NOT mark Completed. Leave the
      //     request Pending so the admin can retry. (Invitation cancel is
      //     best-effort and excluded from cleanupErrors.)
      if (cleanupErrors.length > 0) {
        return Response.json({
          error: 'Cleanup failed for one or more personal-data items. The request remains Pending. Retry after resolving the errors.',
          code: 'CLEANUP_FAILED',
          cleanupErrors,
        }, { status: 500 });
      }

      // (6) All required cleanup succeeded. Mark Completed.
      //     authIdentityDeletedAt is the admin's manual attestation (verified
      //     above), not an automatically verified platform event.
      const updated = await SR.entities.DeletionRequest.update(requestId, {
        status: 'Completed',
        appDataDeletedAt: now,
        authIdentityDeletedAt: now,
        completedAt: now,
        adminNotes: adminNotes ?? existing.adminNotes ?? '',
      });

      // (7) Best-effort completion-confirmation email to the user's registered
      //     address (their account can no longer receive in-app notifications).
      try {
        await base44.integrations.Core.SendEmail({
          to: existing.userEmail,
          subject: 'Your Essential SOP account deletion is complete',
          body: `Hello ${existing.userName || ''},\n\nYour Essential SOP account deletion has been completed. Your login identity and personal data (notifications, company memberships, and pending invitations) have been removed or revoked. Company-owned standard operating procedures and audit records are retained as part of normal business operations.\n\nYou will not be able to sign in again.\n\n— Essential SOP`,
        });
      } catch (_) { /* best-effort; do not fail completion */ }

      return Response.json({ success: true, request: updated });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}