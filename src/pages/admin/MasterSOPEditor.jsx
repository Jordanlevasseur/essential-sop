/**
 * MasterSOPEditor — Edit 5F Final Hardening
 *
 * Autosave architecture:
 *   Editor change → immediate localStorage copy → 3s debounce → server save (with draftRevision)
 *
 * Save states: Saved | Saving… | Unsaved changes | Save failed | Conflict detected | Offline — saved locally | Restored from local recovery
 *
 * Concurrency: sends expectedDraftRevision on every server save; handles DRAFT_CONFLICT.
 * Flush: pending debounce is flushed before publish and before intentional navigation.
 * Server validation: enforced on publish (server returns structured errors).
 * Rollback: idempotent via publicationMutationKey; retries safe.
 * logicalItemIds: never regenerated on edit/reorder/autosave/restore.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import {
  ArrowLeft, Save, Send, Archive, Copy, Trash2,
  History, AlertTriangle, CheckCircle2, Clock, Pencil,
  WifiOff, RefreshCw, GitMerge, X, Sparkles,
} from 'lucide-react';
import SopSectionEditor from '@/components/admin/sop/SopSectionEditor';
import SopPublishDialog from '@/components/admin/sop/SopPublishDialog';
import SopVersionTimeline from '@/components/admin/sop/SopVersionTimeline';
import SopVersionCompare from '@/components/admin/sop/SopVersionCompare';
import { saveDraft, readDraft, clearDraft, assessDraftRecovery } from '@/components/admin/sop/SopAutosave';
import { validateForPublish } from '@/components/admin/sop/SopPublishValidation';

const SECTION_ORDER = ['tools', 'materials', 'scope', 'procedure', 'safety', 'quality'];
const SECTION_TITLES = { tools: 'Tools', materials: 'Materials', scope: 'Scope', procedure: 'Procedure', safety: 'Safety', quality: 'Quality Standards' };

// Debounce delay — server save fires 3s after the last change
const SERVER_SAVE_DEBOUNCE_MS = 3_000;

// Save status values
const STATUS = {
  IDLE: 'idle',
  DIRTY: 'dirty',         // unsaved local changes
  SAVING: 'saving',       // in-flight to server
  SAVED: 'saved',         // server confirmed
  FAILED: 'failed',       // server save failed
  CONFLICT: 'conflict',   // DRAFT_CONFLICT from server
  OFFLINE: 'offline',     // network unavailable, local only
};

export default function MasterSOPEditor() {
  const { masterId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  // AI-generated draft indicator — set when the editor is opened from the
  // AI Builder via location.state.isAiDraft. Purely visual; no logic impact.
  const [isAiDraft, setIsAiDraft] = useState(() => location.state?.isAiDraft === true);

  const [master, setMaster] = useState(null);
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState(null);

  // Meta editing
  const [editingMeta, setEditingMeta] = useState(false);
  const [metaFields, setMetaFields] = useState({ title: '', category: '', trade: '', description: '', tags: [] });
  const [tagInput, setTagInput] = useState('');

  // Save state
  const [saveStatus, setSaveStatus] = useState(STATUS.IDLE);
  const [saveError, setSaveError] = useState(null);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [draftRevision, setDraftRevision] = useState(0); // client-tracked server revision
  // Ref mirror of draftRevision — always current, safe to read inside callbacks without stale closure
  const draftRevisionRef = useRef(0);

  // Conflict state
  const [conflictData, setConflictData] = useState(null); // { serverMaster, serverSections, serverRevision }

  // Draft recovery
  const [recoveryCase, setRecoveryCase] = useState(null); // 'local_ahead' | 'server_ahead' | 'conflict' | null
  const [localDraft, setLocalDraft] = useState(null);
  const [showRecoveryBanner, setShowRecoveryBanner] = useState(false);

  // Pending save refs — used for flush-before-publish and flush-before-navigate
  const pendingSaveRef = useRef(null);      // { sections, metaFields, revision } — the current dirty state
  const serverSaveTimerRef = useRef(null);  // debounce timer handle
  const isSavingRef = useRef(false);         // prevents concurrent server save calls
  const savingPromiseRef = useRef(null);     // resolves when the in-flight save finishes

  // Panels
  const [showTimeline, setShowTimeline] = useState(false);
  const [versions, setVersions] = useState([]);
  const [compareVersions, setCompareVersions] = useState(null);
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState(null);
  const [publishSuccess, setPublishSuccess] = useState(false);
  const [serverValidationErrors, setServerValidationErrors] = useState([]);

  // ── Load ─────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setSaveError(null);
    try {
      const [res, me] = await Promise.all([
        base44.functions.invoke('manageMasterSOP', { action: 'get', masterId }),
        base44.auth.me().catch(() => null),
      ]);
      const { master: m, sections: s } = res.data;
      const userId = me?.id || 'unknown';
      setCurrentUserId(userId);
      setMaster(m);
      setSections(s || []);
      setMetaFields({ title: m.title, category: m.category || '', trade: m.trade || '', description: m.description || '', tags: Array.isArray(m.tags) ? m.tags : [] });
      const rev = m.draftRevision ?? 0;
      setDraftRevision(rev);
      draftRevisionRef.current = rev;

      // Assess local draft recovery
      if (m.status === 'draft') {
        const rc = assessDraftRecovery(masterId, userId, rev, m.updatedAt);
        if (rc === 'local_ahead') {
          const draft = readDraft(masterId, userId);
          setLocalDraft(draft);
          setRecoveryCase('local_ahead');
          setShowRecoveryBanner(true);
        } else if (rc === 'server_ahead') {
          // Server is newer — silently use server, no banner needed unless local data exists
          const draft = readDraft(masterId, userId);
          if (draft) {
            setLocalDraft(draft);
            setRecoveryCase('server_ahead');
            setShowRecoveryBanner(true);
          }
        }
        // 'none' and 'in_sync' — no banner
      }
    } catch (e) {
      setSaveError('Failed to load SOP: ' + (e.message || 'Unknown error'));
    }
    setLoading(false);
  }, [masterId]);

  useEffect(() => { load(); }, [load]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (serverSaveTimerRef.current) clearTimeout(serverSaveTimerRef.current);
    };
  }, []);

  // ── Core server save ──────────────────────────────────────────────────────
  // Called by the debounce and by flush(). Never called directly from event handlers.
  const executeServerSave = useCallback(async (snapshot) => {
    if (isSavingRef.current) return; // prevent concurrent saves
    if (!snapshot) return;
    isSavingRef.current = true;
    let resolvePromise;
    savingPromiseRef.current = new Promise(r => { resolvePromise = r; });
    setSaveStatus(STATUS.SAVING);
    setSaveError(null);

    const { sections: snapSections, metaFields: snapMeta, expectedRevision } = snapshot;

    try {
      // Save meta fields
      let latestRevision = expectedRevision;
      const metaRes = await base44.functions.invoke('manageMasterSOP', {
        action: 'update_draft',
        masterId,
        fields: snapMeta,
        expectedDraftRevision: expectedRevision,
      });

      if (metaRes.data?.code === 'REVISION_REQUIRED') {
        setSaveStatus(STATUS.FAILED);
        setSaveError('Save failed: revision sync error. Reloading draft from server…');
        isSavingRef.current = false;
        if (resolvePromise) resolvePromise();
        savingPromiseRef.current = null;
        await load();
        return;
      }
      if (metaRes.data?.code === 'DRAFT_CONFLICT') {
        const conflict = metaRes.data;
        setConflictData({ serverMaster: conflict.serverMaster, serverSections: conflict.serverSections, serverRevision: conflict.serverRevision });
        setSaveStatus(STATUS.CONFLICT);
        isSavingRef.current = false;
        if (resolvePromise) resolvePromise();
        savingPromiseRef.current = null;
        return;
      }
      latestRevision = metaRes.data?.draftRevision ?? latestRevision + 1;

      // Save each section that has content
      for (const section of snapSections) {
        if (!section.id) continue;
        const sectionRes = await base44.functions.invoke('manageMasterSOP', {
          action: 'update_draft',
          masterId,
          sectionId: section.id,
          contentItems: section.contentItems || [],
          expectedDraftRevision: latestRevision,
        });
        if (sectionRes.data?.code === 'REVISION_REQUIRED') {
          setSaveStatus(STATUS.FAILED);
          setSaveError('Save failed: revision sync error. Reloading draft from server…');
          isSavingRef.current = false;
          if (resolvePromise) resolvePromise();
          savingPromiseRef.current = null;
          await load();
          return;
        }
        if (sectionRes.data?.code === 'DRAFT_CONFLICT') {
          const conflict = sectionRes.data;
          setConflictData({ serverMaster: conflict.serverMaster, serverSections: conflict.serverSections, serverRevision: conflict.serverRevision });
          setSaveStatus(STATUS.CONFLICT);
          isSavingRef.current = false;
          if (resolvePromise) resolvePromise();
          savingPromiseRef.current = null;
          return;
        }
        latestRevision = sectionRes.data?.draftRevision ?? latestRevision + 1;
      }

      // Success
      setDraftRevision(latestRevision);
      draftRevisionRef.current = latestRevision;
      setMaster(prev => ({ ...prev, draftRevision: latestRevision, updatedAt: new Date().toISOString() }));
      clearDraft(masterId, currentUserId);
      pendingSaveRef.current = null;
      setSaveStatus(STATUS.SAVED);
      setLastSavedAt(new Date());
    } catch (e) {
      const isNetworkError = !navigator.onLine || e.message?.includes('fetch') || e.message?.includes('network');
      setSaveStatus(isNetworkError ? STATUS.OFFLINE : STATUS.FAILED);
      setSaveError(isNetworkError
        ? 'Offline — work saved locally. Will retry when connected.'
        : 'Save failed: ' + (e.message || 'Unknown error'));
      // localStorage copy already written before the server call — work is safe
    } finally {
      isSavingRef.current = false;
      if (resolvePromise) resolvePromise();
      savingPromiseRef.current = null;
    }
  }, [masterId, currentUserId]);

  // ── Flush pending save (before publish / navigate) ───────────────────────
  const flushPendingSave = useCallback(async () => {
    // Cancel any pending debounce
    if (serverSaveTimerRef.current) {
      clearTimeout(serverSaveTimerRef.current);
      serverSaveTimerRef.current = null;
    }
    // If a save is already in-flight, wait for it to finish first
    if (savingPromiseRef.current) {
      await savingPromiseRef.current;
    }
    // Now execute any remaining pending snapshot
    if (pendingSaveRef.current) {
      await executeServerSave(pendingSaveRef.current);
    }
  }, [executeServerSave]);

  // ── Mark dirty + schedule debounced server save ──────────────────────────
  // Uses draftRevisionRef (not the draftRevision state) to always read the current
  // revision — avoids stale-closure bugs where multiple edits use the same old revision.
  const markDirty = useCallback((updatedSections, updatedMeta) => {
    setSaveStatus(STATUS.DIRTY);
    const currentRevision = draftRevisionRef.current;
    const snapshot = { sections: updatedSections, metaFields: updatedMeta, expectedRevision: currentRevision };
    pendingSaveRef.current = snapshot;

    // Immediately update localStorage for crash safety
    if (currentUserId) {
      saveDraft(masterId, currentUserId, {
        sections: updatedSections,
        metaFields: updatedMeta,
        serverDraftRevision: currentRevision,
        serverUpdatedAt: master?.updatedAt,
      });
    }

    // Schedule debounced server save
    if (serverSaveTimerRef.current) clearTimeout(serverSaveTimerRef.current);
    serverSaveTimerRef.current = setTimeout(() => {
      executeServerSave(snapshot);
    }, SERVER_SAVE_DEBOUNCE_MS);
  }, [masterId, currentUserId, master?.updatedAt, executeServerSave]);

  // ── Manual Save Now ───────────────────────────────────────────────────────
  const handleSaveNow = useCallback(async () => {
    await flushPendingSave();
  }, [flushPendingSave]);

  // ── Section save callback ─────────────────────────────────────────────────
  const handleSectionSave = useCallback((sectionId, contentItems) => {
    const updated = sections.map(s => s.id === sectionId ? { ...s, contentItems } : s);
    setSections(updated);
    markDirty(updated, metaFields);
  }, [sections, metaFields, markDirty]);

  // ── Meta field change ─────────────────────────────────────────────────────
  const handleMetaChange = useCallback((field, value) => {
    const updated = { ...metaFields, [field]: value };
    setMetaFields(updated);
    markDirty(sections, updated);
  }, [metaFields, sections, markDirty]);

  const saveMeta = async () => {
    await flushPendingSave();
    setEditingMeta(false);
    // Refresh master from server after save
    const res = await base44.functions.invoke('manageMasterSOP', { action: 'get', masterId }).catch(() => null);
    if (res?.data?.master) setMaster(res.data.master);
  };

  // ── Recovery actions ──────────────────────────────────────────────────────
  const handleRestoreLocal = () => {
    if (!localDraft) return;
    if (localDraft.sections) setSections(localDraft.sections);
    if (localDraft.metaFields) setMetaFields(localDraft.metaFields);
    setShowRecoveryBanner(false);
    setRecoveryCase(null);
    setSaveStatus(STATUS.DIRTY);
    // Re-schedule a server save immediately for the restored content
    const snapshot = { sections: localDraft.sections || sections, metaFields: localDraft.metaFields || metaFields, expectedRevision: draftRevisionRef.current };
    pendingSaveRef.current = snapshot;
    if (serverSaveTimerRef.current) clearTimeout(serverSaveTimerRef.current);
    serverSaveTimerRef.current = setTimeout(() => executeServerSave(snapshot), SERVER_SAVE_DEBOUNCE_MS);
  };

  const handleUseServerDraft = () => {
    clearDraft(masterId, currentUserId);
    setShowRecoveryBanner(false);
    setRecoveryCase(null);
    setLocalDraft(null);
  };

  // ── Conflict resolution ───────────────────────────────────────────────────
  const handleLoadServerVersion = () => {
    if (!conflictData) return;
    setSections(conflictData.serverSections);
    setDraftRevision(conflictData.serverRevision);
    draftRevisionRef.current = conflictData.serverRevision;
    setMaster(prev => ({ ...prev, ...conflictData.serverMaster }));
    setMetaFields({
      title: conflictData.serverMaster?.title || metaFields.title,
      category: conflictData.serverMaster?.category || '',
      trade: conflictData.serverMaster?.trade || '',
      description: conflictData.serverMaster?.description || '',
    });
    clearDraft(masterId, currentUserId);
    pendingSaveRef.current = null;
    setConflictData(null);
    setSaveStatus(STATUS.SAVED);
  };

  const handleKeepLocalForReview = () => {
    // Preserve local content in state for comparison, update revision to server's
    // but do NOT save — force user to resolve manually
    if (conflictData) {
      setDraftRevision(conflictData.serverRevision);
      draftRevisionRef.current = conflictData.serverRevision;
    }
    setConflictData(null);
    setSaveStatus(STATUS.DIRTY);
  };

  const handleCompareConflict = () => {
    if (!conflictData) return;
    // Build synthetic "version" objects for the compare panel
    setCompareVersions({
      a: { id: '_server', versionNumber: conflictData.serverRevision, label: 'Server Version', _sections: conflictData.serverSections },
      b: { id: '_local', versionNumber: draftRevision, label: 'Your Local Version', _sections: sections },
    });
    setConflictData(null);
  };

  // ── Version timeline ──────────────────────────────────────────────────────
  const openTimeline = async () => {
    const res = await base44.functions.invoke('manageMasterSOP', { action: 'get_history', masterId });
    setVersions(res.data?.versions || []);
    setShowTimeline(true);
  };

  // ── Publish ───────────────────────────────────────────────────────────────
  const openPublishDialog = async () => {
    setServerValidationErrors([]);
    setPublishError(null);
    // Flush first so published version matches what the author sees
    await flushPendingSave();
    setShowPublishDialog(true);
  };

  const handlePublish = async ({ mutationKey, changeSummary, distributionPolicyOverride, selectedCompanyIds, distributionStatus }) => {
    setPublishing(true);
    setPublishError(null);
    setServerValidationErrors([]);
    try {
      const payload = {
        action: 'publish',
        masterId,
        publicationMutationKey: mutationKey,
        changeSummary,
      };
      if (distributionPolicyOverride) payload.distributionPolicyOverride = distributionPolicyOverride;
      if (selectedCompanyIds) payload.selectedCompanyIds = selectedCompanyIds;
      // distributionStatus is NOT trusted server-side: the backend publish action
      // ignores it and publishMasterSOPVersion independently verifies the
      // PERSISTED EssentialSOPMaster.distributionStatus at Step 4. A client field
      // cannot bypass that guard — the authorized mark_customer_available action
      // (called below) is the legitimate way to satisfy it for non-MANUAL policy.
      if (distributionStatus) payload.distributionStatus = distributionStatus;

      // ── Step 1: establish customer_available for non-MANUAL distribution ──
      // For SELECTED_COMPANIES / ALL_EXISTING_AND_FUTURE_COMPANIES we first call
      // the authorized mark_customer_available action and require it to succeed
      // BEFORE publishing. MANUAL / Publish Only skips this and stays as-is.
      const isDistributedPublish =
        distributionPolicyOverride === 'SELECTED_COMPANIES' ||
        distributionPolicyOverride === 'ALL_EXISTING_AND_FUTURE_COMPANIES';

      if (isDistributedPublish) {
        let mkRes;
        try {
          mkRes = await base44.functions.invoke('manageMasterSOP', {
            action: 'mark_customer_available',
            masterId,
          });
        } catch (mkErr) {
          // Availability transition failed — do NOT publish.
          setPublishError('Failed to mark this SOP as customer-available: ' + (mkErr?.message || 'Unknown error'));
          return;
        }
        const mkData = mkRes?.data || {};
        if (!mkData.master) {
          setPublishError(
            mkData.error || mkData.message ||
            (mkData.code ? `Availability transition failed (${mkData.code}).` : 'Failed to mark this SOP as customer-available.')
          );
          return;
        }
      }

      // ── Step 2: existing publish ──────────────────────────────────────────
      const res = await base44.functions.invoke('manageMasterSOP', payload);
      const data = res?.data || {};

      // Backend content/structure validation errors → show in the detail list.
      if (data.code === 'VALIDATION_FAILED' && Array.isArray(data.validationErrors)) {
        setServerValidationErrors(data.validationErrors);
        setPublishError('Server validation blocked publication. See errors below.');
        return; // FAILURE: dialog stays open, selections preserved
      }

      // SUCCESS requires a real published version object from the orchestrator.
      // Any other response (error code such as DISTRIBUTION_STATUS_REQUIRED,
      // a thrown error, or a missing version) is a FAILURE: keep the dialog open,
      // preserve the user's company selections, and surface the backend error.
      if (!data.version) {
        if (Array.isArray(data.validationErrors) && data.validationErrors.length > 0) {
          setServerValidationErrors(data.validationErrors);
        }
        setPublishError(
          data.error || data.message ||
          (data.code ? `Publication rejected (${data.code}).` : 'Publication did not return a published version.')
        );
        return; // FAILURE: dialog stays open, selections preserved
      }

      // ── Confirmed success: a real published version was returned ───────────
      clearDraft(masterId, currentUserId);
      pendingSaveRef.current = null;
      setShowPublishDialog(false);
      setPublishSuccess(true);
      // Navigate immediately to the completed, published Master SOP.
      // (Removed the prior 1.5s delay — no functional purpose; it only delayed
      //  the user landing on the published SOP.)
      if (isPlatform) {
        navigate(`${libraryPath}/${masterId}`);
      } else {
        navigate(libraryPath);
      }
    } catch (e) {
      setPublishError('Publish failed: ' + (e?.message || 'Unknown error'));
      // FAILURE: dialog stays open, selections preserved
    } finally {
      setPublishing(false);
    }
  };

  // ── Archive / Delete ──────────────────────────────────────────────────────
  const handleArchive = async () => {
    if (!confirm('Archive this SOP? It will no longer be available for provisioning.')) return;
    await base44.functions.invoke('manageMasterSOP', { action: 'archive', masterId });
    navigate(libraryPath);
  };

  const handleDelete = async () => {
    if (!confirm('Permanently delete this Draft SOP?')) return;
    await base44.functions.invoke('manageMasterSOP', { action: 'delete_draft', masterId });
    clearDraft(masterId, currentUserId);
    navigate(libraryPath);
  };

  const handleDuplicate = async () => {
    const res = await base44.functions.invoke('manageMasterSOP', { action: 'duplicate', masterId });
    const dup = res.data?.master;
    if (dup) navigate(`${libraryPath}/${dup.id}`);
  };

  // ── Rollback ──────────────────────────────────────────────────────────────
  const handleRollback = async (targetVersion) => {
    const mutationKey = `rollback_${masterId}_to_v${targetVersion.versionNumber}_${Date.now().toString(36)}`;
    const changeSummary = `Rollback to v${targetVersion.versionNumber} (${new Date().toLocaleDateString()})`;
    await base44.functions.invoke('manageMasterSOP', {
      action: 'rollback_to_version',
      masterId,
      targetVersionId: targetVersion.id,
      publicationMutationKey: mutationKey,
      changeSummary,
    });
    clearDraft(masterId, currentUserId);
    pendingSaveRef.current = null;
    setShowTimeline(false);
    await load();
  };

  // ── Navigation guard ──────────────────────────────────────────────────────
  const isPlatform = window.location.pathname.startsWith('/platform');
  const libraryPath = isPlatform ? '/platform/master-library' : '/admin/master-library';

  const handleBack = async () => {
    const hasUnsaved = saveStatus === STATUS.DIRTY || saveStatus === STATUS.FAILED || saveStatus === STATUS.OFFLINE;
    if (hasUnsaved) {
      const localSafe = !!readDraft(masterId, currentUserId);
      const msg = localSafe
        ? 'You have unsaved changes. A local backup exists and will be offered on next open. Leave anyway?'
        : 'You have unsaved changes that are NOT saved locally. Leaving will lose this work. Leave anyway?';
      if (!confirm(msg)) return;
    } else if (saveStatus === STATUS.DIRTY) {
      // Attempt final flush
      await flushPendingSave();
    }
    // When on platform, return to the detail view of this master, not the list
    if (isPlatform) {
      navigate(`${libraryPath}/${masterId}`);
    } else {
      navigate(libraryPath);
    }
  };

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="flex items-center justify-center min-h-screen bg-app-bg">
      <div className="w-8 h-8 border-4 border-app-border border-t-app-accent rounded-full animate-spin" />
    </div>
  );

  // Hard load failure — show a focused error page, not the half-rendered editor
  if (!master && saveError) {
    return (
      <div className="min-h-screen bg-app-bg flex flex-col">
        <div className="bg-app-surface border-b border-app-border sticky top-0 z-40">
          <div className="max-w-4xl mx-auto px-6 py-3 flex items-center gap-3">
            <button onClick={() => navigate(libraryPath)} className="icon-btn text-app-text-2">
              <ArrowLeft size={20} />
            </button>
            <span className="font-semibold text-app-text">Load Failed</span>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center flex-1 px-6 text-center gap-4">
          <AlertTriangle size={36} className="text-app-warning" />
          <p className="text-base font-semibold text-app-text">Unable to load this Master Job</p>
          <p className="text-sm text-app-text-muted">{saveError}</p>
          <button onClick={load} className="px-5 py-2.5 bg-app-accent text-app-accent-text rounded-xl text-sm font-medium">Try Again</button>
          <button onClick={() => navigate(libraryPath)} className="text-sm text-app-text-muted underline">Back to Master Jobs</button>
        </div>
      </div>
    );
  }

  const isDraft = master?.status === 'draft';
  const isActive = master?.status === 'active';
  const validation = isDraft ? validateForPublish(metaFields, sections) : { errors: [], warnings: [], valid: true };

  return (
    <div className="min-h-screen bg-app-bg">
      {/* Sticky header */}
      <div className="bg-app-surface border-b border-app-border sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-2">
          <button onClick={handleBack} className="icon-btn text-app-text-2 flex-shrink-0" aria-label="Back">
            <ArrowLeft size={20} />
          </button>

          <div className="flex-1 min-w-0">
            <h1 className="font-semibold text-app-text truncate text-sm">{master?.title}</h1>
            <div className="flex items-center gap-1.5 text-xs">
              <span className={`capitalize font-medium ${
                master?.status === 'active' ? 'text-app-success' :
                master?.status === 'draft' ? 'text-app-warning' : 'text-app-text-muted'
              }`}>
                {master?.status === 'active' ? 'Published' : master?.status}
              </span>
              <SaveStatusBadge status={saveStatus} lastSavedAt={lastSavedAt} />
            </div>
          </div>

          {/* Primary actions — always visible */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Save Now */}
            {isDraft && (saveStatus === STATUS.DIRTY || saveStatus === STATUS.FAILED || saveStatus === STATUS.OFFLINE) && (
              <button
                onClick={handleSaveNow}
                disabled={saveStatus === STATUS.SAVING}
                title="Save Now"
                className="icon-btn border border-app-accent text-app-accent hover:bg-app-info-bg disabled:opacity-50"
              >
                <Save size={16} />
              </button>
            )}
            {/* Timeline — icon only on mobile */}
            <button
              onClick={openTimeline}
              title="Version Timeline"
              className="icon-btn border border-app-border text-app-text-2 hover:border-app-accent"
            >
              <History size={16} />
            </button>
            {/* More actions menu */}
            <MoreActionsMenu
              isDraft={isDraft}
              isActive={isActive}
              isArchived={master?.status === 'archived'}
              onDuplicate={handleDuplicate}
              onDelete={handleDelete}
              onArchive={handleArchive}
            />
            {/* Publish — primary CTA */}
            {isDraft && (
              <button
                onClick={openPublishDialog}
                disabled={saveStatus === STATUS.SAVING}
                className="px-3 py-1.5 bg-app-accent text-app-accent-text rounded-lg text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50 relative no-select touch-active"
              >
                <Send size={13} /> Publish
                {publishError && validation.errors.length > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-app-danger text-white rounded-full text-[10px] flex items-center justify-center font-bold">
                    {validation.errors.length}
                  </span>
                )}
              </button>
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
        {/* AI-generated draft banner — visual indicator only */}
        {isAiDraft && (
          <div className="mb-4 flex items-start gap-2.5 p-3.5 bg-app-info-bg border border-app-accent/30 rounded-xl">
            <Sparkles size={16} className="text-app-accent flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-app-text">AI GENERATED DRAFT</p>
              <p className="text-xs text-app-text-2 leading-relaxed mt-0.5">
                This draft was generated by AI. Review and edit every section before saving and publishing. AI content is not automatically approved.
              </p>
            </div>
            <button
              onClick={() => setIsAiDraft(false)}
              className="text-app-text-muted hover:text-app-text flex-shrink-0"
              aria-label="Dismiss"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Publish success */}
        {publishSuccess && (
          <div className="mb-4 flex items-center gap-2 p-3.5 bg-app-success-bg border border-app-success/30 rounded-xl text-sm text-app-success font-medium">
            <CheckCircle2 size={16} /> Version published successfully!
          </div>
        )}

        {/* Save error */}
        {saveError && saveStatus !== STATUS.CONFLICT && (
          <div className="mb-4 flex items-center gap-2 p-3.5 bg-app-danger-bg border border-app-danger/30 rounded-xl text-sm text-app-danger">
            <AlertTriangle size={16} /> {saveError}
            {saveStatus === STATUS.FAILED && (
              <button onClick={handleSaveNow} className="ml-auto px-2.5 py-1 bg-app-danger text-white rounded-lg text-xs font-medium flex items-center gap-1">
                <RefreshCw size={11} /> Retry
              </button>
            )}
          </div>
        )}

        {/* CONFLICT banner */}
        {saveStatus === STATUS.CONFLICT && conflictData && (
          <ConflictBanner
            conflict={conflictData}
            onLoadServer={handleLoadServerVersion}
            onKeepLocal={handleKeepLocalForReview}
            onCompare={handleCompareConflict}
          />
        )}

        {/* Local recovery banner */}
        {showRecoveryBanner && localDraft && (
          <RecoveryBanner
            recoveryCase={recoveryCase}
            localDraft={localDraft}
            serverRevision={draftRevision}
            onRestore={handleRestoreLocal}
            onUseServer={handleUseServerDraft}
            onCompare={() => {
              setCompareVersions({
                a: { id: '_server', versionNumber: draftRevision, label: 'Server Draft', _sections: sections },
                b: { id: '_local', label: 'Local Recovery', _sections: localDraft.sections || [] },
              });
              setShowRecoveryBanner(false);
            }}
            onDismiss={() => setShowRecoveryBanner(false)}
          />
        )}

        {/* Read-only notice */}
        {!isDraft && (
          <div className="mb-4 px-4 py-3 bg-app-info-bg border border-app-info/30 rounded-xl text-sm text-app-info flex items-center gap-2">
            <AlertTriangle size={14} /> This version is published and read-only. Duplicate it to create a new editable draft.
          </div>
        )}

        {/* Validation summary — only shown after a publish attempt, not on fresh load */}
        {isDraft && validation.errors.length > 0 && publishError && (
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

        {/* Server validation errors from last publish attempt */}
        {serverValidationErrors.length > 0 && (
          <div className="mb-4 p-3.5 bg-app-danger-bg border border-app-danger/20 rounded-xl space-y-1.5">
            <p className="text-xs font-bold text-app-danger uppercase tracking-wide">Server Validation Errors</p>
            {serverValidationErrors.map((e, i) => (
              <div key={i} className="flex items-start gap-2 text-xs text-app-danger">
                <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
                <span>{e}</span>
              </div>
            ))}
          </div>
        )}

        {/* Meta card */}
        <div className="bg-app-card border border-app-border rounded-xl p-5 mb-6">
          {editingMeta && isDraft ? (
            <div className="space-y-3">
              <input
                value={metaFields.title}
                onChange={e => handleMetaChange('title', e.target.value)}
                className="w-full px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text focus:outline-none focus:border-app-accent"
                placeholder="Title *"
              />
              <div className="flex gap-2">
                <input
                  value={metaFields.trade}
                  onChange={e => handleMetaChange('trade', e.target.value)}
                  className="flex-1 px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text focus:outline-none focus:border-app-accent"
                  placeholder="Trade"
                />
                <input
                  value={metaFields.category}
                  onChange={e => handleMetaChange('category', e.target.value)}
                  className="flex-1 px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text focus:outline-none focus:border-app-accent"
                  placeholder="Category"
                />
              </div>
              <textarea
                value={metaFields.description}
                onChange={e => handleMetaChange('description', e.target.value)}
                rows={2}
                className="w-full px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text focus:outline-none focus:border-app-accent"
                placeholder="Description (optional)"
              />
              {/* Tags */}
              <div>
                <div className="flex flex-wrap gap-1.5 mb-1.5">
                  {(metaFields.tags || []).map(tag => (
                    <span key={tag} className="flex items-center gap-1 px-2 py-0.5 bg-app-info-bg text-app-accent text-xs rounded-full font-medium">
                      {tag}
                      <button
                        type="button"
                        onClick={() => handleMetaChange('tags', metaFields.tags.filter(t => t !== tag))}
                        className="text-app-accent/60 hover:text-app-danger ml-0.5"
                        aria-label={`Remove tag ${tag}`}
                      >×</button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    value={tagInput}
                    onChange={e => setTagInput(e.target.value)}
                    onKeyDown={e => {
                      if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) {
                        e.preventDefault();
                        const newTag = tagInput.trim().replace(/,$/, '');
                        if (newTag && !(metaFields.tags || []).includes(newTag)) {
                          handleMetaChange('tags', [...(metaFields.tags || []), newTag]);
                        }
                        setTagInput('');
                      }
                    }}
                    className="flex-1 px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text focus:outline-none focus:border-app-accent"
                    placeholder="Add tag (Enter or comma to add)"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const newTag = tagInput.trim();
                      if (newTag && !(metaFields.tags || []).includes(newTag)) {
                        handleMetaChange('tags', [...(metaFields.tags || []), newTag]);
                      }
                      setTagInput('');
                    }}
                    className="px-3 py-2 border border-app-border rounded-lg text-sm text-app-text-2 hover:border-app-accent"
                  >Add</button>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={saveMeta}
                  disabled={saveStatus === STATUS.SAVING || !metaFields.title.trim()}
                  className="px-4 py-1.5 bg-app-accent text-app-accent-text rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {saveStatus === STATUS.SAVING ? 'Saving…' : 'Save'}
                </button>
                <button onClick={() => setEditingMeta(false)} className="px-4 py-1.5 border border-app-border rounded-lg text-sm text-app-text-2">Cancel</button>
              </div>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-app-text mb-1">{master?.title}</h2>
                <p className="text-xs text-app-accent font-medium mb-1">{[master?.trade, master?.category].filter(Boolean).join(' · ')}</p>
                {master?.description
                  ? <p className="text-sm text-app-text-2">{master.description}</p>
                  : isDraft && <p className="text-sm text-app-text-muted italic">No description — click Edit to add one.</p>
                }
                {master?.tags?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {master.tags.map(tag => (
                      <span key={tag} className="px-2 py-0.5 bg-app-info-bg text-app-accent text-xs rounded-full font-medium">{tag}</span>
                    ))}
                  </div>
                )}
                {isActive && master?.currentPublishedVersionId && (
                  <p className="text-xs text-app-text-muted mt-2 flex items-center gap-1">
                    <CheckCircle2 size={11} className="text-app-success" /> Published version active
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

        {/* Sections */}
        {SECTION_ORDER.map(st => {
          const section = sections.find(s => s.sectionType === st);
          if (!section) return null;
          return (
            <SopSectionEditor
              key={st}
              section={section}
              isDraft={isDraft}
              onSave={handleSectionSave}
              saving={saveStatus === STATUS.SAVING}
            />
          );
        })}
      </div>

      {/* Publish dialog */}
      {showPublishDialog && (
        <SopPublishDialog
          master={master}
          validation={validation}
          publishing={publishing}
          publishError={publishError}
          serverValidationErrors={serverValidationErrors}
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

// ── More actions menu ─────────────────────────────────────────────────────────
function MoreActionsMenu({ isDraft, isActive, isArchived, onDuplicate, onDelete, onArchive }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        title="More actions"
        className="icon-btn border border-app-border text-app-text-2 hover:border-app-accent"
      >
        <Copy size={16} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 bg-app-surface border border-app-border rounded-xl shadow-lg min-w-[160px] py-1 overflow-hidden">
            <button
              onClick={() => { setOpen(false); onDuplicate(); }}
              className="w-full px-4 py-2.5 text-left text-sm text-app-text flex items-center gap-2.5 hover:bg-app-elevated"
            >
              <Copy size={14} className="text-app-text-muted" /> Duplicate
            </button>
            {isDraft && (
              <button
                onClick={() => { setOpen(false); onDelete(); }}
                className="w-full px-4 py-2.5 text-left text-sm text-app-danger flex items-center gap-2.5 hover:bg-app-danger-bg"
              >
                <Trash2 size={14} /> Delete Draft
              </button>
            )}
            {(isActive || isArchived) && (
              <button
                onClick={() => { setOpen(false); onArchive(); }}
                disabled={isArchived}
                className="w-full px-4 py-2.5 text-left text-sm text-app-text-2 flex items-center gap-2.5 hover:bg-app-elevated disabled:opacity-40"
              >
                <Archive size={14} className="text-app-text-muted" /> Archive
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Save status badge ────────────────────────────────────────────────────────
function SaveStatusBadge({ status, lastSavedAt }) {
  if (status === STATUS.SAVING) {
    return <span className="text-app-accent animate-pulse flex items-center gap-1"><Clock size={10} /> Saving…</span>;
  }
  if (status === STATUS.SAVED && lastSavedAt) {
    return (
      <span className="text-app-success flex items-center gap-1">
        <CheckCircle2 size={10} /> Saved {lastSavedAt.toLocaleTimeString()}
      </span>
    );
  }
  if (status === STATUS.DIRTY) {
    return <span className="text-app-warning flex items-center gap-1"><Clock size={10} /> Unsaved changes</span>;
  }
  if (status === STATUS.FAILED) {
    return <span className="text-app-danger flex items-center gap-1"><AlertTriangle size={10} /> Save failed</span>;
  }
  if (status === STATUS.CONFLICT) {
    return <span className="text-app-danger flex items-center gap-1"><AlertTriangle size={10} /> Conflict detected</span>;
  }
  if (status === STATUS.OFFLINE) {
    return <span className="text-app-warning flex items-center gap-1"><WifiOff size={10} /> Offline — saved locally</span>;
  }
  return null;
}

// ── Conflict banner ──────────────────────────────────────────────────────────
function ConflictBanner({ conflict, onLoadServer, onKeepLocal, onCompare }) {
  return (
    <div className="mb-4 p-4 bg-app-danger-bg border border-app-danger/30 rounded-xl">
      <div className="flex items-start gap-3 mb-3">
        <GitMerge size={16} className="text-app-danger flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-app-text mb-1">Draft Conflict Detected</p>
          <p className="text-xs text-app-text-2 leading-relaxed">
            Another administrator saved changes to this draft while you were editing. Your changes were <strong>not saved</strong> to prevent overwriting their work.
          </p>
          {conflict.serverLastSavedByUserId && (
            <p className="text-xs text-app-text-muted mt-1">Server revision: {conflict.serverRevision}</p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={onLoadServer} className="px-3 py-1.5 bg-app-accent text-app-accent-text rounded-lg text-xs font-semibold">
          Load Server Version
        </button>
        <button onClick={onKeepLocal} className="px-3 py-1.5 border border-app-border rounded-lg text-xs text-app-text-2">
          Keep My Local Copy
        </button>
        <button onClick={onCompare} className="px-3 py-1.5 border border-app-accent/40 rounded-lg text-xs text-app-accent flex items-center gap-1">
          <GitMerge size={11} /> Compare Versions
        </button>
      </div>
      <p className="text-xs text-app-text-muted mt-2">
        You must resolve this conflict before your changes can be saved. Do not use "Keep My Local Copy" unless you intend to overwrite the server version.
      </p>
    </div>
  );
}

// ── Recovery banner ──────────────────────────────────────────────────────────
function RecoveryBanner({ recoveryCase, localDraft, serverRevision, onRestore, onUseServer, onCompare, onDismiss }) {
  const savedAt = localDraft?.savedAt ? new Date(localDraft.savedAt).toLocaleTimeString() : 'unknown';
  if (recoveryCase === 'local_ahead') {
    return (
      <div className="mb-4 p-4 bg-app-warning-bg border border-app-warning/30 rounded-xl">
        <div className="flex items-start gap-3">
          <Clock size={16} className="text-app-warning flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-app-text mb-1">Unsaved local work found</p>
            <p className="text-xs text-app-text-2 mb-3">
              A local recovery copy exists from {savedAt} that is newer than the server draft. This was likely saved during a network interruption or crash.
            </p>
            <div className="flex flex-wrap gap-2">
              <button onClick={onRestore} className="px-3 py-1.5 bg-app-warning text-white rounded-lg text-xs font-semibold">
                Restore Local Work
              </button>
              <button onClick={onUseServer} className="px-3 py-1.5 border border-app-border rounded-lg text-xs text-app-text-2">
                Use Server Draft
              </button>
              <button onClick={onCompare} className="px-3 py-1.5 border border-app-border rounded-lg text-xs text-app-text-2 flex items-center gap-1">
                <GitMerge size={11} /> Compare
              </button>
            </div>
          </div>
          <button onClick={onDismiss} className="text-app-text-muted hover:text-app-text"><X size={14} /></button>
        </div>
      </div>
    );
  }
  if (recoveryCase === 'server_ahead') {
    return (
      <div className="mb-4 p-3.5 bg-app-info-bg border border-app-info/20 rounded-xl flex items-start gap-3">
        <Clock size={14} className="text-app-info flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-xs font-semibold text-app-text mb-1">Server draft is newer than your local copy</p>
          <p className="text-xs text-app-text-2">The server has been updated since your local backup. The server draft is shown. Your local copy is preserved for comparison.</p>
          <div className="flex gap-2 mt-2">
            <button onClick={onCompare} className="px-3 py-1 border border-app-border rounded-lg text-xs text-app-text-2 flex items-center gap-1">
              <GitMerge size={11} /> Compare
            </button>
            <button onClick={onDismiss} className="px-3 py-1 text-xs text-app-text-muted underline">Dismiss</button>
          </div>
        </div>
        <button onClick={onDismiss} className="text-app-text-muted hover:text-app-text"><X size={14} /></button>
      </div>
    );
  }
  return null;
}