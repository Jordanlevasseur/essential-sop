/**
 * CreateMasterJob — Full-page creation entry point for Platform Master SOPs.
 *
 * Collects the minimum required metadata (title, trade, category), calls
 * manageMasterSOP/create, then immediately navigates to the full editor.
 * No sheets, no modals, no half-height UI.
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { ArrowLeft, Plus } from 'lucide-react';

const fieldCls =
  'w-full px-3 py-2.5 bg-app-input border border-app-border rounded-lg text-sm text-app-text placeholder:text-app-text-muted focus:outline-none focus:border-app-accent focus:ring-1 focus:ring-app-accent';

export default function CreateMasterJob() {
  const navigate = useNavigate();

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
        trade: trade.trim(),
        category: category.trim(),
      });
      const created = res.data?.master;
      if (created?.id) {
        navigate(`/platform/master-library/${created.id}/edit`, { replace: true });
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
    <div
      className="min-h-screen bg-app-bg flex flex-col"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      {/* Header */}
      <div className="bg-app-surface border-b border-app-border sticky top-0 z-40">
        <div className="max-w-2xl mx-auto px-3 py-2.5 flex items-center gap-2.5">
          <button
            onClick={() => navigate('/platform/master-library')}
            className="icon-btn text-app-text-2 flex-shrink-0"
            aria-label="Back to Master Jobs"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="font-semibold text-app-text">New Master Job</h1>
        </div>
      </div>

      {/* Form */}
      <div className="flex-1 max-w-2xl mx-auto w-full px-4 py-8">
        <p className="text-sm text-app-text-muted mb-6">
          Enter basic details to create a new Master Job draft. You can fill in all sections in the editor.
        </p>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-app-text-muted uppercase tracking-wide mb-1.5 block">
              Title <span className="text-app-danger">*</span>
            </label>
            <input
              autoFocus
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              placeholder="e.g. Interior Door Installation"
              className={fieldCls}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-app-text-muted uppercase tracking-wide mb-1.5 block">Trade</label>
              <input
                value={trade}
                onChange={e => setTrade(e.target.value)}
                placeholder="e.g. Carpentry"
                className={fieldCls}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-app-text-muted uppercase tracking-wide mb-1.5 block">Category</label>
              <input
                value={category}
                onChange={e => setCategory(e.target.value)}
                placeholder="e.g. Installation"
                className={fieldCls}
              />
            </div>
          </div>

          {error && (
            <p className="text-sm text-app-danger">{error}</p>
          )}

          <button
            onClick={handleCreate}
            disabled={!title.trim() || creating}
            className="w-full py-3 bg-app-accent text-app-accent-text rounded-xl text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 mt-2"
          >
            <Plus size={16} />
            {creating ? 'Creating draft…' : 'Create & Open Editor'}
          </button>
        </div>
      </div>
    </div>
  );
}