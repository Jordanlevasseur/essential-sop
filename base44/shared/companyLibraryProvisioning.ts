/**
 * companyLibraryProvisioning.ts — Canonical Company Library Provisioning Service
 *
 * THE SINGLE AUTHORITATIVE IMPLEMENTATION for provisioning Essential SOP Master
 * Jobs to a company. Every provisioning workflow — company creation, manual admin
 * provisioning, and NEW_SOP publication distribution — MUST call the canonical
 * per-company function provisionMasterToOneCompany().
 *
 * ── ENTRY POINTS ──────────────────────────────────────────────────────────────
 * 1. Automatic initial provisioning (createCompany):
 *    provisionCompanyLibraryCore() → provisionMasterToOneCompany()
 *    Source: COMPANY_CREATION.
 *
 * 2. Manual platform provisioning (provisionCompanyLibrary):
 *    provisionCompanyLibraryCore() → provisionMasterToOneCompany()
 *    Source: MANUAL_PLATFORM_ADMIN.
 *
 * 3. NEW_SOP publication distribution (publishingOrchestration):
 *    _distributeNewSOPToExistingCompanies() → provisionMasterToOneCompany()
 *    Source: FUTURE_DISTRIBUTION_EVENT.
 *
 * ── CANONICAL PER-COMPANY FUNCTION ────────────────────────────────────────────
 * provisionMasterToOneCompany() is the SINGLE implementation for:
 *   - Company Job existence check (duplicate prevention)
 *   - Deterministic provisioning key generation
 *   - ProvisioningRecord lookup, creation, and repair
 *   - Partial-state recovery
 *   - Company Job creation
 *   - Source Master and version linkage on the Job record
 *   - COMPLETED / SKIPPED / FAILED result
 *
 * The orchestration layer (provisionCompanyLibraryCore or
 * _distributeNewSOPToExistingCompanies) is responsible for:
 *   - Loading candidate companies
 *   - Evaluating policy eligibility via isCompanyEligibleForMaster()
 *   - Calling provisionMasterToOneCompany() per company
 *   - Catching per-company failures
 *   - Aggregating counts and updating DistributionEvent / ProvisioningRun
 *
 * ── DETERMINISTIC PROVISIONING KEY ────────────────────────────────────────────
 * provisioningKey = `ESOP_PROVISION:${companyId}:${masterId}`
 *
 * This key is:
 *   - Deterministic for any (companyId, masterId) pair regardless of trigger source
 *   - Used to look up the canonical ProvisioningRecord before any insert
 *   - Collision-proof: the same pair always maps to exactly one logical key
 *   - NOT a random UUID; NOT source-prefixed; NOT distributionEventId-prefixed
 *
 * Previous key scheme `INITIAL_COMPANY_LIBRARY:${companyId}:${masterId}` is
 * preserved by buildProvisioningKey() which is now an alias for backward compat.
 * The NEW_SOP distribution path previously used `dist_${eventId}_${companyId}_${masterId}`
 * — this scheme is retired; records created under the old key are not migrated
 * (they were test-only; no production records existed).
 *
 * ── OPERATION TYPE ────────────────────────────────────────────────────────────
 * All ProvisioningRecords use operationType = 'INITIAL_COMPANY_LIBRARY'.
 * The previous 'CREATE_NEW_COMPANY_JOB' and 'SKIP_ALREADY_PROVISIONED' types
 * used by the old _distributeNewSOPToExistingCompanies loop are retired.
 * No production records existed under 'CREATE_NEW_COMPANY_JOB'.
 *
 * ── ELIGIBILITY ───────────────────────────────────────────────────────────────
 * Policy eligibility is evaluated by isCompanyEligibleForMaster(), which is
 * COMPLETELY INDEPENDENT of trigger source. The source identifies why provisioning
 * was called; it never determines whether a company qualifies under the policy.
 *
 * Eligibility is ALWAYS evaluated by the orchestration layer before calling
 * provisionMasterToOneCompany(). The per-company function does not re-evaluate
 * policy; it defensively validates required state (version exists + published).
 *
 * A Master SOP is eligible for provisioning when ALL of:
 *   - Master.status === 'active'
 *   - Master.distributionStatus === 'customer_available'
 *   - Master.currentPublishedVersionId exists and is non-empty
 *   - The referenced EssentialSOPVersion exists and has status === 'published'
 *   - isCompanyEligibleForMaster() returns eligible === true:
 *
 *       ALL_EXISTING_AND_FUTURE_COMPANIES
 *         → always eligible regardless of company creation date or trigger source.
 *
 *       FUTURE_COMPANIES_ONLY
 *         → eligible only when company.created_date is AFTER the policy cutoff.
 *         → Cutoff authority (in order):
 *             1. Master.distributionPolicyUpdatedAt  (preferred)
 *             2. Master.created_date                 (fallback)
 *         → Skip reason: COMPANY_PREDATES_FUTURE_ONLY_CUTOFF
 *
 *       SELECTED_COMPANIES
 *         → eligible when companyId is in the authoritative selected-company list.
 *         → effectiveSelectedIds (from DistributionEvent) takes precedence when provided.
 *         → Skip reason: COMPANY_NOT_SELECTED
 *
 *       MANUAL
 *         → Never auto-provisioned.
 *         → Skip reason: POLICY_MANUAL
 *
 * ── COMPANY JOB INVARIANT ─────────────────────────────────────────────────────
 * ONE COMPANY + ONE MASTER SOP = NO MORE THAN ONE NON-DELETED COMPANY JOB.
 * Enforced exclusively inside provisionMasterToOneCompany().
 *
 * ── PROVISIONINGRECORD LIFECYCLE ──────────────────────────────────────────────
 * One logical ProvisioningRecord per (companyId, masterId) pair.
 * operationType: INITIAL_COMPANY_LIBRARY.
 * Key: `ESOP_PROVISION:${companyId}:${masterId}`.
 *
 * TWO INDEPENDENT STATUS FIELDS:
 *   assignmentStatus: ACTIVE | REMOVED | SUSPENDED
 *     → Whether the assignment is currently active. Sync reads ONLY ACTIVE records.
 *     → Set at creation (ACTIVE). Changed to REMOVED by unassignment. Never set by sync.
 *   provisioningStatus: COMPLETED | SKIPPED | FAILED | PENDING
 *     → Whether the Job was successfully provisioned. Does NOT imply active assignment.
 *
 * On success:  provisioningStatus=COMPLETED, assignmentStatus=ACTIVE, companyJobId=job.id.
 * On skip:     provisioningStatus=SKIPPED, assignmentStatus=ACTIVE, companyJobId=existing.
 * On failure:  provisioningStatus=FAILED, assignmentStatus=ACTIVE.
 * On retry with existing ACTIVE+COMPLETED record: idempotent skip.
 * On retry with existing ACTIVE+FAILED record: attempt again, update record.
 * Partial-state recovery: if Job exists but record missing or FAILED → repair.
 * Unassignment: sets assignmentStatus=REMOVED, writes unassignedAt+unassignedBy.
 *   Sync excludes REMOVED records. Historical data preserved.
 *
 * ── FAILURE ISOLATION ─────────────────────────────────────────────────────────
 * Individual Master/company failures are caught without aborting other iterations.
 * Company + initial CompanyMembership are NEVER deleted due to provisioning failures.
 *
 * ── CONCURRENCY RACE RISK ─────────────────────────────────────────────────────
 * Base44 has no database-level unique constraints. Deterministic key deduplication
 * reduces but cannot eliminate the concurrent-create race window. Documented.
 *
 * ── BASE44 LIMITATIONS ────────────────────────────────────────────────────────
 * - No multi-entity transactions: partial writes can occur on infrastructure failure.
 * - No unique index support: deterministic key deduplication is application-level only.
 * - Per-record writes required: bulkCreate is unavailable for provisioning steps
 *   that require individual error isolation.
 * - No server-side joins: all bulk lookups are separate filter calls.
 */

