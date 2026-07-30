/**
 * adoptionEngine.ts — Edit 5C (Hardened): Company Version Adoption Engine
 *
 * THE SINGLE AUTHORITATIVE IMPLEMENTATION for executing version adoption
 * from a completed CompanyVersionAnalysis produced by Edit 5B.
 *
 * ── CORE RULE ──────────────────────────────────────────────────────────────────
 * This engine CONSUMES an existing CompanyVersionAnalysis. It NEVER:
 *   - Re-runs versionDiff
 *   - Re-runs versionAnalysis
 *   - Recreates logicalItemIds
 *   - Modifies Master data
 *   - Auto-resolves REVIEW_REQUIRED items
 *   - Deletes company-created items
 *   - Deletes ORPHANED items
 *   - Silently overwrites overrides
 *
 * ── PHASES ────────────────────────────────────────────────────────────────────
 *   1. Validation       — inputs, job state, analysis state
 *   2. Pre-flight       — stale-analysis detection, idempotency + partial-state recovery
 *   3. canAutoAdopt?    — gate: if false, stop unless caller provides decisions
 *   4. Rebase           — build new override from itemResults + decisions
 *   5. Three-step write — Step1: override with rebaseIncomplete=true + pendingTargetVersionId
 *                         Step2: Job.sourceVersionId = targetVersionId
 *                         Step3: override rebaseIncomplete=false, clear pendingTargetVersionId
 *   6. Audit            — write ActivityLog; on failure set auditPending durably on override
 *   7. Version decision — update CompanyVersionDecision if linked
 *   8. Notification     — only after successful commit
 *
 * ── THREE-STEP WRITE SEQUENCE (compensating-transaction) ──────────────────────
 * Base44 has no multi-entity transactions. Strategy:
 *
 *   Step 1 — JobOverride.update:
 *     · write rebased override data
 *     · increment revision
 *     · set lastAdoptionMutationKey = mutationKey
 *     · set rebaseIncomplete = true          ← pre-set BEFORE writing Job
 *     · set pendingTargetVersionId           ← what we're trying to pin
 *   Step 2 — Job.update:
 *     · sourceVersionId = targetVersionId
 *     · lastAdoptionMutationKey = mutationKey
 *   Step 3 — JobOverride.update:
 *     · rebaseIncomplete = false             ← clear only after Job is pinned
 *     · pendingTargetVersionId = null
 *
 * Pre-setting rebaseIncomplete=true in Step 1 means: even if the process dies
 * between Steps 1 and 2, the incomplete marker is already durable — no silent
 * partial state. Recovery on retry inspects both records and routes accordingly.
 *
 * ── RECOVERY MATRIX ───────────────────────────────────────────────────────────
 * On retry with same mutationKey, Phase 2 reads both records and routes:
 *
 *   A) override.rebaseIncomplete=true, job still on fromVersion
 *      → resume from Step 2 (Job.update), then Step 3
 *
 *   B) override.rebaseIncomplete=true, job already on targetVersion
 *      → resume from Step 3 only (override cleanup)
 *
 *   C) override.rebaseIncomplete=false, job on targetVersion, keys match
 *      → fully committed — return idempotent success
 *
 *   D) mutationKey mismatch or revision mismatch
 *      → CONCURRENT_MODIFICATION — stop; do not overwrite
 *
 *   E) No override + job on targetVersion + keys match
 *      → fully committed (no-override path) — return idempotent success
 *
 * ── AUDIT DURABILITY ──────────────────────────────────────────────────────────
 * auditPending is persisted on the JobOverride (or a stub ActivityLog record
 * if there is no override) so it survives process restarts. The API response
 * also returns auditPending=true so the caller can trigger a retry.
 *
 * ── IDEMPOTENCY ───────────────────────────────────────────────────────────────
 * Key: mutationKey stored on both Job.lastAdoptionMutationKey and
 * JobOverride.lastAdoptionMutationKey. Both must agree for a clean commit.
 * Checked before any writes. Partial-state recovery uses these keys.
 *
 * ── ITEM PROCESSING RULES ─────────────────────────────────────────────────────
 * SAFE             → apply master target values; preserve company overrides
 * REVIEW_REQUIRED  → blocked unless caller provides explicit decision
 * ORPHANED         → never deleted; preserved in override; marked in audit
 * NO_OP            → preserve as-is (override value == master value anyway)
 * INVALID          → block adoption; must be fixed first
 * Company-only     → always preserved; never deleted; identity unchanged
 *
 * ── AUTHORIZATION ─────────────────────────────────────────────────────────────
 * Accepts Company Admin (general_manager, project_manager) only.
 * Platform Super Admins are NOT authorized for company adoption — it's a company action.
 */

