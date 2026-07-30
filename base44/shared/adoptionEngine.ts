/**
 * adoptionEngine.ts — Edit 5C: Company Version Adoption Engine
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
 *   2. Pre-flight       — stale-analysis detection, idempotency
 *   3. canAutoAdopt?    — gate: if false, stop unless caller provides decisions
 *   4. Rebase           — build new override from itemResults + decisions
 *   5. Atomic write     — override first, then job pin
 *   6. Audit            — immutable ActivityLog entry
 *   7. Version decision — update CompanyVersionDecision if linked
 *   8. Notification     — only after successful commit
 *
 * ── ATOMICITY ─────────────────────────────────────────────────────────────────
 * Base44 has no multi-entity transactions. Strategy:
 *   Step A: write rebased override (or delete empty one)
 *   Step B: update Job.sourceVersionId + lastAdoptionMutationKey
 * If Step B fails: rebaseIncomplete=true is written to override for recovery.
 * If Step A fails: nothing changed, safe to retry with same mutationKey.
 * Idempotency key on Job entity prevents double-adoption on retry.
 *
 * ── IDEMPOTENCY ───────────────────────────────────────────────────────────────
 * Key: Job.lastAdoptionMutationKey === mutationKey → return existing success.
 * Checked before any writes. Safe to retry after partial failures.
 *
 * ── ITEM PROCESSING RULES ─────────────────────────────────────────────────────
 * SAFE             → apply master target values; preserve company overrides
 * REVIEW_REQUIRED  → blocked unless caller provides explicit decision
 * ORPHANED         → never deleted; preserved in override; marked in audit
 * NO_OP            → preserve as-is (override value == master value anyway)
 * INVALID          → block adoption; must be fixed first
 * Company-only     → always preserved; never deleted; identity unchanged
 *
 * ── REBASE LOGIC ──────────────────────────────────────────────────────────────
 * The rebase builds a new sectionOverrides map from the analysis itemResults.
 * It does NOT use versionDiff.rebaseOverride() — that function re-diffs.
 * Instead it walks itemResults and applies the analysis classifications directly.
 *
 * For each section with an existing company override:
 *   1. Start from the TARGET master section contentItems as the base
 *   2. For each item in the existing override:
 *      a. Find its itemResult (by logicalItemId or _itemId)
 *      b. Apply classification rules to decide keep/drop/replace
 *   3. Company-added items (no logicalItemId, no master anchor) are always appended
 *
 * ── AUTHORIZATION ─────────────────────────────────────────────────────────────
 * Accepts Company Admin (general_manager, project_manager) only.
 * Platform Super Admins are NOT authorized for company adoption — it's a company action.
 */