import { writePlatformAudit } from './platformAuth.ts';

// ── Canonical deterministic provisioning key ──────────────────────────────────
// One key per (companyId, masterId) pair. Source-independent.
export function buildProvisioningKey(companyId: string, masterId: string): string {
  return `ESOP_PROVISION:${companyId}:${masterId}`;
}

// ── Provisioning source — identifies WHY provisioning was called ───────────────
// Does NOT determine policy eligibility. Never used as a policy gate.
export type ProvisioningSource = 'COMPANY_CREATION' | 'MANUAL_PLATFORM_ADMIN' | 'FUTURE_DISTRIBUTION_EVENT';

// ── Skip reasons ──────────────────────────────────────────────────────────────
export type SkipReason =
  | 'ALREADY_PROVISIONED'
  | 'POLICY_MANUAL'
  | 'COMPANY_NOT_SELECTED'
  | 'COMPANY_PREDATES_FUTURE_ONLY_CUTOFF'
  | 'MASTER_NOT_CUSTOMER_AVAILABLE'
  | 'MASTER_NOT_ACTIVE'
  | 'NO_PUBLISHED_VERSION';

// ── Eligibility result ────────────────────────────────────────────────────────
export interface EligibilityResult {
  eligible: boolean;
  skipReason?: SkipReason;
}

