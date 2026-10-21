/**
 * requestCompanyClosure — Authorized COMPANY_DELETION request (General Manager only).
 *
 * Replaces the prior ActivityLog-only closure request. This now creates a
 * COMPANY_DELETION DeletionRequest in the unified Platform Administration
 * → Deletion Requests queue, distinct from PERSONAL_ACCOUNT_DELETION.
 *
 * Authorization:
 *   - Authenticated user with an ACTIVE CompanyMembership for the companyId.
 *   - Role MUST be general_manager. Project Managers, Project Leads, and
 *     Technicians receive 403. A GM cannot target another company — the
 *     companyId is revalidated against their own active membership, so a
 *     forged companyId is rejected.
 *
 * Confirmation:
 *   - The GM must type the exact company name (confirmName). The server
 *     validates it against Company.name (case-insensitive, trimmed). This
 *     mirrors the customer-facing confirmation requirement.
 *
 * Idempotency:
 *   - Rejects a duplicate Pending/Approved COMPANY_DELETION for the same
 *     company (409), so a GM cannot spam the queue.
 *
 * What this does NOT do:
 *   - It does NOT delete or modify any company data. The company and all its
 *     data remain completely intact until a Platform Super Admin approves and
 *     a SEPARATE execute_company_deletion step runs. Submitting a request is
 *     NOT equivalent to deletion.
 *
 * Response: { success: true, requestId, status: 'Pending' }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { getActiveMembership } from '../../shared/companyAuth.ts';

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { companyId, confirmName } = body;
    if (!companyId || typeof companyId !== 'string') {
      return Response.json({ error: 'companyId is required' }, { status: 400 });
    }

    // ── Authorization: active GM membership for THIS company ──────────────────
    // Revalidates the caller's own membership; a forged companyId for a company
    // the GM does not belong to is rejected here.
    const membership = await getActiveMembership(base44, user.id, companyId);
    if (!membership) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (membership.role !== 'general_manager') {
      return Response.json({ error: 'Only the General Manager can request company deletion.' }, { status: 403 });
    }

    const SR = base44.asServiceRole;
    const company = await SR.entities.Company.get(companyId).catch(() => null);
    if (!company) {
      return Response.json({ error: 'Company not found' }, { status: 404 });
    }
    if (company.status === 'closed') {
      return Response.json({ error: 'This workspace is already closed.' }, { status: 409 });
    }

    // ── Typed-name confirmation ──────────────────────────────────────────────
    const typed = (confirmName || '').toString().trim();
    if (!typed) {
      return Response.json({ error: 'Type the company name to confirm.' }, { status: 400 });
    }
    if (typed.toLowerCase() !== (company.name || '').toString().trim().toLowerCase()) {
      return Response.json({ error: 'The typed name does not match the company name.' }, { status: 400 });
    }

    // ── Duplicate pending/approved request guard ─────────────────────────────
    const existing = await SR.entities.DeletionRequest.filter({
      requestType: 'COMPANY_DELETION', companyId,
    }).catch(() => []);
    const dup = (existing || []).some(r => r.status === 'Pending' || r.status === 'Approved');
    if (dup) {
      return Response.json({ error: 'A company deletion request for this workspace is already pending administrator review.' }, { status: 409 });
    }

    const now = new Date().toISOString();

    // ── Create COMPANY_DELETION request (company left intact) ────────────────
    const request = await SR.entities.DeletionRequest.create({
      requestType: 'COMPANY_DELETION',
      userId: user.id,
      userEmail: user.email || '',
      userName: user.full_name || '',
      requestedByUserId: user.id,
      companyId,
      companyName: company.name,
      requestedAt: now,
      status: 'Pending',
      adminNotes: 'Company deletion requested by General Manager. Company data is intact. A Platform Super Admin must approve and then execute deletion.',
    });

    // ── Audit + notify the requesting GM (pending acknowledgement) ───────────
    try {
      await SR.entities.ActivityLog.create({
        companyId,
        actingUserId: user.id,
        actionType: 'account_deletion_requested',
        summary: `${user.full_name || user.email} requested deletion of company "${company.name}"`,
        timestamp: now,
      });
    } catch (_) { /* best-effort audit */ }
    try {
      await SR.entities.Notification.create({
        companyId,
        userId: user.id,
        type: 'account_deletion_departure',
        title: 'Company deletion requested',
        body: `Your request to delete "${company.name}" has been submitted and is pending Essential SOP administration review. The workspace and all its data remain unchanged until approved and processed.`,
        targetType: 'company',
        targetId: companyId,
      }).catch(() => {});
    } catch (_) { /* best-effort */ }

    return Response.json({ success: true, requestId: request.id, status: 'Pending' });

  } catch (error: any) {
    return Response.json({ error: 'An unexpected error occurred.' }, { status: 500 });
  }
}