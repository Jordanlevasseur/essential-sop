/**
 * versionDecisionService.ts — Canonical Version Decision Service
 *
 * THE SINGLE AUTHORITATIVE IMPLEMENTATION for creating CompanyVersionDecision
 * records when a new Master SOP version is published (NEW_VERSION event).
 *
 * ── ENTRY POINT ────────────────────────────────────────────────────────────────
 * createVersionDecisionForCompanyJob() is the ONLY code path that may create
 * CompanyVersionDecision records. It is called exclusively by the NEW_VERSION
 * distribution orchestration in publishingOrchestration.ts.
 *
 * ── DETERMINISTIC DECISION KEY ─────────────────────────────────────────────────
 * decisionKey = `VERSION_DECISION:{companyJobId}:{toVersionId}`
 *
 * One key per (companyJobId, toVersionId) pair. Source-independent.
 * Built exclusively by buildDecisionKey() defined here.
 * The same companyJob+toVersion always produces exactly one logical decision.
 *
 * ── RESULT TYPES ───────────────────────────────────────────────────────────────
 * CREATED            — New PENDING decision created.
 * ALREADY_EXISTS     — A decision with the same decisionKey already exists.
 * SUPERSEDED_EXISTING — Older PENDING/DEFERRED decisions were superseded; new PENDING created.
 * SKIPPED_ALREADY_CURRENT — Company Job already uses the target version; no decision needed.
 * FAILED             — An error prevented decision creation; see errorCode/errorMessage.
 *
 * ── SUPERSEDING RULE ───────────────────────────────────────────────────────────
 * When a newer version is published, any existing PENDING or DEFERRED decisions
 * for the same (companyJobId, masterId) that target an OLDER version are superseded.
 * ACCEPTED, DECLINED, SUPERSEDED, and FAILED decisions are never touched.
 *
 * ── WHAT THIS SERVICE MUST NOT DO ─────────────────────────────────────────────
 * - Change Job.sourceVersionId
 * - Modify Job content
 * - Modify JobOverride records
 * - Perform merge analysis
 * - Create notifications
 * - Change technician-facing content
 *
 * ── BASE44 LIMITATIONS ────────────────────────────────────────────────────────
 * No database-level unique constraints — deterministic key deduplication is
 * application-level only. Documented race window on concurrent creation.
 */

import { writePlatformAudit } from './platformAuth.ts';

// ── Canonical deterministic decision key ───────────────────────────────────────
// One key per (companyJobId, toVersionId) pair. Single implementation.
export function buildDecisionKey(companyJobId: string, toVersionId: string): string {
  return `VERSION_DECISION:${companyJobId}:${toVersionId}`;
}

// ── Statuses treated as unresolved (eligible for superseding) ──────────────────
const UNRESOLVED_STATUSES = ['PENDING', 'DEFERRED'] as const;

// ── Result type ───────────────────────────────────────────────────────────────
export type VersionDecisionResult =
  | 'CREATED'
  | 'ALREADY_EXISTS'
  | 'SUPERSEDED_EXISTING'
  | 'SKIPPED_ALREADY_CURRENT'
  | 'FAILED';

export interface VersionDecisionItemResult {
  result: VersionDecisionResult;
  companyId: string;
  companyJobId: string;
  masterId: string;
  fromVersionId: string | null;
  toVersionId: string;
  decisionId: string | null;
  decisionKey: string;
  supersededDecisionId: string | null;
  supersededCount: number;
  errorCode?: string;
  errorMessage?: string;
}

// ── Params for createVersionDecisionForCompanyJob ──────────────────────────────
export interface CreateVersionDecisionParams {
  SR: any;
  companyJob: any;           // full Job record — must have sourceType='essential_sop', sourceMasterId, sourceVersionId
  targetVersion: any;        // full EssentialSOPVersion record (status='published')
  distributionEvent: any;    // full DistributionEvent record
  actingUserId: string;      // platform admin userId whose publication triggered this
  now: string;
  // In-memory pre-loaded state to avoid per-job DB round-trips:
  existingDecisionsByKey: Map<string, any>;   // decisionKey → CompanyVersionDecision record (pre-loaded)
  existingDecisionsByJobMaster: any[];        // all existing decisions for (companyJobId, masterId) (pre-loaded)
}

