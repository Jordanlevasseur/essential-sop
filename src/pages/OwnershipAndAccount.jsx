import React, { useState, useEffect } from 'react';
import { useSafeBack } from '@/lib/useSafeBack';
import { base44 } from '@/api/base44Client';
import { useCompany } from '@/lib/CompanyContext';
import SelectSheet from '@/components/ui/SelectSheet';
import DeleteAccountModal from '@/components/DeleteAccountModal';
import CompanyDeletionDialog from '@/components/CompanyDeletionDialog';
import { ArrowLeft, ShieldCheck, AlertTriangle, ChevronDown, Trash2, Building2 } from 'lucide-react';

/**
 * Ownership & Account.
 *
 * Accessible to EVERY authenticated user. The GM-only ownership sections
 * (company owner, General Managers list, transfer ownership) are rendered only
 * when the active membership is general_manager. The "Account & Data" section is
 * rendered for everyone at the very bottom and contains the two deletion
 * workflows:
 *
 *   1. Delete My Account — available to every user (GM, PM, PL, Technician,
 *      Homeowner). Reuses the existing deleteAccount backend + DeleteAccountModal.
 *   2. Request Company Deletion — General Manager only. Requires the GM to type
 *      the exact company name; calls requestCompanyClosure, which creates a
 *      COMPANY_DELETION request in the Platform Administration queue and leaves
 *      all company data intact until a Platform Super Admin approves and a
 *      separate execution step runs.
 *
 * Non-GM users see only Delete My Account; company deletion is never exposed to
 * Project Managers, Project Leads, or Technicians.
 */
export default function OwnershipAndAccount() {
  const handleBack = useSafeBack('/profile');
  const { activeCompany, isGeneralManager } = useCompany();
  const companyId = activeCompany?.id;

  const [gms, setGms] = useState([]);
  const [owner, setOwner] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(isGeneralManager);
  const [transferTarget, setTransferTarget] = useState('');
  const [targetSheetOpen, setTargetSheetOpen] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [transferDone, setTransferDone] = useState(false);
  const [error, setError] = useState('');

  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [showCompanyDeletion, setShowCompanyDeletion] = useState(false);

  useEffect(() => {
    if (!companyId || !isGeneralManager) return;
    base44.functions.invoke('resolveTeamRoster', { companyId }).then(res => {
      const data = res.data || {};
      if (data.error) { setLoading(false); return; }
      const allMembers = data.members || [];
      const allUsers = data.users || [];
      setGms(allMembers.filter(m => m.role === 'general_manager' && m.status === 'active'));
      setUsers(allUsers);
      if (activeCompany?.ownerUserId) {
        setOwner(allUsers.find(u => u.id === activeCompany.ownerUserId) || null);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [companyId, isGeneralManager]);

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

  const getUser = id => users.find(u => u.id === id);
  const otherGMs = gms.filter(g => getUser(g.userId)?.id !== activeCompany?.ownerUserId);

  const transferLabel = !transferTarget
    ? 'Select a General Manager…'
    : (() => {
        const g = otherGMs.find(x => x.id === transferTarget);
        const u = g && getUser(g.userId);
        return u?.full_name || u?.email || 'Select a General Manager…';
      })();

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
      setTimeout(handleBack, 2000);
    } else {
      setError(res.data?.error || 'Transfer failed.');
    }
  };

  return (
    <div className="min-h-screen bg-app-bg">
      <div className="bg-app-surface border-b border-app-border sticky top-0 z-40" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="px-3 py-2.5 flex items-center gap-2.5">
          <button onClick={handleBack} className="icon-btn touch-active"><ArrowLeft size={22} className="text-app-text-2" /></button>
          <h1 className="font-semibold text-app-text flex-1">Ownership & Account</h1>
        </div>
      </div>

      <div className="px-3 pt-4 pb-3 max-w-lg mx-auto space-y-4">
        {error && <div className="p-3 bg-app-danger-bg border border-app-danger rounded-lg text-sm text-app-danger">{error}</div>}

        {/* ── GM-only ownership sections ─────────────────────────────────────── */}
        {isGeneralManager && (
          <>
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
          </>
        )}

        {/* ── Account & Data (bottom, everyone) ─────────────────────────────── */}
        <div>
          <p className="text-xs font-semibold text-app-text-muted uppercase mb-2 px-1">Account & Data</p>
          <div className="space-y-3">
            {/* Delete My Account — every user */}
            <div className="bg-app-card border border-app-danger/40 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-app-divider flex items-center gap-2">
                <AlertTriangle size={13} className="text-app-danger" />
                <span className="text-xs font-semibold text-app-danger uppercase tracking-wide">Personal</span>
              </div>
              <button onClick={() => setShowDeleteAccount(true)}
                className="w-full flex items-center gap-3 px-4 py-4 text-left touch-active no-select">
                <Trash2 size={18} className="text-app-danger flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-app-danger">Delete My Account</p>
                  <p className="text-xs text-app-text-muted mt-0.5">
                    Permanently delete your personal Essential SOP account. Company workspaces and other members are not affected.
                  </p>
                </div>
              </button>
            </div>

            {/* Request Company Deletion — General Manager only */}
            {isGeneralManager && (
              <div className="bg-app-card border border-app-danger/40 rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 border-b border-app-divider flex items-center gap-2">
                  <AlertTriangle size={13} className="text-app-danger" />
                  <span className="text-xs font-semibold text-app-danger uppercase tracking-wide">Workspace</span>
                </div>
                <button onClick={() => setShowCompanyDeletion(true)}
                  className="w-full flex items-center gap-3 px-4 py-4 text-left touch-active no-select">
                  <Building2 size={18} className="text-app-danger flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-app-danger">Request Company Deletion</p>
                    <p className="text-xs text-app-text-muted mt-0.5">
                      Request the permanent deletion of your entire company workspace, including its SOP library,
                      resources, and associated company data. This affects everyone in the company and cannot be
                      undone once completed. Your request will be reviewed by Essential SOP administration. You will
                      receive confirmation when it has been processed.
                    </p>
                  </div>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ height: 'calc(16px + env(safe-area-inset-bottom))' }} />

      {showDeleteAccount && <DeleteAccountModal onClose={() => setShowDeleteAccount(false)} />}
      {showCompanyDeletion && (
        <CompanyDeletionDialog
          companyName={activeCompany?.name}
          onClose={() => setShowCompanyDeletion(false)}
          onSubmit={async (confirmName) => {
            const res = await base44.functions.invoke('requestCompanyClosure', { companyId, confirmName });
            return res.data;
          }}
        />
      )}
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