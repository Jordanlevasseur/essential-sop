import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { X, Plus } from 'lucide-react';

export default function CreateMasterJobSheet({ onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [trade, setTrade] = useState('');
  const [category, setCategory] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);

  const handleCreate = async () => {
    if (!title.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await base44.functions.invoke('manageMasterSOP', {
        action: 'create',
        title: title.trim(),
        category: category.trim(),
        trade: trade.trim(),
      });
      const created = res.data?.master;
      if (created) {
        onCreated(created);
      } else {
        setError('Creation failed — no draft was returned. Please try again.');
        setCreating(false);
      }
    } catch (e) {
      setError(e?.message || 'Failed to create. Please try again.');
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative bg-app-surface rounded-t-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-app-border flex items-center justify-between">
          <h2 className="font-semibold text-app-text">New Master Job</h2>
          <button onClick={onClose} className="icon-btn touch-active no-select">
            <X size={20} className="text-app-text-muted" />
          </button>
        </div>

        {/* Form */}
        <div className="p-4 space-y-3" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          <div>
            <label className="text-xs font-semibold text-app-text-muted mb-1.5 block uppercase tracking-wide">
              Title <span className="text-app-danger">*</span>
            </label>
            <input
              autoFocus
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              placeholder="e.g. Interior Door Installation"
              className="w-full px-3 py-2.5 bg-app-input border border-app-border rounded-lg text-sm text-app-text placeholder:text-app-text-muted focus:outline-none focus:border-app-accent"
            />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs font-semibold text-app-text-muted mb-1.5 block uppercase tracking-wide">Trade</label>
              <input
                value={trade}
                onChange={e => setTrade(e.target.value)}
                placeholder="e.g. Carpentry"
                className="w-full px-3 py-2.5 bg-app-input border border-app-border rounded-lg text-sm text-app-text placeholder:text-app-text-muted focus:outline-none focus:border-app-accent"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs font-semibold text-app-text-muted mb-1.5 block uppercase tracking-wide">Category</label>
              <input
                value={category}
                onChange={e => setCategory(e.target.value)}
                placeholder="e.g. Installation"
                className="w-full px-3 py-2.5 bg-app-input border border-app-border rounded-lg text-sm text-app-text placeholder:text-app-text-muted focus:outline-none focus:border-app-accent"
              />
            </div>
          </div>

          {error && (
            <p className="text-xs text-app-danger">{error}</p>
          )}

          <button
            onClick={handleCreate}
            disabled={!title.trim() || creating}
            className="w-full py-3 bg-app-accent text-app-accent-text rounded-xl text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Plus size={16} />
            {creating ? 'Creating…' : 'Create Master Job'}
          </button>
        </div>
      </div>
    </div>
  );
}