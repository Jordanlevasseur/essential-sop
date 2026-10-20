import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * useSafeBack — Reliable back navigation that never exits the app.
 *
 * The authoritative signal for "is there a previous in-app entry to go back to"
 * is the router-managed history index stored at `window.history.state.idx`
 * (see @remix-run/router's createBrowserHistory, used by react-router-dom v6):
 *   - push    → idx = idx + 1   (a new previous in-app entry is created)
 *   - replace → idx = idx       (unchanged — NO new previous entry is created)
 *   - cold / reload → idx read from persisted history.state, defaulting to 0
 *
 * Only `idx > 0` guarantees a previous in-app entry that navigate(-1) can
 * safely return to. We intentionally do NOT use `location.key !== 'default'`:
 * a REPLACE navigation generates a fresh key without advancing the index, so
 * after a replace `navigate(-1)` could fall off the start of the in-app stack
 * and exit the app. `window.history.length` is also unreliable (it can include
 * an external referrer and does not prove a valid in-app previous route).
 *
 * - In-app entry with a real previous entry (idx > 0) → navigate(-1) preserves
 *   normal back behavior.
 * - Cold deep link, direct entry, or replace-at-stack-root (idx === 0) →
 *   navigate(fallback, { replace: true }) so the user is never stranded or
 *   sent to an unrelated external website.
 *
 * Fallback destinations must be top-level tabs (no Back button) or pages whose
 * own Back navigation is deterministic (e.g. JobDetail → '/'), so a replaced
 * cold entry never creates a back path that exits the app. Every fallback still
 * passes through the app's normal auth/company/role gates.
 *
 * Browser-native back gestures use the browser history stack and are unaffected.
 */
export function useSafeBack(fallback) {
  const navigate = useNavigate();
  return useCallback(() => {
    const state = window.history.state;
    const idx = state && typeof state.idx === 'number' ? state.idx : 0;
    if (idx > 0) {
      navigate(-1);
    } else {
      navigate(fallback, { replace: true });
    }
  }, [navigate, fallback]);
}