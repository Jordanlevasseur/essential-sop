import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useCompany } from '@/lib/CompanyContext';
import { useApp } from '@/lib/AppContext';
import { ArrowLeft, Clock, Check, X, AlertTriangle, ChevronRight, Edit3 } from 'lucide-react';

const STATUS_STYLES = {
  pending: 'bg-app-warning-bg text-app-warning',
  approved: 'bg-app-success-bg text-app-success',
  denied: 'bg-app-danger-bg text-app-danger',
  editing: 'bg-app-info-bg text-app-info',
  submitted_for_review: 'bg-app-info-bg text-app-info',
  changes_requested: 'bg-app-warning-bg text-app-warning',
  published: 'bg-app-success-bg text-app-success',
  rejected: 'bg-app-danger-bg text-app-danger',
  expired: 'bg-app-elevated text-app-text-muted',
  revoked: 'bg-app-elevated text-app-text-muted',
  cancelled: 'bg-app-elevated text-app-text-muted',
};

const URGENCY_LABELS = { normal: '', important: '⚠ Important', urgent_safety_correction: '🚨 Safety' };

export default function RequestsAndReviews() {
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
  const [tab, setTab] = useState('pending');

  useEffect(() => {
    if (!companyId) return;
    loadData();
  }, [companyId]);

  const loadData = async () => {
    setLoading(true);
    const res = await base44.functions.invoke('resolveCompanyEditRequests', { companyId });
    const data = res.data;
    if (!data || data.error) { setLoading(false); return; }
    setRequests(data.requests || []);
    setRevisions(data.revisions || []);
    setGrants(data.grants || []);
    setJobs(data.jobs || []);
    setUsers(data.users || []);
    setLoading(false);
  };

  const getJob = id => jobs.find(j => j.id === id);
  const getUser = id => users.find(u => u.id === id);

  const myUserId = users.find(u => u.email === activeMembership?.userId)?.id;

  const pending = requests.filter(r => r.status === 'pending');
  const activeEditing = requests.filter(r => ['approved', 'editing'].includes(r.status));
  const submitted = requests.filter(r => r.status === 'submitted_for_review');
  const completed = requests.filter(r => ['published', 'denied', 'rejected', 'expired', 'revoked', 'cancelled'].includes(r.status));

  const myRequests = isProjectLead
    ? requests.filter(r => r.requestedByUserId && r.status !== 'cancelled')
    : null;
  const myActiveGrant = grants.find(g => g.status === 'active' && new Date(g.expiresAt) > new Date());

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

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen bg-app-bg">
      <div className="w-8 h-8 border-4 border-app-border border-t-app-accent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="min-h-screen bg-app-bg">
      <div className="bg-app-surface border-b border-app-border sticky top-0 z-40" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="icon-btn touch-active"><ArrowLeft size={22} className="text-app-text-2" /></button>
          <h1 className="font-semibold text-app-text flex-1">Requests & Reviews</h1>
        </div>

        {/* Tabs */}
        <div className="flex border-t border-app-divider">
          {(isReviewer
            ? [['pending', `Pending (${pending.length})`], ['editing', `Active (${activeEditing.length})`], ['submitted', `Review (${submitted.length})`], ['done', 'Done']]
            : [['mine', 'My Requests'], ['editing', 'Active Access'], ['done', 'Completed']]
          ).map(([val, label]) => (
            <button key={val} onClick={() => setTab(val)}
              className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${tab === val ? 'text-app-accent border-b-2 border-app-accent' : 'text-app-text-muted'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pt-4 pb-4 max-w-2xl mx-auto space-y-3">

        {/* Reviewer: pending requests */}
        {isReviewer && tab === 'pending' && (
          pending.length === 0
            ? <EmptyState text="No pending requests." />
            : pending.map(r => (
              <RequestCard key={r.id} request={r} job={getJob(r.jobId)} requester={getUser(r.requestedByUserId)}
                onClick={() => { setSelected(r); setReviewAction(''); setReviewSections(r.requestedSectionTypes || []); }} />
            ))
        )}

        {/* Active editing grants */}
        {tab === 'editing' && (
          activeEditing.length === 0
            ? <EmptyState text="No active editing sessions." />
            : activeEditing.map(r => {
              const grant = grants.find(g => g.editRequestId === r.id && g.status === 'active');
              return (
                <RequestCard key={r.id} request={r} job={getJob(r.jobId)} requester={getUser(r.requestedByUserId)}
                  grant={grant}
                  actions={isReviewer ? [
                    { label: 'Revoke Access', danger: true, onClick: () => { if (confirm('Revoke editing access?')) base44.functions.invoke('reviewEditRequest', { action: 'revoke_access', editRequestId: r.id, companyId, reviewerNotes: 'Revoked by reviewer' }).then(loadData); } }
                  ] : []}
                />
              );
            })
        )}

        {/* Submitted for review */}
        {isReviewer && tab === 'submitted' && (
          submitted.length === 0
            ? <EmptyState text="No revisions to review." />
            : submitted.map(r => {
              const revision = revisions.find(rev => rev.editRequestId === r.id);
              return (
                <div key={r.id} className="bg-app-card border border-app-border rounded-lg p-3">
                  <RequestCard request={r} job={getJob(r.jobId)} requester={getUser(r.requestedByUserId)} />
                  {revision && (
                    <div className="mt-3 pt-3 border-t border-app-divider">
                      <p className="text-xs font-semibold text-app-text-muted mb-1">Change Summary</p>
                      <p className="text-sm text-app-text-2">{revision.changeSummary || '—'}</p>
                      <div className="flex gap-2 mt-3">
                        <button onClick={() => handleRevisionAction('publish', revision.id)} className="flex-1 py-2 bg-app-success text-white rounded-lg text-xs font-semibold">Approve & Publish</button>
                        <button onClick={() => handleRevisionAction('request_changes', revision.id)} className="flex-1 py-2 border border-app-warning text-app-warning rounded-lg text-xs font-semibold">Request Changes</button>
                        <button onClick={() => handleRevisionAction('reject', revision.id)} className="flex-1 py-2 border border-app-danger text-app-danger rounded-lg text-xs font-semibold">Reject</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
        )}

        {/* Project lead: my requests */}
        {isProjectLead && tab === 'mine' && (
          (myRequests || []).filter(r => !['published', 'rejected', 'expired', 'revoked', 'cancelled'].includes(r.status)).length === 0
            ? <EmptyState text="No active requests." />
            : (myRequests || []).filter(r => !['published', 'rejected', 'expired', 'revoked', 'cancelled'].includes(r.status)).map(r => (
              <RequestCard key={r.id} request={r} job={getJob(r.jobId)} requester={getUser(r.requestedByUserId)} />
            ))
        )}

        {/* Done / history */}
        {tab === 'done' && (
          completed.length === 0
            ? <EmptyState text="No completed requests." />
            : completed.map(r => <RequestCard key={r.id} request={r} job={getJob(r.jobId)} requester={getUser(r.requestedByUserId)} />)
        )}
      </div>

      {/* Review modal */}
      {selected && isReviewer && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setSelected(null)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative bg-app-surface rounded-t-2xl p-5 max-h-[80dvh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h2 className="font-semibold text-app-text mb-1">Review Request</h2>
            <p className="text-sm text-app-text-2 mb-3">{getJob(selected.jobId)?.title} — by {getUser(selected.requestedByUserId)?.full_name}</p>
            <p className="text-xs text-app-text-muted mb-1">Sections: {selected.requestedSectionTypes?.join(', ')}</p>
            <p className="text-xs text-app-text-muted mb-1">Reason: {selected.reason}</p>
            <p className="text-xs text-app-text-muted mb-3">Proposed: {selected.proposedChangeSummary}</p>

            {reviewAction === '' && (
              <div className="flex gap-2 mb-3">
                <button onClick={() => setReviewAction('approve')} className="flex-1 py-2.5 bg-app-success text-white rounded-lg text-sm font-semibold">Approve</button>
                <button onClick={() => setReviewAction('deny')} className="flex-1 py-2.5 border border-app-danger text-app-danger rounded-lg text-sm font-semibold">Deny</button>
                <button onClick={() => setSelected(null)} className="flex-1 py-2.5 border border-app-border text-app-text-2 rounded-lg text-sm">Cancel</button>
              </div>
            )}

            {reviewAction === 'approve' && (
              <div>
                <p className="text-xs font-semibold text-app-text-muted uppercase mb-2">Approved Sections</p>
                <div className="flex flex-wrap gap-2 mb-3">
                  {selected.requestedSectionTypes?.map(s => (
                    <button key={s} onClick={() => setReviewSections(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])}
                      className={`px-3 py-1 rounded-full text-xs font-medium ${reviewSections.includes(s) ? 'bg-app-accent text-app-accent-text' : 'bg-app-elevated text-app-text-2'}`}>
                      {s}
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
                <textarea value={reviewNote} onChange={e => setReviewNote(e.target.value)} rows={2} placeholder="Optional reviewer note"
                  className="w-full px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text mb-3" />
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
                <textarea value={reviewNote} onChange={e => setReviewNote(e.target.value)} rows={2} placeholder="Reason for denial (optional)"
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

function RequestCard({ request, job, requester, grant, actions = [], onClick }) {
  const statusClass = STATUS_STYLES[request.status] || 'bg-app-elevated text-app-text-muted';
  const expiresIn = grant ? Math.max(0, Math.round((new Date(grant.expiresAt) - new Date()) / 3600000)) : null;
  return (
    <div onClick={onClick} className={`bg-app-card border border-app-border rounded-lg p-3 ${onClick ? 'cursor-pointer touch-active' : ''}`}>
      <div className="flex items-start justify-between gap-2 mb-1">
        <p className="font-semibold text-sm text-app-text flex-1">{job?.title || 'Unknown Job'}</p>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${statusClass}`}>{request.status.replace(/_/g, ' ')}</span>
      </div>
      {requester && <p className="text-xs text-app-text-muted">By {requester.full_name || requester.email}</p>}
      <p className="text-xs text-app-text-muted">{request.requestedSectionTypes?.join(', ')}</p>
      {request.urgency !== 'normal' && <p className="text-xs text-app-warning mt-0.5">{URGENCY_LABELS[request.urgency]}</p>}
      {grant && expiresIn !== null && (
        <p className="text-xs text-app-info mt-1"><Clock size={10} className="inline mr-1" />Access expires in ~{expiresIn}h</p>
      )}
      {actions.map(a => (
        <button key={a.label} onClick={e => { e.stopPropagation(); a.onClick(); }}
          className={`mt-2 text-xs px-3 py-1.5 rounded-lg border ${a.danger ? 'border-app-danger text-app-danger' : 'border-app-border text-app-text-2'}`}>
          {a.label}
        </button>
      ))}
    </div>
  );
}

function EmptyState({ text }) {
  return <p className="text-sm text-app-text-muted text-center py-8">{text}</p>;
}