/**
 * Shared backend plan utilities — the authoritative source for plan
 * definitions and profile limits. Imported by seatCheck, managePlan,
 * createCompany, inviteMember, manageMember, acceptInvitation.
 *
 * BILLING STATUS: FREE BETA — all plans are complimentary while
 * BETA_BILLING_ACTIVE is true. No payment is collected, no checkout is
 * initiated, and no provider customer/subscription IDs are stored.
 * Companies carry subscriptionStatus='prototype' / subscriptionSource='prototype'
 * to denote complimentary beta access (see isBetaCompany below).
 *
 * Future paid billing hooks: startSubscription, changeSubscriptionPlan,
 * cancelSubscription, restoreSubscription, syncSubscriptionStatus,
 * processSubscriptionWebhook — wire into managePlan when a provider is
 * connected. Existing beta companies are NEVER auto-converted to paid.
 *
 * APPROVED PLANS (selectable for new subscriptions):
 *   homeowner   599¢/mo ($5.99)   1 profile
 *   handyman    1599¢/mo ($15.99) 5 profiles
 *   contractor  2999¢/mo ($29.99) Unlimited profiles  (seatLimit === null)
 *
 * LEGACY: contractor_plus (3999¢/mo / $39.99, 40 profiles) is preserved for
 * EXISTING companies only — never selectable for new companies. getPlan()
 * still resolves it so live companies keep their entitlement; it is absent
 * from the exported PLANS list, so selectors/Onboarding never offer it.
 *
 * "Unlimited" means unlimited PROFILES — it does NOT mean unlimited AI usage.
 *
 * PRICING: monthlyPriceCents is the AUTHORITATIVE future standard price
 * (integer US cents, USD). monthlyPrice is the decimal-dollar equivalent
 * kept for display convenience. During beta the current amount due is $0.
 */

export const PLANS = [
  {
    code: 'homeowner', displayName: 'Homeowner', monthlyPrice: 5.99, monthlyPriceCents: 599, currency: 'USD',
    seatLimit: 1, accountType: 'individual', supportsTeamMembers: false,
    recommended: false, sortOrder: 1,
    description: 'For one person managing personal home-repair and maintenance knowledge.',
    features: ['1 profile', 'Full job editing', 'Full uploads', 'Assistant access', 'No team management'],
  },
  {
    code: 'handyman', displayName: 'Handyman', monthlyPrice: 15.99, monthlyPriceCents: 1599, currency: 'USD',
    seatLimit: 5, accountType: 'business', supportsTeamMembers: true,
    recommended: false, sortOrder: 2,
    description: 'For a solo handyman or small operation.',
    features: ['Up to 5 profiles', 'Team roles', 'Job editing', 'Uploads', 'Assistant access'],
  },
  {
    code: 'contractor', displayName: 'Contractor', monthlyPrice: 29.99, monthlyPriceCents: 2999, currency: 'USD',
    seatLimit: null, accountType: 'business', supportsTeamMembers: true,
    recommended: true, sortOrder: 3,
    description: 'For growing residential construction teams.',
    features: ['Unlimited profiles', 'Team roles', 'Job editing', 'Uploads', 'Assistant access'],
  },
];

// Legacy plans are resolvable but never listed for selection.
const LEGACY_PLANS = {
  contractor_plus: {
    code: 'contractor_plus', displayName: 'Contractor Plus', monthlyPrice: 39.99, monthlyPriceCents: 3999, currency: 'USD',
    seatLimit: 40, accountType: 'business', supportsTeamMembers: true,
    recommended: false, sortOrder: 5, legacy: true,
    description: 'Legacy plan — not available for new subscriptions.',
    features: ['Up to 40 profiles', 'Team roles', 'Job editing', 'Uploads', 'Assistant access'],
  },
};

/**
 * FREE BETA BILLING MODE
 *
 * While BETA_BILLING_ACTIVE is true, all plans are complimentary — no payment
 * is collected, no checkout is initiated, and no provider customer/subscription
 * IDs are stored. Companies carry subscriptionStatus='prototype' to denote
 * free beta access.
 *
 * When paid billing is eventually activated, existing beta companies will NOT
 * be auto-converted or auto-charged. A paid subscription requires an explicit
 * customer action and successful confirmation through the selected legitimate
 * payment system.
 */
export const BETA_BILLING_ACTIVE = true;

/** True when a company is in complimentary free-beta billing mode. */
export function isBetaCompany(company) {
  if (!company) return true; // default to beta for safety
  return company.subscriptionStatus === 'prototype' || company.subscriptionSource === 'prototype';
}

/** Look up a plan by code. Resolves approved plans, then legacy plans. */
export function getPlan(code) {
  const approved = PLANS.find(p => p.code === code);
  if (approved) return approved;
  if (code && LEGACY_PLANS[code]) return LEGACY_PLANS[code];
  return null;
}

/** True when a plan allows unlimited profiles (seatLimit === null). */
export function isUnlimited(plan) {
  return !!plan && plan.seatLimit == null;
}

/** Resolve the profile limit for a plan code. null = unlimited.
 *  An UNRECOGNIZED or MISSING plan code falls back to the LOWEST tier
 *  (homeowner, 1 profile) — the most restrictive — never to the highest. This
 *  prevents silently granting paid Contractor (unlimited) entitlements to a
 *  company whose plan code is unset or corrupted. Existing members are never
 *  removed by this; it only caps future invites. */
export function getSeatLimit(planCode) {
  const plan = getPlan(planCode) || getPlan('homeowner');
  return plan ? plan.seatLimit : null;
}

/**
 * Count active seats for a company using the service role client.
 * Returns { seatLimit, isUnlimited, activeSeatCount, remainingSeatCount,
 *           isAtLimit, isOverLimit, planCode, planDisplayName }
 * seatLimit === null and remainingSeatCount === null for unlimited plans.
 */
export async function getSeatUsage(serviceRole, companyId, planCode) {
  // Unrecognized/missing plan → lowest tier (homeowner), never the highest.
  const plan = getPlan(planCode) || getPlan('homeowner');
  const unlimited = isUnlimited(plan);
  const seatLimit = plan ? plan.seatLimit : null;

  const memberships = await serviceRole.entities.CompanyMembership.filter({
    companyId,
    status: 'active',
  });
  const activeSeatCount = (memberships || []).length;

  return {
    seatLimit,
    isUnlimited: unlimited,
    activeSeatCount,
    remainingSeatCount: unlimited ? null : Math.max(0, seatLimit - activeSeatCount),
    isAtLimit: unlimited ? false : activeSeatCount >= seatLimit,
    isOverLimit: unlimited ? false : activeSeatCount > seatLimit,
    planCode: plan ? plan.code : planCode,
    planDisplayName: plan ? plan.displayName : planCode,
  };
}

/** Log a subscription or seat activity event. */
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