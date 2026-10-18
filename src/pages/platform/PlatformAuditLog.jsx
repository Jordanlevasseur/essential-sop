import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { ArrowLeft, ScrollText, RefreshCw, ShieldCheck, BookOpen, Users, AlertTriangle } from 'lucide-react';

const ACTION_CONFIG = {
  platform_role_assigned:          { label: 'Admin Granted',        icon: ShieldCheck, cls: 'text-app-success' },
  platform_role_removed:           { label: 'Admin Suspended',      icon: ShieldCheck, cls: 'text-app-warning' },
  master_sop_created:              { label: 'SOP Created',           icon: BookOpen,    cls: 'text-app-accent' },
  master_sop_draft_updated:        { label: 'Draft Updated',         icon: BookOpen,    cls: 'text-app-info' },
  master_sop_version_published:    { label: 'Version Published',     icon: BookOpen,    cls: 'text-app-success' },
  master_sop_archived:             { label: 'SOP Archived',          icon: BookOpen,    cls: 'text-app-text-muted' },
  master_sop_deleted:              { label: 'SOP Deleted',           icon: BookOpen,    cls: 'text-app-danger' },
  master_sop_duplicated:           { label: 'SOP Duplicated',        icon: BookOpen,    cls: 'text-app-info' },
  master_sop_rollback_started:     { label: 'Rollback Started',      icon: BookOpen,    cls: 'text-app-warning' },
  master_sop_rollback_completed:   { label: 'Rollback Completed',    icon: BookOpen,    cls: 'text-app-success' },
  company_library_provisioned:     { label: 'Library Provisioned',   icon: Users,       cls: 'text-app-accent' },
  distribution_event_created:      { label: 'Distribution Created',  icon: Users,       cls: 'text-app-info' },
  publication_requested:           { label: 'Publication Requested', icon: BookOpen,    cls: 'text-app-info' },
  publication_completed:           { label: 'Published',             icon: BookOpen,    cls: 'text-app-success' },
  publication_failed:              { label: 'Publication Failed',    icon: BookOpen,    cls: 'text-app-danger' },
};

function getActionConfig(action) {
  return ACTION_CONFIG[action] || { label: action, icon: AlertTriangle, cls: 'text-app-text-muted' };
}

function timeAgo(isoStr) {
  if (!isoStr) return '—';
  const diff = Date.now() - new Date(isoStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(isoStr).toLocaleDateString();
}

export default function PlatformAuditLog() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await base44.functions.invoke('managePlatformAdmins', { action: 'get_audit', limit: 100 });
      setEntries(res.data?.entries || []);
    } catch (e) {
      setError('Failed to load audit log.');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="min-h-screen bg-app-bg">
      {/* Header */}
      <div className="bg-app-surface border-b border-app-border px-6 py-4 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <button onClick={() => navigate('/platform')} className="icon-btn text-app-text-2">
            <ArrowLeft size={20} />
          </button>
          <div className="flex-1">
            <h1 className="font-bold text-app-text">Platform Audit Log</h1>
            <p className="text-xs text-app-text-muted">{entries.length} entries · Immutable</p>
          </div>
          <button onClick={load} className="icon-btn text-app-text-muted">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6">
        <div className="flex items-start gap-3 p-4 bg-app-info-bg border border-app-info/20 rounded-xl mb-5 text-sm text-app-info">
          <ScrollText size={16} className="flex-shrink-0 mt-0.5" />
          <p>Audit records are immutable. Once written, they cannot be modified or deleted.</p>
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <div className="w-6 h-6 border-2 border-app-border border-t-app-accent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="text-center py-8 text-app-danger text-sm">{error}</div>
        ) : entries.length === 0 ? (
          <div className="text-center py-10 text-app-text-muted text-sm">No audit entries yet.</div>
        ) : (
          <div className="space-y-2">
            {entries.map(entry => {
              const cfg = getActionConfig(entry.action);
              const Icon = cfg.icon;
              return (
                <div key={entry.id || entry.timestamp} className="bg-app-card border border-app-border rounded-lg p-3 flex items-start gap-4">
                  <div className="w-8 h-8 bg-app-elevated rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Icon size={15} className={cfg.cls} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-semibold text-sm text-app-text">{cfg.label}</span>
                      <span className="text-xs text-app-text-disabled">{timeAgo(entry.timestamp)}</span>
                    </div>
                    {entry.masterTitle && (
                      <p className="text-xs text-app-text-2">{entry.masterTitle}</p>
                    )}
                    {entry.targetUserId && (
                      <p className="text-xs text-app-text-muted">Target: {entry.targetUserId}</p>
                    )}
                    <p className="text-xs text-app-text-disabled">
                      By {entry.actingUserId}
                      {entry.changeNotes ? ` · ${entry.changeNotes}` : ''}
                    </p>
                    {entry.idempotencyKey && (
                      <p className="text-[10px] font-mono text-app-text-disabled selectable mt-0.5 break-all">
                        {entry.idempotencyKey}
                      </p>
                    )}
                  </div>
                  <span className="text-[10px] text-app-text-disabled flex-shrink-0 mt-0.5">
                    {entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : ''}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}