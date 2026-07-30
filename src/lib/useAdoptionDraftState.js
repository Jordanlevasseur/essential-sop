/**
 * useAdoptionDraftState — Edit 5D Hardening
 *
 * Persists version adoption draft state to localStorage so that review decisions,
 * mutationKey, and analysisId survive refresh, navigation, reconnect, and browser crash.
 *
 * Storage key: `adoption_draft_${jobId}`
 *
 * Cleared when:
 *   - adoption succeeds (call clearDraft())
 *   - user explicitly discards (call clearDraft())
 *
 * Never cleared by refresh or navigation.
 */

import { useState, useCallback, useEffect } from 'react';

function storageKey(jobId) {
  return `adoption_draft_${jobId}`;
}

function readDraft(jobId) {
  try {
    const raw = localStorage.getItem(storageKey(jobId));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function writeDraft(jobId, draft) {
  try {
    localStorage.setItem(storageKey(jobId), JSON.stringify(draft));
  } catch (_) {}
}

function removeDraft(jobId) {
  try {
    localStorage.removeItem(storageKey(jobId));
  } catch (_) {}
}

/**
 * @param {string} jobId
 * @param {string} targetVersionId  — used to detect stale drafts (different target = discard)
 * @returns {{
 *   reviewDecisions: Record<string, string>,
 *   orphanDispositions: Record<string, string>,
 *   persistedMutationKey: string | null,
 *   persistedAnalysisId: string | null,
 *   setReviewDecisions: (decisions: Record<string, string>) => void,
 *   setOrphanDispositions: (dispositions: Record<string, string>) => void,
 *   persistAdoptionStart: (mutationKey: string, analysisId: string) => void,
 *   clearDraft: () => void,
 *   hasDraft: boolean,
 * }}
 */
export function useAdoptionDraftState(jobId, targetVersionId) {
  const [state, setState] = useState(() => {
    const draft = readDraft(jobId);
    // Discard draft if it's for a different target version
    if (draft && draft.targetVersionId && draft.targetVersionId !== targetVersionId) {
      removeDraft(jobId);
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
      writeDraft(jobId, { ...next, targetVersionId });
      return next;
    });
  }, [jobId, targetVersionId]);

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
    removeDraft(jobId);
    setState({ reviewDecisions: {}, orphanDispositions: {}, mutationKey: null, analysisId: null });
  }, [jobId]);

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