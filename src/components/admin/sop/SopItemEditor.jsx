/**
 * SopItemEditor — Rich item editor for Master SOP content items.
 * Supports: text, tool, material, numberedStep, checklist, warning, note, hyperlink
 */
import React, { useState, useEffect } from 'react';
import { X, AlertTriangle, CheckSquare, List, Hash, Link, Wrench, Package, FileText, Info, ChevronDown } from 'lucide-react';
import SelectSheet from '@/components/ui/SelectSheet';

export const CONTENT_TYPES = [
  { value: 'text',         label: 'Text / Note',     icon: FileText,      description: 'General text block or note' },
  { value: 'numberedStep', label: 'Numbered Step',    icon: Hash,          description: 'Procedure step with a number' },
  { value: 'checklist',    label: 'Checklist Item',   icon: CheckSquare,   description: 'Checkbox item' },
  { value: 'tool',         label: 'Tool',             icon: Wrench,        description: 'Required or optional tool' },
  { value: 'material',     label: 'Material',         icon: Package,       description: 'Material or supply item' },
  { value: 'warning',      label: 'Warning / Safety', icon: AlertTriangle, description: 'Caution or safety notice' },
  { value: 'qualityCheck', label: 'Quality Check',    icon: CheckSquare,   description: 'Quality standard checkpoint' },
];

const SEVERITY_OPTIONS = ['Information', 'Caution', 'Warning', 'Critical'];

