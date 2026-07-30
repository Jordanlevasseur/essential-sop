import React, { useEffect, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { RefreshCw, AlertTriangle, Clock, X, CheckCircle2 } from 'lucide-react';
import VersionUpdateFlow from '@/components/jobs/version/VersionUpdateFlow';

/**
 * VersionUpdateBanner — Entry point for the version update flow.
 *
 * Calls getVersionStatus to determine if an update is available AND not suppressed.
 * Suppression (NOT_NOW / DISMISSED) is evaluated server-side — no localStorage.
 * Opens VersionUpdateFlow on "Review Changes" / "Review and Update".
 * "Not Now" shows a persistent action sheet backed by manageVersionDeferral.
 */
export default function VersionUpdateBanner({ job, overrideMeta, onAdopted }) {
  const [versionStatus, setVersionStatus] = useState(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [showFlow, setShowFlow] = useState(false);
  const [showNotNowSheet, setShowNotNowSheet] = useState(false);
  const [deferring, setDeferring] = useState(false);
  const [deferConfirmed, setDeferConfirmed] = useState(null); // 'NOT_NOW' | 'DISMISSED'

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

  // Hide banner: loading, no status, no update, no permission, or actively suppressed
  if (loadingStatus || !versionStatus || !versionStatus.updateAvailable) return null;
  if (!versionStatus.capabilities?.canAdoptVersion) return null;
  if (versionStatus.isSuppressed) return null;

  const { pinnedVersion, newestVersion, predictedConflicts } = versionStatus;
  const hasConflicts = predictedConflicts && predictedConflicts.length > 0;

  const handleDefer = async (action) => {
    setDeferring(true);
    try {
      await base44.functions.invoke('manageVersionDeferral', {
        action: action === 'NOT_NOW' ? 'DEFER' : 'DISMISS',
        jobId: job.id,
        deferredVersionId: newestVersion?.id,
      });
      setDeferConfirmed(action);
      // After brief confirmation, reload status so the banner re-evaluates suppression
      setTimeout(() => {
        setShowNotNowSheet(false);
        setDeferConfirmed(null);
        loadStatus();
      }, 1800);
    } catch (_) {
      // Fallback: hide for this session if backend write fails
      setShowNotNowSheet(false);
      setVersionStatus(null);
    } finally {
      setDeferring(false);
    }
  };

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
          <button
            onClick={() => setShowFlow(true)}
            className="flex-1 py-2 bg-app-accent text-app-accent-text rounded-lg text-xs font-semibold no-select touch-active text-center"
          >
            {hasConflicts ? 'Review and Update' : 'Review Changes'}
          </button>
          <button
            onClick={() => setShowNotNowSheet(true)}
            className="px-3 py-2 border border-app-border rounded-lg text-xs font-medium text-app-text-muted no-select touch-active"
          >
            Not Now
          </button>
        </div>

        {hasConflicts && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-app-warning">
            <AlertTriangle size={11} className="flex-shrink-0" />
            <span>Your company has customizations that overlap with this update</span>
          </div>
        )}
      </div>

      {/* Not Now bottom sheet */}
      {showNotNowSheet && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" style={{ background: 'hsl(var(--app-overlay))' }}>
          <div className="bg-app-surface rounded-t-2xl p-6 pb-8" style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}>
            {deferConfirmed ? (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <CheckCircle2 size={36} className="text-app-success" />
                <p className="text-base font-semibold text-app-text">
                  {deferConfirmed === 'NOT_NOW' ? 'Reminder set' : 'Version dismissed'}
                </p>
                <p className="text-sm text-app-text-2">
                  {deferConfirmed === 'NOT_NOW'
                    ? "We'll remind you about this update in 7 days."
                    : 'This version is dismissed. A newer version will still appear when published.'}
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Clock size={20} className="text-app-text-muted" />
                    <p className="text-base font-semibold text-app-text">Skip this update?</p>
                  </div>
                  <button onClick={() => setShowNotNowSheet(false)} className="icon-btn touch-active no-select">
                    <X size={20} className="text-app-text-muted" />
                  </button>
                </div>
                <p className="text-sm text-app-text-2 mb-5">
                  Your job stays on version {pinnedVersion?.versionNumber}. You can apply version {newestVersion?.versionNumber} any time from this page.
                </p>
                <div className="space-y-3">
                  <button
                    onClick={() => handleDefer('NOT_NOW')}
                    disabled={deferring}
                    className="w-full py-3.5 border border-app-border rounded-xl text-left px-4 no-select touch-active disabled:opacity-50"
                  >
                    <p className="text-sm font-semibold text-app-text">Remind me later</p>
                    <p className="text-xs text-app-text-muted mt-0.5">Banner reappears in 7 days</p>
                  </button>
                  <button
                    onClick={() => handleDefer('DISMISSED')}
                    disabled={deferring}
                    className="w-full py-3.5 border border-app-border rounded-xl text-left px-4 no-select touch-active disabled:opacity-50"
                  >
                    <p className="text-sm font-semibold text-app-text">Dismiss this version</p>
                    <p className="text-xs text-app-text-muted mt-0.5">Only this version is dismissed — a newer update will still appear</p>
                  </button>
                </div>
                <button
                  onClick={() => setShowNotNowSheet(false)}
                  className="w-full mt-4 text-sm text-app-text-muted text-center no-select touch-active"
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {showFlow && (
        <VersionUpdateFlow
          job={job}
          overrideMeta={overrideMeta}
          targetVersionId={newestVersion?.id}
          currentVersion={pinnedVersion}
          newVersion={newestVersion}
          onAdopted={async (resolvedJob) => {
            setShowFlow(false);
            // Clear any stale deferrals for this version after successful adoption
            await base44.functions.invoke('manageVersionDeferral', {
              action: 'CLEAR',
              jobId: job.id,
              deferredVersionId: newestVersion?.id,
            }).catch(() => {});
            setVersionStatus(null);
            if (resolvedJob) onAdopted(resolvedJob);
          }}
          onClose={() => setShowFlow(false)}
        />
      )}
    </>
  );
}