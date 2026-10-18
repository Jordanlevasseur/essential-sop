/**
 * PullToRefresh — natural, content-follows-finger pull-to-refresh for screens
 * that use the document/window scroller (the app's global scroll model).
 *
 * Behaviour:
 *  - Only activates when the document is scrolled to the very top (scrollY<=0)
 *    AND the touch is moving downward. Horizontal gestures and normal downward
 *    page scrolling are left entirely to the browser; once scrollY>0 no pull
 *    starts, so momentum scrolling is never intercepted.
 *  - The wrapped in-flow content is translated downward with the finger
 *    (transform, compositor-only — no layout reflow, no scroll physics). The
 *    refresh indicator is the first child of the wrapper, anchored just ABOVE
 *    the content (translateY(-100%)), so it is revealed in the opened gap and
 *    never overlaps the heading. Sheets/dialogs must be rendered OUTSIDE this
 *    wrapper so their `position: fixed` stays viewport-anchored (a transform on
 *    an ancestor would otherwise capture them).
 *  - Gentle resistance + a max distance; releasing below threshold returns the
 *    content smoothly, releasing at/above threshold runs `onRefresh` while the
 *    content stays pulled just enough to keep the spinner visible, then returns.
 *  - Pull distance resets on touchcancel, navigation (unmount), and failed
 *    refresh. Repeated gestures are blocked while refreshing. Reduced-motion
 *    users get instant repositioning (no transition).
 *
 * `onRefresh` is a read-only re-fetch; it must NOT perform mutations.
 */
import React, { useEffect, useRef, useState, useMemo } from 'react';
import { RefreshCw } from 'lucide-react';

const PULL_RESISTANCE = 0.5;
const MAX_PULL = 90;
const REFRESH_THRESHOLD = 60;
const REFRESH_OFFSET = 44; // how far content stays pulled while refreshing

export default function PullToRefresh({ onRefresh, disabled, threshold = REFRESH_THRESHOLD, children }) {
  const [pull, setPull] = useState(0);
  const [pulling, setPulling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const startYRef = useRef(null);
  const pullingRef = useRef(false);
  const pullRef = useRef(0);

  const reduceMotion = useMemo(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  const offset = refreshing ? REFRESH_OFFSET : pull;
  const transition = pulling || reduceMotion ? 'none' : 'transform 0.25s ease-out';
  const indicatorOpacity = refreshing ? 1 : Math.min(pull / threshold, 1);

  useEffect(() => {
    const cancelPull = () => {
      pullingRef.current = false;
      startYRef.current = null;
      pullRef.current = 0;
      setPulling(false);
      setPull(0);
    };
    if (disabled || refreshing) cancelPull();

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
        setPulling(true);
        const p = Math.min(dy * PULL_RESISTANCE, MAX_PULL);
        pullRef.current = p;
        setPull(p);
      } else if (dy <= 0 && pullingRef.current) {
        pullingRef.current = false;
        pullRef.current = 0;
        setPulling(false);
        setPull(0);
      }
    };

    const onEnd = async () => {
      if (startYRef.current == null) return;
      startYRef.current = null;
      if (!pullingRef.current) return;
      pullingRef.current = false;
      setPulling(false);
      const reached = pullRef.current >= threshold;
      if (reached) {
        setRefreshing(true);
        pullRef.current = 0;
        setPull(0);
        try {
          await onRefresh?.();
        } catch (_) {
          // refresh is best-effort; never surface a hard error for pull-to-refresh
        } finally {
          setRefreshing(false);
        }
      } else {
        pullRef.current = 0;
        setPull(0);
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

  return (
    <div className="relative" style={{ transform: `translateY(${offset}px)`, transition }}>
      {/* Indicator sits just above the content (translateY(-100%)), revealed in
          the gap as the content is pulled down. It never overlaps the heading. */}
      <div
        className="absolute left-0 right-0 top-0 flex justify-center pointer-events-none"
        style={{ transform: 'translateY(-100%)', opacity: indicatorOpacity, transition: pulling || reduceMotion ? 'none' : 'opacity 0.15s ease-out' }}
        aria-hidden={!refreshing && pull < threshold}
      >
        <div className="p-2 rounded-full bg-app-surface border border-app-border shadow-sm">
          <RefreshCw size={22} className={refreshing ? 'text-app-accent animate-spin' : 'text-app-text-muted'} />
        </div>
      </div>
      {children}
    </div>
  );
}