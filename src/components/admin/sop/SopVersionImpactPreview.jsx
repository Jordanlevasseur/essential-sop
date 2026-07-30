/**
 * SopVersionImpactPreview — Pre-publish impact summary.
 *
 * Compares the current draft sections against the last published version's sections
 * using a simple structural diff: added/removed/modified items by section.
 * This is informational only — does not invoke the analysis engine.
 */
import React, { useState, useEffect } from 'react';
import { Plus, Minus, Edit3, ArrowRight, AlertTriangle, CheckCircle2, Info, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';

const SECTION_ORDER = ['tools', 'materials', 'scope', 'procedure', 'safety', 'quality'];
const SECTION_TITLES = { tools: 'Tools', materials: 'Materials', scope: 'Scope', procedure: 'Procedure', safety: 'Safety', quality: 'Quality Standards' };

export default function SopVersionImpactPreview({ master, draftSections }) {
  const [prevSections, setPrevSections] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!master?.currentPublishedVersionId) {
      setPrevSections([]);
      return;
    }
    setLoading(true);
    base44.functions.invoke('manageMasterSOP', {
      action: 'get_version',
      versionId: master.currentPublishedVersionId,
    }).then(res => {
      setPrevSections(res.data?.sections || []);
    }).catch(() => {
      setError('Could not load previous version for comparison.');
    }).finally(() => setLoading(false));
  }, [master?.currentPublishedVersionId]);

  if (loading) return (
    <div className="flex items-center gap-2 text-sm text-app-text-muted py-4">
      <Loader2 size={15} className="animate-spin" /> Calculating impact…
    </div>
  );

  if (error) return (
    <div className="flex items-center gap-2 text-sm text-app-warning py-2">
      <AlertTriangle size={14} /> {error}
    </div>
  );

  const isFirstVersion = !master?.currentPublishedVersionId;

  if (isFirstVersion) {
    const totalItems = draftSections.reduce((sum, s) => sum + (s.contentItems?.length || 0), 0);
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 p-3 bg-app-info-bg rounded-lg border border-app-info/20">
          <Info size={14} className="text-app-info flex-shrink-0" />
          <p className="text-sm text-app-info">This is the first publication — no previous version to compare.</p>
        </div>
        <div className="text-sm text-app-text-2">
          <span className="font-medium text-app-success">{totalItems} item{totalItems !== 1 ? 's' : ''}</span> will be included across all sections.
        </div>
      </div>
    );
  }

  if (!prevSections) return null;

  // Build diff
  const diff = _buildDiff(prevSections, draftSections);
  const totalChanges = diff.reduce((sum, s) => sum + s.added + s.removed + s.modified, 0);
  const hasChanges = totalChanges > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 px-3 py-2 bg-app-info-bg border border-app-info/20 rounded-lg">
        <Info size={13} className="text-app-info flex-shrink-0" />
        <p className="text-xs text-app-info">Structural Change Preview — shows what changed in the master content, not per-company adoption results.</p>
      </div>
      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-2">
        <ImpactBadge icon={Plus} label="Items Added" value={diff.reduce((s,d) => s + d.added, 0)} color="success" />
        <ImpactBadge icon={Minus} label="Items Removed" value={diff.reduce((s,d) => s + d.removed, 0)} color="danger" />
        <ImpactBadge icon={Edit3} label="Items Modified" value={diff.reduce((s,d) => s + d.modified, 0)} color="warning" />
      </div>

      {!hasChanges && (
        <div className="flex items-center gap-2 p-3 bg-app-success-bg rounded-lg border border-app-success/20">
          <CheckCircle2 size={14} className="text-app-success flex-shrink-0" />
          <p className="text-sm text-app-success">No content changes detected from the previous version.</p>
        </div>
      )}

      {/* Per-section breakdown */}
      {hasChanges && (
        <div className="space-y-1.5">
          <p className="text-xs font-bold text-app-text-muted uppercase tracking-wide">Master Content Changes by Section</p>
          {diff.filter(s => s.added + s.removed + s.modified > 0).map(s => (
            <div key={s.sectionType} className="flex items-center justify-between px-3 py-2 bg-app-elevated rounded-lg text-xs">
              <span className="font-medium text-app-text">{s.title}</span>
              <div className="flex items-center gap-3">
                {s.added > 0 && <span className="text-app-success">+{s.added}</span>}
                {s.removed > 0 && <span className="text-app-danger">−{s.removed}</span>}
                {s.modified > 0 && <span className="text-app-warning">~{s.modified}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Accurate note: this is structural, not per-company analysis */}
      {hasChanges && (
        <div className="p-3 bg-app-elevated rounded-lg space-y-1.5">
          <p className="text-xs font-bold text-app-text-muted uppercase tracking-wide">About Company Impact</p>
          <p className="text-xs text-app-text-muted leading-relaxed">
            Actual company adoption impact (SAFE / REVIEW REQUIRED / ORPHANED) is calculated after publication based on each company's specific customizations. The structural counts above show what changed in the master content — they are not confirmed adoption classifications.
          </p>
        </div>
      )}
    </div>
  );
}

function ImpactBadge({ icon: Icon, label, value, color }) {
  const colors = {
    success: 'bg-app-success-bg text-app-success border-app-success/20',
    danger: 'bg-app-danger-bg text-app-danger border-app-danger/20',
    warning: 'bg-app-warning-bg text-app-warning border-app-warning/20',
  };
  return (
    <div className={`flex flex-col items-center p-3 rounded-lg border ${colors[color]}`}>
      <Icon size={14} className="mb-1" />
      <span className="text-lg font-bold">{value}</span>
      <span className="text-xs text-center leading-tight mt-0.5">{label}</span>
    </div>
  );
}

function ImpactTag({ label, value, color }) {
  const colors = {
    success: 'bg-app-success-bg text-app-success',
    danger: 'bg-app-danger-bg text-app-danger',
    warning: 'bg-app-warning-bg text-app-warning',
  };
  return (
    <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${colors[color]}`}>
      {value} {label}
    </span>
  );
}

/**
 * Build a simple structural diff between two sets of sections.
 * Uses logicalItemId for identity where available, falls back to title match.
 */
function _buildDiff(prevSections, draftSections) {
  return SECTION_ORDER.map(st => {
    const prev = (prevSections.find(s => s.sectionType === st)?.contentItems || []);
    const draft = (draftSections.find(s => s.sectionType === st)?.contentItems || []);

    const prevById = new Map(prev.map(i => [i.logicalItemId || `t:${i.title}`, i]));
    const draftById = new Map(draft.map(i => [i.logicalItemId || `t:${i.title}`, i]));

    let added = 0, removed = 0, modified = 0;
    for (const [id, draftItem] of draftById) {
      if (!prevById.has(id)) { added++; }
      else {
        const prevItem = prevById.get(id);
        if (prevItem.title !== draftItem.title || prevItem.body !== draftItem.body) modified++;
      }
    }
    for (const id of prevById.keys()) {
      if (!draftById.has(id)) removed++;
    }

    return { sectionType: st, title: SECTION_TITLES[st], added, removed, modified };
  });
}