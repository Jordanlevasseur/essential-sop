import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useCompany } from '@/lib/CompanyContext';
import { useApp } from '@/lib/AppContext';
import { getPlan } from '@/lib/plans';
import { getRoleLabel, ROLE_CODES } from '@/lib/roleLabels';
import SelectSheet from '@/components/ui/SelectSheet';
import { ArrowLeft, UserPlus, MoreVertical, Mail, X, ChevronDown } from 'lucide-react';

export default function TeamMembers() {
  const navigate = useNavigate();
  const { activeCompany, isGeneralManager } = useCompany();
  const companyId = activeCompany?.id;
  const [members, setMembers] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [error, setError] = useState('');

  // Invite form
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('technician');
  const [inviteResult, setInviteResult] = useState(null);
  const [inviting, setInviting] = useState(false);
  const [roleSheetOpen, setRoleSheetOpen] = useState(false);

  const plan = getPlan(activeCompany?.subscriptionPlanCode);
  const PLAN_LIMITS = { homeowner: 1, handyman: 2, contractor: 15, contractor_plus: 40 };
  const seatLimit = PLAN_LIMITS[activeCompany?.subscriptionPlanCode] || 40;
  const activeMembers = members.filter(m => m.status === 'active');
  const suspendedMembers = members.filter(m => m.status === 'suspended');
  const pendingInvites = invitations.filter(i => i.status === 'pending' && new Date(i.expiresAt) > new Date());

  const rl = (code) => getRoleLabel(code, activeCompany);

  useEffect(() => {
    if (!companyId) return;
    loadData();
  }, [companyId]);

  const loadData = async () => {
    setLoading(true);
    const [allMembers, allInvites, allUsers] = await Promise.all([
      base44.entities.CompanyMembership.filter({ companyId }),
      base44.entities.CompanyInvitation.filter({ companyId }),
      base44.entities.User.list(),
    ]);
    setMembers(allMembers || []);
    setInvitations(allInvites || []);
    setUsers(allUsers || []);
    setLoading(false);
  };

  const getUser = (userId) => users.find(u => u.id === userId);

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true); setError('');
    const res = await base44.functions.invoke('inviteMember', { companyId, email: inviteEmail.trim(), intendedRole: inviteRole });
    setInviting(false);
    if (res.data?.success) {
      setInviteResult(res.data);
      loadData();
    } else {
      setError(res.data?.error || 'Failed to send invitation');
    }
  };

  const handleAction = async (action, membershipId, extra = {}) => {
    setError('');
    const res = await base44.functions.invoke('manageMember', { action, companyId, targetMembershipId: membershipId, ...extra });
    if (res.data?.success) {
      loadData();
    } else {
      setError(res.data?.error || 'Action failed');
    }
  };

  const handleCancelInvite = async (inviteId) => {
    // Optimistic: remove the invitation from the pending list immediately, then
    // persist. Low-risk and reversible (the GM can re-invite); on failure, reload
    // the authoritative state to reconcile. Backend semantics unchanged.
    const nowIso = new Date().toISOString();
    setInvitations(prev => prev.map(i => i.id === inviteId ? { ...i, status: 'cancelled', cancelledAt: nowIso } : i));
    try {
      await base44.entities.CompanyInvitation.update(inviteId, { status: 'cancelled', cancelledAt: nowIso });
    } catch (_) {
      loadData();
    }
  };

  const changeRole = async (m, u) => {
    const current = m.role;
    const options = ROLE_CODES.map(r => `${r} — ${rl(r)}`).join('\n');
    const raw = prompt(`Change role for ${u?.full_name}?\n\nAvailable roles:\n${options}\n\nType the role code:`);
    if (!raw) return;
    const newRole = raw.trim();
    if (!ROLE_CODES.includes(newRole)) { alert('Invalid role code.'); return; }
    if (newRole === current) return;
    handleAction('change_role', m.id, { newRole });
  };

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen bg-app-bg">
      <div className="w-8 h-8 border-4 border-app-border border-t-app-accent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="min-h-screen bg-app-bg">
      <div className="bg-app-surface border-b border-app-border sticky top-0 z-40" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="icon-btn touch-active" aria-label="Back"><ArrowLeft size={22} className="text-app-text-2" /></button>
          <h1 className="font-semibold text-app-text flex-1">Team Members</h1>
          {isGeneralManager && (
            <button onClick={() => { setShowInviteForm(true); setInviteResult(null); setError(''); setInviteEmail(''); }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-app-accent text-app-accent-text rounded-lg text-sm font-medium touch-active no-select">
              <UserPlus size={15} /> Invite Member
            </button>
          )}
        </div>
      </div>

      <div className="px-4 pt-4 pb-2 max-w-2xl mx-auto">
        {/* Plan / seat summary */}
        <div className="bg-app-card border border-app-border rounded-xl p-4 mb-5">
          <div className="flex items-baseline justify-between mb-2">
            <p className="font-semibold text-app-text">{plan?.displayName || 'Current Plan'}</p>
            <p className="text-sm text-app-text-2">{activeMembers.length} of {seatLimit} profiles used</p>
          </div>
          <div className="h-1.5 bg-app-elevated rounded-full overflow-hidden">
            <div className="h-full bg-app-accent rounded-full transition-all" style={{ width: `${Math.min((activeMembers.length / seatLimit) * 100, 100)}%` }} />
          </div>
        </div>

        {error && <div className="mb-4 p-3 bg-app-danger-bg border border-app-danger rounded-lg text-sm text-app-danger">{error}</div>}

        {/* Invite form */}
        {showInviteForm && !inviteResult && (
          <div className="mb-5 bg-app-card border border-app-border rounded-xl p-4">
            <h2 className="font-semibold text-app-text mb-3">Invite a Member</h2>
            <label htmlFor="invite-email" className="text-xs font-semibold text-app-text-muted uppercase mb-1 block">Email Address</label>
            <input id="invite-email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
              type="email" placeholder="team@example.com" enterKeyHint="next"
              className="w-full px-3 py-2.5 bg-app-input border border-app-border rounded-lg text-sm text-app-text mb-3 focus:outline-none focus:border-app-accent" />
            <label className="text-xs font-semibold text-app-text-muted uppercase mb-1 block">Role</label>
            <button type="button" onClick={() => setRoleSheetOpen(true)}
              className="w-full flex items-center justify-between px-3 py-2.5 bg-app-input border border-app-border rounded-lg text-sm text-app-text mb-4 text-left no-select touch-active">
              <span>{rl(inviteRole)}</span>
              <ChevronDown size={16} className="text-app-text-muted" />
            </button>
            <div className="flex gap-2">
              <button onClick={() => setShowInviteForm(false)} className="flex-1 py-2.5 border border-app-border rounded-lg text-sm text-app-text-2 no-select touch-active">Cancel</button>
              <button onClick={handleInvite} disabled={inviting || !inviteEmail.trim()}
                className="flex-1 py-2.5 bg-app-accent text-app-accent-text rounded-lg text-sm font-medium no-select touch-active disabled:bg-app-disabled disabled:text-app-text-disabled">
                {inviting ? 'Inviting…' : 'Send Invite'}
              </button>
            </div>
          </div>
        )}

        {inviteResult && (
          <div className="mb-5 bg-app-success-bg border border-app-success rounded-xl p-4">
            <p className="font-semibold text-app-success mb-1">Invitation Sent</p>
            <p className="text-sm text-app-text-2 mb-3">Prototype mode: email not sent. Share this link manually:</p>
            <div className="bg-app-elevated rounded-lg p-2.5 break-all text-xs text-app-text font-mono mb-3">{inviteResult.inviteLink}</div>
            <button onClick={() => navigator.clipboard.writeText(window.location.origin + inviteResult.inviteLink)}
              className="text-xs text-app-accent underline touch-active">Copy Link</button>
            <button onClick={() => { setShowInviteForm(false); setInviteResult(null); setInviteEmail(''); }}
              className="ml-4 text-xs text-app-text-muted touch-active">Done</button>
          </div>
        )}

        {/* Active Members */}
        <GroupSection title={`Active Members (${activeMembers.length})`}>
          {activeMembers
            .sort((a, b) => ROLE_CODES.indexOf(a.role) - ROLE_CODES.indexOf(b.role))
            .map(m => {
              const u = getUser(m.userId);
              const isOwner = m.userId === activeCompany?.ownerUserId;
              return (
                <MemberRow key={m.id}
                  name={u?.full_name || 'Unknown'}
                  email={u?.email || '—'}
                  roleLabel={rl(m.role)}
                  badge={isOwner ? 'Owner' : null}
                  meta={m.joinedAt ? `Joined ${new Date(m.joinedAt).toLocaleDateString()}` : ''}
                  actions={isGeneralManager && !isOwner ? [
                    { label: 'Change Role', onClick: () => changeRole(m, u) },
                    { label: 'Suspend Access', onClick: () => { if (confirm(`Suspend ${u?.full_name}?`)) handleAction('suspend', m.id); } },
                    { label: 'Remove Member', danger: true, onClick: () => { if (confirm(`Remove ${u?.full_name} from ${activeCompany?.name}?`)) handleAction('remove', m.id); } },
                  ] : []}
                />
              );
            })}
        </GroupSection>

        {pendingInvites.length > 0 && (
          <GroupSection title={`Pending Invitations (${pendingInvites.length})`}>
            {pendingInvites.map(inv => (
              <div key={inv.id} className="flex items-center gap-3 px-4 py-3">
                <div className="w-9 h-9 rounded-full bg-app-elevated flex items-center justify-center flex-shrink-0">
                  <Mail size={16} className="text-app-text-muted" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-app-text truncate">{inv.invitedEmail}</p>
                  <p className="text-xs text-app-text-muted">{rl(inv.intendedRole)} · Expires {new Date(inv.expiresAt).toLocaleDateString()}</p>
                </div>
                {isGeneralManager && (
                  <button onClick={() => handleCancelInvite(inv.id)} className="icon-btn text-app-danger touch-active" aria-label="Cancel invitation">
                    <X size={16} />
                  </button>
                )}
              </div>
            ))}
          </GroupSection>
        )}

        {suspendedMembers.length > 0 && (
          <GroupSection title={`Suspended (${suspendedMembers.length})`}>
            {suspendedMembers.map(m => {
              const u = getUser(m.userId);
              return (
                <MemberRow key={m.id}
                  name={u?.full_name || 'Unknown'}
                  email={u?.email || '—'}
                  roleLabel={rl(m.role)}
                  meta="Access suspended"
                  metaClass="text-app-warning"
                  actions={isGeneralManager ? [
                    { label: 'Restore Access', onClick: () => handleAction('restore', m.id) },
                    { label: 'Remove Member', danger: true, onClick: () => { if (confirm(`Remove ${u?.full_name}?`)) handleAction('remove', m.id); } },
                  ] : []}
                />
              );
            })}
          </GroupSection>
        )}
      </div>

      <SelectSheet
        open={roleSheetOpen}
        title="Role"
        value={inviteRole}
        options={ROLE_CODES.map(r => ({ value: r, label: rl(r) }))}
        onSelect={(v) => setInviteRole(v)}
        onClose={() => setRoleSheetOpen(false)}
      />

      <div style={{ height: 'calc(16px + env(safe-area-inset-bottom))' }} />
    </div>
  );
}