import { sanitizeOverrideData } from './overrideSanitizer.ts';
import { sanitizeStoredOverride, validateOverrideData, VALID_SECTION_TYPES, deterministicOverrideKey } from './overrideSchema.js';
import { rebaseOverrideFromAnalysis } from './rebaseEngine.ts';

// ── Constants ──────────────────────────────────────────────────────────────────

const SECTION_ORDER = ['tools', 'materials', 'scope', 'procedure', 'safety', 'quality'] as const;
const SECTION_TITLES: Record<string, string> = {
  tools: 'Tools', materials: 'Materials', scope: 'Scope',
  procedure: 'Procedure', safety: 'Safety', quality: 'Quality Standards',
};

const COMPATIBILITY = {
  SAFE: 'SAFE',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  ORPHANED: 'ORPHANED',
  INVALID: 'INVALID',
  NO_OP: 'NO_OP',
} as const;

// ── Public API ─────────────────────────────────────────────────────────────────

export interface AdoptFromAnalysisParams {
  /** The Job.id of the company job to adopt */
  companyJobId: string;
  /** The CompanyVersionAnalysis.id to consume */
  analysisId: string;
  /**
   * Per-REVIEW_REQUIRED item decisions.
   * Key: logicalItemId or itemResult identifier
   * Value: 'KEEP_COMPANY' | 'USE_NEW_MASTER'
   * Required for every REVIEW_REQUIRED item; missing entries block adoption.
   */
  reviewDecisions: Record<string, 'KEEP_COMPANY' | 'USE_NEW_MASTER'>;
  /** Client-generated idempotency key. Must be unique per distinct adoption attempt. */
  mutationKey: string;
  /** Override revision client saw (optimistic concurrency). Use 0 if no override exists. */
  expectedOverrideRevision: number;
}

export interface AdoptFromAnalysisResult {
  success: true;
  idempotent?: boolean;
  recovered?: boolean;
  jobId: string;
  previousVersionId: string;
  newVersionId: string;
  analysisId: string;
  auditPending: boolean;
  adoptionSummary: {
    safeApplied: number;
    reviewDecisionsKept: number;
    reviewDecisionsAccepted: number;
    orphanedPreserved: number;
    noOpPreserved: number;
    companyOnlyPreserved: number;
    overrideRebased: boolean;
    overrideRemoved: boolean;
  };
}

/**
 * executeAdoptionFromAnalysis — Main entry point.
 *
 * @param base44  — Base44 client (user context)
 * @param SR      — base44.asServiceRole
 * @param params  — AdoptFromAnalysisParams
 * @param userId  — authenticated user id
 * @returns { result } or { error: Response }
 */
