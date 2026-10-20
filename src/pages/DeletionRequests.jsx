import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSafeBack } from '@/lib/useSafeBack';
import { base44 } from '@/api/base44Client';
import { useApp } from '@/lib/AppContext';
import { ArrowLeft, AlertTriangle, CheckCircle2, Clock, Info, Mail, MailX } from 'lucide-react';

const STATUS_STYLES = {
  Pending:   { bg: 'bg-app-warning-bg',  border: 'border-app-warning',  text: 'text-app-warning',  icon: Clock },
  Completed: { bg: 'bg-app-success-bg',  border: 'border-app-success',  text: 'text-app-success',  icon: CheckCircle2 },
  Cancelled: { bg: 'bg-app-elevated',    border: 'border-app-border',   text: 'text-app-text-muted', icon: Info },
};

export default function DeletionRequests() {
  const navigate = useNavigate();
  const handleBack = useSafeBack('/profile');
  const { isPlatformSuperAdmin } = useApp();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [editNotes, setEditNotes] = useState({});
  const [actionError, setActionError] = useState('');
  const [preflightCache, setPreflightCache] = useState({});
  const [preflightLoading, setPreflightLoading] = useState(null);

  useEffect(() => {
    if (!isPlatformSuperAdmin) { navigate('/'); return; }
    base44.functions.invoke('resolveDeletionRequests', {})
      .then(res => { setRequests(res.data?.requests || []); setLoading(false); })
      .catch(() => { setActionError('Failed to load deletion requests.'); setLoading(false); });
  }, [isPlatformSuperAdmin]);

  const handlePreflight = async (req) => {
    setPreflightLoading(req.id);
    setActionError('');
    try {
      const res = await base44.functions.invoke('manageDeletionRequest', { action: 'preflight', requestId: req.id });
      const data = res.data || {};
      if (data.success) {
        setPreflightCache(prev => ({ ...prev, [req.id]: { canProceed: data.canProceed, blockers: data.blockers || [], singleOwnerCompanies: data.singleOwnerCompanies || [] } }));
      } else {
        setActionError(data.error || 'Preflight failed.');
      }
    } catch (e) {
      const data = e?.response?.data || e?.data || {};
      setActionError(data.error || e?.message || 'Preflight failed.');
    } finally {
      setPreflightLoading(null);
    }
  };

  const handleStatusChange = async (req, newStatus, opts = {}) => {
    setSaving(req.id);
    setActionError('');
    try {
      const action = newStatus === 'Completed' ? 'complete' : 'cancel';
      const payload = { action, requestId: req.id, adminNotes: editNotes[req.id] ?? req.adminNotes ?? '' };
      if (newStatus === 'Completed') payload.authIdentityRemoved = !!opts.authIdentityRemoved;
      const res = await base44.functions.invoke('manageDeletionRequest', payload);
      const data = res.data || {};
      if (!data.success) {
        setActionError(data.error || 'Failed to update request.');
        if (data.blockers) setPreflightCache(prev => ({ ...prev, [req.id]: { canProceed: false, blockers: data.blockers, singleOwnerCompanies: [] } }));
      } else if (data.request) {
        setRequests(prev => prev.map(r => r.id === req.id ? data.request : r));
        setPreflightCache(prev => { const next = { ...prev }; delete next[req.id]; return next; });
      }
    } catch (e) {
      const data = e?.response?.data || e?.data || {};
      setActionError(data.error || e?.message || 'Failed to update request.');
    } finally {
      setSaving(null);
    }
  };

  const handleRecordNotification = async (req, channel) => {
    setSaving(req.id);
    setActionError('');
    try {
      const res = await base44.functions.invoke('manageDeletionRequest', { action: 'record_notification', requestId: req.id, userNotifiedVia: channel });
      const data = res.data || {};
      if (!data.success) {
        setActionError(data.error || 'Failed to record notification.');
      } else if (data.request) {
        setRequests(prev => prev.map(r => r.id === req.id ? data.request : r));
      }
    } catch (e) {
      const data = e?.response?.data || e?.data || {};
      setActionError(data.error || e?.message || 'Failed to record notification.');
    } finally {
      setSaving(null);
    }
  };

  const handleNotesChange = (id, value) => setEditNotes(prev => ({ ...prev, [id]: value }));

  const handleSaveNotes = async (req) => {
    setSaving(req.id);
    setActionError('');
    try {
      const res = await base44.functions.invoke('manageDeletionRequest', { action: 'save_notes', requestId: req.id, adminNotes: editNotes[req.id] ?? req.adminNotes ?? '' });
      const data = res.data || {};
      if (data.request) setRequests(prev => prev.map(r => r.id === req.id ? data.request : r));
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
    <div className="min-h-screen bg-app-bg">
      <div className="bg-app-surface border-b border-app-border sticky top-0 z-40" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="px-3 py-2.5 flex items-center gap-2.5 max-w-2xl mx-auto">
          <button onClick={handleBack} className="icon-btn no-select touch-active" aria-label="Back">
            <ArrowLeft size={22} className="text-app-text-2" />
          </button>
          <div className="flex-1">
            <h1 className="text-semibold text-app-text">Account Deletion Requests</h1>
            <p className="text-xs text-app-text-muted">Admin only</p>
          </div>
          {pending.length > 0 && (
            <span className="px-2 py-0.5 bg-app-danger text-white text-xs font-bold rounded-full">{pending.length}</span>
          )}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-5">

        {actionError && (
          <div className="flex items-start gap-2 p-3 mb-4 bg-app-danger-bg border border-app-danger rounded-lg">
            <AlertTriangle size={16} className="text-app-danger flex-shrink-0 mt-0.5" />
            <p className="text-sm text-app-danger">{actionError}</p>
          </div>
        )}

        <div className="flex items-start gap-3 p-4 mb-5 bg-app-info-bg border border-app-border rounded-xl">
          <Info size={16} className="text-app-info flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-app-text mb-1">Process for each Pending request</p>
            <ol className="text-xs text-app-text-2 space-y-0.5 list-decimal pl-4">
              <li>Click <strong>Check Prerequisites</strong>. A single-person workspace (sole owner, only member) will be closed automatically — only a sole GM with other active members blocks completion.</li>
              <li>If prerequisites are met, go to <strong>Base44 Dashboard → Users</strong> and click <strong>Remove User</strong>.</li>
              <li>Click <strong>Mark Completed</strong> and confirm the attestation. This deletes personal data and records completion.</li>
              <li>If the completion email could not be delivered, notify the user via a verified channel and record it below the request.</li>
            </ol>
            <p className="text-xs text-app-text-muted mt-1.5">
              Base44 exposes no API to delete auth identities or verify their removal; the completion timestamp is the administrator's manual attestation.
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
                {pending.map(req => (
                  <RequestCard key={req.id} req={req} editNotes={editNotes} onNotesChange={handleNotesChange}
                    onSaveNotes={handleSaveNotes} onStatusChange={handleStatusChange} onPreflight={handlePreflight}
                    onRecordNotification={handleRecordNotification} saving={saving}
                    preflight={preflightCache[req.id]} preflightLoading={preflightLoading === req.id} />
                ))}
              </Section>
            )}
            {completed.length > 0 && (
              <Section title="Resolved">
                {completed.map(req => (
                  <RequestCard key={req.id} req={req} editNotes={editNotes} onNotesChange={handleNotesChange}
                    onSaveNotes={handleSaveNotes} onStatusChange={handleStatusChange} onPreflight={handlePreflight}
                    onRecordNotification={handleRecordNotification} saving={saving}
                    preflight={preflightCache[req.id]} preflightLoading={preflightLoading === req.id} />
                ))}
              </Section>
            )}
          </>
        )}
      </div>

      <div style={{ height: 'calc(16px + env(safe-area-inset-bottom))' }} />
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

