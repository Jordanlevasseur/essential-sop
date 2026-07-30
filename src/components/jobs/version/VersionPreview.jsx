import React, { useEffect, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { Eye, AlertTriangle, Loader2 } from 'lucide-react';

/**
 * VersionPreview — Edit 5D Hardening
 *
 * Calls previewFromAnalysis — the SAME rebase pipeline used by adoptVersionFromAnalysis.
 * Preview and final adoption are guaranteed to produce identical results.
 * previewMasterVersionAdoption is NOT used here.
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
      const res = await base44.functions.invoke('previewFromAnalysis', {
        companyJobId: job.id,
        analysisId: analysis.id || analysis.analysisId,
        reviewDecisions: reviewDecisions || {},
      });
      if (res?.data?.sections) {
        setPreview(res.data);
      } else {
        setError(res?.data?.error || 'Could not generate preview.');
      }
    } catch (_) {
      setError('Could not load preview. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [job.id, analysis.id, analysis.analysisId, analysis.toVersionId, reviewDecisions]);

  // Re-run preview when decisions change
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

  const { sections, targetVersionNumber, jobTitle, jobShortDescription } = preview;

  return (
    <div className="pb-6">
      {/* Preview banner */}
      <div className="mx-4 mt-4 mb-3 p-3 bg-app-info-bg border border-app-border rounded-xl flex items-start gap-2">
        <Eye size={14} className="text-app-accent flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-semibold text-app-accent">Read-only preview</p>
          <p className="text-xs text-app-text-2">
            Shows exactly how this job will look after adopting v{targetVersionNumber}. No changes made yet.
          </p>
        </div>
      </div>

      {/* Job metadata */}
      <div className="px-4 pb-3 border-b border-app-divider">
        <p className="text-xs font-bold text-app-text-muted uppercase tracking-wide mb-1">Job Info</p>
        <p className="font-semibold text-app-text">{jobTitle}</p>
        {jobShortDescription && <p className="text-sm text-app-text-2 mt-0.5">{jobShortDescription}</p>}
        <p className="text-xs text-app-text-muted mt-1">Version: v{targetVersionNumber}</p>
      </div>

      {/* Sections */}
      {SECTION_ORDER.map(st => {
        const items = sections?.[st] || [];
        if (items.length === 0) return null;
        return <SectionPreview key={st} label={SECTION_LABELS[st]} items={items} />;
      })}

      {Object.values(sections || {}).every(arr => arr.length === 0) && (
        <div className="px-4 py-8 text-center text-sm text-app-text-muted">
          No content in target version sections.
        </div>
      )}
    </div>
  );
}

function SectionPreview({ label, items }) {
  return (
    <div className="px-4 pt-5 pb-3 border-b border-app-divider">
      <p className="text-xs font-bold text-app-text-muted uppercase tracking-widest mb-3">{label}</p>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={item.id || i} className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              {item.title && <p className="text-sm text-app-text selectable">{item.title}</p>}
              {item.body && <p className="text-sm text-app-text-2 mt-0.5 selectable">{item.body}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}