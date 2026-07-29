import React from 'react';
import { X } from 'lucide-react';
import { SKILL_LEVELS, TRADES, CATEGORIES } from '@/lib/constants';

export default function FilterSheet({ open, onClose, filters, setFilters, trades, categories }) {
  if (!open) return null;

  const tradesList = trades.length > 0 ? trades : TRADES;
  const catsList = categories.length > 0 ? categories : CATEGORIES;

  const update = (key, value) => setFilters(prev => ({ ...prev, [key]: prev[key] === value ? '' : value }));

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative bg-white rounded-t-2xl overflow-y-auto"
        style={{ maxHeight: 'calc(80vh - env(safe-area-inset-top))' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-neutral-200 px-4 py-3 flex items-center justify-between">
          <h2 className="font-semibold text-neutral-900">Filters</h2>
          <button onClick={onClose}><X size={20} className="text-neutral-400" /></button>
        </div>
        <div className="p-4 space-y-5">
          <div>
            <h3 className="text-xs font-semibold text-neutral-500 uppercase mb-2">Trade</h3>
            <div className="flex flex-wrap gap-2">
              {tradesList.map(t => (
                <button key={t} onClick={() => update('trade', t)}
                  className={`px-3 py-1.5 rounded-lg text-sm ${filters.trade === t ? 'bg-blue-600 text-white' : 'bg-neutral-100 text-neutral-600'}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-xs font-semibold text-neutral-500 uppercase mb-2">Skill Level</h3>
            <div className="flex flex-wrap gap-2">
              {SKILL_LEVELS.map(s => (
                <button key={s} onClick={() => update('skillLevel', s)}
                  className={`px-3 py-1.5 rounded-lg text-sm ${filters.skillLevel === s ? 'bg-blue-600 text-white' : 'bg-neutral-100 text-neutral-600'}`}>
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-xs font-semibold text-neutral-500 uppercase mb-2">Category</h3>
            <div className="flex flex-wrap gap-2">
              {catsList.map(c => (
                <button key={c} onClick={() => update('category', c)}
                  className={`px-3 py-1.5 rounded-lg text-sm ${filters.category === c ? 'bg-blue-600 text-white' : 'bg-neutral-100 text-neutral-600'}`}>
                  {c}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div
          className="sticky bottom-0 bg-white border-t border-neutral-200 p-4 flex gap-3"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        >
          <button onClick={() => setFilters({ trade: '', skillLevel: '', category: '' })}
            className="flex-1 py-2.5 border border-neutral-200 rounded-lg text-sm font-medium text-neutral-600">
            Clear All
          </button>
          <button onClick={onClose}
            className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium">
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}