export async function executeAdoptionFromAnalysis(
  base44: any,
  SR: any,
  params: AdoptFromAnalysisParams,
  userId: string
): Promise<{ result?: AdoptFromAnalysisResult; error?: Response }> {

  const { companyJobId, analysisId, reviewDecisions, mutationKey, expectedOverrideRevision } = params;

  // ── Phase 1: Input validation ──────────────────────────────────────────────
  if (!companyJobId || typeof companyJobId !== 'string') {
    return { error: Response.json({ error: 'companyJobId is required', code: 'INVALID_INPUT' }, { status: 400 }) };
  }
  if (!analysisId || typeof analysisId !== 'string') {
    return { error: Response.json({ error: 'analysisId is required', code: 'INVALID_INPUT' }, { status: 400 }) };
  }
  if (!mutationKey || typeof mutationKey !== 'string') {
    return { error: Response.json({ error: 'mutationKey is required', code: 'INVALID_INPUT' }, { status: 400 }) };
  }
  if (typeof expectedOverrideRevision !== 'number') {
    return { error: Response.json({ error: 'expectedOverrideRevision is required', code: 'INVALID_INPUT' }, { status: 400 }) };
  }
  if (!reviewDecisions || typeof reviewDecisions !== 'object') {
    return { error: Response.json({ error: 'reviewDecisions is required (pass {} if no review items)', code: 'INVALID_INPUT' }, { status: 400 }) };
  }

  // ── Phase 1: Load job ──────────────────────────────────────────────────────
  let job: any = null;
  try { job = await SR.entities.Job.get(companyJobId); } catch (_) {}
  if (!job) {
    return { error: Response.json({ error: 'Company Job not found', code: 'JOB_NOT_FOUND' }, { status: 404 }) };
  }

  // ── Phase 1: Authorization — company admin only ────────────────────────────
  const memberships = await base44.entities.CompanyMembership.filter({
    userId, companyId: job.companyId, status: 'active',
  }).catch(() => []);
  if (!memberships || memberships.length === 0) {
    return { error: Response.json({ error: 'Forbidden: not a member of this company', code: 'FORBIDDEN' }, { status: 403 }) };
  }
  const membership = memberships[0];
  const isCompanyAdmin = membership.role === 'general_manager' || membership.role === 'project_manager';
  if (!isCompanyAdmin) {
    return { error: Response.json({ error: 'Insufficient role: company admin required for version adoption', code: 'INSUFFICIENT_ROLE' }, { status: 403 }) };
  }

  // ── Phase 1: Job must be a provisioned Essential SOP ──────────────────────
  if (job.sourceType !== 'essential_sop') {
    return { error: Response.json({ error: 'Version adoption only applies to provisioned Essential SOP Jobs', code: 'NOT_ESSENTIAL_SOP' }, { status: 409 }) };
  }
  if (!job.sourceMasterId || !job.sourceVersionId) {
    return { error: Response.json({ error: 'Job is missing sourceMasterId or sourceVersionId', code: 'MISSING_VERSION_FIELDS' }, { status: 409 }) };
  }

  // ── Phase 1: Load analysis ─────────────────────────────────────────────────
  let analysis: any = null;
  try { analysis = await SR.entities.CompanyVersionAnalysis.get(analysisId); } catch (_) {}
  if (!analysis) {
    return { error: Response.json({ error: 'CompanyVersionAnalysis not found', code: 'ANALYSIS_NOT_FOUND' }, { status: 404 }) };
  }

  // ── Phase 1: Analysis must be COMPLETED ───────────────────────────────────
  if (analysis.status !== 'COMPLETED') {
    return { error: Response.json({
      error: `Analysis is not COMPLETED (status: ${analysis.status}). Run analyzeVersionUpdate first.`,
      code: 'ANALYSIS_NOT_COMPLETE',
      analysisStatus: analysis.status,
    }, { status: 409 }) };
  }

  // ── Phase 1: Analysis must belong to this job ──────────────────────────────
  if (analysis.companyJobId !== companyJobId) {
    return { error: Response.json({ error: 'Analysis does not belong to this Job', code: 'ANALYSIS_JOB_MISMATCH' }, { status: 409 }) };
  }

  const targetVersionId = analysis.toVersionId;

  // ── Phase 1: Load and validate target version ──────────────────────────────
  let targetVersion: any = null;
  try { targetVersion = await SR.entities.EssentialSOPVersion.get(targetVersionId); } catch (_) {}
  if (!targetVersion) {
    return { error: Response.json({ error: 'Target version not found', code: 'TARGET_VERSION_NOT_FOUND' }, { status: 404 }) };
  }
  if (targetVersion.status !== 'published') {
    return { error: Response.json({ error: 'Target version is not published', code: 'TARGET_VERSION_NOT_PUBLISHED' }, { status: 409 }) };
  }
  if (targetVersion.masterId !== job.sourceMasterId) {
    return { error: Response.json({ error: 'Target version master mismatch', code: 'VERSION_MASTER_MISMATCH' }, { status: 409 }) };
  }

  // ── Phase 2: Load current override (needed for idempotency + recovery checks) ──
  const overrideRecords = await SR.entities.JobOverride.filter({ companyId: job.companyId, jobId: companyJobId }).catch(() => []);
  const override: any = overrideRecords?.[0] || null;
  const currentOverrideRevision = override?.revision ?? 0;

  // ── Phase 2: Idempotency + partial-state recovery ─────────────────────────
  //
  // Recovery matrix — evaluated before any new writes:
  //
  //  C) override.rebaseIncomplete=false, job on targetVersion, keys match → fully committed
  //  E) No override + job on targetVersion + keys match → committed (no-override path)
  //  A) override.rebaseIncomplete=true, job still on fromVersion → resume Step 2 + 3
  //  B) override.rebaseIncomplete=true, job already on targetVersion → resume Step 3 only
  //  D) mutationKey mismatch on override (different key, incomplete) → CONCURRENT_MODIFICATION
  //
  const jobKeyMatch = job.lastAdoptionMutationKey === mutationKey;
  const jobOnTarget = job.sourceVersionId === targetVersionId;
  const overrideKeyMatch = override ? override.lastAdoptionMutationKey === mutationKey : true; // no override = no mismatch
  const overrideIncomplete = override?.rebaseIncomplete === true;
  const overridePendingTarget = override?.pendingTargetVersionId;

  // Case C / E: fully committed
  if (jobKeyMatch && jobOnTarget && !overrideIncomplete) {
    return {
      result: {
        success: true,
        idempotent: true,
        jobId: job.id,
        previousVersionId: analysis.fromVersionId,
        newVersionId: targetVersionId,
        analysisId,
        auditPending: override?.auditPending || false,
        adoptionSummary: _summaryFromAnalysis(analysis, reviewDecisions),
      },
    };
  }

  // Case D: different mutation key on override that is still incomplete → concurrent modification
  if (overrideIncomplete && !overrideKeyMatch) {
    return { error: Response.json({
      error: 'A different adoption is currently in progress for this Job. Wait for it to complete or contact support.',
      code: 'CONCURRENT_MODIFICATION',
      overrideMutationKey: override?.lastAdoptionMutationKey,
    }, { status: 409 }) };
  }

  // Case A: override incomplete, job not yet pinned → resume Step 2 + Step 3
  if (overrideIncomplete && overrideKeyMatch && !jobOnTarget) {
    return await _resumeStep2(SR, job, override, targetVersionId, mutationKey, targetVersion, analysisId, analysis, userId);
  }

  // Case B: override incomplete, job already pinned → resume Step 3 only
  if (overrideIncomplete && overrideKeyMatch && jobOnTarget) {
    return await _resumeStep3(SR, job, override, targetVersionId, mutationKey, targetVersion, analysisId, analysis, userId);
  }

  // ── Phase 2: Fresh adoption path — standard pre-flight checks ─────────────

  // Analysis must match job's current version (not relevant for recovery paths above)
  if (analysis.fromVersionId !== job.sourceVersionId) {
    return { error: Response.json({
      error: 'Analysis fromVersionId does not match Job\'s current sourceVersionId. The Job may have already been updated. Re-analyze.',
      code: 'ANALYSIS_VERSION_MISMATCH',
      analysisFromVersion: analysis.fromVersionId,
      jobCurrentVersion: job.sourceVersionId,
    }, { status: 409 }) };
  }

  // Already-current check
  if (job.sourceVersionId === targetVersionId) {
    return { error: Response.json({
      error: 'Job is already on the target version.',
      code: 'ALREADY_CURRENT',
    }, { status: 409 }) };
  }

  // Stale analysis check
  if (analysis.status === 'STALE') {
    return { error: Response.json({
      error: 'Analysis is STALE — override changed after analysis completed. Re-analyze.',
      code: 'ANALYSIS_STALE',
    }, { status: 409 }) };
  }

  // ── Phase 2: canAutoAdopt gate ─────────────────────────────────────────────
  const reviewRequiredItems = (analysis.itemResults || []).filter(
    (r: any) => r.compatibility === COMPATIBILITY.REVIEW_REQUIRED
  );

  if (!analysis.canAutoAdopt) {
    const missingDecisions: string[] = [];
    for (const item of reviewRequiredItems) {
      const key = item.logicalItemId || item.currentItemId || item.overrideId;
      if (!key) continue;
      if (!reviewDecisions[key]) missingDecisions.push(key);
    }
    if (missingDecisions.length > 0) {
      return { error: Response.json({
        error: `canAutoAdopt=false. Decisions required for ${missingDecisions.length} REVIEW_REQUIRED item(s) before adoption can proceed.`,
        code: 'REVIEW_DECISIONS_REQUIRED',
        missingDecisionKeys: missingDecisions,
        reviewRequiredCount: analysis.reviewRequiredCount,
      }, { status: 409 }) };
    }
  }

  // ── Phase 2: Validate review decision values ───────────────────────────────
  const VALID_DECISIONS = new Set(['KEEP_COMPANY', 'USE_NEW_MASTER']);
  for (const [key, val] of Object.entries(reviewDecisions)) {
    if (!VALID_DECISIONS.has(val)) {
      return { error: Response.json({
        error: `Invalid decision value '${val}' for key '${key}'. Must be KEEP_COMPANY or USE_NEW_MASTER.`,
        code: 'INVALID_DECISION_VALUE',
      }, { status: 400 }) };
    }
  }

  // ── Phase 2: Optimistic concurrency on override ────────────────────────────
  if (expectedOverrideRevision !== currentOverrideRevision) {
    return { error: Response.json({
      error: 'Override was modified since analysis was run. Re-analyze and retry.',
      code: 'REVISION_CONFLICT',
      expectedRevision: expectedOverrideRevision,
      currentRevision: currentOverrideRevision,
    }, { status: 409 }) };
  }

  // ── Phase 3: Reject INVALID items ─────────────────────────────────────────
  if ((analysis.invalidCount ?? 0) > 0) {
    return { error: Response.json({
      error: `Analysis found ${analysis.invalidCount} INVALID override item(s). Fix the override before adopting.`,
      code: 'INVALID_ITEMS_PRESENT',
      invalidCount: analysis.invalidCount,
    }, { status: 409 }) };
  }

  // ── Phase 4: Load target sections + build rebased override ────────────────
  const targetSections = await SR.entities.EssentialSOPSection.filter(
    { masterId: job.sourceMasterId, versionId: targetVersionId }, 'sortOrder', 10
  ).catch(() => []) || [];

  let sanitizedOverrideData: any = null;
  if (override?.overrideData) {
    const { sanitized } = sanitizeStoredOverride(override.overrideData, companyJobId);
    sanitizedOverrideData = sanitized;
  }

  const rebaseResult = rebaseOverrideFromAnalysis({
    itemResults: analysis.itemResults || [],
    existingOverrideData: sanitizedOverrideData,
    targetSections,
    reviewDecisions,
  });
  const { rebasedOverrideData, counts: rebaseCounts } = rebaseResult;
  const adoptionSummaryPartial = rebaseCounts;

  if (rebasedOverrideData) {
    const validation = validateOverrideData(rebasedOverrideData);
    if (!validation.valid) {
      return { error: Response.json({
        error: `Rebased override failed validation: ${validation.error}`,
        code: 'REBASE_VALIDATION_FAILED',
      }, { status: 500 }) };
    }
  }

  const previousVersionId = job.sourceVersionId;
  const now = new Date().toISOString();
  const overrideWillBeEmpty = rebasedOverrideData === null || Object.keys(rebasedOverrideData).length === 0;

  // ── Phase 5: THREE-STEP WRITE ──────────────────────────────────────────────

  // ── Step 1: Write override with rebaseIncomplete=true (pre-set before Job write) ──
  let savedOverrideId: string | null = override?.id || null;

  if (override) {
    if (overrideWillBeEmpty) {
      // If the rebased override would be empty we still cannot delete it yet —
      // we need it to carry the rebaseIncomplete marker until Step 2 succeeds.
      // Write a sentinel: empty overrideData, rebaseIncomplete=true.
      try {
        await SR.entities.JobOverride.update(override.id, {
          overrideData: {},
          customizedFields: [],
          revision: currentOverrideRevision + 1,
          lastMutationKey: mutationKey,
          lastAdoptionMutationKey: mutationKey,
          lastModifiedByUserId: userId,
          sourceMasterId: job.sourceMasterId,
          sourceVersionId: job.sourceVersionId, // still old version at this point
          rebaseIncomplete: true,
          pendingTargetVersionId: targetVersionId,
          pendingAnalysisId: analysisId,
          auditPending: false,
          updatedAt: now,
        });
      } catch (err: any) {
        return { error: Response.json({
          error: 'Failed to prepare override for adoption (step 1). No changes made.',
          code: 'STEP1_OVERRIDE_FAILED',
        }, { status: 500 }) };
      }
    } else {
      try {
        const customizedFields = _computeCustomizedFields(rebasedOverrideData);
        await SR.entities.JobOverride.update(override.id, {
          overrideData: rebasedOverrideData,
          customizedFields,
          revision: currentOverrideRevision + 1,
          lastMutationKey: mutationKey,
          lastAdoptionMutationKey: mutationKey,
          lastModifiedByUserId: userId,
          sourceMasterId: job.sourceMasterId,
          sourceVersionId: job.sourceVersionId, // still old version at this point
          rebaseIncomplete: true,
          pendingTargetVersionId: targetVersionId,
          pendingAnalysisId: analysisId,
          auditPending: false,
          updatedAt: now,
        });
      } catch (err: any) {
        return { error: Response.json({
          error: 'Failed to write rebased override (step 1). No changes made.',
          code: 'STEP1_OVERRIDE_FAILED',
        }, { status: 500 }) };
      }
    }
  } else if (rebasedOverrideData && !overrideWillBeEmpty) {
    // No existing override; rebase produced data — create it with rebaseIncomplete=true
    try {
      const customizedFields = _computeCustomizedFields(rebasedOverrideData);
      const created = await SR.entities.JobOverride.create({
        companyId: job.companyId,
        jobId: companyJobId,
        deterministicKey: deterministicOverrideKey(job.companyId, companyJobId),
        sourceMasterId: job.sourceMasterId,
        sourceVersionId: job.sourceVersionId, // still old version at this point
        overrideData: rebasedOverrideData,
        customizedFields,
        revision: 1,
        mutationKey,
        lastMutationKey: mutationKey,
        lastAdoptionMutationKey: mutationKey,
        rebaseIncomplete: true,
        pendingTargetVersionId: targetVersionId,
        pendingAnalysisId: analysisId,
        auditPending: false,
        createdByUserId: userId,
        lastModifiedByUserId: userId,
        createdAt: now,
        updatedAt: now,
      });
      savedOverrideId = created?.id || null;
    } catch (err: any) {
      return { error: Response.json({
        error: 'Failed to create rebased override (step 1). No changes made.',
        code: 'STEP1_OVERRIDE_CREATE_FAILED',
      }, { status: 500 }) };
    }
  }
  // If no override and rebasedOverrideData is null: no Step 1 write needed.
  // rebaseIncomplete tracking lives on Job.lastAdoptionMutationKey absence in this path.

  // ── Step 2: Pin new version on Job ────────────────────────────────────────
  try {
    await SR.entities.Job.update(companyJobId, {
      sourceVersionId: targetVersionId,
      lastAdoptionMutationKey: mutationKey,
    });
  } catch (err: any) {
    // Step 2 failed — override already has rebaseIncomplete=true + pendingTargetVersionId.
    // This is the durable partial-state signal. Recovery will resume from Step 2 on retry.
    return { error: Response.json({
      error: 'Failed to update Job version pin (step 2). Override is marked incomplete. Retry with the same mutationKey to recover.',
      code: 'STEP2_JOB_UPDATE_FAILED',
      recoverable: true,
      mutationKey,
    }, { status: 500 }) };
  }

  // ── Step 3: Clear rebaseIncomplete marker on override ────────────────────
  if (savedOverrideId) {
    try {
      if (overrideWillBeEmpty) {
        // Now safe to delete the sentinel override
        await SR.entities.JobOverride.delete(savedOverrideId);
        savedOverrideId = null;
      } else {
        await SR.entities.JobOverride.update(savedOverrideId, {
          rebaseIncomplete: false,
          pendingTargetVersionId: null,
          pendingAnalysisId: null,
          sourceVersionId: targetVersionId,
          updatedAt: now,
        });
      }
    } catch (err: any) {
      // Step 3 failed — override still has rebaseIncomplete=true but Job is pinned.
      // This is Case B in the recovery matrix. Retry with same mutationKey routes to _resumeStep3.
      // Adoption is functionally complete; resolveJob will block on rebaseIncomplete=true.
      return { error: Response.json({
        error: 'Job version was updated but override marker could not be cleared (step 3). Retry with the same mutationKey to finish.',
        code: 'STEP3_MARKER_CLEAR_FAILED',
        recoverable: true,
        mutationKey,
        jobVersionUpdated: true,
      }, { status: 500 }) };
    }
  }

  // ── Phase 6: Audit ─────────────────────────────────────────────────────────
  const adoptionSummary = {
    ...adoptionSummaryPartial,
    overrideRebased: !!override || !!(rebasedOverrideData && !overrideWillBeEmpty),
    overrideRemoved: overrideWillBeEmpty && !!override,
  };

  const auditPending = await _writeAudit(SR, {
    job, companyJobId, userId, targetVersion, previousVersionId, targetVersionId,
    analysisId, analysis, reviewDecisions, adoptionSummary, mutationKey, now,
    savedOverrideId, // pass for durable auditPending mark if audit fails
  });

  // ── Phase 7: Version decision ──────────────────────────────────────────────
  if (analysis.companyVersionDecisionId) {
    try {
      await SR.entities.CompanyVersionDecision.update(analysis.companyVersionDecisionId, {
        status: 'ACCEPTED',
        decidedAt: now,
        decidedByUserId: userId,
        decisionNote: `Auto-adopted via analysis ${analysisId} (Edit 5C)`,
        updatedAt: now,
      });
    } catch (_) {
      // Non-fatal — decision update failure does not roll back the adoption
    }
  }

  // ── Phase 8: Notification ──────────────────────────────────────────────────
  try {
    await SR.entities.Notification.create({
      companyId: job.companyId,
      userId,
      type: 'job_published',
      title: 'Job Updated to New Version',
      body: `"${job.title}" has been updated to v${targetVersion.versionNumber} of the Essential SOP.`,
      targetType: 'job',
      targetId: companyJobId,
      isRead: false,
    });
  } catch (_) {}

  return {
    result: {
      success: true,
      jobId: companyJobId,
      previousVersionId,
      newVersionId: targetVersionId,
      analysisId,
      auditPending,
      adoptionSummary,
    },
  };
}

