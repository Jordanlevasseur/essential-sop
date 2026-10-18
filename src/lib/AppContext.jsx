import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { ensureSeeded } from './seedData';
import { useCompany } from '@/lib/CompanyContext';
import { usePlatform } from '@/lib/PlatformContext';
import { useCompanySync } from '@/lib/useCompanySync';
import { migrateSort } from '@/lib/jobsSort';

const AppContext = createContext();
export const useApp = () => useContext(AppContext);

const STORAGE_KEYS = {
  mode: 'esop_mode',
  recent: 'esop_recent',
  prefs: 'esop_prefs',
  session: 'esop_session',
  user: 'esop_user',
};

const DEFAULT_PREFS = { textSize: 'medium', darkMode: false, defaultSort: 'name_az', jobsCategory: '', mastersCategory: '', mastersSort: '' };

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
  const [recentlyViewed, setRecentlyViewed] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.recent) || '[]'); } catch { return []; }
  });
  const [preferences, setPreferences] = useState(() => {
    try {
      const merged = { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(STORAGE_KEYS.prefs) || '{}') };
      merged.defaultSort = migrateSort(merged.defaultSort);
      return merged;
    } catch { return DEFAULT_PREFS; }
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
    setRecentlyViewed([]);

    ensureSeeded(companyId)
      .then(() => { setIsReady(true); })
      .catch((err) => { setSeedError(err?.message || 'Failed to initialize'); setIsReady(true); });
  }, [companyId]);

  // technicianViewMode: presentation-only toggle for prototype testing.
  // It does NOT grant any backend permissions or change authorization.
  // Renamed from 'admin'/'technician' modes to avoid implying role authority.

  useEffect(() => { localStorage.setItem(STORAGE_KEYS.mode, userMode); }, [userMode]);
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.recent, JSON.stringify(recentlyViewed)); }, [recentlyViewed]);
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.prefs, JSON.stringify(preferences)); }, [preferences]);
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(session)); }, [session]);

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

  // ── Automatic Company Library Sync ────────────────────────────────────────
  const { syncing: librarySyncing, syncRecord, syncError: librarySyncError, triggerSync } = useCompanySync(companyId, hasCompany, isCompanyAdmin);

  // technicianViewMode: presentation-only toggle for prototype UI testing.
  // Does NOT grant any backend permissions. Renamed to clarify it is not a role switch.
  const technicianViewMode = userMode === 'technician';

  return (
    <AppContext.Provider value={{
      isReady, seedError, userMode, switchMode,
      // Company authority (explicit) — derived from CompanyMembership only
      isCompanyAdmin,
      companyCapabilities,
      // Platform authority (explicit) — sourced from PlatformContext, independent of company
      isPlatformSuperAdmin,
      platformCapabilities,
      // Prototype presentation mode — NOT an authorization signal
      technicianViewMode,
      isGeneralManager,
      recentlyViewed, addRecentlyViewed,
      preferences, updatePreferences, textSizeClass,
      session, setSessionItem, clearSessionForJob,
      user,
      companyId,
      hasCompany,
      // Library sync
      librarySyncing, syncRecord, librarySyncError, triggerSync,
    }}>
      {children}
    </AppContext.Provider>
  );
}