/**
 * syncCompanyLibrary — Lightweight Company Library Sync
 *
 * Called automatically on every Company workspace open (via AppContext) and
 * manually from the Sync Settings page.
 *
 * Sync model:
 *  1. Load all eligible Masters (ID + version ID + policy only).
 *  2. Load the company's existing essential_sop Jobs (ID + sourceMasterId + sourceVersionId).
 *  3. Compare: find missing Jobs and Jobs on outdated versions.
 *  4. Provision missing Jobs via provisionMasterToOneCompany().
 *  5. For outdated Jobs: if a CompanyVersionDecision already exists, skip. Otherwise create one.
 *  6. Return a lightweight summary — no heavy content downloads.
 *
 * Auth: any authenticated user with an active CompanyMembership may trigger a sync
 * for their own company. Service role is used only for writes.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import {
  provisionMasterToOneCompany,
  buildProvisioningKey,
  isCompanyEligibleForMaster,
} from '../../shared/companyLibraryProvisioning.ts';

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);

    // ── Auth ──────────────────────────────────────────────────────────────────
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { companyId } = body;
    if (!companyId || typeof companyId !== 'string') {
      return Response.json({ error: 'companyId is required' }, { status: 400 });
    }

    const SR = base44.asServiceRole;

    // ── Verify membership ─────────────────────────────────────────────────────
    let membership: any = null;
    try {
      const memberships = await SR.entities.CompanyMembership.filter({
        companyId,
        userId: user.id,
        status: 'active',
      });
      membership = memberships?.[0] || null;
    } catch (_) {}
    if (!membership) {
      return Response.json({ error: 'No active membership for this company' }, { status: 403 });
    }

    // ── Load company record ───────────────────────────────────────────────────
    let company: any = null;
    try { company = await SR.entities.Company.get(companyId); } catch (_) {}
    if (!company) return Response.json({ error: 'Company not found' }, { status: 404 });

    const startedAt = new Date().toISOString();
    const companyCreatedDate: string = company.created_date || startedAt;

    // ── Load eligible Master SOPs (lightweight — no section content) ──────────
    let allMasters: any[] = [];
    try {
      allMasters = await SR.entities.EssentialSOPMaster.filter(
        { status: 'active', distributionStatus: 'customer_available' },
        '-updatedAt',
        500
      ) || [];
    } catch (_) {
      return Response.json({ error: 'Failed to load master library' }, { status: 500 });
    }

    // Filter to eligible masters by policy
    const eligibleMasters = allMasters.filter(m => {
      if (!m.currentPublishedVersionId) return false;
      const eligibility = isCompanyEligibleForMaster({
        companyId,
        companyCreatedDate,
        masterPolicy: m.defaultDistributionPolicy || 'MANUAL',
        masterSelectedCompanyIds: Array.isArray(m.defaultSelectedCompanyIds) ? m.defaultSelectedCompanyIds : [],
        masterPolicyCutoffDate: m.distributionPolicyUpdatedAt || m.created_date || startedAt,
        effectiveSelectedIds: null,
      });
      return eligibility.eligible;
    });

    if (eligibleMasters.length === 0) {
      return Response.json({
        synced: true,
        summary: { checked: 0, added: 0, outdated: 0, skipped: 0, failed: 0 },
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: 0,
      });
    }

    // ── Load existing essential_sop Jobs for this company (lightweight) ───────
    let existingJobs: any[] = [];
    try {
      existingJobs = await SR.entities.Job.filter(
        { companyId, sourceType: 'essential_sop' },
        '-created_date',
        500
      ) || [];
    } catch (_) {}

    const existingJobByMasterId = new Map<string, any>();
    for (const j of existingJobs) {
      if (j.sourceMasterId) existingJobByMasterId.set(j.sourceMasterId, j);
    }

    // ── Load existing ProvisioningRecords (for idempotency) ───────────────────
    let existingRecords: any[] = [];
    try {
      existingRecords = await SR.entities.ProvisioningRecord.filter(
        { companyId, operationType: 'INITIAL_COMPANY_LIBRARY' },
        '-createdAt',
        500
      ) || [];
    } catch (_) {}
    const existingRecordByKey = new Map<string, any>();
    for (const rec of existingRecords) {
      if (rec.provisioningKey) existingRecordByKey.set(rec.provisioningKey, rec);
    }

    // ── Load existing CompanyVersionDecisions for this company ────────────────
    let existingDecisions: any[] = [];
    try {
      existingDecisions = await SR.entities.CompanyVersionDecision.filter(
        { companyId, status: 'PENDING' },
        '-createdAt',
        500
      ) || [];
    } catch (_) {}
    // Key: `${jobId}:${toVersionId}`
    const decisionKeySet = new Set<string>(
      existingDecisions.map((d: any) => `${d.companyJobId}:${d.toVersionId}`)
    );

    // ── Bulk-load published versions ──────────────────────────────────────────
    const versionIds = [...new Set(eligibleMasters.map((m: any) => m.currentPublishedVersionId).filter(Boolean))];
    const versionMap = new Map<string, any>();
    const versionFetches = await Promise.allSettled(
      versionIds.map(async (vid: string) => {
        try { const v = await SR.entities.EssentialSOPVersion.get(vid); return { vid, v }; } catch (_) { return { vid, v: null }; }
      })
    );
    for (const r of versionFetches) {
      if (r.status === 'fulfilled' && r.value.v) {
        versionMap.set(r.value.vid, r.value.v);
      }
    }

    // ── Compare + act ─────────────────────────────────────────────────────────
    const now = new Date().toISOString();
    let added = 0;
    let outdated = 0;
    let skipped = 0;
    let failed = 0;
    const failedItems: Array<{ masterId: string; masterTitle: string; errorCode: string; errorMessage: string }> = [];

    for (const master of eligibleMasters) {
      const existingJob = existingJobByMasterId.get(master.id) || null;
      const currentPublishedVersionId = master.currentPublishedVersionId;
      const publishedVersion = versionMap.get(currentPublishedVersionId) || null;
      const provisioningKey = buildProvisioningKey(companyId, master.id);
      const existingRecord = existingRecordByKey.get(provisioningKey) || null;

      try {
        if (!existingJob) {
          // ── Case 1: Job is missing — provision it ────────────────────────
          const result = await provisionMasterToOneCompany({
            SR,
            company,
            master,
            publishedVersion,
            source: 'COMPANY_CREATION',
            distributionEventId: null,
            existingJob: null,
            existingRecord,
            now,
          });

          if (result.result === 'COMPLETED') {
            added++;
            // Register in-memory for loop idempotency
            existingJobByMasterId.set(master.id, { id: result.companyJobId, sourceMasterId: master.id, sourceVersionId: currentPublishedVersionId });
          } else if (result.result === 'SKIPPED') {
            skipped++;
          } else {
            failed++;
            failedItems.push({ masterId: master.id, masterTitle: master.title, errorCode: result.errorCode || 'PROVISION_FAILED', errorMessage: result.errorMessage || 'Provision failed.' });
          }
        } else if (existingJob.sourceVersionId && existingJob.sourceVersionId !== currentPublishedVersionId) {
          // ── Case 2: Job exists but is on an older version ────────────────
          // We do NOT force-adopt. Create a CompanyVersionDecision if not already there.
          const decKey = `${existingJob.id}:${currentPublishedVersionId}`;
          if (!decisionKeySet.has(decKey)) {
            try {
              // Check by decisionKey field for idempotency
              const decisionKey = `VERSION_DECISION:${existingJob.id}:${currentPublishedVersionId}`;
              const existingDecByKey = await SR.entities.CompanyVersionDecision.filter({ decisionKey }, '-createdAt', 1).catch(() => []);
              if (!existingDecByKey || existingDecByKey.length === 0) {
                await SR.entities.CompanyVersionDecision.create({
                  companyId,
                  companyJobId: existingJob.id,
                  masterId: master.id,
                  fromVersionId: existingJob.sourceVersionId,
                  toVersionId: currentPublishedVersionId,
                  distributionEventId: null,
                  decisionKey,
                  status: 'PENDING',
                  createdAt: now,
                  createdBy: user.id,
                  updatedAt: now,
                });
              }
              decisionKeySet.add(decKey);
            } catch (_) {}
            outdated++;
          } else {
            // Decision already exists
            skipped++;
          }
        } else {
          // ── Case 3: Job exists and is on the correct version ─────────────
          skipped++;
        }
      } catch (outerErr: any) {
        failed++;
        failedItems.push({ masterId: master.id, masterTitle: master.title, errorCode: 'UNEXPECTED_ERROR', errorMessage: outerErr?.message || 'Unexpected error.' });
      }
    }

    const completedAt = new Date().toISOString();
    const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

    return Response.json({
      synced: true,
      summary: {
        checked: eligibleMasters.length,
        added,
        outdated,
        skipped,
        failed,
      },
      failedItems,
      startedAt,
      completedAt,
      durationMs,
    });

  } catch (error: any) {
    return Response.json({ error: error.message || 'Sync failed' }, { status: 500 });
  }
}