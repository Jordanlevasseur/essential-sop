/**
 * updateCompanySettings — GM-authorized edit of company profile fields and/or
 * role labels.
 *
 * SECURITY: Replaces direct client `Company.update` calls (Company entity is
 * RLS-closed to direct client writes). Only a general_manager of the company
 * may call this. The update payload is built from a STRICT WHITELIST of
 * non-sensitive profile fields plus customRoleLabels — subscription,
 * billing, status, and ownerUserId fields are never accepted here, so a
 * client cannot modify subscription entitlements or ownership through this
 * function. Entitlement changes remain the sole responsibility of managePlan.
 *
 * Input:  { companyId, profile?: {...}, customRoleLabels?: {...} }
 * Output: { success: true, company }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

const SENSITIVE_FIELDS = ['billingCustomerId', 'billingSubscriptionId', 'planPlaceholder'];
const PROFILE_STRING_FIELDS = ['phone', 'email', 'website', 'location', 'description'];
const ROLE_LABEL_KEYS = ['project_manager', 'project_lead', 'technician'];

function stripSensitive(company) {
  if (!company) return null;
  const out = { ...company };
  for (const f of SENSITIVE_FIELDS) delete out[f];
  return out;
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { companyId, profile, customRoleLabels } = body;
    if (!companyId) {
      return Response.json({ error: 'companyId is required.' }, { status: 400 });
    }

    const SR = base44.asServiceRole;

    // Authorization: active general_manager of this company only.
    const memberships = await SR.entities.CompanyMembership.filter({
      companyId, userId: user.id, status: 'active',
    });
    const membership = (memberships || [])[0];
    if (!membership || membership.role !== 'general_manager') {
      return Response.json(
        { error: 'Only a General Manager can edit company settings.' },
        { status: 403 }
      );
    }

    const company = await SR.entities.Company.get(companyId).catch(() => null);
    if (!company) {
      return Response.json({ error: 'Company not found.' }, { status: 404 });
    }

    const update = {};

    if (profile && typeof profile === 'object') {
      if (typeof profile.name === 'string') {
        if (!profile.name.trim()) {
          return Response.json({ error: 'Company name is required.' }, { status: 400 });
        }
        update.name = profile.name.trim();
      }
      for (const f of PROFILE_STRING_FIELDS) {
        if (typeof profile[f] === 'string') update[f] = profile[f].trim();
      }
      if (Array.isArray(profile.tradeSpecialties)) {
        update.tradeSpecialties = profile.tradeSpecialties.filter(s => typeof s === 'string');
      }
    }

    if (customRoleLabels && typeof customRoleLabels === 'object') {
      const cleaned = {};
      for (const k of ROLE_LABEL_KEYS) {
        const v = customRoleLabels[k];
        if (v != null && typeof v === 'string') cleaned[k] = v;
      }
      update.customRoleLabels = cleaned;
    }

    if (Object.keys(update).length === 0) {
      return Response.json({ success: true, company: stripSensitive(company) });
    }

    const updated = await SR.entities.Company.update(companyId, update);

    // Best-effort activity log.
    try {
      await SR.entities.ActivityLog.create({
        companyId,
        actingUserId: user.id,
        actionType: 'job_edited', // closest available — company settings change
        summary: `${user.full_name || user.email} updated company settings`,
        timestamp: new Date().toISOString(),
      });
    } catch (_) { /* best effort */ }

    return Response.json({ success: true, company: stripSensitive(updated) });
  } catch (e) {
    return Response.json({ error: 'Failed to update company settings.' }, { status: 500 });
  }
}