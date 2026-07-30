import React, { useEffect, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import VersionWorkspace from '@/components/jobs/version/VersionWorkspace';

/**
 * VersionUpdateBanner — Edit 7: Entry point for the review-based adoption flow.
 *
 * Shows a compact banner when an update is available.
 * Tapping "Review Update" opens VersionUpdateReview (full-screen conflict resolution).
 * Direct no-conflict adoption is now routed through the review flow for consistency.
 */
export default function VersionUpdateBanner({ job, overrideMeta, onAdopted }) {
  const [versionStatus, setVersionStatus] = useState(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [showReview, setShowReview] = useState(false);

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

  return (
    <>
      <div className={`mx-5 my-3 rounded-xl border p-3.5 ${hasConflicts ? 'bg-app-warning-bg border-app-warning/40' : 'bg-app-info-bg border-app-border'}`}>
        <div className="flex items-center gap-2.5">
          <RefreshCw size={16} className={`flex-shrink-0 ${hasConflicts ? 'text-app-warning' : 'text-app-accent'}`} />
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-semibold ${hasConflicts ? 'text-app-warning' : 'text-app-text'}`}>
              Version Update Available
            </p>
            <p className="text-xs text-app-text-muted mt-0.5">
              v{pinnedVersion?.versionNumber} → v{newestVersion?.versionNumber}
              {hasConflicts && ` · ${predictedConflicts.length} conflict${predictedConflicts.length !== 1 ? 's' : ''} to review`}
            </p>
          </div>
          <button
            onClick={() => setShowReview(true)}
            className="flex-shrink-0 px-3 py-1.5 bg-app-accent text-app-accent-text rounded-lg text-xs font-medium no-select touch-active"
          >
            Review Update
          </button>
        </div>
        {hasConflicts && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-app-warning">
            <AlertTriangle size={11} className="flex-shrink-0" />
            <span>Decisions required before updating</span>
          </div>
        )}
      </div>

      {showReview && (
        <VersionWorkspace
          job={job}
          overrideMeta={overrideMeta}
          targetVersionId={newestVersion?.id}
          onAdopted={(resolvedJob) => {
            setShowReview(false);
            setVersionStatus(null);
            if (resolvedJob) onAdopted(resolvedJob);
          }}
          onClose={() => setShowReview(false)}
        />
      )}
    </>
  );
}