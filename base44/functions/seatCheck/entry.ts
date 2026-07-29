/**
 * seatCheck — authoritative seat usage calculation.
 * Input: { companyId: string }
 * Output: { seatLimit, activeSeatCount, remainingSeatCount, isAtLimit, isOverLimit, planCode, planDisplayName }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { getSeatUsage } from '../../shared/planUtils.js';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { companyId } = body;
    if (!companyId) return Response.json({ error: 'companyId is required.' }, { status: 400 });

    // Verify the user is a member of this company
    const memberships = await base44.asServiceRole.entities.CompanyMembership.filter({
      companyId,
      userId: user.id,
      status: 'active',
    });
    if (!memberships || memberships.length === 0) {
      return Response.json({ error: 'Access denied.' }, { status: 403 });
    }

    const company = await base44.asServiceRole.entities.Company.get(companyId);
    if (!company) return Response.json({ error: 'Company not found.' }, { status: 404 });

    const usage = await getSeatUsage(base44.asServiceRole, companyId, company.subscriptionPlanCode);
    return Response.json({ success: true, ...usage });
  } catch (error) {
    console.error('seatCheck error:', error?.message);
    return Response.json({ error: error.message || 'Failed to check seats.' }, { status: 500 });
  }
}