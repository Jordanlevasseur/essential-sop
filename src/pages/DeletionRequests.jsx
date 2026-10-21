import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSafeBack } from '@/lib/useSafeBack';
import { base44 } from '@/api/base44Client';
import { useApp } from '@/lib/AppContext';
import { ArrowLeft, AlertTriangle, CheckCircle2, Clock, Info, Mail, MailX, Building2, User, X, FileText, RefreshCw } from 'lucide-react';

const STATUS_STYLES = {
  Pending:        { bg: 'bg-app-warning-bg',  border: 'border-app-warning',  text: 'text-app-warning',  icon: Clock },
  Approved:       { bg: 'bg-app-info-bg',     border: 'border-app-info',    text: 'text-app-info',     icon: Info },
  CleanupPending: { bg: 'bg-app-info-bg',     border: 'border-app-info',    text: 'text-app-info',     icon: Clock },
  Rejected:       { bg: 'bg-app-elevated',    border: 'border-app-border',  text: 'text-app-text-muted', icon: X },
  Completed:      { bg: 'bg-app-success-bg',   border: 'border-app-success', text: 'text-app-success',  icon: CheckCircle2 },
  Cancelled:      { bg: 'bg-app-elevated',    border: 'border-app-border',  text: 'text-app-text-muted', icon: Info },
  Failed:         { bg: 'bg-app-danger-bg',   border: 'border-app-danger',  text: 'text-app-danger',   icon: AlertTriangle },
};

const TYPE_LABELS = {
  PERSONAL_ACCOUNT_DELETION: { label: 'Personal Account', icon: User, tone: 'text-app-text-muted' },
  COMPANY_DELETION: { label: 'Company Deletion', icon: Building2, tone: 'text-app-danger' },
};

function typeOf(req) { return req.requestType || 'PERSONAL_ACCOUNT_DELETION'; }

