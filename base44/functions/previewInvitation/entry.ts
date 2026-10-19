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

    return Response.json({
      invitation: {
        id: inv.id,
        companyId: inv.companyId,
        invitedEmail: inv.invitedEmail,
        intendedRole: inv.intendedRole,
        status: inv.status,
        expiresAt: inv.expiresAt,
      },
      companyName: company?.name || null,
    });
  } catch (e) {
    return Response.json({ error: 'Failed to load invitation.' }, { status: 500 });
  }
}