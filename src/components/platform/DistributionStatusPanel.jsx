/**
 * DistributionStatusPanel — Shows distribution stats and per-company provisioning status
 * for a published Master SOP on the detail page.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, AlertTriangle, Clock, RefreshCw, Building2, ChevronDown, ChevronUp } from 'lucide-react';
import { base44 } from '@/api/base44Client';

const STATUS_CONFIG = {
  COMPLETED: { label: 'Provisioned', color: 'text-app-success', bg: 'bg-app-success-bg' },
  SKIPPED: { label: 'Already had it', color: 'text-app-text-2', bg: 'bg-app-elevated' },
  FAILED: { label: 'Failed', color: 'text-app-danger', bg: 'bg-app-danger-bg' },
  PENDING: { label: 'Pending', color: 'text-app-warning', bg: 'bg-app-warning-bg' },
};

export default function DistributionStatusPanel({ masterId, refreshKey }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [retrying, setRetrying] = useState(null); // companyId being retried

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await base44.functions.invoke('manageMasterSOP', {
        action: 'get_distribution_status',
        masterId,
      });
      setStatus(res.data);
    } catch (e) {
      setError('Failed to load distribution status.');
    } finally {
      setLoading(false);
    }
  }, [masterId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const handleRetry = async (companyId) => {
    if (retrying) return;
    setRetrying(companyId);
    try {
      await base44.functions.invoke('manageMasterSOP', {
        action: 'distribute',
        masterId,
        distributionPolicy: 'SELECTED_COMPANIES',
        selectedCompanyIds: [companyId],
      });
      await load();
    } catch (_) {}
    setRetrying(null);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3 text-sm text-app-text-muted">
        <div className="w-4 h-4 border-2 border-app-border border-t-app-accent rounded-full animate-spin" />
        Loading distribution status…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 py-3 text-sm text-app-danger">
        <AlertTriangle size={14} /> {error}
        <button onClick={load} className="ml-auto text-xs text-app-accent underline">Retry</button>
      </div>
    );
  }

  if (!status) return null;

  const { provisionedCount, failedCount, totalActiveCompanies, companyRows, distEvents } = status;
  const latestEvent = distEvents?.[0];

  return (
    <div className="space-y-3">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-app-card border border-app-border rounded-xl p-3 text-center">
          <p className="text-xl font-bold text-app-success">{provisionedCount}</p>
          <p className="text-xs text-app-text-muted">Provisioned</p>
        </div>
        <div className="bg-app-card border border-app-border rounded-xl p-3 text-center">
          <p className="text-xl font-bold text-app-text-2">{totalActiveCompanies - provisionedCount - failedCount}</p>
          <p className="text-xs text-app-text-muted">Not sent</p>
        </div>
        <div className="bg-app-card border border-app-border rounded-xl p-3 text-center">
          <p className={`text-xl font-bold ${failedCount > 0 ? 'text-app-danger' : 'text-app-text-2'}`}>{failedCount}</p>
          <p className="text-xs text-app-text-muted">Failed</p>
        </div>
      </div>

      {latestEvent && (
        <p className="text-xs text-app-text-muted">
          Last distributed {new Date(latestEvent.completedAt || latestEvent.createdAt).toLocaleDateString()}
          {' · '}{latestEvent.distributionPolicy?.replace(/_/g, ' ').toLowerCase()}
        </p>
      )}

      {/* Company rows — collapsible */}
      {companyRows.length > 0 && (
        <div>
          <button
            onClick={() => setExpanded(v => !v)}
            className="flex items-center gap-1.5 text-xs font-semibold text-app-text-muted uppercase tracking-wide mb-2"
          >
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            Company Details ({companyRows.length})
          </button>
          {expanded && (
            <div className="space-y-1.5">
              {companyRows.map((row) => {
                const cfg = STATUS_CONFIG[row.status] || STATUS_CONFIG.PENDING;
                return (
                  <div key={row.companyId} className="flex items-center gap-3 px-3 py-2.5 bg-app-card border border-app-border rounded-xl">
                    <Building2 size={14} className="text-app-text-muted flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-app-text truncate">{row.companyName}</p>
                      {row.status === 'FAILED' && row.errorMessage && (
                        <p className="text-xs text-app-danger truncate">{row.errorMessage}</p>
                      )}
                      {row.provisionedAt && row.status !== 'FAILED' && (
                        <p className="text-xs text-app-text-muted">{new Date(row.provisionedAt).toLocaleDateString()}</p>
                      )}
                    </div>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${cfg.bg} ${cfg.color}`}>
                      {cfg.label}
                    </span>
                    {row.status === 'FAILED' && (
                      <button
                        onClick={() => handleRetry(row.companyId)}
                        disabled={retrying === row.companyId}
                        className="flex-shrink-0 text-app-accent"
                        title="Retry provisioning"
                      >
                        <RefreshCw size={14} className={retrying === row.companyId ? 'animate-spin' : ''} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}