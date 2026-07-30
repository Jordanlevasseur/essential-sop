import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import {
  ArrowLeft, ShieldCheck, UserPlus, UserX, UserCheck,
  AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldAlert,
} from 'lucide-react';

const STATUS_CONFIG = {
  ACTIVE:    { label: 'Active',    cls: 'bg-app-success-bg text-app-success' },
  SUSPENDED: { label: 'Suspended', cls: 'bg-app-warning-bg text-app-warning' },
  REVOKED:   { label: 'Revoked',   cls: 'bg-app-danger-bg text-app-danger' },
};

export default function PlatformAdmins() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState(null);
  const [actionLoading, setActionLoading] = useState(null); // membershipId being acted on

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await base44.functions.invoke('managePlatformAdmins', { action: 'list' });
      setAdmins(res.data?.memberships || []);
    } catch (e) {
      setError('Failed to load administrators.');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleInvite = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email || !email.includes('@')) return;
    setInviting(true);
    setInviteResult(null);
    try {
      const res = await base44.functions.invoke('managePlatformAdmins', { action: 'invite', targetEmail: email });
      const d = res.data;
      if (d?.success) {
        setInviteResult({ type: 'success', message: d.alreadyActive ? 'User is already an active Platform Admin.' : 'Platform Admin access granted.' });
        setInviteEmail('');
        await load();
      } else {
        setInviteResult({ type: 'error', message: d?.error || 'Failed to invite.' });
      }
    } catch (e) {
      setInviteResult({ type: 'error', message: e.message || 'Network error.' });
    }
    setInviting(false);
  };

  const handleAction = async (membershipId, action) => {
    setActionLoading(membershipId);
    try {
      const res = await base44.functions.invoke('managePlatformAdmins', { action, membershipId });
      if (res.data?.success) {
        await load();
      } else {
        alert(res.data?.error || 'Action failed.');
      }
    } catch (e) {
      alert(e.message || 'Network error.');
    }
    setActionLoading(null);
  };

  const activeCount = admins.filter(m => m.status === 'ACTIVE').length;

  return (
    <div className="min-h-screen bg-app-bg">
      {/* Header */}
      <div className="bg-app-surface border-b border-app-border px-6 py-4 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <button onClick={() => navigate('/platform')} className="icon-btn text-app-text-2">
            <ArrowLeft size={20} />
          </button>
          <div className="flex-1">
            <h1 className="font-bold text-app-text">Platform Admins</h1>
            <p className="text-xs text-app-text-muted">{activeCount} active admin{activeCount !== 1 ? 's' : ''}</p>
          </div>
          <button onClick={load} className="icon-btn text-app-text-muted" aria-label="Refresh">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6 space-y-5">
        {/* Safety warning */}
        <div className="flex items-start gap-3 p-4 bg-app-warning-bg border border-app-warning/30 rounded-xl">
          <AlertTriangle size={16} className="text-app-warning flex-shrink-0 mt-0.5" />
          <p className="text-sm text-app-text-2">
            Platform Admins have access to all Master SOPs, audit logs, and company provisioning.
            The last active Platform Admin cannot be suspended or revoked.
          </p>
        </div>

        {/* Invite */}
        <div className="bg-app-card border border-app-border rounded-xl p-5">
          <h2 className="text-sm font-semibold text-app-text mb-3 flex items-center gap-2">
            <UserPlus size={15} className="text-app-accent" /> Grant Platform Admin Access
          </h2>
          <div className="flex gap-2">
            <input
              type="email"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !inviting && handleInvite()}
              placeholder="user@example.com"
              className="flex-1 px-3 py-2.5 bg-app-input border border-app-border rounded-lg text-sm text-app-text placeholder:text-app-text-muted focus:outline-none focus:border-app-accent"
            />
            <button
              onClick={handleInvite}
              disabled={inviting || !inviteEmail.trim().includes('@')}
              className="px-4 py-2.5 bg-app-accent text-app-accent-text rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-2"
            >
              {inviting ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
              Grant Access
            </button>
          </div>
          <p className="text-xs text-app-text-muted mt-2">
            The user must already have a registered account. Grants immediate access.
          </p>
          {inviteResult && (
            <div className={`mt-3 flex items-center gap-2 text-sm ${inviteResult.type === 'success' ? 'text-app-success' : 'text-app-danger'}`}>
              {inviteResult.type === 'success' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
              {inviteResult.message}
            </div>
          )}
        </div>

        {/* Admin list */}
        {loading ? (
          <div className="flex justify-center py-10">
            <div className="w-6 h-6 border-2 border-app-border border-t-app-accent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="text-center py-8 text-app-danger text-sm">{error}</div>
        ) : admins.length === 0 ? (
          <div className="text-center py-10 text-app-text-muted text-sm">No Platform Admins found.</div>
        ) : (
          <div className="space-y-2">
            {admins.map(m => {
              const statusCfg = STATUS_CONFIG[m.status] || STATUS_CONFIG.ACTIVE;
              const isCurrentUser = m.userId === user?.id;
              const isActing = actionLoading === m.id;
              return (
                <div key={m.id} className="bg-app-card border border-app-border rounded-xl p-4 flex items-center gap-4">
                  <div className="w-10 h-10 bg-app-info-bg rounded-full flex items-center justify-center flex-shrink-0">
                    <ShieldCheck size={18} className="text-app-accent" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-semibold text-sm text-app-text truncate">
                        {m.userFullName || m.userEmail || m.userId}
                      </span>
                      {isCurrentUser && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-app-info-bg text-app-info rounded-full font-medium">You</span>
                      )}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${statusCfg.cls}`}>
                        {statusCfg.label}
                      </span>
                    </div>
                    <p className="text-xs text-app-text-muted">{m.userEmail || m.userId}</p>
                    <p className="text-xs text-app-text-disabled">
                      Granted {m.grantedAt ? new Date(m.grantedAt).toLocaleDateString() : '—'}
                    </p>
                  </div>
                  {!isCurrentUser && (
                    <div className="flex gap-2 flex-shrink-0">
                      {isActing ? (
                        <Loader2 size={16} className="text-app-text-muted animate-spin" />
                      ) : m.status === 'ACTIVE' ? (
                        <>
                          <button
                            onClick={() => handleAction(m.id, 'suspend')}
                            title="Suspend"
                            className="px-3 py-1.5 border border-app-warning/40 text-app-warning rounded-lg text-xs font-medium hover:bg-app-warning-bg transition-colors"
                          >
                            Suspend
                          </button>
                          <button
                            onClick={() => { if (confirm('Permanently revoke this admin access?')) handleAction(m.id, 'revoke'); }}
                            title="Revoke"
                            className="px-3 py-1.5 border border-app-danger/40 text-app-danger rounded-lg text-xs font-medium hover:bg-app-danger-bg transition-colors"
                          >
                            Revoke
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => handleAction(m.id, 'activate')}
                          title="Activate"
                          className="px-3 py-1.5 border border-app-success/40 text-app-success rounded-lg text-xs font-medium hover:bg-app-success-bg transition-colors"
                        >
                          Activate
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}