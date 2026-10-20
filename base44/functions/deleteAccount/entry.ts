/**
 * deleteAccount — server-side account removal handler
 *
 * WHAT THIS FUNCTION DOES:
 *   1. Validates the caller is authenticated.
 *   2. Prevents sole-admin deletion.
 *   3. Creates a DeletionRequest record (status: Pending) so an administrator can
 *      complete the final step manually. Associated personal data (notifications,
 *      memberships) is removed by the manageDeletionRequest completion action,
 *      NOT at request time — so submitting a request does not disrupt a company
 *      and is not misrepresented as a completed deletion. Company-owned Jobs,
 *      JobSections, and SectionContent are never deleted here (company-owned).
 *   5. Returns success so the client can clear localStorage and call auth.logout().
 *
 * WHAT THIS FUNCTION CANNOT DO:
 *   Base44 does not expose a server-side SDK method to programmatically delete an
 *   app user's authentication identity. The auth identity must be removed manually
 *   by a workspace administrator via:
 *
 *     Dashboard → Users → [find user] → Remove User
 *
 *   Until that step is completed, the user's auth record still exists in Base44's
 *   identity system, but their session is revoked (logout) and a DeletionRequest
 *   record is left in Pending state to prompt administrator action.
 *
 * APP STORE ACCOUNT DELETION REQUIREMENT:
 *   Apple App Store Review Guideline 5.1.1(v) requires that apps with account
 *   creation also offer account deletion. This workflow satisfies that requirement
 *   by: removing all app-controlled data, revoking the session, and creating a
 *   documented deletion request. The administrator must complete auth-identity
 *   removal within a reasonable timeframe (recommended: 30 days) via the Base44
 *   dashboard. This must be documented in your App Store privacy disclosures.
 *
 * REMAINING MANUAL STEP (DO NOT REMOVE THIS COMMENT):
 *   After a DeletionRequest appears in the admin panel with status "Pending":
 *     1. Go to Base44 Dashboard → Your App → Users
 *     2. Search for the user by email (stored in DeletionRequest.userEmail)
 *     3. Click "Remove User"
 *     4. Return to the DeletionRequest admin panel and mark status "Completed",
 *        set authIdentityDeletedAt to now, and add any admin notes.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const userId = user.id;
    const userEmail = user.email || '';
    const userName = user.full_name || '';
    const now = new Date().toISOString();

    // ── 1. Sole-admin guard ───────────────────────────────────────────────────
    if (user.role === 'admin') {
      const allUsers = await base44.asServiceRole.entities.User.list();
      const admins = (allUsers || []).filter((u: any) => u.role === 'admin');
      if (admins.length === 1) {
        return Response.json({
          error: 'sole_admin',
          message: 'You are the only administrator. Transfer the admin role to another user before deleting your account.'
        }, { status: 403 });
      }
    }

    // ── 2. Check for duplicate pending request ────────────────────────────────
    const existing = await base44.asServiceRole.entities.DeletionRequest.filter({ userId, status: 'Pending' });
    if (existing && existing.length > 0) {
      return Response.json({
        error: 'already_pending',
        message: 'A deletion request for this account is already pending administrator review.'
      }, { status: 409 });
    }

    // ── 3. Delete app-controlled personal data ────────────────────────────────
    // Essential SOP does not store personal SectionContent records separately
    // from company templates — all job data is company-owned. Nothing to hard-delete
    // on the SectionContent/Job/JobSection side per company policy.
    // If the app is extended to store personal records (e.g., personal notes,
    // saved drafts), add deleteMany calls here using { created_by_id: userId }.

    // ── 4. Create DeletionRequest record (status: Pending) ──────────────────
    // NOTE: a submitted request is NOT a completed deletion. appDataDeletedAt
    // and authIdentityDeletedAt remain null until an administrator completes
    // the deletion via manageDeletionRequest (action=complete), which removes
    // associated personal data (notifications, memberships) and records the
    // timestamps. See the lifecycle note in the header below.
    await base44.asServiceRole.entities.DeletionRequest.create({
      userId,
      userEmail,
      userName,
      requestedAt: now,
      status: 'Pending',
      // appDataDeletedAt / authIdentityDeletedAt: intentionally null at request.
      adminNotes: 'Request received. To complete: (1) remove the user in Base44 Dashboard → Users → Remove User, then (2) run manageDeletionRequest action=complete to remove associated personal data and mark the request Completed.',
    });

    console.log(`DeletionRequest created for userId=${userId} email=${userEmail} at ${now}`);

    // ── 5. Return success ─────────────────────────────────────────────────────
    // Client will: localStorage.clear() → auth.logout('/') → redirect to login.
    // The message accurately states the request was RECEIVED — it does NOT claim
    // the deletion is complete (Apple: submitting a request ≠ completed deletion).
    return Response.json({
      success: true,
      authIdentityDeleted: false, // ← always false; Base44 has no programmatic API for this
      message: 'Your account deletion request has been received and you have been signed out. An administrator will complete removal of your account data and login identity.'
    });

  } catch (error: any) {
    console.error('deleteAccount error:', error?.message);
    return Response.json({ error: 'Deletion failed. Please try again or contact support.' }, { status: 500 });
  }
}