import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { getRoleLabel } from '@/lib/roleLabels';


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
    // Invitation preview is resolved server-side: the Company entity is
    // RLS-closed to direct client access, and only the invited company NAME
    // (never billing fields) is returned for a valid invitation.
    base44.functions.invoke('previewInvitation', { invitationId })
      .then(r => {
        const data = r.data || {};
        if (data.error) { setError(data.error === 'Invitation not found.' ? 'Invitation not found.' : 'Could not load invitation.'); setLoading(false); return; }
        const inv = data.invitation;
        if (!inv) { setError('Invitation not found.'); setLoading(false); return; }
        if (inv.status !== 'pending') { setError(`This invitation has already been ${inv.status}.`); setLoading(false); return; }
        if (new Date(inv.expiresAt) < new Date()) { setError('This invitation has expired.'); setLoading(false); return; }
        setInvitation(inv);
        setCompany({ name: data.companyName });
        setLoading(false);
      }).catch(() => { setError('Could not load invitation.'); setLoading(false); });
  }, [invitationId]);

  const handleAccept = async () => {
    setAccepting(true);
    setError('');
    try {
      const user = await base44.auth.me();
      if (!user) { base44.auth.redirectToLogin(window.location.href); return; }

      // Seat enforcement, token verification, and all writes are server-side.
      const resp = await base44.functions.invoke('acceptInvitation', { invitationId, token });
      const data = resp.data || {};
      if (!data.success) {
        setError(data.error || 'Failed to accept invitation.');
        setAccepting(false);
        return;
      }

      setSuccess(true);
      setTimeout(() => {
        localStorage.setItem('esop_active_company_id', data.companyId);
        window.location.href = '/';
      }, 2000);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Failed to accept invitation');
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
            <p className="text-sm text-app-text-2 mb-4">Join <strong>{company?.name}</strong> as a <strong>{getRoleLabel(invitation?.intendedRole, company)}</strong>.</p>
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