/**
 * isCompanyEligibleForMaster — Pure policy eligibility function.
 * Source-independent: trigger source never affects the result.
 * Called by the orchestration layer before provisionMasterToOneCompany().
 */
export function isCompanyEligibleForMaster(params: {
  companyId: string;
  companyCreatedDate: string;
  masterPolicy: string;
  masterSelectedCompanyIds: string[];
  masterPolicyCutoffDate: string;
  effectiveSelectedIds?: string[] | null;
}): EligibilityResult {
  const {
    companyId, companyCreatedDate, masterPolicy,
    masterSelectedCompanyIds, masterPolicyCutoffDate,
    effectiveSelectedIds,
  } = params;

  switch (masterPolicy) {
    case 'ALL_EXISTING_AND_FUTURE_COMPANIES':
      return { eligible: true };

    case 'FUTURE_COMPANIES_ONLY': {
      const cutoff = new Date(masterPolicyCutoffDate).getTime();
      const companyCreated = new Date(companyCreatedDate).getTime();
      if (!isNaN(cutoff) && !isNaN(companyCreated) && companyCreated > cutoff) {
        return { eligible: true };
      }
      return { eligible: false, skipReason: 'COMPANY_PREDATES_FUTURE_ONLY_CUTOFF' };
    }

    case 'SELECTED_COMPANIES': {
      const list = (effectiveSelectedIds != null ? effectiveSelectedIds : masterSelectedCompanyIds) || [];
      if (list.includes(companyId)) {
        return { eligible: true };
      }
      return { eligible: false, skipReason: 'COMPANY_NOT_SELECTED' };
    }

    case 'MANUAL':
    default:
      return { eligible: false, skipReason: 'POLICY_MANUAL' };
  }
}

// ── ProvisioningItemResult — returned by provisionMasterToOneCompany ──────────
export interface ProvisioningItemResult {
  masterId: string;
  masterTitle: string;
  result: 'COMPLETED' | 'SKIPPED' | 'FAILED';
  skipReason?: SkipReason;
  companyJobId: string | null;
  versionId: string | null;
  provisioningRecordId: string | null;
  provisioningKey: string;
  errorCode?: string;
  errorMessage?: string;
}

// ── params for provisionMasterToOneCompany ────────────────────────────────────
export interface ProvisionMasterToOneCompanyParams {
  SR: any;
  company: any;                       // full Company record (needs .id and .created_date)
  master: any;                        // full EssentialSOPMaster record
  publishedVersion: any;              // full EssentialSOPVersion record (must have status='published')
  source: ProvisioningSource;
  distributionEventId: string | null; // linked DistributionEvent.id, or null
  assignedBy: string;                 // userId who triggered the assignment, or 'system'
  effectivePolicy?: string;           // distribution policy, used to set assignmentSource accurately
  // In-memory state passed by the caller to avoid per-company DB round-trips:
  existingJob: any | null;            // pre-loaded Job for (companyId, masterId), or null
  existingRecord: any | null;         // pre-loaded ProvisioningRecord for this key, or null
  now: string;
}

