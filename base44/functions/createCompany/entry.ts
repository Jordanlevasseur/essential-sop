/**
 * createCompany — create a new company with a selected plan and assign the creator as owner.
 *
 * Input: { name: string, planCode: string }
 * Output: { success: true, company, membership }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { getPlan, logActivity } from '../../shared/planUtils.js';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const name = (body.name || '').trim();
    if (!name) return Response.json({ error: 'Company name is required.' }, { status: 400 });

    const planCode = (body.planCode || 'contractor_plus').trim();
    const plan = getPlan(planCode);
    if (!plan) return Response.json({ error: 'Invalid plan code.' }, { status: 400 });

    // Determine role based on plan type
    const role = 'general_manager'; // both individual and business use GM internally
    const now = new Date().toISOString();

    // Create company with subscription fields
    const company = await base44.asServiceRole.entities.Company.create({
      name,
      ownerUserId: user.id,
      status: 'active',
      accountType: plan.accountType,
      subscriptionPlanCode: planCode,
      subscriptionStatus: 'prototype',
      subscriptionSource: 'prototype',
      subscriptionCreatedAt: now,
      subscriptionUpdatedAt: now,
    });

    // Create membership for the creator (this is seat #1 — always within limit since plan has >= 1 seat)
    const membership = await base44.asServiceRole.entities.CompanyMembership.create({
      companyId: company.id,
      userId: user.id,
      role,
      status: 'active',
      joinedAt: now,
    });

    await logActivity(base44.asServiceRole, {
      companyId: company.id,
      actingUserId: user.id,
      actionType: 'plan_selected',
      newPlan: planCode,
      activeSeatCount: 1,
      seatLimit: plan.seatLimit,
      summary: `Company "${name}" created on ${plan.displayName} plan (prototype mode).`,
    });

    console.log(`Company created: id=${company.id} name="${name}" plan=${planCode} owner=${user.id}`);

    return Response.json({ success: true, company, membership });
  } catch (error) {
    console.error('createCompany error:', error?.message);
    return Response.json({ error: error.message || 'Failed to create company.' }, { status: 500 });
  }
}