// ── Recovery: resume from Step 2 (Case A) ─────────────────────────────────────
// Override has rebaseIncomplete=true, job still on fromVersion.
// Retry only Step 2 (pin job), then Step 3 (clear marker).
async function _resumeStep2(
  SR: any, job: any, override: any, targetVersionId: string, mutationKey: string,
  targetVersion: any, analysisId: string, analysis: any, userId: string
): Promise<{ result?: AdoptFromAnalysisResult; error?: Response }> {
  const now = new Date().toISOString();

  try {
    await SR.entities.Job.update(job.id, {
      sourceVersionId: targetVersionId,
      lastAdoptionMutationKey: mutationKey,
    });
  } catch (err: any) {
    return { error: Response.json({
      error: 'Recovery Step 2 failed: could not pin job version. Retry with same mutationKey.',
      code: 'STEP2_JOB_UPDATE_FAILED',
      recoverable: true,
      mutationKey,
    }, { status: 500 }) };
  }

  return await _resumeStep3(SR, job, override, targetVersionId, mutationKey, targetVersion, analysisId, analysis, userId);
}

// ── Recovery: resume from Step 3 (Case B) ─────────────────────────────────────
// Job is already on target, override still has rebaseIncomplete=true.
// Clear the marker only.
async function _resumeStep3(
  SR: any, job: any, override: any, targetVersionId: string, mutationKey: string,
  targetVersion: any, analysisId: string, analysis: any, userId: string
): Promise<{ result?: AdoptFromAnalysisResult; error?: Response }> {
  const now = new Date().toISOString();
  const overrideWillBeEmpty = !override?.overrideData || Object.keys(override.overrideData).length === 0;

  if (override) {
    try {
      if (overrideWillBeEmpty) {
        await SR.entities.JobOverride.delete(override.id);
      } else {
        await SR.entities.JobOverride.update(override.id, {
          rebaseIncomplete: false,
          pendingTargetVersionId: null,
          pendingAnalysisId: null,
          sourceVersionId: targetVersionId,
          updatedAt: now,
        });
      }
    } catch (err: any) {
      return { error: Response.json({
        error: 'Recovery Step 3 failed: could not clear incomplete marker. Retry with same mutationKey.',
        code: 'STEP3_MARKER_CLEAR_FAILED',
        recoverable: true,
        mutationKey,
        jobVersionUpdated: true,
      }, { status: 500 }) };
    }
  }

  // Retry audit if still pending
  const auditPending = override?.auditPending
    ? await _writeAudit(SR, {
        job, companyJobId: job.id, userId, targetVersion,
        previousVersionId: analysis.fromVersionId, targetVersionId,
        analysisId, analysis, reviewDecisions: {}, adoptionSummary: _summaryFromAnalysis(analysis, {}),
        mutationKey, now, savedOverrideId: override?.id || null,
      })
    : false;

  return {
    result: {
      success: true,
      recovered: true,
      jobId: job.id,
      previousVersionId: analysis.fromVersionId,
      newVersionId: targetVersionId,
      analysisId,
      auditPending,
      adoptionSummary: _summaryFromAnalysis(analysis, {}),
    },
  };
}

