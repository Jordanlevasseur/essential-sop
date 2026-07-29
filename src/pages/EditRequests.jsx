import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useCompany } from '@/lib/CompanyContext';
import { ArrowLeft, Clock, ChevronRight } from 'lucide-react';
import { getEditRequestStatusLabel, getRoleLabel } from '@/lib/roleLabels';

const STATUS_STYLES = {
  pending:              'bg-app-warning-bg text-app-warning',
  approved:             'bg-app-success-bg text-app-success',
  denied:               'bg-app-danger-bg text-app-danger',
  editing:              'bg-app-info-bg text-app-info',
  submitted_for_review: 'bg-app-info-bg text-app-info',
  changes_requested:    'bg-app-warning-bg text-app-warning',
  published:            'bg-app-success-bg text-app-success',
  rejected:             'bg-app-danger-bg text-app-danger',
  expired:              'bg-app-elevated text-app-text-muted',
  revoked:              'bg-app-elevated text-app-text-muted',
  cancelled:            'bg-app-elevated text-app-text-muted',
};

const URGENCY_LABELS = {
  normal: null,
  important: 'Important',
  urgent_safety_correction: 'Urgent — Safety Correction',
};

const SECTION_LABELS = {
  tools: 'Tools', materials: 'Materials', scope: 'Scope',
  procedure: 'Procedure', safety: 'Safety', quality_standards: 'Quality Standards',
};

function formatSections(types) {
  return (types || []).map(t => SECTION_LABELS[t] || t).join(', ');
}

