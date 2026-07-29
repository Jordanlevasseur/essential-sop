import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useCompany } from '@/lib/CompanyContext';
import { useApp } from '@/lib/AppContext';
import { getPlan } from '@/lib/plans';
import { ArrowLeft, UserPlus, MoreVertical, Clock, Check, X, Mail, RefreshCw } from 'lucide-react';

const ROLE_LABELS = {
  general_manager: 'General Manager',
  project_manager: 'Project Manager',
  project_lead: 'Project Lead',
  technician: 'Technician',
};

const ROLE_ORDER = ['general_manager', 'project_manager', 'project_lead', 'technician'];

export default function TeamMembers() {
  const navigate = useNavigate();
  const { activeCompany, activeMembership } = useCompany();
  const { isGeneralManager } = useApp();
  const companyId = activeCompany?.id;
  const [members, setMembers] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [actionMenu, setActionMenu] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');

  // Invite form state
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('technician');
  const [inviteResult, setInviteResult] = useState(null);
  const [inviting, setInviting] = useState(false);

  const plan = getPlan(activeCompany?.subscriptionPlanCode);
  const PLAN_LIMITS = { homeowner: 1, handyman: 2, contractor: 15, contractor_plus: 40 };
  const seatLimit = PLAN_LIMITS[activeCompany?.subscriptionPlanCode] || 40;
  const activeMembers = members.filter(m => m.status === 'active');
  const suspendedMembers = members.filter(m => m.status === 'suspended');
  const pendingInvites = invitations.filter(i => i.status === 'pending' && new Date(i.expiresAt) > new Date());

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
    setInviting(true);
    setError('');
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
    setActionLoading(true);
    setActionMenu(null);
    const res = await base44.functions.invoke('manageMember', { action, companyId, targetMembershipId: membershipId, ...extra });
    setActionLoading(false);
    if (res.data?.success) {
      loadData();
    } else {
      setError(res.data?.error || 'Action failed');
    }
  };

  const handleCancelInvite = async (inviteId) => {
    await base44.entities.CompanyInvitation.update(inviteId, { status: 'cancelled', cancelledAt: new Date().toISOString() });
    loadData();
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
            <button onClick={() => { setShowInviteForm(true); setInviteResult(null); setError(''); }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-app-accent text-app-accent-text rounded-lg text-sm font-medium touch-active">
              <UserPlus size={15} /> Invite
            </button>
          )}
        </div>
      </div>

      <div className="px-4 pt-4 pb-2 max-w-2xl mx-auto">
        {/* Company / plan summary */}
        <div className="bg-app-card border border-app-border rounded-xl p-4 mb-5">
          <p className="font-semibold text-app-text">{activeCompany?.name}</p>
          <p className="text-sm text-app-text-2 mt-0.5">{plan?.displayName}</p>
          <div className="mt-3 flex items-center gap-3 text-sm">
            <span className="text-app-text"><span className="font-semibold">{activeMembers.length}</span> of {seatLimit} profiles used</span>
            <div className="flex-1 h-1.5 bg-app-elevated rounded-full overflow-hidden">
              <div className="h-full bg-app-accent rounded-full" style={{ width: `${Math.min((activeMembers.length / seatLimit) * 100, 100)}%` }} />
            </div>
          </div>
        </div>

        {error && <div className="mb-4 p-3 bg-app-danger-bg border border-app-danger rounded-lg text-sm text-app-danger">{error}</div>}

        {/* Invite form */}
        {showInviteForm && !inviteResult && (
          <div className="mb-5 bg-app-card border border-app-border rounded-xl p-4">
            <h2 className="font-semibold text-app-text mb-3">Invite a Member</h2>
            <label className="text-xs font-semibold text-app-text-muted uppercase mb-1 block">Email Address</label>
            <input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
              type="email" placeholder="team@example.com"
              className="w-full px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text mb-3" />
            <label className="text-xs font-semibold text-app-text-muted uppercase mb-1 block">Role</label>
            <select value={inviteRole} onChange={e => setInviteRole(e.target.value)}
              className="w-full px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text mb-4">
              {ROLE_ORDER.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
            <div className="flex gap-2">
              <button onClick={() => setShowInviteForm(false)} className="flex-1 py-2.5 border border-app-border rounded-lg text-sm text-app-text-2">Cancel</button>
              <button onClick={handleInvite} disabled={inviting || !inviteEmail.trim()}
                className="flex-1 py-2.5 bg-app-accent text-app-accent-text rounded-lg text-sm font-medium disabled:bg-app-disabled disabled:text-app-text-disabled">
                {inviting ? 'Inviting…' : 'Send Invite'}
              </button>
            </div>
          </div>
        )}

        {inviteResult && (
          <div className="mb-5 bg-app-success-bg border border-app-success rounded-xl p-4">
            <p className="font-semibold text-app-success mb-1">Invitation Created</p>
            <p className="text-sm text-app-text-2 mb-3">Prototype mode: email not sent. Share this link manually:</p>
            <div className="bg-app-elevated rounded-lg p-2.5 break-all text-xs text-app-text font-mono mb-3">{inviteResult.inviteLink}</div>
            <button onClick={() => { navigator.clipboard.writeText(inviteResult.inviteLink); }} className="text-xs text-app-accent underline">Copy Link</button>
            <button onClick={() => { setShowInviteForm(false); setInviteResult(null); setInviteEmail(''); }} className="ml-4 text-xs text-app-text-muted">Done</button>
          </div>
        )}

        {/* Active Members */}
        <MemberSection title={`Active Members (${activeMembers.length})`}>
          {activeMembers.sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role)).map(m => {
            const u = getUser(m.userId);
            return (
              <MemberRow key={m.id}
                name={u?.full_name || 'Unknown'}
                email={u?.email || '—'}
                role={ROLE_LABELS[m.role] || m.role}
                meta={m.joinedAt ? `Joined ${new Date(m.joinedAt).toLocaleDateString()}` : ''}
                isMe={m.userId === activeMembers.find(a => a.userId)?.userId}
                actions={isGeneralManager && m.userId !== (users.find(u => u.id === activeCompany?.ownerUserId))?.id ? [
                  { label: 'Change Role', onClick: () => { const newRole = prompt(`New role for ${u?.full_name}? (general_manager / project_manager / project_lead / technician)`); if (newRole) handleAction('change_role', m.id, { newRole }); } },
                  { label: 'Suspend Access', onClick: () => { if (confirm(`Suspend ${u?.full_name}?`)) handleAction('suspend', m.id); } },
                  { label: 'Remove From Company', onClick: () => { if (confirm(`Remove ${u?.full_name} (${u?.email}) from ${activeCompany?.name}? This cannot be undone.`)) handleAction('remove', m.id); } },
                ] : []}
              />
            );
          })}
        </MemberSection>

        {pendingInvites.length > 0 && (
          <MemberSection title={`Pending Invitations (${pendingInvites.length})`}>
            {pendingInvites.map(inv => (
              <div key={inv.id} className="flex items-center gap-3 px-4 py-3">
                <div className="w-9 h-9 rounded-full bg-app-elevated flex items-center justify-center flex-shrink-0">
                  <Mail size={16} className="text-app-text-muted" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-app-text truncate">{inv.invitedEmail}</p>
                  <p className="text-xs text-app-text-muted">{ROLE_LABELS[inv.intendedRole]} · Expires {new Date(inv.expiresAt).toLocaleDateString()}</p>
                </div>
                {isGeneralManager && (
                  <button onClick={() => handleCancelInvite(inv.id)} className="text-xs text-app-danger touch-active"><X size={16} /></button>
                )}
              </div>
            ))}
          </MemberSection>
        )}

        {suspendedMembers.length > 0 && (
          <MemberSection title={`Suspended (${suspendedMembers.length})`}>
            {suspendedMembers.map(m => {
              const u = getUser(m.userId);
              return (
                <MemberRow key={m.id}
                  name={u?.full_name || 'Unknown'}
                  email={u?.email || '—'}
                  role={ROLE_LABELS[m.role] || m.role}
                  meta="Suspended"
                  metaClass="text-app-warning"
                  actions={isGeneralManager ? [
                    { label: 'Restore Access', onClick: () => handleAction('restore', m.id) },
                    { label: 'Remove From Company', onClick: () => { if (confirm(`Remove ${u?.full_name}?`)) handleAction('remove', m.id); } },
                  ] : []}
                />
              );
            })}
          </MemberSection>
        )}
      </div>

      <div style={{ height: 'calc(16px + env(safe-area-inset-bottom))' }} />
    </div>
  );
}