/**
 * provisionMasterToOneCompany — Canonical per-company provisioning function.
 *
 * The SINGLE implementation for:
 *   - Company Job existence check (duplicate prevention using caller-supplied existingJob)
 *   - Deterministic provisioning key generation via buildProvisioningKey()
 *   - ProvisioningRecord lookup / create / update via _upsertProvisioningRecord()
 *   - Partial-state recovery (job exists but record is missing or FAILED)
 *   - Company Job creation
 *   - Source Master and version linkage on the Job record
 *
 * Called by:
 *   - provisionCompanyLibraryCore() (COMPANY_CREATION, MANUAL_PLATFORM_ADMIN)
 *   - _distributeNewSOPToExistingCompanies() (FUTURE_DISTRIBUTION_EVENT)
 *
 * The orchestration layer is responsible for eligibility evaluation before
 * calling this function. This function does NOT re-evaluate policy; it performs
 * a defensive version-state check and then provisions.
 *
 * Returns a structured ProvisioningItemResult: COMPLETED, SKIPPED, or FAILED.
 */
// Map ProvisioningSource → assignmentSource field value
// effectivePolicy is passed from the caller to handle SELECTED_COMPANIES correctly.
export function sourceToAssignmentSource(source: ProvisioningSource, effectivePolicy?: string): string {
  switch (source) {
    case 'COMPANY_CREATION': return 'COMPANY_CREATION';
    case 'MANUAL_PLATFORM_ADMIN': return 'MANUAL';
    case 'FUTURE_DISTRIBUTION_EVENT':
      if (effectivePolicy === 'SELECTED_COMPANIES') return 'SELECTED_COMPANIES';
      return 'ALL_COMPANIES';
    default: return 'MANUAL';
  }
}

