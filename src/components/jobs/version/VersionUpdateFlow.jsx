import React, { useState, useEffect, useCallback, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { useAdoptionDraftState } from '@/lib/useAdoptionDraftState';
import {
  ArrowLeft, CheckCircle2, AlertTriangle, XCircle, RefreshCw,
  ChevronDown, ChevronUp, Check, Pencil, Plus, Minus, Shield,
  Clock, X, Zap, BookOpen,
} from 'lucide-react';

/**
 * VersionUpdateFlow — Progressive version-review workflow.
 *
 * Steps:
 *   1. Summary screen  (plain-language overview + action choice)
 *   2. Review screen   (grouped changes, expand for before/after, conflict resolution)
 *   3. Confirm screen  (structured final summary before commit)
 *
 * Actions:
 *   - Apply Safe Update    → only when canAutoAdopt === true
 *   - Review and Update    → when conflicts exist; opens step 2
 *   - Review Changes       → opens step 2 in read-only summary mode
 *   - Not Now              → defer or dismiss
 *
 * Backend:
 *   - analyzeVersionUpdate  → analysis object
 *   - adoptVersionFromAnalysis → applies adoption
 *   - ActivityLog           → audit records
 */

const SECTION_LABELS = {
  tools: 'Tools', materials: 'Materials', scope: 'Scope',
  procedure: 'Procedure', safety: 'Safety', quality: 'Quality Standards', metadata: 'Job Details',
};

function plainLabel(item) {
  const vals = item.companyOverrideValues?.item || item.currentMasterValues?.item || item.targetMasterValues?.item;
  if (vals?.title) return vals.title;
  const meta = item.companyOverrideValues?.title || item.currentMasterValues?.title
    || item.companyOverrideValues?.shortDescription || item.currentMasterValues?.shortDescription;
  if (meta) return String(meta).slice(0, 80);
  const lid = item.logicalItemId || '';
  if (lid.startsWith('metadata_')) return lid.replace('metadata_', '').replace(/_/g, ' ');
  return 'Item';
}

function extractText(val) {
  if (!val) return null;
  if (typeof val === 'string') return val;
  const parts = [];
  if (val.title) parts.push(val.title);
  if (val.body) parts.push(val.body);
  return parts.join(' — ') || null;
}

function sectionOf(item) {
  return SECTION_LABELS[item.parentLogicalItemId] || item.parentLogicalItemId || '';
}

// Classify each item into a change bucket
function classifyItems(itemResults = []) {
  const added = [];
  const improved = [];
  const removed = [];
  const conflicts = [];
  const preserved = [];

  for (const item of itemResults) {
    const comp = item.compatibility;
    const changes = item.masterChangeTypes || [];

    if (comp === 'INVALID') {
      conflicts.push({ ...item, _bucket: 'invalid' });
    } else if (comp === 'ORPHANED') {
      conflicts.push({ ...item, _bucket: 'orphaned' });
    } else if (comp === 'REVIEW_REQUIRED' && item.requiresAdminAction) {
      conflicts.push({ ...item, _bucket: 'conflict' });
    } else if (changes.includes('ADDED')) {
      added.push(item);
    } else if (changes.includes('REMOVED')) {
      removed.push(item);
    } else if (changes.includes('MODIFIED') || changes.includes('REORDERED')) {
      improved.push(item);
    } else if (comp === 'SAFE' && (item.overrideId || item.overriddenFields?.length > 0)) {
      preserved.push(item);
    }
    // NO_OP and safe-no-company-stake items are silent
  }

  return { added, improved, removed, conflicts, preserved };
}

export default function VersionUpdateFlow({ job, overrideMeta, targetVersionId, currentVersion, newVersion, onAdopted, onClose }) {
  const { user } = useAuth();
  const userId = user?.id || null;

  const [step, setStep] = useState('summary'); // 'summary' | 'review' | 'confirm' | 'notNow' | 'success'
  const [analysis, setAnalysis] = useState(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState(true);
  const [analysisError, setAnalysisError] = useState(null);

  const {
    reviewDecisions, orphanDispositions,
    setReviewDecisions, setOrphanDispositions,
    persistAdoptionStart, clearDraft,
  } = useAdoptionDraftState(job.companyId, job.id, targetVersionId, userId);

  const [mergeEdits, setMergeEdits] = useState({}); // logicalItemId → merged string
  const [adopting, setAdopting] = useState(false);
  const [adoptError, setAdoptError] = useState(null);
  const mutationKeyRef = useRef(null);

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
        setAnalysisError({ code: 'ALREADY_CURRENT', message: 'This job is already on the latest version.' });
      } else {
        setAnalysisError({ code: data?.code || 'ANALYSIS_FAILED', message: data?.error || 'Could not load the update details. Please try again.' });
      }
    } catch (_) {
      setAnalysisError({ code: 'NETWORK_ERROR', message: 'Connection error. Check your network and try again.' });
    } finally {
      setLoadingAnalysis(false);
    }
  }, [job?.id, targetVersionId]);

  useEffect(() => { runAnalysis(); }, [runAnalysis]);

  const classified = analysis ? classifyItems(analysis.itemResults || []) : { added: [], improved: [], removed: [], conflicts: [], preserved: [] };
  const hasConflicts = classified.conflicts.some(c => c._bucket === 'conflict' || c._bucket === 'orphaned' || c._bucket === 'invalid');
  const hasInvalid = classified.conflicts.some(c => c._bucket === 'invalid');
  const canAutoAdopt = analysis?.canAutoAdopt === true;

  // Readiness
  const decisionItems = classified.conflicts.filter(c => c._bucket === 'conflict' || c._bucket === 'orphaned');
  const allDecided = decisionItems.every(item => {
    if (item._bucket === 'conflict') return !!reviewDecisions[item.logicalItemId];
    if (item._bucket === 'orphaned') return !!orphanDispositions[item.logicalItemId];
    return true;
  });
  const canAdopt = !hasInvalid && allDecided;
  const pendingCount = decisionItems.filter(item => {
    if (item._bucket === 'conflict') return !reviewDecisions[item.logicalItemId];
    if (item._bucket === 'orphaned') return !orphanDispositions[item.logicalItemId];
    return false;
  }).length;

  const buildDecisions = () => {
    const d = { ...reviewDecisions };
    for (const [id, disposition] of Object.entries(orphanDispositions)) {
      d[id] = disposition === 'KEEP' ? 'KEEP_COMPANY' : 'USE_NEW_MASTER';
    }
    return d;
  };

  const handleAdopt = useCallback(async () => {
    if (!canAdopt || adopting || !analysis) return;
    setAdopting(true);
    setAdoptError(null);

    if (!mutationKeyRef.current) {
      mutationKeyRef.current = `adopt_vuf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }
    const mutationKey = mutationKeyRef.current;
    const analysisEntityId = analysis.id || analysis.analysisId;
    persistAdoptionStart(mutationKey, analysisEntityId);

    try {
      const res = await base44.functions.invoke('adoptVersionFromAnalysis', {
        companyJobId: job.id,
        analysisId: analysisEntityId,
        reviewDecisions: buildDecisions(),
        mutationKey,
        expectedOverrideRevision: overrideMeta?.revision ?? 0,
      });
      const data = res?.data;
      if (data?.success) {
        clearDraft();
        // Audit
        try {
          await base44.entities.ActivityLog.create({
            companyId: job.companyId,
            actingUserId: userId,
            actionType: 'job_edited',
            targetType: 'Job',
            targetId: job.id,
            summary: `Version adopted: v${currentVersion?.versionNumber} → v${newVersion?.versionNumber}. ${Object.keys(reviewDecisions).length} conflict resolution(s) selected.`,
            metadata: {
              event: 'version_adopted',
              previousVersionId: job.sourceVersionId,
              newVersionId: targetVersionId,
              resolutionCount: Object.keys(reviewDecisions).length,
              autoAdopted: canAutoAdopt && Object.keys(reviewDecisions).length === 0,
            },
            timestamp: new Date().toISOString(),
          });
        } catch (_) { /* audit failure must not block success */ }
        setStep('success');
        setTimeout(() => onAdopted(data.resolvedJob), 1500);
      } else {
        const code = data?.code || 'UNKNOWN';
        if (code === 'ANALYSIS_STALE' || code === 'REVISION_CONFLICT') {
          setAdoptError('The job was updated while you were reviewing. Refreshing…');
          mutationKeyRef.current = null;
          clearDraft();
          setTimeout(() => { runAnalysis(); setStep('summary'); }, 1500);
        } else {
          setAdoptError(data?.error || 'Update failed. Please try again.');
          mutationKeyRef.current = null;
        }
      }
    } catch (_) {
      setAdoptError('Connection lost during update. Tap "Apply Update" again — your decisions are saved.');
    } finally {
      setAdopting(false);
    }
  }, [canAdopt, adopting, analysis, job, overrideMeta, buildDecisions, onAdopted, runAnalysis, currentVersion, newVersion, userId, targetVersionId, canAutoAdopt, clearDraft, persistAdoptionStart]);

  const handleSafeUpdate = useCallback(async () => {
    if (!canAutoAdopt || adopting || !analysis) return;
    setAdopting(true);
    setAdoptError(null);
    const mutationKey = `adopt_safe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const analysisEntityId = analysis.id || analysis.analysisId;
    persistAdoptionStart(mutationKey, analysisEntityId);
    try {
      const res = await base44.functions.invoke('adoptVersionFromAnalysis', {
        companyJobId: job.id,
        analysisId: analysisEntityId,
        reviewDecisions: {},
        mutationKey,
        expectedOverrideRevision: overrideMeta?.revision ?? 0,
      });
      const data = res?.data;
      if (data?.success) {
        clearDraft();
        try {
          await base44.entities.ActivityLog.create({
            companyId: job.companyId,
            actingUserId: userId,
            actionType: 'job_edited',
            targetType: 'Job',
            targetId: job.id,
            summary: `Safe update applied automatically: v${currentVersion?.versionNumber} → v${newVersion?.versionNumber}. All customizations preserved.`,
            metadata: { event: 'safe_update_applied', previousVersionId: job.sourceVersionId, newVersionId: targetVersionId, autoAdopted: true },
            timestamp: new Date().toISOString(),
          });
        } catch (_) {}
        setStep('success');
        setTimeout(() => onAdopted(data.resolvedJob), 1500);
      } else {
        setAdoptError(data?.error || 'Update failed. Please try again.');
      }
    } catch (_) {
      setAdoptError('Connection error. Please try again.');
    } finally {
      setAdopting(false);
    }
  }, [canAutoAdopt, adopting, analysis, job, overrideMeta, onAdopted, currentVersion, newVersion, userId, targetVersionId, clearDraft, persistAdoptionStart]);

  const handleDefer = async (type) => {
    try {
      await base44.entities.ActivityLog.create({
        companyId: job.companyId,
        actingUserId: userId,
        actionType: 'job_edited',
        targetType: 'Job',
        targetId: job.id,
        summary: type === 'dismiss' ? `Update dismissed: staying on v${currentVersion?.versionNumber}` : `Update deferred: will review later`,
        metadata: { event: type === 'dismiss' ? 'update_dismissed' : 'update_deferred', previousVersionId: job.sourceVersionId, targetVersionId },
        timestamp: new Date().toISOString(),
      });
    } catch (_) {}
    onClose();
  };

  // ── Success ────────────────────────────────────────────────────────────────
  if (step === 'success') {
    return (
      <div className="fixed inset-0 z-50 bg-app-bg flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 p-8 text-center">
          <CheckCircle2 size={52} className="text-app-success" />
          <p className="text-app-text font-bold text-lg">Update Complete</p>
          <p className="text-app-text-2 text-sm">
            {job.title} is now on version {newVersion?.versionNumber}
          </p>
        </div>
      </div>
    );
  }

  // ── Loading / Error ────────────────────────────────────────────────────────
  if (loadingAnalysis) {
    return (
      <div className="fixed inset-0 z-50 bg-app-bg flex flex-col">
        <Header title={job.title} subtitle="Checking for updates…" onClose={onClose} />
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="w-8 h-8 border-4 border-app-border border-t-app-accent rounded-full animate-spin" />
          <p className="text-sm text-app-text-muted">Analysing changes…</p>
        </div>
      </div>
    );
  }

  if (analysisError) {
    return (
      <div className="fixed inset-0 z-50 bg-app-bg flex flex-col">
        <Header title={job.title} onClose={onClose} />
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-4">
          {analysisError.code === 'ALREADY_CURRENT'
            ? <CheckCircle2 size={40} className="text-app-success" />
            : <AlertTriangle size={40} className="text-app-warning" />}
          <p className="text-app-text font-semibold">{analysisError.code === 'ALREADY_CURRENT' ? 'Already Up to Date' : 'Could Not Load Update'}</p>
          <p className="text-sm text-app-text-2">{analysisError.message}</p>
          {analysisError.code !== 'ALREADY_CURRENT' && (
            <button onClick={runAnalysis} className="px-5 py-2.5 bg-app-accent text-app-accent-text rounded-xl text-sm font-medium no-select touch-active">
              Try Again
            </button>
          )}
          <button onClick={onClose} className="text-sm text-app-text-muted underline">Close</button>
        </div>
      </div>
    );
  }

  // ── Summary step ───────────────────────────────────────────────────────────
  if (step === 'summary') {
    return (
      <div className="fixed inset-0 z-50 bg-app-bg flex flex-col overflow-hidden">
        <Header
          title={job.title}
          subtitle={`Version ${currentVersion?.versionNumber} → ${newVersion?.versionNumber}`}
          onClose={onClose}
        />

        <div className="flex-1 overflow-y-auto overscroll-contain">
          <div className="px-4 pt-5 pb-2">
            <p className="text-xs font-semibold text-app-text-muted uppercase tracking-wide mb-1">What's new in this update</p>
            <p className="text-sm text-app-text-2">
              Essential SOP has published an update to <strong>{job.title}</strong>. Here's a plain-language summary of what changed.
            </p>
          </div>

          {/* Change summary cards */}
          <div className="px-4 py-3 space-y-2.5">
            {classified.added.length > 0 && (
              <SummaryCard
                icon={Plus}
                color="text-app-success"
                bg="bg-app-success-bg"
                border="border-app-success/20"
                count={classified.added.length}
                label="New additions"
                description={`${classified.added.length} new item${classified.added.length !== 1 ? 's' : ''} added to the standard procedure`}
              />
            )}
            {classified.improved.length > 0 && (
              <SummaryCard
                icon={Pencil}
                color="text-app-accent"
                bg="bg-app-info-bg"
                border="border-app-border"
                count={classified.improved.length}
                label="Improvements"
                description={`${classified.improved.length} item${classified.improved.length !== 1 ? 's' : ''} updated or clarified`}
              />
            )}
            {classified.removed.length > 0 && (
              <SummaryCard
                icon={Minus}
                color="text-app-text-muted"
                bg="bg-app-disabled"
                border="border-app-border"
                count={classified.removed.length}
                label="Removals"
                description={`${classified.removed.length} item${classified.removed.length !== 1 ? 's' : ''} removed from the standard`}
              />
            )}
            {classified.preserved.length > 0 && (
              <SummaryCard
                icon={Shield}
                color="text-app-success"
                bg="bg-app-success-bg"
                border="border-app-success/20"
                count={classified.preserved.length}
                label="Your customizations preserved"
                description={`${classified.preserved.length} of your company's customizations are automatically compatible`}
              />
            )}
            {hasConflicts && (
              <SummaryCard
                icon={AlertTriangle}
                color="text-app-warning"
                bg="bg-app-warning-bg"
                border="border-app-warning/30"
                count={classified.conflicts.filter(c => c._bucket !== 'invalid').length}
                label="Needs your decision"
                description="The update touches content your company has customized — you'll choose what to keep"
              />
            )}
            {hasInvalid && (
              <SummaryCard
                icon={XCircle}
                color="text-app-danger"
                bg="bg-app-danger-bg"
                border="border-app-danger/30"
                count={classified.conflicts.filter(c => c._bucket === 'invalid').length}
                label="Integrity issues"
                description="Some items have data issues that must be fixed before updating"
              />
            )}
          </div>

          {/* No changes */}
          {classified.added.length === 0 && classified.improved.length === 0 && classified.removed.length === 0 && !hasConflicts && (
            <div className="px-4 py-6 text-center">
              <CheckCircle2 size={32} className="text-app-success mx-auto mb-2" />
              <p className="text-sm text-app-text-2">This update is fully compatible with your setup.</p>
            </div>
          )}

          {adoptError && (
            <div className="mx-4 mt-2 p-3 bg-app-danger-bg border border-app-danger/20 rounded-xl flex items-start gap-2">
              <XCircle size={14} className="text-app-danger flex-shrink-0 mt-0.5" />
              <p className="text-xs text-app-danger">{adoptError}</p>
            </div>
          )}

          <div style={{ height: 'calc(120px + env(safe-area-inset-bottom))' }} />
        </div>

        {/* Footer actions */}
        <div className="absolute bottom-0 left-0 right-0 bg-app-surface border-t border-app-border px-4 pt-3"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
          <div className="flex flex-col gap-2">
            {canAutoAdopt && !hasConflicts ? (
              <>
                <button
                  onClick={handleSafeUpdate}
                  disabled={adopting}
                  className="w-full py-3 bg-app-accent text-app-accent-text rounded-xl text-sm font-semibold no-select touch-active disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {adopting
                    ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Applying…</>
                    : <><Zap size={15} />Apply Safe Update</>}
                </button>
                <button
                  onClick={() => setStep('review')}
                  className="w-full py-2.5 border border-app-border rounded-xl text-sm font-medium text-app-text-2 no-select touch-active"
                >
                  Review Changes
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setStep('review')}
                  className="w-full py-3 bg-app-accent text-app-accent-text rounded-xl text-sm font-semibold no-select touch-active flex items-center justify-center gap-2"
                >
                  <BookOpen size={15} />
                  {hasConflicts ? 'Review and Update' : 'Review Changes'}
                </button>
              </>
            )}
            <button
              onClick={() => setStep('notNow')}
              className="w-full py-2 text-sm text-app-text-muted no-select touch-active"
            >
              Not Now
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Not Now step ───────────────────────────────────────────────────────────
  if (step === 'notNow') {
    return (
      <div className="fixed inset-0 z-50 bg-app-bg flex flex-col overflow-hidden">
        <Header title="Not Now" onClose={onClose} />
        <div className="flex-1 flex flex-col justify-center px-6 gap-5">
          <div className="text-center mb-2">
            <Clock size={36} className="text-app-text-muted mx-auto mb-2" />
            <p className="text-base font-semibold text-app-text mb-1">Skip this update for now?</p>
            <p className="text-sm text-app-text-2">
              Your job will continue running on version {currentVersion?.versionNumber}. You can apply this update any time from the job page.
            </p>
          </div>
          <button
            onClick={() => handleDefer('defer')}
            className="w-full py-3.5 border border-app-border rounded-xl text-sm font-medium text-app-text no-select touch-active text-left px-4"
          >
            <p className="font-semibold">Remind me later</p>
            <p className="text-xs text-app-text-muted mt-0.5">I'll review this update when I'm ready</p>
          </button>
          <button
            onClick={() => handleDefer('dismiss')}
            className="w-full py-3.5 border border-app-border rounded-xl text-sm font-medium text-app-text no-select touch-active text-left px-4"
          >
            <p className="font-semibold">Dismiss this version</p>
            <p className="text-xs text-app-text-muted mt-0.5">I've reviewed it and want to stay on my current version</p>
          </button>
          <button onClick={() => setStep('summary')} className="text-sm text-app-text-muted text-center underline mt-2 no-select touch-active">
            Go back
          </button>
        </div>
      </div>
    );
  }

  // ── Review step ────────────────────────────────────────────────────────────
  if (step === 'review') {
    return (
      <ReviewScreen
        job={job}
        analysis={analysis}
        classified={classified}
        currentVersion={currentVersion}
        newVersion={newVersion}
        reviewDecisions={reviewDecisions}
        setReviewDecisions={setReviewDecisions}
        orphanDispositions={orphanDispositions}
        setOrphanDispositions={setOrphanDispositions}
        mergeEdits={mergeEdits}
        setMergeEdits={setMergeEdits}
        canAdopt={canAdopt}
        pendingCount={pendingCount}
        hasInvalid={hasInvalid}
        onBack={() => setStep('summary')}
        onContinue={() => setStep('confirm')}
      />
    );
  }

  // ── Confirm step ───────────────────────────────────────────────────────────
  if (step === 'confirm') {
    return (
      <ConfirmScreen
        job={job}
        analysis={analysis}
        classified={classified}
        currentVersion={currentVersion}
        newVersion={newVersion}
        reviewDecisions={reviewDecisions}
        orphanDispositions={orphanDispositions}
        mergeEdits={mergeEdits}
        adopting={adopting}
        adoptError={adoptError}
        onBack={() => setStep('review')}
        onAdopt={handleAdopt}
      />
    );
  }

  return null;
}

