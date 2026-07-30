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
 * CREATED              — New PENDING decision created; no prior unresolved decision existed.
 * ALREADY_EXISTS       — A decision with the same decisionKey already exists; no writes performed.
 * SUPERSEDED_EXISTING  — New PENDING created; older PENDING/DEFERRED decisions superseded and linked.
 * SKIPPED_ALREADY_CURRENT — Company Job already uses the target version; no decision needed.
 * FAILED               — An error prevented a complete and consistent operation; see errorCode/errorMessage.
 *
 * ── SUPERSEDING RULE ───────────────────────────────────────────────────────────
 * When a newer version is published, any existing PENDING or DEFERRED decisions
 * for the same (companyJobId, masterId) that target an OLDER version are superseded.
 * ACCEPTED, DECLINED, SUPERSEDED, and FAILED decisions are never touched.
 *
 * ── ATOMICITY AND CONSISTENCY ──────────────────────────────────────────────────
 * Base44 has no multi-entity transactions. The following safe application-level
 * sequence is used to satisfy the required invariant:
 *
 *   INVARIANT (after a successful operation):
 *     1. Exactly one newest PENDING decision exists for the (companyJobId, masterId) pair.
 *     2. Every older PENDING/DEFERRED decision is SUPERSEDED.
 *     3. Each superseded decision has supersededByDecisionId pointing to the new decision.
 *
 * SAFE WRITE SEQUENCE:
 *   Step 1. Reconcile: detect existing decision by deterministic decisionKey.
 *           If found → ALREADY_EXISTS (no writes).
 *   Step 2. Create the new PENDING decision first (before touching any older decision).
 *           If creation fails → FAILED; older decisions are untouched (invariant preserved).
 *   Step 3. Supersede all older PENDING/DEFERRED decisions, writing both status=SUPERSEDED
 *           and supersededByDecisionId=newDecision.id in a single update per record.
 *           If any superseding write fails:
 *             a. Attempt to mark the newly created decision as FAILED (makes it non-actionable).
 *             b. Return FAILED with SUPERSEDE_INCOMPLETE errorCode and recovery information.
 *             c. The older decision remains PENDING/DEFERRED and usable.
 *   Step 4. Verify: re-query unresolved decisions for this (companyJobId, masterId) pair.
 *           If more than one unresolved decision exists → attempt compensation, return FAILED.
 *   Step 5. Write audit entry and return CREATED or SUPERSEDED_EXISTING.
 *
 * FAILURE STATES:
 *   - If Step 2 (create) fails: no writes made. Older decision intact. → FAILED.
 *   - If Step 3 (supersede) partially fails: new decision is marked FAILED.
 *     Older decision recovers as the sole active unresolved decision. → FAILED.
 *   - If Step 4 (verify) finds multiple unresolved: new decision is marked FAILED,
 *     compensation attempted. → FAILED.
 *
 * RECOVERY:
 *   A FAILED new decision record may be left in the database as an audit artifact.
 *   Its status=FAILED makes it non-actionable. On retry, the decisionKey lookup
 *   (Step 1) will NOT find it (a FAILED record is not the same logical decision).
 *   A fresh attempt will re-run the full sequence, creating a new record.
 *   The older PENDING/DEFERRED decision is always preserved on failure so the
 *   company retains a usable decision path.
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
 * No rollback: compensation is best-effort; FAILED status on the new record
 * is the authoritative signal to downstream consumers.
 */

import { writePlatformAudit } from './platformAuth.ts';

// ── Canonical deterministic decision key ───────────────────────────────────────
// One key per (companyJobId, toVersionId) pair. Single implementation.
export function buildDecisionKey(companyJobId: string, toVersionId: string): string {
  return `VERSION_DECISION:${companyJobId}:${toVersionId}`;
}

