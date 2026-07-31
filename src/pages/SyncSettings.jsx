/**
 * SyncSettings — Company Library Synchronization Settings Page
 *
 * Shows last sync status, assignment stats, and a manual "Sync Now" button.
 * Accessible from Profile > Company > Synchronization (admin roles only).
 */
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useApp } from '@/lib/AppContext';
import { useCompany } from '@/lib/CompanyContext';
import { ArrowLeft, RefreshCw, CheckCircle2, AlertTriangle, Clock, Database, Layers, AlertCircle } from 'lucide-react';

function formatRelativeTime(isoString) {
  if (!isoString) return 'Never';
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function formatDuration(ms) {
  if (!ms || ms < 100) return '<1s';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function SyncSettings() {
  const navigate = useNavigate();
  const { companyId, isCompanyAdmin } = useApp();
  const { activeCompany } = useCompany();

  const [syncing, setSyncing] = useState(false);
  const [syncRecord, setSyncRecord] = useState(null);
  const [syncError, setSyncError] = useState(null);
  const [jobCount, setJobCount] = useState(null);
  const [masterCount, setMasterCount] = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);

  // Load stored sync record and live stats on mount
  useEffect(() => {
    if (!companyId) return;

    // Load persisted sync record
    try {
      const raw = localStorage.getItem(`esop_sync_${companyId}`);
      if (raw) setSyncRecord(JSON.parse(raw));
    } catch {}

    // Load live stats
    (async () => {
      setLoadingStats(true);
      try {
        const [jobs] = await Promise.all([
          base44.entities.Job.filter({ companyId, sourceType: 'essential_sop' }, '-created_date', 500),
        ]);
        setJobCount((jobs || []).length);
      } catch {}
      setLoadingStats(false);
    })();
  }, [companyId]);

  const handleSync = async () => {
    if (!companyId || syncing) return;
    setSyncing(true);
    setSyncError(null);
    const startedAt = new Date().toISOString();
    try {
      const res = await base44.functions.invoke('syncCompanyLibrary', { companyId });
      const data = res.data;
      const record = {
        lastSyncAt: data.completedAt || new Date().toISOString(),
        startedAt: data.startedAt || startedAt,
        durationMs: data.durationMs || 0,
        summary: data.summary || { checked: 0, added: 0, outdated: 0, skipped: 0, failed: 0 },
        failedItems: data.failedItems || [],
        manual: true,
      };
      localStorage.setItem(`esop_sync_${companyId}`, JSON.stringify(record));
      setSyncRecord(record);

      // Refresh job count
      const jobs = await base44.entities.Job.filter({ companyId, sourceType: 'essential_sop' }, '-created_date', 500).catch(() => []);
      setJobCount((jobs || []).length);
    } catch (err) {
      setSyncError(err?.message || 'Sync failed. Please try again.');
    } finally {
      setSyncing(false);
    }
  };

  const summary = syncRecord?.summary;
  const hasFailures = (summary?.failed || 0) > 0 || syncRecord?.error;

  return (
    <div className="min-h-screen bg-app-bg">
      {/* Header */}
      <div className="bg-app-surface border-b border-app-border sticky top-0 z-40"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={() => navigate('/profile')} className="icon-btn text-app-text-2" aria-label="Back">
            <ArrowLeft size={20} />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-semibold text-app-text">Synchronization</h1>
            <p className="text-xs text-app-text-muted truncate">{activeCompany?.name}</p>
          </div>
          <button
            onClick={handleSync}
            disabled={syncing || !isCompanyAdmin}
            className="px-4 py-2 bg-app-accent text-app-accent-text rounded-xl text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50 no-select touch-active"
          >
            <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Syncing…' : 'Sync Now'}
          </button>
        </div>
      </div>

      <div className="px-4 py-4 space-y-4 pb-12">
        {/* Sync error */}
        {syncError && (
          <div className="flex items-start gap-2 px-4 py-3 bg-app-danger-bg border border-app-danger/30 rounded-xl text-sm text-app-danger">
            <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
            <span>{syncError}</span>
          </div>
        )}

        {/* Status card */}
        <div className="bg-app-card border border-app-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-app-divider">
            <p className="text-xs font-semibold text-app-text-muted uppercase tracking-wide">Sync Status</p>
          </div>

          {syncing ? (
            <div className="px-4 py-6 flex flex-col items-center gap-3">
              <div className="w-10 h-10 border-4 border-app-border border-t-app-accent rounded-full animate-spin" />
              <p className="text-sm text-app-text-2 font-medium">Syncing your library…</p>
              <p className="text-xs text-app-text-muted text-center max-w-xs">
                Checking for missing or outdated Master SOPs. This won't affect any of your customizations.
              </p>
            </div>
          ) : syncRecord ? (
            <div className="divide-y divide-app-divider">
              {/* Last sync */}
              <div className="flex items-center gap-3 px-4 py-3">
                {hasFailures ? (
                  <AlertTriangle size={16} className="text-app-warning flex-shrink-0" />
                ) : (
                  <CheckCircle2 size={16} className="text-app-success flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-app-text">Last successful sync</p>
                  <p className="text-xs text-app-text-muted">
                    {syncRecord.error ? 'Last attempt failed' : new Date(syncRecord.lastSyncAt).toLocaleString()}
                  </p>
                </div>
                <span className="text-xs text-app-text-muted flex-shrink-0">
                  {formatRelativeTime(syncRecord.lastSyncAt)}
                </span>
              </div>
              {/* Duration */}
              <div className="flex items-center gap-3 px-4 py-3">
                <Clock size={16} className="text-app-text-muted flex-shrink-0" />
                <p className="text-sm text-app-text flex-1">Last sync duration</p>
                <span className="text-sm text-app-text-muted">{formatDuration(syncRecord.durationMs)}</span>
              </div>
            </div>
          ) : (
            <div className="px-4 py-6 text-center">
              <p className="text-sm text-app-text-2 mb-1">No sync recorded yet</p>
              <p className="text-xs text-app-text-muted">A sync will run automatically the next time the app loads, or tap "Sync Now" above.</p>
            </div>
          )}
        </div>

        {/* Summary stats */}
        {summary && (
          <div className="bg-app-card border border-app-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-app-divider">
              <p className="text-xs font-semibold text-app-text-muted uppercase tracking-wide">Last Sync Results</p>
            </div>
            <div className="grid grid-cols-3 divide-x divide-app-divider">
              <StatCell label="Checked" value={summary.checked} />
              <StatCell label="Added" value={summary.added} highlight={summary.added > 0} color="success" />
              <StatCell label="Outdated" value={summary.outdated} highlight={summary.outdated > 0} color="warning" />
            </div>
            <div className="grid grid-cols-2 divide-x divide-app-divider border-t border-app-divider">
              <StatCell label="Up to date" value={summary.skipped} />
              <StatCell label="Failed" value={summary.failed} highlight={summary.failed > 0} color="danger" />
            </div>
          </div>
        )}

        {/* Library stats */}
        <div className="bg-app-card border border-app-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-app-divider">
            <p className="text-xs font-semibold text-app-text-muted uppercase tracking-wide">Library</p>
          </div>
          <div className="divide-y divide-app-divider">
            <div className="flex items-center gap-3 px-4 py-3">
              <Database size={16} className="text-app-text-muted flex-shrink-0" />
              <p className="text-sm text-app-text flex-1">Assigned Master SOPs</p>
              {loadingStats ? (
                <div className="w-8 h-4 bg-app-elevated rounded animate-pulse" />
              ) : (
                <span className="text-sm font-semibold text-app-text">{jobCount ?? '—'}</span>
              )}
            </div>
          </div>
        </div>

        {/* Failed items */}
        {syncRecord?.failedItems?.length > 0 && (
          <div className="bg-app-card border border-app-danger/30 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-app-divider flex items-center gap-2">
              <AlertTriangle size={13} className="text-app-danger" />
              <p className="text-xs font-semibold text-app-danger uppercase tracking-wide">
                Failed Provisioning ({syncRecord.failedItems.length})
              </p>
            </div>
            <div className="divide-y divide-app-divider">
              {syncRecord.failedItems.map((fi, i) => (
                <div key={i} className="px-4 py-3">
                  <p className="text-sm text-app-text font-medium">{fi.masterTitle || fi.masterId}</p>
                  <p className="text-xs text-app-danger mt-0.5">{fi.errorMessage || fi.errorCode}</p>
                </div>
              ))}
            </div>
            <div className="px-4 py-3 border-t border-app-divider">
              <p className="text-xs text-app-text-muted">These SOPs will retry automatically on the next sync.</p>
            </div>
          </div>
        )}

        {/* About */}
        <div className="bg-app-card border border-app-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-app-divider">
            <p className="text-xs font-semibold text-app-text-muted uppercase tracking-wide">About Synchronization</p>
          </div>
          <div className="px-4 py-3 space-y-2">
            <p className="text-xs text-app-text-2 leading-relaxed">
              Essential SOP automatically verifies your library every time you open the app.
              New SOPs from the Platform are added silently. Version updates are surfaced on the relevant job.
            </p>
            <p className="text-xs text-app-text-muted leading-relaxed">
              Sync never overwrites your customizations or creates duplicate jobs.
              It only adds what is missing and flags what has been updated.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCell({ label, value, highlight, color }) {
  const colorClass =
    color === 'success' && highlight ? 'text-app-success font-bold' :
    color === 'warning' && highlight ? 'text-app-warning font-bold' :
    color === 'danger'  && highlight ? 'text-app-danger font-bold' :
    'text-app-text font-semibold';

  return (
    <div className="flex flex-col items-center py-3 px-2 gap-0.5">
      <span className={`text-xl ${colorClass}`}>{value ?? '—'}</span>
      <span className="text-xs text-app-text-muted">{label}</span>
    </div>
  );
}