/**
 * useAdoptionDraftState — Edit 5D Final Correction
 *
 * Persists version adoption draft state to localStorage so that review decisions,
 * mutationKey, and analysisId survive refresh, navigation, reconnect, and browser crash.
 *
 * ── STORAGE KEY ────────────────────────────────────────────────────────────────
 * Key: `adoption_draft_${companyId}_${jobId}`
 *
 * Includes companyId to prevent cross-company stale draft collisions.
 * A draft from company A is never loaded for company B even if the jobId matches.
 *
 * ── STALE DETECTION ────────────────────────────────────────────────────────────
 * Drafts are discarded when targetVersionId changes (new update available).
 * Drafts are discarded when companyId doesn't match.
 *
 * ── AUTHORITY ──────────────────────────────────────────────────────────────────
 * localStorage is a CLIENT CONVENIENCE CACHE only.
 * The authoritative recovery source is pendingAnalysisId on the JobOverride entity.
 * Recovery MUST read from the server first. localStorage is a fallback, not the source.
 *
 * Cleared when:
 *   - adoption succeeds (call clearDraft())
 *   - user explicitly discards (call clearDraft())
 *
 * Never cleared by refresh or navigation.
 */

import { useState, useCallback } from 'react';

function storageKey(companyId, jobId) {
  return `adoption_draft_${companyId}_${jobId}`;
}

function readDraft(companyId, jobId) {
  try {
    const raw = localStorage.getItem(storageKey(companyId, jobId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Guard: reject drafts that somehow have a mismatched companyId
    if (parsed.companyId && parsed.companyId !== companyId) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function writeDraft(companyId, jobId, draft) {
  try {
    localStorage.setItem(storageKey(companyId, jobId), JSON.stringify({ ...draft, companyId, jobId }));
  } catch (_) {}
}

function removeDraft(companyId, jobId) {
  try {
    localStorage.removeItem(storageKey(companyId, jobId));
  } catch (_) {}
}

/**
 * @param {string} companyId  — required; used in storage key + stale check
 * @param {string} jobId
 * @param {string | null} targetVersionId  — used to detect stale drafts; pass null for recovery-only use
 */
export function useAdoptionDraftState(companyId, jobId, targetVersionId) {
  const [state, setState] = useState(() => {
    if (!companyId || !jobId) {
      return { reviewDecisions: {}, orphanDispositions: {}, mutationKey: null, analysisId: null };
    }
    const draft = readDraft(companyId, jobId);
    // Discard draft if it's for a different target version (only when targetVersionId is provided)
    if (draft && targetVersionId && draft.targetVersionId && draft.targetVersionId !== targetVersionId) {
      removeDraft(companyId, jobId);
      return { reviewDecisions: {}, orphanDispositions: {}, mutationKey: null, analysisId: null };
    }
    return {
      reviewDecisions: draft?.reviewDecisions || {},
      orphanDispositions: draft?.orphanDispositions || {},
      mutationKey: draft?.mutationKey || null,
      analysisId: draft?.analysisId || null,
    };
  });

  const persist = useCallback((updates) => {
    setState(prev => {
      const next = { ...prev, ...updates };
      if (companyId && jobId) {
        writeDraft(companyId, jobId, { ...next, targetVersionId });
      }
      return next;
    });
  }, [companyId, jobId, targetVersionId]);

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

  const clearDraft = useCallback(() => {
    if (companyId && jobId) removeDraft(companyId, jobId);
    setState({ reviewDecisions: {}, orphanDispositions: {}, mutationKey: null, analysisId: null });
  }, [companyId, jobId]);

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