/**
 * manageDeletionRequest — Platform Super Admin processing of account-deletion requests.
 *
 * SECURITY: DeletionRequest is RLS-closed to all direct client access. This
 * function is the ONLY way the admin panel reads/processed requests. It
 * verifies an active PlatformMembership(SUPER_ADMIN) on the backend — NOT a
 * client-side flag.
 *
 * DELETION SEQUENCE:
 *   preflight  — checks EVERY precondition BEFORE the admin removes the auth
 *                identity. The admin must NOT remove the identity until this
 *                returns canProceed=true. Checks:
 *                  - sole GM of a company WITH other active members and no other
 *                    GM → blocker (transfer ownership first).
 *                  - sole owner and ONLY active member of a company (single-
 *                    person workspace, e.g. a Homeowner) → NOT a blocker; the
 *                    workspace is closed (status='closed') during completion.
 *                    This reuses the existing Close-Company-Workspace concept
 *                    (Company.status='closed'); it does not delete company data.
 *                  - last active Platform Super Admin → blocker.
 *   complete   — re-runs preflight (defense in depth), closes any single-person
 *                workspaces, performs personal-data cleanup, attempts a
 *                completion-confirmation email, and marks Completed. Requires
 *                the admin to explicitly attest (authIdentityRemoved: true)
 *                that the Base44 auth identity was removed in the Dashboard.
 *                If any REQUIRED step fails, the request is NOT marked
 *                Completed (returns 500 with cleanupErrors; admin retries).
 *   record_notification — admin records an alternative verified channel used
 *                to inform the user when email delivery was not accepted.
 *   save_notes — update adminNotes only.
 *   cancel     — set status=Cancelled (admin dismisses a request).
 *
 * SINGLE-OWNER DELETION (issue 1):
 *   - Initiation (deleteAccount) is NOT blocked for a sole company owner; the
 *     sole-admin guard there is platform-only (User.role='admin'). A sole
 *     owner can always request deletion.
 *   - At completion, a single-person company (sole owner + only active member)
 *     is CLOSED (status='closed'); its SOPs/resources/audit records are
 *     retained (closed, not deleted). No second account or person is required.
 *   - A sole GM with OTHER active members (no other GM) remains a blocker —
 *     ownership must be transferred first (multi-member safeguard preserved).
 *
 * PERSONAL-DATA CLEANUP (issue 3) — deleted vs retained, reviewed per category:
 *   DELETED (personal): the user's Notification records.
 *   REVOKED, record retained (personal access grants; retained for roster/audit):
 *     CompanyMembership -> 'removed'; PlatformMembership -> SUSPENDED.
 *   CANCELLED (personal email reference): pending CompanyInvitations to the
 *     user's email.
 *   CLOSED, data retained (single-person workspace): Company.status='closed'.
 *   MANUAL (auth identity): removed by the admin in the Dashboard; attested.
 *   RETAINED (shared company operational / audit data — reference the user but
 *     are NOT the user's personal data): Jobs, JobSections, SectionContent,
 *     JobOverride, JobRevision, EditRequest (incl. requester reason/supporting
 *     note — part of the company SOP-governance record), CompanyResource,
 *     CompanyPdfAttachment (incl. uploaded PDFs — company-owned reference
 *     docs), CompanyVersionAnalysis/Decision/Deferral, TemporaryEditGrant,
 *     ActivityLog, PlatformAuditLog, DistributionEvent, ProvisioningRecord,
 *     CompanyLibraryProvisioningRun, RollbackMutation, EssentialSOPMaster/
 *     Version/Section. Creator fields (actingUserId, requestedByUserId,
 *     createdByUserId, etc.) are retained as references to a former member
 *     within legitimate company audit and governance history, not as personal
 *     data. Membership status -> 'removed' revokes access; it is NOT claimed
 *     as personal-data deletion.
 *
 * COMPLETION NOTIFICATION (issue 2):
 *   complete attempts SendEmail to the user's registered address and records
 *   notificationStatus based on whether the sending service ACCEPTED delivery
 *   (resolved without error/throw) — it never claims an email was sent when it
 *   was not accepted. On failure (notificationStatus='email_failed'), the admin
 *   must notify the user via an alternative verified channel and record it via
 *   record_notification (notificationStatus='admin_notified'). Deletion status,
 *   identity-removal attestation, app-data cleanup, and notification status are
 *   four independent, distinguishable fields.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { requirePlatformSuperAdmin } from '../../shared/platformAuth.ts';

// ── Preflight: check every precondition BEFORE the auth identity is removed ──
async function runPreflight(SR: any, targetUserId: string) {
  const blockers: { code: string; message: string; companyId?: string }[] = [];
  const singleOwnerCompanies: { companyId: string; companyName: string }[] = [];

  const memberships = await SR.entities.CompanyMembership.filter({
    userId: targetUserId, status: 'active',
  }).catch(() => []);
  const activeMems = memberships || [];

  // Evaluate each company where the target is an active General Manager.
  const gmCompanyIds = Array.from(new Set(
    activeMems.filter((m: any) => m.role === 'general_manager').map((m: any) => m.companyId)
  ));
  for (const cid of gmCompanyIds) {
    const companyMembers = await SR.entities.CompanyMembership.filter({
      companyId: cid, status: 'active',
    }).catch(() => []);
    const others = (companyMembers || []).filter((m: any) => m.userId !== targetUserId);
    const otherGMs = others.filter((m: any) => m.role === 'general_manager');
    if (otherGMs.length > 0) continue; // shared ownership — fine
    const company = await SR.entities.Company.get(cid).catch(() => null);
    const name = company?.name || cid;
    if (others.length > 0) {
      // Sole GM with other active employees, no other GM — must transfer.
      blockers.push({
        code: 'SOLE_GM_WITH_EMPLOYEES',
        message: `This user is the sole General Manager of "${name}" which has other active members. Transfer ownership (or remove the other members) before deleting.`,
        companyId: cid,
      });
    } else {
      // Single-person company — close during completion, not a blocker.
      singleOwnerCompanies.push({ companyId: cid, companyName: name });
    }
  }

  // Last active Platform Super Admin guard.
  const targetPlatMems = await SR.entities.PlatformMembership.filter({
    userId: targetUserId, status: 'ACTIVE',
  }).catch(() => []);
  const isPlatformAdmin = (targetPlatMems || []).some((pm: any) => pm.platformRole === 'SUPER_ADMIN');
  if (isPlatformAdmin) {
    const allActiveAdmins = await SR.entities.PlatformMembership.filter({
      status: 'ACTIVE', platformRole: 'SUPER_ADMIN',
    }).catch(() => []);
    const otherAdmins = (allActiveAdmins || []).filter((pm: any) => pm.userId !== targetUserId);
    if (otherAdmins.length === 0) {
      blockers.push({
        code: 'SOLE_PLATFORM_ADMIN',
        message: 'This user is the last active Platform Super Admin. Appoint another Platform Super Admin before deleting.',
      });
    }
  }

  return { canProceed: blockers.length === 0, blockers, singleOwnerCompanies, activeMemberships: activeMems };
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
        singleOwnerCompanies: preflight.singleOwnerCompanies,
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

    // ── record_notification ──────────────────────────────────────────────────
    if (action === 'record_notification') {
      if (!requestId) return Response.json({ error: 'requestId is required' }, { status: 400 });
      const existing = await SR.entities.DeletionRequest.get(requestId).catch(() => null);
      if (!existing) return Response.json({ error: 'Request not found' }, { status: 404 });
      if (existing.status !== 'Completed') {
        return Response.json({ error: 'Notifications can only be recorded for completed requests' }, { status: 409 });
      }
      const userNotifiedVia = (body.userNotifiedVia || '').toString().trim();
      if (!userNotifiedVia) {
        return Response.json({ error: 'userNotifiedVia is required (the verified channel used)' }, { status: 400 });
      }
      const updated = await SR.entities.DeletionRequest.update(requestId, {
        notificationStatus: 'admin_notified',
        userNotifiedVia,
        userNotifiedAt: now,
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

      // Manual identity-removal attestation (Base44 has no API to verify this).
      if (!body.authIdentityRemoved) {
        return Response.json({
          error: 'You must confirm that the authentication identity has been removed in the Base44 Dashboard before completing.',
          code: 'ATTESTATION_REQUIRED',
        }, { status: 400 });
      }

      const targetUserId = existing.userId;

      // Re-run preflight (defense in depth).
      const preflight = await runPreflight(SR, targetUserId);
      if (!preflight.canProceed) {
        return Response.json({
          error: 'Prerequisites not met. Resolve the blockers before completing.',
          code: 'PREFLIGHT_FAILED',
          blockers: preflight.blockers,
        }, { status: 409 });
      }

      const cleanupErrors: string[] = [];
      const closedCompanyIds: string[] = [];

      // (1) CLOSE single-person workspaces (reuse Close-Company concept:
      //     Company.status='closed'). Company data is retained (closed, not
      //     deleted). Audit the closure.
      for (const c of preflight.singleOwnerCompanies) {
        try {
          await SR.entities.Company.update(c.companyId, { status: 'closed' });
          closedCompanyIds.push(c.companyId);
          try {
            await SR.entities.ActivityLog.create({
              companyId: c.companyId,
              actingUserId: user.id,
              actionType: 'account_deletion_requested',
              summary: `Workspace "${c.companyName}" closed by administrator as part of account deletion for ${existing.userEmail}.`,
              timestamp: now,
            });
          } catch (_) { /* audit best-effort */ }
        } catch (e: any) {
          cleanupErrors.push(`close company ${c.companyId}: ${e?.message || 'update failed'}`);
        }
      }

      // (2) DELETE personal Notifications.
      try {
        await SR.entities.Notification.deleteMany({ userId: targetUserId });
      } catch (e: any) {
        cleanupErrors.push(`notifications: ${e?.message || 'delete failed'}`);
      }

      // (3) REVOKE active company memberships (access revoked; record retained).
      for (const m of preflight.activeMemberships) {
        try {
          await SR.entities.CompanyMembership.update(m.id, {
            status: 'removed', removedAt: now,
          });
        } catch (e: any) {
          cleanupErrors.push(`membership ${m.id}: ${e?.message || 'update failed'}`);
        }
      }

      // (4) REVOKE active PlatformMembership (platform admin access; retained).
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

      // (5) CANCEL pending invitations to the user's email (best-effort).
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

      // (6) If any REQUIRED step failed, do NOT mark Completed.
      if (cleanupErrors.length > 0) {
        return Response.json({
          error: 'One or more required steps failed. The request remains Pending. Retry after resolving the errors.',
          code: 'CLEANUP_FAILED',
          cleanupErrors,
        }, { status: 500 });
      }

      // (7) Attempt completion-confirmation email. Record notificationStatus
      //     based on whether the sending service ACCEPTED delivery (resolved
      //     without error/throw). Never claim sent if not accepted.
      let notificationStatus = 'pending';
      let notificationError = '';
      try {
        const r: any = await base44.integrations.Core.SendEmail({
          to: existing.userEmail,
          subject: 'Your Essential SOP account deletion is complete',
          body: `Hello ${existing.userName || ''},\n\nYour Essential SOP account deletion has been completed. Your login identity and personal data (notifications, company memberships, and pending invitations) have been removed or revoked. ${preflight.singleOwnerCompanies.length ? 'Your single-member workspace(s) have been closed. ' : ''}Company-owned standard operating procedures and audit records are retained as part of normal business operations.\n\nYou will not be able to sign in again.\n\n— Essential SOP`,
        });
        if (r && (r.error || r.success === false)) {
          notificationStatus = 'email_failed';
          notificationError = String(r.error || 'sending service rejected the request');
        } else {
          notificationStatus = 'email_sent';
        }
      } catch (e: any) {
        notificationStatus = 'email_failed';
        notificationError = e?.message || 'SendEmail threw';
      }

      // (8) Mark Completed. Four independent signals: status, authIdentityDeletedAt
      //     (attestation), appDataDeletedAt (cleanup), notificationStatus.
      const updated = await SR.entities.DeletionRequest.update(requestId, {
        status: 'Completed',
        appDataDeletedAt: now,
        authIdentityDeletedAt: now,
        completedAt: now,
        notificationStatus,
        notificationError,
        closedCompanyIds,
        adminNotes: adminNotes ?? existing.adminNotes ?? '',
      });

      return Response.json({ success: true, request: updated });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}