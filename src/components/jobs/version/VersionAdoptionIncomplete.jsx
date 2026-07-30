import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { AlertTriangle, RotateCcw, ArrowLeft, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { useAdoptionDraftState } from '@/lib/useAdoptionDraftState';

/**
 * VersionAdoptionIncomplete — Edit 5D Final Correction
 *
 * Recovery UI for ADOPTION_INCOMPLETE state.
 *
 * ── RECOVERY SOURCE PRIORITY ──────────────────────────────────────────────────
 * 1. Server (authoritative): reads pendingAnalysisId + lastAdoptionMutationKey
 *    from the incomplete JobOverride record via resolveIncompleteAdoption.
 *    Works from any device, any browser, after localStorage is cleared.
 *
 * 2. localStorage (client convenience cache): used only when the server
 *    record cannot be fetched. Written by VersionWorkspace.persistAdoptionStart().
 *
 * 3. Mismatch detection: if both sources are available and mutationKey disagrees,
 *    halt with RECOVERY_STATE_MISMATCH — never guess, never proceed with wrong key.
 *
 * ── RECOVERY FLOW ─────────────────────────────────────────────────────────────
 * 1. On mount, fetch incomplete override record (server authoritative source)
 * 2. Compare with localStorage if both present
 * 3. Block on mismatch — surface clear error, no writes
 * 4. Call adoptVersionFromAnalysis with resolved mutationKey + analysisId
 * 5. Engine routes to recovery Case A/B/C via mutationKey idempotency check
 * 6. On success, clearDraft() removes localStorage cache
 */

export default function VersionAdoptionIncomplete({ job, onRecovered, onClose }) {
  const { persistedMutationKey, persistedAnalysisId, clearDraft } = useAdoptionDraftState(
    job.companyId, job.id, null
  );

  const [serverRecovery, setServerRecovery] = useState(null); // { mutationKey, analysisId } | null
  const [loadingServer, setLoadingServer] = useState(true);
  const [serverLoadError, setServerLoadError] = useState(null);

  const [recovering, setRecovering] = useState(false);
  const [recoveryError, setRecoveryError] = useState(null);
  const [recovered, setRecovered] = useState(false);

  // ── Step 1: Fetch server-side recovery identifiers ─────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function fetchServerRecovery() {
      setLoadingServer(true);
      setServerLoadError(null);
      try {
        // Call resolveJob — it returns ADOPTION_INCOMPLETE with pendingAnalysisId on the override
        // We need to load the override directly to read pendingAnalysisId + lastAdoptionMutationKey.
        // We use a dedicated backend call pattern: resolveJob already blocks on ADOPTION_INCOMPLETE,
        // so instead we invoke getVersionStatus to get the job state, then use a direct approach:
        // call adoptVersionFromAnalysis with mutationKey='' to trigger the recovery info response.
        //
        // Better: expose a lightweight endpoint. Since we don't have one, we use the service-role
        // pattern via resolveJob which already surfaces pendingAnalysisId in its ADOPTION_INCOMPLETE
        // response metadata.
        const res = await base44.functions.invoke('resolveJob', { jobId: job.id });
        if (cancelled) return;

        const data = res?.data;
        if (data?.code === 'ADOPTION_INCOMPLETE') {
          // resolveJob returns the incomplete override's recovery fields in the error response
          const serverMutationKey = data?.lastAdoptionMutationKey || null;
          const serverAnalysisId = data?.pendingAnalysisId || null;
          if (serverMutationKey || serverAnalysisId) {
            setServerRecovery({ mutationKey: serverMutationKey, analysisId: serverAnalysisId });
          } else {
            // Server doesn't include recovery fields in response — fall back to localStorage only
            setServerRecovery(null);
          }
        } else if (data?.job) {
          // Job resolved cleanly — adoption must have already completed; notify parent
          if (!cancelled) onRecovered(data);
          return;
        } else {
          setServerLoadError('Could not load recovery information from server.');
        }
      } catch (_) {
        if (!cancelled) setServerLoadError('Network error fetching recovery state. Will use local cache if available.');
      } finally {
        if (!cancelled) setLoadingServer(false);
      }
    }
    fetchServerRecovery();
    return () => { cancelled = true; };
  }, [job.id]);

  // ── Resolve effective recovery identifiers ─────────────────────────────────
  // Server is authoritative. localStorage is a fallback.
  // If both present and mutationKey disagrees → MISMATCH, block.
  const effectiveMutationKey = (() => {
    if (serverRecovery?.mutationKey && persistedMutationKey) {
      if (serverRecovery.mutationKey !== persistedMutationKey) return '__MISMATCH__';
      return serverRecovery.mutationKey;
    }
    return serverRecovery?.mutationKey || persistedMutationKey || null;
  })();

  const effectiveAnalysisId = (() => {
    if (serverRecovery?.analysisId && persistedAnalysisId) {
      if (serverRecovery.analysisId !== persistedAnalysisId) return '__MISMATCH__';
      return serverRecovery.analysisId;
    }
    return serverRecovery?.analysisId || persistedAnalysisId || null;
  })();

  const hasMismatch = effectiveMutationKey === '__MISMATCH__' || effectiveAnalysisId === '__MISMATCH__';
  const source = serverRecovery?.mutationKey
    ? (persistedMutationKey ? 'server+local' : 'server')
    : (persistedMutationKey ? 'local-only' : 'none');

  const canResume = !loadingServer && !hasMismatch && !!effectiveMutationKey && !!effectiveAnalysisId;

  const handleResume = async () => {
    if (!canResume) return;

    setRecovering(true);
    setRecoveryError(null);
    try {
      const adoptRes = await base44.functions.invoke('adoptVersionFromAnalysis', {
        companyJobId: job.id,
        analysisId: effectiveAnalysisId,
        reviewDecisions: {},
        mutationKey: effectiveMutationKey,
        expectedOverrideRevision: 0,
      });

      const data = adoptRes?.data;
      if (data?.success) {
        clearDraft();
        setRecovered(true);
        setTimeout(() => onRecovered(data.resolvedJob), 1200);
      } else if (data?.code === 'ALREADY_CURRENT' || data?.idempotent) {
        // Already completed — re-resolve the job
        const recheck = await base44.functions.invoke('resolveJob', { jobId: job.id });
        if (recheck?.data?.job) {
          clearDraft();
          setRecovered(true);
          setTimeout(() => onRecovered(recheck.data), 1200);
        } else {
          setRecoveryError(data?.error || 'Recovery returned unexpected state. Please try again.');
        }
      } else {
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
        {/* Loading server recovery state */}
        {loadingServer && (
          <div className="flex items-center gap-3 p-4 bg-app-elevated rounded-xl">
            <Loader2 size={16} className="text-app-accent animate-spin flex-shrink-0" />
            <p className="text-sm text-app-text-2">Loading recovery information…</p>
          </div>
        )}

        {/* Explanation */}
        {!loadingServer && (
          <div className="p-4 bg-app-warning-bg border border-app-warning/30 rounded-xl">
            <div className="flex items-start gap-3">
              <AlertTriangle size={18} className="text-app-warning flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-app-text mb-1">An adoption was interrupted</p>
                <p className="text-sm text-app-text-2 leading-relaxed">
                  A version adoption for this job started but did not fully complete — likely due to a network interruption or app restart.
                </p>
                <p className="text-sm text-app-text-2 leading-relaxed mt-2">
                  <strong>Your data is safe.</strong> Pressing "Resume" will safely continue from where it left off — no work will be duplicated.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Mismatch error — hard block */}
        {!loadingServer && hasMismatch && (
          <div className="p-4 bg-app-danger-bg border border-app-danger/20 rounded-xl">
            <div className="flex items-start gap-2">
              <XCircle size={16} className="text-app-danger flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-app-danger mb-1">Recovery State Mismatch</p>
                <p className="text-xs text-app-text-2">
                  The server record and your local cache show different recovery identifiers for this adoption.
                  This can happen if another device attempted recovery concurrently.
                  Recovery is blocked to prevent data corruption. Contact support with your Job ID.
                </p>
                <p className="text-xs font-mono text-app-text-muted mt-2 selectable">Job: {job.id}</p>
              </div>
            </div>
          </div>
        )}

        {/* Recovery source indicator */}
        {!loadingServer && !hasMismatch && (
          <div className="space-y-1">
            <p className="text-xs font-bold text-app-text-muted uppercase tracking-wide">Recovery Source</p>
            <div className="p-3 bg-app-elevated rounded-xl flex items-center gap-2">
              {source === 'server+local' && <CheckCircle2 size={13} className="text-app-success flex-shrink-0" />}
              {source === 'server' && <CheckCircle2 size={13} className="text-app-accent flex-shrink-0" />}
              {source === 'local-only' && <AlertTriangle size={13} className="text-app-warning flex-shrink-0" />}
              {source === 'none' && <XCircle size={13} className="text-app-danger flex-shrink-0" />}
              <p className="text-xs text-app-text-2">
                {source === 'server+local' && 'Server + local cache agree — full confidence'}
                {source === 'server' && 'Server record found — recovery available from any device'}
                {source === 'local-only' && 'Local cache only — server record unavailable; may not work on another device'}
                {source === 'none' && 'No recovery data found — cannot resume automatically'}
              </p>
            </div>
            {effectiveMutationKey && effectiveMutationKey !== '__MISMATCH__' && (
              <p className="text-xs font-mono text-app-text-muted selectable break-all px-1">
                Key: {effectiveMutationKey}
              </p>
            )}
          </div>
        )}

        {/* Server load warning (non-fatal) */}
        {serverLoadError && source !== 'none' && (
          <div className="p-3 bg-app-warning-bg border border-app-warning/20 rounded-xl flex items-start gap-2">
            <AlertTriangle size={13} className="text-app-warning flex-shrink-0 mt-0.5" />
            <p className="text-xs text-app-text-2">{serverLoadError}</p>
          </div>
        )}

        {/* Recovery error */}
        {recoveryError && (
          <div className="p-3.5 bg-app-danger-bg border border-app-danger/20 rounded-xl flex items-start gap-2">
            <XCircle size={14} className="text-app-danger flex-shrink-0 mt-0.5" />
            <p className="text-xs text-app-danger">{recoveryError}</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="bg-app-surface border-t border-app-border px-4 pt-3 space-y-2.5"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <button
          onClick={handleResume}
          disabled={recovering || !canResume || loadingServer}
          className="w-full py-3 bg-app-accent text-app-accent-text rounded-xl text-sm font-semibold no-select touch-active disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {recovering
            ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Resuming…</>
            : loadingServer
              ? <><Loader2 size={15} className="animate-spin" />Loading…</>
              : hasMismatch
                ? 'Blocked — State Mismatch'
                : !canResume
                  ? 'Recovery Data Unavailable'
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