import { sanitizeOverrideData } from './overrideSanitizer.ts';
import { sanitizeStoredOverride, validateOverrideData, VALID_SECTION_TYPES, deterministicOverrideKey } from './overrideSchema.js';

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

  // ── Phase 1: Analysis must match job's current version ────────────────────
  if (analysis.fromVersionId !== job.sourceVersionId) {
    return { error: Response.json({
      error: 'Analysis fromVersionId does not match Job\'s current sourceVersionId. The Job may have already been updated. Re-analyze.',
      code: 'ANALYSIS_VERSION_MISMATCH',
      analysisFromVersion: analysis.fromVersionId,
      jobCurrentVersion: job.sourceVersionId,
    }, { status: 409 }) };
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

  // ── Phase 2: Idempotency — must be before any writes ──────────────────────
  if (job.lastAdoptionMutationKey === mutationKey) {
    // Exact same operation already completed — return success
    const resolvedJob = await _resolveJobForResponse(job, SR, membership);
    return {
      result: {
        success: true,
        idempotent: true,
        jobId: job.id,
        previousVersionId: job.sourceVersionId, // already adopted, so this IS the new version
        newVersionId: targetVersionId,
        analysisId,
        auditPending: false,
        adoptionSummary: _summaryFromAnalysis(analysis, {}),
      },
    };
  }

  // ── Phase 2: Already-current check ────────────────────────────────────────
  if (job.sourceVersionId === targetVersionId) {
    return { error: Response.json({
      error: 'Job is already on the target version.',
      code: 'ALREADY_CURRENT',
    }, { status: 409 }) };
  }

  // ── Phase 2: canAutoAdopt gate ─────────────────────────────────────────────
  // If analysis says canAutoAdopt=false, the caller MUST provide decisions for every
  // REVIEW_REQUIRED item. We validate that here.
  const reviewRequiredItems = (analysis.itemResults || []).filter(
    (r: any) => r.compatibility === COMPATIBILITY.REVIEW_REQUIRED
  );

  if (!analysis.canAutoAdopt) {
    // Validate that every REVIEW_REQUIRED item has a provided decision
    const missingDecisions: string[] = [];
    for (const item of reviewRequiredItems) {
      const key = item.logicalItemId || item.currentItemId || item.overrideId;
      if (!key) continue; // no addressable identity — skip (treated as orphaned)
      if (!reviewDecisions[key]) {
        missingDecisions.push(key);
      }
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
  const overrideRecords = await SR.entities.JobOverride.filter({ companyId: job.companyId, jobId: companyJobId }).catch(() => []);
  const override: any = overrideRecords?.[0] || null;
  const currentOverrideRevision = override?.revision ?? 0;

  if (expectedOverrideRevision !== currentOverrideRevision) {
    return { error: Response.json({
      error: 'Override was modified since analysis was run. Re-analyze and retry.',
      code: 'REVISION_CONFLICT',
      expectedRevision: expectedOverrideRevision,
      currentRevision: currentOverrideRevision,
    }, { status: 409 }) };
  }

  // ── Phase 2: Stale analysis detection ─────────────────────────────────────
  // The analysis's overrideStateFingerprint was computed at analysis time.
  // If the override changed since (different revision), the analysis is stale.
  // We already caught revision mismatch above. Additionally check if analysis is STALE.
  if (analysis.status === 'STALE') {
    return { error: Response.json({
      error: 'Analysis is STALE — override changed after analysis completed. Re-analyze.',
      code: 'ANALYSIS_STALE',
    }, { status: 409 }) };
  }

  // ── Phase 3: Reject INVALID items — must be fixed before adoption ──────────
  if ((analysis.invalidCount ?? 0) > 0) {
    return { error: Response.json({
      error: `Analysis found ${analysis.invalidCount} INVALID override item(s). Fix the override before adopting.`,
      code: 'INVALID_ITEMS_PRESENT',
      invalidCount: analysis.invalidCount,
    }, { status: 409 }) };
  }

  // ── Phase 4: Load target sections (needed for rebase) ─────────────────────
  const targetSections = await SR.entities.EssentialSOPSection.filter(
    { masterId: job.sourceMasterId, versionId: targetVersionId }, 'sortOrder', 10
  ).catch(() => []) || [];

  // ── Phase 4: Build rebased override ───────────────────────────────────────
  let sanitizedOverrideData: any = null;
  if (override?.overrideData) {
    const { sanitized } = sanitizeStoredOverride(override.overrideData, companyJobId);
    sanitizedOverrideData = sanitized;
  }

  const rebaseResult = _rebaseOverrideFromAnalysis(
    analysis.itemResults || [],
    sanitizedOverrideData,
    targetSections,
    reviewDecisions
  );

  const { rebasedOverrideData, adoptionSummaryPartial } = rebaseResult;

  // Validate rebased override
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

  // ── Phase 5: ATOMIC WRITE ──────────────────────────────────────────────────
  // Step A: Write rebased override (before pinning version)
  let savedOverride: any = null;

  if (override) {
    if (overrideWillBeEmpty) {
      try {
        await SR.entities.JobOverride.delete(override.id);
      } catch (err: any) {
        return { error: Response.json({
          error: 'Failed to finalize override during adoption. No changes made.',
          code: 'OVERRIDE_DELETE_FAILED',
        }, { status: 500 }) };
      }
    } else {
      try {
        const customizedFields = _computeCustomizedFields(rebasedOverrideData);
        savedOverride = await SR.entities.JobOverride.update(override.id, {
          overrideData: rebasedOverrideData,
          customizedFields,
          revision: currentOverrideRevision + 1,
          lastMutationKey: mutationKey,
          lastAdoptionMutationKey: mutationKey,
          lastModifiedByUserId: userId,
          sourceMasterId: job.sourceMasterId,
          sourceVersionId: targetVersionId,
          auditPending: false,
          rebaseIncomplete: false,
          updatedAt: now,
        });
      } catch (err: any) {
        return { error: Response.json({
          error: 'Failed to rebase override. No changes made.',
          code: 'OVERRIDE_UPDATE_FAILED',
        }, { status: 500 }) };
      }
    }
  } else if (rebasedOverrideData && !overrideWillBeEmpty) {
    // No existing override but rebase produced one (title/desc override survived)
    try {
      const customizedFields = _computeCustomizedFields(rebasedOverrideData);
      savedOverride = await SR.entities.JobOverride.create({
        companyId: job.companyId,
        jobId: companyJobId,
        deterministicKey: deterministicOverrideKey(job.companyId, companyJobId),
        sourceMasterId: job.sourceMasterId,
        sourceVersionId: targetVersionId,
        overrideData: rebasedOverrideData,
        customizedFields,
        revision: 1,
        mutationKey,
        lastMutationKey: mutationKey,
        lastAdoptionMutationKey: mutationKey,
        auditPending: false,
        rebaseIncomplete: false,
        createdByUserId: userId,
        lastModifiedByUserId: userId,
        createdAt: now,
        updatedAt: now,
      });
    } catch (err: any) {
      return { error: Response.json({
        error: 'Failed to create rebased override. No changes made.',
        code: 'OVERRIDE_CREATE_FAILED',
      }, { status: 500 }) };
    }
  }

  // Step B: Pin new version on Job + record idempotency key
  try {
    await SR.entities.Job.update(companyJobId, {
      sourceVersionId: targetVersionId,
      lastAdoptionMutationKey: mutationKey,
    });
  } catch (err: any) {
    // Step B failed — mark rebaseIncomplete for recovery
    if (savedOverride?.id) {
      try {
        await SR.entities.JobOverride.update(savedOverride.id, { rebaseIncomplete: true, updatedAt: now });
      } catch (_) {}
    }
    return { error: Response.json({
      error: 'Failed to update Job version pin after override rebase. System will attempt recovery on next access.',
      code: 'JOB_VERSION_UPDATE_FAILED',
    }, { status: 500 }) };
  }

  // ── Phase 6: Audit ─────────────────────────────────────────────────────────
  const adoptionSummary = {
    ...adoptionSummaryPartial,
    overrideRebased: !!override || !!(rebasedOverrideData && !overrideWillBeEmpty),
    overrideRemoved: overrideWillBeEmpty && !!override,
  };

  let auditPending = false;
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
  } catch (_) {
    auditPending = true;
  }

  // ── Phase 7: Version decision ──────────────────────────────────────────────
  // Update CompanyVersionDecision if analysis links one
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
  // Only after successful commit. Non-fatal.
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

// ── Internal: rebase override from analysis item results ──────────────────────
//
// This is the core of Edit 5C. It builds the new overrideData by walking the
// analysis.itemResults and applying classification rules WITHOUT re-diffing.
//
// SAFE             → company override for this item is preserved if it exists;
//                    if no override, master target value is used (no action needed)
// REVIEW_REQUIRED  → apply caller's decision: KEEP_COMPANY or USE_NEW_MASTER
// ORPHANED         → preserve override item (never delete)
// NO_OP            → preserve as-is (value matches master anyway)
// company-only     → always append unchanged
// INVALID          → blocked in Phase 3 (won't reach here)

function _rebaseOverrideFromAnalysis(
  itemResults: any[],
  existingOverrideData: any,
  targetSections: any[],
  reviewDecisions: Record<string, 'KEEP_COMPANY' | 'USE_NEW_MASTER'>
): {
  rebasedOverrideData: any | null;
  adoptionSummaryPartial: Omit<AdoptFromAnalysisResult['adoptionSummary'], 'overrideRebased' | 'overrideRemoved'>;
} {
  const counts = {
    safeApplied: 0,
    reviewDecisionsKept: 0,
    reviewDecisionsAccepted: 0,
    orphanedPreserved: 0,
    noOpPreserved: 0,
    companyOnlyPreserved: 0,
  };

  // No existing override → nothing to rebase. Target master is used as-is by resolveJob.
  if (!existingOverrideData) {
    return { rebasedOverrideData: null, adoptionSummaryPartial: counts };
  }

  // Build lookup: logicalItemId / _itemId → itemResult classification
  const resultByLogicalId: Record<string, any> = {};
  const resultByItemId: Record<string, any> = {};
  for (const ir of itemResults) {
    if (ir.logicalItemId) resultByLogicalId[ir.logicalItemId] = ir;
    if (ir.currentItemId) resultByItemId[ir.currentItemId] = ir;
    // Also index by overrideId._itemId if available
    if (ir.companyOverrideValues?.item?._itemId) resultByItemId[ir.companyOverrideValues.item._itemId] = ir;
  }

  // Build target section lookup for item resolution
  const targetSectionByType: Record<string, any> = {};
  for (const s of targetSections) {
    if (s.sectionType) targetSectionByType[s.sectionType] = s;
  }

  const rebasedSectionOverrides: Record<string, any[]> = {};

  for (const st of SECTION_ORDER) {
    const existingItems: any[] = existingOverrideData?.sectionOverrides?.[st] || [];
    if (existingItems.length === 0) continue;

    const rebasedItems: any[] = [];

    for (const item of existingItems) {
      const itemId = item._itemId || '';

      // Find classification for this item
      // Priority: logicalItemId match, then _itemId match
      let ir: any = null;
      // Try to find by _itemId in resultByItemId
      if (itemId && resultByItemId[itemId]) {
        ir = resultByItemId[itemId];
      }
      // If not found by itemId, try parentLogicalItemId approach (section-level results)
      if (!ir) {
        // Company-added item: no master anchor, no logicalItemId in analysis
        // These always survive
        rebasedItems.push({ ...item });
        counts.companyOnlyPreserved++;
        continue;
      }

      const compatibility = ir.compatibility;

      if (compatibility === COMPATIBILITY.SAFE) {
        // Preserve company override as-is on target
        rebasedItems.push({ ...item });
        counts.safeApplied++;

      } else if (compatibility === COMPATIBILITY.NO_OP) {
        // Override value matches master target anyway — preserve
        rebasedItems.push({ ...item });
        counts.noOpPreserved++;

      } else if (compatibility === COMPATIBILITY.ORPHANED) {
        // Master removed this item. Never delete — preserve orphan in override.
        rebasedItems.push({ ...item });
        counts.orphanedPreserved++;

      } else if (compatibility === COMPATIBILITY.REVIEW_REQUIRED) {
        // Decision required
        const decisionKey = ir.logicalItemId || itemId;
        const decision = reviewDecisions[decisionKey];

        if (decision === 'KEEP_COMPANY') {
          rebasedItems.push({ ...item });
          counts.reviewDecisionsKept++;
        } else if (decision === 'USE_NEW_MASTER') {
          // Drop from override — target master value will be used by resolveJob
          counts.reviewDecisionsAccepted++;
        } else {
          // No decision provided (was validated above, so this shouldn't happen)
          // Defensive: preserve to avoid data loss
          rebasedItems.push({ ...item });
          counts.orphanedPreserved++;
        }

      } else {
        // Unknown compatibility — preserve defensively
        rebasedItems.push({ ...item });
        counts.companyOnlyPreserved++;
      }
    }

    if (rebasedItems.length > 0) {
      rebasedSectionOverrides[st] = rebasedItems;
    }
  }

  // Handle metadata overrides (title, shortDescription)
  // These are tracked by metadata itemResults
  let rebasedTitle: string | null = null;
  let rebasedDesc: string | null = null;

  const metaResults = itemResults.filter((r: any) => r.itemType === 'metadata_field');
  for (const mr of metaResults) {
    const fieldPath = mr.logicalItemId?.replace('metadata_', '') || '';

    if (fieldPath === 'title' || fieldPath.startsWith('title')) {
      const compat = mr.compatibility;
      if (compat === COMPATIBILITY.SAFE || compat === COMPATIBILITY.NO_OP) {
        if (existingOverrideData?.title) {
          rebasedTitle = existingOverrideData.title;
          counts.safeApplied++;
        }
      } else if (compat === COMPATIBILITY.REVIEW_REQUIRED) {
        const decisionKey = mr.logicalItemId || 'metadata_title';
        const decision = reviewDecisions[decisionKey];
        if (decision === 'KEEP_COMPANY' && existingOverrideData?.title) {
          rebasedTitle = existingOverrideData.title;
          counts.reviewDecisionsKept++;
        } else if (decision === 'USE_NEW_MASTER') {
          counts.reviewDecisionsAccepted++;
        }
      }
    } else if (fieldPath === 'shortDescription' || fieldPath.startsWith('shortDescription')) {
      const compat = mr.compatibility;
      if (compat === COMPATIBILITY.SAFE || compat === COMPATIBILITY.NO_OP) {
        if (existingOverrideData?.shortDescription) {
          rebasedDesc = existingOverrideData.shortDescription;
          counts.safeApplied++;
        }
      } else if (compat === COMPATIBILITY.REVIEW_REQUIRED) {
        const decisionKey = mr.logicalItemId || 'metadata_shortDescription';
        const decision = reviewDecisions[decisionKey];
        if (decision === 'KEEP_COMPANY' && existingOverrideData?.shortDescription) {
          rebasedDesc = existingOverrideData.shortDescription;
          counts.reviewDecisionsKept++;
        } else if (decision === 'USE_NEW_MASTER') {
          counts.reviewDecisionsAccepted++;
        }
      }
    }
  }

  // Fallback: if no metadata itemResult was found for title/desc, preserve existing overrides
  // (these overrides were either SAFE or had no master change — preserve them)
  if (!rebasedTitle && existingOverrideData?.title) {
    const hasTitleResult = metaResults.some((r: any) => (r.logicalItemId || '').includes('title'));
    if (!hasTitleResult) {
      rebasedTitle = existingOverrideData.title;
      counts.companyOnlyPreserved++;
    }
  }
  if (!rebasedDesc && existingOverrideData?.shortDescription) {
    const hasDescResult = metaResults.some((r: any) => (r.logicalItemId || '').includes('shortDescription'));
    if (!hasDescResult) {
      rebasedDesc = existingOverrideData.shortDescription;
      counts.companyOnlyPreserved++;
    }
  }

  // Assemble final override data
  const rebasedOverrideData: any = {};
  if (rebasedTitle) rebasedOverrideData.title = rebasedTitle;
  if (rebasedDesc) rebasedOverrideData.shortDescription = rebasedDesc;
  if (Object.keys(rebasedSectionOverrides).length > 0) {
    rebasedOverrideData.sectionOverrides = rebasedSectionOverrides;
  }

  const isEmpty = Object.keys(rebasedOverrideData).length === 0;
  return {
    rebasedOverrideData: isEmpty ? null : rebasedOverrideData,
    adoptionSummaryPartial: counts,
  };
}

// ── Internal: compute customizedFields from override data ─────────────────────
function _computeCustomizedFields(overrideData: any): string[] {
  const fields: string[] = [];
  if (overrideData?.title) fields.push('title');
  if (overrideData?.shortDescription) fields.push('shortDescription');
  for (const st of Object.keys(overrideData?.sectionOverrides || {})) {
    fields.push(`section:${st}`);
  }
  return fields;
}

// ── Internal: summary from analysis counts (idempotent return) ────────────────
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

// ── Internal: resolve job for response ────────────────────────────────────────
async function _resolveJobForResponse(job: any, SR: any, membership: any): Promise<any> {
  const isCompanyAdmin = membership.role === 'general_manager' || membership.role === 'project_manager';
  const capabilities = {
    canEditContent: false, canCreateContent: false, canDeleteContent: false,
    canReorderContent: false, canChangeSectionStatus: false, canEditJobMetadata: false,
    canCustomize: isCompanyAdmin,
  };

  const version = await SR.entities.EssentialSOPVersion.get(job.sourceVersionId).catch(() => null);
  if (!version || version.status !== 'published') {
    return { job, sections: [], contentBySection: {}, capabilities, override: null };
  }

  const masterSections = await SR.entities.EssentialSOPSection.filter(
    { masterId: job.sourceMasterId, versionId: job.sourceVersionId }, 'sortOrder', 10
  ).catch(() => []) || [];

  const overrides = await SR.entities.JobOverride.filter({ companyId: job.companyId, jobId: job.id }).catch(() => []);
  const override: any = overrides?.[0] || null;

  let sanitizedOverrideData: any = null;
  if (override?.overrideData) {
    const { sanitized } = sanitizeStoredOverride(override.overrideData, job.id);
    sanitizedOverrideData = sanitized;
  }

  const sections = SECTION_ORDER.map((st, i) => {
    const ms = (masterSections || []).find((s: any) => s.sectionType === st);
    if (!ms) return null;
    return { id: ms.id, jobId: job.id, companyId: job.companyId, sectionType: st, title: SECTION_TITLES[st] || st, sortOrder: i, completionStatus: 'Empty' };
  }).filter(Boolean);

  const contentBySection: Record<string, any[]> = {};
  for (const ms of masterSections) {
    const st = ms.sectionType;
    if (!st || !(VALID_SECTION_TYPES as Set<string>).has(st)) continue;
    const sectionOverride = sanitizedOverrideData?.sectionOverrides?.[st] || null;
    const sourceItems = sectionOverride || ms.contentItems || [];
    const isOv = !!sectionOverride;
    contentBySection[st] = (sourceItems as any[]).map((item: any, idx: number) => ({
      id: item._itemId || (isOv ? `o_${ms.id}_${idx}` : `m_${ms.id}_${idx}`),
      jobId: job.id, companyId: job.companyId, sectionId: ms.id, sectionType: st,
      contentType: item.contentType || 'text',
      title: typeof item.title === 'string' ? item.title : '',
      body: typeof item.body === 'string' ? item.body : '',
      sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : idx,
      isRequired: typeof item.isRequired === 'boolean' ? item.isRequired : false,
      isCritical: typeof item.isCritical === 'boolean' ? item.isCritical : false,
      metadata: (item.metadata && typeof item.metadata === 'object') ? item.metadata : {},
    })).sort((a: any, b: any) => a.sortOrder - b.sortOrder);
  }

  const resolvedTitle = sanitizedOverrideData?.title || job.title;
  const resolvedShortDescription = sanitizedOverrideData?.shortDescription || job.shortDescription;
  const { sourceMasterId: _sm, sourceVersionId: _sv, sourceType: _st, isCustomized: _ic,
          customizedAt: _ca, customizedBy: _cb, ...publicJobFields } = job;

  return {
    job: { ...publicJobFields, title: resolvedTitle, shortDescription: resolvedShortDescription },
    sections, contentBySection, capabilities,
    override: override ? { revision: override.revision, customizedFields: override.customizedFields, auditPending: override.auditPending || false } : null,
  };
}