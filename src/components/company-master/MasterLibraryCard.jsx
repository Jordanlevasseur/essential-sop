import React from 'react';
import { ChevronRight } from 'lucide-react';

const STATUS = {
  adopted: { label: 'In your library', cls: 'bg-app-success-bg text-app-success' },
  available: { label: 'Available', cls: 'bg-app-info-bg text-app-info' },
  removed: { label: 'Removed', cls: 'bg-app-warning-bg text-app-warning' },
};

export default function MasterLibraryCard({ master, onClick }) {
  const s = STATUS[master.adoptionState] || STATUS.available;
  return (
    <button
      onClick={onClick}
      className="w-full bg-app-card border border-app-border rounded-xl p-3.5 flex items-center gap-3 text-left no-select touch-active"
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-app-text truncate">{master.title}</p>
        <p className="text-xs text-app-text-muted truncate">
          {[master.trade, master.category].filter(Boolean).join(' · ') || 'Master SOP'}
          {master.versionNumber ? ` · v${master.versionNumber}` : ''}
        </p>
        <span className={`inline-block mt-1.5 text-xs px-2 py-0.5 rounded-full font-medium ${s.cls}`}>{s.label}</span>
      </div>
      <ChevronRight size={18} className="text-app-text-muted flex-shrink-0" />
    </button>
  );
}