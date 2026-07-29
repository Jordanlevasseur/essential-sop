/**
 * PlatformContext — Essential SOP platform authority context.
 *
 * Loads the current user's PlatformMembership independently of CompanyContext.
 * Platform authority and company authority are completely independent domains.
 *
 * INVARIANTS:
 * - isPlatformSuperAdmin is true only when an active PlatformMembership(SUPER_ADMIN) exists.
 * - This context does NOT check User.role, isGeneralManager, or any company state.
 * - Platform authority never grants company authority and vice versa.
 * - A Platform Super Admin without CompanyMembership gets isPlatformSuperAdmin=true
 *   and a full platformCapabilities set, regardless of hasCompany.
 */
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';

const PlatformContext = createContext();
export const usePlatform = () => useContext(PlatformContext);

const EMPTY_PLATFORM_CAPABILITIES = {
  canAccessPlatformAdmin:  false,
  canManageMasterLibrary:  false,
  canPublishMasterSOP:     false,
  canManageCompanies:      false,
  canManagePlatformUsers:  false,
  canTriggerProvisioning:  false,
  canWritePlatformAudit:   false,
};

function buildPlatformCapabilities(membership) {
  const active = membership?.status === 'ACTIVE' && membership?.platformRole === 'SUPER_ADMIN';
  return {
    canAccessPlatformAdmin:  active,
    canManageMasterLibrary:  active,
    canPublishMasterSOP:     active,
    canManageCompanies:      active,
    canManagePlatformUsers:  active,
    canTriggerProvisioning:  active,
    canWritePlatformAudit:   active,
  };
}

export function PlatformProvider({ children }) {
  const [platformMembership, setPlatformMembership] = useState(null);
  const [platformCapabilities, setPlatformCapabilities] = useState(EMPTY_PLATFORM_CAPABILITIES);
  const [isPlatformSuperAdmin, setIsPlatformSuperAdmin] = useState(false);
  const [loadingPlatform, setLoadingPlatform] = useState(true);

  const loadPlatformContext = useCallback(async () => {
    setLoadingPlatform(true);
    try {
      const user = await base44.auth.me().catch(() => null);
      if (!user) {
        setPlatformMembership(null);
        setPlatformCapabilities(EMPTY_PLATFORM_CAPABILITIES);
        setIsPlatformSuperAdmin(false);
        setLoadingPlatform(false);
        return;
      }

      // RLS-scoped read: only returns records where userId === current user
      const memberships = await base44.entities.PlatformMembership.filter({
        userId: user.id,
        status: 'ACTIVE',
      }).catch(() => []);

      const activeMembership = (memberships || []).find(
        m => m.platformRole === 'SUPER_ADMIN' && m.status === 'ACTIVE'
      ) || null;

      setPlatformMembership(activeMembership);
      setPlatformCapabilities(buildPlatformCapabilities(activeMembership));
      setIsPlatformSuperAdmin(!!activeMembership);
    } catch {
      setPlatformMembership(null);
      setPlatformCapabilities(EMPTY_PLATFORM_CAPABILITIES);
      setIsPlatformSuperAdmin(false);
    }
    setLoadingPlatform(false);
  }, []);

  useEffect(() => { loadPlatformContext(); }, [loadPlatformContext]);

  return (
    <PlatformContext.Provider value={{
      platformMembership,
      platformCapabilities,
      isPlatformSuperAdmin,
      loadingPlatform,
      refreshPlatformContext: loadPlatformContext,
    }}>
      {children}
    </PlatformContext.Provider>
  );
}