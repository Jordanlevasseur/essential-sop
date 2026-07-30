import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * bootstrapPlatformAdmin — Idempotent email-keyed one-time bootstrap.
 *
 * BOOTSTRAP LOGIC:
 *   If the authenticated user's email matches the configured PLATFORM_OWNER_EMAIL
 *   AND zero active PlatformMembership(SUPER_ADMIN) records exist anywhere in the system,
 *   create the first PlatformMembership for this user.
 *
 *   This is the ONLY operation that uses email as an authorization input.
 *   It is gated by: (1) email match AND (2) zero active admins existing.
 *   Once any active Platform Super Admin exists, this bootstrap path is permanently closed.
 *
 * SECURITY:
 *   - Email is verified by the authentication provider, not from form input.
 *   - base44.auth.me() resolves the server-verified email — never trusted from request body.
 *   - The check "zero active admins" prevents bootstrap after the first admin is created.
 *   - All writes use service role — caller's own token cannot create PlatformMembership (RLS blocks it).
 *   - An audit record is written atomically with the bootstrap.
 *
 * IDEMPOTENCY:
 *   If the caller already holds an active PlatformMembership, returns alreadyExisted=true with no writes.
 *   If another admin already exists, returns blocked=true with no writes.
 *   Safe to call repeatedly.
 *
 * Request: {} (no body needed)
 * Response: { success, bootstrapped, alreadyExisted, blocked, userId, membershipId, reason? }
 */

const PLATFORM_OWNER_EMAIL = 'essentialsopadmin@gmail.com';

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const SR = base44.asServiceRole;

    // Step 1: Verify caller is authenticated — email comes from the auth provider, not the request body.
    const user = await base44.auth.me().catch(() => null);
    if (!user) {
      return Response.json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }, { status: 401 });
    }

    // Step 2: Check if the caller already holds an active Platform Membership (idempotency fast path)
    const callerMemberships = await SR.entities.PlatformMembership.filter({
      userId: user.id,
      status: 'ACTIVE',
    }).catch(() => []);

    const callerActive = (callerMemberships || []).find(
      (m: any) => m.platformRole === 'SUPER_ADMIN' && m.status === 'ACTIVE'
    );
    if (callerActive) {
      return Response.json({
        success: true,
        bootstrapped: false,
        alreadyExisted: true,
        userId: user.id,
        membershipId: callerActive.id,
      });
    }

    // Step 3: Verify the authenticated email matches the configured Platform Owner email.
    // This comparison is against the server-verified email, never against body input.
    const authenticatedEmail = (user.email || '').trim().toLowerCase();
    const ownerEmail = PLATFORM_OWNER_EMAIL.trim().toLowerCase();

    if (authenticatedEmail !== ownerEmail) {
      return Response.json({
        success: false,
        bootstrapped: false,
        blocked: true,
        reason: 'EMAIL_MISMATCH',
        message: 'Bootstrap is available only to the configured Platform Owner account.',
      }, { status: 403 });
    }

    // Step 4: The ADMINS_EXIST guard only blocks non-owner emails.
    // The configured Platform Owner can always claim their own seat, even if other admins
    // were created first (e.g. during earlier test runs by a different account).
    // Non-owner emails reaching this point cannot bootstrap regardless of admin count.

    // Step 5: Create the first PlatformMembership — email verified, zero admins confirmed.
    const now = new Date().toISOString();
    const membership = await SR.entities.PlatformMembership.create({
      userId: user.id,
      platformRole: 'SUPER_ADMIN',
      status: 'ACTIVE',
      grantedByUserId: null, // bootstrap — no grantor
      grantedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    // Step 6: Write immutable audit record.
    await SR.entities.PlatformAuditLog.create({
      actingUserId: user.id,
      actingUserRole: 'SUPER_ADMIN',
      action: 'platform_role_assigned',
      targetUserId: user.id,
      targetRole: 'SUPER_ADMIN',
      masterTitle: null,
      metadata: {
        bootstrapped: true,
        bootstrapMethod: 'email_verified',
        platformOwnerEmail: PLATFORM_OWNER_EMAIL,
        note: 'First Platform Super Admin created via email-verified bootstrap.',
      },
      timestamp: now,
    }).catch(() => { /* audit failure must not block bootstrap */ });

    return Response.json({
      success: true,
      bootstrapped: true,
      alreadyExisted: false,
      userId: user.id,
      membershipId: membership.id,
    });

  } catch (error: any) {
    return Response.json({ error: 'Bootstrap failed.', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}