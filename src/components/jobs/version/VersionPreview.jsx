import React, { useEffect, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { Eye, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';

/**
 * VersionPreview — Read-only preview of the post-adoption job state.
 *
 * Calls previewMasterVersionAdoption to render what the job WOULD look like
 * after adoption, including all current review decisions.
 * This is strictly read-only — never executes adoption.
 */

const SECTION_ORDER = ['tools', 'materials', 'scope', 'procedure', 'safety', 'quality'];
const SECTION_LABELS = {
  tools: 'Tools', materials: 'Materials', scope: 'Scope',
  procedure: 'Procedure', safety: 'Safety', quality: 'Quality Standards',
};

export default function VersionPreview({ job, analysis, reviewDecisions }) {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await base44.functions.invoke('previewMasterVersionAdoption', {
        jobId: job.id,
        targetVersionId: analysis.toVersionId,
      });
      if (res?.data?.previewFingerprint) {
        setPreview(res.data);
      } else {
        setError(res?.data?.error || 'Could not generate preview.');
      }
    } catch (_) {
      setError('Could not load preview. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [job.id, analysis.toVersionId]);

  useEffect(() => { loadPreview(); }, [loadPreview]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-3">
        <Loader2 size={24} className="text-app-accent animate-spin" />
        <p className="text-sm text-app-text-muted">Generating preview…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-48 p-6 text-center gap-3">
        <AlertTriangle size={28} className="text-app-warning" />
        <p className="text-sm text-app-text-2">{error}</p>
        <button onClick={loadPreview} className="px-4 py-2 bg-app-accent text-app-accent-text rounded-lg text-sm font-medium no-select touch-active">
          Try Again
        </button>
      </div>
    );
  }

  const { targetVersion, changesBySection } = preview;
  // Build projected sections using analysis item decisions
  // Items the user chose USE_NEW_MASTER will show new master value;
  // items KEEP_COMPANY will show company value; SAFE shows auto-applied.
  // The preview here comes from previewMasterVersionAdoption which already
  // computes the final state — we annotate it with decision labels.

  return (
    <div className="pb-6">
      {/* Preview banner */}
      <div className="mx-4 mt-4 mb-3 p-3 bg-app-info-bg border border-app-border rounded-xl flex items-start gap-2">
        <Eye size={14} className="text-app-accent flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-semibold text-app-accent">Read-only preview</p>
          <p className="text-xs text-app-text-2">Shows how this job will look after adopting v{targetVersion?.versionNumber}. No changes made yet.</p>
        </div>
      </div>

      {/* Job metadata */}
      <div className="px-4 pb-3 border-b border-app-divider">
        <p className="text-xs font-bold text-app-text-muted uppercase tracking-wide mb-1">Job Info</p>
        <p className="font-semibold text-app-text">{job.title}</p>
        {job.shortDescription && <p className="text-sm text-app-text-2 mt-0.5">{job.shortDescription}</p>}
        <p className="text-xs text-app-text-muted mt-1">Version: v{targetVersion?.versionNumber}</p>
      </div>

      {/* Sections */}
      {SECTION_ORDER.map(st => {
        const changes = changesBySection?.[st] || [];
        if (changes.length === 0) return null;
        return (
          <SectionPreview key={st} sectionType={st} label={SECTION_LABELS[st]} changes={changes} reviewDecisions={reviewDecisions} />
        );
      })}

      {Object.keys(changesBySection || {}).length === 0 && (
        <div className="px-4 py-8 text-center text-sm text-app-text-muted">
          No content changes detected between these versions.
        </div>
      )}
    </div>
  );
}

function SectionPreview({ sectionType, label, changes, reviewDecisions }) {
  return (
    <div className="px-4 pt-5 pb-3 border-b border-app-divider">
      <p className="text-xs font-bold text-app-text-muted uppercase tracking-widest mb-3">{label}</p>
      <div className="space-y-2">
        {changes.map((change, i) => {
          const decision = reviewDecisions?.[change.changeId];
          return <PreviewChangeRow key={change.changeId || i} change={change} decision={decision} />;
        })}
      </div>
    </div>
  );
}

function PreviewChangeRow({ change, decision }) {
  // Determine what will actually be shown post-adoption
  let displayValue, annotation, annotationColor;

  if (change.changeType === 'CONFLICT') {
    if (decision === 'KEEP_COMPANY') {
      displayValue = formatValue(change.companyValue);
      annotation = 'Your version (kept)';
      annotationColor = 'text-app-success';
    } else if (decision === 'USE_NEW_MASTER') {
      displayValue = formatValue(change.targetValue);
      annotation = 'New master (accepted)';
      annotationColor = 'text-app-accent';
    } else {
      displayValue = formatValue(change.companyValue);
      annotation = 'Decision pending';
      annotationColor = 'text-app-warning';
    }
  } else if (change.changeType === 'COMPANY_ONLY_CUSTOMIZATION') {
    displayValue = formatValue(change.companyValue);
    annotation = 'Your customization';
    annotationColor = 'text-app-success';
  } else if (change.changeType === 'MASTER_ADDED') {
    displayValue = formatValue(change.targetValue);
    annotation = 'New item';
    annotationColor = 'text-app-accent';
  } else if (change.changeType === 'MASTER_REMOVED') {
    displayValue = formatValue(change.baseValue);
    annotation = 'Removed';
    annotationColor = 'text-app-danger';
  } else {
    displayValue = formatValue(change.targetValue || change.baseValue);
    annotation = null;
  }

  if (!displayValue) return null;

  return (
    <div className="flex items-start gap-2">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-app-text selectable">{displayValue}</p>
        {annotation && <p className={`text-xs mt-0.5 ${annotationColor}`}>{annotation}</p>}
      </div>
    </div>
  );
}

function formatValue(v) {
  if (!v) return null;
  if (typeof v === 'string') return v;
  const parts = [];
  if (v.title) parts.push(v.title);
  if (v.body) parts.push(v.body);
  return parts.join(' — ') || null;
}