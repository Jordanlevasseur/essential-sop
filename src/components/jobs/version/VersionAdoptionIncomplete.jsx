import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { AlertTriangle, RotateCcw, ArrowLeft, CheckCircle2, XCircle } from 'lucide-react';
import { useAdoptionDraftState } from '@/lib/useAdoptionDraftState';

/**
 * VersionAdoptionIncomplete — Edit 5D Hardening
 *
 * Recovery UI for ADOPTION_INCOMPLETE state.
 *
 * Reads the persisted mutationKey AND analysisId from localStorage via useAdoptionDraftState.
 * Never fabricates an analysisId. Recovery works after refresh, reconnect, and browser restart.
 *
 * Recovery path:
 *  1. Read persistedMutationKey + persistedAnalysisId from localStorage
 *  2. Call adoptVersionFromAnalysis with those persisted values
 *  3. Engine routes to recovery Case A/B/C via mutationKey idempotency check
 *  4. On success, clearDraft() removes the persisted state
 */

export default function VersionAdoptionIncomplete({ job, onRecovered, onClose }) {
  // Read persisted adoption start state — written by VersionWorkspace.persistAdoptionStart()
  // before Step 1 of the three-step write. Survives refresh/crash.
  const { persistedMutationKey, persistedAnalysisId, clearDraft } = useAdoptionDraftState(job.id, null);

  const [recovering, setRecovering] = useState(false);
  const [recoveryError, setRecoveryError] = useState(null);
  const [recovered, setRecovered] = useState(false);

  const handleResume = async () => {
    if (!persistedMutationKey) {
      setRecoveryError('Cannot resume: the original mutation key is missing. This can happen if adoption was started on a different device. Please contact support.');
      return;
    }
    if (!persistedAnalysisId) {
      setRecoveryError('Cannot resume: the original analysis ID is missing. Please contact support with the job ID.');
      return;
    }

    setRecovering(true);
    setRecoveryError(null);
    try {
      // Call adoptVersionFromAnalysis with the persisted analysisId + mutationKey.
      // The engine's Phase 2 idempotency check fires first — it detects the partial state
      // (rebaseIncomplete=true) and routes to the correct recovery step (Case A or B)
      // without re-running analysis, re-running versionDiff, or re-running rebase.
      // expectedOverrideRevision=0 is safe here because idempotency routing in Phase 2
      // fires before the revision conflict check in Phase 2 (fresh adoption path).
      const adoptRes = await base44.functions.invoke('adoptVersionFromAnalysis', {
        companyJobId: job.id,
        analysisId: persistedAnalysisId,
        reviewDecisions: {},
        mutationKey: persistedMutationKey,
        expectedOverrideRevision: 0,
      });

      const data = adoptRes?.data;
      if (data?.success) {
        clearDraft();
        setRecovered(true);
        setTimeout(() => onRecovered(data.resolvedJob), 1200);
      } else {
        // If engine returned ALREADY_CURRENT or idempotent path: check resolveJob
        if (data?.code === 'ALREADY_CURRENT' || data?.idempotent) {
          const recheck = await base44.functions.invoke('resolveJob', { jobId: job.id });
          if (recheck?.data?.job) {
            clearDraft();
            setRecovered(true);
            setTimeout(() => onRecovered(recheck.data), 1200);
            return;
          }
        }
        setRecoveryError(data?.error || 'Recovery failed. Please try again or contact support.');
      }
    } catch (_) {
      setRecoveryError('Connection error during recovery. Your data is safe — try again.');
    } finally {
      setRecovering(false);
    }
  };

  if (recovered) {
    return (
      <div className="fixed inset-0 z-50 bg-app-bg flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 p-8 text-center">
          <CheckCircle2 size={48} className="text-app-success" />
          <p className="text-app-text font-semibold">Recovery Complete</p>
          <p className="text-sm text-app-text-2">The adoption has been finalized successfully.</p>
        </div>
      </div>
    );
  }

  const canResume = !!(persistedMutationKey && persistedAnalysisId);

  return (
    <div className="fixed inset-0 z-50 bg-app-bg flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      {/* Header */}
      <div className="bg-app-surface border-b border-app-border px-4 py-3 flex items-center gap-3">
        <button onClick={onClose} className="icon-btn touch-active no-select">
          <ArrowLeft size={22} className="text-app-text-2" />
        </button>
        <h1 className="font-semibold text-app-text flex-1">Adoption Interrupted</h1>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* Explanation */}
        <div className="p-4 bg-app-warning-bg border border-app-warning/30 rounded-xl">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-app-warning flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-app-text mb-1">An adoption was interrupted</p>
              <p className="text-sm text-app-text-2 leading-relaxed">
                A version adoption for this job started but did not fully complete — likely due to a network interruption or app restart.
              </p>
              <p className="text-sm text-app-text-2 leading-relaxed mt-2">
                <strong>Your data is safe.</strong> The adoption engine uses a durable recovery mechanism. Pressing "Resume" will safely continue from where it left off — no work will be duplicated.
              </p>
            </div>
          </div>
        </div>

        {/* What happened */}
        <div className="space-y-2">
          <p className="text-xs font-bold text-app-text-muted uppercase tracking-wide">What happened</p>
          <div className="p-3.5 bg-app-card border border-app-border rounded-xl text-sm text-app-text-2 space-y-2 leading-relaxed">
            <p>The adoption writes three steps:</p>
            <ol className="list-decimal list-inside space-y-1 text-xs">
              <li>Write the rebased override (with <code className="bg-app-elevated px-1 rounded text-xs">rebaseIncomplete=true</code>)</li>
              <li>Pin the new version on the Job</li>
              <li>Clear the incomplete marker</li>
            </ol>
            <p className="text-xs">The process stopped between steps. Resuming will complete the missing steps and clear the marker.</p>
          </div>
        </div>

        {/* Recovery key info */}
        {canResume ? (
          <div className="space-y-1">
            <p className="text-xs font-bold text-app-text-muted uppercase tracking-wide">Recovery Key</p>
            <div className="p-3 bg-app-elevated rounded-xl">
              <p className="text-xs font-mono text-app-text-2 selectable break-all">{persistedMutationKey}</p>
            </div>
            <p className="text-xs text-app-text-muted">Keep this for support if recovery fails.</p>
          </div>
        ) : (
          <div className="p-3.5 bg-app-warning-bg border border-app-warning/20 rounded-xl">
            <p className="text-xs text-app-warning font-semibold mb-1">Recovery key not found</p>
            <p className="text-xs text-app-text-2">
              The adoption may have been started on a different device or browser. If you can, open the app on the original device to resume.
              Otherwise, contact support with your Job ID.
            </p>
          </div>
        )}

        {/* Error */}
        {recoveryError && (
          <div className="p-3.5 bg-app-danger-bg border border-app-danger/20 rounded-xl flex items-start gap-2">
            <XCircle size={14} className="text-app-danger flex-shrink-0 mt-0.5" />
            <p className="text-xs text-app-danger">{recoveryError}</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="bg-app-surface border-t border-app-border px-4 pt-3 space-y-2.5" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <button
          onClick={handleResume}
          disabled={recovering || !canResume}
          className="w-full py-3 bg-app-accent text-app-accent-text rounded-xl text-sm font-semibold no-select touch-active disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {recovering
            ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Resuming…</>
            : <><RotateCcw size={15} />Resume Adoption</>
          }
        </button>
        <button
          onClick={() => window.location.reload()}
          className="w-full py-2.5 border border-app-border rounded-xl text-sm font-medium text-app-text-2 no-select touch-active"
        >
          Refresh Page
        </button>
        <button
          onClick={onClose}
          className="w-full py-2 text-sm text-app-text-muted underline no-select touch-active"
        >
          Return to Job
        </button>
      </div>
    </div>
  );
}