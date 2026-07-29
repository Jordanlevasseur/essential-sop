import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useCompany } from '@/lib/CompanyContext';
import { ArrowLeft, Activity } from 'lucide-react';

// Job-related actions visible to Project Managers
const PM_VISIBLE_ACTIONS = [
  'job_created', 'job_edited', 'job_published', 'job_archived', 'job_restored',
  'edit_request_submitted', 'edit_request_approved', 'edit_request_denied',
  'temporary_access_granted', 'temporary_access_revoked', 'temporary_access_expired',
  'revision_submitted', 'revision_changes_requested', 'revision_rejected', 'revision_published',
];

export default function ActivityHistory() {
  const navigate = useNavigate();
  const { activeCompany, activeMembership } = useCompany();
  const companyId = activeCompany?.id;
  const role = activeMembership?.role;
  const isGM = role === 'general_manager';
  const isPM = role === 'project_manager';

  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!companyId || (!isGM && !isPM)) return;
    base44.entities.ActivityLog.filter({ companyId }, '-timestamp', 100).then(data => {
      let filtered = (data || []);
      if (isPM) {
        filtered = filtered.filter(l => PM_VISIBLE_ACTIONS.includes(l.actionType));
      }
      setLogs(filtered);
      setLoading(false);
    });
  }, [companyId]);

  if (!isGM && !isPM) {
    return (
      <div className="min-h-screen bg-app-bg flex items-center justify-center p-8 text-center">
        <p className="text-sm text-app-text-muted">Activity history is not available for your role.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-app-bg">
      <div className="bg-app-surface border-b border-app-border sticky top-0 z-40" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="icon-btn touch-active"><ArrowLeft size={22} className="text-app-text-2" /></button>
          <h1 className="font-semibold text-app-text flex-1">Activity History</h1>
        </div>
      </div>

      <div className="px-4 pt-4 pb-4 max-w-2xl mx-auto">
        {loading ? (
          <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-app-border border-t-app-accent rounded-full animate-spin" /></div>
        ) : logs.length === 0 ? (
          <p className="text-sm text-app-text-muted text-center py-12">No activity recorded yet.</p>
        ) : (
          <div className="space-y-1">
            {logs.map(log => (
              <div key={log.id} className="flex gap-3 py-3 border-b border-app-divider last:border-0">
                <Activity size={14} className="text-app-text-muted flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-app-text">{log.summary || log.actionType.replace(/_/g, ' ')}</p>
                  <p className="text-xs text-app-text-muted mt-0.5">{log.timestamp ? new Date(log.timestamp).toLocaleString() : ''}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ height: 'calc(16px + env(safe-area-inset-bottom))' }} />
    </div>
  );
}