// ── Internal: write audit record; persist auditPending durably on override ─────
async function _writeAudit(SR: any, ctx: {
  job: any; companyJobId: string; userId: string; targetVersion: any;
  previousVersionId: string; targetVersionId: string; analysisId: string; analysis: any;
  reviewDecisions: Record<string, string>; adoptionSummary: any; mutationKey: string;
  now: string; savedOverrideId: string | null;
}): Promise<boolean> {
  const { job, companyJobId, userId, targetVersion, previousVersionId, targetVersionId,
          analysisId, analysis, reviewDecisions, adoptionSummary, mutationKey, now, savedOverrideId } = ctx;
  try {
    await SR.entities.ActivityLog.create({
      companyId: job.companyId,
      actingUserId: userId,
      actionType: 'job_edited',
      targetType: 'job',
      targetId: companyJobId,
      summary: `Adopted Master Version ${targetVersion.versionNumber} for "${job.title}" using analysis ${analysisId}`,
      metadata: {
        event: 'COMPANY_MASTER_VERSION_ADOPTED_FROM_ANALYSIS',
        previousVersionId,
        newVersionId: targetVersionId,
        targetVersionNumber: targetVersion.versionNumber,
        masterId: job.sourceMasterId,
        analysisId,
        analysisSchemaVersion: analysis.analysisSchemaVersion,
        canAutoAdopt: analysis.canAutoAdopt,
        reviewDecisionsProvided: Object.keys(reviewDecisions).length,
        ...adoptionSummary,
        mutationKey,
      },
      timestamp: now,
    });
    return false; // auditPending = false
  } catch (_) {
    // Audit write failed — persist auditPending durably on override so it survives restarts
    if (savedOverrideId) {
      try {
        await SR.entities.JobOverride.update(savedOverrideId, {
          auditPending: true,
          auditPendingRevision: (ctx.job?.revision ?? 0) + 1,
          updatedAt: now,
        });
      } catch (_) {
        // Double failure — auditPending will only be in the API response
      }
    }
    return true; // auditPending = true
  }
}

