/**
 * managePlan — handle plan changes (upgrade / downgrade) with full safety enforcement.
 *
 * Input: { companyId: string, targetPlanCode: string }
 * Output: { success: true, company, usage } | { error, blocked?, reason }
 *
 * BILLING STATUS:
 * - Prototype only. No real payment is processed.
 * - Apple IAP: NOT connected.
 * - Stripe: NOT connected.
 *
 * Future billing hooks: startSubscription, changeSubscriptionPlan,
 * cancelSubscription, restoreSubscription, syncSubscriptionStatus,
 * processSubscriptionWebhook — wire into this function when a provider is connected.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { getPlan, getSeatUsage, isUnlimited, logActivity, PLANS } from '../../shared/planUtils.js';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { companyId, targetPlanCode } = body;
    if (!companyId || !targetPlanCode) {
      return Response.json({ error: 'companyId and targetPlanCode are required.' }, { status: 400 });
    }

    const targetPlan = getPlan(targetPlanCode);
    if (!targetPlan) {
      return Response.json({ error: 'Invalid plan code.' }, { status: 400 });
    }

    // Authorization: only general_manager or owner can change plan
    const userMemberships = await base44.asServiceRole.entities.CompanyMembership.filter({
      companyId,
      userId: user.id,
      status: 'active',
    });
    const userMembership = (userMemberships || [])[0];
    if (!userMembership || !['general_manager', 'owner'].includes(userMembership.role)) {
      return Response.json({ error: 'Only a General Manager can manage the subscription plan.' }, { status: 403 });
    }

    // Load current company
    const company = await base44.asServiceRole.entities.Company.get(companyId);
    if (!company) return Response.json({ error: 'Company not found.' }, { status: 404 });

    const currentPlanCode = company.subscriptionPlanCode || 'contractor';
    const currentPlan = getPlan(currentPlanCode);

    if (currentPlanCode === targetPlanCode) {
      return Response.json({ error: 'Company is already on this plan.' }, { status: 400 });
    }

    const isUpgrade = targetPlan.sortOrder > (currentPlan ? currentPlan.sortOrder : 0);
    const isDowngrade = targetPlan.sortOrder < (currentPlan ? currentPlan.sortOrder : 999);

    // Get current seat usage
    const usage = await getSeatUsage(base44.asServiceRole, companyId, currentPlanCode);

    if (isDowngrade) {
      // Check if active seats fit within the target plan (unlimited plans never block)
      if (!isUnlimited(targetPlan) && usage.activeSeatCount > targetPlan.seatLimit) {
        await logActivity(base44.asServiceRole, {
          companyId, actingUserId: user.id,
          actionType: 'downgrade_blocked',
          previousPlan: currentPlanCode, newPlan: targetPlanCode,
          activeSeatCount: usage.activeSeatCount, seatLimit: targetPlan.seatLimit,
          summary: `Downgrade to ${targetPlan.displayName} blocked: ${usage.activeSeatCount} active profiles exceed limit of ${targetPlan.seatLimit}.`,
        });
        return Response.json({
          error: `This workspace currently has ${usage.activeSeatCount} active profiles, but the ${targetPlan.displayName} plan allows ${targetPlan.seatLimit}. Remove or suspend profiles before downgrading.`,
          blocked: true,
          activeSeatCount: usage.activeSeatCount,
          targetSeatLimit: targetPlan.seatLimit,
        }, { status: 409 });
      }

      // For Homeowner downgrade: extra safety checks
      if (targetPlanCode === 'homeowner') {
        if (usage.activeSeatCount > 1) {
          return Response.json({
            error: `This workspace currently has ${usage.activeSeatCount} active profiles, but the Homeowner plan allows 1. Remove or suspend profiles before downgrading.`,
            blocked: true,
            activeSeatCount: usage.activeSeatCount,
            targetSeatLimit: 1,
          }, { status: 409 });
        }
      }
    }

    // Apply the plan change
    const now = new Date().toISOString();
    const updatedCompany = await base44.asServiceRole.entities.Company.update(companyId, {
      subscriptionPlanCode: targetPlanCode,
      subscriptionStatus: 'prototype',
      subscriptionSource: 'prototype',
      subscriptionUpdatedAt: now,
    });

    const newUsage = await getSeatUsage(base44.asServiceRole, companyId, targetPlanCode);

    // Check if the company is now over-limit (edge case from external changes)
    if (newUsage.isOverLimit) {
      await logActivity(base44.asServiceRole, {
        companyId, actingUserId: user.id,
        actionType: 'account_over_limit',
        previousPlan: currentPlanCode, newPlan: targetPlanCode,
        activeSeatCount: newUsage.activeSeatCount, seatLimit: newUsage.seatLimit,
        summary: `Company is over-limit after plan change to ${targetPlan.displayName}.`,
      });
    }

    const actionType = isUpgrade ? 'plan_upgraded' : 'plan_downgraded';
    await logActivity(base44.asServiceRole, {
      companyId, actingUserId: user.id, actionType,
      previousPlan: currentPlanCode, newPlan: targetPlanCode,
      activeSeatCount: newUsage.activeSeatCount, seatLimit: newUsage.seatLimit,
      summary: `Plan changed from ${currentPlan?.displayName || currentPlanCode} to ${targetPlan.displayName} (prototype mode, no charge).`,
    });

    console.log(`Plan changed: company=${companyId} from=${currentPlanCode} to=${targetPlanCode} by=${user.id}`);

    return Response.json({
      success: true,
      company: updatedCompany,
      usage: newUsage,
      isUpgrade,
      isDowngrade,
      previousPlan: currentPlanCode,
      newPlan: targetPlanCode,
    });
  } catch (error) {
    console.error('managePlan error:', error?.message);
    return Response.json({ error: error.message || 'Failed to update plan.' }, { status: 500 });
  }
}