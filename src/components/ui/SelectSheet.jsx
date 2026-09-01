/**
 * SelectSheet — mobile-native replacement for web-style <select> controls.
 *
 * Renders a bottom-sheet selector (locks to safe area, contains its own overscroll)
 * instead of the iOS Safari dropdown wheel which reads as "web-like" in an
 * installed app. Supports options as strings or { value, label } objects.
 *
 * UI-only: preserves values, data binding, and the caller's onSelect contract.
 */
import React, { useEffect } from 'react';
import { X, Check } from 'lucide-react';

export default function SelectSheet({ open, title, value, options = [], onSelect, onClose }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape' && onClose) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const items = options.map(o => (typeof o === 'string' ? { value: o, label: o } : o));

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Select'}
        className="relative bg-app-surface rounded-t-2xl overflow-y-auto"
        style={{ maxHeight: '70vh', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-app-surface border-b border-app-border px-4 py-3 flex items-center justify-between">
          <h2 className="font-semibold text-app-text">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="icon-btn text-app-text-muted">
            <X size={20} />
          </button>
        </div>
        <div className="p-2">
          {items.map(({ value: val, label }) => {
            const active = value === val;
            return (
              <button
                key={String(val)}
                onClick={() => { if (onSelect) onSelect(val); if (onClose) onClose(); }}
                className={`w-full flex items-center justify-between px-4 py-3.5 rounded-xl text-left no-select touch-active ${active ? 'bg-app-info-bg' : 'hover:bg-app-elevated'}`}
              >
                <span className={`text-sm ${active ? 'text-app-accent font-medium' : 'text-app-text'}`}>{label}</span>
                {active && <Check size={18} className="text-app-accent" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}