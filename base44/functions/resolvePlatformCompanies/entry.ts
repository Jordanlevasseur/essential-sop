/**
 * resolvePlatformCompanies — platform admin list of all registered companies.
 *
 * SECURITY: Replaces the direct client `Company.list` read (Company entity is
 * RLS-closed to direct client access). Requires an active PlatformMembership
 * with SUPER_ADMIN role — NOT the Base44 workspace admin role. Returns only
 * the fields the platform companies screen needs (id, name, logo, status,
 * subscriptionPlanCode, location). Billing provider identifiers are never
 * returned, even to platform admins (not needed by the UI).
 *
 * Output: { companies: [{ id, name, logo, status, subscriptionPlanCode, location }] }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { requirePlatformSuperAdmin } from '../../shared/platformAuth.ts';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const auth = await requirePlatformSuperAdmin(base44);
    if (auth.error) return auth.error;

    const SR = base44.asServiceRole;
    const all = await SR.entities.Company.list('-created_date', 500);
    const companies = (all || []).map(c => ({
      id: c.id,
      name: c.name,
      logo: c.logo,
      status: c.status,
      subscriptionPlanCode: c.subscriptionPlanCode,
      location: c.location,
    }));

    return Response.json({ companies });
  } catch (e) {
    return Response.json({ error: 'Failed to load companies.' }, { status: 500 });
  }
}