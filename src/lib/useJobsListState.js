/**
 * useJobsListState — Persists and restores Jobs list UI state across navigation.
 *
 * State captured before entering Job Detail:
 *   - scrollY of the page scroll container
 *   - search query
 *   - filters (trade)
 *   - sort preference (read from preferences, not stored here)
 *
 * Storage: sessionStorage so state is cleared when the tab is closed or
 * the user navigates to a completely different part of the app.
 *
 * Usage in Jobs.jsx:
 *   const { saveListState, restoreListState } = useJobsListState();
 *   // Before navigate to job detail:
 *   saveListState({ search, filters, scrollY: window.scrollY });
 *   // On Jobs mount / back navigation:
 *   const saved = restoreListState();
 *
 * Usage in JobDetail.jsx / JobLoadError.jsx:
 *   const { navigateBackToJobs } = useJobsListState();
 *   navigateBackToJobs(navigate);  // always navigate('/'); Jobs restores state from sessionStorage
 */

import { useCallback } from 'react';

const SESSION_KEY = 'esop_jobs_list_state';

export function useJobsListState() {
  const saveListState = useCallback((state) => {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        search: state.search ?? '',
        filters: state.filters ?? { trade: '' },
        scrollY: state.scrollY ?? 0,
        savedAt: Date.now(),
      }));
    } catch (_) {
      // sessionStorage unavailable — silently skip
    }
  }, []);

  const restoreListState = useCallback(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // Discard stale state older than 30 minutes
      if (Date.now() - (parsed.savedAt || 0) > 30 * 60 * 1000) {
        sessionStorage.removeItem(SESSION_KEY);
        return null;
      }
      return parsed;
    } catch (_) {
      return null;
    }
  }, []);

  const clearListState = useCallback(() => {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (_) {}
  }, []);

  /**
   * navigateBackToJobs — Deterministic back navigation.
   *
   * Decision is based solely on whether a valid, unexpired esop_jobs_list_state
   * exists in sessionStorage — NOT on window.history.length, which does not prove
   * the previous route was the Jobs page.
   *
   * - Valid state exists  → navigate('/') so Jobs restores search, filters, scroll
   * - No valid state      → navigate('/') with no restoration attempt
   *
   * Either way we always land on '/', which is safe regardless of entry point.
   * Browser-native back gestures continue to use browser history unaffected.
   */
  const navigateBackToJobs = useCallback((navigate) => {
    // Always navigate explicitly to the Jobs route — never rely on history.back().
    // The Jobs page reads sessionStorage on mount and restores state if valid.
    navigate('/');
  }, []);

  return { saveListState, restoreListState, clearListState, navigateBackToJobs };
}