// ── Header ────────────────────────────────────────────────────────────────────

function Header({ title, subtitle, onClose }) {
  return (
    <div className="bg-app-surface border-b border-app-border flex-shrink-0" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="px-4 py-3 flex items-center gap-3">
        <button onClick={onClose} className="icon-btn touch-active no-select" aria-label="Close">
          <ArrowLeft size={22} className="text-app-text-2" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-app-text truncate text-base">{title}</h1>
          {subtitle && <p className="text-xs text-app-text-muted">{subtitle}</p>}
        </div>
      </div>
    </div>
  );
}

// ── Summary card ──────────────────────────────────────────────────────────────

function SummaryCard({ icon: Icon, color, bg, border, count, label, description }) {
  return (
    <div className={`flex items-start gap-3 p-3.5 rounded-xl border ${bg} ${border}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${bg}`}>
        <Icon size={16} className={color} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-base font-bold ${color}`}>{count}</span>
          <span className="text-sm font-semibold text-app-text">{label}</span>
        </div>
        <p className="text-xs text-app-text-muted mt-0.5 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

// ── Review Screen ─────────────────────────────────────────────────────────────

function ReviewScreen({
  job, analysis, classified, currentVersion, newVersion,
  reviewDecisions, setReviewDecisions, orphanDispositions, setOrphanDispositions,
  mergeEdits, setMergeEdits,
  canAdopt, pendingCount, hasInvalid,
  onBack, onContinue,
}) {
  const allGroups = [
    { key: 'conflicts', label: 'Needs Your Decision', items: classified.conflicts.filter(c => c._bucket === 'conflict' || c._bucket === 'orphaned'), variant: 'warning', badge: pendingCount > 0 ? `${pendingCount} pending` : 'All resolved ✓', defaultOpen: true },
    { key: 'invalid', label: 'Integrity Issues', items: classified.conflicts.filter(c => c._bucket === 'invalid'), variant: 'danger', badge: 'Update blocked', defaultOpen: true },
    { key: 'added', label: 'Added', items: classified.added, variant: 'success', badge: null, defaultOpen: false },
    { key: 'improved', label: 'Improved', items: classified.improved, variant: 'accent', badge: null, defaultOpen: false },
    { key: 'removed', label: 'Removed', items: classified.removed, variant: 'muted', badge: null, defaultOpen: false },
    { key: 'preserved', label: 'Your Customizations', items: classified.preserved, variant: 'success', badge: 'Automatically preserved', defaultOpen: false },
  ].filter(g => g.items.length > 0);

  const [expanded, setExpanded] = useState(() => {
    const init = {};
    for (const g of allGroups) { init[g.key] = g.defaultOpen; }
    return init;
  });

  const toggle = (key) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="fixed inset-0 z-50 bg-app-bg flex flex-col overflow-hidden">
      <div className="bg-app-surface border-b border-app-border flex-shrink-0" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="px-4 py-3 flex items-center gap-3">
          <button onClick={onBack} className="icon-btn touch-active no-select">
            <ArrowLeft size={22} className="text-app-text-2" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold text-app-text truncate">Review Changes</h1>
            <p className="text-xs text-app-text-muted">{job.title} · v{currentVersion?.versionNumber} → v{newVersion?.versionNumber}</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain">
        {allGroups.map(group => (
          <ChangeGroup
            key={group.key}
            group={group}
            expanded={!!expanded[group.key]}
            onToggle={() => toggle(group.key)}
            reviewDecisions={reviewDecisions}
            setReviewDecisions={setReviewDecisions}
            orphanDispositions={orphanDispositions}
            setOrphanDispositions={setOrphanDispositions}
            mergeEdits={mergeEdits}
            setMergeEdits={setMergeEdits}
          />
        ))}
        <div style={{ height: 'calc(96px + env(safe-area-inset-bottom))' }} />
      </div>

      <div className="absolute bottom-0 left-0 right-0 bg-app-surface border-t border-app-border px-4 pt-3"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <div className="flex gap-3">
          <button onClick={onBack} className="flex-1 py-3 border border-app-border rounded-xl text-sm font-medium text-app-text-2 no-select touch-active">
            Back
          </button>
          <button
            onClick={onContinue}
            disabled={!canAdopt}
            className="flex-2 flex-1 py-3 bg-app-accent text-app-accent-text rounded-xl text-sm font-semibold no-select touch-active disabled:opacity-40"
          >
            {hasInvalid ? 'Blocked' : pendingCount > 0 ? `${pendingCount} Pending` : 'Review Summary →'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Change group ──────────────────────────────────────────────────────────────

function ChangeGroup({ group, expanded, onToggle, reviewDecisions, setReviewDecisions, orphanDispositions, setOrphanDispositions, mergeEdits, setMergeEdits }) {
  const variantColors = {
    warning: 'text-app-warning',
    danger: 'text-app-danger',
    success: 'text-app-success',
    accent: 'text-app-accent',
    muted: 'text-app-text-muted',
  };

  return (
    <div className="border-b border-app-divider">
      <button onClick={onToggle} className="w-full px-4 py-3.5 flex items-center gap-3 text-left no-select touch-active">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-sm font-semibold ${variantColors[group.variant] || 'text-app-text'}`}>{group.label}</span>
            <span className="text-xs text-app-text-muted">({group.items.length})</span>
          </div>
          {group.badge && <p className="text-xs text-app-text-muted mt-0.5">{group.badge}</p>}
        </div>
        {expanded ? <ChevronUp size={16} className="text-app-text-muted" /> : <ChevronDown size={16} className="text-app-text-muted" />}
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-3">
          {group.items.map(item => (
            <ChangeItem
              key={item.logicalItemId}
              item={item}
              reviewDecision={reviewDecisions[item.logicalItemId]}
              orphanDisposition={orphanDispositions[item.logicalItemId]}
              mergeEdit={mergeEdits[item.logicalItemId]}
              onDecide={(val) => setReviewDecisions(prev => ({ ...prev, [item.logicalItemId]: val }))}
              onDispose={(val) => setOrphanDispositions(prev => ({ ...prev, [item.logicalItemId]: val }))}
              onMergeEdit={(val) => setMergeEdits(prev => ({ ...prev, [item.logicalItemId]: val }))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Change item ───────────────────────────────────────────────────────────────

function ChangeItem({ item, reviewDecision, orphanDisposition, mergeEdit, onDecide, onDispose, onMergeEdit }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const bucket = item._bucket;
  const needsDecision = bucket === 'conflict' || bucket === 'orphaned';
  const decided = bucket === 'conflict' ? !!reviewDecision : bucket === 'orphaned' ? !!orphanDisposition : false;

  const currentMaster = extractText(item.currentMasterValues?.item || item.currentMasterValues);
  const newMaster = extractText(item.targetMasterValues?.item || item.targetMasterValues);
  const companyVersion = extractText(item.companyOverrideValues?.item || item.companyOverrideValues);

  const hasBeforeAfter = currentMaster || newMaster || companyVersion;

  const borderClass = needsDecision && !decided
    ? 'border-app-warning/40 bg-app-warning-bg'
    : bucket === 'invalid'
      ? 'border-app-danger/30 bg-app-danger-bg'
      : 'border-app-border bg-app-card';

  return (
    <div className={`rounded-xl border p-3.5 ${borderClass}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-app-text">{plainLabel(item)}</p>
          <p className="text-xs text-app-text-muted mt-0.5">{sectionOf(item)}</p>
          {bucket === 'conflict' && (
            <p className="text-xs text-app-warning mt-1 leading-relaxed">
              You have a company customization here, and this update changes the same content.
            </p>
          )}
          {bucket === 'orphaned' && (
            <p className="text-xs text-app-warning mt-1 leading-relaxed">
              This standard removed this item, but your company had customized it.
            </p>
          )}
          {bucket === 'invalid' && (
            <p className="text-xs text-app-danger mt-1 leading-relaxed">
              There's a data issue with this item that must be corrected before updating.
            </p>
          )}
          {/* Status badge */}
          {decided && (
            <div className="mt-1.5">
              {bucket === 'conflict' && (
                <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                  reviewDecision === 'KEEP_COMPANY' ? 'bg-app-success-bg text-app-success' : 'bg-app-info-bg text-app-accent'
                }`}>
                  <Check size={10} />
                  {reviewDecision === 'KEEP_COMPANY' ? 'Keeping your version' : reviewDecision === 'MERGE' ? 'Custom merge' : 'Using new standard'}
                </span>
              )}
              {bucket === 'orphaned' && (
                <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                  orphanDisposition === 'KEEP' ? 'bg-app-warning-bg text-app-warning' : 'bg-app-disabled text-app-text-muted'
                }`}>
                  <Check size={10} />
                  {orphanDisposition === 'KEEP' ? 'Keeping it' : 'Removing it'}
                </span>
              )}
            </div>
          )}
        </div>
        {hasBeforeAfter && (
          <button onClick={() => setDetailsOpen(o => !o)} className="icon-btn touch-active no-select text-app-text-muted flex-shrink-0">
            {detailsOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        )}
      </div>

      {/* Before/after comparison */}
      {detailsOpen && hasBeforeAfter && (
        <div className="mt-3 space-y-2 p-3 bg-app-bg rounded-lg">
          {currentMaster && (
            <CompareRow label="Current standard" value={currentMaster} color="text-app-text-muted" />
          )}
          {newMaster && (
            <CompareRow label="New standard" value={newMaster} color="text-app-accent" />
          )}
          {companyVersion && (
            <CompareRow label="Your company version" value={companyVersion} color="text-app-success" />
          )}
        </div>
      )}

      {/* Conflict resolution controls */}
      {bucket === 'conflict' && (
        <div className="mt-3 space-y-2">
          <div className="flex gap-2">
            <ResolutionBtn
              active={reviewDecision === 'USE_NEW_MASTER'}
              onClick={() => { onDecide('USE_NEW_MASTER'); setMergeOpen(false); }}
              label="Use new standard"
            />
            <ResolutionBtn
              active={reviewDecision === 'KEEP_COMPANY'}
              onClick={() => { onDecide('KEEP_COMPANY'); setMergeOpen(false); }}
              label="Keep company version"
            />
          </div>
          {hasBeforeAfter && (
            <button
              onClick={() => {
                const baseText = companyVersion || newMaster || '';
                if (!mergeOpen) onMergeEdit(mergeEdit ?? baseText);
                setMergeOpen(o => !o);
                if (!mergeOpen) onDecide('MERGE');
              }}
              className={`w-full py-2 rounded-lg border text-xs font-medium no-select touch-active ${
                reviewDecision === 'MERGE'
                  ? 'border-app-accent bg-app-info-bg text-app-accent'
                  : 'border-app-border bg-app-surface text-app-text-2'
              }`}
            >
              {mergeOpen ? '▲ Hide merge editor' : 'Combine and edit'}
            </button>
          )}
          {mergeOpen && (
            <div className="mt-1">
              <p className="text-xs text-app-text-muted mb-1">Edit the merged result below:</p>
              <textarea
                className="w-full p-2.5 bg-app-input border border-app-border rounded-lg text-sm text-app-text resize-none"
                rows={4}
                value={mergeEdit ?? (companyVersion || newMaster || '')}
                onChange={e => onMergeEdit(e.target.value)}
              />
              <p className="text-xs text-app-text-muted mt-1">This custom version will be saved as your company's content for this item.</p>
            </div>
          )}
        </div>
      )}

      {/* Orphan resolution */}
      {bucket === 'orphaned' && (
        <div className="flex gap-2 mt-3">
          <OrphanBtn active={orphanDisposition === 'KEEP'} onClick={() => onDispose('KEEP')} label="Keep it" sub="Preserve your version" />
          <OrphanBtn active={orphanDisposition === 'REMOVE'} onClick={() => onDispose('REMOVE')} label="Remove it" sub="Accept the removal" danger />
        </div>
      )}
    </div>
  );
}

function CompareRow({ label, value, color }) {
  return (
    <div className="text-xs">
      <span className="font-semibold text-app-text-muted">{label}: </span>
      <span className={`selectable ${color}`}>{value}</span>
    </div>
  );
}

function ResolutionBtn({ active, onClick, label }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-2 px-2 rounded-lg text-xs font-medium border no-select touch-active flex items-center justify-center gap-1 transition-colors ${
        active ? 'bg-app-accent border-app-accent text-app-accent-text' : 'bg-app-surface border-app-border text-app-text-2'
      }`}
    >
      {active && <Check size={10} />}
      {label}
    </button>
  );
}

function OrphanBtn({ active, onClick, label, sub, danger }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-2 px-2 rounded-lg text-xs font-medium border no-select touch-active flex flex-col items-center gap-0.5 transition-colors ${
        active
          ? danger ? 'bg-app-danger-bg border-app-danger/40 text-app-danger' : 'bg-app-warning-bg border-app-warning/40 text-app-warning'
          : 'bg-app-surface border-app-border text-app-text-2'
      }`}
    >
      {active && <Check size={10} />}
      <span>{label}</span>
      <span className="text-[10px] opacity-70">{sub}</span>
    </button>
  );
}

// ── Confirm Screen ────────────────────────────────────────────────────────────

function ConfirmScreen({ job, analysis, classified, currentVersion, newVersion, reviewDecisions, orphanDispositions, mergeEdits, adopting, adoptError, onBack, onAdopt }) {
  const keptCount = Object.values(reviewDecisions).filter(v => v === 'KEEP_COMPANY').length;
  const usedNewCount = Object.values(reviewDecisions).filter(v => v === 'USE_NEW_MASTER').length;
  const mergedCount = Object.values(reviewDecisions).filter(v => v === 'MERGE').length;
  const orphanKeptCount = Object.values(orphanDispositions).filter(v => v === 'KEEP').length;
  const orphanRemovedCount = Object.values(orphanDispositions).filter(v => v === 'REMOVE').length;

  return (
    <div className="fixed inset-0 z-50 bg-app-bg flex flex-col overflow-hidden">
      <Header title="Confirm Update" subtitle={`${job.title} · v${currentVersion?.versionNumber} → v${newVersion?.versionNumber}`} onClose={onBack} />

      <div className="flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-6">
        <p className="text-sm text-app-text-2 mb-4 leading-relaxed">
          Here's a summary of what will happen when you apply this update. Review it carefully — this cannot be undone.
        </p>

        <Section title="Master SOP changes being applied">
          {classified.added.length > 0 && <ConfirmRow icon={Plus} color="text-app-success" label={`${classified.added.length} new item${classified.added.length !== 1 ? 's' : ''} added`} />}
          {classified.improved.length > 0 && <ConfirmRow icon={Pencil} color="text-app-accent" label={`${classified.improved.length} item${classified.improved.length !== 1 ? 's' : ''} improved`} />}
          {classified.removed.length > 0 && <ConfirmRow icon={Minus} color="text-app-text-muted" label={`${classified.removed.length} item${classified.removed.length !== 1 ? 's' : ''} removed from standard`} />}
          {classified.added.length === 0 && classified.improved.length === 0 && classified.removed.length === 0 && (
            <ConfirmRow icon={CheckCircle2} color="text-app-text-muted" label="No structural changes" />
          )}
        </Section>

        {classified.preserved.length > 0 && (
          <Section title="Your customizations being preserved">
            <ConfirmRow icon={Shield} color="text-app-success" label={`${classified.preserved.length} customization${classified.preserved.length !== 1 ? 's' : ''} automatically kept`} />
          </Section>
        )}

        {(keptCount + usedNewCount + mergedCount + orphanKeptCount + orphanRemovedCount) > 0 && (
          <Section title="Conflict resolutions">
            {keptCount > 0 && <ConfirmRow icon={Check} color="text-app-success" label={`${keptCount} item${keptCount !== 1 ? 's' : ''}: keeping your company version`} />}
            {usedNewCount > 0 && <ConfirmRow icon={Check} color="text-app-accent" label={`${usedNewCount} item${usedNewCount !== 1 ? 's' : ''}: using new standard`} />}
            {mergedCount > 0 && <ConfirmRow icon={Pencil} color="text-app-accent" label={`${mergedCount} custom merge${mergedCount !== 1 ? 's' : ''} created`} />}
            {orphanKeptCount > 0 && <ConfirmRow icon={Check} color="text-app-warning" label={`${orphanKeptCount} removed standard item${orphanKeptCount !== 1 ? 's' : ''} kept in your library`} />}
            {orphanRemovedCount > 0 && <ConfirmRow icon={Minus} color="text-app-text-muted" label={`${orphanRemovedCount} item${orphanRemovedCount !== 1 ? 's' : ''} removed as per standard`} />}
          </Section>
        )}

        <Section title="Resulting version">
          <ConfirmRow icon={CheckCircle2} color="text-app-success" label={`Your job will move to version ${newVersion?.versionNumber}`} />
        </Section>

        {adoptError && (
          <div className="mt-3 p-3 bg-app-danger-bg border border-app-danger/20 rounded-xl flex items-start gap-2">
            <XCircle size={14} className="text-app-danger flex-shrink-0 mt-0.5" />
            <p className="text-xs text-app-danger">{adoptError}</p>
          </div>
        )}
      </div>

      <div className="border-t border-app-border bg-app-surface px-4 pt-3" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <div className="flex gap-3">
          <button onClick={onBack} className="flex-1 py-3 border border-app-border rounded-xl text-sm font-medium text-app-text-2 no-select touch-active">
            Back
          </button>
          <button
            onClick={onAdopt}
            disabled={adopting}
            className="flex-1 py-3 bg-app-accent text-app-accent-text rounded-xl text-sm font-semibold no-select touch-active disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {adopting
              ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Applying…</>
              : 'Apply Update'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="mb-4">
      <p className="text-xs font-semibold text-app-text-muted uppercase tracking-wide mb-2">{title}</p>
      <div className="bg-app-card border border-app-border rounded-xl overflow-hidden divide-y divide-app-divider">
        {children}
      </div>
    </div>
  );
}

function ConfirmRow({ icon: Icon, color, label }) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5">
      <Icon size={14} className={`flex-shrink-0 ${color}`} />
      <span className="text-sm text-app-text">{label}</span>
    </div>
  );
}