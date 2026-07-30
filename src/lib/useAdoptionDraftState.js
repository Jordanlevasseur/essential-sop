/**
 * useAdoptionDraftState — v4.2 RC1 Patch: Full user-scoped isolation
 *
 * ── STORAGE KEY ────────────────────────────────────────────────────────────────
 * Key: `adoption_draft_{companyId}_{jobId}_{userId}`
 *
 * All three dimensions are required to prevent:
 *   - Cross-user leakage on a shared device (userId scope)
 *   - Cross-company collisions (companyId scope)
 *   - Cross-job collisions (jobId scope)
 *
 * ── PAYLOAD FIELDS ─────────────────────────────────────────────────────────────
 * Every written draft includes: userId, companyId, jobId, schemaVersion, updatedAt.
 * On read, ALL THREE identity fields must match exactly — fail-closed on any mismatch.
 *
 * ── LEGACY KEY MIGRATION ───────────────────────────────────────────────────────
 * Legacy keys `adoption_draft_{companyId}_{jobId}` (without userId) are NOT restored.
 * Authorship cannot be reliably proven from legacy entries.
 * Legacy keys are silently removed when encountered to prevent stale data accumulation.
 *
 * ── STALE DETECTION ────────────────────────────────────────────────────────────
 * Drafts are discarded when targetVersionId changes (new update superseded old).
 *
 * ── AUTHORITY ──────────────────────────────────────────────────────────────────
 * localStorage is a CLIENT CONVENIENCE CACHE only.
 * The authoritative recovery source is pendingAnalysisId on the JobOverride entity.
 * Recovery MUST read from the server first. localStorage is a fallback, not the source.
 *
 * ── SCHEMA VERSION ─────────────────────────────────────────────────────────────
 * CURRENT_SCHEMA_VERSION = '2' (v1 = no userId in key or payload; v2 = user-scoped)
 * A draft with a different schemaVersion is rejected and removed.
 */

import { useState, useCallback } from 'react';

const CURRENT_SCHEMA_VERSION = '2';

/** New user-scoped key */
function storageKey(companyId, jobId, userId) {
  return `adoption_draft_${companyId}_${jobId}_${userId}`;
}

/** Legacy key (without userId) — used only to detect and purge old entries */
function legacyStorageKey(companyId, jobId) {
  return `adoption_draft_${companyId}_${jobId}`;
}

/**
 * Read and validate a draft. Returns null (fail-closed) on any of:
 *   - Missing or unparseable entry
 *   - userId mismatch
 *   - companyId mismatch
 *   - jobId mismatch
 *   - schemaVersion mismatch
 *   - Any required identity field missing from the stored payload
 */
function readDraft(companyId, jobId, userId) {
  if (!companyId || !jobId || !userId) return null;
  try {
    const raw = localStorage.getItem(storageKey(companyId, jobId, userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);

    // Require all identity fields to be present and match exactly
    if (!parsed.userId || parsed.userId !== userId) return null;
    if (!parsed.companyId || parsed.companyId !== companyId) return null;
    if (!parsed.jobId || parsed.jobId !== jobId) return null;
    if (parsed.schemaVersion !== CURRENT_SCHEMA_VERSION) return null;

    return parsed;
  } catch (_) {
    return null;
  }
}

/**
 * Write a draft with full identity payload.
 */
function writeDraft(companyId, jobId, userId, draft) {
  if (!companyId || !jobId || !userId) return;
  try {
    localStorage.setItem(
      storageKey(companyId, jobId, userId),
      JSON.stringify({
        ...draft,
        userId,
        companyId,
        jobId,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        updatedAt: new Date().toISOString(),
      })
    );
  } catch (_) {}
}

/**
 * Remove the user-scoped draft.
 */
function removeDraft(companyId, jobId, userId) {
  if (!companyId || !jobId || !userId) return;
  try {
    localStorage.removeItem(storageKey(companyId, jobId, userId));
  } catch (_) {}
}

/**
 * Purge any legacy (v1, no-userId) draft for this companyId+jobId.
 * Called on mount — authorship of legacy entries cannot be proven, so they are never restored.
 */
function purgeLegacyDraft(companyId, jobId) {
  if (!companyId || !jobId) return;
  try {
    localStorage.removeItem(legacyStorageKey(companyId, jobId));
  } catch (_) {}
}

const EMPTY_STATE = {
  reviewDecisions: {},
  orphanDispositions: {},
  mutationKey: null,
  analysisId: null,
};

/**
 * @param {string} companyId  — required; part of storage key + validation
 * @param {string} jobId      — required; part of storage key + validation
 * @param {string | null} targetVersionId — used to detect stale drafts
 * @param {string | null} userId — required for user-scoped isolation
 */
export function useAdoptionDraftState(companyId, jobId, targetVersionId, userId) {
  const [state, setState] = useState(() => {
    // Always purge legacy entries on mount — fail-closed, no restoration
    purgeLegacyDraft(companyId, jobId);

    if (!companyId || !jobId || !userId) return EMPTY_STATE;

    const draft = readDraft(companyId, jobId, userId);
    if (!draft) return EMPTY_STATE;

    // Discard draft if it's for a stale targetVersionId
    if (targetVersionId && draft.targetVersionId && draft.targetVersionId !== targetVersionId) {
      removeDraft(companyId, jobId, userId);
      return EMPTY_STATE;
    }

    return {
      reviewDecisions: draft.reviewDecisions || {},
      orphanDispositions: draft.orphanDispositions || {},
      mutationKey: draft.mutationKey || null,
      analysisId: draft.analysisId || null,
    };
  });

  const persist = useCallback((updates) => {
    setState(prev => {
      const next = { ...prev, ...updates };
      writeDraft(companyId, jobId, userId, { ...next, targetVersionId });
      return next;
    });
  }, [companyId, jobId, userId, targetVersionId]);

  const setReviewDecisions = useCallback((decisions) => {
    persist({ reviewDecisions: decisions });
  }, [persist]);

  const setOrphanDispositions = useCallback((dispositions) => {
    persist({ orphanDispositions: dispositions });
  }, [persist]);

  /** Call when adoption starts — locks in mutationKey + analysisId for recovery */
  const persistAdoptionStart = useCallback((mutationKey, analysisId) => {
    persist({ mutationKey, analysisId });
  }, [persist]);

  /** Clear only this user's draft for this job. Does not affect other users. */
  const clearDraft = useCallback(() => {
    removeDraft(companyId, jobId, userId);
    setState(EMPTY_STATE);
  }, [companyId, jobId, userId]);

  const hasDraft = !!(
    Object.keys(state.reviewDecisions).length > 0 ||
    Object.keys(state.orphanDispositions).length > 0 ||
    state.mutationKey
  );

  return {
    reviewDecisions: state.reviewDecisions,
    orphanDispositions: state.orphanDispositions,
    persistedMutationKey: state.mutationKey,
    persistedAnalysisId: state.analysisId,
    setReviewDecisions,
    setOrphanDispositions,
    persistAdoptionStart,
    clearDraft,
    hasDraft,
  };
}