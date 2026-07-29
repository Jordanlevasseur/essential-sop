import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useApp } from '@/lib/AppContext';
import { useCompany } from '@/lib/CompanyContext';
import { ArrowLeft, Star, Clock, Pencil, Plus, Trash2, ArrowUp, ArrowDown, AlertTriangle, Info, AlertCircle, ShieldAlert, Edit3, Sliders } from 'lucide-react';
import JobCustomizeEditor from '@/components/jobs/JobCustomizeEditor';
import VersionUpdateBanner from '@/components/jobs/VersionUpdateBanner';
import { SECTION_MAP } from '@/lib/constants';
import ContentEditDialog from '@/components/sections/ContentEditDialog';
import EditRequestForm from '@/components/EditRequestForm';
import NotificationBell from '@/components/NotificationBell';

const DISPLAY_ORDER = ['tools', 'materials', 'scope', 'procedure', 'safety', 'quality'];

export default function JobDetail() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const { isFavorite, toggleFavorite, addRecentlyViewed, isAdmin } = useApp();
  const { activeCompany, activeMembership } = useCompany();
  const isProjectLead = activeMembership?.role === 'project_lead';
  // The backend is the single authority on what actions are available.
  // The frontend must not infer permissions from job origin fields.
  // capabilities is null until the resolver responds; treat null as read-only.
  const canEdit = isAdmin && (capabilities?.canEditContent ?? false);
  const [job, setJob] = useState(null);
  const [sections, setSections] = useState([]);
  const [contentBySection, setContentBySection] = useState({});
  const [capabilities, setCapabilities] = useState(null);
  const [overrideMeta, setOverrideMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [editSectionType, setEditSectionType] = useState(null);
  const [showAddFor, setShowAddFor] = useState(null);
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [activeGrant, setActiveGrant] = useState(null);
  const [showCustomizeEditor, setShowCustomizeEditor] = useState(false);

  const loadData = useCallback(async () => {
    try {
      // All Job content is resolved through the centralized resolveJob backend.
      // The frontend does not determine how content is assembled — the backend does.
      const res = await base44.functions.invoke('resolveJob', { jobId });
      const { job: j, sections: secs, contentBySection: cbs, capabilities: caps, override: ovr } = res.data;

      setJob(j);
      setSections(secs || []);
      setContentBySection(cbs || {});
      setCapabilities(caps || null);
      setOverrideMeta(ovr || null);

      if (j && activeCompany && j.companyId && j.companyId !== activeCompany.id) {
        navigate('/');
        return;
      }
      if (j) addRecentlyViewed(j.id, j.title);

      // Check for active temporary edit grant (Project Lead)
      const user = await base44.auth.me().catch(() => null);
      if (user) {
        const grants = await base44.entities.TemporaryEditGrant.filter({ jobId, userId: user.id, status: 'active' }).catch(() => []);
        const valid = (grants || []).find(g => new Date(g.expiresAt) > new Date());
        setActiveGrant(valid || null);
      }
    } catch (err) {
      navigate('/');
    }
    setLoading(false);
  }, [jobId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Backend mutation guard — called before every content write.
  // Provides a server-side safety net independent of frontend capability flags.
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
        ...data, sectionId: sectionRecord?.id, jobId, sectionType: st, sortOrder: items.length,
        companyId: job?.companyId,
      });
      setContentBySection(prev => ({ ...prev, [st]: [...(prev[st] || []), created] }));
    }
    setEditItem(null); setEditSectionType(null); setShowAddFor(null);
  };

  const handleDelete = async (sectionType, id) => {
    await assertMutationAllowed();
    await base44.entities.SectionContent.delete(id);
    setContentBySection(prev => ({ ...prev, [sectionType]: (prev[sectionType] || []).filter(i => i.id !== id) }));
  };

  const handleReorder = async (sectionType, index, dir) => {
    await assertMutationAllowed();
    const items = [...(contentBySection[sectionType] || [])];
    const swap = index + dir;
    if (swap < 0 || swap >= items.length) return;
    [items[index], items[swap]] = [items[swap], items[index]];
    items.forEach((item, i) => base44.entities.SectionContent.update(item.id, { sortOrder: i }));
    setContentBySection(prev => ({ ...prev, [sectionType]: items.map((item, i) => ({ ...item, sortOrder: i })) }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-app-bg">
        <div className="w-8 h-8 border-4 border-app-border border-t-app-accent rounded-full animate-spin" />
      </div>
    );
  }
  if (!job) return <div className="p-4 text-center text-app-text-muted">Job not found.</div>;

  return (
    <div className="min-h-screen bg-app-bg">
      {/* Sticky header */}
      <div className="bg-app-surface border-b border-app-border sticky top-0 z-40" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="icon-btn no-select touch-active" aria-label="Back">
            <ArrowLeft size={22} className="text-app-text-2" />
          </button>
          <h1 className="font-semibold text-app-text flex-1 truncate">{job.title}</h1>
          <NotificationBell />
          <button onClick={() => toggleFavorite(job.id)} className="icon-btn no-select touch-active" aria-label="Toggle favorite">
            <Star size={20} className={isFavorite(job.id) ? 'text-yellow-500 fill-yellow-500' : 'text-app-text-disabled'} />
          </button>
          {canEdit && (
            <button
              onClick={() => setEditMode(e => !e)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 no-select touch-active transition-colors ${editMode ? 'bg-app-accent text-app-accent-text' : 'bg-app-elevated text-app-text-2'}`}
            >
              <Pencil size={14} />{editMode ? 'Done' : 'Edit'}
            </button>
          )}
          {capabilities?.canCustomize && !editMode && (
            <button onClick={() => setShowCustomizeEditor(true)}
              className="px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 no-select touch-active border border-app-accent text-app-accent bg-app-info-bg">
              <Sliders size={14} /> {overrideMeta ? 'Edit Custom' : 'Customize'}
            </button>
          )}
          {isProjectLead && job?.status === 'Published' && !activeGrant && !editMode && (
            <button onClick={() => setShowRequestForm(true)}
              className="px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 no-select touch-active border border-app-border text-app-text-2 bg-app-elevated">
              <Edit3 size={14} /> Request Edit
            </button>
          )}
        </div>
      </div>

      {/* Job header — compact metadata */}
      <div className="px-5 pt-5 pb-4 border-b border-app-divider max-w-2xl mx-auto w-full">
        <p className="text-xs font-semibold text-app-accent uppercase tracking-wide mb-1">
          {[job.trade, job.category].filter(Boolean).join(' · ')}
        </p>
        <h2 className="text-xl font-bold text-app-text mb-2 leading-snug">{job.title}</h2>
        {job.shortDescription && (
          <p className="text-sm text-app-text-2 leading-relaxed mb-3 selectable">{job.shortDescription}</p>
        )}
        <div className="flex flex-wrap gap-3 text-xs text-app-text-muted">
          {job.estimatedDuration && (
            <span className="flex items-center gap-1"><Clock size={12} />{job.estimatedDuration}</span>
          )}
          {job.skillLevel && (
            <span className="text-app-text-muted">{job.skillLevel}</span>
          )}
        </div>
        {job.tags?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {job.tags.map(t => (
              <span key={t} className="text-xs px-2 py-0.5 bg-app-elevated text-app-text-muted rounded-full">#{t}</span>
            ))}
          </div>
        )}
        {overrideMeta && (
          <div className="mt-3 flex items-center gap-1.5 text-xs text-app-info">
            <Sliders size={11} />
            <span>Company customization applied — revision {overrideMeta.revision}</span>
          </div>
        )}
      </div>

      {/* Version Update Banner — shown only when admin + update available */}
      {capabilities?.canCustomize && (
        <VersionUpdateBanner
          job={job}
          overrideMeta={overrideMeta}
          onAdopted={(resolvedJob) => {
            const { job: j, sections: secs, contentBySection: cbs, capabilities: caps, override: ovr } = resolvedJob;
            setJob(j);
            setSections(secs || []);
            setContentBySection(cbs || {});
            setCapabilities(caps || null);
            setOverrideMeta(ovr || null);
          }}
        />
      )}

      {/* Sections */}
      <div className="max-w-2xl mx-auto w-full">
        {DISPLAY_ORDER.map(sectionType => {
          const def = SECTION_MAP[sectionType];
          if (!def) return null;
          const items = contentBySection[sectionType] || [];
          return (
            <SectionBlock
              key={sectionType}
              sectionType={sectionType}
              sectionDef={def}
              items={items}
              isAdmin={canEdit}
              editMode={editMode}
              onEdit={(item) => { setEditItem(item); setEditSectionType(sectionType); }}
              onDelete={(id) => handleDelete(sectionType, id)}
              onReorder={(idx, dir) => handleReorder(sectionType, idx, dir)}
              onAdd={() => setShowAddFor(sectionType)}
            />
          );
        })}
      </div>

      <div style={{ height: 'calc(32px + env(safe-area-inset-bottom))' }} />

      {/* Active grant banner for Project Lead */}
      {activeGrant && (() => {
        const sectionNames = { tools: 'Tools', materials: 'Materials', scope: 'Scope', procedure: 'Procedure', safety: 'Safety', quality_standards: 'Quality Standards' };
        const approved = (activeGrant.approvedSectionTypes || []).map(s => sectionNames[s] || s).join(', ');
        const expiresMinutes = Math.max(0, Math.round((new Date(activeGrant.expiresAt) - new Date()) / 60000));
        const expiresHours = Math.floor(expiresMinutes / 60);
        const expiresDisplay = expiresMinutes < 60 ? `${expiresMinutes} min` : `${expiresHours}h`;
        return (
          <div className="fixed bottom-0 left-0 right-0 z-30 bg-app-info border-t border-app-info/30 px-4 py-3" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <p className="text-xs font-bold text-white">Editing Enabled</p>
            <p className="text-xs text-white/90 mt-0.5">You can edit {approved} for this Job.</p>
            <p className="text-xs text-white/70 mt-0.5">Edit Access Expires in {expiresDisplay}.</p>
          </div>
        );
      })()}

      {showRequestForm && job && (
        <EditRequestForm job={job} onClose={() => setShowRequestForm(false)} />
      )}

      {showCustomizeEditor && job && capabilities?.canCustomize && (
        <JobCustomizeEditor
          job={job}
          contentBySection={contentBySection}
          override={overrideMeta}
          onSaved={(resolvedJob) => {
            const { job: j, sections: secs, contentBySection: cbs, capabilities: caps, override: ovr } = resolvedJob;
            setJob(j);
            setSections(secs || []);
            setContentBySection(cbs || {});
            setCapabilities(caps || null);
            setOverrideMeta(ovr || null);
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
    </div>
  );
}

// ── Section block ────────────────────────────────────────────────────────────

function SectionBlock({ sectionType, sectionDef, items, isAdmin, editMode, onEdit, onDelete, onReorder, onAdd }) {
  return (
    <div className="px-5 pt-8 pb-2">
      {/* Section heading row */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-bold text-app-text-muted uppercase tracking-widest">{sectionDef.title}</h2>
        {isAdmin && editMode && (
          <button
            onClick={onAdd}
            className="flex items-center gap-1 px-2.5 py-1 bg-app-accent text-app-accent-text rounded-lg text-xs font-medium no-select touch-active"
          >
            <Plus size={12} /> Add
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-app-text-muted italic">
          {isAdmin && editMode ? 'Tap Add to create the first item.' : 'No content yet.'}
        </p>
      ) : (
        <SectionRenderer
          sectionType={sectionType}
          items={items}
          editMode={editMode}
          onEdit={onEdit}
          onDelete={onDelete}
          onReorder={onReorder}
        />
      )}

      {/* Thin divider below section */}
      <div className="mt-6 border-b border-app-divider" />
    </div>
  );
}

// ── Admin controls bar ───────────────────────────────────────────────────────

function AdminBar({ item, index, total, onEdit, onDelete, onReorder }) {
  return (
    <div className="flex items-center gap-1 pt-2 mt-2 border-t border-app-divider no-select">
      <button onClick={e => { e.stopPropagation(); onEdit(item); }} className="px-2 py-1 text-xs text-app-accent font-medium flex items-center gap-1 touch-active">
        <Pencil size={11} /> Edit
      </button>
      <button onClick={e => { e.stopPropagation(); onDelete(item.id); }} className="px-2 py-1 text-xs text-app-danger font-medium flex items-center gap-1 touch-active">
        <Trash2 size={11} /> Delete
      </button>
      <div className="flex-1" />
      <button onClick={e => { e.stopPropagation(); onReorder(index, -1); }} disabled={index === 0} className="icon-btn text-app-text-muted disabled:opacity-25 touch-active" aria-label="Move up"><ArrowUp size={13} /></button>
      <button onClick={e => { e.stopPropagation(); onReorder(index, 1); }} disabled={index === total - 1} className="icon-btn text-app-text-muted disabled:opacity-25 touch-active" aria-label="Move down"><ArrowDown size={13} /></button>
    </div>
  );
}

// ── Section dispatcher ───────────────────────────────────────────────────────

function SectionRenderer(props) {
  const { sectionType } = props;
  if (sectionType === 'tools') return <ToolsView {...props} />;
  if (sectionType === 'materials') return <MaterialsView {...props} />;
  if (sectionType === 'scope') return <ScopeView {...props} />;
  if (sectionType === 'procedure') return <ProcedureView {...props} />;
  if (sectionType === 'safety') return <SafetyView {...props} />;
  if (sectionType === 'quality') return <QualityView {...props} />;
  return null;
}

// ── Tools ────────────────────────────────────────────────────────────────────

function ToolsView({ items, editMode, onEdit, onDelete, onReorder }) {
  return (
    <ul className="space-y-4">
      {items.map((item, i) => (
        <li key={item.id}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-semibold text-sm text-app-text selectable">{item.title}</span>
            {item.isRequired === false && (
              <span className="text-xs text-app-text-muted flex-shrink-0">Optional</span>
            )}
          </div>
          {item.metadata?.quantity && item.metadata.quantity !== 1 && (
            <p className="text-xs text-app-text-muted mt-0.5">Qty: {item.metadata.quantity}</p>
          )}
          {item.body && (
            <p className="text-sm text-app-text-2 mt-0.5 leading-relaxed selectable">{item.body}</p>
          )}
          {editMode && <AdminBar item={item} index={i} total={items.length} onEdit={onEdit} onDelete={onDelete} onReorder={onReorder} />}
        </li>
      ))}
    </ul>
  );
}

// ── Materials ────────────────────────────────────────────────────────────────

function MaterialsView({ items, editMode, onEdit, onDelete, onReorder }) {
  return (
    <ul className="space-y-4">
      {items.map((item, i) => (
        <li key={item.id}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-semibold text-sm text-app-text selectable">{item.title}</span>
            {item.isRequired === false && (
              <span className="text-xs text-app-text-muted flex-shrink-0">Optional</span>
            )}
          </div>
          {(item.metadata?.quantity || item.metadata?.unit) && (
            <p className="text-xs text-app-text-muted mt-0.5">
              Qty: {item.metadata.quantity || 1}{item.metadata.unit ? ` ${item.metadata.unit}` : ''}
            </p>
          )}
          {item.metadata?.specification && (
            <p className="text-xs text-app-accent mt-0.5 selectable">{item.metadata.specification}</p>
          )}
          {item.body && (
            <p className="text-sm text-app-text-2 mt-0.5 leading-relaxed selectable">{item.body}</p>
          )}
          {editMode && <AdminBar item={item} index={i} total={items.length} onEdit={onEdit} onDelete={onDelete} onReorder={onReorder} />}
        </li>
      ))}
    </ul>
  );
}

// ── Scope ────────────────────────────────────────────────────────────────────

function ScopeView({ items, editMode, onEdit, onDelete, onReorder }) {
  return (
    <div className="space-y-4">
      {items.map((item, i) => (
        <div key={item.id}>
          {item.title && (
            <h3 className="text-sm font-semibold text-app-text mb-1">{item.title}</h3>
          )}
          <p className={`text-sm leading-relaxed whitespace-pre-wrap selectable ${item.isCritical ? 'text-app-warning' : 'text-app-text-2'}`}>
            {item.body}
          </p>
          {editMode && <AdminBar item={item} index={i} total={items.length} onEdit={onEdit} onDelete={onDelete} onReorder={onReorder} />}
        </div>
      ))}
    </div>
  );
}

// ── Procedure ────────────────────────────────────────────────────────────────

function ProcedureView({ items, editMode, onEdit, onDelete, onReorder }) {
  return (
    <ol className="space-y-5">
      {items.map((item, i) => (
        <li key={item.id} className="flex gap-3">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-app-accent text-app-accent-text flex items-center justify-center text-xs font-bold mt-0.5">
            {i + 1}
          </span>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm text-app-text leading-snug selectable">{item.title}</p>
            {item.body && (
              <p className="text-sm text-app-text-2 mt-1 leading-relaxed selectable">{item.body}</p>
            )}
            {item.metadata?.warning && (
              <div className="mt-2 flex items-start gap-1.5 text-xs text-app-danger">
                <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
                <span className="selectable"><span className="font-semibold">Warning:</span> {item.metadata.warning}</span>
              </div>
            )}
            {item.metadata?.tip && (
              <div className="mt-1.5 flex items-start gap-1.5 text-xs text-app-info">
                <Info size={12} className="flex-shrink-0 mt-0.5" />
                <span className="selectable"><span className="font-semibold">Tip:</span> {item.metadata.tip}</span>
              </div>
            )}
            {editMode && <AdminBar item={item} index={i} total={items.length} onEdit={onEdit} onDelete={onDelete} onReorder={onReorder} />}
          </div>
        </li>
      ))}
    </ol>
  );
}

// ── Safety ───────────────────────────────────────────────────────────────────

function SafetyView({ items, editMode, onEdit, onDelete, onReorder }) {
  const SEV = {
    Critical: { icon: ShieldAlert, textCls: 'text-app-danger', label: 'CRITICAL' },
    Warning:  { icon: AlertTriangle, textCls: 'text-app-warning', label: 'WARNING' },
    Caution:  { icon: AlertCircle,   textCls: 'text-app-warning', label: 'CAUTION' },
    Information: { icon: Info,       textCls: 'text-app-info',    label: null },
  };

  return (
    <ul className="space-y-3">
      {items.map((item, i) => {
        const sev = SEV[item.metadata?.severity] || SEV.Information;
        const Icon = sev.icon;
        const isCritical = item.metadata?.severity === 'Critical';
        return (
          <li key={item.id}>
            <div className="flex items-start gap-2">
              <Icon size={14} className={`flex-shrink-0 mt-0.5 ${sev.textCls}`} />
              <div className="flex-1 min-w-0">
                {isCritical && (
                  <span className={`text-xs font-bold uppercase tracking-wide mr-1.5 ${sev.textCls}`}>CRITICAL —</span>
                )}
                <span className="text-sm font-semibold text-app-text selectable">{item.title}</span>
                {item.body && (
                  <p className="text-sm text-app-text-2 mt-0.5 leading-relaxed selectable">{item.body}</p>
                )}
                {item.metadata?.requiredAction && (
                  <p className="text-xs text-app-text-2 mt-1 selectable">
                    <span className="font-semibold">Required Action:</span> {item.metadata.requiredAction}
                  </p>
                )}
              </div>
            </div>
            {editMode && <AdminBar item={item} index={i} total={items.length} onEdit={onEdit} onDelete={onDelete} onReorder={onReorder} />}
          </li>
        );
      })}
    </ul>
  );
}

// ── Quality Standards ────────────────────────────────────────────────────────

function QualityView({ items, editMode, onEdit, onDelete, onReorder }) {
  return (
    <ul className="space-y-3">
      {items.map((item, i) => (
        <li key={item.id}>
          <div className="flex items-start gap-2">
            {item.isCritical && (
              <span className="flex-shrink-0 text-xs font-bold text-app-danger uppercase mt-0.5">Critical</span>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm text-app-text selectable">{item.title}</p>
              {item.body && (
                <p className="text-sm text-app-text-2 mt-0.5 leading-relaxed selectable">{item.body}</p>
              )}
            </div>
          </div>
          {editMode && <AdminBar item={item} index={i} total={items.length} onEdit={onEdit} onDelete={onDelete} onReorder={onReorder} />}
        </li>
      ))}
    </ul>
  );
}