function GroupSection({ title, children }) {
  return (
    <div className="mb-5">
      <p className="text-xs font-semibold text-app-text-muted uppercase mb-2 px-1">{title}</p>
      <div className="bg-app-card border border-app-border rounded-xl overflow-hidden divide-y divide-app-divider">{children}</div>
    </div>
  );
}

function MemberRow({ name, email, roleLabel, badge, meta, metaClass, actions = [] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center gap-3 px-4 py-3 relative">
      <div className="w-9 h-9 rounded-full bg-app-info-bg flex items-center justify-center flex-shrink-0">
        <span className="text-sm font-bold text-app-accent">{name.charAt(0).toUpperCase()}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-app-text truncate">{name}</p>
          {badge && <span className="text-xs px-1.5 py-0.5 bg-app-success-bg text-app-success rounded-full font-medium">{badge}</span>}
        </div>
        <p className="text-xs text-app-text-muted truncate">{email}</p>
        <p className="text-xs text-app-text-2">
          {roleLabel}
          {meta && <span className={`ml-1 ${metaClass || 'text-app-text-muted'}`}>· {meta}</span>}
        </p>
      </div>
      {actions.length > 0 && (
        <div className="relative">
          <button onClick={() => setOpen(o => !o)} className="icon-btn touch-active" aria-label="Actions">
            <MoreVertical size={18} className="text-app-text-muted" />
          </button>
          {open && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
              <div className="absolute right-0 top-8 bg-app-surface border border-app-border rounded-xl shadow-lg z-20 min-w-44 overflow-hidden">
                {actions.map(a => (
                  <button key={a.label} onClick={() => { setOpen(false); a.onClick(); }}
                    className={`w-full text-left px-4 py-2.5 text-sm touch-active ${a.danger ? 'text-app-danger' : 'text-app-text'}`}>
                    {a.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}