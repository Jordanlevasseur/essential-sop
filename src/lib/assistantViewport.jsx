import React, { createContext, useContext, useEffect, useRef, useState } from 'react';

/**
 * AssistantViewport — single authoritative source for the mobile viewport
 * dimensions used to coordinate the Assistant chat surface and the bottom
 * navigation under the iOS soft keyboard.
 *
 * Exposes:
 *   vpHeight     — visualViewport.height (on-screen area excluding the keyboard)
 *   vpOffsetTop  — visualViewport.offsetTop (scroll offset of the visual viewport
 *                  within the layout viewport; >0 when iOS pushes the focused
 *                  field into view)
 *   keyboardOpen — true when vpHeight has dropped meaningfully below the largest
 *                  height observed (keyboard raised)
 *
 * ONE VisualViewport listener powers every consumer, so the Assistant and the
 * Layout never run competing dvh / fixed-height / padding calculations. Falls
 * back to window.innerHeight when the VisualViewport API is unavailable.
 * Listeners are removed on unmount.
 */
const AssistantViewportContext = createContext({
  vpHeight: 0,
  vpOffsetTop: 0,
  keyboardOpen: false,
});

export function useAssistantViewport() {
  return useContext(AssistantViewportContext);
}

const initial = () => {
  if (typeof window === 'undefined') return { height: 800, offsetTop: 0 };
  if (window.visualViewport) {
    return { height: window.visualViewport.height, offsetTop: window.visualViewport.offsetTop };
  }
  return { height: window.innerHeight, offsetTop: 0 };
};

export function AssistantViewportProvider({ children }) {
  const [vp, setVp] = useState(initial);
  const fullHeightRef = useRef(vp.height);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) {
      const onResize = () => setVp(p => ({ ...p, height: window.innerHeight }));
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }
    const update = () => {
      if (vv.height > fullHeightRef.current) fullHeightRef.current = vv.height;
      setVp({ height: vv.height, offsetTop: vv.offsetTop });
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  const keyboardOpen = vp.height < fullHeightRef.current - 120;

  return (
    <AssistantViewportContext.Provider
      value={{ vpHeight: vp.height, vpOffsetTop: vp.offsetTop, keyboardOpen }}
    >
      {children}
    </AssistantViewportContext.Provider>
  );
}