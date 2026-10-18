import React from 'react';
import { X } from 'lucide-react';
import { TRADES } from '@/lib/constants';

export default function FilterSheet({ open, onClose, filters, setFilters, trades }) {
  if (!open) return null;

  const tradesList = trades.length > 0 ? trades : TRADES;
  const update = (key, value) => setFilters(prev => ({ ...prev, [key]: prev[key] === value ? '' : value }));

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Filters"
        className="relative bg-app-surface rounded-t-2xl overflow-y-auto"
        style={{ maxHeight: 'calc(80vh - env(safe-area-inset-top))' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-app-surface border-b border-app-border px-3 py-2.5 flex items-center justify-between">
          <h2 className="font-semibold text-app-text">Filters</h2>
          <button onClick={onClose} className="icon-btn no-select" aria-label="Close"><X size={20} className="text-app-text-muted" /></button>
        </div>
        <div className="p-3 space-y-4">
          <div>
            <h3 className="text-xs font-semibold text-app-text-muted uppercase mb-2">Trade</h3>
            <div className="flex flex-wrap gap-1.5">
              {tradesList.map(t => (
                <button key={t} onClick={() => update('trade', t)}
                  className={`px-2.5 py-2 rounded-md text-sm no-select touch-active ${filters.trade === t ? 'bg-app-accent text-app-accent-text' : 'bg-app-elevated text-app-text-2'}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div
          className="sticky bottom-0 bg-app-surface border-t border-app-border p-3 flex gap-2"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        >
          <button onClick={() => setFilters({ trade: '' })}
            className="flex-1 py-2.5 border border-app-border rounded-lg text-sm font-medium text-app-text-2">
            Clear All
          </button>
          <button onClick={onClose}
            className="flex-1 py-2.5 bg-app-accent text-app-accent-text rounded-lg text-sm font-medium">
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}