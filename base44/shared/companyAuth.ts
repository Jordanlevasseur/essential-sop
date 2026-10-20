/**
 * companyAuth.ts — Shared company membership verification for backend functions.
 *
 * Uses the user-token client (subject to CompanyMembership self-read RLS) to
 * verify the caller's active membership and role in a company. Extracted here
 * so every authorized backend function performs the identical check.
 */

export const COMPANY_ADMIN_ROLES = new Set(['general_manager', 'project_manager']);

/**
 * Returns the caller's active CompanyMembership record for the given company,
 * or null if they are not an active member. Uses the user-token client so RLS
 * self-read rules apply (the caller can only see their own membership).
 */
export async function getActiveMembership(base44: any, userId: string, companyId: string): Promise<any | null> {
  const memberships = await base44.entities.CompanyMembership.filter({
    userId,
    companyId,
    status: 'active',
  });
  return (memberships && memberships.length > 0) ? memberships[0] : null;
}

/** True when the membership role is general_manager or project_manager. */
export function isCompanyAdminRole(role: string): boolean {
  return COMPANY_ADMIN_ROLES.has(role);
}