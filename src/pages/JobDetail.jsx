/**
 * JobDetail — Company Job Detail Container (Company Workspace Wrapper)
 *
 * This is the Company workspace wrapper. It owns:
 *   - data retrieval (resolveJob)
 *   - normalization into the shared presentation interface
 *   - Company-specific permissions and capabilities
 *   - all mutations (save, delete, reorder)
 *   - Company-specific slots: headerActions, contextBanner, metadataView,
 *     renderSectionAction, renderItemActions
 *
 * The visible experience is delegated entirely to JobWorkspacePresentation.
 * Company behavior is 100% unchanged from the original JobDetail.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useApp } from '@/lib/AppContext';
import { useCompany } from '@/lib/CompanyContext';
import {
  Pencil, Plus, Trash2, ArrowUp, ArrowDown,
  AlertTriangle, Sliders, Edit3,
} from 'lucide-react';
import JobWorkspacePresentation from '@/components/job-workspace/JobWorkspacePresentation';
import JobCustomizeEditor from '@/components/jobs/JobCustomizeEditor';
import VersionUpdateBanner from '@/components/jobs/VersionUpdateBanner';
import VersionAdoptionIncomplete from '@/components/jobs/version/VersionAdoptionIncomplete';
import ContentEditDialog from '@/components/sections/ContentEditDialog';
import EditRequestForm from '@/components/EditRequestForm';
import NotificationBell from '@/components/NotificationBell';
import JobLoadError, { parseJobLoadError } from '@/components/jobs/JobLoadError';
import { useJobsListState } from '@/lib/useJobsListState';

export default function JobDetail() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const { addRecentlyViewed, isCompanyAdmin } = useApp();
  const { activeCompany, activeMembership } = useCompany();
  const { navigateBackToJobs } = useJobsListState();

  const isProjectLead = activeMembership?.role === 'project_lead';

  // ── Data state ────────────────────────────────────────────────────────────
  const [job, setJob] = useState(null);
  const [sections, setSections] = useState([]);
  const [contentBySection, setContentBySection] = useState({});
  const [capabilities, setCapabilities] = useState(null);
  const [overrideMeta, setOverrideMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [adoptionIncompleteKey, setAdoptionIncompleteKey] = useState(null);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [editMode, setEditMode] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [editSectionType, setEditSectionType] = useState(null);
  const [showAddFor, setShowAddFor] = useState(null);
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [activeGrant, setActiveGrant] = useState(null);
  const [showCustomizeEditor, setShowCustomizeEditor] = useState(false);

  // canEdit: company admin presentation toggle AND backend-verified capability both required.
  const canEdit = isCompanyAdmin && (capabilities?.canEditContent ?? false);

  // ── Load ──────────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoadError(null);
    setLoading(true);
    try {
      const res = await base44.functions.invoke('resolveJob', { jobId });

      if (res?.data?.code === 'ADOPTION_INCOMPLETE') {
        setAdoptionIncompleteKey(res.data?.mutationKey || '__unknown__');
        setLoading(false);
        return;
      }

      if (!res?.data?.job) {
        const shapeErr = new Error('Response is missing required job data');
        shapeErr.code = 'INVALID_RESPONSE';
        throw shapeErr;
      }

      const { job: j, sections: secs, contentBySection: cbs, capabilities: caps, override: ovr } = res.data;
      setJob(j);
      setSections(secs || []);
      setContentBySection(cbs || {});
      setCapabilities(caps || null);
      setOverrideMeta(ovr || null);
      if (j) addRecentlyViewed(j.id, j.title);

      const user = await base44.auth.me().catch(() => null);
      if (user) {
        const grants = await base44.entities.TemporaryEditGrant.filter({ jobId, userId: user.id, status: 'active' }).catch(() => []);
        const valid = (grants || []).find(g => new Date(g.expiresAt) > new Date());
        setActiveGrant(valid || null);
      }
    } catch (err) {
      setLoadError(parseJobLoadError(err, jobId));
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const assertMutationAllowed = async () => {
    const res = await base44.functions.invoke('validateJobMutation', { jobId });
    if (!res.data?.allowed) throw new Error(res.data?.reason || 'Mutation not permitted');
  };

  const handleSaveItem = async (data) => {
    const st = editSectionType || showAddFor;
    if (!st) return;
    await assertMutationAllowed();
    const sectionRecord = sections.find(s => s.sectionType === st);
    if (editItem) {
      const updated = await base44.entities.SectionContent.update(editItem.id, data);
      setContentBySection(prev => ({
        ...prev,
        [st]: (prev[st] || []).map(i => i.id === editItem.id ? updated : i),
      }));
    } else {
      const items = contentBySection[st] || [];
      const created = await base44.entities.SectionContent.create({
        ...data,
        sectionId: sectionRecord?.id,
        jobId,
        sectionType: st,
        sortOrder: items.length,
        companyId: job?.companyId,
      });
      setContentBySection(prev => ({ ...prev, [st]: [...(prev[st] || []), created] }));
    }
    setEditItem(null);
    setEditSectionType(null);
    setShowAddFor(null);
  };

  const handleDelete = async (sectionType, id) => {
    await assertMutationAllowed();
    await base44.entities.SectionContent.delete(id);
    setContentBySection(prev => ({
      ...prev,
      [sectionType]: (prev[sectionType] || []).filter(i => i.id !== id),
    }));
  };

  const handleReorder = async (sectionType, index, dir) => {
    await assertMutationAllowed();
    const items = [...(contentBySection[sectionType] || [])];
    const swap = index + dir;
    if (swap < 0 || swap >= items.length) return;
    [items[index], items[swap]] = [items[swap], items[index]];
    items.forEach((item, i) => base44.entities.SectionContent.update(item.id, { sortOrder: i }));
    setContentBySection(prev => ({
      ...prev,
      [sectionType]: items.map((item, i) => ({ ...item, sortOrder: i })),
    }));
  };

  const onAdoptedVersion = (resolvedJob) => {
    const { job: j, sections: secs, contentBySection: cbs, capabilities: caps, override: ovr } = resolvedJob;
    setJob(j);
    setSections(secs || []);
    setContentBySection(cbs || {});
    setCapabilities(caps || null);
    setOverrideMeta(ovr || null);
  };

  // ── ADOPTION_INCOMPLETE guard ─────────────────────────────────────────────
  if (adoptionIncompleteKey) {
    return (
      <VersionAdoptionIncomplete
        job={{ id: jobId, title: job?.title || 'This Job', companyId: activeCompany?.id }}
        onRecovered={(resolvedJob) => {
          setAdoptionIncompleteKey(null);
          if (resolvedJob?.job) {
            onAdoptedVersion(resolvedJob);
          } else {
            loadData();
          }
        }}
        onClose={() => { setAdoptionIncompleteKey(null); navigateBackToJobs(navigate); }}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-app-bg">
        <div className="w-8 h-8 border-4 border-app-border border-t-app-accent rounded-full animate-spin" />
      </div>
    );
  }

  if (loadError || !job) {
    const err = loadError || { errorCode: 'JOB_NOT_FOUND' };
    return <JobLoadError jobId={jobId} error={err} onRetry={loadData} navigate={navigate} />;
  }

  // ── Workspace configuration ────────────────────────────────────────────────
  const workspace = {
    label: activeCompany?.name || null,
    editMode,
  };

  // ── Header actions slot ───────────────────────────────────────────────────
  const headerActions = (
    <>
      <NotificationBell />
      {canEdit && (
        <button
          onClick={() => setEditMode(e => !e)}
          className={`px-3 py-2.5 rounded-lg text-sm font-medium flex items-center gap-1.5 no-select touch-active transition-colors ${
            editMode ? 'bg-app-accent text-app-accent-text' : 'bg-app-elevated text-app-text-2'
          }`}
        >
          <Pencil size={14} />{editMode ? 'Done' : 'Edit'}
        </button>
      )}
      {capabilities?.canCustomize && !editMode && (
        <button
          onClick={() => setShowCustomizeEditor(true)}
          className="px-3 py-2.5 rounded-lg text-sm font-medium flex items-center gap-1.5 no-select touch-active border border-app-accent text-app-accent bg-app-info-bg"
        >
          <Sliders size={14} /> {overrideMeta ? 'Edit Custom' : 'Customize'}
        </button>
      )}
      {isProjectLead && job?.status === 'Published' && !activeGrant && !editMode && (
        <button
          onClick={() => setShowRequestForm(true)}
          className="px-3 py-2.5 rounded-lg text-sm font-medium flex items-center gap-1.5 no-select touch-active border border-app-border text-app-text-2 bg-app-elevated"
        >
          <Edit3 size={14} /> Request Edit
        </button>
      )}
    </>
  );

  // ── Context banner slot ────────────────────────────────────────────────────
  const contextBanner = (
    <>
      {/* Override meta indicator — rendered in job header via metadataView */}
      {capabilities?.canCustomize && (
        <VersionUpdateBanner
          job={job}
          overrideMeta={overrideMeta}
          onAdopted={onAdoptedVersion}
        />
      )}
      {/* Active grant banner for Project Lead */}
      {activeGrant && <ActiveGrantBanner grant={activeGrant} />}
    </>
  );

  // ── Metadata view slot ─────────────────────────────────────────────────────
  const metadataView = overrideMeta ? (
    <span className="flex items-center gap-1 text-app-info">
      <Sliders size={11} />
      <span>Customized (rev {overrideMeta.revision})</span>
    </span>
  ) : null;

  // ── Section action slot ────────────────────────────────────────────────────
  const renderSectionAction = canEdit && editMode
    ? (sectionType) => (
        <button
          onClick={() => setShowAddFor(sectionType)}
          className="flex items-center gap-1 px-2.5 py-1 bg-app-accent text-app-accent-text rounded-lg text-xs font-medium no-select touch-active"
        >
          <Plus size={12} /> Add
        </button>
      )
    : undefined;

  // ── Item actions slot ──────────────────────────────────────────────────────
  const renderItemActions = canEdit && editMode
    ? (sectionType, item, index, total) => (
        <CompanyAdminBar
          item={item}
          index={index}
          total={total}
          onEdit={(it) => { setEditItem(it); setEditSectionType(sectionType); }}
          onDelete={(id) => handleDelete(sectionType, id)}
          onReorder={(idx, dir) => handleReorder(sectionType, idx, dir)}
        />
      )
    : undefined;

  return (
    <>
      <JobWorkspacePresentation
        job={job}
        contentBySection={contentBySection}
        workspace={workspace}
        headerActions={headerActions}
        contextBanner={contextBanner}
        metadataView={metadataView}
        renderSectionAction={renderSectionAction}
        renderItemActions={renderItemActions}
        onBack={() => navigateBackToJobs(navigate)}
      />

      {showRequestForm && job && (
        <EditRequestForm job={job} onClose={() => setShowRequestForm(false)} />
      )}

      {showCustomizeEditor && job && capabilities?.canCustomize && (
        <JobCustomizeEditor
          job={job}
          contentBySection={contentBySection}
          override={overrideMeta}
          onSaved={(resolvedJob) => {
            onAdoptedVersion(resolvedJob);
            setShowCustomizeEditor(false);
          }}
          onClose={() => setShowCustomizeEditor(false)}
        />
      )}

      {(editItem || showAddFor) && (
        <ContentEditDialog
          sectionType={editSectionType || showAddFor}
          item={editItem}
          onSave={handleSaveItem}
          onClose={() => { setEditItem(null); setEditSectionType(null); setShowAddFor(null); }}
        />
      )}
    </>
  );
}

