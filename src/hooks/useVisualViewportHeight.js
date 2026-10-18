import { useState, useEffect } from 'react';

/**
 * useVisualViewportHeight — returns the current `visualViewport.height`, i.e.
 * the on-screen area excluding the iOS soft keyboard, falling back to
 * `window.innerHeight` when the VisualViewport API is unavailable.
 *
 * Used to size fixed mobile chat surfaces so the composer reliably rises above
 * the keyboard without relying on `100dvh`, which is inconsistent on iOS Safari.
 * Event listeners are removed on unmount.
 */
export default function useVisualViewportHeight() {
  const [height, setHeight] = useState(() => {
    if (typeof window === 'undefined') return 800;
    return window.visualViewport ? window.visualViewport.height : window.innerHeight;
  });

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) {
      const onResize = () => setHeight(window.innerHeight);
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }
    const update = () => setHeight(vv.height);
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return height;
}