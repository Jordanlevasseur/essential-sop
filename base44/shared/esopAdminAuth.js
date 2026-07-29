/**
 * Shared authorization guards for platform administration.
 *
 * requireEsopAdmin  — allows admin + esop_admin (Master Library operations)
 * requirePlatformAdmin — allows admin only (role management, platform ownership)
 *
 * These guards authenticate against the BASE44 auth system using the caller's
 * actual session token. Role values come from the platform User record, not
 * from client-supplied claims. The backend is the final authority.
 */

export async function requireEsopAdmin(base44) {
  const user = await base44.auth.me().catch(() => null);
  if (!user) {
    return { user: null, error: Response.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  if (user.role !== 'esop_admin' && user.role !== 'admin') {
    return { user: null, error: Response.json({ error: 'Forbidden: Essential SOP admin access required' }, { status: 403 }) };
  }
  return { user, error: null };
}

export async function requirePlatformAdmin(base44) {
  const user = await base44.auth.me().catch(() => null);
  if (!user) {
    return { user: null, error: Response.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  if (user.role !== 'admin') {
    return { user: null, error: Response.json({ error: 'Forbidden: Platform administrator access required' }, { status: 403 }) };
  }
  return { user, error: null };
}

/**
 * Write an immutable platform audit entry.
 * Called server-side after every successful platform write operation.
 */
export async function writePlatformAudit(SR, { actingUserId, actingUserRole, action, extra = {} }) {
  await SR.entities.PlatformAuditLog.create({
    actingUserId,
    actingUserRole,
    action,
    timestamp: new Date().toISOString(),
    ...extra,
  });
}