// ── Company Admin Bar ─────────────────────────────────────────────────────────

function CompanyAdminBar({ item, index, total, onEdit, onDelete, onReorder }) {
  return (
    <div className="flex items-center gap-1 pt-2 mt-2 border-t border-app-divider no-select">
      <button
        onClick={e => { e.stopPropagation(); onEdit(item); }}
        className="px-2 py-1 text-xs text-app-accent font-medium flex items-center gap-1 touch-active"
      >
        <Pencil size={11} /> Edit
      </button>
      <button
        onClick={e => { e.stopPropagation(); onDelete(item.id); }}
        className="px-2 py-1 text-xs text-app-danger font-medium flex items-center gap-1 touch-active"
      >
        <Trash2 size={11} /> Delete
      </button>
      <div className="flex-1" />
      <button
        onClick={e => { e.stopPropagation(); onReorder(index, -1); }}
        disabled={index === 0}
        className="icon-btn text-app-text-muted disabled:opacity-25 touch-active"
        aria-label="Move up"
      >
        <ArrowUp size={13} />
      </button>
      <button
        onClick={e => { e.stopPropagation(); onReorder(index, 1); }}
        disabled={index === total - 1}
        className="icon-btn text-app-text-muted disabled:opacity-25 touch-active"
        aria-label="Move down"
      >
        <ArrowDown size={13} />
      </button>
    </div>
  );
}

// ── Active Grant Banner ───────────────────────────────────────────────────────

function ActiveGrantBanner({ grant }) {
  const sectionNames = {
    tools: 'Tools', materials: 'Materials', scope: 'Scope',
    procedure: 'Procedure', safety: 'Safety', quality_standards: 'Quality Standards',
  };
  const approved = (grant.approvedSectionTypes || []).map(s => sectionNames[s] || s).join(', ');
  const expiresMinutes = Math.max(0, Math.round((new Date(grant.expiresAt) - new Date()) / 60000));
  const expiresHours = Math.floor(expiresMinutes / 60);
  const expiresDisplay = expiresMinutes < 60 ? `${expiresMinutes} min` : `${expiresHours}h`;

  return (
    <div
      className="bg-app-info border-t border-app-info/30 px-3 py-2.5"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <p className="text-xs font-bold text-white">Editing Enabled</p>
      <p className="text-xs text-white/90 mt-0.5">You can edit {approved} for this Job.</p>
      <p className="text-xs text-white/70 mt-0.5">Edit Access Expires in {expiresDisplay}.</p>
    </div>
  );
}