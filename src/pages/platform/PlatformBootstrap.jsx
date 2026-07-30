import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { usePlatform } from '@/lib/PlatformContext';
import { ShieldCheck, Loader2, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react';

/**
 * PlatformBootstrap — One-time setup page for the Platform Owner.
 *
 * Shown only when:
 *   1. The user is authenticated.
 *   2. The user has NO active PlatformMembership.
 *   3. The user navigated to /platform/bootstrap.
 *
 * This page calls bootstrapPlatformAdmin which verifies:
 *   - Authenticated email === configured Platform Owner email (server-side)
 *   - Zero active Platform Super Admins exist (server-side)
 *
 * On success, refreshes PlatformContext and redirects to /platform.
 */
export default function PlatformBootstrap() {
  const { user } = useAuth();
  const { isPlatformSuperAdmin, refreshPlatformContext } = usePlatform();
  const navigate = useNavigate();
  const [status, setStatus] = useState('idle'); // idle | loading | success | error | blocked
  const [message, setMessage] = useState('');

  // If already a super admin, redirect immediately
  useEffect(() => {
    if (isPlatformSuperAdmin) navigate('/platform', { replace: true });
  }, [isPlatformSuperAdmin, navigate]);

  const handleBootstrap = async () => {
    setStatus('loading');
    setMessage('');
    try {
      const res = await base44.functions.invoke('bootstrapPlatformAdmin', {});
      const d = res?.data;
      if (d?.success) {
        setStatus('success');
        await refreshPlatformContext();
        setTimeout(() => navigate('/platform', { replace: true }), 1500);
      } else if (d?.reason === 'EMAIL_MISMATCH') {
        setStatus('blocked');
        setMessage('Your account email does not match the configured Platform Owner email. Bootstrap is unavailable for this account.');
      } else if (d?.reason === 'ADMINS_EXIST') {
        setStatus('blocked');
        setMessage('Platform Super Admins already exist. Contact an existing Platform Admin to grant you access.');
      } else {
        setStatus('error');
        setMessage(d?.message || d?.error || 'Bootstrap failed. Please try again.');
      }
    } catch (e) {
      setStatus('error');
      setMessage(e.message || 'Network error. Please try again.');
    }
  };

  return (
    <div className="min-h-screen bg-app-bg flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="bg-app-card border border-app-border rounded-2xl p-8 text-center">
          <div className="w-16 h-16 bg-app-info-bg rounded-2xl flex items-center justify-center mx-auto mb-4">
            <ShieldCheck size={32} className="text-app-accent" />
          </div>

          <h1 className="text-xl font-bold text-app-text mb-2">Platform Admin Setup</h1>
          <p className="text-sm text-app-text-2 mb-1">
            Essential SOP — One-time platform bootstrap
          </p>
          <p className="text-xs text-app-text-muted mb-6">
            Signed in as <span className="font-medium selectable">{user?.email}</span>
          </p>

          {status === 'idle' && (
            <>
              <p className="text-sm text-app-text-2 mb-6 leading-relaxed">
                This will create the first Platform Super Admin membership for your account.
                This operation is only available to the configured Platform Owner and only when no Platform Admins exist.
              </p>
              <button
                onClick={handleBootstrap}
                className="w-full py-3 bg-app-accent text-app-accent-text rounded-xl font-semibold text-sm flex items-center justify-center gap-2 no-select"
              >
                Activate Platform Admin Access <ArrowRight size={16} />
              </button>
            </>
          )}

          {status === 'loading' && (
            <div className="flex flex-col items-center gap-3 py-4">
              <Loader2 size={28} className="text-app-accent animate-spin" />
              <p className="text-sm text-app-text-2">Verifying and activating…</p>
            </div>
          )}

          {status === 'success' && (
            <div className="flex flex-col items-center gap-3 py-4">
              <CheckCircle2 size={32} className="text-app-success" />
              <p className="text-sm font-semibold text-app-text">Platform Admin access activated!</p>
              <p className="text-xs text-app-text-muted">Redirecting to Platform Dashboard…</p>
            </div>
          )}

          {(status === 'error' || status === 'blocked') && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 bg-app-danger-bg border border-app-danger/20 rounded-xl text-left">
                <AlertTriangle size={16} className="text-app-danger flex-shrink-0 mt-0.5" />
                <p className="text-sm text-app-danger">{message}</p>
              </div>
              {status === 'error' && (
                <button
                  onClick={handleBootstrap}
                  className="w-full py-2.5 bg-app-accent text-app-accent-text rounded-xl font-medium text-sm"
                >
                  Try Again
                </button>
              )}
              <button
                onClick={() => navigate('/')}
                className="w-full py-2.5 border border-app-border rounded-xl text-sm text-app-text-2"
              >
                Return to App
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}