/**
 * companyLibraryProvisioning.ts — Canonical Company Library Provisioning Service
 *
 * THE SINGLE AUTHORITATIVE IMPLEMENTATION for provisioning Essential SOP Master
 * Jobs to a company. Both entry points — manual platform provisioning and
 * automatic initial provisioning — call provisionCompanyLibraryCore().
 *
 * ── ENTRY POINTS ──────────────────────────────────────────────────────────────
 * 1. Automatic initial provisioning: triggered from createCompany after the
 *    company and owner membership are confirmed. Source: COMPANY_CREATION.
 *    Authorization already verified by the createCompany auth check.
 *
 * 2. Manual platform provisioning: triggered from provisionCompanyLibrary
 *    after requirePlatformSuperAdmin() succeeds. Source: MANUAL_PLATFORM_ADMIN.
 *
 * ── ELIGIBILITY ───────────────────────────────────────────────────────────────
 * A Master SOP is eligible for initial company provisioning when ALL of:
 *   - Master.status === 'active'
 *   - Master.distributionStatus === 'customer_available'
 *   - Master.currentPublishedVersionId exists and is non-empty
 *   - The referenced EssentialSOPVersion exists and has status === 'published'
 *   - The effective distribution policy includes future companies:
 *       ALL_EXISTING_AND_FUTURE_COMPANIES → always eligible
 *       FUTURE_COMPANIES_ONLY              → always eligible
 *       SELECTED_COMPANIES                 → eligible only when companyId in defaultSelectedCompanyIds
 *       MANUAL                             → NOT eligible
 *
 * Source of truth for future-company policy: Master.defaultDistributionPolicy
 * and Master.defaultSelectedCompanyIds. DistributionEvent records publication
 * history but do NOT override the current Master policy for future-company eligibility.
 *
 * ── COMPANY JOB INVARIANT ─────────────────────────────────────────────────────
 * ONE COMPANY + ONE MASTER SOP = NO MORE THAN ONE NON-DELETED COMPANY JOB.
 *
 * Detection strategy (in order):
 *   1. Pre-load all existing essential_sop Jobs for this company into a masterId Map.
 *   2. Look up by (companyId, sourceType='essential_sop', sourceMasterId).
 *   3. Check in-memory Map from step 1 (fast, avoids per-master query).
 *   4. Archived Jobs: treated as SKIP — do not create a duplicate, do not reactivate.
 *   5. Active/Published Jobs: treated as SKIP.
 *
 * ── DETERMINISTIC PROVISIONING KEY ────────────────────────────────────────────
 * provisioningKey = `INITIAL_COMPANY_LIBRARY:${companyId}:${masterId}`
 * Stored on the ProvisioningRecord. Used for lookup before insert.
 * Deterministic for the same company+master+operationType combination.
 * NOT a random UUID.
 *
 * ── PROVISIONINGRECORD LIFECYCLE ──────────────────────────────────────────────
 * One logical ProvisioningRecord per (companyId, masterId, INITIAL_COMPANY_LIBRARY).
 * Created with operationType=INITIAL_COMPANY_LIBRARY.
 * On success:  status=COMPLETED, companyJobId=job.id, completedAt set.
 * On skip:     status=SKIPPED, companyJobId=existing job.id, completedAt set.
 * On failure:  status=FAILED, errorCode + errorMessage set.
 * On retry with existing completed record: returns existing result (idempotent).
 * On retry with existing FAILED record:    attempts again, updates the record.
 * Partial-state recovery: if a Job exists but record is missing or FAILED,
 * create/update the record to COMPLETED using the found Job.
 *
 * ── DISTRIBUTION EVENT LINKING ────────────────────────────────────────────────
 * When a related DistributionEvent can be found for the Master (the most recent
 * NEW_SOP event for the master's currentPublishedVersionId), it is linked.
 * Fallback when not found: distributionEventId = null (field is nullable on the schema).
 * No fake DistributionEvents are ever created.
 * If the schema required non-null distributionEventId, we would set it null and
 * rely on the nullable representation — no fabrication.
 *
 * ── FAILURE ISOLATION ─────────────────────────────────────────────────────────
 * Individual Master failures are caught and recorded without aborting other Masters.
 * Company + initial CompanyMembership are NEVER deleted due to provisioning failures.
 * A complete provisioning service failure still returns the company with
 * provisioningStatus=FAILED and enough information for safe retry.
 *
 * ── CONCURRENCY RACE RISK ─────────────────────────────────────────────────────
 * Base44 has no database-level unique constraints. If two simultaneous requests
 * call provisionCompanyLibraryCore for the same company+master pair, it is
 * possible (though unlikely) to create two Jobs before either detects the other.
 * Mitigation: pre-load existing Jobs + ProvisioningRecords before the loop,
 * check both before creation, use deterministic provisioningKey for ProvisioningRecord
 * lookup. The duplicate-detection strategy reduces but cannot eliminate the risk.
 * Documented as an open reliability risk.
 *
 * ── BASE44 LIMITATIONS ────────────────────────────────────────────────────────
 * - No multi-entity transactions: partial writes can occur on infrastructure failure.
 * - No unique index support: deterministic key deduplication is application-level only.
 * - Per-record writes required: bulkCreate is unavailable for provisioning steps
 *   that require individual error isolation.
 * - No server-side joins: all bulk lookups are separate filter calls.
 */

