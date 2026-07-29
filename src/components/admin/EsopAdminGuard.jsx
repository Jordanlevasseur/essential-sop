import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { ShieldAlert } from 'lucide-react';

/**
 * Wraps ESOP admin pages. Shows an access-denied screen for any user
 * who is not role='esop_admin' or role='admin'.
 */
export default function EsopAdminGuard({ children }) {
  const [status, setStatus] = useState('loading'); // 'loading' | 'allowed' | 'denied'

  useEffect(() => {
    base44.auth.me().then(user => {
      if (user && (user.role === 'esop_admin' || user.role === 'admin')) {
        setStatus('allowed');
      } else {
        setStatus('denied');
      }
    }).catch(() => setStatus('denied'));
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
          <h2 className="text-lg font-bold text-app-text mb-2">Access Denied</h2>
          <p className="text-sm text-app-text-2">This area requires Essential SOP administrator access.</p>
        </div>
      </div>
    );
  }

  return children;
}