import { useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

/**
 * useSafeBack — Reliable back navigation that never exits the app.
 *
 * Detects whether the current page was reached through in-app navigation by
 * reading React Router's location.key. The initial / cold entry always has
 * key === 'default'; every subsequent in-app navigation produces a unique key.
 * window.history.length is intentionally NOT used — it can include an external
 * referrer and does not prove a valid in-app previous route exists.
 *
 * - In-app entry (key !== 'default') → navigate(-1) preserves normal back behavior.
 * - Cold deep link / direct entry (key === 'default') → navigate(fallback, { replace: true })
 *   so the user is never stranded or sent to an unrelated external website.
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
  const location = useLocation();
  return useCallback(() => {
    if (location.key && location.key !== 'default') {
      navigate(-1);
    } else {
      navigate(fallback, { replace: true });
    }
  }, [navigate, location.key, fallback]);
}