export async function provisionMasterToOneCompany(
  params: ProvisionMasterToOneCompanyParams
): Promise<ProvisioningItemResult> {
  const { SR, company, master, publishedVersion, source, distributionEventId, assignedBy, effectivePolicy, existingJob, existingRecord, now } = params;
  const companyId = company.id;
  const masterId = master.id;
  const versionId = publishedVersion?.id || null;
  const provisioningKey = buildProvisioningKey(companyId, masterId);

  const assignmentSource = sourceToAssignmentSource(source, effectivePolicy);

  // ── Defensive: validate version ──────────────────────────────────────────
  if (!publishedVersion || publishedVersion.status !== 'published') {
    const errorCode = !publishedVersion ? 'VERSION_NOT_FOUND' : 'VERSION_NOT_PUBLISHED';
    const errorMessage = !publishedVersion
      ? 'Referenced version record does not exist.'
      : 'Referenced version is not in published status.';

    await _upsertProvisioningRecord(SR, {
      existingRecord,
      provisioningKey, companyId, masterId, versionId,
      distributionEventId, operationType: 'INITIAL_COMPANY_LIBRARY',
      provisioningStatus: 'FAILED', assignmentSource, assignedBy,
      companyJobId: null, errorCode, errorMessage, now,
    });

    return {
      masterId, masterTitle: master.title,
      result: 'FAILED', companyJobId: null, versionId,
      provisioningRecordId: null, provisioningKey,
      errorCode, errorMessage,
    };
  }

  // ── Idempotency: existing ACTIVE+COMPLETED record with existing job ────────
  const isActiveRecord = !existingRecord || existingRecord.assignmentStatus === 'ACTIVE' || existingRecord.assignmentStatus == null;
  if (isActiveRecord && (existingRecord?.provisioningStatus === 'COMPLETED' || existingRecord?.status === 'COMPLETED') && existingRecord?.companyJobId) {
    if (existingJob) {
      return {
        masterId, masterTitle: master.title,
        result: 'SKIPPED', skipReason: 'ALREADY_PROVISIONED',
        companyJobId: existingJob.id,
        versionId: existingRecord.lastProvisionedVersionId || existingRecord.versionId || versionId,
        provisioningRecordId: existingRecord.id, provisioningKey,
      };
    }
    // Record says COMPLETED but job is missing — fall through to create
  }

  // ── Duplicate prevention: existing job ────────────────────────────────────
  if (existingJob) {
    // Partial-state recovery: job exists but record is missing or FAILED — repair
    const repairRecord = await _upsertProvisioningRecord(SR, {
      existingRecord,
      provisioningKey, companyId, masterId,
      versionId: existingJob.sourceVersionId || versionId,
      distributionEventId, operationType: 'INITIAL_COMPANY_LIBRARY',
      provisioningStatus: 'SKIPPED', assignmentSource, assignedBy,
      companyJobId: existingJob.id, errorCode: null, errorMessage: null, now,
    });

    return {
      masterId, masterTitle: master.title,
      result: 'SKIPPED', skipReason: 'ALREADY_PROVISIONED',
      companyJobId: existingJob.id,
      versionId: existingJob.sourceVersionId || versionId,
      provisioningRecordId: repairRecord?.id || existingRecord?.id || null,
      provisioningKey,
    };
  }

  // ── Create Company Job ─────────────────────────────────────────────────────
  let createdJob: any = null;
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
      sourceMasterId: masterId,
      sourceVersionId: publishedVersion.id,
      isCustomized: false,
      customizedAt: null,
      customizedBy: null,
    });
  } catch (_) {}

  if (!createdJob) {
    const failedRec = await _upsertProvisioningRecord(SR, {
      existingRecord,
      provisioningKey, companyId, masterId, versionId,
      distributionEventId, operationType: 'INITIAL_COMPANY_LIBRARY',
      provisioningStatus: 'FAILED', assignmentSource, assignedBy,
      companyJobId: null,
      errorCode: 'JOB_CREATE_FAILED',
      errorMessage: 'Failed to create company job record.',
      now,
    });

    return {
      masterId, masterTitle: master.title,
      result: 'FAILED', companyJobId: null, versionId,
      provisioningRecordId: failedRec?.id || null, provisioningKey,
      errorCode: 'JOB_CREATE_FAILED',
      errorMessage: 'Failed to create company job record.',
    };
  }

  // ── Write COMPLETED ProvisioningRecord ────────────────────────────────────
  const completedRec = await _upsertProvisioningRecord(SR, {
    existingRecord,
    provisioningKey, companyId, masterId, versionId: publishedVersion.id,
    distributionEventId, operationType: 'INITIAL_COMPANY_LIBRARY',
    provisioningStatus: 'COMPLETED', assignmentSource, assignedBy,
    companyJobId: createdJob.id, errorCode: null, errorMessage: null, now,
  });

  return {
    masterId, masterTitle: master.title,
    result: 'COMPLETED', companyJobId: createdJob.id,
    versionId: publishedVersion.id,
    provisioningRecordId: completedRec?.id || null,
    provisioningKey,
  };
}

// ── Core params ───────────────────────────────────────────────────────────────
export interface ProvisionCompanyLibraryCoreParams {
  companyId: string;
  initiatedByUserId: string;
  source: ProvisioningSource;
  SR: any;
}

// ── Core result ───────────────────────────────────────────────────────────────
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

// ── Main canonical orchestration service ──────────────────────────────────────
// Loads all eligible masters for one company, calls provisionMasterToOneCompany()
// per master, aggregates results, and writes run records + audit entries.

