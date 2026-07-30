/**
 * MasterSOPEditor — Edit 5F
 *
 * Phases delivered:
 *  1 — Rich section/item editor (content types, metadata fields)
 *  2 — Autosave + draft recovery (localStorage)
 *  3 — Version impact preview (in publish dialog)
 *  4 — Structured change summary on publish
 *  5 — Publish validation (errors block, warnings inform)
 *  6 — Version timeline (replaces history modal)
 *  7 — Version comparison (side-by-side)
 *  8 — Rollback (creates new version from old snapshot)
 *  9 — UX polish throughout
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import {
  ArrowLeft, Save, Send, Archive, Copy, Trash2,
  History, AlertTriangle, CheckCircle2, Clock, Pencil,
} from 'lucide-react';
import SopSectionEditor from '@/components/admin/sop/SopSectionEditor';
import SopPublishDialog from '@/components/admin/sop/SopPublishDialog';
import SopVersionTimeline from '@/components/admin/sop/SopVersionTimeline';
import SopVersionCompare from '@/components/admin/sop/SopVersionCompare';
import { saveDraft, readDraft, clearDraft, hasFresherDraft } from '@/components/admin/sop/SopAutosave';
import { validateForPublish } from '@/components/admin/sop/SopPublishValidation';

const SECTION_ORDER = ['tools', 'materials', 'scope', 'procedure', 'safety', 'quality'];
const SECTION_TITLES = { tools: 'Tools', materials: 'Materials', scope: 'Scope', procedure: 'Procedure', safety: 'Safety', quality: 'Quality Standards' };

// Autosave interval — 30 seconds after last change
const AUTOSAVE_DELAY_MS = 30_000;

export default function MasterSOPEditor() {
  const { masterId } = useParams();
  const navigate = useNavigate();

  const [master, setMaster] = useState(null);
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // Meta editing
  const [editingMeta, setEditingMeta] = useState(false);
  const [metaFields, setMetaFields] = useState({ title: '', category: '', trade: '', description: '' });

  // Dirty / autosave state
  const [isDirty, setIsDirty] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [draftRestored, setDraftRestored] = useState(false);
  const [showDraftBanner, setShowDraftBanner] = useState(false);
  const autosaveTimerRef = useRef(null);

  // Panels
  const [showTimeline, setShowTimeline] = useState(false);
  const [versions, setVersions] = useState([]);
  const [compareVersions, setCompareVersions] = useState(null); // { a, b }
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState(null);
  const [publishSuccess, setPublishSuccess] = useState(false);

  // ── Load ───────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setSaveError(null);
    try {
      const res = await base44.functions.invoke('manageMasterSOP', { action: 'get', masterId });
      const { master: m, sections: s } = res.data;
      setMaster(m);
      setSections(s || []);
      setMetaFields({ title: m.title, category: m.category || '', trade: m.trade || '', description: m.description || '' });

      // Check for a fresher local draft
      if (m.status === 'draft' && hasFresherDraft(masterId, m.updatedAt)) {
        setShowDraftBanner(true);
      }
    } catch (e) {
      setSaveError('Failed to load SOP: ' + e.message);
      navigate('/admin/master-library');
    }
    setLoading(false);
  }, [masterId]);

  useEffect(() => { load(); }, [load]);

  const loadVersionHistory = async () => {
    const res = await base44.functions.invoke('manageMasterSOP', { action: 'get_history', masterId });
    setVersions(res.data?.versions || []);
  };

  const openTimeline = async () => {
    await loadVersionHistory();
    setShowTimeline(true);
  };

  // ── Autosave to localStorage ───────────────────────────────────────────────
  const scheduleAutosave = useCallback((updatedSections, updatedMeta) => {
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      saveDraft(masterId, {
        sections: updatedSections,
        metaFields: updatedMeta,
        serverUpdatedAt: master?.updatedAt,
      });
      setLastSaved(new Date());
    }, AUTOSAVE_DELAY_MS);
    setIsDirty(true);
  }, [masterId, master?.updatedAt]);

  useEffect(() => {
    return () => { if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current); };
  }, []);

  // ── Restore local draft ────────────────────────────────────────────────────
  const restoreDraft = () => {
    const draft = readDraft(masterId);
    if (!draft) return;
    if (draft.sections) setSections(draft.sections);
    if (draft.metaFields) setMetaFields(draft.metaFields);
    setDraftRestored(true);
    setShowDraftBanner(false);
    setIsDirty(true);
  };

  const discardDraft = () => {
    clearDraft(masterId);
    setShowDraftBanner(false);
  };

  // ── Save section to server ─────────────────────────────────────────────────
  const saveSection = useCallback(async (sectionId, contentItems) => {
    setSaving(true);
    setSaveError(null);
    try {
      await base44.functions.invoke('manageMasterSOP', {
        action: 'update_draft',
        masterId,
        sectionId,
        contentItems,
      });
      setSections(prev => prev.map(s => s.id === sectionId ? { ...s, contentItems } : s));
      clearDraft(masterId);
      setIsDirty(false);
      setLastSaved(new Date());
    } catch (e) {
      setSaveError('Save failed: ' + e.message);
      // Keep local draft
      saveDraft(masterId, { sections, metaFields, serverUpdatedAt: master?.updatedAt });
    }
    setSaving(false);
  }, [masterId, sections, metaFields, master?.updatedAt]);

  const saveSectionWithAutosave = useCallback(async (sectionId, contentItems) => {
    const updated = sections.map(s => s.id === sectionId ? { ...s, contentItems } : s);
    scheduleAutosave(updated, metaFields);
    return saveSection(sectionId, contentItems);
  }, [sections, metaFields, scheduleAutosave, saveSection]);

  // ── Save meta ──────────────────────────────────────────────────────────────
  const saveMeta = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await base44.functions.invoke('manageMasterSOP', {
        action: 'update_draft',
        masterId,
        fields: metaFields,
      });
      const updated = await base44.functions.invoke('manageMasterSOP', { action: 'get', masterId });
      setMaster(updated.data.master);
      clearDraft(masterId);
      setIsDirty(false);
      setLastSaved(new Date());
      setEditingMeta(false);
    } catch (e) {
      setSaveError('Save failed: ' + e.message);
    }
    setSaving(false);
  };

  // ── Publish ────────────────────────────────────────────────────────────────
  const openPublishDialog = () => {
    setPublishError(null);
    setShowPublishDialog(true);
  };

  const handlePublish = async ({ mutationKey, changeSummary }) => {
    setPublishing(true);
    setPublishError(null);
    try {
      await base44.functions.invoke('manageMasterSOP', {
        action: 'publish',
        masterId,
        publicationMutationKey: mutationKey,
        changeSummary,
      });
      clearDraft(masterId);
      setIsDirty(false);
      setShowPublishDialog(false);
      setPublishSuccess(true);
      setTimeout(() => setPublishSuccess(false), 4000);
      await load();
    } catch (e) {
      setPublishError('Publish failed: ' + e.message);
    }
    setPublishing(false);
  };

  // ── Archive / Delete ───────────────────────────────────────────────────────
  const handleArchive = async () => {
    if (!confirm('Archive this SOP? It will no longer be available for provisioning.')) return;
    await base44.functions.invoke('manageMasterSOP', { action: 'archive', masterId });
    navigate('/admin/master-library');
  };

  const handleDelete = async () => {
    if (!confirm('Permanently delete this Draft SOP?')) return;
    await base44.functions.invoke('manageMasterSOP', { action: 'delete_draft', masterId });
    navigate('/admin/master-library');
  };

  const handleDuplicate = async () => {
    const res = await base44.functions.invoke('manageMasterSOP', { action: 'duplicate', masterId });
    const dup = res.data?.master;
    if (dup) navigate(`/admin/master-library/${dup.id}`);
  };

  // ── Rollback ───────────────────────────────────────────────────────────────
  const handleRollback = async (targetVersion) => {
    const mutationKey = `rollback_${masterId}_from_v${targetVersion.versionNumber}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const changeSummary = `Rollback to v${targetVersion.versionNumber} (${new Date().toLocaleDateString()})`;
    await base44.functions.invoke('manageMasterSOP', {
      action: 'rollback_to_version',
      masterId,
      targetVersionId: targetVersion.id,
      publicationMutationKey: mutationKey,
      changeSummary,
    });
    clearDraft(masterId);
    setShowTimeline(false);
    await load();
  };

  // ── Loading / Error states ─────────────────────────────────────────────────
  if (loading) return (
    <div className="flex items-center justify-center min-h-screen bg-app-bg">
      <div className="w-8 h-8 border-4 border-app-border border-t-app-accent rounded-full animate-spin" />
    </div>
  );

  const isDraft = master?.status === 'draft';
  const isActive = master?.status === 'active';
  const validation = isDraft ? validateForPublish(metaFields, sections) : { errors: [], warnings: [], valid: true };

  return (
    <div className="min-h-screen bg-app-bg">
      {/* Sticky header */}
      <div className="bg-app-surface border-b border-app-border sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-6 py-3 flex items-center gap-3">
          <button
            onClick={() => {
              if (isDirty && !confirm('You have unsaved changes. Leave anyway?')) return;
              navigate('/admin/master-library');
            }}
            className="icon-btn text-app-text-2 hover:text-app-text"
          >
            <ArrowLeft size={20} />
          </button>

          <div className="flex-1 min-w-0">
            <h1 className="font-semibold text-app-text truncate">{master?.title}</h1>
            <div className="flex items-center gap-2 text-xs">
              <span className={`capitalize font-medium ${
                master?.status === 'active' ? 'text-app-success' :
                master?.status === 'draft' ? 'text-app-warning' : 'text-app-text-muted'
              }`}>
                {master?.status === 'active' ? 'Published' : master?.status}
              </span>
              {isDirty && <span className="text-app-warning flex items-center gap-1"><Clock size={10} /> Unsaved changes</span>}
              {!isDirty && lastSaved && (
                <span className="text-app-text-muted flex items-center gap-1">
                  <CheckCircle2 size={10} /> Saved {lastSaved.toLocaleTimeString()}
                </span>
              )}
              {saving && <span className="text-app-accent animate-pulse">Saving…</span>}
            </div>
          </div>

          {/* Header actions */}
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <button
              onClick={openTimeline}
              className="px-3 py-1.5 border border-app-border rounded-lg text-xs text-app-text-2 flex items-center gap-1.5 hover:border-app-accent transition-colors"
            >
              <History size={13} /> Timeline
            </button>
            <button
              onClick={handleDuplicate}
              className="px-3 py-1.5 border border-app-border rounded-lg text-xs text-app-text-2 flex items-center gap-1.5 hover:border-app-accent transition-colors"
            >
              <Copy size={13} /> Duplicate
            </button>
            {isDraft && (
              <>
                <button
                  onClick={handleDelete}
                  className="px-3 py-1.5 border border-app-danger/40 rounded-lg text-xs text-app-danger flex items-center gap-1.5 hover:bg-app-danger-bg transition-colors"
                >
                  <Trash2 size={13} /> Delete
                </button>
                <button
                  onClick={openPublishDialog}
                  disabled={saving}
                  className="px-4 py-1.5 bg-app-accent text-app-accent-text rounded-lg text-xs font-semibold flex items-center gap-1.5 hover:opacity-90 disabled:opacity-50 relative"
                >
                  <Send size={13} /> Publish
                  {validation.errors.length > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-app-danger text-white rounded-full text-[10px] flex items-center justify-center font-bold">
                      {validation.errors.length}
                    </span>
                  )}
                </button>
              </>
            )}
            {(isActive || master?.status === 'archived') && (
              <button
                onClick={handleArchive}
                disabled={master?.status === 'archived'}
                className="px-3 py-1.5 border border-app-border rounded-lg text-xs text-app-text-2 flex items-center gap-1.5 disabled:opacity-40"
              >
                <Archive size={13} /> Archive
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6">
        {/* Publish success toast */}
        {publishSuccess && (
          <div className="mb-4 flex items-center gap-2 p-3.5 bg-app-success-bg border border-app-success/30 rounded-xl text-sm text-app-success font-medium">
            <CheckCircle2 size={16} /> Version published successfully!
          </div>
        )}

        {/* Save error */}
        {saveError && (
          <div className="mb-4 flex items-center gap-2 p-3.5 bg-app-danger-bg border border-app-danger/30 rounded-xl text-sm text-app-danger">
            <AlertTriangle size={16} /> {saveError}
          </div>
        )}

        {/* Draft recovery banner */}
        {showDraftBanner && (
          <div className="mb-4 p-4 bg-app-warning-bg border border-app-warning/30 rounded-xl">
            <div className="flex items-start gap-3">
              <Clock size={16} className="text-app-warning flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-app-text mb-1">Unfinished draft found</p>
                <p className="text-xs text-app-text-2 mb-3">
                  A locally saved draft is newer than the server version. Would you like to restore it?
                </p>
                <div className="flex gap-2">
                  <button onClick={restoreDraft} className="px-3 py-1.5 bg-app-warning text-white rounded-lg text-xs font-semibold">
                    Restore Draft
                  </button>
                  <button onClick={discardDraft} className="px-3 py-1.5 border border-app-border rounded-lg text-xs text-app-text-2">
                    Discard
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {draftRestored && (
          <div className="mb-4 flex items-center gap-2 p-3 bg-app-info-bg border border-app-info/20 rounded-xl text-xs text-app-info">
            <CheckCircle2 size={13} /> Local draft restored. Save to commit these changes to the server.
          </div>
        )}

        {/* Read-only notice */}
        {!isDraft && (
          <div className="mb-4 px-4 py-3 bg-app-info-bg border border-app-info/30 rounded-xl text-sm text-app-info flex items-center gap-2">
            <AlertTriangle size={14} /> This version is published and read-only. Duplicate it to create a new editable draft.
          </div>
        )}

        {/* Meta card */}
        <div className="bg-app-card border border-app-border rounded-xl p-5 mb-6">
          {editingMeta && isDraft ? (
            <div className="space-y-3">
              <input
                value={metaFields.title}
                onChange={e => { setMetaFields(p => ({ ...p, title: e.target.value })); scheduleAutosave(sections, { ...metaFields, title: e.target.value }); }}
                className="w-full px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text focus:outline-none focus:border-app-accent"
                placeholder="Title *"
              />
              <div className="flex gap-2">
                <input
                  value={metaFields.trade}
                  onChange={e => setMetaFields(p => ({ ...p, trade: e.target.value }))}
                  className="flex-1 px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text focus:outline-none focus:border-app-accent"
                  placeholder="Trade"
                />
                <input
                  value={metaFields.category}
                  onChange={e => setMetaFields(p => ({ ...p, category: e.target.value }))}
                  className="flex-1 px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text focus:outline-none focus:border-app-accent"
                  placeholder="Category"
                />
              </div>
              <textarea
                value={metaFields.description}
                onChange={e => setMetaFields(p => ({ ...p, description: e.target.value }))}
                rows={2}
                className="w-full px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text focus:outline-none focus:border-app-accent"
                placeholder="Description (optional)"
              />
              <div className="flex gap-2">
                <button
                  onClick={saveMeta}
                  disabled={saving || !metaFields.title.trim()}
                  className="px-4 py-1.5 bg-app-accent text-app-accent-text rounded-lg text-sm font-medium disabled:opacity-50"
                >
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
                {isActive && master?.currentPublishedVersionId && (
                  <p className="text-xs text-app-text-muted mt-2 flex items-center gap-1">
                    <CheckCircle2 size={11} className="text-app-success" />
                    Published version active
                  </p>
                )}
              </div>
              {isDraft && (
                <button
                  onClick={() => setEditingMeta(true)}
                  className="px-3 py-1.5 border border-app-border rounded-lg text-xs text-app-text-2 flex items-center gap-1 flex-shrink-0 hover:border-app-accent transition-colors"
                >
                  <Pencil size={12} /> Edit
                </button>
              )}
            </div>
          )}
        </div>

        {/* Validation summary (non-blocking — shown inline on draft) */}
        {isDraft && validation.errors.length > 0 && (
          <div className="mb-4 p-3.5 bg-app-danger-bg border border-app-danger/20 rounded-xl space-y-1.5">
            <p className="text-xs font-bold text-app-danger uppercase tracking-wide">Publishing Blocked — Fix Required</p>
            {validation.errors.map((e, i) => (
              <div key={i} className="flex items-start gap-2 text-xs text-app-danger">
                <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
                <span>{e}</span>
              </div>
            ))}
          </div>
        )}

        {/* Sections */}
        {SECTION_ORDER.map(st => {
          const section = sections.find(s => s.sectionType === st);
          if (!section) return null;
          return (
            <SopSectionEditor
              key={st}
              section={section}
              isDraft={isDraft}
              onSave={saveSectionWithAutosave}
              saving={saving}
            />
          );
        })}
      </div>

      {/* Publish dialog */}
      {showPublishDialog && (
        <SopPublishDialog
          master={master}
          draftSections={sections}
          validation={validation}
          publishing={publishing}
          onPublish={handlePublish}
          onClose={() => setShowPublishDialog(false)}
        />
      )}

      {/* Version timeline */}
      {showTimeline && (
        <SopVersionTimeline
          master={master}
          versions={versions}
          currentVersionId={master?.currentPublishedVersionId}
          onClose={() => setShowTimeline(false)}
          onRollback={handleRollback}
          onCompare={(vA, vB) => {
            setCompareVersions({ a: vA, b: vB });
            setShowTimeline(false);
          }}
        />
      )}

      {/* Version compare */}
      {compareVersions && (
        <SopVersionCompare
          master={master}
          versionA={compareVersions.a}
          versionB={compareVersions.b}
          onClose={() => setCompareVersions(null)}
        />
      )}
    </div>
  );
}