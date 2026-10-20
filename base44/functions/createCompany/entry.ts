/**
 * createCompany — Create a new company with a selected plan and assign the creator as owner.
 *
 * After company + membership are confirmed, automatically triggers initial
 * Essential SOP library provisioning via the canonical provisionCompanyLibraryCore
 * service. This is a trusted backend consequence of authorized company creation —
 * no separate client request is needed.
 *
 * Input:  { name: string, planCode: string }
 * Output: { success: true, company, membership, provisioning }
 *
 * AUTH: Requires an authenticated session. An unauthenticated call returns 401
 * (never 500) with a safe, user-facing message. The Onboarding frontend is
 * responsible for ensuring the customer registers/signs in before invoking this.
 *
 * IDEMPOTENCY: If this user already owns an ACTIVE company with the same name
 * created in the last 2 minutes AND has an active owner membership, that
 * workspace is returned idempotently instead of creating a duplicate. This
 * handles repeated taps / retries after a response the client did not receive.
 * A recent same-name company WITHOUT an owner membership is an orphan from a
 * failed prior attempt — it is cleaned up and a fresh workspace is created.
 *
 * ORPHAN SAFETY: If Company creation succeeds in this request but membership
 * creation throws, the just-created (membership-less) company is deleted so a
 * retry starts clean and no unusable partial record remains. Only the company
 * created in THIS request (by id) is ever deleted — never any pre-existing
 * legitimate company.
 *
 * FAILURE ISOLATION: A provisioning failure does NOT delete the Company or
 * CompanyMembership. The response always includes the created company, even
 * on provisioning failure.
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
  let client: any = null;
  let company: any = null;
  let membership: any = null;
  let createdCompanyInThisRequest = false;

  try {
    const base44 = createClientFromRequest(req);
    client = base44;

    // ── Auth: a workspace can only be created by an authenticated customer.
    // base44.auth.me() throws when there is no session; we convert that to a
    // clear 401 rather than letting it fall through to the 500 catch-all.
    let user: any = null;
    try {
      user = await base44.auth.me();
    } catch (_) {
      user = null;
    }
    if (!user) {
      return Response.json(
        { error: 'Please sign in or create an account to start your workspace.' },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const name = (body.name || '').trim();
    if (!name) return Response.json({ error: 'Please enter a workspace name.' }, { status: 400 });

    // Plan selection is REQUIRED — we never silently default a new workspace to a
    // paid tier. Onboarding always passes an explicit planCode; a missing value
    // (e.g. a direct API call without one) is rejected rather than granted the
    // highest plan. Existing beta companies keep their stored plan regardless.
    const planCode = (body.planCode || '').trim();
    if (!planCode) return Response.json({ error: 'A plan selection is required to create a workspace.' }, { status: 400 });
    const plan = getPlan(planCode);
    if (!plan) return Response.json({ error: 'That plan is no longer available.' }, { status: 400 });
    if (plan.legacy) return Response.json({ error: 'This plan is not available for new subscriptions.' }, { status: 400 });

    const role = 'general_manager';
    const now = new Date().toISOString();
    const SR = base44.asServiceRole;

    // ── Idempotency: detect a recent same-name workspace for this user.
    // Best-effort — if the lookup throws, we proceed to create.
    const dedupWindowMs = 2 * 60 * 1000;
    const dedupCutoff = Date.now() - dedupWindowMs;
    try {
      const recent = await SR.entities.Company.filter({
        ownerUserId: user.id,
        name,
        status: 'active',
      });
      const candidates = (recent || [])
        .filter((c: any) => c.created_date && new Date(c.created_date).getTime() >= dedupCutoff)
        .sort((a: any, b: any) => new Date(b.created_date).getTime() - new Date(a.created_date).getTime());

      if (candidates.length > 0) {
        const candidate = candidates[0];
        const mems = await SR.entities.CompanyMembership.filter({
          companyId: candidate.id,
          userId: user.id,
          status: 'active',
        });
        const existingMembership = (mems || [])[0] || null;
        if (existingMembership) {
          // Idempotent reuse — a prior create succeeded but the client did not
          // receive the response. Return the existing workspace; do not duplicate.
          console.log(`createCompany idempotent reuse: id=${candidate.id} name="${name}"`);
          return Response.json({
            success: true,
            company: candidate,
            membership: existingMembership,
            provisioning: null,
            idempotent: true,
          });
        }
        // Recent same-name company with NO owner membership = orphan from a
        // failed prior attempt. Clean it up and create fresh below.
        try {
          await SR.entities.Company.delete(candidate.id);
          console.log(`createCompany cleaned up orphan ${candidate.id} during dedup.`);
        } catch (cleanupErr: any) {
          console.error('createCompany orphan cleanup (dedup) failed:', cleanupErr?.message);
        }
      }
    } catch (dedupErr: any) {
      console.error('createCompany dedup lookup failed (proceeding to create):', dedupErr?.message);
    }

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
    createdCompanyInThisRequest = true;

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
      summary: `Company "${name}" created on ${plan.displayName} plan (free beta, no charge).`,
    });

    console.log(`Company created: id=${company.id} name="${name}" plan=${planCode} owner=${user.id}`);

    // ── Step 4: Automatic initial library provisioning ────────────────────────
    // Failure-isolated: Company + membership are preserved regardless of outcome.
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
    console.error('createCompany error:', error?.message, error?.stack);

    // Orphan cleanup: if we created a Company in THIS request but never created
    // its membership, the company is unusable. Delete it so a retry starts clean.
    // Only the company created in THIS request (by id) is ever deleted — never
    // any pre-existing legitimate company.
    if (createdCompanyInThisRequest && company && !membership && client) {
      try {
        await client.asServiceRole.entities.Company.delete(company.id);
        console.log(`createCompany cleaned up orphaned company ${company.id} after failed membership creation.`);
      } catch (cleanupErr: any) {
        console.error('createCompany orphan cleanup failed:', cleanupErr?.message);
      }
    }

    // Safe, non-leaking client message. Technical detail stays in server logs.
    return Response.json(
      { error: 'We could not create your workspace right now. Please try again.' },
      { status: 500 }
    );
  }
}