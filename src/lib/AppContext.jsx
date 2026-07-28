import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { ensureSeeded } from './seedData';

const AppContext = createContext();
export const useApp = () => useContext(AppContext);

const STORAGE_KEYS = {
  mode: 'esop_mode',
  favorites: 'esop_favorites',
  recent: 'esop_recent',
  prefs: 'esop_prefs',
  session: 'esop_session',
  user: 'esop_user',
};

const DEFAULT_USER = {
  name: 'Mike Donovan',
  role: 'Field Technician',
  company: 'Summit Residential Builders',
  avatar: '',
};

const DEFAULT_PREFS = { textSize: 'medium', darkMode: false, defaultSort: 'updated' };

export function AppProvider({ children }) {
  const [isReady, setIsReady] = useState(false);
  const [seedError, setSeedError] = useState(null);
  const [userMode, setUserMode] = useState(() => localStorage.getItem(STORAGE_KEYS.mode) || 'technician');
  const [favorites, setFavorites] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.favorites) || '[]'); } catch { return []; }
  });
  const [favoritesInitialized, setFavoritesInitialized] = useState(() => localStorage.getItem('esop_fav_init') === '1');
  const [recentlyViewed, setRecentlyViewed] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.recent) || '[]'); } catch { return []; }
  });
  const [preferences, setPreferences] = useState(() => {
    try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(STORAGE_KEYS.prefs) || '{}') }; } catch { return DEFAULT_PREFS; }
  });
  const [session, setSession] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.session) || '{}'); } catch { return {}; }
  });
  const [user] = useState(() => {
    try { return { ...DEFAULT_USER, ...JSON.parse(localStorage.getItem(STORAGE_KEYS.user) || '{}') }; } catch { return DEFAULT_USER; }
  });

  useEffect(() => {
    ensureSeeded()
      .then(async () => {
        if (!favoritesInitialized) {
          try {
            const jobs = await base44.entities.Job.list();
            const defaultFavTitles = ['Water Heater Replacement', 'Exterior Door Replacement', 'Crawlspace Inspection'];
            const favIds = (jobs || []).filter(j => defaultFavTitles.includes(j.title)).map(j => j.id);
            if (favIds.length > 0) {
              setFavorites(favIds);
              localStorage.setItem('esop_fav_init', '1');
            }
          } catch {}
          setFavoritesInitialized(true);
        }
        setIsReady(true);
      })
      .catch((err) => { setSeedError(err?.message || 'Failed to initialize'); setIsReady(true); });
  }, []);

  useEffect(() => { localStorage.setItem(STORAGE_KEYS.mode, userMode); }, [userMode]);
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.favorites, JSON.stringify(favorites)); }, [favorites]);
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.recent, JSON.stringify(recentlyViewed)); }, [recentlyViewed]);
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.prefs, JSON.stringify(preferences)); }, [preferences]);
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(session)); }, [session]);

  const toggleFavorite = useCallback((jobId) => {
    setFavorites(prev => prev.includes(jobId) ? prev.filter(id => id !== jobId) : [...prev, jobId]);
  }, []);

  const isFavorite = useCallback((jobId) => favorites.includes(jobId), [favorites]);

  const addRecentlyViewed = useCallback((jobId, jobTitle) => {
    setRecentlyViewed(prev => {
      const filtered = prev.filter(r => r.jobId !== jobId);
      return [{ jobId, jobTitle, viewedAt: Date.now() }, ...filtered].slice(0, 10);
    });
  }, []);

  const setSessionItem = useCallback((key, value) => {
    setSession(prev => {
      const next = value === undefined ? (() => { const c = { ...prev }; delete c[key]; return c; })() : { ...prev, [key]: value };
      return next;
    });
  }, []);

  const clearSessionForJob = useCallback((jobId) => {
    setSession(prev => {
      const next = {};
      for (const [k, v] of Object.entries(prev)) {
        if (!k.startsWith(jobId + '_')) next[k] = v;
      }
      return next;
    });
  }, []);

  const switchMode = useCallback((mode) => setUserMode(mode), []);
  const updatePreferences = useCallback((updates) => setPreferences(prev => ({ ...prev, ...updates })), []);

  const textSizeClass = preferences.textSize === 'small' ? 'text-sm' : preferences.textSize === 'large' ? 'text-lg' : 'text-base';

  return (
    <AppContext.Provider value={{
      isReady, seedError, userMode, switchMode, isAdmin: userMode === 'admin',
      favorites, toggleFavorite, isFavorite,
      recentlyViewed, addRecentlyViewed,
      preferences, updatePreferences, textSizeClass,
      session, setSessionItem, clearSessionForJob,
      user,
    }}>
      {children}
    </AppContext.Provider>
  );
}