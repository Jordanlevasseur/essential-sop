import React, { useEffect, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { RefreshCw, AlertTriangle, ChevronDown, ChevronUp, X } from 'lucide-react';

/**
 * VersionUpdateBanner — Version Management Engine UI.
 *
 * Shown inside JobDetail when:
 *   - job is a provisioned Essential SOP
 *   - capabilities.canCustomize is true (admin)
 *   - backend reports updateAvailable === true
 *
 * Props:
 *   job            — resolved job object (must have stable Job.id)
 *   overrideMeta   — current override metadata from resolveJob (or null)
 *   onAdopted      — callback(resolvedJob) after successful adoption
 */
export default function VersionUpdateBanner({ job, overrideMeta, onAdopted }) {
  const [versionStatus, setVersionStatus] = useState(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [showConfirm, setShowConfirm] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const [adoptError, setAdoptError] = useState(null);
  const [showConflicts, setShowConflicts] = useState(false);

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

  const handleAdopt = useCallback(async () => {
    if (adopting || !versionStatus?.newestVersion) return;
    setAdopting(true);
    setAdoptError(null);
    const mutationKey = `adopt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const expectedRevision = overrideMeta?.revision ?? 0;
    try {
      const res = await base44.functions.invoke('adoptMasterVersion', {
        jobId: job.id,
        targetVersionId: versionStatus.newestVersion.id,
        expectedRevision,
        mutationKey,
      });
      if (res.data?.success) {
        setShowConfirm(false);
        onAdopted(res.data.resolvedJob);
      } else {
        setAdoptError(res.data?.error || 'Update failed. Please try again.');
        setShowConfirm(false);
      }
    } catch (err) {
      const msg = err?.message || '';
      setAdoptError(
        msg.includes('REVISION_CONFLICT')
          ? 'Another change was made since you opened this page. Please reload and try again.'
          : 'Update failed. Please try again.'
      );
      setShowConfirm(false);
    } finally {
      setAdopting(false);
    }
  }, [adopting, versionStatus, job, overrideMeta, onAdopted]);

  if (loadingStatus || !versionStatus || !versionStatus.updateAvailable) return null;

  const { pinnedVersion, newestVersion, predictedConflicts, compatibility } = versionStatus;
  const hasConflicts = predictedConflicts && predictedConflicts.length > 0;

  return (
    <>
      <div className={`mx-5 my-3 rounded-xl border p-3.5 ${hasConflicts ? 'bg-app-warning-bg border-app-warning/40' : 'bg-app-info-bg border-app-border'}`}>
        <div className="flex items-start gap-2.5">
          <RefreshCw size={16} className={`flex-shrink-0 mt-0.5 ${hasConflicts ? 'text-app-warning' : 'text-app-accent'}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <p className={`text-sm font-semibold ${hasConflicts ? 'text-app-warning' : 'text-app-text'}`}>
                Version Update Available
              </p>
              {hasConflicts && (
                <button
                  onClick={() => setShowConflicts(v => !v)}
                  className="flex items-center gap-1 text-xs text-app-warning font-medium no-select touch-active"
                >
                  {showConflicts ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  {predictedConflicts.length} conflict{predictedConflicts.length !== 1 ? 's' : ''}
                </button>
              )}
            </div>
            <p className="text-xs text-app-text-muted mt-0.5">
              Current: v{pinnedVersion?.versionNumber} → Available: v{newestVersion?.versionNumber}
            </p>
            {hasConflicts && showConflicts && (
              <div className="mt-2 space-y-1">
                {predictedConflicts.map((c, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-xs text-app-warning">
                    <AlertTriangle size={11} className="flex-shrink-0 mt-0.5" />
                    <span>{c.description || `${c.sectionType} — ${c.field}`}</span>
                  </div>
                ))}
              </div>
            )}
            {adoptError && (
              <p className="mt-2 text-xs text-app-danger">{adoptError}</p>
            )}
          </div>
          <button
            onClick={() => setShowConfirm(true)}
            disabled={adopting}
            className="flex-shrink-0 px-3 py-1.5 bg-app-accent text-app-accent-text rounded-lg text-xs font-medium no-select touch-active disabled:opacity-50"
          >
            Update
          </button>
        </div>
      </div>

      {/* Confirmation sheet */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50">
          <div
            className="bg-app-surface rounded-t-2xl p-5 w-full max-w-lg"
            style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <RefreshCw size={18} className="text-app-accent flex-shrink-0" />
                <h2 className="font-semibold text-app-text">Update to v{newestVersion?.versionNumber}?</h2>
              </div>
              <button onClick={() => setShowConfirm(false)} className="icon-btn text-app-text-muted touch-active">
                <X size={18} />
              </button>
            </div>
            <p className="text-sm text-app-text-2 mb-2">
              A newer Essential SOP version is available. Updating will adopt the selected published version
              while preserving your company's customizations whenever possible.
            </p>
            {hasConflicts && (
              <div className="mb-3 p-2.5 bg-app-warning-bg rounded-lg border border-app-warning/30">
                <div className="flex items-center gap-1.5 mb-1">
                  <AlertTriangle size={13} className="text-app-warning flex-shrink-0" />
                  <p className="text-xs font-semibold text-app-warning">{predictedConflicts.length} potential conflict{predictedConflicts.length !== 1 ? 's' : ''} detected</p>
                </div>
                <p className="text-xs text-app-text-muted">
                  Your customizations will be preserved. Review them after updating.
                </p>
              </div>
            )}
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 py-2.5 border border-app-border rounded-lg text-sm font-medium text-app-text-2 no-select touch-active"
              >
                Cancel
              </button>
              <button
                onClick={handleAdopt}
                disabled={adopting}
                className="flex-1 py-2.5 bg-app-accent text-app-accent-text rounded-lg text-sm font-medium no-select touch-active disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {adopting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Updating…
                  </>
                ) : 'Update'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}