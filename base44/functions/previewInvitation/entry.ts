/**
 * previewInvitation — returns the minimal data an invitation recipient needs
 * before accepting: the invitation's public fields and the invited company's
 * NAME only.
 *
 * SECURITY: Replaces the direct client `Company.get(inv.companyId)` read that
 * previously exposed the full Company record (including billing identifiers)
 * to a user who is not yet a member. The company name is returned only for a
 * valid existing invitation, so there is no open companyId → company-name
 * oracle. No billing or subscription fields are returned. The invitationId in
 * the link is the access gate.
 *
 * Input:  { invitationId }
 * Output: { invitation: { id, companyId, invitedEmail, intendedRole, status, expiresAt }, companyName }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { invitationId } = body;
    if (!invitationId) {
      return Response.json({ error: 'invitationId is required.' }, { status: 400 });
    }

    const SR = base44.asServiceRole;
    const inv = await SR.entities.CompanyInvitation.get(invitationId).catch(() => null);
    if (!inv) {
      return Response.json({ error: 'Invitation not found.' }, { status: 404 });
    }

    const company = await SR.entities.Company.get(inv.companyId).catch(() => null);

    // Normalize expired status: a pending invitation past its expiration date
    // is displayed as "expired" (consistent with resolveTeamRoster). The
    // database record is not modified — this is a response-only normalization.
    let displayStatus = inv.status;
    if (inv.status === 'pending' && inv.expiresAt && new Date(inv.expiresAt) < new Date()) {
      displayStatus = 'expired';
    }

    // SECURITY: invitedEmail is NOT returned in the preview. An invitation ID
    // alone (without the token) must not expose the recipient's email address.
    // The recipient already knows their own email from the invitation link.
    // Email match is verified at acceptance time (acceptInvitation).
    return Response.json({
      invitation: {
        id: inv.id,
        companyId: inv.companyId,
        intendedRole: inv.intendedRole,
        status: displayStatus,
        expiresAt: inv.expiresAt,
      },
      companyName: company?.name || null,
    });
  } catch (e) {
    return Response.json({ error: 'Failed to load invitation.' }, { status: 500 });
  }
}