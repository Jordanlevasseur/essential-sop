/**
 * resolveUserCompanies — returns the authenticated user's companies.
 *
 * SECURITY: Replaces direct client `Company.get` reads (the Company entity is
 * now RLS-closed to all direct client access). The caller's company list is
 * derived exclusively from their own active CompanyMembership records, then
 * each company is read via the service role. Billing provider identifiers
 * (billingCustomerId, billingSubscriptionId) and the legacy planPlaceholder
 * are stripped from the response — members never receive them. Plan code /
 * status / source remain, since members legitimately view their own plan.
 *
 * Output: { companies: Company[], memberships: CompanyMembership[] }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

const SENSITIVE_FIELDS = ['billingCustomerId', 'billingSubscriptionId', 'planPlaceholder'];

function stripSensitive(company) {
  if (!company) return null;
  const out = { ...company };
  for (const f of SENSITIVE_FIELDS) delete out[f];
  return out;
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const SR = base44.asServiceRole;
    const memberships = await SR.entities.CompanyMembership.filter({
      userId: user.id,
      status: 'active',
    });
    const activeMemberships = (memberships || []).filter(m => m.status === 'active');

    const companyIds = [...new Set(activeMemberships.map(m => m.companyId))];
    const companyRecords = await Promise.all(
      companyIds.map(id => SR.entities.Company.get(id).catch(() => null))
    );
    const validCompanies = companyRecords
      .filter(c => c && c.status === 'active')
      .map(stripSensitive);

    return Response.json({ companies: validCompanies, memberships: activeMemberships });
  } catch (e) {
    return Response.json({ error: 'Failed to resolve companies.' }, { status: 500 });
  }
}