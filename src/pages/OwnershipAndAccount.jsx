import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useCompany } from '@/lib/CompanyContext';
import SelectSheet from '@/components/ui/SelectSheet';
import { ArrowLeft, ShieldCheck, AlertTriangle, ChevronDown } from 'lucide-react';

export default function OwnershipAndAccount() {
  const navigate = useNavigate();
  const { activeCompany, isGeneralManager } = useCompany();
  const companyId = activeCompany?.id;

  const [gms, setGms] = useState([]);
  const [owner, setOwner] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [transferTarget, setTransferTarget] = useState('');
  const [targetSheetOpen, setTargetSheetOpen] = useState(false);
  const [confirmClose, setConfirmClose] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [closeRequesting, setCloseRequesting] = useState(false);
  const [error, setError] = useState('');
  const [transferDone, setTransferDone] = useState(false);

  useEffect(() => {
    if (!companyId || !isGeneralManager) return;
    Promise.all([
      base44.entities.CompanyMembership.filter({ companyId, role: 'general_manager', status: 'active' }),
      base44.entities.User.list(),
    ]).then(([gmMemberships, allUsers]) => {
      setGms(gmMemberships || []);
      setUsers(allUsers || []);
      if (activeCompany?.ownerUserId) {
        setOwner(allUsers.find(u => u.id === activeCompany.ownerUserId) || null);
      }
      setLoading(false);
    });
  }, [companyId, isGeneralManager]);

  if (!isGeneralManager) {
    return (
      <div className="min-h-screen bg-app-bg flex items-center justify-center p-8 text-center">
        <p className="text-sm text-app-text-muted">Only General Managers can access ownership settings.</p>
      </div>
    );
  }

  const getUser = id => users.find(u => u.id === id);

  const handleTransfer = async () => {
    if (!transferTarget) return;
    setTransferring(true); setError('');
    const res = await base44.functions.invoke('manageMember', {
      action: 'transfer_ownership',
      companyId,
      targetMembershipId: transferTarget,
    }).catch(e => ({ data: { error: e.message } }));
    setTransferring(false);
    if (res.data?.success) {
      setTransferDone(true);
      setTimeout(() => navigate(-1), 2000);
    } else {
      setError(res.data?.error || 'Transfer failed.');
    }
  };

  const handleCloseRequest = async () => {
    if (confirmClose.toLowerCase() !== 'close') return;
    setCloseRequesting(true); setError('');
    try {
      const user = await base44.auth.me();
      await base44.entities.ActivityLog.create({
        companyId,
        actingUserId: user.id,
        actionType: 'account_deletion_requested',
        summary: `${user.full_name || user.email} requested closure of ${activeCompany.name}`,
        timestamp: new Date().toISOString(),
      });
      alert('Workspace closure request submitted. Contact support to complete the process.');
    } catch (e) {
      setError(e.message || 'Failed to submit closure request.');
    }
    setCloseRequesting(false);
  };

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen bg-app-bg">
      <div className="w-8 h-8 border-4 border-app-border border-t-app-accent rounded-full animate-spin" />
    </div>
  );

  if (transferDone) return (
    <div className="min-h-screen bg-app-bg flex flex-col items-center justify-center p-8 text-center">
      <ShieldCheck size={48} className="text-app-success mb-4" />
      <h2 className="font-bold text-app-text mb-2">Ownership Transferred</h2>
      <p className="text-sm text-app-text-2">Returning to company settings…</p>
    </div>
  );

  const otherGMs = gms.filter(g => getUser(g.userId)?.id !== activeCompany?.ownerUserId);

  const transferLabel = !transferTarget
    ? 'Select a General Manager…'
    : (() => {
        const g = otherGMs.find(x => x.id === transferTarget);
        const u = g && getUser(g.userId);
        return u?.full_name || u?.email || 'Select a General Manager…';
      })();

  return (
    <div className="min-h-screen bg-app-bg">
      <div className="bg-app-surface border-b border-app-border sticky top-0 z-40" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="icon-btn touch-active"><ArrowLeft size={22} className="text-app-text-2" /></button>
          <h1 className="font-semibold text-app-text flex-1">Ownership &amp; Account</h1>
        </div>
      </div>

      <div className="px-4 pt-5 pb-8 max-w-lg mx-auto space-y-5">
        {error && <div className="p-3 bg-app-danger-bg border border-app-danger rounded-lg text-sm text-app-danger">{error}</div>}

        {/* Current owner */}
        <Section title="Company Owner">
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="w-9 h-9 rounded-full bg-app-info-bg flex items-center justify-center">
              <span className="text-sm font-bold text-app-accent">{owner?.full_name?.charAt(0) || '?'}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-app-text">{owner?.full_name || '—'}</p>
              <p className="text-xs text-app-text-muted">{owner?.email}</p>
            </div>
            <span className="text-xs px-2 py-0.5 bg-app-success-bg text-app-success rounded-full">Owner</span>
          </div>
        </Section>

        {/* Active General Managers */}
        <Section title={`General Managers (${gms.length})`}>
          {gms.map(g => {
            const u = getUser(g.userId);
            return (
              <div key={g.id} className="flex items-center gap-3 px-4 py-3 border-t border-app-divider first:border-0">
                <div className="w-8 h-8 rounded-full bg-app-elevated flex items-center justify-center">
                  <span className="text-xs font-bold text-app-text-muted">{u?.full_name?.charAt(0) || '?'}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-app-text">{u?.full_name || '—'}</p>
                  <p className="text-xs text-app-text-muted">{u?.email}</p>
                </div>
              </div>
            );
          })}
        </Section>

        {/* Transfer ownership */}
        <Section title="Transfer Ownership">
          {otherGMs.length === 0 ? (
            <p className="px-4 py-3 text-sm text-app-text-muted">
              Add another General Manager before transferring ownership.
            </p>
          ) : (
            <div className="px-4 py-3">
              <p className="text-xs text-app-text-muted mb-3">
                The new owner will receive full account control. This action cannot be undone without their agreement.
              </p>
              <button type="button" onClick={() => setTargetSheetOpen(true)}
                className="w-full flex items-center justify-between px-3 py-2.5 bg-app-input border border-app-border rounded-lg text-sm text-app-text mb-3 text-left no-select touch-active">
                <span className={!transferTarget ? 'text-app-text-muted' : ''}>{transferLabel}</span>
                <ChevronDown size={16} className="text-app-text-muted" />
              </button>
              <button onClick={handleTransfer} disabled={!transferTarget || transferring}
                className="w-full py-2.5 bg-app-warning text-white rounded-lg text-sm font-semibold disabled:opacity-50 touch-active no-select">
                {transferring ? 'Transferring…' : 'Transfer Ownership'}
              </button>
              <SelectSheet
                open={targetSheetOpen}
                title="Select a General Manager"
                value={transferTarget}
                options={[
                  { value: '', label: 'Select a General Manager…' },
                  ...otherGMs.map(g => {
                    const u = getUser(g.userId);
                    return { value: g.id, label: u?.full_name || u?.email || 'Unknown' };
                  }),
                ]}
                onSelect={(v) => setTransferTarget(v)}
                onClose={() => setTargetSheetOpen(false)}
              />
            </div>
          )}
        </Section>

        {/* Close workspace — danger zone */}
        <div className="bg-app-card border border-app-danger/40 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-app-divider flex items-center gap-2">
            <AlertTriangle size={13} className="text-app-danger" />
            <span className="text-xs font-semibold text-app-danger uppercase tracking-wide">Danger Zone</span>
          </div>
          <div className="px-4 py-4">
            <p className="text-sm font-medium text-app-danger mb-1">Close Company Workspace</p>
            <p className="text-xs text-app-text-muted mb-3">
              This will request workspace closure. All data will be preserved until the request is processed.
              Type <strong>close</strong> to confirm.
            </p>
            <input value={confirmClose} onChange={e => setConfirmClose(e.target.value)}
              placeholder="close"
              className="w-full px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text mb-3 focus:outline-none focus:border-app-danger" />
            <button onClick={handleCloseRequest} disabled={confirmClose.toLowerCase() !== 'close' || closeRequesting}
              className="w-full py-2.5 border border-app-danger text-app-danger rounded-lg text-sm font-semibold disabled:opacity-40 touch-active no-select">
              {closeRequesting ? 'Submitting…' : 'Request Workspace Closure'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <p className="text-xs font-semibold text-app-text-muted uppercase mb-2 px-1">{title}</p>
      <div className="bg-app-card border border-app-border rounded-xl overflow-hidden">{children}</div>
    </div>
  );
}