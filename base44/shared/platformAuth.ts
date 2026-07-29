/**
 * platformAuth.ts — Essential SOP platform and company authorization helpers.
 *
 * ARCHITECTURE INVARIANTS:
 * - Platform authority derives exclusively from PlatformMembership records.
 * - Company authority derives exclusively from CompanyMembership records.
 * - User.role is used ONLY for the one-time bootstrap of the first SUPER_ADMIN
 *   and to satisfy Base44 system requirements. It is never treated as the
 *   product-level source of truth for Essential SOP authorization.
 * - Never trust client-supplied userId, role, or membership claims.
 * - All helpers call base44.auth.me() internally to derive the caller identity.
 * - A PlatformMembership NEVER grants company authority.
 * - A CompanyMembership NEVER grants platform authority.
 */

// ── Platform capability set ─────────────────────────────────────────────────

export interface PlatformCapabilities {
  canAccessPlatformAdmin: boolean;
  canManageMasterLibrary: boolean;
  canPublishMasterSOP: boolean;
  canManageCompanies: boolean;
  canManagePlatformUsers: boolean;
  canTriggerProvisioning: boolean;
  canWritePlatformAudit: boolean;
}

// ── Company capability set ───────────────────────────────────────────────────

export interface CompanyCapabilities {
  canAccessCompany: boolean;
  canManageCompany: boolean;
  canManageCompanyMembers: boolean;
  canCustomizeCompanyJobs: boolean;
  canRestoreCompanyJobs: boolean;
  canDecideMasterUpdates: boolean;
  canViewActivityHistory: boolean;
  canRequestEdits: boolean;
}

// ── Build platform capabilities from a membership record ────────────────────

function buildPlatformCapabilities(membership: any | null): PlatformCapabilities {
  const active = membership?.status === 'ACTIVE' && membership?.platformRole === 'SUPER_ADMIN';
  return {
    canAccessPlatformAdmin:  active,
    canManageMasterLibrary:  active,
    canPublishMasterSOP:     active,
    canManageCompanies:      active,
    canManagePlatformUsers:  active,
    canTriggerProvisioning:  active,
    canWritePlatformAudit:   active,
  };
}

// ── Build company capabilities from a membership record ─────────────────────

function buildCompanyCapabilities(membership: any | null): CompanyCapabilities {
  const role = membership?.status === 'active' ? (membership?.role || '') : '';
  const isAdmin = role === 'general_manager' || role === 'project_manager';
  const isLead  = role === 'project_lead';
  return {
    canAccessCompany:        !!role,
    canManageCompany:        role === 'general_manager',
    canManageCompanyMembers: role === 'general_manager',
    canCustomizeCompanyJobs: isAdmin,
    canRestoreCompanyJobs:   isAdmin,
    canDecideMasterUpdates:  isAdmin,
    canViewActivityHistory:  isAdmin,
    canRequestEdits:         isAdmin || isLead,
  };
}

// ── getActivePlatformMembership ──────────────────────────────────────────────
// Returns the active PlatformMembership for a given userId, or null.
// Reads via service role — uses userId parameter only to query, does NOT trust
// it as an authorization claim (caller must have already verified the userId
// via base44.auth.me()).

export async function getActivePlatformMembership(SR: any, userId: string): Promise<any | null> {
  const records = await SR.entities.PlatformMembership.filter({ userId, status: 'ACTIVE' });
  return records?.[0] || null;
}

// ── requirePlatformSuperAdmin ────────────────────────────────────────────────
// Resolves the calling user and verifies they hold an active SUPER_ADMIN
// PlatformMembership. Returns { user, platformMembership, capabilities } on
// success, or { user: null, platformMembership: null, capabilities, error }
// where error is a ready-to-send Response.

export async function requirePlatformSuperAdmin(base44: any): Promise<{
  user: any;
  platformMembership: any;
  capabilities: PlatformCapabilities;
  error: Response | null;
}> {
  const noCapabilities = buildPlatformCapabilities(null);

  const user = await base44.auth.me().catch(() => null);
  if (!user) {
    return {
      user: null, platformMembership: null, capabilities: noCapabilities,
      error: Response.json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }, { status: 401 }),
    };
  }

  const SR = base44.asServiceRole;
  const platformMembership = await getActivePlatformMembership(SR, user.id);

  if (!platformMembership) {
    return {
      user, platformMembership: null, capabilities: noCapabilities,
      error: Response.json(
        { error: 'Forbidden: active Platform Super Admin membership required', code: 'PLATFORM_ACCESS_REQUIRED' },
        { status: 403 }
      ),
    };
  }

  return {
    user,
    platformMembership,
    capabilities: buildPlatformCapabilities(platformMembership),
    error: null,
  };
}

// ── getActiveCompanyMembership ───────────────────────────────────────────────
// Returns the active CompanyMembership for (userId, companyId), or null.

export async function getActiveCompanyMembership(base44: any, userId: string, companyId: string): Promise<any | null> {
  const records = await base44.entities.CompanyMembership.filter({ userId, companyId, status: 'active' });
  return records?.[0] || null;
}