function MemberSection({ title, children }) {
  return (
    <div className="mb-5">
      <p className="text-xs font-semibold text-app-text-muted uppercase mb-2 px-1">{title}</p>
      <div className="bg-app-card border border-app-border rounded-xl overflow-hidden divide-y divide-app-divider">{children}</div>
    </div>
  );
}

function MemberRow({ name, email, role, meta, metaClass, actions = [] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center gap-3 px-4 py-3 relative">
      <div className="w-9 h-9 rounded-full bg-app-info-bg flex items-center justify-center flex-shrink-0">
        <span className="text-sm font-bold text-app-accent">{name.charAt(0).toUpperCase()}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-app-text truncate">{name}</p>
        <p className="text-xs text-app-text-muted truncate">{email}</p>
        <p className="text-xs text-app-text-2">{role}{meta ? ` · ` : ''}<span className={metaClass || 'text-app-text-muted'}>{meta}</span></p>
      </div>
      {actions.length > 0 && (
        <div className="relative">
          <button onClick={() => setOpen(o => !o)} className="icon-btn touch-active" aria-label="Actions"><MoreVertical size={18} className="text-app-text-muted" /></button>
          {open && (
            <div className="absolute right-0 top-8 bg-app-surface border border-app-border rounded-xl shadow-lg z-10 min-w-44 overflow-hidden">
              {actions.map(a => (
                <button key={a.label} onClick={() => { setOpen(false); a.onClick(); }}
                  className={`w-full text-left px-4 py-2.5 text-sm hover:bg-app-elevated ${a.label.includes('Remove') ? 'text-app-danger' : 'text-app-text'}`}>
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}