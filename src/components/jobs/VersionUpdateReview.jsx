import React, { useEffect, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import {
  ArrowLeft, RefreshCw, AlertTriangle, CheckCircle2, Info,
  ChevronDown, ChevronUp, Minus, Plus, Pencil, X, Check
} from 'lucide-react';

/**
 * VersionUpdateReview — Edit 7 Review & Conflict Resolution UI.
 *
 * Full-screen mobile-first review flow for Master Version adoption.
 * All diff data comes from previewMasterVersionAdoption backend — never computed here.
 *
 * Props:
 *   job           — resolved job object
 *   overrideMeta  — current override metadata (or null)
 *   targetVersionId — version to adopt
 *   onAdopted     — callback(resolvedJob) after successful adoption
 *   onClose       — cancel callback (no changes made)
 */

const CHANGE_TYPE_CONFIG = {
  MASTER_ADDED:              { icon: Plus,         color: 'text-app-success',  bg: 'bg-app-success-bg',  label: 'Added',                   needsDecision: false },
  MASTER_REMOVED:            { icon: Minus,        color: 'text-app-danger',   bg: 'bg-app-danger-bg',   label: 'Removed',                 needsDecision: false },
  MASTER_MODIFIED:           { icon: Pencil,       color: 'text-app-accent',   bg: 'bg-app-info-bg',     label: 'Updated',                 needsDecision: false },
  COMPANY_ONLY_CUSTOMIZATION:{ icon: CheckCircle2, color: 'text-app-success',  bg: 'bg-app-success-bg',  label: 'Your customization kept', needsDecision: false },
  AUTOMATICALLY_COMPATIBLE:  { icon: CheckCircle2, color: 'text-app-text-muted', bg: 'bg-app-disabled',  label: 'No action required',      needsDecision: false },
  CONFLICT:                  { icon: AlertTriangle,color: 'text-app-warning',  bg: 'bg-app-warning-bg',  label: 'Decision required',       needsDecision: true  },
};

const SECTION_ORDER = ['metadata', 'tools', 'materials', 'scope', 'procedure', 'safety', 'quality'];

export default function VersionUpdateReview({ job, overrideMeta, targetVersionId, onAdopted, onClose }) {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [resolutions, setResolutions] = useState({});
  const [expandedSections, setExpandedSections] = useState({});
  const [showConfirm, setShowConfirm] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const [adoptError, setAdoptError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  const loadPreview = useCallback(async () => {
    if (!job?.id || !targetVersionId) return;
    setLoading(true);
    setLoadError(null);
    setResolutions({});
    try {
      const res = await base44.functions.invoke('previewMasterVersionAdoption', { jobId: job.id, targetVersionId });
      if (res.data?.previewFingerprint) {
        setPreview(res.data);
        // Auto-expand sections that have conflicts
        const autoExpand = {};
        for (const [st, changes] of Object.entries(res.data.changesBySection || {})) {
          if (changes.some(c => c.resolutionRequired)) autoExpand[st] = true;
        }
        setExpandedSections(autoExpand);
      } else {
        setLoadError(res.data?.error || 'Failed to load update preview.');
      }
    } catch (e) {
      setLoadError('Failed to load update preview. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [job?.id, targetVersionId]);

  useEffect(() => { loadPreview(); }, [loadPreview]);

  const allConflicts = preview ? getAllConflicts(preview.changesBySection) : [];
  const allResolved = allConflicts.length === 0 || allConflicts.every(c => !!resolutions[c.changeId]);

  const setResolution = (changeId, value) => {
    setResolutions(prev => ({ ...prev, [changeId]: value }));
  };

  const setBulkResolution = (value) => {
    const bulk = {};
    for (const c of allConflicts) bulk[c.changeId] = value;
    setResolutions(prev => ({ ...prev, ...bulk }));
  };

  const handleAdopt = useCallback(async () => {
    if (!preview || adopting || !allResolved) return;
    setAdopting(true);
    setAdoptError(null);
    const mutationKey = `adopt_e7_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      const res = await base44.functions.invoke('adoptMasterVersionWithResolutions', {
        jobId: job.id,
        targetVersionId,
        expectedJobRevision: preview.currentJobRevision,
        expectedOverrideRevision: preview.currentOverrideRevision,
        previewFingerprint: preview.previewFingerprint,
        resolutions,
        mutationKey,
      });
      if (res.data?.success) {
        setShowConfirm(false);
        setSuccessMsg(`Job updated to v${preview.targetVersion?.versionNumber}.`);
        setTimeout(() => onAdopted(res.data.resolvedJob), 1200);
      } else if (res.data?.code === 'STALE_PREVIEW') {
        setShowConfirm(false);
        setAdoptError('The update changed since you opened this review. Reloading a fresh preview…');
        setTimeout(loadPreview, 1500);
      } else {
        setAdoptError(res.data?.error || 'Update failed. Please try again.');
        setShowConfirm(false);
      }
    } catch (e) {
      const msg = e?.message || '';
      if (msg.includes('STALE_PREVIEW')) {
        setAdoptError('The update changed since you opened this review. Reloading…');
        setTimeout(loadPreview, 1500);
      } else {
        setAdoptError('Update failed. Please try again.');
      }
      setShowConfirm(false);
    } finally {
      setAdopting(false);
    }
  }, [preview, adopting, allResolved, resolutions, job, targetVersionId, loadPreview, onAdopted]);

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 bg-app-bg flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-app-border border-t-app-accent rounded-full animate-spin" />
          <p className="text-sm text-app-text-muted">Loading update preview…</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="fixed inset-0 z-50 bg-app-bg flex flex-col">
        <div className="bg-app-surface border-b border-app-border px-4 py-3 flex items-center gap-3" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <button onClick={onClose} className="icon-btn touch-active"><ArrowLeft size={22} className="text-app-text-2" /></button>
          <h1 className="font-semibold text-app-text flex-1">Review Update</h1>
        </div>
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <div>
            <AlertTriangle size={32} className="text-app-warning mx-auto mb-3" />
            <p className="text-app-text font-medium mb-2">Couldn't load preview</p>
            <p className="text-sm text-app-text-muted mb-4">{loadError}</p>
            <button onClick={loadPreview} className="px-4 py-2 bg-app-accent text-app-accent-text rounded-lg text-sm font-medium no-select touch-active">Try Again</button>
          </div>
        </div>
      </div>
    );
  }

  if (successMsg) {
    return (
      <div className="fixed inset-0 z-50 bg-app-bg flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 p-6 text-center">
          <CheckCircle2 size={40} className="text-app-success" />
          <p className="text-app-text font-semibold">{successMsg}</p>
        </div>
      </div>
    );
  }

  const { summary, changesBySection, currentVersion, targetVersion } = preview;

  return (
    <div className="fixed inset-0 z-50 bg-app-bg flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-app-surface border-b border-app-border flex-shrink-0" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="px-4 py-3 flex items-center gap-3">
          <button onClick={onClose} className="icon-btn touch-active" aria-label="Cancel"><ArrowLeft size={22} className="text-app-text-2" /></button>
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold text-app-text truncate">{job.title}</h1>
            <p className="text-xs text-app-text-muted">v{currentVersion?.versionNumber} → v{targetVersion?.versionNumber}</p>
          </div>
          <RefreshCw size={16} className="text-app-accent flex-shrink-0" />
        </div>
      </div>

      {/* Summary strip */}
      <div className="flex-shrink-0 bg-app-surface border-b border-app-divider px-4 py-3">
        <div className="flex gap-4 text-xs overflow-x-auto scrollbar-hide">
          {summary.additions > 0 && <SummaryChip icon={Plus} color="text-app-success" label={`${summary.additions} Added`} />}
          {summary.removals > 0 && <SummaryChip icon={Minus} color="text-app-danger" label={`${summary.removals} Removed`} />}
          {summary.modifications > 0 && <SummaryChip icon={Pencil} color="text-app-accent" label={`${summary.modifications} Updated`} />}
          {summary.preservedCustomizations > 0 && <SummaryChip icon={CheckCircle2} color="text-app-success" label={`${summary.preservedCustomizations} Preserved`} />}
          {summary.conflicts > 0 && <SummaryChip icon={AlertTriangle} color="text-app-warning" label={`${summary.conflicts} Conflict${summary.conflicts !== 1 ? 's' : ''}`} />}
        </div>

        {/* Bulk actions */}
        {allConflicts.length > 1 && (
          <div className="flex gap-2 mt-2.5">
            <button onClick={() => setBulkResolution('KEEP_COMPANY')} className="flex-1 py-1.5 border border-app-border rounded-lg text-xs font-medium text-app-text-2 no-select touch-active">Keep Ours for All</button>
            <button onClick={() => setBulkResolution('USE_NEW_ESSENTIAL_SOP')} className="flex-1 py-1.5 border border-app-border rounded-lg text-xs font-medium text-app-text-2 no-select touch-active">Use New SOP for All</button>
          </div>
        )}
      </div>

      {/* Scrollable changes */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {SECTION_ORDER.filter(st => changesBySection[st]?.length > 0).map(st => (
          <SectionChangeGroup
            key={st}
            sectionType={st}
            label={preview.sectionLabels?.[st] || st}
            changes={changesBySection[st]}
            resolutions={resolutions}
            setResolution={setResolution}
            expanded={!!expandedSections[st]}
            onToggle={() => setExpandedSections(prev => ({ ...prev, [st]: !prev[st] }))}
          />
        ))}

        {Object.keys(changesBySection).length === 0 && (
          <div className="p-8 text-center text-app-text-muted text-sm">No changes detected between these versions.</div>
        )}

        <div style={{ height: 'calc(96px + env(safe-area-inset-bottom))' }} />
      </div>

      {/* Footer */}
      <div className="absolute bottom-0 left-0 right-0 bg-app-surface border-t border-app-border px-4 pt-3 flex-shrink-0" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        {adoptError && <p className="text-xs text-app-danger mb-2 text-center">{adoptError}</p>}
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 border border-app-border rounded-xl text-sm font-medium text-app-text-2 no-select touch-active">Cancel</button>
          <button
            onClick={() => setShowConfirm(true)}
            disabled={!allResolved}
            className="flex-1 py-3 bg-app-accent text-app-accent-text rounded-xl text-sm font-medium no-select touch-active disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {allConflicts.length > 0 && !allResolved
              ? `Resolve ${allConflicts.filter(c => !resolutions[c.changeId]).length} Conflict${allConflicts.filter(c => !resolutions[c.changeId]).length !== 1 ? 's' : ''}`
              : 'Update Job'}
          </button>
        </div>
      </div>

      {/* Confirm sheet */}
      {showConfirm && (
        <div className="absolute inset-0 z-10 flex items-end justify-center bg-black/50">
          <div className="bg-app-surface rounded-t-2xl p-5 w-full max-w-lg" style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-app-text">Ready to update?</h2>
              <button onClick={() => setShowConfirm(false)} className="icon-btn text-app-text-muted touch-active"><X size={18} /></button>
            </div>
            <p className="text-sm text-app-text-2 mb-1">
              Essential SOP will update this Job from <strong>v{currentVersion?.versionNumber}</strong> to <strong>v{targetVersion?.versionNumber}</strong>.
            </p>
            {summary.conflicts > 0 ? (
              <p className="text-sm text-app-text-2 mb-4">
                Your selected customizations will be preserved. Changes where you selected "Use New Essential SOP Version" will follow the updated Essential SOP.
              </p>
            ) : (
              <p className="text-sm text-app-text-2 mb-4">
                All company customizations will be preserved automatically.
              </p>
            )}
            <div className="flex gap-3">
              <button onClick={() => setShowConfirm(false)} className="flex-1 py-2.5 border border-app-border rounded-lg text-sm font-medium text-app-text-2 no-select touch-active">Back</button>
              <button
                onClick={handleAdopt}
                disabled={adopting}
                className="flex-1 py-2.5 bg-app-accent text-app-accent-text rounded-lg text-sm font-medium no-select touch-active disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {adopting ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Updating…</> : 'Update Job'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Section group ─────────────────────────────────────────────────────────────

function SectionChangeGroup({ sectionType, label, changes, resolutions, setResolution, expanded, onToggle }) {
  const conflictCount = changes.filter(c => c.resolutionRequired).length;
  const unresolvedCount = changes.filter(c => c.resolutionRequired && !resolutions[c.changeId]).length;

  return (
    <div className="border-b border-app-divider">
      <button
        onClick={onToggle}
        className="w-full px-4 py-3.5 flex items-center gap-3 text-left no-select touch-active"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-app-text">{label}</span>
            <span className="text-xs text-app-text-muted">{changes.length} change{changes.length !== 1 ? 's' : ''}</span>
          </div>
          {conflictCount > 0 && (
            <p className={`text-xs mt-0.5 ${unresolvedCount > 0 ? 'text-app-warning' : 'text-app-success'}`}>
              {unresolvedCount > 0 ? `${unresolvedCount} decision${unresolvedCount !== 1 ? 's' : ''} required` : 'All conflicts resolved ✓'}
            </p>
          )}
        </div>
        {expanded ? <ChevronUp size={16} className="text-app-text-muted flex-shrink-0" /> : <ChevronDown size={16} className="text-app-text-muted flex-shrink-0" />}
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-3">
          {changes.map(change => (
            <ChangeCard
              key={change.changeId}
              change={change}
              resolution={resolutions[change.changeId]}
              onSetResolution={(v) => setResolution(change.changeId, v)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Change card ───────────────────────────────────────────────────────────────

function ChangeCard({ change, resolution, onSetResolution }) {
  const config = CHANGE_TYPE_CONFIG[change.changeType] || CHANGE_TYPE_CONFIG.MASTER_MODIFIED;
  const Icon = config.icon;

  return (
    <div className={`rounded-xl border p-3.5 ${change.resolutionRequired && !resolution ? 'border-app-warning/50 bg-app-warning-bg' : 'border-app-border bg-app-card'}`}>
      {/* Header row */}
      <div className="flex items-start gap-2 mb-2">
        <Icon size={14} className={`flex-shrink-0 mt-0.5 ${config.color}`} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-app-text">{change.fieldLabel}</p>
          <p className={`text-xs ${config.color}`}>{config.label}</p>
        </div>
      </div>

      {/* Values */}
      {change.changeType === 'CONFLICT' && (
        <div className="space-y-2 mb-3">
          {change.baseValue && <ValueRow label="Current Essential SOP" value={formatValue(change.baseValue)} subtle />}
          {change.targetValue !== null && change.targetValue !== undefined && <ValueRow label="New Essential SOP" value={formatValue(change.targetValue)} accent />}
          {change.companyValue && <ValueRow label="Your Company Version" value={formatValue(change.companyValue)} company />}
        </div>
      )}

      {change.changeType === 'MASTER_MODIFIED' && (
        <div className="space-y-1.5 mb-1">
          {change.baseValue && <ValueRow label="Was" value={formatValue(change.baseValue)} subtle />}
          {change.targetValue && <ValueRow label="Now" value={formatValue(change.targetValue)} accent />}
        </div>
      )}

      {change.changeType === 'MASTER_ADDED' && change.targetValue && (
        <ValueRow label="New item" value={formatValue(change.targetValue)} accent />
      )}

      {change.changeType === 'MASTER_REMOVED' && change.baseValue && (
        <ValueRow label="Was" value={formatValue(change.baseValue)} subtle />
      )}

      {change.changeType === 'COMPANY_ONLY_CUSTOMIZATION' && change.companyValue && (
        <ValueRow label="Your version" value={formatValue(change.companyValue)} company />
      )}

      {/* Resolution picker for conflicts */}
      {change.resolutionRequired && (
        <div className="flex gap-2 mt-3">
          <ResolutionButton
            active={resolution === 'KEEP_COMPANY'}
            onClick={() => onSetResolution('KEEP_COMPANY')}
            label="Keep Our Version"
          />
          <ResolutionButton
            active={resolution === 'USE_NEW_ESSENTIAL_SOP'}
            onClick={() => onSetResolution('USE_NEW_ESSENTIAL_SOP')}
            label="Use New SOP Version"
          />
        </div>
      )}
    </div>
  );
}

function ResolutionButton({ active, onClick, label }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-2 px-2 rounded-lg text-xs font-medium border no-select touch-active flex items-center justify-center gap-1 transition-colors ${
        active
          ? 'bg-app-accent border-app-accent text-app-accent-text'
          : 'bg-app-surface border-app-border text-app-text-2'
      }`}
    >
      {active && <Check size={11} />}
      {label}
    </button>
  );
}

function ValueRow({ label, value, subtle, accent, company }) {
  const textCls = accent ? 'text-app-accent' : company ? 'text-app-success' : 'text-app-text-muted';
  return (
    <div className="text-xs">
      <span className="font-semibold text-app-text-muted">{label}: </span>
      <span className={`selectable ${textCls}`}>{value || '—'}</span>
    </div>
  );
}

function SummaryChip({ icon: Icon, color, label }) {
  return (
    <div className={`flex items-center gap-1 whitespace-nowrap ${color}`}>
      <Icon size={12} />
      <span className="font-medium">{label}</span>
    </div>
  );
}

function formatValue(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  const parts = [];
  if (v.title) parts.push(v.title);
  if (v.body) parts.push(v.body);
  return parts.join(' — ') || '—';
}

function getAllConflicts(changesBySection) {
  const conflicts = [];
  for (const changes of Object.values(changesBySection || {})) {
    for (const change of changes) {
      if (change.resolutionRequired) conflicts.push(change);
    }
  }
  return conflicts;
}