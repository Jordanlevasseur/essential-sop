import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useApp } from '@/lib/AppContext';
import { ArrowLeft, AlertTriangle, CheckCircle2, Clock, Trash2, Info } from 'lucide-react';

const STATUS_STYLES = {
  Pending:   { bg: 'bg-app-warning-bg',  border: 'border-app-warning',  text: 'text-app-warning',  icon: Clock },
  Completed: { bg: 'bg-app-success-bg',  border: 'border-app-success',  text: 'text-app-success',  icon: CheckCircle2 },
  Cancelled: { bg: 'bg-app-elevated',    border: 'border-app-border',   text: 'text-app-text-muted', icon: Info },
};

export default function DeletionRequests() {
  const navigate = useNavigate();
  const { isPlatformSuperAdmin } = useApp();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null); // id of record being saved
  const [editNotes, setEditNotes] = useState({});
  const [actionError, setActionError] = useState('');

  // Direct client access to DeletionRequest is blocked by RLS. The admin panel
  // reads/processed exclusively through these backend-verified functions
  // (resolveDeletionRequests / manageDeletionRequest), which check an active
  // PlatformMembership(SUPER_ADMIN) on the backend — not a client flag.
  useEffect(() => {
    if (!isPlatformSuperAdmin) { navigate('/'); return; }
    base44.functions.invoke('resolveDeletionRequests', {})
      .then(res => { setRequests(res.data?.requests || []); setLoading(false); })
      .catch(() => { setActionError('Failed to load deletion requests.'); setLoading(false); });
  }, [isPlatformSuperAdmin]);

  const handleStatusChange = async (req, newStatus) => {
    setSaving(req.id);
    setActionError('');
    try {
      const action = newStatus === 'Completed' ? 'complete' : 'cancel';
      const res = await base44.functions.invoke('manageDeletionRequest', {
        action,
        requestId: req.id,
        adminNotes: editNotes[req.id] ?? req.adminNotes ?? '',
      });
      const data = res.data || {};
      if (!data.success) {
        setActionError(data.error || 'Failed to update request.');
      } else if (data.request) {
        setRequests(prev => prev.map(r => r.id === req.id ? data.request : r));
      }
    } catch (e) {
      const data = e?.response?.data || e?.data || {};
      setActionError(data.error || e?.message || 'Failed to update request.');
    } finally {
      setSaving(null);
    }
  };

  const handleNotesChange = (id, value) => setEditNotes(prev => ({ ...prev, [id]: value }));

  const handleSaveNotes = async (req) => {
    setSaving(req.id);
    setActionError('');
    try {
      const res = await base44.functions.invoke('manageDeletionRequest', {
        action: 'save_notes',
        requestId: req.id,
        adminNotes: editNotes[req.id] ?? req.adminNotes ?? '',
      });
      const data = res.data || {};
      if (data.request) {
        setRequests(prev => prev.map(r => r.id === req.id ? data.request : r));
      }
    } catch (e) {
      const data = e?.response?.data || e?.data || {};
      setActionError(data.error || 'Failed to save notes.');
    } finally {
      setSaving(null);
    }
  };

  const pending = requests.filter(r => r.status === 'Pending');
  const completed = requests.filter(r => r.status !== 'Pending');

  if (!isPlatformSuperAdmin) return null;

  return (
    <div className="min-h-screen bg-app-bg" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      {/* Header */}
      <div className="bg-app-surface border-b border-app-border sticky top-0 z-40" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="px-3 py-2.5 flex items-center gap-2.5 max-w-2xl mx-auto">
          <button onClick={() => navigate(-1)} className="icon-btn no-select touch-active" aria-label="Back">
            <ArrowLeft size={22} className="text-app-text-2" />
          </button>
          <div className="flex-1">
            <h1 className="font-semibold text-app-text">Account Deletion Requests</h1>
            <p className="text-xs text-app-text-muted">Admin only</p>
          </div>
          {pending.length > 0 && (
            <span className="px-2 py-0.5 bg-app-danger text-white text-xs font-bold rounded-full">{pending.length}</span>
          )}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-5 pb-16">

        {actionError && (
          <div className="flex items-start gap-2 p-3 mb-4 bg-app-danger-bg border border-app-danger rounded-lg">
            <AlertTriangle size={16} className="text-app-danger flex-shrink-0 mt-0.5" />
            <p className="text-sm text-app-danger">{actionError}</p>
          </div>
        )}

        {/* How-to banner */}
        <div className="flex items-start gap-3 p-4 mb-5 bg-app-info-bg border border-app-border rounded-xl">
          <Info size={16} className="text-app-info flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-app-text mb-1">Manual step required for each Pending request</p>
            <ol className="text-xs text-app-text-2 space-y-0.5 list-decimal pl-4">
              <li>Go to <strong>Base44 Dashboard → Your App → Users</strong></li>
              <li>Search for the user by their email address listed below</li>
              <li>Click <strong>Remove User</strong> and confirm (removes the login identity)</li>
              <li>Return here and click <strong>Mark Completed</strong> — this removes the user's personal data (notifications, memberships) and records the deletion as complete</li>
            </ol>
            <p className="text-xs text-app-text-muted mt-1.5">
              Base44 does not expose a server-side API to delete auth identities programmatically.
              This manual step is required to satisfy App Store account-deletion requirements.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-7 h-7 border-4 border-app-border border-t-app-accent rounded-full animate-spin" />
          </div>
        ) : requests.length === 0 ? (
          <div className="text-center py-12">
            <CheckCircle2 size={32} className="text-app-text-disabled mx-auto mb-2" />
            <p className="text-sm text-app-text-muted">No deletion requests on file.</p>
          </div>
        ) : (
          <>
            {pending.length > 0 && (
              <Section title={`Pending (${pending.length})`}>
                {pending.map(req => <RequestCard key={req.id} req={req} editNotes={editNotes} onNotesChange={handleNotesChange} onSaveNotes={handleSaveNotes} onStatusChange={handleStatusChange} saving={saving} />)}
              </Section>
            )}
            {completed.length > 0 && (
              <Section title="Resolved">
                {completed.map(req => <RequestCard key={req.id} req={req} editNotes={editNotes} onNotesChange={handleNotesChange} onSaveNotes={handleSaveNotes} onStatusChange={handleStatusChange} saving={saving} />)}
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="mb-6">
      <h2 className="text-xs font-semibold text-app-text-muted uppercase mb-2 px-1">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function RequestCard({ req, editNotes, onNotesChange, onSaveNotes, onStatusChange, saving }) {
  const style = STATUS_STYLES[req.status] || STATUS_STYLES.Pending;
  const StatusIcon = style.icon;
  const isSaving = saving === req.id;
  const noteValue = editNotes[req.id] ?? req.adminNotes ?? '';

  return (
    <div className="bg-app-card border border-app-border rounded-xl overflow-hidden">
      {/* Status bar */}
      <div className={`flex items-center gap-2 px-4 py-2 border-b ${style.bg} ${style.border}`}>
        <StatusIcon size={14} className={style.text} />
        <span className={`text-xs font-semibold ${style.text}`}>{req.status}</span>
        <span className="ml-auto text-xs text-app-text-muted">{req.requestedAt ? new Date(req.requestedAt).toLocaleDateString() : '—'}</span>
      </div>

      <div className="p-4 space-y-3">
        {/* User info */}
        <div>
          <p className="text-sm font-semibold text-app-text">{req.userName || '(no name)'}</p>
          <p className="text-xs text-app-text-2 font-mono mt-0.5">{req.userEmail}</p>
          <p className="text-xs text-app-text-muted mt-0.5">User ID: {req.userId}</p>
        </div>

        {/* Timestamps */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-app-elevated rounded-lg p-2">
            <p className="text-app-text-muted mb-0.5">App data removed</p>
            <p className="text-app-text font-medium">{req.appDataDeletedAt ? new Date(req.appDataDeletedAt).toLocaleString() : '—'}</p>
          </div>
          <div className={`rounded-lg p-2 ${req.authIdentityDeletedAt ? 'bg-app-success-bg' : 'bg-app-warning-bg'}`}>
            <p className={`mb-0.5 ${req.authIdentityDeletedAt ? 'text-app-success' : 'text-app-warning'}`}>Auth identity removed</p>
            <p className={`font-medium ${req.authIdentityDeletedAt ? 'text-app-success' : 'text-app-warning'}`}>
              {req.authIdentityDeletedAt ? new Date(req.authIdentityDeletedAt).toLocaleString() : 'Pending manual step'}
            </p>
          </div>
        </div>

        {/* Admin notes */}
        <div>
          <label className="text-xs font-semibold text-app-text-muted uppercase block mb-1">Admin Notes</label>
          <textarea
            rows={2}
            value={noteValue}
            onChange={e => onNotesChange(req.id, e.target.value)}
            placeholder="Add notes..."
            className="w-full px-3 py-2 bg-app-input border border-app-border rounded-lg text-xs text-app-text placeholder:text-app-text-muted focus:outline-none focus:border-app-accent"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2 flex-wrap">
          {noteValue !== (req.adminNotes ?? '') && (
            <button onClick={() => onSaveNotes(req)} disabled={isSaving}
              className="px-3 py-1.5 bg-app-elevated border border-app-border rounded-lg text-xs font-medium text-app-text-2 disabled:opacity-50">
              {isSaving ? 'Saving…' : 'Save Notes'}
            </button>
          )}
          {req.status === 'Pending' && (
            <>
              <button onClick={() => onStatusChange(req, 'Completed')} disabled={isSaving}
                className="px-3 py-1.5 bg-app-success text-white rounded-lg text-xs font-semibold disabled:opacity-50 flex items-center gap-1">
                <CheckCircle2 size={12} /> Mark Completed
              </button>
              <button onClick={() => onStatusChange(req, 'Cancelled')} disabled={isSaving}
                className="px-3 py-1.5 border border-app-border rounded-lg text-xs font-medium text-app-text-muted disabled:opacity-50">
                Cancel Request
              </button>
            </>
          )}
          {req.status === 'Completed' && (
            <span className="text-xs text-app-success flex items-center gap-1">
              <CheckCircle2 size={12} /> Fully resolved
              {req.completedAt && ` · ${new Date(req.completedAt).toLocaleDateString()}`}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}