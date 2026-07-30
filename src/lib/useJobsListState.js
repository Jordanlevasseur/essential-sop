/**
 * useJobsListState — Persists and restores Jobs list UI state across navigation.
 *
 * State captured before entering Job Detail:
 *   - scrollY of the page scroll container
 *   - search query
 *   - filters (trade, skillLevel, category)
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
 *   navigateBackToJobs(navigate);  // uses history.back() when safe, else navigate('/')
 */

import { useCallback } from 'react';

const SESSION_KEY = 'esop_jobs_list_state';

export function useJobsListState() {
  const saveListState = useCallback((state) => {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        search: state.search ?? '',
        filters: state.filters ?? { trade: '', skillLevel: '', category: '' },
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
   * navigateBackToJobs — Smart back navigation.
   *
   * If the browser history shows the previous entry was the Jobs list
   * (history.length > 1 and we came from within the app), use history.back()
   * so the browser's native scroll restoration can fire.
   * Otherwise, explicitly navigate to '/' as a safe fallback.
   *
   * The Jobs page handles scroll restoration after mount regardless of which
   * path is used.
   */
  const navigateBackToJobs = useCallback((navigate) => {
    // If there is a history entry to go back to, prefer it — this preserves
    // native browser back-gesture consistency and avoids duplicate history entries.
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/');
    }
  }, []);

  return { saveListState, restoreListState, clearListState, navigateBackToJobs };
}