const NOTIF_LABELS = {
  pending: { label: 'Pending', text: 'text-app-warning', bg: 'bg-app-warning-bg', icon: Clock },
  email_sent: { label: 'Email sent', text: 'text-app-success', bg: 'bg-app-success-bg', icon: Mail },
  email_failed: { label: 'Email failed', text: 'text-app-danger', bg: 'bg-app-danger-bg', icon: MailX },
  admin_notified: { label: 'Admin notified', text: 'text-app-success', bg: 'bg-app-success-bg', icon: CheckCircle2 },
};

function RequestCard({ req, editNotes, onNotesChange, onSaveNotes, onStatusChange, onPreflight, onRecordNotification, saving, preflight, preflightLoading }) {
  const style = STATUS_STYLES[req.status] || STATUS_STYLES.Pending;
  const StatusIcon = style.icon;
  const isSaving = saving === req.id;
  const noteValue = editNotes[req.id] ?? req.adminNotes ?? '';
  const [confirming, setConfirming] = useState(false);
  const [attested, setAttested] = useState(false);
  const [notifChannel, setNotifChannel] = useState('');
  const preflightClear = preflight?.canProceed === true;
  const notif = NOTIF_LABELS[req.notificationStatus] || NOTIF_LABELS.pending;
  const NotifIcon = notif.icon;
  const needsNotifRecord = req.status === 'Completed' && req.notificationStatus !== 'email_sent' && req.notificationStatus !== 'admin_notified';

  return (
    <div className="bg-app-card border border-app-border rounded-xl overflow-hidden">
      <div className={`flex items-center gap-2 px-4 py-2 border-b ${style.bg} ${style.border}`}>
        <StatusIcon size={14} className={style.text} />
        <span className={`text-xs font-semibold ${style.text}`}>{req.status}</span>
        <span className="ml-auto text-xs text-app-text-muted">{req.requestedAt ? new Date(req.requestedAt).toLocaleDateString() : '—'}</span>
      </div>

      <div className="p-4 space-y-3">
        <div>
          <p className="text-sm font-semibold text-app-text">{req.userName || '(no name)'}</p>
          <p className="text-xs text-app-text-2 font-mono mt-0.5">{req.userEmail}</p>
          <p className="text-xs text-app-text-muted mt-0.5">User ID: {req.userId}</p>
        </div>

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

        {Array.isArray(req.closedCompanyIds) && req.closedCompanyIds.length > 0 && (
          <div className="bg-app-elevated rounded-lg p-2 text-xs text-app-text-2">
            <span className="font-medium">Closed workspace(s): </span>{req.closedCompanyIds.join(', ')}
          </div>
        )}

        <div>
          <label className="text-xs font-semibold text-app-text-muted uppercase block mb-1">Admin Notes</label>
          <textarea rows={2} value={noteValue} onChange={e => onNotesChange(req.id, e.target.value)} placeholder="Add notes..."
            className="w-full px-3 py-2 bg-app-input border border-app-border rounded-lg text-xs text-app-text placeholder:text-app-text-muted focus:outline-none focus:border-app-accent" />
        </div>

        {req.status === 'Pending' && (
          <div className="border-t border-app-divider pt-3 space-y-2">
            <p className="text-xs font-semibold text-app-text-muted uppercase">Step 1 — Check prerequisites</p>
            <button onClick={() => onPreflight(req)} disabled={preflightLoading}
              className="px-3 py-1.5 bg-app-elevated border border-app-border rounded-lg text-xs font-medium text-app-text-2 disabled:opacity-50">
              {preflightLoading ? 'Checking…' : 'Check Prerequisites'}
            </button>
            {preflight && !preflight.canProceed && (
              <div className="bg-app-danger-bg border border-app-danger rounded-lg p-2 space-y-1">
                {preflight.blockers.map((b, i) => (
                  <p key={i} className="text-xs text-app-danger flex items-start gap-1"><AlertTriangle size={11} className="mt-0.5 flex-shrink-0" />{b.message}</p>
                ))}
              </div>
            )}
            {preflightClear && (
              <>
                <p className="text-xs text-app-success flex items-center gap-1"><CheckCircle2 size={12} /> Prerequisites met. Proceed to Step 2.</p>
                {preflight.singleOwnerCompanies?.length > 0 && (
                  <div className="bg-app-info-bg border border-app-border rounded-lg p-2 text-xs text-app-text-2">
                    <span className="font-semibold text-app-text">Will close single-person workspace(s): </span>
                    {preflight.singleOwnerCompanies.map(c => c.companyName).join(', ')}. Data is retained (closed, not deleted).
                  </div>
                )}
                <div className="bg-app-info-bg border border-app-border rounded-lg p-2 text-xs text-app-text-2 leading-relaxed">
                  <p className="font-semibold text-app-text mb-1">Step 2 — Remove login identity</p>
                  Go to <strong>Base44 Dashboard → Users</strong>, find this user by email, and click <strong>Remove User</strong>. Then return here and click Mark Completed.
                </div>
              </>
            )}
          </div>
        )}

        {/* Completion notification (Completed requests) */}
        {req.status === 'Completed' && (
          <div className="border-t border-app-divider pt-3 space-y-2">
            <p className="text-xs font-semibold text-app-text-muted uppercase">Completion notification</p>
            <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg ${notif.bg} w-fit`}>
              <NotifIcon size={13} className={notif.text} />
              <span className={`text-xs font-medium ${notif.text}`}>{notif.label}</span>
              {req.userNotifiedVia && <span className="text-xs text-app-text-muted">· {req.userNotifiedVia}</span>}
            </div>
            {req.notificationStatus === 'email_failed' && req.notificationError && (
              <p className="text-xs text-app-danger">Delivery not accepted: {req.notificationError}</p>
            )}
            {needsNotifRecord && (
              <div className="space-y-2">
                <p className="text-xs text-app-text-2 leading-relaxed">
                  Email delivery was not confirmed. Contact the user via a verified channel (e.g., reply to their request, phone) and record how you notified them.
                </p>
                <div className="flex gap-2">
                  <input value={notifChannel} onChange={e => setNotifChannel(e.target.value)} placeholder="e.g., email reply, phone"
                    className="flex-1 px-3 py-1.5 bg-app-input border border-app-border rounded-lg text-xs text-app-text placeholder:text-app-text-muted focus:outline-none focus:border-app-accent" />
                  <button onClick={() => { if (notifChannel.trim()) onRecordNotification(req, notifChannel.trim()); }} disabled={isSaving || !notifChannel.trim()}
                    className="px-3 py-1.5 bg-app-accent text-app-accent-text rounded-lg text-xs font-semibold disabled:opacity-50">
                    {isSaving ? 'Saving…' : 'Record'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          {noteValue !== (req.adminNotes ?? '') && (
            <button onClick={() => onSaveNotes(req)} disabled={isSaving}
              className="px-3 py-1.5 bg-app-elevated border border-app-border rounded-lg text-xs font-medium text-app-text-2 disabled:opacity-50">
              {isSaving ? 'Saving…' : 'Save Notes'}
            </button>
          )}
          {req.status === 'Pending' && (
            <>
              {!confirming ? (
                <button onClick={() => setConfirming(true)} disabled={isSaving || !preflightClear}
                  className="px-3 py-1.5 bg-app-success text-white rounded-lg text-xs font-semibold disabled:opacity-50 flex items-center gap-1">
                  <CheckCircle2 size={12} /> Mark Completed
                </button>
              ) : (
                <div className="w-full space-y-2 border border-app-success rounded-lg p-2.5 bg-app-success-bg">
                  <label className="flex items-start gap-2 text-xs text-app-text">
                    <input type="checkbox" checked={attested} onChange={e => setAttested(e.target.checked)} className="mt-0.5" />
                    <span>I confirm I have removed the user's login identity in the Base44 Dashboard.</span>
                  </label>
                  <div className="flex gap-2">
                    <button onClick={() => { setConfirming(false); setAttested(false); }} disabled={isSaving}
                      className="px-3 py-1.5 border border-app-border rounded-lg text-xs font-medium text-app-text-2 disabled:opacity-50">Cancel</button>
                    <button onClick={() => onStatusChange(req, 'Completed', { authIdentityRemoved: true })} disabled={isSaving || !attested}
                      className="px-3 py-1.5 bg-app-success text-white rounded-lg text-xs font-semibold disabled:opacity-50 flex items-center gap-1">
                      {isSaving ? 'Completing…' : 'Confirm Completion'}
                    </button>
                  </div>
                </div>
              )}
              <button onClick={() => onStatusChange(req, 'Cancelled')} disabled={isSaving}
                className="px-3 py-1.5 border border-app-border rounded-lg text-xs font-medium text-app-text-muted disabled:opacity-50">Cancel Request</button>
            </>
          )}
          {req.status === 'Completed' && (
            <span className="text-xs text-app-success flex items-center gap-1">
              <CheckCircle2 size={12} /> Fully resolved{req.completedAt && ` · ${new Date(req.completedAt).toLocaleDateString()}`}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}