// ── Statuses treated as unresolved (eligible for superseding) ──────────────────
const UNRESOLVED_STATUSES: ReadonlyArray<string> = ['PENDING', 'DEFERRED'];

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
 * Safe write sequence (see module header for full rationale):
 *  Step 1. Validate inputs and detect SKIPPED_ALREADY_CURRENT / ALREADY_EXISTS.
 *  Step 2. Create the new PENDING decision first.
 *  Step 3. Supersede older unresolved decisions (status + back-link in one write).
 *          On superseding failure: mark new decision FAILED, return FAILED.
 *  Step 4. Verify exactly one unresolved decision remains.
 *          On verify failure: mark new decision FAILED, return FAILED.
 *  Step 5. Audit and return CREATED or SUPERSEDED_EXISTING.
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

  // ── Step 1a: Validate Company Job is linked to the correct Master SOP ──────
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

  // ── Step 1b: Validate target version is published ─────────────────────────
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

  // ── Step 1c: Detect SKIPPED_ALREADY_CURRENT ───────────────────────────────
  if (fromVersionId === toVersionId) {
    return {
      result: 'SKIPPED_ALREADY_CURRENT',
      companyId, companyJobId, masterId,
      fromVersionId, toVersionId,
      decisionId: null, decisionKey,
      supersededDecisionId: null, supersededCount: 0,
    };
  }

  // ── Step 1d: Detect ALREADY_EXISTS by deterministic decisionKey ───────────
  // A FAILED record does NOT count as an existing decision — it is non-actionable
  // and a retry must be able to create a fresh record.
  const existingDecision = existingDecisionsByKey.get(decisionKey) || null;
  if (existingDecision && existingDecision.status !== 'FAILED') {
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

  // ── Identify older unresolved decisions for this (companyJobId, masterId) ──
  // These are PENDING or DEFERRED decisions targeting a DIFFERENT (older) version.
  // They must all be superseded after the new decision is successfully created.
  const supersedable = existingDecisionsByJobMaster.filter((d: any) =>
    UNRESOLVED_STATUSES.includes(d.status) &&
    d.toVersionId !== toVersionId
  );

  // ── Step 2: Create the new PENDING decision FIRST ─────────────────────────
  // No older decisions are touched until this write succeeds.
  // If this fails, the function returns FAILED with older decisions untouched.
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
    // Creation failed — older decisions untouched, invariant preserved.
    const errorCode = 'DECISION_CREATE_FAILED';
    const errorMessage = err?.message || 'Failed to create CompanyVersionDecision record.';
    await _writeDecisionAudit(SR, actingUserId, 'version_decision_creation_failed', {
      companyId, companyJobId, masterId, fromVersionId, toVersionId,
      distributionEventId, decisionKey,
      metadata: { errorCode, errorMessage, step: 'create' },
    });
    return _failResult({ companyId, companyJobId, masterId, fromVersionId, toVersionId, decisionKey, errorCode, errorMessage });
  }

  // ── Step 3: Supersede older unresolved decisions ───────────────────────────
  // Write both status=SUPERSEDED and supersededByDecisionId in a single update.
  // If any superseding write fails: mark the new decision FAILED (non-actionable),
  // and return FAILED — the older decision remains usable.
  let supersededCount = 0;
  const supersededIds: string[] = [];

  for (const older of supersedable) {
    try {
      await SR.entities.CompanyVersionDecision.update(older.id, {
        status: 'SUPERSEDED',
        supersededByDecisionId: newDecision.id,
        updatedAt: now,
      });
      supersededCount++;
      supersededIds.push(older.id);
    } catch (supersedeErr: any) {
      // Superseding failed — mark new decision FAILED to prevent two unresolved decisions.
      try {
        await SR.entities.CompanyVersionDecision.update(newDecision.id, {
          status: 'FAILED',
          errorCode: 'SUPERSEDE_INCOMPLETE',
          errorMessage: `Failed to supersede older decision ${older.id}. New decision marked FAILED to preserve invariant.`,
          updatedAt: now,
        });
      } catch (_) {
        // Compensation write failed — this is the worst-case scenario (two unresolved decisions).
        // Logged in audit; the orchestrator will count this as a failure.
      }
      const errorCode = 'SUPERSEDE_INCOMPLETE';
      const errorMessage = `Superseding of older decision ${older.id} failed. New decision ${newDecision.id} marked FAILED. Older decision preserved as unresolved.`;
      await _writeDecisionAudit(SR, actingUserId, 'version_decision_creation_failed', {
        companyId, companyJobId, masterId, fromVersionId, toVersionId,
        distributionEventId, decisionKey,
        metadata: {
          errorCode, errorMessage,
          step: 'supersede',
          newDecisionId: newDecision.id,
          failedToSupersede: older.id,
          supersededSoFar: supersededIds,
        },
      });
      return _failResult({ companyId, companyJobId, masterId, fromVersionId, toVersionId, decisionKey, errorCode, errorMessage });
    }
  }

  // ── Step 4: Verify — exactly one unresolved decision remains ──────────────
  // Live DB check to catch any concurrent-write races or partial-state anomalies.
  let unresolvedAfter: any[] = [];
  try {
    const allDecisionsAfter = await SR.entities.CompanyVersionDecision.filter(
      { companyJobId, masterId },
      '-createdAt',
      50
    ) || [];
    unresolvedAfter = allDecisionsAfter.filter((d: any) =>
      UNRESOLVED_STATUSES.includes(d.status)
    );
  } catch (_) {
    // If the verification query itself fails, we cannot confirm the invariant.
    // Treat as non-fatal: the writes in steps 2 and 3 have already completed
    // successfully per their individual responses. Log and proceed.
    // This is preferable to marking the new decision FAILED on a query outage.
    await _writeDecisionAudit(SR, actingUserId, 'version_decision_created', {
      companyId, companyJobId, masterId, fromVersionId, toVersionId,
      distributionEventId, decisionKey,
      metadata: {
        newDecisionId: newDecision.id,
        supersededCount,
        supersededIds,
        verificationSkipped: true,
        warning: 'Post-create verification query failed; invariant not confirmed.',
      },
    });
    return {
      result: supersededCount > 0 ? 'SUPERSEDED_EXISTING' : 'CREATED',
      companyId, companyJobId, masterId,
      fromVersionId, toVersionId,
      decisionId: newDecision.id, decisionKey,
      supersededDecisionId: supersededIds[0] || null,
      supersededCount,
    };
  }

  if (unresolvedAfter.length > 1) {
    // Multiple unresolved decisions detected — invariant violation.
    // Mark the newly created decision FAILED to attempt to restore the invariant.
    try {
      await SR.entities.CompanyVersionDecision.update(newDecision.id, {
        status: 'FAILED',
        errorCode: 'INVARIANT_VIOLATION',
        errorMessage: `${unresolvedAfter.length} unresolved decisions found after creation. New decision marked FAILED.`,
        updatedAt: now,
      });
    } catch (_) {}

    const errorCode = 'INVARIANT_VIOLATION';
    const errorMessage = `${unresolvedAfter.length} unresolved decisions detected after creation. New decision ${newDecision.id} marked FAILED.`;
    await _writeDecisionAudit(SR, actingUserId, 'version_decision_creation_failed', {
      companyId, companyJobId, masterId, fromVersionId, toVersionId,
      distributionEventId, decisionKey,
      metadata: {
        errorCode, errorMessage,
        step: 'verify',
        newDecisionId: newDecision.id,
        unresolvedDecisionIds: unresolvedAfter.map((d: any) => d.id),
      },
    });
    return _failResult({ companyId, companyJobId, masterId, fromVersionId, toVersionId, decisionKey, errorCode, errorMessage });
  }

  // ── Step 5: Audit and return ───────────────────────────────────────────────
  const auditAction = supersededCount > 0 ? 'version_decision_superseded' : 'version_decision_created';

  await _writeDecisionAudit(SR, actingUserId, auditAction, {
    companyId, companyJobId, masterId, fromVersionId, toVersionId,
    distributionEventId, decisionKey,
    metadata: {
      newDecisionId: newDecision.id,
      supersededCount,
      supersededIds,
      unresolvedAfterCount: unresolvedAfter.length,
    },
  });

  return {
    result: supersededCount > 0 ? 'SUPERSEDED_EXISTING' : 'CREATED',
    companyId, companyJobId, masterId,
    fromVersionId, toVersionId,
    decisionId: newDecision.id, decisionKey,
    supersededDecisionId: supersededIds[0] || null,
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