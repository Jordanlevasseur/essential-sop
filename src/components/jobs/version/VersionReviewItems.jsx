import React, { useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info, ChevronDown, ChevronUp, Check, Shield } from 'lucide-react';

/**
 * VersionReviewItems — Renders all item categories from the CompanyVersionAnalysis.
 *
 * Sections:
 *  1. Analysis summary bar
 *  2. INVALID blockers (must fix before adoption)
 *  3. REVIEW_REQUIRED items (explicit decision per item required)
 *  4. ORPHANED items (keep / archive / delete)
 *  5. SAFE summary (no action needed, informational)
 *
 * Never modifies analysis. All decisions are stored locally and passed to adoptVersionFromAnalysis.
 */

const COMPAT_CONFIG = {
  SAFE: { color: 'text-app-success', bg: 'bg-app-success-bg', border: 'border-app-success/20', label: 'Safe', icon: CheckCircle2 },
  REVIEW_REQUIRED: { color: 'text-app-warning', bg: 'bg-app-warning-bg', border: 'border-app-warning/30', label: 'Needs Decision', icon: AlertTriangle },
  ORPHANED: { color: 'text-app-warning', bg: 'bg-app-warning-bg', border: 'border-app-warning/30', label: 'Orphaned', icon: AlertTriangle },
  INVALID: { color: 'text-app-danger', bg: 'bg-app-danger-bg', border: 'border-app-danger/30', label: 'Invalid — Blocked', icon: XCircle },
  NO_OP: { color: 'text-app-text-muted', bg: 'bg-app-disabled', border: 'border-app-border', label: 'No Change', icon: Info },
};

const SECTION_LABELS = {
  tools: 'Tools', materials: 'Materials', scope: 'Scope',
  procedure: 'Procedure', safety: 'Safety', quality: 'Quality Standards',
  metadata: 'Job Metadata',
};

const REASON_MESSAGES = {
  BOTH_CHANGED_SAME_FIELD: 'Both the master and your company changed this item differently.',
  TARGET_ITEM_REMOVED: 'The master removed this item but your company has a custom version of it.',
  MISSING_CURRENT_TARGET: 'This item was matched by text similarity only — identity is ambiguous.',
  COMPANY_ONLY_FIELD_CHANGE: 'Your company customized this. Master did not change it.',
  MASTER_FIELD_CHANGED: 'Master changed this item. Your company has no override.',
  MASTER_ADDED_NO_OVERRIDE: 'New item added in the master version.',
  REDUNDANT_OVERRIDE: 'Your override matches the new master value — no change needed.',
  MALFORMED_OVERRIDE: 'This override record is malformed and cannot be adopted as-is.',
  UNSUPPORTED_OVERRIDE_TYPE: 'This section type is not a valid override target.',
  OVERRIDE_COMPANY_MISMATCH: 'Override company ID mismatch — data integrity issue.',
  OVERRIDE_JOB_MISMATCH: 'Override job ID mismatch — data integrity issue.',
  OVERRIDE_MASTER_MISMATCH: 'Override master ID mismatch — data integrity issue.',
};

