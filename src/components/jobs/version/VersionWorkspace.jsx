import React, { useEffect, useState, useCallback, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { ArrowLeft, RefreshCw, CheckCircle2, AlertTriangle, XCircle, Eye, History, Zap } from 'lucide-react';
import VersionReviewItems from './VersionReviewItems';
import VersionPreview from './VersionPreview';
import VersionHistory from './VersionHistory';
import { useAdoptionDraftState } from '@/lib/useAdoptionDraftState';
import { useAuth } from '@/lib/AuthContext';

/**
 * VersionWorkspace — Edit 5D Hardening
 *
 * Changes from initial 5D:
 *  1. Preview uses previewFromAnalysis (same engine as adoptVersionFromAnalysis).
 *  2. mutationKey + analysisId persisted to localStorage — recovery never uses a placeholder.
 *  3. reviewDecisions + orphanDispositions persisted to localStorage — survive refresh/crash.
 */

const TABS = [
  { id: 'review', label: 'Review', icon: AlertTriangle },
  { id: 'preview', label: 'Preview', icon: Eye },
  { id: 'history', label: 'History', icon: History },
];

export default function VersionWorkspace({ job, overrideMeta, targetVersionId, onAdopted, onClose }) {
  const { user } = useAuth();
  const userId = user?.id || null;

  const [tab, setTab] = useState('review');
  const [analysis, setAnalysis] = useState(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState(true);
  const [analysisError, setAnalysisError] = useState(null);

  // Persistent draft state — scoped by companyId + jobId + userId for full isolation
  const {
    reviewDecisions,
    orphanDispositions,
    persistedMutationKey,
    persistedAnalysisId,
    setReviewDecisions,
    setOrphanDispositions,
    persistAdoptionStart,
    clearDraft,
    hasDraft,
  } = useAdoptionDraftState(job.companyId, job.id, targetVersionId, userId);

  const [adopting, setAdopting] = useState(false);
  const [adoptError, setAdoptError] = useState(null);
  const [adoptSuccess, setAdoptSuccess] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // mutationKey lives in the draft, but we mirror it to a ref for in-flight use
  const mutationKeyRef = useRef(persistedMutationKey || null);

  const runAnalysis = useCallback(async () => {
    if (!job?.id || !targetVersionId) return;
    setLoadingAnalysis(true);
    setAnalysisError(null);
    try {
      const res = await base44.functions.invoke('analyzeVersionUpdate', {
        companyJobId: job.id,
        targetVersionId,
      });
      const data = res?.data;
      if (data?.status === 'COMPLETED') {
        setAnalysis(data);
      } else if (data?.code === 'ALREADY_CURRENT') {
        setAnalysisError({ code: 'ALREADY_CURRENT', message: 'This job is already on the target version.' });
      } else {
        setAnalysisError({ code: data?.code || 'ANALYSIS_FAILED', message: data?.error || 'Analysis failed. Please try again.' });
      }
    } catch (_) {
      setAnalysisError({ code: 'NETWORK_ERROR', message: 'Could not reach the server. Check your connection and try again.' });
    } finally {
      setLoadingAnalysis(false);
    }
  }, [job?.id, targetVersionId]);

  useEffect(() => { runAnalysis(); }, [runAnalysis]);

  // Readiness checks — only items where the company has actual override stake count as decisions.
  // Items with no overrideId and no overriddenFields are pure master-change notifications; they
  // don't require a company decision even if requiresAdminAction is set (matches analysis count logic).
  const hasStake = (r) => !!r.overrideId || (Array.isArray(r.overriddenFields) && r.overriddenFields.length > 0);
  const reviewItems = (analysis?.itemResults || []).filter(r => r.compatibility === 'REVIEW_REQUIRED' && r.requiresAdminAction && hasStake(r));
  const orphanedItems = (analysis?.itemResults || []).filter(r => r.compatibility === 'ORPHANED' && hasStake(r));
  const invalidItems = (analysis?.itemResults || []).filter(r => r.compatibility === 'INVALID');

  const allReviewDecided = reviewItems.every(r => !!reviewDecisions[r.logicalItemId]);
  const allOrphansDisposed = orphanedItems.every(r => !!orphanDispositions[r.logicalItemId]);
  const hasInvalid = invalidItems.length > 0;

  const canAdopt = analysis?.status === 'COMPLETED' && allReviewDecided && allOrphansDisposed && !hasInvalid;
  const undecidedReviewCount = reviewItems.filter(r => !reviewDecisions[r.logicalItemId]).length;
  const undecidedOrphanCount = orphanedItems.filter(r => !orphanDispositions[r.logicalItemId]).length;

  // Map orphan dispositions → adoptionEngine vocabulary
  const buildAdoptionDecisions = () => {
    const decisions = { ...reviewDecisions };
    for (const [id, disposition] of Object.entries(orphanDispositions)) {
      decisions[id] = disposition === 'KEEP' ? 'KEEP_COMPANY' : 'USE_NEW_MASTER';
    }
    return decisions;
  };

  const handleAdopt = useCallback(async () => {
    if (!canAdopt || adopting || !analysis) return;
    setAdopting(true);
    setAdoptError(null);
    setShowConfirm(false);

    // Generate or reuse mutationKey
    if (!mutationKeyRef.current) {
      mutationKeyRef.current = `adopt_5d_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }
    const mutationKey = mutationKeyRef.current;

    // Persist analysisId + mutationKey BEFORE writing anything — so recovery can find them
    // analysis.id is the entity id; the engine also accepts it as analysisId
    const analysisEntityId = analysis.id || analysis.analysisId;
    persistAdoptionStart(mutationKey, analysisEntityId);

    try {
      const res = await base44.functions.invoke('adoptVersionFromAnalysis', {
        companyJobId: job.id,
        analysisId: analysisEntityId,
        reviewDecisions: buildAdoptionDecisions(),
        mutationKey,
        expectedOverrideRevision: overrideMeta?.revision ?? 0,
      });
      const data = res?.data;
      if (data?.success) {
        clearDraft(); // Success — discard persisted draft
        setAdoptSuccess(true);
        setTimeout(() => { onAdopted(data.resolvedJob); }, 1400);
      } else {
        const code = data?.code || 'UNKNOWN';
        if (code === 'ANALYSIS_STALE') {
          setAdoptError({ code, message: 'The analysis is now stale — the override changed. Re-running analysis…' });
          mutationKeyRef.current = null;
          clearDraft();
          setTimeout(runAnalysis, 1200);
        } else if (code === 'CONCURRENT_MODIFICATION') {
          setAdoptError({ code, message: 'Another adoption is in progress for this job. Wait a moment and try again.' });
        } else if (code === 'ALREADY_CURRENT') {
          clearDraft();
          setAdoptError({ code, message: 'This job is already on the target version.' });
        } else if (code === 'REVISION_CONFLICT') {
          setAdoptError({ code, message: 'The job override was modified since this review opened. Re-running analysis…' });
          mutationKeyRef.current = null;
          clearDraft();
          setTimeout(runAnalysis, 1200);
        } else {
          setAdoptError({ code, message: data?.error || 'Adoption failed. Please try again.' });
          mutationKeyRef.current = null;
        }
      }
    } catch (_) {
      setAdoptError({ code: 'NETWORK_ERROR', message: 'Lost connection during adoption. Tap "Adopt Version" again — your progress is saved.' });
      // Keep mutationKey and draft — retrying with the same key is safe (idempotent)
    } finally {
      setAdopting(false);
    }
  }, [canAdopt, adopting, analysis, job, overrideMeta, reviewDecisions, orphanDispositions, onAdopted, runAnalysis, persistAdoptionStart, clearDraft]);

  if (adoptSuccess) {
    return (
      <div className="fixed inset-0 z-50 bg-app-bg flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 p-8 text-center">
          <CheckCircle2 size={48} className="text-app-success" />
          <p className="text-app-text font-semibold text-lg">Update Complete</p>
          <p className="text-app-text-2 text-sm">Job updated to new version</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-app-bg flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-app-surface border-b border-app-border flex-shrink-0" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="px-4 py-3 flex items-center gap-3">
          <button onClick={onClose} className="icon-btn touch-active no-select" aria-label="Close">
            <ArrowLeft size={22} className="text-app-text-2" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold text-app-text truncate text-base">Version Update</h1>
            <p className="text-xs text-app-text-muted truncate">{job.title}</p>
          </div>
          {!loadingAnalysis && analysis && (
            <button onClick={runAnalysis} className="icon-btn touch-active no-select" aria-label="Refresh analysis">
              <RefreshCw size={16} className="text-app-text-muted" />
            </button>
          )}
        </div>

        {/* Tab bar */}
        <div className="flex border-t border-app-divider">
          {TABS.map(t => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 py-2.5 flex items-center justify-center gap-1.5 text-xs font-medium no-select touch-active transition-colors ${
                  tab === t.id ? 'text-app-accent border-b-2 border-app-accent' : 'text-app-text-muted'
                }`}
              >
                <Icon size={13} />
                {t.label}
                {t.id === 'review' && !loadingAnalysis && analysis && (undecidedReviewCount + undecidedOrphanCount + invalidItems.length) > 0 && (
                  <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-app-warning text-white text-[10px] font-bold leading-none">
                    {undecidedReviewCount + undecidedOrphanCount + invalidItems.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {loadingAnalysis && (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <div className="w-7 h-7 border-4 border-app-border border-t-app-accent rounded-full animate-spin" />
            <p className="text-sm text-app-text-muted">Analysing compatibility…</p>
          </div>
        )}

        {!loadingAnalysis && analysisError && (
          <AnalysisErrorView error={analysisError} onRetry={runAnalysis} onClose={onClose} />
        )}

        {!loadingAnalysis && analysis && tab === 'review' && (
          <VersionReviewItems
            analysis={analysis}
            reviewDecisions={reviewDecisions}
            setReviewDecisions={setReviewDecisions}
            orphanDispositions={orphanDispositions}
            setOrphanDispositions={setOrphanDispositions}
          />
        )}

        {!loadingAnalysis && analysis && tab === 'preview' && (
          <VersionPreview
            job={job}
            analysis={analysis}
            reviewDecisions={buildAdoptionDecisions()}
          />
        )}

        {tab === 'history' && (
          <VersionHistory job={job} />
        )}

        <div style={{ height: 'calc(88px + env(safe-area-inset-bottom))' }} />
      </div>

      {/* Footer CTA — only on review tab */}
      {!loadingAnalysis && analysis && tab === 'review' && (
        <div className="absolute bottom-0 left-0 right-0 bg-app-surface border-t border-app-border px-4 pt-3 flex-shrink-0"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>

          {adoptError && (
            <div className="flex items-start gap-2 mb-2 p-2.5 bg-app-danger-bg rounded-lg border border-app-danger/20">
              <XCircle size={14} className="text-app-danger flex-shrink-0 mt-0.5" />
              <p className="text-xs text-app-danger">{adoptError.message}</p>
            </div>
          )}

          <AdoptionReadinessSummary
            analysis={analysis}
            undecidedReview={undecidedReviewCount}
            undecidedOrphan={undecidedOrphanCount}
            invalidCount={invalidItems.length}
            canAdopt={canAdopt}
          />

          <div className="flex gap-3 mt-3">
            <button
              onClick={onClose}
              className="flex-1 py-3 border border-app-border rounded-xl text-sm font-medium text-app-text-2 no-select touch-active"
            >
              Cancel
            </button>
            <button
              onClick={() => setShowConfirm(true)}
              disabled={!canAdopt || adopting}
              className="flex-1 py-3 bg-app-accent text-app-accent-text rounded-xl text-sm font-medium no-select touch-active disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {adopting
                ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Adopting…</>
                : hasInvalid
                  ? 'Blocked — Fix Issues'
                  : !canAdopt
                    ? `${undecidedReviewCount + undecidedOrphanCount} Pending`
                    : <><Zap size={14} />Adopt Version</>
              }
            </button>
          </div>
        </div>
      )}

      {showConfirm && analysis && (
        <ConfirmAdoptSheet
          analysis={analysis}
          reviewDecisions={reviewDecisions}
          orphanDispositions={orphanDispositions}
          onConfirm={handleAdopt}
          onCancel={() => setShowConfirm(false)}
          adopting={adopting}
        />
      )}
    </div>
  );
}

function AnalysisErrorView({ error, onRetry, onClose }) {
  const isAlreadyCurrent = error?.code === 'ALREADY_CURRENT';
  return (
    <div className="flex flex-col items-center justify-center min-h-48 p-6 text-center gap-4">
      {isAlreadyCurrent
        ? <CheckCircle2 size={36} className="text-app-success" />
        : <AlertTriangle size={36} className="text-app-warning" />}
      <div>
        <p className="font-semibold text-app-text mb-1">
          {isAlreadyCurrent ? 'Already Up to Date' : 'Analysis Failed'}
        </p>
        <p className="text-sm text-app-text-2">{error.message}</p>
      </div>
      {!isAlreadyCurrent && (
        <button onClick={onRetry} className="px-5 py-2.5 bg-app-accent text-app-accent-text rounded-xl text-sm font-medium no-select touch-active">
          Try Again
        </button>
      )}
      <button onClick={onClose} className="text-sm text-app-text-muted underline">
        {isAlreadyCurrent ? 'Close' : 'Cancel'}
      </button>
    </div>
  );
}

function AdoptionReadinessSummary({ analysis, undecidedReview, undecidedOrphan, invalidCount, canAdopt }) {
  if (canAdopt) {
    return (
      <div className="flex items-center gap-2 text-xs text-app-success">
        <CheckCircle2 size={13} />
        <span className="font-medium">Ready to adopt — all items reviewed</span>
      </div>
    );
  }
  if (invalidCount > 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-app-danger">
        <XCircle size={13} />
        <span className="font-medium">{invalidCount} invalid item{invalidCount !== 1 ? 's' : ''} must be fixed before adoption</span>
      </div>
    );
  }
  const pending = undecidedReview + undecidedOrphan;
  if (pending > 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-app-warning">
        <AlertTriangle size={13} />
        <span className="font-medium">
          {pending} decision{pending !== 1 ? 's' : ''} required
          {undecidedReview > 0 && ` (${undecidedReview} conflict${undecidedReview !== 1 ? 's' : ''})`}
          {undecidedOrphan > 0 && ` (${undecidedOrphan} orphan${undecidedOrphan !== 1 ? 's' : ''})`}
        </span>
      </div>
    );
  }
  return null;
}

function ConfirmAdoptSheet({ analysis, reviewDecisions, orphanDispositions, onConfirm, onCancel, adopting }) {
  const keptCount = Object.values(reviewDecisions).filter(v => v === 'KEEP_COMPANY').length;
  const acceptedCount = Object.values(reviewDecisions).filter(v => v === 'USE_NEW_MASTER').length;
  const orphanKept = Object.values(orphanDispositions).filter(v => v === 'KEEP').length;
  const orphanRemoved = Object.values(orphanDispositions).filter(v => v !== 'KEEP').length;
  return (
    <div className="absolute inset-0 z-10 flex items-end justify-center bg-black/50">
      <div className="bg-app-surface rounded-t-2xl p-5 w-full max-w-lg" style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
        <h2 className="font-semibold text-app-text text-base mb-1">Confirm Adoption</h2>
        <p className="text-sm text-app-text-2 mb-3">
          This will update the job to the new Master SOP version. This action can't be undone.
        </p>
        <div className="space-y-1.5 mb-4 text-xs text-app-text-2">
          <div className="flex justify-between">
            <span>Safe updates applied automatically</span>
            <span className="font-medium text-app-text">{analysis.safeCount}</span>
          </div>
          {keptCount > 0 && <div className="flex justify-between"><span>Your versions kept</span><span className="font-medium text-app-success">{keptCount}</span></div>}
          {acceptedCount > 0 && <div className="flex justify-between"><span>New master versions accepted</span><span className="font-medium text-app-accent">{acceptedCount}</span></div>}
          {orphanKept > 0 && <div className="flex justify-between"><span>Orphaned items preserved</span><span className="font-medium text-app-warning">{orphanKept}</span></div>}
          {orphanRemoved > 0 && <div className="flex justify-between"><span>Orphaned items removed</span><span className="font-medium text-app-text-muted">{orphanRemoved}</span></div>}
        </div>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-2.5 border border-app-border rounded-xl text-sm font-medium text-app-text-2 no-select touch-active">Back</button>
          <button
            onClick={onConfirm}
            disabled={adopting}
            className="flex-1 py-2.5 bg-app-accent text-app-accent-text rounded-xl text-sm font-medium no-select touch-active disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {adopting ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Adopting…</> : 'Confirm Adoption'}
          </button>
        </div>
      </div>
    </div>
  );
}