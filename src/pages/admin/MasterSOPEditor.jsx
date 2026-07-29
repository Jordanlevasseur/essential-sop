import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { ArrowLeft, Save, Send, Archive, Copy, Trash2, Plus, Pencil, History, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';

const SECTION_ORDER = ['tools', 'materials', 'scope', 'procedure', 'safety', 'quality'];
const SECTION_TITLES = { tools: 'Tools', materials: 'Materials', scope: 'Scope', procedure: 'Procedure', safety: 'Safety', quality: 'Quality Standards' };

export default function MasterSOPEditor() {
  const { masterId } = useParams();
  const navigate = useNavigate();
  const [master, setMaster] = useState(null);
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [versions, setVersions] = useState([]);
  const [editingMeta, setEditingMeta] = useState(false);
  const [metaFields, setMetaFields] = useState({ title: '', category: '', trade: '', description: '' });
  const [activeSection, setActiveSection] = useState(null);
  const [editingItem, setEditingItem] = useState(null); // { sectionId, index } | null
  const [itemDraft, setItemDraft] = useState({ title: '', body: '' });
  const [changeNotes, setChangeNotes] = useState('');
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke('manageMasterSOP', { action: 'get', masterId });
      const { master: m, sections: s } = res.data;
      setMaster(m);
      setSections(s || []);
      setMetaFields({ title: m.title, category: m.category || '', trade: m.trade || '', description: m.description || '' });
    } catch (e) {
      alert('Failed to load: ' + e.message);
      navigate('/admin/master-library');
    }
    setLoading(false);
  }, [masterId]);

  useEffect(() => { load(); }, [load]);

  const loadHistory = async () => {
    const res = await base44.functions.invoke('manageMasterSOP', { action: 'get_history', masterId });
    setVersions(res.data?.versions || []);
    setShowHistory(true);
  };

  const saveMeta = async () => {
    setSaving(true);
    await base44.functions.invoke('manageMasterSOP', { action: 'update_draft', masterId, fields: metaFields });
    await load();
    setEditingMeta(false);
    setSaving(false);
  };

  const saveSection = async (sectionId, contentItems) => {
    setSaving(true);
    await base44.functions.invoke('manageMasterSOP', { action: 'update_draft', masterId, sectionId, contentItems });
    setSections(prev => prev.map(s => s.id === sectionId ? { ...s, contentItems } : s));
    setSaving(false);
  };

  const addItem = async (sectionId) => {
    const section = sections.find(s => s.id === sectionId);
    if (!section) return;
    const items = [...(section.contentItems || []), { title: '', body: '', sortOrder: (section.contentItems || []).length }];
    await saveSection(sectionId, items);
    setEditingItem({ sectionId, index: items.length - 1 });
    setItemDraft({ title: '', body: '' });
  };

  const commitItem = async () => {
    if (!editingItem) return;
    const { sectionId, index } = editingItem;
    const section = sections.find(s => s.id === sectionId);
    if (!section) return;
    const items = [...(section.contentItems || [])];
    items[index] = { ...items[index], ...itemDraft };
    await saveSection(sectionId, items);
    setEditingItem(null);
  };

  const deleteItem = async (sectionId, index) => {
    const section = sections.find(s => s.id === sectionId);
    if (!section) return;
    const items = (section.contentItems || []).filter((_, i) => i !== index).map((item, i) => ({ ...item, sortOrder: i }));
    await saveSection(sectionId, items);
  };

  const handlePublish = async () => {
    setSaving(true);
    try {
      await base44.functions.invoke('manageMasterSOP', { action: 'publish', masterId, changeNotes });
      await load();
      setShowPublishConfirm(false);
      setChangeNotes('');
    } catch (e) {
      alert('Publish failed: ' + e.message);
    }
    setSaving(false);
  };

  const handleArchive = async () => {
    if (!confirm('Archive this SOP? It will no longer be available for provisioning.')) return;
    await base44.functions.invoke('manageMasterSOP', { action: 'archive', masterId });
    navigate('/admin/master-library');
  };

  const handleDelete = async () => {
    if (!confirm('Permanently delete this Draft SOP and all its content?')) return;
    await base44.functions.invoke('manageMasterSOP', { action: 'delete_draft', masterId });
    navigate('/admin/master-library');
  };

  const handleDuplicate = async () => {
    const res = await base44.functions.invoke('manageMasterSOP', { action: 'duplicate', masterId });
    const dup = res.data?.master;
    if (dup) navigate(`/admin/master-library/${dup.id}`);
  };

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen bg-app-bg">
      <div className="w-8 h-8 border-4 border-app-border border-t-app-accent rounded-full animate-spin" />
    </div>
  );

  const isDraft = master?.status === 'draft';
  const isActive = master?.status === 'active';

  return (
    <div className="min-h-screen bg-app-bg">
      {/* Header */}
      <div className="bg-app-surface border-b border-app-border sticky top-0 z-40 px-6 py-3">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <button onClick={() => navigate('/admin/master-library')} className="icon-btn text-app-text-2"><ArrowLeft size={20} /></button>
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold text-app-text truncate">{master?.title}</h1>
            <p className="text-xs text-app-text-muted capitalize">{master?.status === 'active' ? 'Published' : master?.status}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={loadHistory} className="px-3 py-1.5 border border-app-border rounded-lg text-xs text-app-text-2 flex items-center gap-1.5 hover:border-app-accent">
              <History size={13} /> History
            </button>
            <button onClick={handleDuplicate} className="px-3 py-1.5 border border-app-border rounded-lg text-xs text-app-text-2 flex items-center gap-1.5 hover:border-app-accent">
              <Copy size={13} /> Duplicate
            </button>
            {isDraft && (
              <>
                <button onClick={handleDelete} className="px-3 py-1.5 border border-app-danger/40 rounded-lg text-xs text-app-danger flex items-center gap-1.5">
                  <Trash2 size={13} /> Delete
                </button>
                <button onClick={() => setShowPublishConfirm(true)} className="px-4 py-1.5 bg-app-accent text-app-accent-text rounded-lg text-xs font-semibold flex items-center gap-1.5">
                  <Send size={13} /> Publish
                </button>
              </>
            )}
            {(isActive || master?.status === 'archived') && (
              <button onClick={handleArchive} disabled={master?.status === 'archived'}
                className="px-3 py-1.5 border border-app-border rounded-lg text-xs text-app-text-2 flex items-center gap-1.5 disabled:opacity-40">
                <Archive size={13} /> Archive
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6">
        {/* Meta */}
        <div className="bg-app-card border border-app-border rounded-xl p-5 mb-6">
          {editingMeta && isDraft ? (
            <div className="space-y-3">
              <input value={metaFields.title} onChange={e => setMetaFields(p => ({ ...p, title: e.target.value }))}
                className="w-full px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text focus:outline-none focus:border-app-accent" placeholder="Title *" />
              <div className="flex gap-2">
                <input value={metaFields.trade} onChange={e => setMetaFields(p => ({ ...p, trade: e.target.value }))}
                  className="flex-1 px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text focus:outline-none focus:border-app-accent" placeholder="Trade" />
                <input value={metaFields.category} onChange={e => setMetaFields(p => ({ ...p, category: e.target.value }))}
                  className="flex-1 px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text focus:outline-none focus:border-app-accent" placeholder="Category" />
              </div>
              <textarea value={metaFields.description} onChange={e => setMetaFields(p => ({ ...p, description: e.target.value }))}
                rows={2} className="w-full px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text focus:outline-none focus:border-app-accent" placeholder="Description (optional)" />
              <div className="flex gap-2">
                <button onClick={saveMeta} disabled={saving || !metaFields.title.trim()}
                  className="px-4 py-1.5 bg-app-accent text-app-accent-text rounded-lg text-sm font-medium disabled:opacity-50">
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button onClick={() => setEditingMeta(false)} className="px-4 py-1.5 border border-app-border rounded-lg text-sm text-app-text-2">Cancel</button>
              </div>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-app-text mb-1">{master?.title}</h2>
                <p className="text-xs text-app-accent font-medium mb-1">{[master?.trade, master?.category].filter(Boolean).join(' · ')}</p>
                {master?.description && <p className="text-sm text-app-text-2">{master.description}</p>}
              </div>
              {isDraft && (
                <button onClick={() => setEditingMeta(true)} className="px-3 py-1.5 border border-app-border rounded-lg text-xs text-app-text-2 flex items-center gap-1 flex-shrink-0">
                  <Pencil size={12} /> Edit
                </button>
              )}
            </div>
          )}
        </div>

        {!isDraft && (
          <div className="mb-4 px-4 py-3 bg-app-info-bg border border-app-info/30 rounded-xl text-sm text-app-info flex items-center gap-2">
            <AlertTriangle size={14} /> This version is published and read-only. Duplicate it to create a new editable draft.
          </div>
        )}

        {/* Sections */}
        {SECTION_ORDER.map(st => {
          const section = sections.find(s => s.sectionType === st);
          if (!section) return null;
          const items = section.contentItems || [];
          const isOpen = activeSection === section.id;
          return (
            <div key={st} className="bg-app-card border border-app-border rounded-xl mb-3 overflow-hidden">
              <button onClick={() => setActiveSection(isOpen ? null : section.id)}
                className="w-full flex items-center justify-between px-5 py-4 text-left">
                <span className="text-xs font-bold text-app-text-muted uppercase tracking-widest">{SECTION_TITLES[st]}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-app-text-muted">{items.length} item{items.length !== 1 ? 's' : ''}</span>
                  {isOpen ? <ChevronUp size={14} className="text-app-text-muted" /> : <ChevronDown size={14} className="text-app-text-muted" />}
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-app-divider px-5 py-4 space-y-3">
                  {items.length === 0 && <p className="text-sm text-app-text-muted italic">No items yet.</p>}
                  {items.map((item, idx) => {
                    const isEditing = editingItem?.sectionId === section.id && editingItem?.index === idx;
                    return (
                      <div key={idx} className="border border-app-border rounded-lg p-3">
                        {isEditing ? (
                          <div className="space-y-2">
                            <input value={itemDraft.title} onChange={e => setItemDraft(p => ({ ...p, title: e.target.value }))}
                              placeholder="Title *"
                              className="w-full px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text focus:outline-none focus:border-app-accent" />
                            <textarea value={itemDraft.body} onChange={e => setItemDraft(p => ({ ...p, body: e.target.value }))}
                              rows={3} placeholder="Body / notes (optional)"
                              className="w-full px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text focus:outline-none focus:border-app-accent" />
                            <div className="flex gap-2">
                              <button onClick={commitItem} disabled={saving || !itemDraft.title.trim()}
                                className="px-3 py-1 bg-app-accent text-app-accent-text rounded text-xs font-medium disabled:opacity-50">Save</button>
                              <button onClick={() => setEditingItem(null)} className="px-3 py-1 border border-app-border rounded text-xs text-app-text-2">Cancel</button>
                              <button onClick={() => { deleteItem(section.id, idx); setEditingItem(null); }} className="px-3 py-1 border border-app-danger/40 rounded text-xs text-app-danger ml-auto">Delete</button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-medium text-app-text">{item.title || <span className="italic text-app-text-muted">Untitled</span>}</p>
                              {item.body && <p className="text-xs text-app-text-2 mt-0.5">{item.body}</p>}
                            </div>
                            {isDraft && (
                              <button onClick={() => { setEditingItem({ sectionId: section.id, index: idx }); setItemDraft({ title: item.title || '', body: item.body || '' }); }}
                                className="flex-shrink-0 p-1 text-app-text-muted hover:text-app-accent">
                                <Pencil size={13} />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {isDraft && (
                    <button onClick={() => addItem(section.id)} disabled={saving}
                      className="w-full py-2 border-2 border-dashed border-app-border rounded-lg text-xs text-app-text-muted flex items-center justify-center gap-1.5 hover:border-app-accent hover:text-app-accent transition-colors">
                      <Plus size={13} /> Add Item
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Version History panel */}
      {showHistory && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4" onClick={() => setShowHistory(false)}>
          <div className="bg-app-surface rounded-2xl w-full max-w-lg max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-app-border flex items-center justify-between">
              <h3 className="font-semibold text-app-text">Version History</h3>
              <button onClick={() => setShowHistory(false)} className="text-app-text-muted text-sm">Close</button>
            </div>
            <div className="overflow-y-auto px-5 py-4 space-y-3">
              {versions.length === 0 ? (
                <p className="text-sm text-app-text-muted text-center py-4">No published versions yet.</p>
              ) : versions.map(v => (
                <div key={v.id} className="border border-app-border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-semibold text-sm text-app-text">Version {v.versionNumber}</span>
                    <span className="text-xs text-app-text-muted">{v.publishedAt ? new Date(v.publishedAt).toLocaleDateString() : '—'}</span>
                  </div>
                  <p className="text-xs text-app-text-muted">Published by: {v.publishedBy}</p>
                  {v.changeNotes && <p className="text-xs text-app-text-2 mt-1">{v.changeNotes}</p>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Publish confirm */}
      {showPublishConfirm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setShowPublishConfirm(false)}>
          <div className="bg-app-surface rounded-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-app-text mb-2">Publish this SOP?</h3>
            <p className="text-sm text-app-text-2 mb-4">Publishing creates an immutable version. The SOP can still be edited by creating a new draft.</p>
            <textarea value={changeNotes} onChange={e => setChangeNotes(e.target.value)}
              rows={2} placeholder="Change notes (optional)"
              className="w-full mb-4 px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text focus:outline-none focus:border-app-accent" />
            <div className="flex gap-2">
              <button onClick={handlePublish} disabled={saving}
                className="flex-1 py-2.5 bg-app-accent text-app-accent-text rounded-lg text-sm font-semibold disabled:opacity-50">
                {saving ? 'Publishing…' : 'Publish'}
              </button>
              <button onClick={() => setShowPublishConfirm(false)} className="flex-1 py-2.5 border border-app-border rounded-lg text-sm text-app-text-2">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}