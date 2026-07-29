/**
 * Shared authorization guard for Essential SOP Master Library administration.
 * Import this in every esop-admin backend function.
 *
 * Usage:
 *   const { user, error } = await requireEsopAdmin(base44);
 *   if (error) return error;
 */
export async function requireEsopAdmin(base44) {
  const user = await base44.auth.me();
  if (!user) {
    return { user: null, error: Response.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  if (user.role !== 'esop_admin' && user.role !== 'admin') {
    return { user: null, error: Response.json({ error: 'Forbidden: Essential SOP admin access required' }, { status: 403 }) };
  }
  return { user, error: null };
}