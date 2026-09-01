/**
 * PullToRefresh — lightweight, dependency-free pull-to-refresh for list screens
 * that use the window/document scroll (the app's global scroll model).
 *
 * Safety guarantees:
 *  - Only activates when the document is scrolled to the top (window.scrollY <= 0)
 *    AND the touch is moving downward — horizontal gestures & normal scrolling
 *    are left entirely to the browser.
 *  - Never activates while an input/textarea/contenteditable is focused (so it
 *    can never interfere with forms, the Master SOP editor, the AI prompt, or
 *    publishing notes).
 *  - Disabled via the `disabled` prop whenever a modal/sheet/editor interaction
 *    is open on the host screen (caller passes this).
 *  - `onRefresh` is a read-only re-fetch; it must NOT perform mutations, and the
 *    host screens only pass read-only fetchers (e.g. resolveJobsForCompany).
 *  - Shows a clear, top-anchored spinner with safe-area offset while refreshing.
 *
 * Native iOS rubber-band is separately suppressed app-wide via
 * `overscroll-behavior-y: none` (see index.css), so this measures touches
 * cleanly at the document top without competing with the bounce.
 */
import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

const PULL_RESISTANCE = 0.5;
const MAX_PULL = 90;
const THRESHOLD = 60;
const REFRESH_OFFSET = 28;

export default function PullToRefresh({ onRefresh, disabled, threshold = THRESHOLD }) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startYRef = useRef(null);
  const pullRef = useRef(0);
  const pullingRef = useRef(false);

  useEffect(() => {
    const reset = () => {
      pullingRef.current = false;
      startYRef.current = null;
      pullRef.current = 0;
      setPull(0);
    };

    if (disabled || refreshing) {
      reset();
    }

    const isEditing = () => {
      const ae = document.activeElement;
      return !!ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
    };

    const onStart = (e) => {
      if (disabled || refreshing || isEditing()) { startYRef.current = null; return; }
      if (window.scrollY > 0) { startYRef.current = null; return; }
      startYRef.current = e.touches[0]?.clientY ?? null;
    };

    const onMove = (e) => {
      if (startYRef.current == null || disabled || refreshing) return;
      const y = e.touches[0]?.clientY;
      if (y == null) return;
      const dy = y - startYRef.current;
      if (window.scrollY <= 0 && dy > 0) {
        pullingRef.current = true;
        const p = Math.min(dy * PULL_RESISTANCE, MAX_PULL);
        pullRef.current = p;
        setPull(p);
      }
    };

    const onEnd = async () => {
      if (startYRef.current == null) return;
      startYRef.current = null;
      if (!pullingRef.current) return;
      pullingRef.current = false;
      const reached = pullRef.current >= threshold;
      pullRef.current = 0;
      setPull(0);
      if (reached) {
        setRefreshing(true);
        try {
          await onRefresh?.();
        } catch (_) {
          // refresh is best-effort; never surface a hard error for pull-to-refresh
        } finally {
          setRefreshing(false);
        }
      }
    };

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    window.addEventListener('touchcancel', onEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, [disabled, refreshing, onRefresh, threshold]);

  const show = pull > 0 || refreshing;
  if (!show) return null;
  const offset = refreshing ? REFRESH_OFFSET : pull;

  return (
    <div
      className="fixed left-0 right-0 z-[60] flex justify-center pointer-events-none"
      style={{ top: `calc(env(safe-area-inset-top) + ${offset}px)` }}
    >
      <div className={`p-2 rounded-full bg-app-surface border border-app-border shadow-sm ${refreshing ? 'animate-pulse' : ''}`}>
        <RefreshCw size={22} className={refreshing ? 'text-app-accent animate-spin' : 'text-app-text-muted'} />
      </div>
    </div>
  );
}