/**
 * createVersionDecisionForCompanyJob — Canonical per-Company-Job decision function.
 *
 * Responsibilities:
 *  1. Validate Company Job is linked to the expected Master SOP.
 *  2. Validate target version belongs to the same Master SOP.
 *  3. Detect if Company Job is already on the target version → SKIPPED_ALREADY_CURRENT.
 *  4. Build the deterministic decision key.
 *  5. Detect existing decision with same key → ALREADY_EXISTS.
 *  6. Supersede older PENDING/DEFERRED decisions targeting older versions.
 *  7. Create a new PENDING decision.
 *  8. Write audit entries.
 *  9. Return structured VersionDecisionItemResult.
 *
 * Must NOT:
 *  - Change Job.sourceVersionId
 *  - Modify JobOverride records
 *  - Perform merge analysis
 *  - Create notifications
 */
export async function createVersionDecisionForCompanyJob(
  params: CreateVersionDecisionParams
): Promise<VersionDecisionItemResult> {
  const {
    SR, companyJob, targetVersion, distributionEvent,
    actingUserId, now,
    existingDecisionsByKey, existingDecisionsByJobMaster,
  } = params;

  const companyJobId = companyJob.id;
  const companyId = companyJob.companyId;
  const masterId = companyJob.sourceMasterId;
  const fromVersionId = companyJob.sourceVersionId || null;
  const toVersionId = targetVersion.id;
  const distributionEventId = distributionEvent.id;
  const decisionKey = buildDecisionKey(companyJobId, toVersionId);

  // ── 1. Validate Company Job is linked to the expected Master SOP ──────────
  if (!masterId || masterId !== targetVersion.masterId) {
    const errorCode = 'JOB_MASTER_MISMATCH';
    const errorMessage = `Company Job sourceMasterId (${masterId}) does not match target version masterId (${targetVersion.masterId}).`;
    await _writeDecisionAudit(SR, actingUserId, 'version_decision_creation_failed', {
      companyId, companyJobId, masterId, fromVersionId, toVersionId,
      distributionEventId, decisionKey,
      metadata: { errorCode, errorMessage },
    });
    return _failResult({ companyId, companyJobId, masterId, fromVersionId, toVersionId, decisionKey, errorCode, errorMessage });
  }

  // ── 2. Validate target version belongs to the same Master SOP ────────────
  if (!targetVersion || targetVersion.status !== 'published') {
    const errorCode = !targetVersion ? 'TARGET_VERSION_NOT_FOUND' : 'TARGET_VERSION_NOT_PUBLISHED';
    const errorMessage = !targetVersion ? 'Target version record does not exist.' : 'Target version is not published.';
    await _writeDecisionAudit(SR, actingUserId, 'version_decision_creation_failed', {
      companyId, companyJobId, masterId, fromVersionId, toVersionId,
      distributionEventId, decisionKey,
      metadata: { errorCode, errorMessage },
    });
    return _failResult({ companyId, companyJobId, masterId, fromVersionId, toVersionId, decisionKey, errorCode, errorMessage });
  }

  // ── 3. Detect if Company Job already uses the target version ──────────────
  if (fromVersionId === toVersionId) {
    return {
      result: 'SKIPPED_ALREADY_CURRENT',
      companyId, companyJobId, masterId,
      fromVersionId, toVersionId,
      decisionId: null, decisionKey,
      supersededDecisionId: null, supersededCount: 0,
    };
  }

  // ── 4 & 5. Check for existing decision with same key (ALREADY_EXISTS) ─────
  const existingDecision = existingDecisionsByKey.get(decisionKey) || null;
  if (existingDecision) {
    await _writeDecisionAudit(SR, actingUserId, 'version_decision_already_exists', {
      companyId, companyJobId, masterId, fromVersionId, toVersionId,
      distributionEventId, decisionKey,
      metadata: { existingDecisionId: existingDecision.id, existingStatus: existingDecision.status },
    });
    return {
      result: 'ALREADY_EXISTS',
      companyId, companyJobId, masterId,
      fromVersionId, toVersionId,
      decisionId: existingDecision.id, decisionKey,
      supersededDecisionId: null, supersededCount: 0,
    };
  }

  // ── 6. Supersede older PENDING/DEFERRED decisions for this job+master ─────
  // Find decisions for (companyJobId, masterId) that target OLDER versions
  // and are still in PENDING or DEFERRED status.
  const supersedable = existingDecisionsByJobMaster.filter((d: any) =>
    UNRESOLVED_STATUSES.includes(d.status) &&
    d.toVersionId !== toVersionId // not the same target (already handled above)
  );

  let supersededDecisionId: string | null = null;
  let supersededCount = 0;

  for (const older of supersedable) {
    try {
      // We'll use the ID of the newly created decision once it exists.
      // For now, mark as SUPERSEDED and store the new decisionKey for cross-reference.
      // Back-link (supersededByDecisionId) will be filled after new decision is created.
      await SR.entities.CompanyVersionDecision.update(older.id, {
        status: 'SUPERSEDED',
        updatedAt: now,
      });
      supersededDecisionId = older.id; // track last superseded (typically only one)
      supersededCount++;
    } catch (_) {
      // Non-fatal: superseding failure does not prevent new decision creation.
    }
  }

  // ── 7. Create new PENDING decision ────────────────────────────────────────
  let newDecision: any = null;
  try {
    newDecision = await SR.entities.CompanyVersionDecision.create({
      companyId,
      companyJobId,
      masterId,
      fromVersionId,
      toVersionId,
      distributionEventId,
      decisionKey,
      status: 'PENDING',
      supersededByDecisionId: null,
      decidedAt: null,
      decidedByUserId: null,
      decisionNote: null,
      errorCode: null,
      errorMessage: null,
      createdAt: now,
      createdBy: actingUserId,
      updatedAt: now,
    });
  } catch (err: any) {
    const errorCode = 'DECISION_CREATE_FAILED';
    const errorMessage = err?.message || 'Failed to create CompanyVersionDecision record.';
    await _writeDecisionAudit(SR, actingUserId, 'version_decision_creation_failed', {
      companyId, companyJobId, masterId, fromVersionId, toVersionId,
      distributionEventId, decisionKey,
      metadata: { errorCode, errorMessage },
    });
    return _failResult({ companyId, companyJobId, masterId, fromVersionId, toVersionId, decisionKey, errorCode, errorMessage });
  }

  // ── Back-link superseded decisions to the newly created decision ──────────
  if (newDecision && supersedable.length > 0) {
    for (const older of supersedable) {
      try {
        await SR.entities.CompanyVersionDecision.update(older.id, {
          supersededByDecisionId: newDecision.id,
          updatedAt: now,
        });
      } catch (_) {
        // Non-fatal: back-link is informational; the SUPERSEDED status already applied.
      }
    }
  }

  // ── 8. Write audit entries ─────────────────────────────────────────────────
  const wasSuperseding = supersededCount > 0;
  const auditAction = wasSuperseding ? 'version_decision_superseded' : 'version_decision_created';

  await _writeDecisionAudit(SR, actingUserId, auditAction, {
    companyId, companyJobId, masterId, fromVersionId, toVersionId,
    distributionEventId, decisionKey,
    metadata: {
      newDecisionId: newDecision.id,
      supersededCount,
      supersededDecisionIds: supersedable.map((d: any) => d.id),
    },
  });

  return {
    result: wasSuperseding ? 'SUPERSEDED_EXISTING' : 'CREATED',
    companyId, companyJobId, masterId,
    fromVersionId, toVersionId,
    decisionId: newDecision.id, decisionKey,
    supersededDecisionId: supersededCount > 0 ? supersedable[0].id : null,
    supersededCount,
  };
}

// ── Internal: write a decision-level audit entry ──────────────────────────────

async function _writeDecisionAudit(
  SR: any,
  actingUserId: string,
  action: string,
  extra: Record<string, any>
): Promise<void> {
  try {
    await writePlatformAudit(SR, {
      actingUserId,
      actingUserRole: 'SUPER_ADMIN',
      action,
      extra,
    });
  } catch (_) {
    // Audit failure must not crash decision creation.
  }
}

// ── Internal: build a FAILED result ───────────────────────────────────────────

function _failResult(params: {
  companyId: string;
  companyJobId: string;
  masterId: string;
  fromVersionId: string | null;
  toVersionId: string;
  decisionKey: string;
  errorCode: string;
  errorMessage: string;
}): VersionDecisionItemResult {
  return {
    result: 'FAILED',
    companyId: params.companyId,
    companyJobId: params.companyJobId,
    masterId: params.masterId,
    fromVersionId: params.fromVersionId,
    toVersionId: params.toVersionId,
    decisionId: null,
    decisionKey: params.decisionKey,
    supersededDecisionId: null,
    supersededCount: 0,
    errorCode: params.errorCode,
    errorMessage: params.errorMessage,
  };
}