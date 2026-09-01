import React, { useState } from 'react';
import { X, AlertTriangle, ChevronDown } from 'lucide-react';
import { SEVERITY_LEVELS } from '@/lib/constants';
import SelectSheet from '@/components/ui/SelectSheet';

const fieldCls = 'w-full px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text placeholder:text-app-text-muted focus:outline-none focus:border-app-accent';

export default function ContentEditDialog({ sectionType, item, onSave, onClose }) {
  const [title, setTitle] = useState(item?.title || '');
  const [body, setBody] = useState(item?.body || '');
  const [isRequired, setIsRequired] = useState(item?.isRequired || false);
  const [isCritical, setIsCritical] = useState(item?.isCritical || false);
  const [metadata, setMetadata] = useState(item?.metadata || {});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [sevSheetOpen, setSevSheetOpen] = useState(false);

  const setMeta = (key, value) => setMetadata(prev =>
    value === undefined ? (() => { const c = { ...prev }; delete c[key]; return c; })() : { ...prev, [key]: value }
  );

  const handleSave = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({ title, body, isRequired, isCritical, metadata });
      // On success the parent closes the dialog; no state reset needed here.
    } catch (e) {
      setSaving(false);
      setSaveError(e?.message || 'Save failed. Please try again.');
    }
  };

  const isTool = sectionType === 'tools';
  const isMaterial = sectionType === 'materials';
  const isProcedure = sectionType === 'procedure';
  const isSafety = sectionType === 'safety';
  const titleLabel = isTool ? 'Tool Name' : isMaterial ? 'Material Name' : isProcedure ? 'Step Title' : 'Title';

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative bg-app-surface rounded-t-2xl flex flex-col"
        style={{ maxHeight: 'calc(92dvh - env(safe-area-inset-top))' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex-shrink-0 bg-app-surface border-b border-app-border px-4 py-3 flex items-center justify-between rounded-t-2xl">
          <h2 className="font-semibold text-app-text">{item ? 'Edit Item' : 'Add Item'}</h2>
          <button onClick={onClose} className="icon-btn no-select" aria-label="Close"><X size={20} className="text-app-text-muted" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <Field label={titleLabel}>
            <input value={title} onChange={e => setTitle(e.target.value)} className={fieldCls} />
          </Field>

          {!isTool && !isMaterial && (
            <Field label={isProcedure ? 'Instructions' : isSafety ? 'Description' : 'Content'}>
              <textarea value={body} onChange={e => setBody(e.target.value)} rows={3} className={fieldCls} />
            </Field>
          )}

          {(isTool || isMaterial) && (
            <Field label="Notes">
              <input value={body} onChange={e => setBody(e.target.value)} className={fieldCls} />
            </Field>
          )}

          {(isTool || isMaterial) && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Quantity">
                <input type="number" value={metadata.quantity || 1} onChange={e => setMeta('quantity', parseInt(e.target.value) || 1)} className={fieldCls} />
              </Field>
              {isMaterial && (
                <Field label="Unit">
                  <input value={metadata.unit || ''} onChange={e => setMeta('unit', e.target.value)} placeholder="each, ft, gal" className={fieldCls} />
                </Field>
              )}
            </div>
          )}

          {isMaterial && (
            <Field label="Specification">
              <input value={metadata.specification || ''} onChange={e => setMeta('specification', e.target.value)} className={fieldCls} />
            </Field>
          )}

          {isProcedure && (
            <>
              <Field label="Warning (optional)">
                <input value={metadata.warning || ''} onChange={e => setMeta('warning', e.target.value)} className={fieldCls} />
              </Field>
              <Field label="Tip (optional)">
                <input value={metadata.tip || ''} onChange={e => setMeta('tip', e.target.value)} className={fieldCls} />
              </Field>
            </>
          )}

          {isSafety && (
            <>
              <Field label="Severity">
                <button
                  type="button"
                  onClick={() => setSevSheetOpen(true)}
                  className={`${fieldCls} flex items-center justify-between text-left no-select touch-active`}
                >
                  <span>{metadata.severity || 'Caution'}</span>
                  <ChevronDown size={16} className="text-app-text-muted" />
                </button>
              </Field>
              <SelectSheet
                open={sevSheetOpen}
                title="Severity"
                value={metadata.severity || 'Caution'}
                options={SEVERITY_LEVELS.map(s => ({ value: s.value, label: s.value }))}
                onSelect={(v) => setMeta('severity', v)}
                onClose={() => setSevSheetOpen(false)}
              />
              <Field label="Required Action">
                <textarea value={metadata.requiredAction || ''} onChange={e => setMeta('requiredAction', e.target.value)} rows={2} className={fieldCls} />
              </Field>
            </>
          )}

          <div className="flex gap-4 pt-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={isRequired} onChange={e => setIsRequired(e.target.checked)} className="w-4 h-4 accent-app-accent" />
              <span className="text-sm text-app-text">Required</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={isCritical} onChange={e => setIsCritical(e.target.checked)} className="w-4 h-4 accent-app-accent" />
              <span className="text-sm text-app-text">Critical</span>
            </label>
          </div>
        </div>
        {saveError && (
          <div className="flex-shrink-0 px-4 pb-2 flex items-start gap-2">
            <AlertTriangle size={14} className="text-app-danger flex-shrink-0 mt-0.5" />
            <p className="text-xs text-app-danger">{saveError}</p>
          </div>
        )}
        <div
          className="flex-shrink-0 bg-app-surface border-t border-app-border p-4 flex gap-3"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        >
          <button onClick={onClose} disabled={saving} className="flex-1 py-2.5 border border-app-border rounded-lg text-sm font-medium text-app-text-2 disabled:opacity-50 no-select touch-active">Cancel</button>
          <button
            onClick={handleSave}
            disabled={!title.trim() || saving}
            className="flex-1 py-2.5 bg-app-accent text-app-accent-text rounded-lg text-sm font-medium disabled:bg-app-disabled disabled:text-app-text-disabled no-select touch-active flex items-center justify-center gap-2"
          >
            {saving ? (
              <><div className="w-4 h-4 border-2 border-app-accent-text/40 border-t-app-accent-text rounded-full animate-spin" /> Saving…</>
            ) : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="text-xs font-semibold text-app-text-muted uppercase mb-1 block">{label}</label>
      {children}
    </div>
  );
}