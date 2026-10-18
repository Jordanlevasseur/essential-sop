/**
 * Centralized subscription plan definitions — frontend source of truth.
 * ALL seat limits, prices, and plan metadata must be read from here.
 *
 * Approved plans (selectable for new subscriptions):
 *   Homeowner  $5.99/mo   1 profile
 *   Handyman   $15.99/mo  5 profiles
 *   Contractor $29.99/mo  Unlimited profiles (seatLimit === null)
 *
 * Legacy contractor_plus is intentionally ABSENT here — existing companies
 * keep their entitlement via the backend planUtils.getPlan() resolution.
 *
 * Prototype mode: no payment is processed. Apple IAP / web billing not connected.
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
    monthlyPrice: 15.99,
    currency: 'USD',
    seatLimit: 5,
    accountType: 'business',
    supportsTeamMembers: true,
    recommended: false,
    sortOrder: 2,
    description: 'For a solo handyman or small operation.',
    features: [
      'Up to 5 profiles',
      'Team roles',
      'Job editing',
      'Uploads',
      'Assistant access',
    ],
  },
  {
    code: 'contractor',
    displayName: 'Contractor',
    monthlyPrice: 29.99,
    currency: 'USD',
    seatLimit: null,
    accountType: 'business',
    supportsTeamMembers: true,
    recommended: true,
    sortOrder: 3,
    description: 'For growing residential construction teams.',
    features: [
      'Unlimited profiles',
      'Team roles',
      'Job editing',
      'Uploads',
      'Assistant access',
    ],
  },
];

// Legacy plans are resolvable for display/entitlement of EXISTING companies
// but are intentionally absent from the PLANS list, so selectors never offer them.
const LEGACY_PLANS = {
  contractor_plus: {
    code: 'contractor_plus', displayName: 'Contractor Plus', monthlyPrice: 39.99, currency: 'USD',
    seatLimit: 40, accountType: 'business', supportsTeamMembers: true,
    recommended: false, sortOrder: 5, legacy: true,
    description: 'Legacy plan — not available for new subscriptions.',
    features: ['Up to 40 profiles', 'Team roles', 'Job editing', 'Uploads', 'Assistant access'],
  },
};

/** Look up a plan by its code. Resolves approved plans, then legacy plans. */
export function getPlan(code) {
  const approved = PLANS.find(p => p.code === code);
  if (approved) return approved;
  if (code && LEGACY_PLANS[code]) return LEGACY_PLANS[code];
  return undefined;
}

/** True when a plan allows unlimited profiles (seatLimit === null). */
export function isUnlimited(plan) {
  return !!plan && plan.seatLimit == null;
}

/** Human-readable profile-limit label, handling unlimited. */
export function seatLimitLabel(plan) {
  if (!plan) return '';
  if (plan.seatLimit == null) return 'Unlimited profiles';
  return plan.seatLimit === 1 ? '1 profile' : `${plan.seatLimit} profiles`;
}

/** Format a price for display: "$19.99/month" */
export function formatPrice(plan) {
  if (!plan) return '';
  return `$${plan.monthlyPrice.toFixed(2)}/month`;
}

/**
 * Valid upgrade paths (from → to).
 * Upgrades are allowed when the target plan has a higher sortOrder.
 */
export function canUpgrade(fromCode, toCode) {
  const from = getPlan(fromCode);
  const to = getPlan(toCode);
  if (!from || !to) return false;
  return to.sortOrder > from.sortOrder;
}

/**
 * Valid downgrade paths (from → to).
 * Downgrades are allowed when the target plan has a lower sortOrder.
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