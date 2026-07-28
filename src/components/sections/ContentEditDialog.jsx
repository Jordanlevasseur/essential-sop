import React, { useState } from 'react';
import { X } from 'lucide-react';
import { SEVERITY_LEVELS, DOCUMENTATION_TYPES } from '@/lib/constants';

export default function ContentEditDialog({ sectionType, item, onSave, onClose }) {
  const [title, setTitle] = useState(item?.title || '');
  const [body, setBody] = useState(item?.body || '');
  const [isRequired, setIsRequired] = useState(item?.isRequired || false);
  const [isCritical, setIsCritical] = useState(item?.isCritical || false);
  const [metadata, setMetadata] = useState(item?.metadata || {});

  const setMeta = (key, value) => setMetadata(prev => value === undefined ? (() => { const c = { ...prev }; delete c[key]; return c; })() : { ...prev, [key]: value });

  const handleSave = () => {
    if (!title.trim()) return;
    onSave({ title, body, isRequired, isCritical, metadata });
  };

  const isScope = sectionType === 'scope';
  const isProcedure = sectionType === 'procedure';
  const isTool = sectionType === 'tools';
  const isMaterial = sectionType === 'materials';
  const isSafety = sectionType === 'safety';
  const isDoc = sectionType === 'documentation';
  const isQuality = sectionType === 'quality';

  const titleLabel = isTool ? 'Tool Name' : isMaterial ? 'Material Name' : isProcedure ? 'Step Title' : 'Title';

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative bg-white rounded-t-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-neutral-200 px-4 py-3 flex items-center justify-between">
          <h2 className="font-semibold text-neutral-900">{item ? 'Edit Item' : 'Add Item'}</h2>
          <button onClick={onClose}><X size={20} className="text-neutral-400" /></button>
        </div>
        <div className="p-4 space-y-3">
          <Field label={titleLabel}>
            <input value={title} onChange={e => setTitle(e.target.value)} className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm" />
          </Field>

          {!isTool && !isMaterial && (
            <Field label={isScope ? 'Content' : isProcedure ? 'Instructions' : isSafety ? 'Description' : isDoc ? 'Instructions' : 'Acceptance Criteria'}>
              <textarea value={body} onChange={e => setBody(e.target.value)} rows={3} className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm" />
            </Field>
          )}

          {(isTool || isMaterial) && (
            <Field label="Notes">
              <input value={body} onChange={e => setBody(e.target.value)} className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm" />
            </Field>
          )}

          {(isTool || isMaterial) && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Quantity">
                <input type="number" value={metadata.quantity || 1} onChange={e => setMeta('quantity', parseInt(e.target.value) || 1)} className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm" />
              </Field>
              {isMaterial && (
                <Field label="Unit">
                  <input value={metadata.unit || ''} onChange={e => setMeta('unit', e.target.value)} placeholder="each, ft, gal" className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm" />
                </Field>
              )}
            </div>
          )}

          {isMaterial && (
            <Field label="Specification">
              <input value={metadata.specification || ''} onChange={e => setMeta('specification', e.target.value)} className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm" />
            </Field>
          )}

          {isProcedure && (
            <>
              <Field label="Warning (optional)">
                <input value={metadata.warning || ''} onChange={e => setMeta('warning', e.target.value)} className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm" />
              </Field>
              <Field label="Tip (optional)">
                <input value={metadata.tip || ''} onChange={e => setMeta('tip', e.target.value)} className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm" />
              </Field>
            </>
          )}

          {isSafety && (
            <>
              <Field label="Severity">
                <select value={metadata.severity || 'Caution'} onChange={e => setMeta('severity', e.target.value)} className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm">
                  {SEVERITY_LEVELS.map(s => <option key={s.value} value={s.value}>{s.value}</option>)}
                </select>
              </Field>
              <Field label="Required Action">
                <textarea value={metadata.requiredAction || ''} onChange={e => setMeta('requiredAction', e.target.value)} rows={2} className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm" />
              </Field>
            </>
          )}

          {isDoc && (
            <Field label="Documentation Type">
              <select value={metadata.documentationType || 'Note'} onChange={e => setMeta('documentationType', e.target.value)} className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm">
                {DOCUMENTATION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          )}

          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={isRequired} onChange={e => setIsRequired(e.target.checked)} className="w-4 h-4" />
              <span className="text-sm text-neutral-700">Required</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={isCritical} onChange={e => setIsCritical(e.target.checked)} className="w-4 h-4" />
              <span className="text-sm text-neutral-700">Critical</span>
            </label>
          </div>
        </div>
        <div className="sticky bottom-0 bg-white border-t border-neutral-200 p-4 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 border border-neutral-200 rounded-lg text-sm font-medium text-neutral-600">Cancel</button>
          <button onClick={handleSave} disabled={!title.trim()} className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:bg-neutral-300">Save</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="text-xs font-semibold text-neutral-500 uppercase mb-1 block">{label}</label>
      {children}
    </div>
  );
}