export default function DeletionRequests() {
  const navigate = useNavigate();
  const handleBack = useSafeBack('/profile');
  const { isPlatformSuperAdmin } = useApp();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [editNotes, setEditNotes] = useState({});
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    if (!isPlatformSuperAdmin) { navigate('/'); return; }
    base44.functions.invoke('resolveDeletionRequests', {})
      .then(res => { setRequests(res.data?.requests || []); setLoading(false); })
      .catch(() => { setActionError('Failed to load deletion requests.'); setLoading(false); });
  }, [isPlatformSuperAdmin]);

  const refresh = (req) => setRequests(prev => prev.map(r => r.id === req.id ? req : r));

  const callManage = async (payload, onOk) => {
    setSaving(payload.requestId); setActionError('');
    try {
      const res = await base44.functions.invoke('manageDeletionRequest', payload);
      const data = res.data || {};
      if (!data.success) {
        setActionError(data.error || 'Action failed.');
        if (data.blockers) setActionError(prev => prev + ' ' + data.blockers.map(b => b.message).join(' '));
      } else if (onOk) onOk(data);
    } catch (e) {
      const data = e?.response?.data || e?.data || {};
      setActionError(data.error || e?.message || 'Action failed.');
    } finally {
      setSaving(null);
    }
  };

  const handleNotesChange = (id, value) => setEditNotes(prev => ({ ...prev, [id]: value }));

  if (!isPlatformSuperAdmin) return null;

  const pending = requests.filter(r => r.status === 'Pending' || r.status === 'Approved' || r.status === 'CleanupPending' || r.status === 'Failed');
  const resolved = requests.filter(r => r.status !== 'Pending' && r.status !== 'Approved' && r.status !== 'CleanupPending' && r.status !== 'Failed');

  return (
    <div className="min-h-screen bg-app-bg">
      <div className="bg-app-surface border-b border-app-border sticky top-0 z-40" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="px-3 py-2.5 flex items-center gap-2.5 max-w-2xl mx-auto">
          <button onClick={handleBack} className="icon-btn no-select touch-active" aria-label="Back">
            <ArrowLeft size={22} className="text-app-text-2" />
          </button>
          <div className="flex-1">
            <h1 className="text-semibold text-app-text">Deletion Requests</h1>
            <p className="text-xs text-app-text-muted">Platform Super Admin</p>
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
          <div className="text-xs text-app-text-2 space-y-1.5">
            <p><strong className="text-app-text">Personal Account Deletion</strong> — a user requests deletion of their own account. The GM is notified for work handoff but cannot reject or cancel. Process: Check Prerequisites → remove the login identity in the Dashboard → Mark Completed (attest). Single-person workspaces are closed automatically; a sole GM with other members must transfer ownership first.</p>
            <p><strong className="text-app-text">Company Deletion</strong> — a General Manager requests permanent deletion of their workspace. View the scope, then Approve or Reject. After approval, run Execute Deletion (irreversible) to permanently remove the company and its data. If the company had private file attachments, the request moves to <strong>Cleanup Pending</strong>: the admin must contact Base44 support with the captured file URIs to purge the underlying storage objects and obtain a support-case reference, then record it to mark the request Completed. The requester's authorization and company state are revalidated on the first execution; a failed execution can be retried idempotently without re-checking the (now-revoked) GM.</p>
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
              <Section title={`Active (${pending.length})`}>
                {pending.map(req => (
                  <RequestCard key={req.id} req={req} editNotes={editNotes} onNotesChange={handleNotesChange}
                    callManage={callManage} refresh={refresh} saving={saving} setActionError={setActionError} />
                ))}
              </Section>
            )}
            {resolved.length > 0 && (
              <Section title="Resolved">
                {resolved.map(req => (
                  <RequestCard key={req.id} req={req} editNotes={editNotes} onNotesChange={handleNotesChange}
                    callManage={callManage} refresh={refresh} saving={saving} setActionError={setActionError} />
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

function TypeBadge({ req }) {
  const t = TYPE_LABELS[typeOf(req)];
  const Icon = t.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${t.tone}`}>
      <Icon size={12} /> {t.label}
    </span>
  );
}

function RequestCard({ req, editNotes, onNotesChange, callManage, refresh, saving, setActionError }) {
  if (typeOf(req) === 'COMPANY_DELETION') {
    return <CompanyRequestCard req={req} editNotes={editNotes} onNotesChange={onNotesChange} callManage={callManage} refresh={refresh} saving={saving} setActionError={setActionError} />;
  }
  return <PersonalRequestCard req={req} editNotes={editNotes} onNotesChange={onNotesChange} callManage={callManage} refresh={refresh} saving={saving} />;
}

// ── Personal Account Deletion ───────────────────────────────────────────────
const NOTIF_LABELS = {
  pending: { label: 'Pending', text: 'text-app-warning', bg: 'bg-app-warning-bg', icon: Clock },
  email_sent: { label: 'Email sent', text: 'text-app-success', bg: 'bg-app-success-bg', icon: Mail },
  email_failed: { label: 'Email failed', text: 'text-app-danger', bg: 'bg-app-danger-bg', icon: MailX },
  admin_notified: { label: 'Admin notified', text: 'text-app-success', bg: 'bg-app-success-bg', icon: CheckCircle2 },
};

function PersonalRequestCard({ req, editNotes, onNotesChange, callManage, refresh, saving }) {
  const style = STATUS_STYLES[req.status] || STATUS_STYLES.Pending;
  const StatusIcon = style.icon;
  const isSaving = saving === req.id;
  const noteValue = editNotes[req.id] ?? req.adminNotes ?? '';
  const [confirming, setConfirming] = useState(false);
  const [attested, setAttested] = useState(false);
  const [preflight, setPreflight] = useState(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [notifChannel, setNotifChannel] = useState('');
  const preflightClear = preflight?.canProceed === true;
  const notif = NOTIF_LABELS[req.notificationStatus] || NOTIF_LABELS.pending;
  const NotifIcon = notif.icon;
  const needsNotifRecord = req.status === 'Completed' && req.notificationStatus !== 'email_sent' && req.notificationStatus !== 'admin_notified';

  const onPreflight = async () => {
    setPreflightLoading(true);
    await callManage({ action: 'preflight', requestId: req.id }, (data) => {
      setPreflight({ canProceed: data.canProceed, blockers: data.blockers || [], singleOwnerCompanies: data.singleOwnerCompanies || [] });
    });
    setPreflightLoading(false);
  };

  return (
    <div className="bg-app-card border border-app-border rounded-xl overflow-hidden">
      <div className={`flex items-center gap-2 px-4 py-2 border-b ${style.bg} ${style.border}`}>
        <StatusIcon size={14} className={style.text} />
        <span className={`text-xs font-semibold ${style.text}`}>{req.status}</span>
        <span className="ml-2"><TypeBadge req={req} /></span>
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

        <NotesBlock req={req} noteValue={noteValue} onNotesChange={onNotesChange} callManage={callManage} isSaving={isSaving} />

        {req.status === 'Pending' && (
          <div className="border-t border-app-divider pt-3 space-y-2">
            <p className="text-xs font-semibold text-app-text-muted uppercase">Step 1 — Check prerequisites</p>
            <button onClick={onPreflight} disabled={preflightLoading}
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
                  Go to the Dashboard → Users, find this user by email, and remove the user. Then return here and click Mark Completed.
                </div>
              </>
            )}
          </div>
        )}

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
                  Email delivery was not confirmed. Contact the user via a verified channel and record how you notified them.
                </p>
                <div className="flex gap-2">
                  <input value={notifChannel} onChange={e => setNotifChannel(e.target.value)} placeholder="e.g., email reply, phone"
                    className="flex-1 px-3 py-1.5 bg-app-input border border-app-border rounded-lg text-xs text-app-text focus:outline-none focus:border-app-accent" />
                  <button onClick={() => { if (notifChannel.trim()) callManage({ action: 'record_notification', requestId: req.id, userNotifiedVia: notifChannel.trim() }, (d) => refresh(d.request)); }} disabled={isSaving || !notifChannel.trim()}
                    className="px-3 py-1.5 bg-app-accent text-app-accent-text rounded-lg text-xs font-semibold disabled:opacity-50">
                    {isSaving ? 'Saving…' : 'Record'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
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
                    <span>I confirm I have removed the user's login identity in the Dashboard.</span>
                  </label>
                  <div className="flex gap-2">
                    <button onClick={() => { setConfirming(false); setAttested(false); }} disabled={isSaving}
                      className="px-3 py-1.5 border border-app-border rounded-lg text-xs font-medium text-app-text-2 disabled:opacity-50">Cancel</button>
                    <button onClick={() => callManage({ action: 'complete', requestId: req.id, authIdentityRemoved: true }, (d) => { refresh(d.request); setPreflight(null); })} disabled={isSaving || !attested}
                      className="px-3 py-1.5 bg-app-success text-white rounded-lg text-xs font-semibold disabled:opacity-50 flex items-center gap-1">
                      {isSaving ? 'Completing…' : <><CheckCircle2 size={12} /> Confirm Completion</>}
                    </button>
                  </div>
                </div>
              )}
              <button onClick={() => callManage({ action: 'cancel', requestId: req.id }, (d) => refresh(d.request))} disabled={isSaving}
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

// ── Company Deletion ─────────────────────────────────────────────────────────
function CompanyRequestCard({ req, editNotes, onNotesChange, callManage, refresh, saving, setActionError }) {
  const style = STATUS_STYLES[req.status] || STATUS_STYLES.Pending;
  const StatusIcon = style.icon;
  const isSaving = saving === req.id;
  const noteValue = editNotes[req.id] ?? req.adminNotes ?? '';
  const [scope, setScope] = useState(null);
  const [scopeLoading, setScopeLoading] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [execConfirm, setExecConfirm] = useState(false);
  const [cleanupConfirm, setCleanupConfirm] = useState(false);
  const [cleanupNotes, setCleanupNotes] = useState('');
  const [notifChannel, setNotifChannel] = useState('');
  const notif = NOTIF_LABELS[req.notificationStatus] || NOTIF_LABELS.pending;
  const NotifIcon = notif.icon;

  const loadScope = async () => {
    setScopeLoading(true);
    await callManage({ action: 'preflight_company', requestId: req.id }, (data) => {
      setScope({ canProceed: data.canProceed, blockers: data.blockers || [], status: data.status, scope: data.scope });
    });
    setScopeLoading(false);
  };

  const approve = () => callManage({ action: 'approve_company', requestId: req.id }, (d) => { refresh(d.request); setScope(null); });
  const reject = () => callManage({ action: 'reject_company', requestId: req.id, rejectionReason: rejectReason.trim() }, (d) => { refresh(d.request); setRejectOpen(false); setRejectReason(''); setScope(null); });
  const execute = () => callManage({ action: 'execute_company_deletion', requestId: req.id }, (d) => { refresh(d.request); setScope(null); setExecConfirm(false); });
  const confirmCleanup = () => callManage({ action: 'confirm_file_cleanup', requestId: req.id, fileCleanupNotes: cleanupNotes.trim() }, (d) => { refresh(d.request); setCleanupConfirm(false); setCleanupNotes(''); });
  const retryNotif = () => callManage({ action: 'retry_company_completion_notification', requestId: req.id }, (d) => refresh(d.request));
  const recordNotif = () => { if (notifChannel.trim()) callManage({ action: 'record_company_completion_notification', requestId: req.id, userNotifiedVia: notifChannel.trim() }, (d) => { refresh(d.request); setNotifChannel(''); }); };

  return (
    <div className="bg-app-card border border-app-border rounded-xl overflow-hidden">
      <div className={`flex items-center gap-2 px-4 py-2 border-b ${style.bg} ${style.border}`}>
        <StatusIcon size={14} className={style.text} />
        <span className={`text-xs font-semibold ${style.text}`}>{req.status}</span>
        <span className="ml-2"><TypeBadge req={req} /></span>
        <span className="ml-auto text-xs text-app-text-muted">{req.requestedAt ? new Date(req.requestedAt).toLocaleDateString() : '—'}</span>
      </div>

      <div className="p-4 space-y-3">
        <div>
          <p className="text-sm font-semibold text-app-text">{req.companyName || '(company)'}</p>
          <p className="text-xs text-app-text-2 mt-0.5">Requested by: {req.userName || '—'} · {req.userEmail}</p>
          <p className="text-xs text-app-text-muted mt-0.5">Company ID: {req.companyId}</p>
          {req.rejectionReason && <p className="text-xs text-app-text-2 mt-1">Rejection reason: {req.rejectionReason}</p>}
        </div>

        <NotesBlock req={req} noteValue={noteValue} onNotesChange={onNotesChange} callManage={callManage} isSaving={isSaving} />

        {(req.status === 'Pending' || req.status === 'Approved') && (
          <div className="border-t border-app-divider pt-3 space-y-2">
            <p className="text-xs font-semibold text-app-text-muted uppercase">Deletion scope</p>
            <button onClick={loadScope} disabled={scopeLoading}
              className="px-3 py-1.5 bg-app-elevated border border-app-border rounded-lg text-xs font-medium text-app-text-2 disabled:opacity-50">
              {scopeLoading ? 'Loading…' : scope ? 'Refresh scope' : 'View scope & revalidate'}
            </button>
            {scope && (
              <div className="space-y-2">
                {!scope.canProceed && (
                  <div className="bg-app-danger-bg border border-app-danger rounded-lg p-2 space-y-1">
                    {scope.blockers.map((b, i) => (
                      <p key={i} className="text-xs text-app-danger flex items-start gap-1"><AlertTriangle size={11} className="mt-0.5 flex-shrink-0" />{b.message}</p>
                    ))}
                  </div>
                )}
                {scope.canProceed && (
                  <div className="bg-app-info-bg border border-app-border rounded-lg p-2 text-xs text-app-text-2 space-y-1">
                    <p><span className="font-semibold text-app-text">Company:</span> {scope.scope.companyName}</p>
                    <p><span className="font-semibold text-app-text">Requester:</span> {scope.scope.requester.name} ({scope.scope.requester.email}) — {scope.scope.requester.stillGm ? 'still active GM' : 'no longer GM'}</p>
                    <p><span className="font-semibold text-app-text">Active members:</span> {scope.scope.counts.memberships} ({scope.scope.activeMemberships.map(m => m.role).join(', ') || 'none'})</p>
                    <p><span className="font-semibold text-app-text">Will permanently delete:</span> {scope.scope.counts.jobs} SOPs, {scope.scope.counts.resources} resources, {scope.scope.counts.pdfs} PDFs, and all memberships for this company.</p>
                    <p className="text-app-text-muted">Employees' individual login accounts and access to other companies are NOT deleted.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Failed execution — show which steps remain and allow idempotent retry */}
        {req.status === 'Failed' && (
          <div className="border-t border-app-divider pt-3 space-y-2">
            <p className="text-xs font-semibold text-app-danger uppercase">Execution failed — remaining steps</p>
            {Array.isArray(req.executionErrors) && req.executionErrors.length > 0 && (
              <div className="bg-app-danger-bg border border-app-danger rounded-lg p-2 space-y-1">
                {req.executionErrors.map((e, i) => (
                  <p key={i} className="text-xs text-app-danger flex items-start gap-1"><AlertTriangle size={11} className="mt-0.5 flex-shrink-0" />{e}</p>
                ))}
              </div>
            )}
            <p className="text-xs text-app-text-2 leading-relaxed">Retry resumes the deletion idempotently — already-removed records are skipped and authorization revalidation only runs while the company still exists.</p>
            <button onClick={execute} disabled={isSaving}
              className="px-3 py-1.5 bg-app-danger text-white rounded-lg text-xs font-semibold disabled:opacity-50 flex items-center gap-1">
              <RefreshCw size={12} /> {isSaving ? 'Retrying…' : 'Retry Execution'}
            </button>
          </div>
        )}

        {/* CleanupPending — operational data deleted, underlying file content outstanding */}
        {req.status === 'CleanupPending' && (
          <div className="border-t border-app-divider pt-3 space-y-2">
            <p className="text-xs font-semibold text-app-info uppercase flex items-center gap-1"><FileText size={12} /> Outstanding file cleanup</p>
            <div className="bg-app-info-bg border border-app-border rounded-lg p-2 text-xs text-app-text-2 space-y-1">
              <p>Company operational data has been deleted. The underlying private file content below cannot be purged from within the app — Base44 exposes no file-purge API. <strong className="text-app-text">Procedure:</strong> contact Base44 support with the file URI list, request purge of those storage objects, and obtain a written support-case reference.</p>
              {Array.isArray(req.pendingFileUris) && req.pendingFileUris.length > 0 ? (
                <ul className="space-y-0.5 mt-1 font-mono text-app-text-muted break-all">
                  {req.pendingFileUris.map((u, i) => <li key={i}>• {u}</li>)}
                </ul>
              ) : <p className="text-app-text-muted">No file references recorded.</p>}
            </div>
            {!cleanupConfirm ? (
              <button onClick={() => setCleanupConfirm(true)} disabled={isSaving}
                className="px-3 py-1.5 bg-app-success text-white rounded-lg text-xs font-semibold disabled:opacity-50 flex items-center gap-1">
                <CheckCircle2 size={12} /> Confirm File Cleanup
              </button>
            ) : (
              <div className="w-full space-y-2 border border-app-success rounded-lg p-2.5 bg-app-success-bg">
                <p className="text-xs text-app-text">Record the Base44 support-case reference that confirms the underlying file content was purged. This marks the deletion Completed and notifies the requesting GM. An empty attestation is rejected.</p>
                <input value={cleanupNotes} onChange={e => setCleanupNotes(e.target.value)} placeholder="Base44 support case reference (required)"
                  className="w-full px-3 py-1.5 bg-app-input border border-app-border rounded-lg text-xs text-app-text focus:outline-none focus:border-app-accent" />
                <div className="flex gap-2">
                  <button onClick={() => { setCleanupConfirm(false); setCleanupNotes(''); }} disabled={isSaving}
                    className="px-3 py-1.5 border border-app-border rounded-lg text-xs font-medium text-app-text-2 disabled:opacity-50">Cancel</button>
                  <button onClick={confirmCleanup} disabled={isSaving || !cleanupNotes.trim()}
                    className="px-3 py-1.5 bg-app-success text-white rounded-lg text-xs font-semibold disabled:opacity-50 flex items-center gap-1">
                    <CheckCircle2 size={12} /> {isSaving ? 'Confirming…' : 'Attest & Complete'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Completion notification — real delivery status + retry / manual-confirmation path */}
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
            {req.notificationStatus !== 'email_sent' && req.notificationStatus !== 'admin_notified' && (
              <div className="space-y-2">
                <button onClick={retryNotif} disabled={isSaving}
                  className="px-3 py-1.5 bg-app-elevated border border-app-border rounded-lg text-xs font-medium text-app-text-2 disabled:opacity-50 flex items-center gap-1">
                  <RefreshCw size={12} /> {isSaving ? 'Sending…' : 'Retry email'}
                </button>
                <p className="text-xs text-app-text-2 leading-relaxed">Or contact the GM via a verified channel and record how you notified them.</p>
                <div className="flex gap-2">
                  <input value={notifChannel} onChange={e => setNotifChannel(e.target.value)} placeholder="e.g., email reply, phone"
                    className="flex-1 px-3 py-1.5 bg-app-input border border-app-border rounded-lg text-xs text-app-text focus:outline-none focus:border-app-accent" />
                  <button onClick={recordNotif} disabled={isSaving || !notifChannel.trim()}
                    className="px-3 py-1.5 bg-app-accent text-app-accent-text rounded-lg text-xs font-semibold disabled:opacity-50">Record</button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          {req.status === 'Pending' && (
            <>
              <button onClick={approve} disabled={isSaving || (scope && !scope.canProceed)}
                className="px-3 py-1.5 bg-app-warning text-white rounded-lg text-xs font-semibold disabled:opacity-50 flex items-center gap-1">
                <CheckCircle2 size={12} /> Approve
              </button>
              {!rejectOpen ? (
                <button onClick={() => setRejectOpen(true)} disabled={isSaving}
                  className="px-3 py-1.5 border border-app-border rounded-lg text-xs font-medium text-app-text-2 disabled:opacity-50">Reject</button>
              ) : (
                <div className="w-full space-y-2 border border-app-border rounded-lg p-2.5 bg-app-elevated">
                  <input value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Reason (optional)"
                    className="w-full px-3 py-1.5 bg-app-input border border-app-border rounded-lg text-xs text-app-text focus:outline-none focus:border-app-accent" />
                  <div className="flex gap-2">
                    <button onClick={() => { setRejectOpen(false); setRejectReason(''); }} disabled={isSaving}
                      className="px-3 py-1.5 border border-app-border rounded-lg text-xs font-medium text-app-text-2 disabled:opacity-50">Cancel</button>
                    <button onClick={reject} disabled={isSaving}
                      className="px-3 py-1.5 bg-app-danger text-white rounded-lg text-xs font-semibold disabled:opacity-50">Confirm Reject</button>
                  </div>
                </div>
              )}
            </>
          )}
          {req.status === 'Approved' && (
            !execConfirm ? (
              <button onClick={() => { if (!scope) { loadScope(); } setExecConfirm(true); }} disabled={isSaving}
                className="px-3 py-1.5 bg-app-danger text-white rounded-lg text-xs font-semibold disabled:opacity-50 flex items-center gap-1">
                <AlertTriangle size={12} /> Execute Deletion
              </button>
            ) : (
              <div className="w-full space-y-2 border border-app-danger rounded-lg p-2.5 bg-app-danger-bg">
                <p className="text-xs text-app-danger flex items-start gap-1"><AlertTriangle size={12} className="mt-0.5 flex-shrink-0" /> This permanently deletes the company and all its data. This cannot be undone. Revalidation runs at processing time.</p>
                <div className="flex gap-2">
                  <button onClick={() => setExecConfirm(false)} disabled={isSaving}
                    className="px-3 py-1.5 border border-app-border rounded-lg text-xs font-medium text-app-text-2 disabled:opacity-50">Cancel</button>
                  <button onClick={execute} disabled={isSaving || (scope && !scope.canProceed)}
                    className="px-3 py-1.5 bg-app-danger text-white rounded-lg text-xs font-semibold disabled:opacity-50">{isSaving ? 'Deleting…' : 'Confirm & Delete'}</button>
                </div>
              </div>
            )
          )}
          {req.status === 'Completed' && (
            <span className="text-xs text-app-success flex items-center gap-1">
              <CheckCircle2 size={12} /> Completed{req.completedAt && ` · ${new Date(req.completedAt).toLocaleDateString()}`}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function NotesBlock({ req, noteValue, onNotesChange, callManage, isSaving }) {
  const [showSave, setShowSave] = useState(false);
  return (
    <div>
      <label className="text-xs font-semibold text-app-text-muted uppercase block mb-1">Admin Notes</label>
      <textarea rows={2} value={noteValue} onChange={e => { onNotesChange(req.id, e.target.value); setShowSave(true); }} placeholder="Add notes..."
        className="w-full px-3 py-2 bg-app-input border border-app-border rounded-lg text-xs text-app-text placeholder:text-app-text-muted focus:outline-none focus:border-app-accent" />
      {showSave && noteValue !== (req.adminNotes ?? '') && (
        <button onClick={() => callManage({ action: 'save_notes', requestId: req.id, adminNotes: noteValue }, (d) => { setShowSave(false); })} disabled={isSaving}
          className="mt-1 px-3 py-1.5 bg-app-elevated border border-app-border rounded-lg text-xs font-medium text-app-text-2 disabled:opacity-50">
          {isSaving ? 'Saving…' : 'Save Notes'}
        </button>
      )}
    </div>
  );
}