export default function VersionReviewItems({
  analysis,
  reviewDecisions, setReviewDecisions,
  orphanDispositions, setOrphanDispositions,
}) {
  const { itemResults, masterChangeSummary, safeCount, reviewRequiredCount, orphanedCount, invalidCount, noOpCount, canAutoAdopt } = analysis;
  const [expandedSections, setExpandedSections] = useState({ invalid: true, review: true, orphaned: true, safe: false });

  const toggleSection = (key) => setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));

  const reviewItems = itemResults.filter(r => r.compatibility === 'REVIEW_REQUIRED' && r.requiresAdminAction);
  const orphanedItems = itemResults.filter(r => r.compatibility === 'ORPHANED');
  const invalidItems = itemResults.filter(r => r.compatibility === 'INVALID');
  const safeItems = itemResults.filter(r => r.compatibility === 'SAFE' && (r.overrideId || r.overriddenFields?.length > 0));
  const noOpItems = itemResults.filter(r => r.compatibility === 'NO_OP');

  const setBulkReview = (val) => {
    const bulk = {};
    for (const r of reviewItems) bulk[r.logicalItemId] = val;
    setReviewDecisions(prev => ({ ...prev, ...bulk }));
  };

  return (
    <div className="pb-4">
      {/* Summary strip */}
      <div className="px-4 pt-4 pb-3">
        <SummaryBar
          safeCount={safeCount} reviewRequiredCount={reviewRequiredCount}
          orphanedCount={orphanedCount} invalidCount={invalidCount} noOpCount={noOpCount}
          canAutoAdopt={canAutoAdopt}
          masterChangeSummary={masterChangeSummary}
        />
      </div>

      {/* INVALID — always expanded, adoption blocked */}
      {invalidItems.length > 0 && (
        <CollapsibleSection
          id="invalid"
          title="Blocked — Invalid Items"
          count={invalidItems.length}
          variant="danger"
          expanded={expandedSections.invalid}
          onToggle={() => toggleSection('invalid')}
          badge="Adoption blocked"
        >
          <div className="px-4 pb-3 space-y-3">
            <InvalidGuidance />
            {invalidItems.map(item => (
              <InvalidItemCard key={item.logicalItemId} item={item} />
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* REVIEW_REQUIRED */}
      {reviewItems.length > 0 && (
        <CollapsibleSection
          id="review"
          title="Decisions Required"
          count={reviewItems.length}
          variant="warning"
          expanded={expandedSections.review}
          onToggle={() => toggleSection('review')}
          badge={`${reviewItems.filter(r => !reviewDecisions[r.logicalItemId]).length} pending`}
        >
          <div className="px-4 pb-3 space-y-3">
            {reviewItems.length > 1 && (
              <div className="flex gap-2 mb-1">
                <button onClick={() => setBulkReview('KEEP_COMPANY')} className="flex-1 py-1.5 border border-app-border rounded-lg text-xs font-medium text-app-text-2 no-select touch-active">Keep Ours for All</button>
                <button onClick={() => setBulkReview('USE_NEW_MASTER')} className="flex-1 py-1.5 border border-app-border rounded-lg text-xs font-medium text-app-text-2 no-select touch-active">Use New SOP for All</button>
              </div>
            )}
            {reviewItems.map(item => (
              <ReviewItemCard
                key={item.logicalItemId}
                item={item}
                decision={reviewDecisions[item.logicalItemId]}
                onDecide={(val) => setReviewDecisions(prev => ({ ...prev, [item.logicalItemId]: val }))}
              />
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* ORPHANED */}
      {orphanedItems.length > 0 && (
        <CollapsibleSection
          id="orphaned"
          title="Orphaned Items"
          count={orphanedItems.length}
          variant="warning"
          expanded={expandedSections.orphaned}
          onToggle={() => toggleSection('orphaned')}
          badge={`${orphanedItems.filter(r => !orphanDispositions[r.logicalItemId]).length} pending`}
        >
          <div className="px-4 pb-3 space-y-3">
            <p className="text-xs text-app-text-muted leading-relaxed">
              These items exist in your company override but the master removed them. Choose what to do with each one.
            </p>
            {orphanedItems.map(item => (
              <OrphanItemCard
                key={item.logicalItemId}
                item={item}
                disposition={orphanDispositions[item.logicalItemId]}
                onDispose={(val) => setOrphanDispositions(prev => ({ ...prev, [item.logicalItemId]: val }))}
              />
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* SAFE with company stake */}
      {safeItems.length > 0 && (
        <CollapsibleSection
          id="safe"
          title="Automatically Applied"
          count={safeItems.length + noOpItems.length}
          variant="success"
          expanded={expandedSections.safe}
          onToggle={() => toggleSection('safe')}
          badge="No action needed"
        >
          <div className="px-4 pb-3 space-y-2">
            <p className="text-xs text-app-text-muted">These items will be adopted automatically. No decisions needed.</p>
            {safeItems.map(item => (
              <SafeItemRow key={item.logicalItemId} item={item} />
            ))}
            {noOpItems.map(item => (
              <SafeItemRow key={item.logicalItemId} item={item} noOp />
            ))}
          </div>
        </CollapsibleSection>
      )}

      {canAutoAdopt && reviewItems.length === 0 && orphanedItems.length === 0 && invalidItems.length === 0 && (
        <div className="mx-4 mt-2 p-4 bg-app-success-bg border border-app-success/20 rounded-xl flex items-start gap-3">
          <CheckCircle2 size={16} className="text-app-success flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-app-success">Ready for automatic adoption</p>
            <p className="text-xs text-app-text-2 mt-0.5">All company overrides are compatible with the new version. No manual decisions needed.</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Summary bar ───────────────────────────────────────────────────────────────

function SummaryBar({ safeCount, reviewRequiredCount, orphanedCount, invalidCount, noOpCount, canAutoAdopt, masterChangeSummary }) {
  const chips = [
    invalidCount > 0 && { label: `${invalidCount} Invalid`, color: 'text-app-danger bg-app-danger-bg' },
    reviewRequiredCount > 0 && { label: `${reviewRequiredCount} Review`, color: 'text-app-warning bg-app-warning-bg' },
    orphanedCount > 0 && { label: `${orphanedCount} Orphaned`, color: 'text-app-warning bg-app-warning-bg' },
    safeCount > 0 && { label: `${safeCount} Safe`, color: 'text-app-success bg-app-success-bg' },
    noOpCount > 0 && { label: `${noOpCount} No-op`, color: 'text-app-text-muted bg-app-disabled' },
  ].filter(Boolean);

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((c, i) => (
          <span key={i} className={`px-2.5 py-1 rounded-full text-xs font-semibold ${c.color}`}>{c.label}</span>
        ))}
      </div>
      {(masterChangeSummary?.additions > 0 || masterChangeSummary?.removals > 0 || masterChangeSummary?.modifications > 0) && (
        <p className="text-xs text-app-text-muted mt-1.5">
          Master changes: {[
            masterChangeSummary.additions > 0 && `${masterChangeSummary.additions} added`,
            masterChangeSummary.removals > 0 && `${masterChangeSummary.removals} removed`,
            masterChangeSummary.modifications > 0 && `${masterChangeSummary.modifications} modified`,
          ].filter(Boolean).join(' · ')}
        </p>
      )}
    </div>
  );
}

// ── Collapsible section wrapper ───────────────────────────────────────────────

function CollapsibleSection({ id, title, count, variant, expanded, onToggle, badge, children }) {
  const colors = {
    danger: 'text-app-danger',
    warning: 'text-app-warning',
    success: 'text-app-success',
    muted: 'text-app-text-muted',
  };
  return (
    <div className="border-b border-app-divider">
      <button onClick={onToggle} className="w-full px-4 py-3.5 flex items-center gap-3 text-left no-select touch-active">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-sm font-semibold ${colors[variant] || 'text-app-text'}`}>{title}</span>
            <span className="text-xs text-app-text-muted">({count})</span>
          </div>
          {badge && <p className="text-xs text-app-text-muted mt-0.5">{badge}</p>}
        </div>
        {expanded ? <ChevronUp size={16} className="text-app-text-muted flex-shrink-0" /> : <ChevronDown size={16} className="text-app-text-muted flex-shrink-0" />}
      </button>
      {expanded && children}
    </div>
  );
}

// ── Invalid guidance ──────────────────────────────────────────────────────────

function InvalidGuidance() {
  return (
    <div className="p-3 bg-app-danger-bg border border-app-danger/20 rounded-xl text-xs text-app-danger">
      <p className="font-semibold mb-1">Adoption is blocked</p>
      <p className="text-app-text-2">The items below have integrity issues. To proceed:</p>
      <ul className="mt-1 list-disc list-inside text-app-text-2 space-y-0.5">
        <li>Open Job Customize Editor and correct the affected override</li>
        <li>Save the correction, then return here to re-analyse</li>
      </ul>
    </div>
  );
}

// ── Invalid item card ─────────────────────────────────────────────────────────

function InvalidItemCard({ item }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-xl border border-app-danger/30 bg-app-danger-bg p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-app-danger">{labelForItem(item)} — Invalid</p>
          <p className="text-xs text-app-text-2 mt-0.5">{REASON_MESSAGES[item.reasonCode] || item.reasonMessage}</p>
        </div>
        <button onClick={() => setExpanded(e => !e)} className="icon-btn text-app-text-muted touch-active no-select">
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>
      {expanded && <FieldValues item={item} />}
    </div>
  );
}

// ── Review item card ──────────────────────────────────────────────────────────

function ReviewItemCard({ item, decision, onDecide }) {
  const [expanded, setExpanded] = useState(true);
  const decided = !!decision;

  return (
    <div className={`rounded-xl border p-3.5 ${!decided ? 'border-app-warning/40 bg-app-warning-bg' : 'border-app-border bg-app-card'}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-app-text">{labelForItem(item)}</p>
            {decided && (
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${decision === 'KEEP_COMPANY' ? 'bg-app-success-bg text-app-success' : 'bg-app-info-bg text-app-accent'}`}>
                {decision === 'KEEP_COMPANY' ? 'Keeping ours' : 'Using new'}
              </span>
            )}
          </div>
          <p className="text-xs text-app-text-muted mt-0.5">{SECTION_LABELS[item.parentLogicalItemId] || item.parentLogicalItemId}</p>
          <p className="text-xs text-app-text-2 mt-1 leading-relaxed">{REASON_MESSAGES[item.reasonCode] || item.reasonMessage}</p>
        </div>
        <button onClick={() => setExpanded(e => !e)} className="icon-btn text-app-text-muted touch-active no-select">
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {expanded && <FieldValues item={item} />}

      <div className="flex gap-2 mt-3">
        <DecisionButton
          active={decision === 'KEEP_COMPANY'}
          onClick={() => onDecide('KEEP_COMPANY')}
          label="Keep Our Version"
        />
        <DecisionButton
          active={decision === 'USE_NEW_MASTER'}
          onClick={() => onDecide('USE_NEW_MASTER')}
          label="Use New SOP"
        />
      </div>
    </div>
  );
}

// ── Orphan item card ──────────────────────────────────────────────────────────

function OrphanItemCard({ item, disposition, onDispose }) {
  const [expanded, setExpanded] = useState(false);
  const decided = !!disposition;

  return (
    <div className={`rounded-xl border p-3.5 ${!decided ? 'border-app-warning/40 bg-app-warning-bg' : 'border-app-border bg-app-card'}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-app-text">{labelForItem(item)}</p>
            {decided && (
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                disposition === 'KEEP' ? 'bg-app-warning-bg text-app-warning' : 'bg-app-disabled text-app-text-muted'
              }`}>
                {disposition === 'KEEP' ? 'Keeping' : disposition === 'ARCHIVE' ? 'Archiving' : 'Deleting'}
              </span>
            )}
          </div>
          <p className="text-xs text-app-text-muted mt-0.5">{SECTION_LABELS[item.parentLogicalItemId] || item.parentLogicalItemId}</p>
          <p className="text-xs text-app-text-2 mt-1">The master removed this item but your company had customized it.</p>
        </div>
        <button onClick={() => setExpanded(e => !e)} className="icon-btn text-app-text-muted touch-active no-select">
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {expanded && <FieldValues item={item} />}

      <div className="flex gap-2 mt-3">
        <OrphanButton active={disposition === 'KEEP'} onClick={() => onDispose('KEEP')} label="Keep It" description="Preserve your override" />
        <OrphanButton active={disposition === 'ARCHIVE'} onClick={() => onDispose('ARCHIVE')} label="Remove It" description="Accept master removal" danger />
      </div>
    </div>
  );
}

// ── Safe item row ─────────────────────────────────────────────────────────────

function SafeItemRow({ item, noOp }) {
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-app-divider last:border-0">
      <CheckCircle2 size={12} className={`flex-shrink-0 mt-0.5 ${noOp ? 'text-app-text-muted' : 'text-app-success'}`} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-app-text">{labelForItem(item)}</p>
        <p className="text-xs text-app-text-muted">{noOp ? 'No change needed' : 'Will be applied automatically'}</p>
      </div>
    </div>
  );
}

// ── Field values display ──────────────────────────────────────────────────────

function FieldValues({ item }) {
  const hasCurrent = item.currentMasterValues && Object.keys(item.currentMasterValues).length > 0;
  const hasCompany = item.companyOverrideValues && Object.keys(item.companyOverrideValues).length > 0;
  const hasTarget = item.targetMasterValues && Object.keys(item.targetMasterValues).length > 0;

  if (!hasCurrent && !hasCompany && !hasTarget) return null;

  return (
    <div className="mt-2 space-y-1.5 p-2.5 bg-app-bg rounded-lg">
      {hasCurrent && (
        <FieldRow label="Current master" values={item.currentMasterValues} color="text-app-text-muted" />
      )}
      {hasCompany && (
        <FieldRow label="Your version" values={item.companyOverrideValues} color="text-app-success" />
      )}
      {hasTarget && (
        <FieldRow label="New master" values={item.targetMasterValues} color="text-app-accent" />
      )}
    </div>
  );
}

function FieldRow({ label, values, color }) {
  const text = Object.values(values).map(v => {
    if (!v) return null;
    if (typeof v === 'string') return v;
    const parts = [];
    if (v.title) parts.push(v.title);
    if (v.body) parts.push(v.body);
    return parts.join(' — ') || null;
  }).filter(Boolean).join(', ');

  if (!text) return null;
  return (
    <div className="text-xs">
      <span className="font-semibold text-app-text-muted">{label}: </span>
      <span className={`selectable ${color}`}>{text}</span>
    </div>
  );
}

// ── Buttons ───────────────────────────────────────────────────────────────────

function DecisionButton({ active, onClick, label }) {
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

function OrphanButton({ active, onClick, label, description, danger }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-2 px-2 rounded-lg text-xs font-medium border no-select touch-active flex flex-col items-center gap-0.5 transition-colors ${
        active
          ? danger
            ? 'bg-app-danger-bg border-app-danger/40 text-app-danger'
            : 'bg-app-warning-bg border-app-warning/40 text-app-warning'
          : 'bg-app-surface border-app-border text-app-text-2'
      }`}
    >
      {active && <Check size={10} />}
      <span>{label}</span>
      <span className="text-[10px] opacity-70">{description}</span>
    </button>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function labelForItem(item) {
  // Try to extract a human-readable label from item values
  const vals = item.companyOverrideValues?.item || item.currentMasterValues?.item || item.targetMasterValues?.item;
  if (vals?.title) return vals.title;

  // Metadata fields
  const metaVal = item.companyOverrideValues?.title || item.currentMasterValues?.title ||
    item.companyOverrideValues?.shortDescription || item.currentMasterValues?.shortDescription;
  if (metaVal) return String(metaVal).slice(0, 60);

  // Fall back to logicalItemId-derived label
  const lid = item.logicalItemId || '';
  if (lid.startsWith('metadata_')) return lid.replace('metadata_', '').replace(/_/g, ' ');
  if (lid.startsWith('section_override_')) return `Section: ${lid.replace('section_override_', '')}`;
  if (lid.startsWith('override_record_')) return 'Override Record';

  return 'Item';
}