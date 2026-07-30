import React, { useEffect, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import VersionUpdateFlow from '@/components/jobs/version/VersionUpdateFlow';

/**
 * VersionUpdateBanner — Entry point for the version update flow.
 *
 * Calls getVersionStatus to determine if an update is available.
 * Renders a compact banner with plain-language action labels.
 * Opens VersionUpdateFlow (progressive review workflow) on interaction.
 */
export default function VersionUpdateBanner({ job, overrideMeta, onAdopted }) {
  const [versionStatus, setVersionStatus] = useState(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [showFlow, setShowFlow] = useState(false);

  const loadStatus = useCallback(async () => {
    if (!job?.id) return;
    setLoadingStatus(true);
    try {
      const res = await base44.functions.invoke('getVersionStatus', { jobId: job.id });
      setVersionStatus(res?.data || null);
    } catch (_) {
      setVersionStatus(null);
    } finally {
      setLoadingStatus(false);
    }
  }, [job?.id]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  if (loadingStatus || !versionStatus || !versionStatus.updateAvailable) return null;

  const { pinnedVersion, newestVersion, predictedConflicts } = versionStatus;
  const hasConflicts = predictedConflicts && predictedConflicts.length > 0;
  const canAutoAdopt = versionStatus.canAutoAdopt === true;

  return (
    <>
      <div className={`mx-4 my-3 rounded-xl border p-4 ${hasConflicts ? 'bg-app-warning-bg border-app-warning/30' : 'bg-app-info-bg border-app-border'}`}>
        {/* Top row */}
        <div className="flex items-start gap-3">
          <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${hasConflicts ? 'bg-app-warning/10' : 'bg-app-accent/10'}`}>
            {hasConflicts
              ? <AlertTriangle size={18} className="text-app-warning" />
              : <RefreshCw size={18} className="text-app-accent" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-app-text">
              Version {newestVersion?.versionNumber} available
            </p>
            <p className="text-xs text-app-text-muted mt-0.5">
              You're on version {pinnedVersion?.versionNumber}
              {hasConflicts ? ` · ${predictedConflicts.length} item${predictedConflicts.length !== 1 ? 's' : ''} need your decision` : ' · fully compatible update'}
            </p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 mt-3">
          {canAutoAdopt && !hasConflicts ? (
            <>
              <button
                onClick={() => setShowFlow(true)}
                className="flex-1 py-2 bg-app-accent text-app-accent-text rounded-lg text-xs font-semibold no-select touch-active text-center"
              >
                Apply Safe Update
              </button>
              <button
                onClick={() => setShowFlow(true)}
                className="px-3 py-2 border border-app-border rounded-lg text-xs font-medium text-app-text-2 no-select touch-active"
              >
                Review
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setShowFlow(true)}
                className="flex-1 py-2 bg-app-accent text-app-accent-text rounded-lg text-xs font-semibold no-select touch-active text-center"
              >
                {hasConflicts ? 'Review and Update' : 'Review Changes'}
              </button>
              <button
                onClick={async () => {
                  // Inline defer without opening the full flow
                  try {
                    const { base44 } = await import('@/api/base44Client');
                    const user = await base44.auth.me().catch(() => null);
                    await base44.entities.ActivityLog.create({
                      companyId: job.companyId,
                      actingUserId: user?.id,
                      actionType: 'job_edited',
                      targetType: 'Job',
                      targetId: job.id,
                      summary: `Update deferred: staying on v${pinnedVersion?.versionNumber}`,
                      metadata: { event: 'update_deferred', targetVersionId: newestVersion?.id },
                      timestamp: new Date().toISOString(),
                    });
                  } catch (_) {}
                  setVersionStatus(null); // hide banner
                }}
                className="px-3 py-2 border border-app-border rounded-lg text-xs font-medium text-app-text-muted no-select touch-active"
              >
                Not Now
              </button>
            </>
          )}
        </div>

        {hasConflicts && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-app-warning">
            <AlertTriangle size={11} className="flex-shrink-0" />
            <span>Your company has customizations that overlap with this update</span>
          </div>
        )}

        {canAutoAdopt && !hasConflicts && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-app-success">
            <CheckCircle2 size={11} className="flex-shrink-0" />
            <span>All your customizations are compatible — safe to apply automatically</span>
          </div>
        )}
      </div>

      {showFlow && (
        <VersionUpdateFlow
          job={job}
          overrideMeta={overrideMeta}
          targetVersionId={newestVersion?.id}
          currentVersion={pinnedVersion}
          newVersion={newestVersion}
          onAdopted={(resolvedJob) => {
            setShowFlow(false);
            setVersionStatus(null);
            if (resolvedJob) onAdopted(resolvedJob);
          }}
          onClose={() => setShowFlow(false)}
        />
      )}
    </>
  );
}