// ── requireCompanyMember ─────────────────────────────────────────────────────
// Resolves the calling user and verifies they hold an active CompanyMembership
// for the given companyId. Returns { user, membership, capabilities } on
// success, or { user, membership: null, capabilities, error }.

export async function requireCompanyMember(base44: any, companyId: string): Promise<{
  user: any;
  membership: any;
  capabilities: CompanyCapabilities;
  error: Response | null;
}> {
  const noCapabilities = buildCompanyCapabilities(null);

  const user = await base44.auth.me().catch(() => null);
  if (!user) {
    return {
      user: null, membership: null, capabilities: noCapabilities,
      error: Response.json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }, { status: 401 }),
    };
  }

  const membership = await getActiveCompanyMembership(base44, user.id, companyId);
  if (!membership) {
    return {
      user, membership: null, capabilities: noCapabilities,
      error: Response.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 }),
    };
  }

  return {
    user,
    membership,
    capabilities: buildCompanyCapabilities(membership),
    error: null,
  };
}

// ── requireCompanyAdmin ──────────────────────────────────────────────────────
// Like requireCompanyMember but additionally verifies the member holds a
// company-admin role (general_manager or project_manager).

export async function requireCompanyAdmin(base44: any, companyId: string): Promise<{
  user: any;
  membership: any;
  capabilities: CompanyCapabilities;
  error: Response | null;
}> {
  const result = await requireCompanyMember(base44, companyId);
  if (result.error) return result;

  if (!result.capabilities.canCustomizeCompanyJobs) {
    return {
      ...result,
      error: Response.json(
        { error: 'Insufficient company role', code: 'INSUFFICIENT_ROLE' },
        { status: 403 }
      ),
    };
  }

  return result;
}

// ── writePlatformAudit ───────────────────────────────────────────────────────
// Writes an immutable PlatformAuditLog entry for platform operations.
// Exported from here so all platform services use one consistent call site.

export async function writePlatformAudit(SR: any, params: {
  actingUserId: string;
  actingUserRole: string;
  action: string;
  targetUserId?: string;
  previousPlatformRole?: string;
  previousPlatformStatus?: string;
  newPlatformRole?: string;
  newPlatformStatus?: string;
  reason?: string;
  extra?: Record<string, any>;
}): Promise<void> {
  const { extra = {}, ...coreFields } = params;
  await SR.entities.PlatformAuditLog.create({
    ...coreFields,
    ...extra,
    timestamp: new Date().toISOString(),
  });
}

// ── bootstrapPlatformSuperAdmin ──────────────────────────────────────────────
// One-time, idempotent bootstrap: finds the first user with Base44 role='admin'
// and creates a PlatformMembership(SUPER_ADMIN, ACTIVE) if one does not already
// exist. Safe to call repeatedly.
//
// DEPENDENCY ON User.role:
// This is the ONLY place in Essential SOP that reads User.role as an
// authorization signal. It is used exclusively for the initial bootstrap.
// After bootstrap, all platform authorization flows through PlatformMembership.
// We document this dependency explicitly per the architecture requirements.

export async function bootstrapPlatformSuperAdmin(SR: any): Promise<{
  bootstrapped: boolean;
  alreadyExisted: boolean;
  userId: string | null;
  membershipId: string | null;
}> {
  // Find users with role='admin' (Base44 built-in role — bootstrap only)
  const adminUsers = await SR.entities.User.filter({ role: 'admin' }, '-created_date', 10);
  if (!adminUsers || adminUsers.length === 0) {
    return { bootstrapped: false, alreadyExisted: false, userId: null, membershipId: null };
  }
  const adminUser = adminUsers[0];

  // Check for existing ACTIVE PlatformMembership — idempotency
  const existing = await SR.entities.PlatformMembership.filter({ userId: adminUser.id });
  if (existing && existing.length > 0) {
    return { bootstrapped: false, alreadyExisted: true, userId: adminUser.id, membershipId: existing[0].id };
  }

  const now = new Date().toISOString();
  const membership = await SR.entities.PlatformMembership.create({
    userId: adminUser.id,
    platformRole: 'SUPER_ADMIN',
    status: 'ACTIVE',
    grantedByUserId: null, // bootstrap — no grantor
    grantedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  // Audit the bootstrap — best effort
  try {
    await SR.entities.PlatformAuditLog.create({
      actingUserId: adminUser.id,
      actingUserRole: 'SUPER_ADMIN',
      action: 'platform_role_assigned',
      targetUserId: adminUser.id,
      targetRole: 'SUPER_ADMIN',
      newPlatformRole: 'SUPER_ADMIN',
      newPlatformStatus: 'ACTIVE',
      metadata: { bootstrapped: true, sourceRoleUsedForBootstrap: 'admin' },
      timestamp: now,
    });
  } catch (_) { /* best effort */ }

  return { bootstrapped: true, alreadyExisted: false, userId: adminUser.id, membershipId: membership.id };
}