export default function EditRequests() {
  const navigate = useNavigate();
  const { activeCompany, activeMembership } = useCompany();
  const companyId = activeCompany?.id;
  const role = activeMembership?.role;
  const isReviewer = role === 'general_manager' || role === 'project_manager';
  const isProjectLead = role === 'project_lead';

  const [requests, setRequests] = useState([]);
  const [revisions, setRevisions] = useState([]);
  const [grants, setGrants] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [reviewAction, setReviewAction] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const [reviewSections, setReviewSections] = useState([]);
  const [reviewDuration, setReviewDuration] = useState('24h');
  const [submitting, setSubmitting] = useState(false);
  const [tab, setTab] = useState('awaiting');
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    if (!companyId) return;
    base44.auth.me().then(u => setCurrentUser(u)).catch(() => {});
    loadData();
  }, [companyId]);

  const loadData = async () => {
    setLoading(true);
    const [allRequests, allRevisions, allGrants, allJobs, allUsers] = await Promise.all([
      base44.entities.EditRequest.filter({ companyId }),
      base44.entities.JobRevision.filter({ companyId }),
      base44.entities.TemporaryEditGrant.filter({ companyId }),
      base44.entities.Job.filter({ companyId }),
      base44.entities.User.list(),
    ]);
    setRequests(allRequests || []);
    setRevisions(allRevisions || []);
    setGrants(allGrants || []);
    setJobs(allJobs || []);
    setUsers(allUsers || []);
    setLoading(false);
  };

  const getJob = id => jobs.find(j => j.id === id);
  const getUser = id => users.find(u => u.id === id);

  // Reviewer buckets
  const awaiting   = requests.filter(r => r.status === 'pending');
  const inProgress = requests.filter(r => ['approved', 'editing'].includes(r.status));
  const submitted  = requests.filter(r => r.status === 'submitted_for_review');
  const changesReq = requests.filter(r => r.status === 'changes_requested');
  const completed  = requests.filter(r => ['published', 'denied', 'rejected', 'expired', 'revoked', 'cancelled'].includes(r.status));

  // Project Lead buckets
  const myRequests     = isProjectLead ? requests.filter(r => r.requestedByUserId === currentUser?.id && !['cancelled'].includes(r.status)) : [];
  const myActive       = myRequests.filter(r => ['approved', 'editing'].includes(r.status));
  const mySubmitted    = myRequests.filter(r => r.status === 'submitted_for_review');
  const myChangesReq   = myRequests.filter(r => r.status === 'changes_requested');
  const myCompleted    = myRequests.filter(r => ['published', 'denied', 'rejected', 'expired', 'revoked'].includes(r.status));
  const myPending      = myRequests.filter(r => r.status === 'pending');

  const reviewerTabs = [
    { id: 'awaiting',    label: `Awaiting Review${awaiting.length ? ` (${awaiting.length})` : ''}` },
    { id: 'inprogress',  label: `Editing in Progress${inProgress.length ? ` (${inProgress.length})` : ''}` },
    { id: 'submitted',   label: `Changes Submitted${submitted.length ? ` (${submitted.length})` : ''}` },
    { id: 'changesreq',  label: `Changes Requested` },
    { id: 'completed',   label: 'Completed' },
  ];

  const leadTabs = [
    { id: 'mine',        label: 'My Requests' },
    { id: 'editing',     label: 'Editing Available' },
    { id: 'submitted',   label: 'Changes Submitted' },
    { id: 'changesreq',  label: 'Changes Requested' },
    { id: 'completed',   label: 'Completed' },
  ];

  const tabs = isReviewer ? reviewerTabs : leadTabs;

  const handleReview = async () => {
    if (!selected || !reviewAction) return;
    setSubmitting(true);
    const payload = {
      action: reviewAction,
      editRequestId: selected.id,
      companyId,
      reviewerNotes: reviewNote,
      ...(reviewAction === 'approve' ? { approvedSectionTypes: reviewSections, duration: reviewDuration } : {}),
    };
    const res = await base44.functions.invoke('reviewEditRequest', payload);
    setSubmitting(false);
    if (res.data?.success) {
      setSelected(null); setReviewAction(''); setReviewNote(''); setReviewSections([]);
      loadData();
    } else {
      alert(res.data?.error || 'Action failed');
    }
  };

  const handleRevisionAction = async (action, revisionId) => {
    const note = action !== 'publish' ? prompt('Reviewer note (required):') : reviewNote;
    if (action !== 'publish' && !note) return;
    setSubmitting(true);
    const res = await base44.functions.invoke('publishRevision', { action, revisionId, companyId, reviewerNotes: note || '' });
    setSubmitting(false);
    if (res.data?.success) { loadData(); } else { alert(res.data?.error || 'Failed'); }
  };

  const handleRevoke = async (requestId) => {
    if (!confirm('Revoke editing access for this request?')) return;
    await base44.functions.invoke('reviewEditRequest', {
      action: 'revoke_access', editRequestId: requestId, companyId, reviewerNotes: 'Revoked by reviewer',
    });
    loadData();
  };

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen bg-app-bg">
      <div className="w-8 h-8 border-4 border-app-border border-t-app-accent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="min-h-screen bg-app-bg">
      {/* Header */}
      <div className="bg-app-surface border-b border-app-border sticky top-0 z-40" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="icon-btn touch-active"><ArrowLeft size={22} className="text-app-text-2" /></button>
          <h1 className="font-semibold text-app-text flex-1">Edit Requests</h1>
        </div>
        {/* Scrollable tabs */}
        <div className="flex overflow-x-auto scrollbar-hide border-t border-app-divider">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex-shrink-0 px-4 py-2.5 text-xs font-semibold whitespace-nowrap transition-colors ${tab === t.id ? 'text-app-accent border-b-2 border-app-accent' : 'text-app-text-muted'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pt-4 pb-4 max-w-2xl mx-auto space-y-3">

        {/* ── REVIEWER VIEWS ── */}
        {isReviewer && tab === 'awaiting' && (
          awaiting.length === 0
            ? <EmptyState text="No requests waiting for review." />
            : awaiting.map(r => (
              <RequestCard key={r.id} request={r} job={getJob(r.jobId)} requester={getUser(r.requestedByUserId)}
                company={activeCompany}
                onClick={() => { setSelected(r); setReviewAction(''); setReviewSections(r.requestedSectionTypes || []); }} />
            ))
        )}

        {isReviewer && tab === 'inprogress' && (
          inProgress.length === 0
            ? <EmptyState text="No active editing sessions." />
            : inProgress.map(r => {
              const grant = grants.find(g => g.editRequestId === r.id && g.status === 'active');
              return (
                <RequestCard key={r.id} request={r} job={getJob(r.jobId)} requester={getUser(r.requestedByUserId)}
                  company={activeCompany} grant={grant}
                  onRevoke={() => handleRevoke(r.id)} />
              );
            })
        )}

        {isReviewer && tab === 'submitted' && (
          submitted.length === 0
            ? <EmptyState text="No submitted changes to review." />
            : submitted.map(r => {
              const revision = revisions.find(rev => rev.editRequestId === r.id);
              return (
                <div key={r.id} className="bg-app-card border border-app-border rounded-xl overflow-hidden">
                  <RequestCard request={r} job={getJob(r.jobId)} requester={getUser(r.requestedByUserId)} company={activeCompany} />
                  {revision && (
                    <div className="px-4 pb-4 pt-3 border-t border-app-divider">
                      <p className="text-xs font-semibold text-app-text-muted uppercase mb-1">Proposed Changes</p>
                      <p className="text-sm text-app-text-2 mb-3">{revision.changeSummary || 'No summary provided.'}</p>
                      <div className="flex gap-2">
                        <button onClick={() => handleRevisionAction('publish', revision.id)}
                          className="flex-1 py-2 bg-app-success text-white rounded-lg text-xs font-semibold">
                          Approve &amp; Publish
                        </button>
                        <button onClick={() => handleRevisionAction('request_changes', revision.id)}
                          className="flex-1 py-2 border border-app-warning text-app-warning rounded-lg text-xs font-semibold">
                          Request Changes
                        </button>
                        <button onClick={() => handleRevisionAction('reject', revision.id)}
                          className="flex-1 py-2 border border-app-danger text-app-danger rounded-lg text-xs font-semibold">
                          Reject
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
        )}

        {isReviewer && tab === 'changesreq' && (
          changesReq.length === 0
            ? <EmptyState text="No requests with changes requested." />
            : changesReq.map(r => (
              <RequestCard key={r.id} request={r} job={getJob(r.jobId)} requester={getUser(r.requestedByUserId)} company={activeCompany} />
            ))
        )}

        {isReviewer && tab === 'completed' && (
          completed.length === 0
            ? <EmptyState text="No completed requests yet." />
            : completed.map(r => (
              <RequestCard key={r.id} request={r} job={getJob(r.jobId)} requester={getUser(r.requestedByUserId)} company={activeCompany} />
            ))
        )}

        {/* ── PROJECT LEAD VIEWS ── */}
        {isProjectLead && tab === 'mine' && (
          myPending.length === 0
            ? <EmptyState text="No requests awaiting review." />
            : myPending.map(r => (
              <RequestCard key={r.id} request={r} job={getJob(r.jobId)} company={activeCompany} />
            ))
        )}

        {isProjectLead && tab === 'editing' && (
          myActive.length === 0
            ? <EmptyState text="No active editing access." />
            : myActive.map(r => {
              const grant = grants.find(g => g.editRequestId === r.id && g.status === 'active');
              return <RequestCard key={r.id} request={r} job={getJob(r.jobId)} company={activeCompany} grant={grant}
                onViewJob={() => navigate(`/jobs/${r.jobId}`)} />;
            })
        )}

        {isProjectLead && tab === 'submitted' && (
          mySubmitted.length === 0
            ? <EmptyState text="No submitted changes awaiting review." />
            : mySubmitted.map(r => (
              <RequestCard key={r.id} request={r} job={getJob(r.jobId)} company={activeCompany} />
            ))
        )}

        {isProjectLead && tab === 'changesreq' && (
          myChangesReq.length === 0
            ? <EmptyState text="No requests with changes requested." />
            : myChangesReq.map(r => {
              const revision = revisions.find(rev => rev.editRequestId === r.id);
              return (
                <div key={r.id} className="bg-app-card border border-app-border rounded-xl overflow-hidden">
                  <RequestCard request={r} job={getJob(r.jobId)} company={activeCompany} />
                  {revision?.reviewerNotes && (
                    <div className="px-4 pb-4 pt-3 border-t border-app-divider">
                      <p className="text-xs font-semibold text-app-text-muted uppercase mb-1">Reviewer Note</p>
                      <p className="text-sm text-app-text-2">{revision.reviewerNotes}</p>
                    </div>
                  )}
                </div>
              );
            })
        )}

        {isProjectLead && tab === 'completed' && (
          myCompleted.length === 0
            ? <EmptyState text="No completed requests yet." />
            : myCompleted.map(r => (
              <RequestCard key={r.id} request={r} job={getJob(r.jobId)} company={activeCompany} />
            ))
        )}
      </div>

      {/* ── REVIEW MODAL ── */}
      {selected && isReviewer && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setSelected(null)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative bg-app-surface rounded-t-2xl p-5 max-h-[85dvh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h2 className="font-semibold text-app-text mb-1">Review Edit Request</h2>
            <p className="text-sm text-app-text-2 mb-1">{getJob(selected.jobId)?.title}</p>
            <p className="text-xs text-app-text-muted mb-1">
              Requested by {getUser(selected.requestedByUserId)?.full_name || '—'}
              {selected.urgency !== 'normal' && (
                <span className="ml-2 text-app-warning font-semibold">{URGENCY_LABELS[selected.urgency]}</span>
              )}
            </p>
            <p className="text-xs text-app-text-muted mb-1">Sections: {formatSections(selected.requestedSectionTypes)}</p>
            <p className="text-xs text-app-text-2 mb-0.5"><span className="font-semibold">Reason:</span> {selected.reason}</p>
            <p className="text-xs text-app-text-2 mb-4"><span className="font-semibold">Proposed changes:</span> {selected.proposedChangeSummary}</p>

            {reviewAction === '' && (
              <div className="flex gap-2 mb-3">
                <button onClick={() => setReviewAction('approve')}
                  className="flex-1 py-2.5 bg-app-success text-white rounded-lg text-sm font-semibold">
                  Approve Edit Access
                </button>
                <button onClick={() => setReviewAction('deny')}
                  className="flex-1 py-2.5 border border-app-danger text-app-danger rounded-lg text-sm font-semibold">
                  Deny Request
                </button>
                <button onClick={() => setSelected(null)}
                  className="flex-1 py-2.5 border border-app-border text-app-text-2 rounded-lg text-sm">
                  Cancel
                </button>
              </div>
            )}

            {reviewAction === 'approve' && (
              <div>
                <p className="text-xs font-semibold text-app-text-muted uppercase mb-2">Approve Sections</p>
                <div className="flex flex-wrap gap-2 mb-3">
                  {selected.requestedSectionTypes?.map(s => (
                    <button key={s}
                      onClick={() => setReviewSections(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])}
                      className={`px-3 py-1 rounded-full text-xs font-medium ${reviewSections.includes(s) ? 'bg-app-accent text-app-accent-text' : 'bg-app-elevated text-app-text-2'}`}>
                      {SECTION_LABELS[s] || s}
                    </button>
                  ))}
                </div>
                <p className="text-xs font-semibold text-app-text-muted uppercase mb-1">Access Duration</p>
                <div className="flex gap-2 mb-3">
                  {['1h', '4h', '8h', '24h'].map(d => (
                    <button key={d} onClick={() => setReviewDuration(d)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-medium ${reviewDuration === d ? 'bg-app-accent text-app-accent-text' : 'bg-app-elevated text-app-text-2'}`}>
                      {d}
                    </button>
                  ))}
                </div>
                <textarea value={reviewNote} onChange={e => setReviewNote(e.target.value)} rows={2}
                  placeholder="Optional note for the requester"
                  className="w-full px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text mb-3" />
                {reviewSections.length > 0 && (
                  <p className="text-xs text-app-text-muted mb-3">
                    Edit Access Approved for: {formatSections(reviewSections)} · Expires in {reviewDuration}
                  </p>
                )}
                <div className="flex gap-2">
                  <button onClick={() => setReviewAction('')} className="flex-1 py-2.5 border border-app-border rounded-lg text-sm text-app-text-2">Back</button>
                  <button onClick={handleReview} disabled={submitting || reviewSections.length === 0}
                    className="flex-1 py-2.5 bg-app-success text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                    {submitting ? 'Approving…' : 'Confirm Approve'}
                  </button>
                </div>
              </div>
            )}

            {reviewAction === 'deny' && (
              <div>
                <textarea value={reviewNote} onChange={e => setReviewNote(e.target.value)} rows={2}
                  placeholder="Reason for denial (optional)"
                  className="w-full px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text mb-3" />
                <div className="flex gap-2">
                  <button onClick={() => setReviewAction('')} className="flex-1 py-2.5 border border-app-border rounded-lg text-sm text-app-text-2">Back</button>
                  <button onClick={handleReview} disabled={submitting}
                    className="flex-1 py-2.5 bg-app-danger text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                    {submitting ? 'Denying…' : 'Confirm Deny'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ height: 'calc(16px + env(safe-area-inset-bottom))' }} />
    </div>
  );
}

function RequestCard({ request, job, requester, company, grant, onClick, onRevoke, onViewJob }) {
  const statusLabel = getEditRequestStatusLabel(request.status);
  const statusClass = STATUS_STYLES[request.status] || 'bg-app-elevated text-app-text-muted';
  const expiresIn = grant ? Math.max(0, Math.round((new Date(grant.expiresAt) - new Date()) / 3600000)) : null;
  const expiresMinutes = grant ? Math.max(0, Math.round((new Date(grant.expiresAt) - new Date()) / 60000)) : null;
  const urgency = request.urgency;

  return (
    <div onClick={onClick} className={`bg-app-card border border-app-border rounded-xl p-4 ${onClick ? 'cursor-pointer touch-active' : ''}`}>
      {urgency === 'urgent_safety_correction' && (
        <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold text-app-danger">
          <span>⚠</span> Urgent Safety Correction
        </div>
      )}
      {urgency === 'important' && (
        <div className="mb-2 text-xs font-semibold text-app-warning">Important</div>
      )}
      <div className="flex items-start justify-between gap-2 mb-1">
        <p className="font-semibold text-sm text-app-text flex-1">{job?.title || 'Unknown Job'}</p>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${statusClass}`}>{statusLabel}</span>
      </div>
      {requester && <p className="text-xs text-app-text-muted">Requested by {requester.full_name || requester.email}</p>}
      <p className="text-xs text-app-text-muted mt-0.5">Sections: {formatSections(request.requestedSectionTypes)}</p>
      {request.reason && <p className="text-xs text-app-text-2 mt-0.5 line-clamp-2">{request.reason}</p>}
      {grant && expiresIn !== null && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-app-info">
          <Clock size={11} />
          <span>
            {expiresMinutes < 60
              ? `Edit Access Expires in ~${expiresMinutes} min`
              : `Edit Access Expires in ~${expiresIn}h`}
          </span>
        </div>
      )}
      {onRevoke && (
        <button onClick={e => { e.stopPropagation(); onRevoke(); }}
          className="mt-2 text-xs px-3 py-1.5 rounded-lg border border-app-danger text-app-danger touch-active">
          Revoke Edit Access
        </button>
      )}
      {onViewJob && (
        <button onClick={e => { e.stopPropagation(); onViewJob(); }}
          className="mt-2 text-xs px-3 py-1.5 rounded-lg bg-app-accent text-app-accent-text touch-active">
          Open Job
        </button>
      )}
    </div>
  );
}

function EmptyState({ text }) {
  return <p className="text-sm text-app-text-muted text-center py-10">{text}</p>;
}