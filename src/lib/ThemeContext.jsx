import React, { createContext, useContext, useEffect, useState } from 'react';

const STORAGE_KEY = 'esop_appearance';
const ThemeContext = createContext();

export function ThemeProvider({ children }) {
  const [appearance, setAppearance] = useState(() => {
    return localStorage.getItem(STORAGE_KEY) || 'system';
  });

  // Resolve actual theme (light or dark) from appearance + system preference
  const getResolved = (app) => {
    if (app === 'dark') return 'dark';
    if (app === 'light') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  };

  const applyTheme = (app) => {
    const resolved = getResolved(app);
    document.documentElement.classList.toggle('dark', resolved === 'dark');
    // Update browser theme-color meta
    const color = resolved === 'dark' ? '#1a1a1a' : '#ffffff';
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.appendChild(meta); }
    meta.content = color;
    // Update color-scheme for native form controls
    document.documentElement.style.colorScheme = resolved;
  };

  useEffect(() => {
    applyTheme(appearance);
    localStorage.setItem(STORAGE_KEY, appearance);

    // Re-apply if system preference changes (for 'system' mode)
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => { if (appearance === 'system') applyTheme('system'); };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [appearance]);

  return (
    <ThemeContext.Provider value={{ appearance, setAppearance }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);

// Inline script to run before React mounts — prevents flash of wrong theme
export const THEME_SCRIPT = `
(function(){
  var a = localStorage.getItem('esop_appearance') || 'system';
  var dark = a === 'dark' || (a === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (dark) document.documentElement.classList.add('dark');
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
})();
`;