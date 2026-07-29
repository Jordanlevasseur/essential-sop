import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { ShieldAlert } from 'lucide-react';

/**
 * PlatformSuperAdminGuard — Route guard for Essential SOP platform admin pages.
 *
 * Authorization: verifies the caller holds an active PlatformMembership
 * with platformRole SUPER_ADMIN. This is independent of CompanyContext —
 * a Platform Super Admin reaches platform routes even with no CompanyMembership.
 *
 * Does NOT use User.role as the authorization signal.
 * Does NOT grant access based on CompanyMembership or isGeneralManager.
 */
export default function PlatformSuperAdminGuard({ children }) {
  const [status, setStatus] = useState('loading'); // 'loading' | 'allowed' | 'denied'

  useEffect(() => {
    (async () => {
      try {
        const user = await base44.auth.me().catch(() => null);
        if (!user) { setStatus('denied'); return; }

        // Read own PlatformMembership records — RLS scopes to userId === current user
        const memberships = await base44.entities.PlatformMembership.filter({
          userId: user.id,
          status: 'ACTIVE',
        }).catch(() => []);

        const hasActiveMembership = (memberships || []).some(
          m => m.platformRole === 'SUPER_ADMIN' && m.status === 'ACTIVE'
        );

        setStatus(hasActiveMembership ? 'allowed' : 'denied');
      } catch {
        setStatus('denied');
      }
    })();
  }, []);

  if (status === 'loading') {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-app-bg">
        <div className="w-8 h-8 border-4 border-app-border border-t-app-accent rounded-full animate-spin" />
      </div>
    );
  }

  if (status === 'denied') {
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