// _rebaseOverrideFromAnalysis has been extracted to base44/shared/rebaseEngine.ts.
// adoptionEngine now imports rebaseOverrideFromAnalysis from that module.
// This comment is the only trace of the removed duplicate.

// ── Internal helpers ───────────────────────────────────────────────────────────
function _computeCustomizedFields(overrideData: any): string[] {
  const fields: string[] = [];
  if (overrideData?.title) fields.push('title');
  if (overrideData?.shortDescription) fields.push('shortDescription');
  for (const st of Object.keys(overrideData?.sectionOverrides || {})) fields.push(`section:${st}`);
  return fields;
}

function _summaryFromAnalysis(analysis: any, reviewDecisions: Record<string, string>): AdoptFromAnalysisResult['adoptionSummary'] {
  return {
    safeApplied: analysis.safeCount ?? 0,
    reviewDecisionsKept: Object.values(reviewDecisions).filter(d => d === 'KEEP_COMPANY').length,
    reviewDecisionsAccepted: Object.values(reviewDecisions).filter(d => d === 'USE_NEW_MASTER').length,
    orphanedPreserved: analysis.orphanedCount ?? 0,
    noOpPreserved: analysis.noOpCount ?? 0,
    companyOnlyPreserved: 0,
    overrideRebased: false,
    overrideRemoved: false,
  };
}