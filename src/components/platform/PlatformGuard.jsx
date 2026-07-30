import React from 'react';
import { usePlatform } from '@/lib/PlatformContext';
import { ShieldAlert } from 'lucide-react';

/**
 * PlatformGuard — Route guard for all /platform/* routes.
 *
 * Authorization: active PlatformMembership(SUPER_ADMIN) required.
 * Independent of CompanyMembership.
 * Shows nothing while platform context is loading — prevents flash of denied state.
 */
export default function PlatformGuard({ children }) {
  const { isPlatformSuperAdmin, loadingPlatform } = usePlatform();

  if (loadingPlatform) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-app-bg">
        <div className="w-8 h-8 border-4 border-app-border border-t-app-accent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isPlatformSuperAdmin) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-app-bg p-6">
        <div className="text-center max-w-xs">
          <ShieldAlert size={36} className="text-app-danger mx-auto mb-3" />
          <h2 className="text-lg font-bold text-app-text mb-2">Platform Access Required</h2>
          <p className="text-sm text-app-text-2">
            This area requires an active Essential SOP Platform Super Admin membership.
            Company administrator access does not grant platform access.
          </p>
        </div>
      </div>
    );
  }

  return children;
}