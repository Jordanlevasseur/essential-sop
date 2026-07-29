import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { CheckCircle2, AlertTriangle } from 'lucide-react';

const ROLE_LABELS = {
  general_manager: 'General Manager',
  project_manager: 'Project Manager',
  project_lead: 'Project Lead',
  technician: 'Technician',
};

export default function AcceptInvitation() {
  const navigate = useNavigate();
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  const invitationId = params.get('invitationId');

  const [invitation, setInvitation] = useState(null);
  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [accepting, setAccepting] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!invitationId) { setError('Invalid invitation link.'); setLoading(false); return; }
    base44.entities.CompanyInvitation.get(invitationId)
      .then(async inv => {
        if (!inv) { setError('Invitation not found.'); setLoading(false); return; }
        if (inv.status !== 'pending') { setError(`This invitation has already been ${inv.status}.`); setLoading(false); return; }
        if (new Date(inv.expiresAt) < new Date()) { setError('This invitation has expired.'); setLoading(false); return; }
        setInvitation(inv);
        const comp = await base44.entities.Company.get(inv.companyId).catch(() => null);
        setCompany(comp);
        setLoading(false);
      }).catch(() => { setError('Could not load invitation.'); setLoading(false); });
  }, [invitationId]);

  const handleAccept = async () => {
    setAccepting(true);
    setError('');
    try {
      const user = await base44.auth.me();
      if (!user) { base44.auth.redirectToLogin(window.location.href); return; }

      // Verify email matches
      if (user.email?.toLowerCase() !== invitation.invitedEmail?.toLowerCase()) {
        setError(`This invitation was sent to ${invitation.invitedEmail}. You are signed in as ${user.email}. Please sign in with the correct account.`);
        setAccepting(false);
        return;
      }

      // Check seat capacity
      const PLAN_LIMITS = { homeowner: 1, handyman: 2, contractor: 15, contractor_plus: 40 };
      const seatLimit = PLAN_LIMITS[company?.subscriptionPlanCode] || 40;
      const activeMembers = await base44.entities.CompanyMembership.filter({ companyId: invitation.companyId, status: 'active' });
      if ((activeMembers || []).length >= seatLimit) {
        setError('This invitation cannot currently be accepted because the company has reached its profile limit. Contact the company\'s General Manager.');
        setAccepting(false);
        return;
      }

      // Check not already a member
      const existing = (activeMembers || []).find(m => m.userId === user.id);
      if (existing) { setError('You are already a member of this workspace.'); setAccepting(false); return; }

      // Create membership
      await base44.entities.CompanyMembership.create({
        companyId: invitation.companyId,
        userId: user.id,
        role: invitation.intendedRole,
        status: 'active',
        joinedAt: new Date().toISOString(),
      });

      // Mark invitation accepted
      await base44.entities.CompanyInvitation.update(invitationId, { status: 'accepted', acceptedAt: new Date().toISOString() });

      // Log
      await base44.entities.ActivityLog.create({
        companyId: invitation.companyId,
        actingUserId: user.id,
        actionType: 'invitation_accepted',
        targetType: 'invitation',
        targetId: invitationId,
        summary: `${user.full_name || user.email} accepted invitation to join as ${invitation.intendedRole.replace('_', ' ')}`,
        timestamp: new Date().toISOString(),
      });

      setSuccess(true);
      setTimeout(() => { localStorage.setItem('esop_active_company_id', invitation.companyId); window.location.href = '/'; }, 2000);
    } catch (e) {
      setError(e.message || 'Failed to accept invitation');
      setAccepting(false);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen bg-app-bg">
      <div className="w-8 h-8 border-4 border-app-border border-t-app-accent rounded-full animate-spin" />
    </div>
  );

  if (success) return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-app-bg px-6 text-center">
      <CheckCircle2 size={48} className="text-app-success mb-4" />
      <h1 className="text-xl font-bold text-app-text mb-2">Welcome!</h1>
      <p className="text-sm text-app-text-2">You have joined {company?.name}. Redirecting…</p>
    </div>
  );

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-app-bg px-6">
      <div className="w-full max-w-sm">
        {error ? (
          <div className="bg-app-danger-bg border border-app-danger rounded-xl p-5 text-center">
            <AlertTriangle size={32} className="text-app-danger mx-auto mb-3" />
            <p className="text-sm text-app-danger">{error}</p>
            <button onClick={() => navigate('/')} className="mt-4 text-xs text-app-text-muted underline">Return to app</button>
          </div>
        ) : (
          <div className="bg-app-card border border-app-border rounded-xl p-6">
            <h1 className="text-xl font-bold text-app-text mb-1">You're Invited</h1>
            <p className="text-sm text-app-text-2 mb-4">Join <strong>{company?.name}</strong> as a <strong>{ROLE_LABELS[invitation?.intendedRole]}</strong>.</p>
            <button onClick={handleAccept} disabled={accepting}
              className="w-full py-3 bg-app-accent text-app-accent-text rounded-xl text-sm font-semibold disabled:opacity-60">
              {accepting ? 'Accepting…' : 'Accept Invitation'}
            </button>
            <button onClick={() => navigate('/')} className="w-full mt-2 py-2 text-xs text-app-text-muted">Decline</button>
          </div>
        )}
      </div>
    </div>
  );
}