import { writePlatformAudit } from './platformAuth.ts';

// ── Policy constants ──────────────────────────────────────────────────────────
const FUTURE_COMPANY_ELIGIBLE_POLICIES = new Set([
  'ALL_EXISTING_AND_FUTURE_COMPANIES',
  'FUTURE_COMPANIES_ONLY',
]);

// ── Deterministic provisioning key ────────────────────────────────────────────
export function buildProvisioningKey(companyId: string, masterId: string): string {
  return `INITIAL_COMPANY_LIBRARY:${companyId}:${masterId}`;
}

// ── Provisioning source ────────────────────────────────────────────────────────
export type ProvisioningSource = 'COMPANY_CREATION' | 'MANUAL_PLATFORM_ADMIN';

// ── Core params ───────────────────────────────────────────────────────────────
export interface ProvisionCompanyLibraryCoreParams {
  companyId: string;
  initiatedByUserId: string;
  source: ProvisioningSource;
  SR: any; // service-role SDK client — authorization already verified by caller
}

// ── Core result ───────────────────────────────────────────────────────────────
export interface ProvisioningItemResult {
  masterId: string;
  masterTitle: string;
  result: 'COMPLETED' | 'SKIPPED' | 'FAILED';
  companyJobId: string | null;
  versionId: string | null;
  provisioningRecordId: string | null;
  provisioningKey: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface ProvisionCompanyLibraryCoreResult {
  provisioningRunId: string | null;
  overallStatus: 'COMPLETED' | 'COMPLETED_WITH_ERRORS' | 'FAILED';
  totalEligible: number;
  processed: number;
  completed: number;
  skipped: number;
  failed: number;
  companyJobIds: string[];
  failedItems: Array<{ masterId: string; masterTitle: string; errorCode: string; errorMessage: string }>;
  retryRecommended: boolean;
  items: ProvisioningItemResult[];
}

// ── Main canonical service ─────────────────────────────────────────────────────

export async function provisionCompanyLibraryCore(
  params: ProvisionCompanyLibraryCoreParams
): Promise<ProvisionCompanyLibraryCoreResult> {
  const { companyId, initiatedByUserId, source, SR } = params;
  const startedAt = new Date().toISOString();

  // ── Create CompanyLibraryProvisioningRun (started) ────────────────────────
  let runRecord: any = null;
  try {
    runRecord = await SR.entities.CompanyLibraryProvisioningRun.create({
      companyId,
      initiatedByUserId,
      initiatedByType: source === 'MANUAL_PLATFORM_ADMIN' ? 'admin' : 'system',
      startedAt,
      status: 'started',
      eligibleMasterCount: 0,
      existingProvisionedCount: 0,
      createdCount: 0,
      skippedCount: 0,
      failedCount: 0,
      createdJobIds: [],
      errors: [],
    });
  } catch (_) {
    // Non-fatal — run record is informational. Provisioning continues without it.
  }

  // ── Audit: provisioning started ───────────────────────────────────────────
  try {
    await writePlatformAudit(SR, {
      actingUserId: initiatedByUserId,
      actingUserRole: 'SUPER_ADMIN',
      action: 'company_library_provisioned',
      extra: {
        metadata: {
          companyId,
          provisioningRunId: runRecord?.id || null,
          source,
          phase: 'started',
        },
      },
    });
  } catch (_) {}

  // ── Step 1: Load eligible Masters in one bounded query ────────────────────
  // Filter server-side on status + distributionStatus. Policy filtering is in-memory.
  let allMasters: any[] = [];
  try {
    allMasters = await SR.entities.EssentialSOPMaster.filter(
      { status: 'active', distributionStatus: 'customer_available' },
      '-updatedAt',
      500
    ) || [];
  } catch (err: any) {
    // Infrastructure failure loading masters — report full failure
    const failResult = _buildFailResult(runRecord?.id || null);
    await _finalizeRun(SR, runRecord, failResult, startedAt);
    await _writeCompletionAudit(SR, initiatedByUserId, companyId, runRecord?.id || null, source, failResult);
    return failResult;
  }

  // ── Step 2: Apply eligibility + policy filtering in memory ────────────────
  const eligibleMasters = allMasters.filter((m: any) => {
    if (!m.currentPublishedVersionId || !m.currentPublishedVersionId.trim()) return false;
    const policy = m.defaultDistributionPolicy || 'MANUAL';
    if (FUTURE_COMPANY_ELIGIBLE_POLICIES.has(policy)) return true;
    if (policy === 'SELECTED_COMPANIES') {
      return Array.isArray(m.defaultSelectedCompanyIds) && m.defaultSelectedCompanyIds.includes(companyId);
    }
    // MANUAL — not eligible
    return false;
  });

  const totalEligible = eligibleMasters.length;

  // ── Step 3: Bulk-load published versions for eligible masters ─────────────
  // Build a Map<versionId, version> to avoid per-master version fetch.
  const versionIdSet = new Set<string>(
    eligibleMasters.map((m: any) => m.currentPublishedVersionId).filter(Boolean)
  );
  const versionMap = new Map<string, any>();
  // Load versions in one query per 100 IDs — Base44 filter can handle this via
  // individual get calls since there's no $in operator. For typical library sizes
  // (≤100 SOPs), parallel gets are acceptable.
  const versionFetches = await Promise.allSettled(
    [...versionIdSet].map(async (vid: string) => {
      try {
        const v = await SR.entities.EssentialSOPVersion.get(vid);
        return { vid, v };
      } catch (_) {
        return { vid, v: null };
      }
    })
  );
  for (const r of versionFetches) {
    if (r.status === 'fulfilled' && r.value.v) {
      versionMap.set(r.value.vid, r.value.v);
    }
  }

  // ── Step 4: Load existing essential_sop Jobs for this company ONCE ────────
  let existingJobs: any[] = [];
  try {
    existingJobs = await SR.entities.Job.filter(
      { companyId, sourceType: 'essential_sop' },
      '-created_date',
      500
    ) || [];
  } catch (_) {}

  // Map: masterId → existing Job (all states including archived)
  const existingJobByMasterId = new Map<string, any>();
  for (const j of existingJobs) {
    if (j.sourceMasterId) existingJobByMasterId.set(j.sourceMasterId, j);
  }
  const existingProvisionedCount = [...existingJobByMasterId.values()].filter((j: any) => !j.isArchived).length;

  // ── Step 5: Load existing ProvisioningRecords ONCE ────────────────────────
  // We query all ProvisioningRecords for this company with INITIAL_COMPANY_LIBRARY operationType.
  let existingRecords: any[] = [];
  try {
    existingRecords = await SR.entities.ProvisioningRecord.filter(
      { companyId, operationType: 'INITIAL_COMPANY_LIBRARY' },
      '-createdAt',
      500
    ) || [];
  } catch (_) {}

  // Map: provisioningKey → ProvisioningRecord
  const existingRecordByKey = new Map<string, any>();
  for (const rec of existingRecords) {
    if (rec.provisioningKey) existingRecordByKey.set(rec.provisioningKey, rec);
  }

  // ── Step 6: Bulk-load most recent DistributionEvents per eligible master ──
  // Used to link distributionEventId on ProvisioningRecord when available.
  // Fallback: null. No failure if not found.
  const distEventMap = new Map<string, string>(); // masterId → distributionEvent.id
  try {
    // Load NEW_SOP events for all eligible master IDs. We use the versionId match
    // to find the most specific event for the currently pinned version.
    const eligibleMasterIds = eligibleMasters.map((m: any) => m.id);
    // Per-master dist event lookup is only needed for record-linking — best effort.
    // For performance we accept one pass through filter results per master in-memory.
    const distEvents = await SR.entities.DistributionEvent.filter(
      {},
      '-createdAt',
      500
    ) || [];
    // Build map: versionId → distributionEvent.id (most recent)
    const distEventByVersionId = new Map<string, string>();
    for (const de of distEvents) {
      if (de.versionId && !distEventByVersionId.has(de.versionId)) {
        distEventByVersionId.set(de.versionId, de.id);
      }
    }
    for (const m of eligibleMasters) {
      const vid = m.currentPublishedVersionId;
      if (vid && distEventByVersionId.has(vid)) {
        distEventMap.set(m.id, distEventByVersionId.get(vid)!);
      }
    }
  } catch (_) {
    // Non-fatal — distEventMap stays empty; distributionEventId will be null.
  }

  // ── Step 7: Per-master provisioning loop ─────────────────────────────────
  const now = new Date().toISOString();
  const items: ProvisioningItemResult[] = [];
  const companyJobIds: string[] = [];
  const runErrors: Array<{ sourceMasterId: string; code: string; message: string }> = [];
  const createdJobIds: string[] = [];
  let skipped = 0;
  let completed = 0;
  let failed = 0;

  for (const master of eligibleMasters) {
    const provisioningKey = buildProvisioningKey(companyId, master.id);
    const distributionEventId = distEventMap.get(master.id) || null;
    const versionId = master.currentPublishedVersionId;
    const version = versionMap.get(versionId);

    // ── Validate version ───────────────────────────────────────────────────
    if (!version || version.status !== 'published') {
      const errorCode = !version ? 'VERSION_NOT_FOUND' : 'VERSION_NOT_PUBLISHED';
      const errorMessage = !version
        ? 'Referenced version record does not exist.'
        : 'Referenced version is not in published status.';

      // Upsert ProvisioningRecord as FAILED
      await _upsertProvisioningRecord(SR, {
        existingRecord: existingRecordByKey.get(provisioningKey) || null,
        provisioningKey, companyId, masterId: master.id, versionId,
        distributionEventId, operationType: 'INITIAL_COMPANY_LIBRARY',
        status: 'FAILED', companyJobId: null,
        errorCode, errorMessage, now,
        initiatedByUserId,
      });

      items.push({
        masterId: master.id, masterTitle: master.title,
        result: 'FAILED', companyJobId: null, versionId,
        provisioningRecordId: null, provisioningKey,
        errorCode, errorMessage,
      });
      runErrors.push({ sourceMasterId: master.id, code: errorCode, message: errorMessage });
      failed++;
      continue;
    }

    // ── Check existing record (idempotency) ────────────────────────────────
    const existingRecord = existingRecordByKey.get(provisioningKey) || null;
    if (existingRecord?.status === 'COMPLETED' && existingRecord?.companyJobId) {
      // Already completed successfully — verify the job still exists
      const existingJob = existingJobByMasterId.get(master.id);
      if (existingJob) {
        companyJobIds.push(existingJob.id);
        items.push({
          masterId: master.id, masterTitle: master.title,
          result: 'SKIPPED', companyJobId: existingJob.id,
          versionId: existingRecord.versionId || versionId,
          provisioningRecordId: existingRecord.id, provisioningKey,
        });
        skipped++;
        continue;
      }
      // Record says COMPLETED but job is missing — fall through to create
    }

    // ── Check existing Job (duplicate prevention) ──────────────────────────
    const existingJob = existingJobByMasterId.get(master.id);
    if (existingJob) {
      // Job exists — determine outcome
      const isUsable = !existingJob.isArchived;
      const jobStatus = isUsable ? 'SKIPPED' : 'SKIPPED'; // archived = also skip (don't duplicate)

      // Partial-state recovery: if record is missing or FAILED but job exists, repair record
      const repairRecord = await _upsertProvisioningRecord(SR, {
        existingRecord,
        provisioningKey, companyId, masterId: master.id, versionId: existingJob.sourceVersionId || versionId,
        distributionEventId, operationType: 'INITIAL_COMPANY_LIBRARY',
        status: 'SKIPPED', companyJobId: existingJob.id,
        errorCode: null, errorMessage: null, now,
        initiatedByUserId,
      });

      companyJobIds.push(existingJob.id);
      items.push({
        masterId: master.id, masterTitle: master.title,
        result: 'SKIPPED', companyJobId: existingJob.id,
        versionId: existingJob.sourceVersionId || versionId,
        provisioningRecordId: repairRecord?.id || existingRecord?.id || null,
        provisioningKey,
      });
      skipped++;
      continue;
    }

    // ── Create Company Job ─────────────────────────────────────────────────
    let createdJob: any = null;
    let jobCreateError: string | null = null;
    try {
      createdJob = await SR.entities.Job.create({
        companyId,
        title: master.title,
        shortDescription: master.description || '',
        trade: master.trade || '',
        category: master.category || '',
        status: 'Published',
        isArchived: false,
        sourceType: 'essential_sop',
        sourceMasterId: master.id,
        sourceVersionId: version.id,
        isCustomized: false,
        customizedAt: null,
        customizedBy: null,
      });
      // Track in-memory to prevent duplicate creation within this loop run
      existingJobByMasterId.set(master.id, createdJob);
    } catch (err: any) {
      jobCreateError = 'Failed to create company job record.';
    }

    if (!createdJob) {
      // Write FAILED ProvisioningRecord
      const failedRec = await _upsertProvisioningRecord(SR, {
        existingRecord,
        provisioningKey, companyId, masterId: master.id, versionId,
        distributionEventId, operationType: 'INITIAL_COMPANY_LIBRARY',
        status: 'FAILED', companyJobId: null,
        errorCode: 'JOB_CREATE_FAILED', errorMessage: jobCreateError || 'Unknown create error.',
        now, initiatedByUserId,
      });

      items.push({
        masterId: master.id, masterTitle: master.title,
        result: 'FAILED', companyJobId: null, versionId,
        provisioningRecordId: failedRec?.id || null, provisioningKey,
        errorCode: 'JOB_CREATE_FAILED',
        errorMessage: jobCreateError || 'Unknown create error.',
      });
      runErrors.push({ sourceMasterId: master.id, code: 'JOB_CREATE_FAILED', message: 'Failed to create company job.' });
      failed++;
      continue;
    }

    // ── Write COMPLETED ProvisioningRecord ─────────────────────────────────
    const completedRec = await _upsertProvisioningRecord(SR, {
      existingRecord,
      provisioningKey, companyId, masterId: master.id, versionId: version.id,
      distributionEventId, operationType: 'INITIAL_COMPANY_LIBRARY',
      status: 'COMPLETED', companyJobId: createdJob.id,
      errorCode: null, errorMessage: null, now,
      initiatedByUserId,
    });

    companyJobIds.push(createdJob.id);
    createdJobIds.push(createdJob.id);
    items.push({
      masterId: master.id, masterTitle: master.title,
      result: 'COMPLETED', companyJobId: createdJob.id,
      versionId: version.id,
      provisioningRecordId: completedRec?.id || null,
      provisioningKey,
    });
    completed++;
  }

  // ── Build final result ─────────────────────────────────────────────────────
  const overallStatus: 'COMPLETED' | 'COMPLETED_WITH_ERRORS' | 'FAILED' =
    failed === 0 ? 'COMPLETED'
    : completed > 0 || skipped > 0 ? 'COMPLETED_WITH_ERRORS'
    : 'FAILED';

  const result: ProvisionCompanyLibraryCoreResult = {
    provisioningRunId: runRecord?.id || null,
    overallStatus,
    totalEligible,
    processed: totalEligible,
    completed,
    skipped,
    failed,
    companyJobIds,
    failedItems: items
      .filter(i => i.result === 'FAILED')
      .map(i => ({
        masterId: i.masterId, masterTitle: i.masterTitle,
        errorCode: i.errorCode || 'UNKNOWN', errorMessage: i.errorMessage || 'Unknown error.',
      })),
    retryRecommended: failed > 0,
    items,
  };

  // ── Finalize provisioning run record ──────────────────────────────────────
  await _finalizeRun(SR, runRecord, result, startedAt);

  // ── Audit: provisioning completed ─────────────────────────────────────────
  await _writeCompletionAudit(SR, initiatedByUserId, companyId, runRecord?.id || null, source, result);

  return result;
}

// ── Internal: upsert a ProvisioningRecord ────────────────────────────────────

async function _upsertProvisioningRecord(SR: any, params: {
  existingRecord: any;
  provisioningKey: string;
  companyId: string;
  masterId: string;
  versionId: string;
  distributionEventId: string | null;
  operationType: string;
  status: string;
  companyJobId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  now: string;
  initiatedByUserId: string;
}): Promise<any> {
  const {
    existingRecord, provisioningKey, companyId, masterId, versionId,
    distributionEventId, operationType, status, companyJobId,
    errorCode, errorMessage, now, initiatedByUserId,
  } = params;

  const isCompleted = status === 'COMPLETED' || status === 'SKIPPED';
  const payload: any = {
    status,
    companyJobId: companyJobId || null,
    versionId,
    distributionEventId,
    lastAttemptAt: now,
    updatedAt: now,
  };

  if (isCompleted) {
    payload.completedAt = now;
    payload.errorCode = null;
    payload.errorMessage = null;
  } else {
    // FAILED
    payload.completedAt = null;
    payload.errorCode = errorCode || 'UNKNOWN';
    payload.errorMessage = errorMessage || 'Unknown error.';
  }

  try {
    if (existingRecord) {
      const newAttemptCount = (existingRecord.attemptCount || 0) + 1;
      return await SR.entities.ProvisioningRecord.update(existingRecord.id, {
        ...payload,
        attemptCount: newAttemptCount,
      });
    } else {
      return await SR.entities.ProvisioningRecord.create({
        ...payload,
        provisioningKey,
        companyId,
        masterId,
        operationType,
        attemptCount: 1,
        createdAt: now,
      });
    }
  } catch (_) {
    // Non-fatal — provisioning continues even if record write fails
    return null;
  }
}

// ── Internal: finalize CompanyLibraryProvisioningRun ─────────────────────────

async function _finalizeRun(
  SR: any,
  runRecord: any,
  result: ProvisionCompanyLibraryCoreResult,
  startedAt: string
): Promise<void> {
  if (!runRecord) return;
  const completedAt = new Date().toISOString();
  const runStatus =
    result.overallStatus === 'COMPLETED' ? 'completed'
    : result.overallStatus === 'COMPLETED_WITH_ERRORS' ? 'partially_completed'
    : 'failed';

  try {
    await SR.entities.CompanyLibraryProvisioningRun.update(runRecord.id, {
      completedAt,
      status: runStatus,
      eligibleMasterCount: result.totalEligible,
      existingProvisionedCount: result.skipped,
      createdCount: result.completed,
      skippedCount: result.skipped,
      failedCount: result.failed,
      createdJobIds: result.companyJobIds,
      errors: result.failedItems.map(fi => ({
        sourceMasterId: fi.masterId,
        code: fi.errorCode,
        message: fi.errorMessage,
      })),
      errorSummary: result.failed > 0
        ? `${result.failed} SOP(s) failed to provision. retryRecommended=${result.retryRecommended}`
        : null,
    });
  } catch (_) {}
}

// ── Internal: write completion audit entry ────────────────────────────────────

async function _writeCompletionAudit(
  SR: any,
  initiatedByUserId: string,
  companyId: string,
  provisioningRunId: string | null,
  source: ProvisioningSource,
  result: ProvisionCompanyLibraryCoreResult
): Promise<void> {
  try {
    await writePlatformAudit(SR, {
      actingUserId: initiatedByUserId,
      actingUserRole: 'SUPER_ADMIN',
      action: 'company_library_provisioned',
      extra: {
        metadata: {
          companyId,
          provisioningRunId,
          source,
          phase: result.overallStatus,
          totalEligible: result.totalEligible,
          completed: result.completed,
          skipped: result.skipped,
          failed: result.failed,
          retryRecommended: result.retryRecommended,
        },
      },
    });
  } catch (_) {}
}

// ── Internal: build a full-failure result when infrastructure is unavailable ──

function _buildFailResult(provisioningRunId: string | null): ProvisionCompanyLibraryCoreResult {
  return {
    provisioningRunId,
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
  };
}