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

// ── Company-deletion lifecycle notification to the requesting GM ──────────────
// Best-effort in-app notification. Used for approve/reject. Completion uses
// SendEmail because the GM's access to the deleted company ends at execution.
async function notifyCompanyDeletion(SR: any, req: any, type: string, title: string, body: string) {
  try {
    await SR.entities.Notification.create({
      companyId: req.companyId,
      userId: req.requestedByUserId,
      type,
      title,
      body,
      targetType: 'company',
      targetId: req.companyId,
    });
  } catch (_) { /* best-effort */ }
}

// Records the REAL delivery outcome of the company-deletion completion email.
// Never claims sent when the sending service did not accept the request, and
// never throws — a notification problem must NOT imply the deletion failed or
// recreate any deleted data. Returns { notificationStatus, notificationError }.
async function sendCompanyCompletionEmail(base44: any, req: any) {
  try {
    const r: any = await base44.integrations.Core.SendEmail({
      to: req.userEmail,
      subject: 'Your Essential SOP workspace deletion is complete',
      body: `Hello ${req.userName || ''},\n\nYour company workspace "${req.companyName}" has been permanently deleted, including its SOP library, resources, attachments, memberships, and associated operational data. Your Essential SOP login and any other workspaces you belong to were not affected.\n\n— Essential SOP`,
    });
    if (r && (r.error || r.success === false)) {
      return { notificationStatus: 'email_failed', notificationError: String(r.error || 'sending service rejected the request') };
    }
    return { notificationStatus: 'email_sent', notificationError: '' };
  } catch (e: any) {
    return { notificationStatus: 'email_failed', notificationError: e?.message || 'SendEmail threw' };
  }
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
      if (existing.requestType === 'COMPANY_DELETION') {
        return Response.json({ error: 'This is a company deletion request. Use preflight_company.' }, { status: 400 });
      }
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
      if (existing.requestType === 'COMPANY_DELETION') {
        return Response.json({ error: 'Company deletion requests cannot be cancelled; use reject_company.' }, { status: 400 });
      }
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
      if (existing.requestType === 'COMPANY_DELETION') {
        return Response.json({ error: 'Company deletion completion notifications are sent by email. Use save_notes for notes.' }, { status: 400 });
      }
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
      if (existing.requestType === 'COMPANY_DELETION') {
        return Response.json({ error: 'This is a company deletion request. Use execute_company_deletion after approve_company.' }, { status: 400 });
      }
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

    // ── preflight_company ───────────────────────────────────────────────────
    // Displays the company, requesting GM, affected memberships, and scope of
    // the deletion BEFORE any approval/execution. Revalidates the requester's
    // GM authorization and the company state. Does NOT delete anything.
    if (action === 'preflight_company') {
      if (!requestId) return Response.json({ error: 'requestId is required' }, { status: 400 });
      const existing = await SR.entities.DeletionRequest.get(requestId).catch(() => null);
      if (!existing) return Response.json({ error: 'Request not found' }, { status: 404 });
      if (existing.requestType !== 'COMPANY_DELETION') {
        return Response.json({ error: 'Not a company deletion request' }, { status: 400 });
      }
      if (existing.status !== 'Pending' && existing.status !== 'Approved') {
        return Response.json({ error: 'Only pending or approved requests can be scoped' }, { status: 409 });
      }
      const cid = existing.companyId;
      const requesterMems = await SR.entities.CompanyMembership.filter({ companyId: cid, userId: existing.requestedByUserId, status: 'active' }).catch(() => []);
      const requesterStillGm = (requesterMems || []).some((m: any) => m.role === 'general_manager');
      const company = await SR.entities.Company.get(cid).catch(() => null);
      const members = await SR.entities.CompanyMembership.filter({ companyId: cid, status: 'active' }).catch(() => []);
      const jobCount = await SR.entities.Job.count({ companyId: cid }).catch(() => 0);
      const resourceCount = await SR.entities.CompanyResource.count({ companyId: cid }).catch(() => 0);
      const pdfCount = await SR.entities.CompanyPdfAttachment.count({ companyId: cid }).catch(() => 0);
      const blockers: { code: string; message: string }[] = [];
      if (!requesterStillGm) blockers.push({ code: 'REQUESTER_NO_LONGER_GM', message: 'The requesting General Manager is no longer an active GM of this company.' });
      if (!company) blockers.push({ code: 'COMPANY_GONE', message: 'The company no longer exists.' });
      else if (company.status === 'closed') blockers.push({ code: 'COMPANY_CLOSED', message: 'The company is already closed.' });
      return Response.json({
        success: true,
        canProceed: blockers.length === 0,
        blockers,
        status: existing.status,
        scope: {
          companyName: company?.name || existing.companyName,
          companyId: cid,
          requester: { userId: existing.requestedByUserId, name: existing.userName, email: existing.userEmail, stillGm: requesterStillGm },
          activeMemberships: (members || []).map((m: any) => ({ userId: m.userId, role: m.role })),
          counts: { jobs: jobCount, resources: resourceCount, pdfs: pdfCount, memberships: (members || []).length },
        },
      });
    }

    // ── approve_company (SUPER_ADMIN only — already enforced above) ──────────
    // Pending → Approved. Revalidates requester authorization + company state at
    // approval time. Company data is NOT touched. Notifies the requesting GM.
    if (action === 'approve_company') {
      if (!requestId) return Response.json({ error: 'requestId is required' }, { status: 400 });
      const existing = await SR.entities.DeletionRequest.get(requestId).catch(() => null);
      if (!existing) return Response.json({ error: 'Request not found' }, { status: 404 });
      if (existing.requestType !== 'COMPANY_DELETION') return Response.json({ error: 'Not a company deletion request' }, { status: 400 });
      if (existing.status !== 'Pending') return Response.json({ error: 'Only pending requests can be approved' }, { status: 409 });
      const mems = await SR.entities.CompanyMembership.filter({ companyId: existing.companyId, userId: existing.requestedByUserId, status: 'active' }).catch(() => []);
      const stillGm = (mems || []).some((m: any) => m.role === 'general_manager');
      const company = await SR.entities.Company.get(existing.companyId).catch(() => null);
      if (!stillGm) return Response.json({ error: 'The requesting General Manager is no longer an active GM. Cannot approve.', code: 'REQUESTER_NO_LONGER_GM' }, { status: 409 });
      if (!company || company.status === 'closed') return Response.json({ error: 'The company no longer exists or is already closed.', code: 'COMPANY_GONE' }, { status: 409 });
      const updated = await SR.entities.DeletionRequest.update(requestId, {
        status: 'Approved', reviewerUserId: user.id, reviewedAt: now,
        adminNotes: adminNotes ?? existing.adminNotes ?? '',
      });
      await notifyCompanyDeletion(SR, existing, 'company_deletion_approved', 'Company deletion approved',
        `Your request to delete "${existing.companyName}" has been approved by Essential SOP administration. The irreversible deletion will be processed separately; you will be notified when it is complete.`);
      return Response.json({ success: true, request: updated });
    }

    // ── reject_company (SUPER_ADMIN only) ────────────────────────────────────
    // Pending → Rejected. Company data is NOT touched. Notifies the requesting GM.
    if (action === 'reject_company') {
      if (!requestId) return Response.json({ error: 'requestId is required' }, { status: 400 });
      const existing = await SR.entities.DeletionRequest.get(requestId).catch(() => null);
      if (!existing) return Response.json({ error: 'Request not found' }, { status: 404 });
      if (existing.requestType !== 'COMPANY_DELETION') return Response.json({ error: 'Not a company deletion request' }, { status: 400 });
      if (existing.status !== 'Pending') return Response.json({ error: 'Only pending requests can be rejected' }, { status: 409 });
      const rejectionReason = (body.rejectionReason || '').toString().trim();
      const updated = await SR.entities.DeletionRequest.update(requestId, {
        status: 'Rejected', reviewerUserId: user.id, reviewedAt: now, rejectionReason,
        adminNotes: adminNotes ?? existing.adminNotes ?? '',
      });
      await notifyCompanyDeletion(SR, existing, 'company_deletion_rejected', 'Company deletion declined',
        `Your request to delete "${existing.companyName}" was declined by Essential SOP administration.${rejectionReason ? ` Reason: ${rejectionReason}` : ''} The workspace and all its data remain unchanged.`);
      return Response.json({ success: true, request: updated });
    }

    // ── execute_company_deletion (irreversible; idempotent; separate confirmation) ─
    // Approved (or Failed on retry) → deletes company-owned operational data.
    // Idempotent: every step is a companyId-scoped deleteMany that is a no-op on
    // records already removed, so a retry after a partial failure safely sweeps
    // the remaining work (and any records created since the last attempt — the
    // company cannot silently retain new operational data).
    // GM revalidation is enforced on the FIRST run (company still present). On
    // a retry after the company record was removed, the GM membership is already
    // gone so revalidation is impossible; we proceed to residual cleanup
    // without bypassing the prior approval (a Failed request was previously
    // Approved). Platform-owned Master Library records are never deleted.
    if (action === 'execute_company_deletion') {
      if (!requestId) return Response.json({ error: 'requestId is required' }, { status: 400 });
      const existing = await SR.entities.DeletionRequest.get(requestId).catch(() => null);
      if (!existing) return Response.json({ error: 'Request not found' }, { status: 404 });
      if (existing.requestType !== 'COMPANY_DELETION') return Response.json({ error: 'Not a company deletion request' }, { status: 400 });
      if (existing.status !== 'Approved' && existing.status !== 'Failed') {
        return Response.json({ error: 'Only approved or previously-failed requests can be executed. Approve first.' }, { status: 409 });
      }

      const cid = existing.companyId;
      const company = await SR.entities.Company.get(cid).catch(() => null);

      // Revalidate authorization ONLY on the FIRST run (status === 'Approved').
      // On a retry (status === 'Failed') the GM membership may already have been
      // revoked by the earlier partial execution, so revalidating now would
      // incorrectly block the retry with REQUESTER_NO_LONGER_GM. The prior
      // approval (reviewerUserId/reviewedAt) is the verified authorization; we
      // proceed to idempotent residual cleanup without re-checking the GM and
      // without granting the former GM any new privilege.
      if (existing.status === 'Approved') {
        if (!company) return Response.json({ error: 'The company no longer exists.', code: 'COMPANY_GONE' }, { status: 409 });
        const mems = await SR.entities.CompanyMembership.filter({ companyId: cid, userId: existing.requestedByUserId, status: 'active' }).catch(() => []);
        const stillGm = (mems || []).some((m: any) => m.role === 'general_manager');
        if (!stillGm) return Response.json({ error: 'The requesting General Manager is no longer an active GM. Execution aborted.', code: 'REQUESTER_NO_LONGER_GM' }, { status: 409 });
        if (company.status === 'closed') return Response.json({ error: 'The company is already closed.', code: 'COMPANY_CLOSED' }, { status: 409 });
      }

      // Collect underlying private file URIs BEFORE deleting the metadata, so
      // the request can track outstanding file-content cleanup. Base44 exposes
      // no API to purge private storage; the admin must complete that with the
      // provider and attest. The request is NOT marked Completed until then.
      const pendingFileUris: string[] = [];
      try {
        const pdfs = await SR.entities.CompanyPdfAttachment.filter({ companyId: cid }).catch(() => []);
        for (const p of (pdfs || [])) { if (p.fileUri) pendingFileUris.push(p.fileUri); }
      } catch (_) { /* best-effort collection */ }
      try {
        const jobs = await SR.entities.Job.filter({ companyId: cid }).catch(() => []);
        for (const j of (jobs || [])) { if (j.sourceDocumentUri) pendingFileUris.push(j.sourceDocumentUri); }
      } catch (_) { /* best-effort collection */ }

      const errors: string[] = [];
      const del = async (entity: string, filter: any) => {
        try { await SR.entities[entity].deleteMany(filter); }
        catch (e: any) { errors.push(`${entity}: ${e?.message || 'delete failed'}`); }
      };
      // ── BLOCK all operational writes FIRST ──────────────────────────────────
      // The moment irreversible deletion begins, revoke the company's write-
      // authorizing state so no new operational data can appear while deletion is
      // underway (execution, Failed-retry pause, and CleanupPending). This is
      // real prevention, not a post-hoc sweep: every operational write function
      // (saveCompanyJob, saveSectionContent, manageCompanyResource,
      // manageCompanyPdf, reviewEditRequest, …) gates on getActiveMembership,
      // which filters status='active'; and submitRevision gates on an active
      // TemporaryEditGrant. Once these two are gone, those functions return 403
      // BEFORE creating any record. deleteMany is idempotent, so a retry is a
      // safe no-op on already-removed state.
      await del('CompanyMembership', { companyId: cid });
      await del('TemporaryEditGrant', { companyId: cid });
      // Company-owned operational data (companyId-scoped). deleteMany is
      // idempotent, so a retry sweeps any records created since the last attempt.
      await del('Job', { companyId: cid });
      await del('JobSection', { companyId: cid });
      await del('SectionContent', { companyId: cid });
      await del('JobOverride', { companyId: cid });
      await del('JobRevision', { companyId: cid });
      await del('EditRequest', { companyId: cid });
      await del('CompanyResource', { companyId: cid });
      await del('CompanyPdfAttachment', { companyId: cid });
      await del('CompanyVersionAnalysis', { companyId: cid });
      await del('CompanyVersionDecision', { companyId: cid });
      await del('CompanyVersionDeferral', { companyId: cid });
      await del('ActivityLog', { companyId: cid });
      await del('Notification', { companyId: cid });
      await del('CompanyInvitation', { companyId: cid });
      await del('ProvisioningRecord', { companyId: cid });
      await del('CompanyLibraryProvisioningRun', { companyId: cid });
      // Delete the company record itself, last (only if it still exists).
      if (company) {
        try { await SR.entities.Company.delete(cid); }
        catch (e: any) { errors.push(`Company: ${e?.message || 'delete failed'}`); }
      }

      if (errors.length > 0) {
        await SR.entities.DeletionRequest.update(requestId, {
          status: 'Failed',
          executionErrors: errors,
          pendingFileUris: pendingFileUris.length ? pendingFileUris : (existing.pendingFileUris || []),
          adminNotes: adminNotes ?? existing.adminNotes ?? '',
        }).catch(() => {});
        return Response.json({ error: 'One or more deletion steps failed. The request is marked Failed. Retry execute_company_deletion to complete the remaining idempotent steps.', code: 'EXECUTION_FAILED', errors, pendingFileUris }, { status: 500 });
      }

      // Metadata + company deleted. If underlying private files remain, the
      // deletion is NOT fully complete until an admin attests provider cleanup.
      const hasPendingFiles = pendingFileUris.length > 0;
      if (hasPendingFiles) {
        const updated = await SR.entities.DeletionRequest.update(requestId, {
          status: 'CleanupPending',
          executionErrors: [],
          pendingFileUris,
          fileCleanupStatus: 'pending',
          appDataDeletedAt: now,
          closedCompanyIds: [cid],
          adminNotes: adminNotes ?? existing.adminNotes ?? '',
        });
        return Response.json({
          success: true,
          request: updated,
          fileCleanupRequired: true,
          pendingFileUris,
          note: 'Company operational data deleted. Underlying private file content must be removed with the storage provider and attested via confirm_file_cleanup before the request is marked Completed.',
        });
      }

      const updated = await SR.entities.DeletionRequest.update(requestId, {
        status: 'Completed', completedAt: now, appDataDeletedAt: now,
        executionErrors: [], fileCleanupStatus: 'none', pendingFileUris: [],
        closedCompanyIds: [cid],
        adminNotes: adminNotes ?? existing.adminNotes ?? '',
      });
      // Notify the requesting GM. Record the REAL delivery outcome; never
      // claim sent if not accepted. A notification failure does NOT recreate
      // any data or imply deletion failed.
      const notif = await sendCompanyCompletionEmail(base44, existing);
      const withNotif = await SR.entities.DeletionRequest.update(requestId, {
        notificationStatus: notif.notificationStatus,
        notificationError: notif.notificationError || '',
        userNotifiedAt: notif.notificationStatus === 'email_sent' ? now : undefined,
      }).catch(() => updated);
      return Response.json({ success: true, request: withNotif });
    }

    // ── confirm_file_cleanup (SUPER_ADMIN) ───────────────────────────────────
    // Admin attests that the underlying private file content for a
    // CleanupPending request has been removed. Base44 exposes NO file-purge
    // API, so the administrator must contact Base44 support with the captured
    // pendingFileUris list, request purge of those storage objects, and obtain
    // written confirmation (a support case / ticket reference). That reference
    // is REQUIRED in fileCleanupNotes as the evidence of provider cleanup; an
    // empty attestation is rejected. Transitions to Completed and sends the
    // completion notification. Does not touch any deleted data and never
    // recreates the company.
    if (action === 'confirm_file_cleanup') {
      if (!requestId) return Response.json({ error: 'requestId is required' }, { status: 400 });
      const existing = await SR.entities.DeletionRequest.get(requestId).catch(() => null);
      if (!existing) return Response.json({ error: 'Request not found' }, { status: 404 });
      if (existing.requestType !== 'COMPANY_DELETION') return Response.json({ error: 'Not a company deletion request' }, { status: 400 });
      if (existing.status !== 'CleanupPending') return Response.json({ error: 'Only cleanup-pending requests can be confirmed' }, { status: 409 });
      const fileCleanupNotes = (body.fileCleanupNotes || '').toString().trim();
      if (!fileCleanupNotes) {
        return Response.json({ error: 'A Base44 support case reference is required as evidence that the underlying file content was purged.', code: 'EVIDENCE_REQUIRED' }, { status: 400 });
      }
      const updated = await SR.entities.DeletionRequest.update(requestId, {
        status: 'Completed', completedAt: now,
        fileCleanupStatus: 'completed',
        fileCleanupCompletedAt: now,
        fileCleanupCompletedBy: user.id,
        fileCleanupNotes,
      });
      const notif = await sendCompanyCompletionEmail(base44, existing);
      const withNotif = await SR.entities.DeletionRequest.update(requestId, {
        notificationStatus: notif.notificationStatus,
        notificationError: notif.notificationError || '',
        userNotifiedAt: notif.notificationStatus === 'email_sent' ? now : undefined,
      }).catch(() => updated);
      return Response.json({ success: true, request: withNotif });
    }

    // ── retry_company_completion_notification (SUPER_ADMIN) ───────────────────
    // Resend the completion email after a prior failure. Does NOT modify any
    // deletion state; only updates notificationStatus from the real outcome.
    if (action === 'retry_company_completion_notification') {
      if (!requestId) return Response.json({ error: 'requestId is required' }, { status: 400 });
      const existing = await SR.entities.DeletionRequest.get(requestId).catch(() => null);
      if (!existing) return Response.json({ error: 'Request not found' }, { status: 404 });
      if (existing.requestType !== 'COMPANY_DELETION') return Response.json({ error: 'Not a company deletion request' }, { status: 400 });
      if (existing.status !== 'Completed') return Response.json({ error: 'Notification can only be retried for completed requests' }, { status: 409 });
      const notif = await sendCompanyCompletionEmail(base44, existing);
      const updated = await SR.entities.DeletionRequest.update(requestId, {
        notificationStatus: notif.notificationStatus,
        notificationError: notif.notificationError || '',
        userNotifiedAt: notif.notificationStatus === 'email_sent' ? now : (existing.userNotifiedAt || undefined),
      }).catch(() => null);
      return Response.json({ success: true, request: updated, notificationStatus: notif.notificationStatus });
    }

    // ── record_company_completion_notification (SUPER_ADMIN) ──────────────────
    // Admin records an alternative verified channel used to inform the GM when
    // email delivery could not be confirmed. Does NOT modify deletion state.
    if (action === 'record_company_completion_notification') {
      if (!requestId) return Response.json({ error: 'requestId is required' }, { status: 400 });
      const existing = await SR.entities.DeletionRequest.get(requestId).catch(() => null);
      if (!existing) return Response.json({ error: 'Request not found' }, { status: 404 });
      if (existing.requestType !== 'COMPANY_DELETION') return Response.json({ error: 'Not a company deletion request' }, { status: 400 });
      if (existing.status !== 'Completed') return Response.json({ error: 'Only completed requests can have a notification recorded' }, { status: 409 });
      const userNotifiedVia = (body.userNotifiedVia || '').toString().trim();
      if (!userNotifiedVia) return Response.json({ error: 'userNotifiedVia is required (the verified channel used)' }, { status: 400 });
      const updated = await SR.entities.DeletionRequest.update(requestId, {
        notificationStatus: 'admin_notified',
        userNotifiedVia,
        userNotifiedAt: now,
      });
      return Response.json({ success: true, request: updated });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}