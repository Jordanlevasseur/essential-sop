/**
 * Centralized subscription plan definitions.
 * ALL seat limits, prices, and plan metadata must be read from here.
 * Never hard-code plan values elsewhere in the codebase.
 *
 * BILLING STATUS NOTE:
 * - subscriptionStatus: "prototype" — no real payment is being processed.
 * - Apple In-App Purchase: NOT connected.
 * - Web billing (Stripe): NOT connected.
 * - All plan changes are prototype-mode only.
 */

export const PLANS = [
  {
    code: 'homeowner',
    displayName: 'Homeowner',
    monthlyPrice: 5.99,
    currency: 'USD',
    seatLimit: 1,
    accountType: 'individual',
    supportsTeamMembers: false,
    recommended: false,
    sortOrder: 1,
    description: 'For one person managing personal home-repair and maintenance knowledge.',
    features: [
      '1 profile',
      'Full job editing',
      'Full uploads',
      'Assistant access',
      'No team management',
    ],
  },
  {
    code: 'handyman',
    displayName: 'Handyman',
    monthlyPrice: 10.99,
    currency: 'USD',
    seatLimit: 2,
    accountType: 'business',
    supportsTeamMembers: true,
    recommended: false,
    sortOrder: 2,
    description: 'For a solo handyman or two-person operation.',
    features: [
      'Up to 2 profiles',
      'Team roles',
      'Job editing',
      'Uploads',
      'Assistant access',
    ],
  },
  {
    code: 'contractor',
    displayName: 'Contractor',
    monthlyPrice: 19.99,
    currency: 'USD',
    seatLimit: 15,
    accountType: 'business',
    supportsTeamMembers: true,
    recommended: true,
    sortOrder: 3,
    description: 'For growing residential construction teams.',
    features: [
      'Up to 15 profiles',
      'Team roles',
      'Job editing',
      'Uploads',
      'Assistant access',
    ],
  },
  {
    code: 'contractor_plus',
    displayName: 'Contractor Plus',
    monthlyPrice: 39.99,
    currency: 'USD',
    seatLimit: 40,
    accountType: 'business',
    supportsTeamMembers: true,
    recommended: false,
    sortOrder: 4,
    description: 'For larger construction teams.',
    features: [
      'Up to 40 profiles',
      'Team roles',
      'Job editing',
      'Uploads',
      'Assistant access',
    ],
  },
];

/** Look up a plan by its code. Returns undefined if not found. */
export function getPlan(code) {
  return PLANS.find(p => p.code === code);
}

/** Format a price for display: "$19.99/month" */
export function formatPrice(plan) {
  if (!plan) return '';
  return `$${plan.monthlyPrice.toFixed(2)}/month`;
}

/**
 * Valid upgrade paths (from → to).
 * Upgrades are allowed when the target plan has a higher seat limit.
 */
export function canUpgrade(fromCode, toCode) {
  const from = getPlan(fromCode);
  const to = getPlan(toCode);
  if (!from || !to) return false;
  return to.sortOrder > from.sortOrder;
}

/**
 * Valid downgrade paths (from → to).
 * Downgrades are allowed when the target plan has a lower seat limit.
 * Actual capacity enforcement happens on the backend.
 */
export function canDowngrade(fromCode, toCode) {
  const from = getPlan(fromCode);
  const to = getPlan(toCode);
  if (!from || !to) return false;
  return to.sortOrder < from.sortOrder;
}

/** Get all plans that are valid upgrade targets from a given plan code. */
export function getUpgradeOptions(fromCode) {
  return PLANS.filter(p => canUpgrade(fromCode, p.code));
}

/** Get all plans that are valid downgrade targets from a given plan code. */
export function getDowngradeOptions(fromCode) {
  return PLANS.filter(p => canDowngrade(fromCode, p.code));
}