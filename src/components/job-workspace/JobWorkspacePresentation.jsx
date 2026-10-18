/**
 * JobWorkspacePresentation — The shared Job Detail experience.
 *
 * This component is the single source of truth for all job detail rendering.
 * It is completely workspace-agnostic. It has no knowledge of whether data
 * originates from a Company Job, a Master SOP, or any future workspace.
 *
 * ─── Interface ───────────────────────────────────────────────────────────────
 *
 * job (required)
 *   Normalized job object:
 *   { id, title, shortDescription, trade, category,
 *     estimatedDuration, tags }
 *
 * contentBySection (required)
 *   { tools: [], materials: [], scope: [], procedure: [], safety: [], quality: [] }
 *
 * workspace (required)
 *   Workspace configuration object supplied by the wrapper:
 *   {
 *     label         — workspace label shown beneath title in header (string)
 *     editMode      — boolean: section add buttons and item action bars are active
 *   }
 *
 * ─── Slots (all optional) ────────────────────────────────────────────────────
 *
 * headerActions      — JSX rendered in the sticky header (right side)
 * contextBanner      — JSX rendered between the job header and sections
 *                      (e.g. version update banner, preview mode notice)
 * metadataView       — JSX rendered in the job header metadata row
 *                      (after trade/category/duration chips)
 * renderSectionAction(sectionType) → JSX
 *                      Called once per section; returned node placed in the
 *                      section heading row. Wrapper supplies an "Add" button here.
 * renderItemActions(sectionType, item, index, total) → JSX
 *                      Called per item; returned node placed below each item.
 *                      Wrapper supplies Edit/Delete/Reorder controls here.
 *
 * ─── Navigation ──────────────────────────────────────────────────────────────
 *
 * onBack (required)  — called when the back button is pressed
 */
import React from 'react';
import { ArrowLeft, Clock, Sliders } from 'lucide-react';
import SectionBlock from './SectionBlock';
import { SECTION_MAP } from '@/lib/constants';

const DISPLAY_ORDER = ['tools', 'materials', 'scope', 'procedure', 'safety', 'quality'];

export default function JobWorkspacePresentation({
  job,
  contentBySection = {},
  workspace = {},
  // slots
  headerActions,
  contextBanner,
  metadataView,
  renderSectionAction,
  renderItemActions,
  // navigation
  onBack,
  // optional footer slot (e.g. distribution panel on Platform detail)
  footerSlot,
}) {
  const { label, editMode } = workspace;

  return (
    <div className="min-h-screen bg-app-bg">
      {/* ── Sticky header ─────────────────────────────────────────────────── */}
      <div
        className="bg-app-surface border-b border-app-border sticky top-0 z-40"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="px-3 py-2.5 flex items-center gap-2.5">
          <button
            onClick={onBack}
            className="icon-btn no-select touch-active"
            aria-label="Back"
          >
            <ArrowLeft size={22} className="text-app-text-2" />
          </button>
          <h1 className="font-semibold text-app-text flex-1 truncate">{job.title}</h1>
          {/* Workspace-supplied header actions */}
          {headerActions}
        </div>
      </div>

      {/* ── Job header ────────────────────────────────────────────────────── */}
      <div className="px-3 pt-4 pb-3 border-b border-app-divider max-w-2xl mx-auto w-full">
        {label && (
          <p className="text-[10px] font-bold text-app-text-muted uppercase tracking-widest mb-1">
            {label}
          </p>
        )}
        <p className="text-xs font-semibold text-app-accent uppercase tracking-wide mb-1">
          {[job.trade, job.category].filter(Boolean).join(' · ')}
        </p>
        <h2 className="text-xl font-bold text-app-text mb-1.5 leading-snug">{job.title}</h2>
        {job.shortDescription && (
          <p className="text-sm text-app-text-2 leading-relaxed mb-2 selectable">
            {job.shortDescription}
          </p>
        )}

        {/* Standard metadata chips */}
        <div className="flex flex-wrap gap-2.5 text-xs text-app-text-muted">
          {job.estimatedDuration && (
            <span className="flex items-center gap-1">
              <Clock size={12} />{job.estimatedDuration}
            </span>
          )}
          {/* Workspace-supplied metadata view */}
          {metadataView}
        </div>

        {job.tags?.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {job.tags.map(t => (
              <span key={t} className="text-xs px-2 py-0.5 bg-app-elevated text-app-text-muted rounded-full">
                #{t}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── Context banner slot ───────────────────────────────────────────── */}
      {contextBanner}

      {/* ── Sections ──────────────────────────────────────────────────────── */}
      <div className="max-w-2xl mx-auto w-full">
        {DISPLAY_ORDER.map(sectionType => {
          const def = SECTION_MAP[sectionType];
          if (!def) return null;
          const items = contentBySection[sectionType] || [];

          const sectionAction = renderSectionAction?.(sectionType);

          const itemActionsForSection = renderItemActions
            ? (item, index, total) => renderItemActions(sectionType, item, index, total)
            : undefined;

          return (
            <SectionBlock
              key={sectionType}
              sectionType={sectionType}
              sectionDef={def}
              items={items}
              sectionAction={sectionAction}
              renderItemActions={itemActionsForSection}
              emptyMessage={editMode ? 'Tap Add to create the first item.' : 'No content yet.'}
            />
          );
        })}
      </div>

      {/* Footer slot */}
      {footerSlot && <div className="max-w-2xl mx-auto w-full pb-4">{footerSlot}</div>}

      {/* Bottom safe-area spacer */}
      <div style={{ height: 'calc(32px + env(safe-area-inset-bottom))' }} />
    </div>
  );
}