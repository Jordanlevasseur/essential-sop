import React, { useState, useEffect } from 'react';
import { X, Loader2, Link2 } from 'lucide-react';
import SelectSheet from '@/components/ui/SelectSheet';
import { RESOURCE_TYPES, getResourceTypeConfig, isValidHttpsUrl } from './resourceTypes';

/**
 * ResourceFormDialog — Add or Edit a company resource link.
 *
 * Collects title (required), URL (required, HTTPS), resource type, and an
 * optional description. Performs local validation before calling onSave;
 * the parent handles the backend API call and surfaces server errors through
 * the `error` prop. Save and Cancel are always available; Save is disabled
 * while a request is in-flight.
 */
export default function ResourceFormDialog({ resource, saving, error, onSave, onClose }) {
  const [title, setTitle] = useState(resource?.title || '');
  const [url, setUrl] = useState(resource?.url || '');
  const [resourceType, setResourceType] = useState(resource?.resourceType || 'website');
  const [description, setDescription] = useState(resource?.description || '');
  const [localError, setLocalError] = useState('');
  const [showTypeSheet, setShowTypeSheet] = useState(false);

  useEffect(() => {
    if (resource) {
      setTitle(resource.title || '');
      setUrl(resource.url || '');
      setResourceType(resource.resourceType || 'website');
      setDescription(resource.description || '');
    }
  }, [resource]);

  const handleSave = async () => {
    setLocalError('');
    const trimmedTitle = title.trim();
    const trimmedUrl = url.trim();
    if (!trimmedTitle) { setLocalError('Title is required.'); return; }
    if (!trimmedUrl) { setLocalError('URL is required.'); return; }
    if (!isValidHttpsUrl(trimmedUrl)) { setLocalError('Enter a valid HTTPS URL (must start with https://).'); return; }
    try {
      await onSave({
        title: trimmedTitle,
        url: trimmedUrl,
        resourceType,
        description: description.trim(),
      });
    } catch {
      // parent sets `error` — dialog stays open
    }
  };

  const displayError = localError || error;
  const typeConfig = getResourceTypeConfig(resourceType);

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => !saving && onClose()}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative bg-app-surface rounded-t-2xl overflow-y-auto"
        style={{ maxHeight: '85vh', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-app-surface border-b border-app-border px-4 py-3 flex items-center justify-between">
          <h2 className="font-semibold text-app-text">{resource ? 'Edit Resource' : 'Add Resource'}</h2>
          <button onClick={() => !saving && onClose()} aria-label="Close" className="icon-btn text-app-text-muted">
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <div className="px-4 py-4 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-app-text mb-1.5">Title</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Install video tutorial"
              autoFocus
              className="w-full px-3 py-2.5 bg-app-input border border-app-border rounded-xl text-sm text-app-text placeholder:text-app-text-muted focus:outline-none focus:border-app-accent focus:ring-1 focus:ring-app-accent"
            />
          </div>

          {/* URL */}
          <div>
            <label className="block text-sm font-medium text-app-text mb-1.5">URL</label>
            <div className="relative">
              <Link2 size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text-muted" />
              <input
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://..."
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="w-full pl-9 pr-3 py-2.5 bg-app-input border border-app-border rounded-xl text-sm text-app-text placeholder:text-app-text-muted focus:outline-none focus:border-app-accent focus:ring-1 focus:ring-app-accent"
              />
            </div>
          </div>

          {/* Resource type */}
          <div>
            <label className="block text-sm font-medium text-app-text mb-1.5">Resource type</label>
            <button
              onClick={() => setShowTypeSheet(true)}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 bg-app-input border border-app-border rounded-xl text-left no-select touch-active"
            >
              <typeConfig.icon size={16} className="text-app-accent flex-shrink-0" />
              <span className="flex-1 text-sm text-app-text">{typeConfig.label}</span>
            </button>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-app-text mb-1.5">Description (optional)</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Brief note about what this resource covers"
              rows={2}
              className="w-full px-3 py-2.5 bg-app-input border border-app-border rounded-xl text-sm text-app-text placeholder:text-app-text-muted focus:outline-none focus:border-app-accent focus:ring-1 focus:ring-app-accent resize-none"
            />
          </div>

          {/* Error */}
          {displayError && (
            <div className="bg-app-danger-bg border border-app-danger/30 rounded-xl px-3 py-2.5">
              <p className="text-xs text-app-danger">{displayError}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              onClick={() => !saving && onClose()}
              disabled={saving}
              className="flex-1 py-2.5 border border-app-border rounded-xl text-sm font-medium text-app-text-2 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-2.5 bg-app-accent text-app-accent-text rounded-xl text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {saving ? <><Loader2 size={14} className="animate-spin" /> Saving...</> : 'Save'}
            </button>
          </div>
        </div>
      </div>

      <SelectSheet
        open={showTypeSheet}
        title="Resource type"
        value={resourceType}
        options={RESOURCE_TYPES.map(t => ({ value: t.value, label: t.label }))}
        onSelect={val => setResourceType(val)}
        onClose={() => setShowTypeSheet(false)}
      />
    </div>
  );
}