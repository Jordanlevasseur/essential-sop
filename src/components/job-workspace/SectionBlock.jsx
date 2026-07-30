/**
 * SectionBlock — Generic section container for the Job Workspace.
 *
 * Renders a section heading, an optional "add" action (supplied as a slot),
 * the appropriate section view via SectionViewDispatcher, and a divider.
 *
 * Props:
 *   sectionType       — one of the six section keys
 *   sectionDef        — { title } from SECTION_MAP
 *   items             — content items array
 *   sectionAction     — optional JSX node rendered in the heading row (e.g. "Add" button)
 *   renderItemActions — optional function(item, index, total) → JSX rendered below each item
 *   emptyMessage      — optional string override for the empty state
 */
import React from 'react';
import { SectionViewDispatcher } from './SectionViews';

export default function SectionBlock({
  sectionType,
  sectionDef,
  items,
  sectionAction,
  renderItemActions,
  emptyMessage,
}) {
  return (
    <div className="px-5 pt-8 pb-2">
      {/* Section heading row */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-bold text-app-text-muted uppercase tracking-widest">
          {sectionDef.title}
        </h2>
        {sectionAction}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-app-text-muted italic">
          {emptyMessage || 'No content yet.'}
        </p>
      ) : (
        <SectionViewDispatcher
          sectionType={sectionType}
          items={items}
          renderItemActions={renderItemActions}
        />
      )}

      {/* Divider */}
      <div className="mt-6 border-b border-app-divider" />
    </div>
  );
}