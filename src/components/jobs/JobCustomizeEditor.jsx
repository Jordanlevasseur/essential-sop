/**
 * JobCustomizeEditor — Company customization editor for provisioned Essential SOP Jobs.
 *
 * Loaded only when capabilities.canCustomize === true (backend-generated).
 * Sends all saves through the saveJobOverride backend function.
 * Never writes directly to Job, JobSection, SectionContent, or JobOverride entities.
 *
 * Supports:
 *  - Title override
 *  - Short description override
 *  - Per-section content override (full section replacement)
 *
 * Implements:
 *  - Optimistic concurrency (expectedRevision)
 *  - Idempotency (mutationKey per save attempt)
 *  - Unsaved-changes warning
 *  - Duplicate-save prevention (loading state)
 */

import React, { useState, useCallback } from 'react';
import { X, Save, AlertTriangle, ChevronDown, ChevronUp, Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { base44 } from '@/api/base44Client';

const SECTION_LABELS = {
  tools: 'Tools',
  materials: 'Materials',
  scope: 'Scope',
  procedure: 'Procedure',
  safety: 'Safety',
  quality: 'Quality Standards',
};

const SECTION_ORDER = ['tools', 'materials', 'scope', 'procedure', 'safety', 'quality'];

const fieldCls = 'w-full px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text placeholder:text-app-text-muted focus:outline-none focus:border-app-accent';

// Generate a simple UUID-like idempotency key
function newMutationKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function JobCustomizeEditor({ job, contentBySection, override, onSaved, onClose }) {
  const [title, setTitle] = useState(job.title || '');
  const [shortDescription, setShortDescription] = useState(job.shortDescription || '');
  // Per-section override arrays — start from resolved content
  const [sectionData, setSectionData] = useState(() => {
    const init = {};
    for (const st of SECTION_ORDER) {
      init[st] = (contentBySection[st] || []).map(item => ({
        contentType: item.contentType || 'text',
        title: item.title || '',
        body: item.body || '',
        sortOrder: item.sortOrder ?? 0,
        isRequired: item.isRequired || false,
        isCritical: item.isCritical || false,
        metadata: item.metadata || {},
      }));
    }
    return init;
  });
  const [expandedSections, setExpandedSections] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [conflictError, setConflictError] = useState(null);
  const [dirty, setDirty] = useState(false);

  const markDirty = () => setDirty(true);

  const toggleSection = (st) => {
    setExpandedSections(prev => ({ ...prev, [st]: !prev[st] }));
  };

  const updateItem = (st, idx, field, value) => {
    setSectionData(prev => {
      const updated = [...prev[st]];
      updated[idx] = { ...updated[idx], [field]: value };
      return { ...prev, [st]: updated };
    });
    markDirty();
  };

  const addItem = (st) => {
    setSectionData(prev => {
      const updated = [...prev[st], {
        contentType: 'text', title: '', body: '',
        sortOrder: prev[st].length, isRequired: false, isCritical: false, metadata: {},
      }];
      return { ...prev, [st]: updated };
    });
    setExpandedSections(prev => ({ ...prev, [st]: true }));
    markDirty();
  };

  const removeItem = (st, idx) => {
    setSectionData(prev => {
      const updated = prev[st].filter((_, i) => i !== idx).map((item, i) => ({ ...item, sortOrder: i }));
      return { ...prev, [st]: updated };
    });
    markDirty();
  };

  const moveItem = (st, idx, dir) => {
    setSectionData(prev => {
      const arr = [...prev[st]];
      const swap = idx + dir;
      if (swap < 0 || swap >= arr.length) return prev;
      [arr[idx], arr[swap]] = [arr[swap], arr[idx]];
      return { ...prev, [st]: arr.map((item, i) => ({ ...item, sortOrder: i })) };
    });
    markDirty();
  };

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    setConflictError(null);

    const mutationKey = newMutationKey();
    const expectedRevision = override?.revision ?? 0;

    // Build sectionOverrides — only include sections that differ from original
    const sectionOverrides = {};
    for (const st of SECTION_ORDER) {
      sectionOverrides[st] = sectionData[st];
    }

    const overrideData = {
      title: title.trim() || job.title,
      shortDescription: shortDescription.trim(),
      sectionOverrides,
    };

    try {
      const res = await base44.functions.invoke('saveJobOverride', {
        jobId: job.id,
        overrideData,
        expectedRevision,
        mutationKey,
      });

      if (res.data?.success) {
        setDirty(false);
        onSaved(res.data.resolvedJob);
      } else {
        setSaveError(res.data?.error || 'Save failed. Please try again.');
      }
    } catch (err) {
      const msg = err?.message || '';
      if (msg.includes('REVISION_CONFLICT') || msg.includes('Conflict')) {
        setConflictError('Another administrator saved changes while you were editing. Please reload and try again.');
      } else {
        setSaveError('Save failed. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  }, [saving, job, title, shortDescription, sectionData, override]);

  const handleClose = () => {
    if (dirty) {
      if (!window.confirm('You have unsaved changes. Leave without saving?')) return;
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: 'hsl(var(--app-bg))' }}>
      {/* Header */}
      <div className="bg-app-surface border-b border-app-border flex-shrink-0" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="px-4 py-3 flex items-center gap-3">
          <button onClick={handleClose} className="icon-btn no-select touch-active" aria-label="Close">
            <X size={22} className="text-app-text-2" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-app-text-muted">Customizing for your company</p>
            <h1 className="font-semibold text-app-text truncate">{job.title}</h1>
          </div>
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-app-accent text-app-accent-text rounded-lg text-sm font-medium no-select touch-active disabled:bg-app-disabled disabled:text-app-text-disabled"
          >
            <Save size={14} />
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Override badge */}
      {override && (
        <div className="flex-shrink-0 px-4 py-2 bg-app-info-bg border-b border-app-border">
          <p className="text-xs text-app-info">
            You have saved customizations (revision {override.revision}).
            Fields not changed inherit from the Master SOP.
          </p>
        </div>
      )}

      {/* Errors */}
      {(saveError || conflictError) && (
        <div className="flex-shrink-0 px-4 py-3 bg-app-danger-bg border-b border-app-border flex items-start gap-2">
          <AlertTriangle size={16} className="text-app-danger flex-shrink-0 mt-0.5" />
          <p className="text-sm text-app-danger">{conflictError || saveError}</p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto w-full px-4 py-5 space-y-5">
          {/* Job metadata overrides */}
          <div className="bg-app-surface border border-app-border rounded-xl p-4 space-y-3">
            <h2 className="text-xs font-bold text-app-text-muted uppercase tracking-widest">Job Details</h2>
            <div>
              <label className="text-xs font-semibold text-app-text-muted uppercase mb-1 block">Title</label>
              <input
                value={title}
                onChange={e => { setTitle(e.target.value); markDirty(); }}
                className={fieldCls}
                placeholder="Job title"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-app-text-muted uppercase mb-1 block">Summary</label>
              <textarea
                value={shortDescription}
                onChange={e => { setShortDescription(e.target.value); markDirty(); }}
                rows={2}
                className={fieldCls}
                placeholder="Short description visible on job card"
              />
            </div>
          </div>

          {/* Section editors */}
          {SECTION_ORDER.map(st => (
            <SectionEditor
              key={st}
              sectionType={st}
              label={SECTION_LABELS[st]}
              items={sectionData[st]}
              expanded={!!expandedSections[st]}
              onToggle={() => toggleSection(st)}
              onUpdateItem={(idx, field, value) => updateItem(st, idx, field, value)}
              onAddItem={() => addItem(st)}
              onRemoveItem={(idx) => removeItem(st, idx)}
              onMoveItem={(idx, dir) => moveItem(st, idx, dir)}
            />
          ))}
        </div>

        <div style={{ height: 'calc(32px + env(safe-area-inset-bottom))' }} />
      </div>
    </div>
  );
}

// ── Section editor ────────────────────────────────────────────────────────────

function SectionEditor({ sectionType, label, items, expanded, onToggle, onUpdateItem, onAddItem, onRemoveItem, onMoveItem }) {
  return (
    <div className="bg-app-surface border border-app-border rounded-xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 no-select touch-active"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-app-text">{label}</span>
          <span className="text-xs text-app-text-muted">({items.length} items)</span>
        </div>
        {expanded ? <ChevronUp size={16} className="text-app-text-muted" /> : <ChevronDown size={16} className="text-app-text-muted" />}
      </button>

      {expanded && (
        <div className="border-t border-app-divider px-4 pb-4 space-y-3">
          {items.length === 0 && (
            <p className="text-sm text-app-text-muted italic pt-3">No items. Tap Add to create the first one.</p>
          )}

          {items.map((item, idx) => (
            <ContentItemEditor
              key={idx}
              item={item}
              index={idx}
              total={items.length}
              sectionType={sectionType}
              onChange={(field, value) => onUpdateItem(idx, field, value)}
              onRemove={() => onRemoveItem(idx)}
              onMove={(dir) => onMoveItem(idx, dir)}
            />
          ))}

          <button
            onClick={onAddItem}
            className="flex items-center gap-1.5 px-3 py-2 bg-app-elevated border border-app-border rounded-lg text-sm text-app-text-2 no-select touch-active w-full justify-center mt-1"
          >
            <Plus size={14} /> Add Item
          </button>
        </div>
      )}
    </div>
  );
}

// ── Content item editor ───────────────────────────────────────────────────────

function ContentItemEditor({ item, index, total, sectionType, onChange, onRemove, onMove }) {
  return (
    <div className="bg-app-elevated border border-app-border rounded-lg p-3 space-y-2 mt-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-app-text-muted uppercase">Item {index + 1}</span>
        <div className="flex items-center gap-1">
          <button onClick={() => onMove(-1)} disabled={index === 0} className="icon-btn text-app-text-muted disabled:opacity-30 touch-active" aria-label="Move up">
            <ArrowUp size={13} />
          </button>
          <button onClick={() => onMove(1)} disabled={index === total - 1} className="icon-btn text-app-text-muted disabled:opacity-30 touch-active" aria-label="Move down">
            <ArrowDown size={13} />
          </button>
          <button onClick={onRemove} className="icon-btn text-app-danger touch-active" aria-label="Remove item">
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <div>
        <label className="text-xs text-app-text-muted mb-0.5 block">
          {sectionType === 'tools' ? 'Tool Name' : sectionType === 'materials' ? 'Material Name' : sectionType === 'procedure' ? 'Step Title' : 'Title'}
        </label>
        <input
          value={item.title}
          onChange={e => onChange('title', e.target.value)}
          className={fieldCls}
          placeholder="Title"
        />
      </div>

      {sectionType !== 'tools' && sectionType !== 'materials' && (
        <div>
          <label className="text-xs text-app-text-muted mb-0.5 block">
            {sectionType === 'procedure' ? 'Instructions' : sectionType === 'safety' ? 'Description' : 'Details'}
          </label>
          <textarea
            value={item.body}
            onChange={e => onChange('body', e.target.value)}
            rows={2}
            className={fieldCls}
            placeholder="Content"
          />
        </div>
      )}

      {(sectionType === 'tools' || sectionType === 'materials') && (
        <div>
          <label className="text-xs text-app-text-muted mb-0.5 block">Notes</label>
          <input
            value={item.body}
            onChange={e => onChange('body', e.target.value)}
            className={fieldCls}
            placeholder="Optional notes"
          />
        </div>
      )}

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={item.isRequired}
            onChange={e => onChange('isRequired', e.target.checked)}
            className="w-3.5 h-3.5 accent-app-accent"
          />
          <span className="text-xs text-app-text">Required</span>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={item.isCritical}
            onChange={e => onChange('isCritical', e.target.checked)}
            className="w-3.5 h-3.5 accent-app-accent"
          />
          <span className="text-xs text-app-text">Critical</span>
        </label>
      </div>
    </div>
  );
}