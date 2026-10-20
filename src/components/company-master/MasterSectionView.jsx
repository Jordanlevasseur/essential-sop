import React, { useState } from 'react';
import {
  ChevronDown, ChevronRight, Wrench, Package, ClipboardList,
  ListOrdered, AlertTriangle, CheckSquare,
} from 'lucide-react';

const SECTION_ICONS = {
  tools: Wrench, materials: Package, scope: ClipboardList,
  procedure: ListOrdered, safety: AlertTriangle, quality: CheckSquare,
};
const SECTION_TITLES = {
  tools: 'Tools', materials: 'Materials', scope: 'Scope',
  procedure: 'Procedure', safety: 'Safety', quality: 'Quality Standards',
};

export default function MasterSectionView({ section }) {
  const [open, setOpen] = useState(true);
  const st = section.sectionType;
  const Icon = SECTION_ICONS[st] || ClipboardList;
  const title = section.title || SECTION_TITLES[st] || st;
  const items = section.contentItems || [];

  return (
    <div className="bg-app-card border border-app-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-3.5 py-3 text-left no-select touch-active"
        aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
      >
        <div className="w-8 h-8 rounded-lg bg-app-info-bg flex items-center justify-center flex-shrink-0">
          <Icon size={16} className="text-app-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-app-text">{title}</p>
          <p className="text-xs text-app-text-muted">{items.length} item{items.length !== 1 ? 's' : ''}</p>
        </div>
        {open ? <ChevronDown size={18} className="text-app-text-muted" /> : <ChevronRight size={18} className="text-app-text-muted" />}
      </button>
      {open && (
        <div className="px-3.5 pb-3 divide-y divide-app-divider">
          {items.length === 0 ? (
            <p className="text-xs text-app-text-muted py-2">No items in this section.</p>
          ) : items.map((it, i) => (
            <div key={it.logicalItemId || i} className="py-2.5">
              <div className="flex items-start gap-2">
                <p className="text-sm font-medium text-app-text flex-1">{it.title || 'Untitled'}</p>
                {it.isCritical && <span className="text-xs px-1.5 py-0.5 bg-app-danger-bg text-app-danger rounded-full font-medium flex-shrink-0">Critical</span>}
              </div>
              {it.body && <p className="text-xs text-app-text-2 mt-1 whitespace-pre-wrap">{it.body}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}