export default function SopItemEditor({ item, onSave, onCancel, onDelete, sectionType }) {
  const defaultType = _defaultTypeForSection(sectionType);
  const [draft, setDraft] = useState(() => ({
    contentType: item?.contentType || defaultType,
    title: item?.title || '',
    body: item?.body || '',
    isRequired: item?.isRequired ?? false,
    isCritical: item?.isCritical ?? false,
    metadata: item?.metadata || {},
  }));

  useEffect(() => {
    setDraft({
      contentType: item?.contentType || defaultType,
      title: item?.title || '',
      body: item?.body || '',
      isRequired: item?.isRequired ?? false,
      isCritical: item?.isCritical ?? false,
      metadata: item?.metadata || {},
    });
  }, [item?.title]); // re-init only when a different item is passed

  const set = (key, val) => setDraft(p => ({ ...p, [key]: val }));
  const setMeta = (key, val) => setDraft(p => ({ ...p, metadata: { ...p.metadata, [key]: val } }));

  const [sevSheetOpen, setSevSheetOpen] = useState(false);
  const canSave = draft.title.trim().length > 0;

  const handleSave = () => {
    if (!canSave) return;
    onSave({ ...draft, title: draft.title.trim(), body: draft.body.trim() });
  };

  const typeDef = CONTENT_TYPES.find(t => t.value === draft.contentType) || CONTENT_TYPES[0];
  const Icon = typeDef.icon;

  return (
    <div className="border border-app-accent/40 rounded-lg p-3 bg-app-elevated space-y-3">
      {/* Type selector */}
      <div>
        <label className="text-xs font-semibold text-app-text-muted uppercase tracking-wide mb-1.5 block">Content Type</label>
        <div className="flex flex-wrap gap-1.5">
          {CONTENT_TYPES.map(t => {
            const TIcon = t.icon;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => set('contentType', t.value)}
                title={t.description}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors ${
                  draft.contentType === t.value
                    ? 'bg-app-accent text-app-accent-text'
                    : 'border border-app-border text-app-text-2 hover:border-app-accent'
                }`}
              >
                <TIcon size={11} />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Title */}
      <div>
        <label className="text-xs font-semibold text-app-text-muted uppercase tracking-wide mb-1 block">
          {draft.contentType === 'numberedStep' ? 'Step Title *' : 'Title *'}
        </label>
        <input
          autoFocus
          value={draft.title}
          onChange={e => set('title', e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSave(); } }}
          placeholder={_titlePlaceholder(draft.contentType)}
          className="w-full px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text focus:outline-none focus:border-app-accent"
        />
      </div>

      {/* Body */}
      <div>
        <label className="text-xs font-semibold text-app-text-muted uppercase tracking-wide mb-1 block">
          {draft.contentType === 'numberedStep' ? 'Instructions' : 'Details / Notes'}
          <span className="font-normal text-app-text-disabled ml-1">(optional)</span>
        </label>
        <textarea
          value={draft.body}
          onChange={e => set('body', e.target.value)}
          rows={3}
          placeholder={_bodyPlaceholder(draft.contentType)}
          className="w-full px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text focus:outline-none focus:border-app-accent resize-y"
        />
      </div>

      {/* Warning severity */}
      {draft.contentType === 'warning' && (
        <div>
          <label className="text-xs font-semibold text-app-text-muted uppercase tracking-wide mb-1 block">Severity</label>
          <button
            type="button"
            onClick={() => setSevSheetOpen(true)}
            className="w-full px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text text-left flex items-center justify-between no-select touch-active"
          >
            <span>{draft.metadata.severity || 'Warning'}</span>
            <ChevronDown size={16} className="text-app-text-muted" />
          </button>
          <SelectSheet
            open={sevSheetOpen}
            title="Severity"
            value={draft.metadata.severity || 'Warning'}
            options={SEVERITY_OPTIONS.map(s => ({ value: s, label: s }))}
            onSelect={(v) => setMeta('severity', v)}
            onClose={() => setSevSheetOpen(false)}
          />
        </div>
      )}

      {/* Tool/material extras */}
      {(draft.contentType === 'tool' || draft.contentType === 'material') && (
        <div className="flex gap-3 flex-wrap">
          <div>
            <label className="text-xs font-semibold text-app-text-muted uppercase tracking-wide mb-1 block">Qty</label>
            <input
              type="number"
              min="1"
              value={draft.metadata.quantity || ''}
              onChange={e => setMeta('quantity', e.target.value ? parseInt(e.target.value) : '')}
              placeholder="1"
              className="w-20 px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text focus:outline-none focus:border-app-accent"
            />
          </div>
          {draft.contentType === 'material' && (
            <div className="flex-1 min-w-24">
              <label className="text-xs font-semibold text-app-text-muted uppercase tracking-wide mb-1 block">Specification</label>
              <input
                value={draft.metadata.specification || ''}
                onChange={e => setMeta('specification', e.target.value)}
                placeholder="e.g. 16-gauge galvanized"
                className="w-full px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text focus:outline-none focus:border-app-accent"
              />
            </div>
          )}
        </div>
      )}

      {/* Procedure step extras */}
      {draft.contentType === 'numberedStep' && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-semibold text-app-text-muted uppercase tracking-wide mb-1 block">Warning note</label>
            <input
              value={draft.metadata.warning || ''}
              onChange={e => setMeta('warning', e.target.value)}
              placeholder="Safety caution for this step"
              className="w-full px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text focus:outline-none focus:border-app-accent"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-app-text-muted uppercase tracking-wide mb-1 block">Tip</label>
            <input
              value={draft.metadata.tip || ''}
              onChange={e => setMeta('tip', e.target.value)}
              placeholder="Helpful tip for this step"
              className="w-full px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text focus:outline-none focus:border-app-accent"
            />
          </div>
        </div>
      )}

      {/* Flags */}
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={draft.isRequired}
            onChange={e => set('isRequired', e.target.checked)}
            className="rounded"
          />
          <span className="text-xs text-app-text-2">Required</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={draft.isCritical}
            onChange={e => set('isCritical', e.target.checked)}
            className="rounded"
          />
          <span className="text-xs text-app-text-2">Critical</span>
        </label>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1 border-t border-app-divider">
        <button
          onClick={handleSave}
          disabled={!canSave}
          className="px-4 py-1.5 bg-app-accent text-app-accent-text rounded-lg text-xs font-semibold disabled:opacity-40"
        >
          Save Item
        </button>
        <button onClick={onCancel} className="px-3 py-1.5 border border-app-border rounded-lg text-xs text-app-text-2">
          Cancel
        </button>
        {onDelete && (
          <button onClick={onDelete} className="ml-auto px-3 py-1.5 border border-app-danger/40 rounded-lg text-xs text-app-danger">
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

function _defaultTypeForSection(sectionType) {
  const map = { tools: 'tool', materials: 'material', procedure: 'numberedStep', safety: 'warning', quality: 'qualityCheck' };
  return map[sectionType] || 'text';
}

function _titlePlaceholder(type) {
  const map = {
    tool: 'e.g. Cordless drill with 18V battery',
    material: 'e.g. 2x4 lumber, 8 ft',
    numberedStep: 'e.g. Apply primer coat to surface',
    checklist: 'e.g. Verify load capacity rating',
    warning: 'e.g. Wear eye protection at all times',
    qualityCheck: 'e.g. All joints flush within 1/8"',
    text: 'e.g. Note about this section',
  };
  return map[type] || 'Enter title…';
}

function _bodyPlaceholder(type) {
  const map = {
    numberedStep: 'Describe exactly how to perform this step…',
    warning: 'Describe the hazard and required protective action…',
    text: 'Add additional context, references, or notes…',
  };
  return map[type] || 'Add details or notes (optional)…';
}