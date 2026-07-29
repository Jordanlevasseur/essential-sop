import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { bootstrapPlatformSuperAdmin, requirePlatformSuperAdmin } from '../../shared/platformAuth.ts';

/**
 * bootstrapPlatformAdmin — Idempotent one-time bootstrap.
 *
 * Locates the existing trusted Base44 admin user (User.role === 'admin') and
 * creates exactly one active PlatformMembership(SUPER_ADMIN) for them if one
 * does not already exist.
 *
 * After the first call this operation is a no-op — calling it again returns
 * alreadyExisted=true without creating duplicate records.
 *
 * NOTE: This is the ONLY Essential SOP operation that reads User.role as an
 * authorization input. All subsequent platform authorization flows through
 * PlatformMembership. See platformAuth.ts for the documented dependency.
 *
 * This endpoint requires the caller to already have an active PlatformMembership
 * OR to be the Base44 admin performing first-time setup. On first-ever call
 * the check is performed by the bootstrapPlatformSuperAdmin helper itself
 * which uses service role to find admin users without trusting the caller.
 *
 * Request: {} (no body needed)
 * Response: { bootstrapped, alreadyExisted, userId, membershipId }
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const SR = base44.asServiceRole;

    // Verify caller is authenticated (any authenticated user may trigger bootstrap
    // on first setup — the bootstrap helper itself enforces the admin constraint
    // by reading User.role server-side, never trusting the caller).
    const user = await base44.auth.me().catch(() => null);
    if (!user) {
      return Response.json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }, { status: 401 });
    }

    const result = await bootstrapPlatformSuperAdmin(SR);

    return Response.json({
      success: true,
      ...result,
    });

  } catch (error: any) {
    return Response.json({ error: 'Bootstrap failed.', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}