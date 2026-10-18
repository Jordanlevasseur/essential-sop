/**
 * createCompany — Create a new company with a selected plan and assign the creator as owner.
 *
 * After company + membership are confirmed, automatically triggers initial
 * Essential SOP library provisioning via the canonical provisionCompanyLibraryCore
 * service. This is a trusted backend consequence of authorized company creation —
 * no separate client request is needed.
 *
 * Input:  { name: string, planCode: string }
 * Output: { success: true, company, membership, provisioning: ProvisionCompanyLibraryCoreResult }
 *
 * FAILURE ISOLATION:
 * - A provisioning failure does NOT delete the Company or CompanyMembership.
 * - The response always includes the created company, even on provisioning failure.
 * - The provisioning field reports overallStatus so the client can display results.
 *
 * COMPANY-CREATION ENTRY POINTS:
 * - This is the ONLY authorized backend path for company creation.
 * - The Onboarding frontend calls base44.functions.invoke('createCompany', ...).
 * - No other code path creates Company + CompanyMembership + triggers provisioning.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { getPlan, logActivity } from '../../shared/planUtils.js';
import { provisionCompanyLibraryCore } from '../../shared/companyLibraryProvisioning.ts';

export default async function(req: Request): Promise<Response> {
  let company: any = null;
  let membership: any = null;

  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const name = (body.name || '').trim();
    if (!name) return Response.json({ error: 'Company name is required.' }, { status: 400 });

    // Plan selection is REQUIRED — we never silently default a new workspace to a
    // paid tier. Onboarding always passes an explicit planCode; a missing value
    // (e.g. a direct API call without one) is rejected rather than granted the
    // highest plan. Existing beta companies keep their stored plan regardless.
    const planCode = (body.planCode || '').trim();
    if (!planCode) return Response.json({ error: 'A plan selection is required to create a workspace.' }, { status: 400 });
    const plan = getPlan(planCode);
    if (!plan) return Response.json({ error: 'Invalid plan code.' }, { status: 400 });
    if (plan.legacy) return Response.json({ error: 'This plan is not available for new subscriptions.' }, { status: 400 });

    const role = 'general_manager';
    const now = new Date().toISOString();
    const SR = base44.asServiceRole;

    // ── Step 1: Create Company ────────────────────────────────────────────────
    company = await SR.entities.Company.create({
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

    // ── Step 2: Create owner CompanyMembership (seat #1) ──────────────────────
    membership = await SR.entities.CompanyMembership.create({
      companyId: company.id,
      userId: user.id,
      role,
      status: 'active',
      joinedAt: now,
    });

    // ── Step 3: Log company creation activity ─────────────────────────────────
    await logActivity(SR, {
      companyId: company.id,
      actingUserId: user.id,
      actionType: 'plan_selected',
      newPlan: planCode,
      activeSeatCount: 1,
      seatLimit: plan.seatLimit,
      summary: `Company "${name}" created on ${plan.displayName} plan (prototype mode).`,
    });

    console.log(`Company created: id=${company.id} name="${name}" plan=${planCode} owner=${user.id}`);

    // ── Step 4: Automatic initial library provisioning ────────────────────────
    // Failure-isolated: Company + membership are preserved regardless of outcome.
    // Uses service-role access — authorization was already verified above (authenticated user).
    let provisioning: any = null;
    try {
      provisioning = await provisionCompanyLibraryCore({
        companyId: company.id,
        initiatedByUserId: user.id,
        source: 'COMPANY_CREATION',
        SR,
      });
      console.log(
        `Initial provisioning for company ${company.id}: ` +
        `status=${provisioning.overallStatus} ` +
        `eligible=${provisioning.totalEligible} ` +
        `completed=${provisioning.completed} ` +
        `skipped=${provisioning.skipped} ` +
        `failed=${provisioning.failed}`
      );
    } catch (provisioningErr: any) {
      // Provisioning service threw unexpectedly — record the error but preserve company.
      console.error(`Initial provisioning failed for company ${company.id}:`, provisioningErr?.message);
      provisioning = {
        provisioningRunId: null,
        overallStatus: 'FAILED',
        totalEligible: 0,
        processed: 0,
        completed: 0,
        skipped: 0,
        failed: 0,
        companyJobIds: [],
        failedItems: [],
        retryRecommended: true,
        items: [],
        _error: 'Provisioning service encountered an unexpected error.',
      };
    }

    return Response.json({ success: true, company, membership, provisioning });

  } catch (error: any) {
    console.error('createCompany error:', error?.message);
    // If company was created but membership failed, still return partial data
    // so the client knows the company exists
    if (company && !membership) {
      return Response.json({
        error: 'Company was created but membership setup failed. Contact support.',
        company,
        membership: null,
        provisioning: null,
      }, { status: 500 });
    }
    return Response.json({ error: error.message || 'Failed to create company.' }, { status: 500 });
  }
}