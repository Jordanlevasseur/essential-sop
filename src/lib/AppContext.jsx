import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { ensureSeeded } from './seedData';
import { useCompany } from '@/lib/CompanyContext';
import { usePlatform } from '@/lib/PlatformContext';

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

const DEFAULT_PREFS = { textSize: 'medium', darkMode: false, defaultSort: 'updated' };

// ── Company capability builder ────────────────────────────────────────────────
function buildCompanyCapabilities(membership) {
  const role = membership?.status === 'active' ? (membership?.role || '') : '';
  const isAdmin = role === 'general_manager' || role === 'project_manager';
  const isLead  = role === 'project_lead';
  return {
    canAccessCompany:        !!role,
    canManageCompany:        role === 'general_manager',
    canManageCompanyMembers: role === 'general_manager',
    canCustomizeCompanyJobs: isAdmin,
    canRestoreCompanyJobs:   isAdmin,
    canDecideMasterUpdates:  isAdmin,
    canViewActivityHistory:  isAdmin,
    canRequestEdits:         isAdmin || isLead,
  };
}

export function AppProvider({ children }) {
  const { activeCompany, activeMembership, isGeneralManager, hasCompany } = useCompany();
  const { isPlatformSuperAdmin, platformCapabilities } = usePlatform();
  const companyId = activeCompany?.id;

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
    // Real user info comes from base44.auth.me() — this is just the display profile
    return { name: 'Field User', role: 'Field Technician', company: activeCompany?.name || '', avatar: '' };
  });

  useEffect(() => {
    if (!companyId) {
      setIsReady(true);
      return;
    }

    // Clear stale localStorage IDs whenever companyId changes
    localStorage.removeItem(STORAGE_KEYS.recent);
    localStorage.removeItem(STORAGE_KEYS.favorites);
    localStorage.removeItem('esop_fav_init');
    setFavorites([]);
    setRecentlyViewed([]);

    ensureSeeded(companyId)
      .then(async () => {
        try {
          const jobs = await base44.entities.Job.filter({ companyId }, '-updated_date', 200);
          const defaultFavTitles = ['Water Heater Replacement', 'Exterior Door Replacement', 'Crawlspace Inspection'];
          const favIds = (jobs || []).filter(j => defaultFavTitles.includes(j.title)).map(j => j.id);
          if (favIds.length > 0) {
            setFavorites(favIds);
            setFavoritesInitialized(true);
            localStorage.setItem('esop_fav_init', '1');
          }
        } catch {}
        setIsReady(true);
      })
      .catch((err) => { setSeedError(err?.message || 'Failed to initialize'); setIsReady(true); });
  }, [companyId]);

  // technicianViewMode: presentation-only toggle for prototype testing.
  // It does NOT grant any backend permissions or change authorization.
  // Renamed from 'admin'/'technician' modes to avoid implying role authority.

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

  // ── Explicit, separate capability sets ────────────────────────────────────
  // Company capabilities derived from CompanyMembership only.
  const companyCapabilities = buildCompanyCapabilities(activeMembership);

  // isCompanyAdmin: true only when the active company membership is GM or PM.
  // Never combines with platform authority.
  const isCompanyAdmin = isGeneralManager || activeMembership?.role === 'project_manager';

  // technicianViewMode: presentation-only toggle for prototype UI testing.
  // Does NOT grant any backend permissions. Renamed to clarify it is not a role switch.
  const technicianViewMode = userMode === 'technician';

  // DEPRECATED: isAdmin kept temporarily for backward compatibility with
  // existing company UI components that check it. It maps to company-admin
  // status only — never to platform authority.
  // TODO: Remove in a subsequent edit by updating all consuming components.
  const isAdmin = isCompanyAdmin;

  return (
    <AppContext.Provider value={{
      isReady, seedError, userMode, switchMode,
      // Company authority (explicit)
      isCompanyAdmin,
      companyCapabilities,
      // Platform authority (explicit) — sourced from PlatformContext
      isPlatformSuperAdmin,
      platformCapabilities,
      // Prototype presentation mode — NOT an authorization signal
      technicianViewMode,
      // Legacy alias — company-admin only, never platform. Kept for existing UI compatibility.
      isAdmin,
      isGeneralManager,
      favorites, toggleFavorite, isFavorite,
      recentlyViewed, addRecentlyViewed,
      preferences, updatePreferences, textSizeClass,
      session, setSessionItem, clearSessionForJob,
      user,
      companyId,
      hasCompany,
    }}>
      {children}
    </AppContext.Provider>
  );
}