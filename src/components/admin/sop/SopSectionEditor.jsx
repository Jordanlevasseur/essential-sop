/**
 * SopSectionEditor — Single section panel within the Master SOP editor.
 * Handles item list, drag-to-reorder (simple up/down), and inline add/edit.
 */
import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Plus, Pencil, Trash2, ArrowUp, ArrowDown, AlertTriangle, CheckSquare, Hash, Package, Wrench, FileText } from 'lucide-react';
import SopItemEditor, { CONTENT_TYPES } from './SopItemEditor';

const ICON_MAP = {
  tool: Wrench,
  material: Package,
  numberedStep: Hash,
  checklist: CheckSquare,
  warning: AlertTriangle,
  qualityCheck: CheckSquare,
  text: FileText,
};

const SEV_COLORS = {
  Critical: 'text-app-danger',
  Warning: 'text-app-warning',
  Caution: 'text-app-warning',
  Information: 'text-app-info',
};

export default function SopSectionEditor({ section, isDraft, onSave, saving }) {
  // Fresh sections (no items) start open so the user sees the Add button immediately
  const [open, setOpen] = useState(isDraft && (section.contentItems || []).length === 0);
  const [editingIndex, setEditingIndex] = useState(null); // null = adding new
  const [showAddForm, setShowAddForm] = useState(false);

  const items = section.contentItems || [];

  const handleSaveItem = async (itemData) => {
    let updated;
    if (editingIndex !== null) {
      updated = items.map((it, i) => i === editingIndex ? { ...it, ...itemData } : it);
    } else {
      updated = [...items, { ...itemData, sortOrder: items.length }];
    }
    updated = updated.map((it, i) => ({ ...it, sortOrder: i }));
    await onSave(section.id, updated);
    setEditingIndex(null);
    setShowAddForm(false);
  };

  const handleDelete = async (index) => {
    const updated = items.filter((_, i) => i !== index).map((it, i) => ({ ...it, sortOrder: i }));
    await onSave(section.id, updated);
    if (editingIndex === index) { setEditingIndex(null); setShowAddForm(false); }
  };

  const handleReorder = async (index, dir) => {
    const swap = index + dir;
    if (swap < 0 || swap >= items.length) return;
    const updated = [...items];
    [updated[index], updated[swap]] = [updated[swap], updated[index]];
    await onSave(section.id, updated.map((it, i) => ({ ...it, sortOrder: i })));
  };

  const startAdd = () => {
    setEditingIndex(null);
    setShowAddForm(true);
    if (!open) setOpen(true);
  };

  const startEdit = (index) => {
    setEditingIndex(index);
    setShowAddForm(false);
  };

  const cancelEdit = () => {
    setEditingIndex(null);
    setShowAddForm(false);
  };

  const emptyWarning = isDraft && items.length === 0;

  return (
    <div className={`bg-app-card border rounded-xl mb-3 overflow-hidden transition-colors ${emptyWarning && open ? 'border-app-warning/50' : 'border-app-border'}`}>
      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-app-elevated/50 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-xs font-bold text-app-text-muted uppercase tracking-widest">{section.title}</span>
          {emptyWarning && (
            <span className="text-xs px-2 py-0.5 bg-app-warning-bg text-app-warning rounded-full font-medium flex items-center gap-1">
              <AlertTriangle size={9} /> Empty
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-app-text-muted">{items.length} item{items.length !== 1 ? 's' : ''}</span>
          {isDraft && (
            <button
              onClick={e => { e.stopPropagation(); startAdd(); }}
              className="px-2.5 py-1 bg-app-accent text-app-accent-text rounded-lg text-xs font-medium flex items-center gap-1 hover:opacity-90"
            >
              <Plus size={11} /> Add
            </button>
          )}
          {open ? <ChevronUp size={14} className="text-app-text-muted ml-1" /> : <ChevronDown size={14} className="text-app-text-muted ml-1" />}
        </div>
      </button>

      {open && (
        <div className="border-t border-app-divider px-5 py-4 space-y-2">
          {/* Add form at top when adding */}
          {showAddForm && (
            <SopItemEditor
              item={null}
              sectionType={section.sectionType}
              onSave={handleSaveItem}
              onCancel={cancelEdit}
            />
          )}

          {items.length === 0 && !showAddForm && (
            <p className="text-sm text-app-text-muted italic py-1">
              {isDraft ? 'No items yet. Click Add to create the first one.' : 'No content in this section.'}
            </p>
          )}

          {items.map((item, idx) => {
            const isEditing = editingIndex === idx;
            if (isEditing) {
              return (
                <SopItemEditor
                  key={idx}
                  item={item}
                  sectionType={section.sectionType}
                  onSave={handleSaveItem}
                  onCancel={cancelEdit}
                  onDelete={() => handleDelete(idx)}
                />
              );
            }
            return (
              <SopItemRow
                key={idx}
                item={item}
                index={idx}
                total={items.length}
                isDraft={isDraft}
                onEdit={() => startEdit(idx)}
                onDelete={() => handleDelete(idx)}
                onReorder={handleReorder}
                saving={saving}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function SopItemRow({ item, index, total, isDraft, onEdit, onDelete, onReorder, saving }) {
  const Icon = ICON_MAP[item.contentType] || FileText;
  const typeDef = CONTENT_TYPES.find(t => t.value === item.contentType);
  const sevColor = item.metadata?.severity ? (SEV_COLORS[item.metadata.severity] || 'text-app-text-2') : null;

  return (
    <div className="border border-app-border rounded-lg px-3 py-2.5 group hover:border-app-accent/40 transition-colors">
      <div className="flex items-start gap-2.5">
        <Icon size={14} className={`flex-shrink-0 mt-0.5 ${sevColor || 'text-app-text-muted'}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-app-text">{item.title || <em className="text-app-text-muted">Untitled</em>}</span>
            {typeDef && (
              <span className="text-xs px-1.5 py-0.5 bg-app-disabled text-app-text-muted rounded font-medium">{typeDef.label}</span>
            )}
            {item.isCritical && <span className="text-xs text-app-danger font-semibold">Critical</span>}
            {item.isRequired && <span className="text-xs text-app-info font-medium">Required</span>}
          </div>
          {item.body && <p className="text-xs text-app-text-2 mt-0.5 line-clamp-2">{item.body}</p>}
          {item.metadata?.quantity && (
            <p className="text-xs text-app-text-muted mt-0.5">Qty: {item.metadata.quantity}</p>
          )}
        </div>

        {isDraft && (
          <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => onReorder(index, -1)} disabled={index === 0 || saving} className="icon-btn text-app-text-muted hover:text-app-text disabled:opacity-25" style={{minWidth:28,minHeight:28}}>
              <ArrowUp size={12} />
            </button>
            <button onClick={() => onReorder(index, 1)} disabled={index === total - 1 || saving} className="icon-btn text-app-text-muted hover:text-app-text disabled:opacity-25" style={{minWidth:28,minHeight:28}}>
              <ArrowDown size={12} />
            </button>
            <button onClick={onEdit} className="icon-btn text-app-accent hover:opacity-80" style={{minWidth:28,minHeight:28}}>
              <Pencil size={13} />
            </button>
            <button onClick={onDelete} disabled={saving} className="icon-btn text-app-danger hover:opacity-80 disabled:opacity-40" style={{minWidth:28,minHeight:28}}>
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}