export async function provisionCompanyLibraryCore(
  params: ProvisionCompanyLibraryCoreParams
): Promise<ProvisionCompanyLibraryCoreResult> {
  const { companyId, initiatedByUserId, source, SR } = params;
  const startedAt = new Date().toISOString();

  // ── Load company record ───────────────────────────────────────────────────
  let company: any = null;
  try { company = await SR.entities.Company.get(companyId); } catch (_) {}
  if (!company) {
    return _buildFailResult(null);
  }
  const companyCreatedDate: string = company.created_date || startedAt;

  // ── Create CompanyLibraryProvisioningRun ──────────────────────────────────
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
  } catch (_) {}

  try {
    await writePlatformAudit(SR, {
      actingUserId: initiatedByUserId,
      actingUserRole: 'SUPER_ADMIN',
      action: 'company_library_provisioned',
      extra: {
        metadata: { companyId, provisioningRunId: runRecord?.id || null, source, phase: 'started' },
      },
    });
  } catch (_) {}

  // ── Step 1: Load eligible Masters ─────────────────────────────────────────
  let allMasters: any[] = [];
  try {
    allMasters = await SR.entities.EssentialSOPMaster.filter(
      { status: 'active', distributionStatus: 'customer_available' },
      '-updatedAt',
      500
    ) || [];
  } catch (_) {
    const failResult = _buildFailResult(runRecord?.id || null);
    await _finalizeRun(SR, runRecord, failResult, startedAt);
    await _writeCompletionAudit(SR, initiatedByUserId, companyId, runRecord?.id || null, source, failResult);
    return failResult;
  }

  // ── Step 2: Apply policy eligibility ─────────────────────────────────────
  const eligibleMasters: any[] = [];
  const preSkippedItems: ProvisioningItemResult[] = [];

  for (const m of allMasters) {
    if (!m.currentPublishedVersionId || !m.currentPublishedVersionId.trim()) {
      preSkippedItems.push({
        masterId: m.id, masterTitle: m.title,
        result: 'SKIPPED', skipReason: 'NO_PUBLISHED_VERSION',
        companyJobId: null, versionId: null,
        provisioningRecordId: null,
        provisioningKey: buildProvisioningKey(companyId, m.id),
      });
      continue;
    }

    const policy = m.defaultDistributionPolicy || 'MANUAL';
    const masterPolicyCutoffDate = m.distributionPolicyUpdatedAt || m.created_date || startedAt;

    const eligibility = isCompanyEligibleForMaster({
      companyId,
      companyCreatedDate,
      masterPolicy: policy,
      masterSelectedCompanyIds: Array.isArray(m.defaultSelectedCompanyIds) ? m.defaultSelectedCompanyIds : [],
      masterPolicyCutoffDate,
      effectiveSelectedIds: null,
    });

    if (eligibility.eligible) {
      eligibleMasters.push(m);
    } else {
      preSkippedItems.push({
        masterId: m.id, masterTitle: m.title,
        result: 'SKIPPED', skipReason: eligibility.skipReason,
        companyJobId: null, versionId: m.currentPublishedVersionId || null,
        provisioningRecordId: null,
        provisioningKey: buildProvisioningKey(companyId, m.id),
      });
    }
  }

  const totalEligible = eligibleMasters.length;

  // ── Step 3: Bulk-load published versions ──────────────────────────────────
  const versionIdSet = new Set<string>(
    eligibleMasters.map((m: any) => m.currentPublishedVersionId).filter(Boolean)
  );
  const versionMap = new Map<string, any>();
  const versionFetches = await Promise.allSettled(
    [...versionIdSet].map(async (vid: string) => {
      try { const v = await SR.entities.EssentialSOPVersion.get(vid); return { vid, v }; } catch (_) { return { vid, v: null }; }
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

  const existingJobByMasterId = new Map<string, any>();
  for (const j of existingJobs) {
    if (j.sourceMasterId) existingJobByMasterId.set(j.sourceMasterId, j);
  }

  // ── Step 5: Load existing ProvisioningRecords ONCE ────────────────────────
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

  // ── Step 6: Bulk-load DistributionEvent links ─────────────────────────────
  const distEventMap = new Map<string, string>();
  try {
    const distEvents = await SR.entities.DistributionEvent.filter({}, '-createdAt', 500) || [];
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
  } catch (_) {}

  // ── Step 7: Per-master provisioning loop — calls canonical function ────────
  const now = new Date().toISOString();
  const items: ProvisioningItemResult[] = [];
  const companyJobIds: string[] = [];
  let skipped = 0;
  let completed = 0;
  let failed = 0;

  for (const master of eligibleMasters) {
    const provisioningKey = buildProvisioningKey(companyId, master.id);
    const distributionEventId = distEventMap.get(master.id) || null;
    const versionId = master.currentPublishedVersionId;
    const publishedVersion = versionMap.get(versionId) || null;
    const existingJob = existingJobByMasterId.get(master.id) || null;
    const existingRecord = existingRecordByKey.get(provisioningKey) || null;

    try {
      // ── Call canonical per-company provisioning function ─────────────────
      const itemResult = await provisionMasterToOneCompany({
        SR,
        company,
        master,
        publishedVersion,
        source,
        distributionEventId,
        assignedBy: initiatedByUserId || 'system',
        existingJob,
        existingRecord,
        now,
      });

      items.push(itemResult);

      if (itemResult.result === 'COMPLETED') {
        companyJobIds.push(itemResult.companyJobId!);
        // Track in-memory for intra-loop duplicate prevention
        if (itemResult.companyJobId) {
          existingJobByMasterId.set(master.id, { id: itemResult.companyJobId, sourceMasterId: master.id });
        }
        completed++;
      } else if (itemResult.result === 'SKIPPED') {
        if (itemResult.companyJobId) companyJobIds.push(itemResult.companyJobId);
        skipped++;
      } else {
        failed++;
      }
    } catch (outerErr: any) {
      items.push({
        masterId: master.id, masterTitle: master.title,
        result: 'FAILED', companyJobId: null, versionId,
        provisioningRecordId: null, provisioningKey,
        errorCode: 'UNEXPECTED_ERROR',
        errorMessage: outerErr?.message || 'Unexpected error.',
      });
      failed++;
    }
  }

  // ── Build final result ─────────────────────────────────────────────────────
  const overallStatus: 'COMPLETED' | 'COMPLETED_WITH_ERRORS' | 'FAILED' =
    failed === 0 ? 'COMPLETED'
    : completed > 0 || skipped > 0 ? 'COMPLETED_WITH_ERRORS'
    : 'FAILED';

  const allItems: ProvisioningItemResult[] = [...preSkippedItems, ...items];

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
    items: allItems,
  };

  await _finalizeRun(SR, runRecord, result, startedAt);
  await _writeCompletionAudit(SR, initiatedByUserId, companyId, runRecord?.id || null, source, result);

  return result;
}

// ── Internal: upsert a ProvisioningRecord ────────────────────────────────────
// Single implementation — called exclusively by provisionMasterToOneCompany().
// Writes both the assignment fields (assignmentStatus, assignedAt, assignmentSource)
// and the provisioning-attempt fields (provisioningStatus, lastProvisionedVersionId, etc.)
// separately so they can evolve independently.

async function _upsertProvisioningRecord(SR: any, params: {
  existingRecord: any;
  provisioningKey: string;
  companyId: string;
  masterId: string;
  versionId: string | null;
  distributionEventId: string | null;
  operationType: string;
  provisioningStatus: string;
  assignmentSource: string;
  assignedBy: string;
  companyJobId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  now: string;
}): Promise<any> {
  const {
    existingRecord, provisioningKey, companyId, masterId, versionId,
    distributionEventId, operationType, provisioningStatus, assignmentSource,
    assignedBy, companyJobId, errorCode, errorMessage, now,
  } = params;

  const isSuccessful = provisioningStatus === 'COMPLETED' || provisioningStatus === 'SKIPPED';

  // Provisioning-attempt fields (always updated)
  const payload: any = {
    provisioningStatus,
    // Legacy field kept for backward-compat reads; mirrors provisioningStatus
    status: provisioningStatus,
    companyJobId: companyJobId || null,
    lastProvisionedVersionId: isSuccessful ? (versionId || null) : (existingRecord?.lastProvisionedVersionId || null),
    lastProvisionedAt: isSuccessful ? now : (existingRecord?.lastProvisionedAt || null),
    lastAttemptAt: now,
    updatedAt: now,
  };

  if (isSuccessful) {
    payload.completedAt = now;
    payload.errorCode = null;
    payload.errorMessage = null;
  } else {
    payload.errorCode = errorCode || 'UNKNOWN';
    payload.errorMessage = errorMessage || 'Unknown error.';
  }

  try {
    if (existingRecord) {
      // Never overwrite assignment lifecycle fields on an existing record
      // (assignmentStatus, assignedAt, assignedBy, assignmentSource are set at creation only).
      return await SR.entities.ProvisioningRecord.update(existingRecord.id, {
        ...payload,
        attemptCount: (existingRecord.attemptCount || 0) + 1,
      });
    } else {
      // New record — set assignment lifecycle fields
      return await SR.entities.ProvisioningRecord.create({
        ...payload,
        provisioningKey,
        companyId,
        masterId,
        operationType,
        distributionEventId: distributionEventId || null,
        // Assignment lifecycle fields — set once at creation
        assignmentStatus: 'ACTIVE',
        assignedAt: now,
        assignedBy,
        assignmentSource,
        // Removal fields — null until unassigned
        unassignedAt: null,
        unassignedBy: null,
        unassignmentReason: null,
        attemptCount: 1,
        createdAt: now,
      });
    }
  } catch (_) {
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

// ── Public: unassign a company from a Master SOP ─────────────────────────────
//
// Sets assignmentStatus=REMOVED on the canonical ProvisioningRecord.
// The Company Job is preserved — product policy is to never delete company data.
// Sync will exclude REMOVED records going forward — no new Jobs provisioned,
// no new version decisions created, no updates pushed.
//
// Called by: manageMasterSOP (action='unassign_company') — SUPER_ADMIN only.

export async function unassignCompanyFromMaster(SR: any, params: {
  companyId: string;
  masterId: string;
  unassignedBy: string;
  reason?: string;
}): Promise<{ success: boolean; error?: string; record?: any }> {
  const { companyId, masterId, unassignedBy, reason } = params;
  const provisioningKey = buildProvisioningKey(companyId, masterId);

  // Find the canonical record
  let records: any[] = [];
  try {
    records = await SR.entities.ProvisioningRecord.filter({ provisioningKey }, '-createdAt', 1) || [];
  } catch (_) {}

  const record = records[0] || null;

  if (!record) {
    return { success: false, error: 'No assignment record found for this company-master pair.' };
  }

  if (record.assignmentStatus === 'REMOVED') {
    // Already removed — idempotent
    return { success: true, record };
  }

  const now = new Date().toISOString();
  try {
    const updated = await SR.entities.ProvisioningRecord.update(record.id, {
      assignmentStatus: 'REMOVED',
      unassignedAt: now,
      unassignedBy,
      unassignmentReason: reason || null,
      updatedAt: now,
    });
    return { success: true, record: updated };
  } catch (e: any) {
    return { success: false, error: e?.message || 'Failed to update assignment record.' };
  }
}

// ── Public: reactivate a previously removed assignment ───────────────────────
//
// Re-activates a REMOVED assignment (e.g. company was re-added to a distribution).
// Does NOT provision a new Job — caller must trigger a sync or distribution event for that.

export async function reactivateCompanyAssignment(SR: any, params: {
  companyId: string;
  masterId: string;
  reactivatedBy: string;
}): Promise<{ success: boolean; error?: string; record?: any }> {
  const { companyId, masterId, reactivatedBy } = params;
  const provisioningKey = buildProvisioningKey(companyId, masterId);

  let records: any[] = [];
  try {
    records = await SR.entities.ProvisioningRecord.filter({ provisioningKey }, '-createdAt', 1) || [];
  } catch (_) {}

  const record = records[0] || null;
  if (!record) {
    return { success: false, error: 'No assignment record found.' };
  }
  if (record.assignmentStatus === 'ACTIVE') {
    return { success: true, record }; // Already active
  }

  const now = new Date().toISOString();
  try {
    const updated = await SR.entities.ProvisioningRecord.update(record.id, {
      assignmentStatus: 'ACTIVE',
      unassignedAt: null,
      unassignedBy: null,
      unassignmentReason: null,
      // Re-record who reactivated (use assignedBy field; preserve original assignedAt)
      assignedBy: reactivatedBy,
      updatedAt: now,
    });
    return { success: true, record: updated };
  } catch (e: any) {
    return { success: false, error: e?.message || 'Failed to reactivate assignment.' };
  }
}

// ── Internal: build a full-failure result ─────────────────────────────────────

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