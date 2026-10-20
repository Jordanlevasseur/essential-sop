/**
 * resolveDeletionRequests — Platform Super Admin list of account-deletion requests.
 *
 * SECURITY: DeletionRequest is RLS-closed to all direct client access. This
 * function is the ONLY way the admin panel reads requests. It verifies an
 * active PlatformMembership(SUPER_ADMIN) on the backend — NOT a client-side
 * isAdmin flag. Ordinary users receive 401/403 and cannot list other users'
 * deletion requests (which contain personal emails/names).
 *
 * Output: { requests: DeletionRequest[] } sorted by requestedAt desc.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { requirePlatformSuperAdmin } from '../../shared/platformAuth.ts';

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const auth = await requirePlatformSuperAdmin(base44);
    if (auth.error) return auth.error;

    const SR = base44.asServiceRole;
    const all = await SR.entities.DeletionRequest.list('-requestedAt', 200);
    return Response.json({ requests: all || [] });
  } catch (e: any) {
    return Response.json({ error: 'Failed to load deletion requests.' }, { status: 500 });
  }
}