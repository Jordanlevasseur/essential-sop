/**
 * CompanyContext — manages the active company for the authenticated user.
 *
 * Security model:
 *  - Active company is selected ONLY from verified CompanyMembership records
 *    returned by the database for the current user.
 *  - companyId stored in localStorage is used only as a preference hint;
 *    it is always validated against live memberships on load.
 *  - If the stored preference is invalid or the user has no memberships,
 *    the first active membership is used automatically.
 *  - Switching companies clears all company-scoped state.
 */
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';

const CompanyContext = createContext();
export const useCompany = () => useContext(CompanyContext);

const PREF_KEY = 'esop_active_company_id';

export function CompanyProvider({ children }) {
  const [memberships, setMemberships] = useState([]);   // active CompanyMembership records
  const [companies, setCompanies] = useState([]);       // resolved Company records
  const [activeCompany, setActiveCompany] = useState(null);
  const [activeMembership, setActiveMembership] = useState(null);
  const [loadingCompany, setLoadingCompany] = useState(true);
  const [companyError, setCompanyError] = useState(null);

  const loadCompanyContext = useCallback(async () => {
    setLoadingCompany(true);
    setCompanyError(null);
    try {
      const user = await base44.auth.me();
      if (!user) { setLoadingCompany(false); return; }

      // Companies are resolved server-side. The Company entity is RLS-closed
      // to direct client access; resolveUserCompanies derives the caller's
      // companies from their own memberships and strips billing identifiers.
      const resp = await base44.functions.invoke('resolveUserCompanies', {});
      const activeMemberships = (resp.data?.memberships || []).filter(m => m.status === 'active');
      setMemberships(activeMemberships);

      if (activeMemberships.length === 0) {
        // No company yet — user will be prompted to create or join one
        setActiveCompany(null);
        setActiveMembership(null);
        setCompanies([]);
        setLoadingCompany(false);
        return;
      }

      const validCompanies = resp.data?.companies || [];
      setCompanies(validCompanies);

      // Resolve preferred active company
      const storedPref = localStorage.getItem(PREF_KEY);
      const preferredCompany = storedPref
        ? validCompanies.find(c => c.id === storedPref)
        : null;
      const selected = preferredCompany || validCompanies[0] || null;
      const selectedMembership = selected
        ? activeMemberships.find(m => m.companyId === selected.id) || null
        : null;

      setActiveCompany(selected);
      setActiveMembership(selectedMembership);
      if (selected) localStorage.setItem(PREF_KEY, selected.id);
    } catch (err) {
      setCompanyError(err?.message || 'Failed to load company context.');
    }
    setLoadingCompany(false);
  }, []);

  useEffect(() => { loadCompanyContext(); }, [loadCompanyContext]);

  /**
   * Switch the active company. Validates against known memberships.
   * Clears all company-scoped localStorage state on switch.
   */
  const switchCompany = useCallback((companyId) => {
    const target = companies.find(c => c.id === companyId);
    const targetMembership = memberships.find(m => m.companyId === companyId);
    if (!target || !targetMembership) return;

    // Clear company-scoped state keys
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('esop_favorites') || k.startsWith('esop_recent') || k.startsWith('esop_session') || k === 'esop_fav_init')) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));

    localStorage.setItem(PREF_KEY, companyId);
    setActiveCompany(target);
    setActiveMembership(targetMembership);
    // Hard reload to clear all in-memory state safely
    window.location.reload();
  }, [companies, memberships]);

  /**
   * Whether the current user is a General Manager in the active company.
   * GM maps to existing "admin" capabilities.
   */
  const isGeneralManager = activeMembership?.role === 'general_manager';

  /**
   * Refresh company context (e.g. after creating a new company).
   */
  const refreshCompanies = useCallback(() => { loadCompanyContext(); }, [loadCompanyContext]);

  return (
    <CompanyContext.Provider value={{
      activeCompany,
      activeMembership,
      memberships,
      companies,
      loadingCompany,
      companyError,
      switchCompany,
      refreshCompanies,
      isGeneralManager,
      hasCompany: !!activeCompany,
    }}>
      {children}
    </CompanyContext.Provider>
  );
}