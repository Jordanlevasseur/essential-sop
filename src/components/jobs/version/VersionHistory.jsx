import React, { useEffect, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { History, CheckCircle2, AlertTriangle, Clock, User, ChevronDown, ChevronUp } from 'lucide-react';

/**
 * VersionHistory — Displays past adoption events from ActivityLog.
 *
 * Reads ActivityLog records for this job with actionType='job_edited'
 * and metadata.event='COMPANY_MASTER_VERSION_ADOPTED_FROM_ANALYSIS'.
 * Shows: date, user, from → to version, analysis, decision summary, status.
 */

export default function VersionHistory({ job }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState({});

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke('resolveJobAdoptionHistory', { jobId: job.id });
      setRecords(res?.data?.records || []);
    } catch (_) {
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [job.id]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32 gap-2">
        <div className="w-5 h-5 border-4 border-app-border border-t-app-accent rounded-full animate-spin" />
        <p className="text-sm text-app-text-muted">Loading history…</p>
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-3 p-6 text-center">
        <History size={28} className="text-app-text-disabled" />
        <p className="text-sm font-medium text-app-text-2">No adoption history yet</p>
        <p className="text-xs text-app-text-muted">Adoption events will appear here after the first version update.</p>
      </div>
    );
  }

  return (
    <div className="pb-6">
      <div className="px-4 pt-4 pb-2">
        <p className="text-xs font-bold text-app-text-muted uppercase tracking-wide">Adoption History</p>
        <p className="text-xs text-app-text-muted mt-0.5">{records.length} event{records.length !== 1 ? 's' : ''}</p>
      </div>

      {records.map((record, i) => (
        <HistoryEntry
          key={record.id || i}
          record={record}
          expanded={!!expanded[record.id]}
          onToggle={() => setExpanded(prev => ({ ...prev, [record.id]: !prev[record.id] }))}
        />
      ))}
    </div>
  );
}

function HistoryEntry({ record, expanded, onToggle }) {
  const meta = record.metadata || {};
  const date = record.timestamp ? new Date(record.timestamp) : null;
  const dateStr = date ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  const timeStr = date ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '';

  const prevVersionNum = meta.previousVersionId ? `v?` : null; // version numbers not stored in log, IDs only
  const isIdempotent = meta.idempotent === true;
  const auditPending = meta.auditPending;

  return (
    <div className="border-b border-app-divider">
      <button onClick={onToggle} className="w-full px-4 py-3.5 flex items-start gap-3 text-left no-select touch-active">
        <div className="w-8 h-8 rounded-full bg-app-success-bg flex items-center justify-center flex-shrink-0 mt-0.5">
          <CheckCircle2 size={14} className="text-app-success" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-app-text">Version Adopted</p>
          <p className="text-xs text-app-text-muted mt-0.5">
            {dateStr} at {timeStr}
          </p>
          {(meta.safeApplied !== undefined || meta.reviewDecisionsKept !== undefined) && (
            <p className="text-xs text-app-text-muted mt-0.5">
              {[
                meta.safeApplied > 0 && `${meta.safeApplied} safe`,
                meta.reviewDecisionsKept > 0 && `${meta.reviewDecisionsKept} kept`,
                meta.reviewDecisionsAccepted > 0 && `${meta.reviewDecisionsAccepted} accepted`,
                meta.orphanedPreserved > 0 && `${meta.orphanedPreserved} orphans kept`,
              ].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
        {expanded ? <ChevronUp size={14} className="text-app-text-muted flex-shrink-0 mt-1" /> : <ChevronDown size={14} className="text-app-text-muted flex-shrink-0 mt-1" />}
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          <DetailRow label="By user" value={meta.actingUserId ? truncate(meta.actingUserId) : (record.actingUserId ? truncate(record.actingUserId) : '—')} />
          {meta.previousVersionId && <DetailRow label="From version" value={truncate(meta.previousVersionId)} />}
          {meta.newVersionId && <DetailRow label="To version" value={truncate(meta.newVersionId)} />}
          {meta.analysisId && <DetailRow label="Analysis ID" value={truncate(meta.analysisId)} />}
          {meta.mutationKey && <DetailRow label="Mutation key" value={truncate(meta.mutationKey)} />}
          {meta.canAutoAdopt !== undefined && <DetailRow label="Auto-adopted" value={meta.canAutoAdopt ? 'Yes' : 'No (decisions made)'} />}
          {isIdempotent && <DetailRow label="Note" value="Idempotent replay (no duplicate writes)" />}
          {auditPending && (
            <div className="flex items-center gap-1.5 text-xs text-app-warning">
              <AlertTriangle size={11} />
              <span>Audit record pending retry</span>
            </div>
          )}
          <DetailRow label="Summary" value={record.summary || '—'} />
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="text-xs">
      <span className="font-semibold text-app-text-muted">{label}: </span>
      <span className="text-app-text-2 selectable">{value}</span>
    </div>
  );
}

function truncate(str, n = 20) {
  if (!str) return '—';
  return str.length > n ? `…${str.slice(-n)}` : str;
}