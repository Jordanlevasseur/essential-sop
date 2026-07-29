/**
 * Shared backend plan utilities.
 * Imported by: seatCheck, managePlan, createCompany.
 *
 * BILLING STATUS:
 * - All plans run in prototype mode. No real payment is processed.
 * - Apple IAP: NOT connected.
 * - Stripe / web billing: NOT connected.
 */

export const PLANS = [
  { code: 'homeowner',      displayName: 'Homeowner',      monthlyPrice: 5.99,  seatLimit: 1,  accountType: 'individual', supportsTeamMembers: false, sortOrder: 1 },
  { code: 'handyman',       displayName: 'Handyman',       monthlyPrice: 10.99, seatLimit: 2,  accountType: 'business',   supportsTeamMembers: true,  sortOrder: 2 },
  { code: 'contractor',     displayName: 'Contractor',     monthlyPrice: 19.99, seatLimit: 15, accountType: 'business',   supportsTeamMembers: true,  sortOrder: 3 },
  { code: 'contractor_plus',displayName: 'Contractor Plus',monthlyPrice: 39.99, seatLimit: 40, accountType: 'business',   supportsTeamMembers: true,  sortOrder: 4 },
];

export function getPlan(code) {
  return PLANS.find(p => p.code === code) || null;
}

/**
 * Count active seats for a company using the service role client.
 * Returns { seatLimit, activeSeatCount, remainingSeatCount, isAtLimit, isOverLimit }
 */
export async function getSeatUsage(serviceRole, companyId, planCode) {
  const plan = getPlan(planCode || 'contractor_plus');
  const seatLimit = plan ? plan.seatLimit : 1;

  const memberships = await serviceRole.entities.CompanyMembership.filter({
    companyId,
    status: 'active',
  });
  const activeSeatCount = (memberships || []).length;
  const remainingSeatCount = Math.max(0, seatLimit - activeSeatCount);

  return {
    seatLimit,
    activeSeatCount,
    remainingSeatCount,
    isAtLimit: activeSeatCount >= seatLimit,
    isOverLimit: activeSeatCount > seatLimit,
    planCode: plan ? plan.code : planCode,
    planDisplayName: plan ? plan.displayName : planCode,
  };
}

/**
 * Log a subscription or seat activity event.
 */
export async function logActivity(serviceRole, {
  companyId, actingUserId, actionType,
  previousPlan, newPlan, activeSeatCount, seatLimit, summary,
}) {
  try {
    await serviceRole.entities.ActivityLog.create({
      companyId,
      actingUserId,
      actionType,
      previousPlan: previousPlan || null,
      newPlan: newPlan || null,
      activeSeatCount: activeSeatCount ?? null,
      seatLimit: seatLimit ?? null,
      timestamp: new Date().toISOString(),
      summary: summary || actionType,
    });
  } catch (err) {
    console.error('logActivity failed:', err?.message);
  }
}