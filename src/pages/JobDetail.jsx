import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useApp } from '@/lib/AppContext';
import { useCompany } from '@/lib/CompanyContext';
import {
  ArrowLeft, Star, Clock, Pencil, Plus, Trash2, ArrowUp, ArrowDown,
  CheckCircle2, Circle, AlertTriangle, Info, AlertCircle, ShieldAlert,
  Camera, Check, Upload
} from 'lucide-react';
import { SECTION_MAP, SEVERITY_LEVELS } from '@/lib/constants';
import ContentEditDialog from '@/components/sections/ContentEditDialog';
import { Image } from '@/components/ui/image';

const DISPLAY_ORDER = ['tools', 'materials', 'scope', 'procedure', 'safety', 'documentation', 'quality'];

const RESULT_STYLES = {
  'Pass': 'border-app-success text-app-success bg-app-success-bg',
  'Fail': 'border-app-danger text-app-danger bg-app-danger-bg',
  'Not Applicable': 'border-app-border text-app-text-muted bg-app-elevated',
};

export default function JobDetail() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const { isFavorite, toggleFavorite, addRecentlyViewed, isAdmin, session, setSessionItem } = useApp();
  const { activeCompany } = useCompany();
  const [job, setJob] = useState(null);
  const [sections, setSections] = useState([]);
  const [contentBySection, setContentBySection] = useState({});
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [editSectionType, setEditSectionType] = useState(null);
  const [showAddFor, setShowAddFor] = useState(null);

  const loadData = useCallback(async () => {
    try {
      const [j, secs, contents] = await Promise.all([
        base44.entities.Job.get(jobId),
        base44.entities.JobSection.filter({ jobId }, 'sortOrder', 10),
        base44.entities.SectionContent.filter({ jobId }, 'sortOrder', 500),
      ]);
      setJob(j);
      setSections(secs || []);
      const bySection = {};
      for (const item of (contents || [])) {
        if (!bySection[item.sectionType]) bySection[item.sectionType] = [];
        bySection[item.sectionType].push(item);
      }
      for (const key of Object.keys(bySection)) {
        bySection[key].sort((a, b) => a.sortOrder - b.sortOrder);
      }
      setContentBySection(bySection);
      // Security: verify the job belongs to the active company
      if (j && activeCompany && j.companyId && j.companyId !== activeCompany.id) {
        navigate('/');
        return;
      }
      if (j) addRecentlyViewed(j.id, j.title);
    } catch (err) {
      navigate('/');
    }
    setLoading(false);
  }, [jobId]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSaveItem = async (data) => {
    const st = editSectionType || showAddFor;
    if (!st) return;
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
      });
      setContentBySection(prev => ({ ...prev, [st]: [...(prev[st] || []), created] }));
    }
    setEditItem(null); setEditSectionType(null); setShowAddFor(null);
  };

  const handleDelete = async (sectionType, id) => {
    await base44.entities.SectionContent.delete(id);
    setContentBySection(prev => ({ ...prev, [sectionType]: (prev[sectionType] || []).filter(i => i.id !== id) }));
  };

  const handleReorder = async (sectionType, index, dir) => {
    const items = [...(contentBySection[sectionType] || [])];
    const swap = index + dir;
    if (swap < 0 || swap >= items.length) return;
    [items[index], items[swap]] = [items[swap], items[index]];
    items.forEach((item, i) => base44.entities.SectionContent.update(item.id, { sortOrder: i }));
    setContentBySection(prev => ({ ...prev, [sectionType]: items.map((item, i) => ({ ...item, sortOrder: i })) }));
  };

  const handlePhotoUpload = async (itemId, sectionType, file) => {
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    const item = (contentBySection[sectionType] || []).find(i => i.id === itemId);
    const updated = await base44.entities.SectionContent.update(itemId, {
      metadata: { ...(item?.metadata || {}), photoUrl: file_url },
    });
    setContentBySection(prev => ({
      ...prev,
      [sectionType]: (prev[sectionType] || []).map(i => i.id === itemId ? updated : i),
    }));
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
      <div
        className="bg-app-surface border-b border-app-border sticky top-0 z-40"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="icon-btn no-select touch-active" aria-label="Back"><ArrowLeft size={22} className="text-app-text-2" /></button>
          <h1 className="font-semibold text-app-text flex-1 truncate no-select">{job.title}</h1>
          <button onClick={() => toggleFavorite(job.id)} className="icon-btn no-select touch-active" aria-label="Toggle favorite">
            <Star size={20} className={isFavorite(job.id) ? 'text-yellow-500 fill-yellow-500' : 'text-app-text-disabled'} />
          </button>
          {isAdmin && (
            <button onClick={() => setEditMode(e => !e)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors no-select touch-active ${editMode ? 'bg-app-accent text-app-accent-text' : 'bg-app-elevated text-app-text-2'}`}>
              <Pencil size={14} />{editMode ? 'Done' : 'Edit'}
            </button>
          )}
        </div>
      </div>

      {/* Job metadata */}
      <div className="px-4 pt-4 pb-2">
        <div className="bg-app-card border border-app-border rounded-xl p-4">
          <p className="text-xs text-app-accent font-semibold uppercase mb-1">{job.trade} · {job.category}</p>
          <p className="text-sm text-app-text-2 mb-3">{job.shortDescription}</p>
          <div className="flex flex-wrap gap-3 text-xs text-app-text-muted">
            <span className="flex items-center gap-1"><Clock size={12} />{job.estimatedDuration}</span>
            <span className="px-2 py-0.5 bg-app-elevated rounded-full">{job.skillLevel}</span>
          </div>
          {job.tags?.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {job.tags.map(t => <span key={t} className="text-xs px-2 py-0.5 bg-app-elevated text-app-text-muted rounded-full">#{t}</span>)}
            </div>
          )}
        </div>
      </div>

      {/* Sections */}
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
            isAdmin={isAdmin}
            editMode={editMode}
            session={session}
            setSessionItem={setSessionItem}
            sessionPrefix={jobId}
            onEdit={(item) => { setEditItem(item); setEditSectionType(sectionType); }}
            onDelete={(id) => handleDelete(sectionType, id)}
            onReorder={(idx, dir) => handleReorder(sectionType, idx, dir)}
            onAdd={() => setShowAddFor(sectionType)}
            onPhotoUpload={(id, file) => handlePhotoUpload(id, sectionType, file)}
          />
        );
      })}

      <div style={{ height: 'calc(24px + env(safe-area-inset-bottom))' }} />

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

function SectionBlock({ sectionType, sectionDef, items, isAdmin, editMode, session, setSessionItem, sessionPrefix, onEdit, onDelete, onReorder, onAdd, onPhotoUpload }) {
  const Icon = sectionDef.icon;
  return (
    <div className="px-4 pt-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-app-info-bg rounded-lg flex items-center justify-center flex-shrink-0">
            <Icon size={16} className="text-app-accent" />
          </div>
          <h2 className="font-bold text-app-text text-base">{sectionDef.title}</h2>
        </div>
        {isAdmin && editMode && (
          <button onClick={onAdd} className="flex items-center gap-1 px-2.5 py-1 bg-app-accent text-app-accent-text rounded-lg text-xs font-medium no-select touch-active">
            <Plus size={13} /> Add
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <div className="bg-app-card border border-dashed border-app-border rounded-xl p-5 text-center">
          <p className="text-xs text-app-text-muted">{isAdmin && editMode ? 'Tap Add to create the first item.' : 'No content yet.'}</p>
        </div>
      ) : (
        <SectionRenderer sectionType={sectionType} items={items} isAdmin={isAdmin} editMode={editMode}
          session={session} setSessionItem={setSessionItem} sessionPrefix={sessionPrefix}
          onEdit={onEdit} onDelete={onDelete} onReorder={onReorder} onPhotoUpload={onPhotoUpload} />
      )}
    </div>
  );
}

function AdminBar({ item, index, total, onEdit, onDelete, onReorder }) {
  return (
    <div className="flex items-center gap-1 pt-2 mt-2 border-t border-app-divider no-select">
      <button onClick={e => { e.stopPropagation(); onEdit(item); }} className="px-2 py-1 text-xs text-app-accent font-medium flex items-center gap-1 touch-active"><Pencil size={11} /> Edit</button>
      <button onClick={e => { e.stopPropagation(); onDelete(item.id); }} className="px-2 py-1 text-xs text-app-danger font-medium flex items-center gap-1 touch-active"><Trash2 size={11} /> Delete</button>
      <div className="flex-1" />
      <button onClick={e => { e.stopPropagation(); onReorder(index, -1); }} disabled={index === 0} className="icon-btn text-app-text-muted disabled:opacity-25 touch-active" aria-label="Move up"><ArrowUp size={13} /></button>
      <button onClick={e => { e.stopPropagation(); onReorder(index, 1); }} disabled={index === total - 1} className="icon-btn text-app-text-muted disabled:opacity-25 touch-active" aria-label="Move down"><ArrowDown size={13} /></button>
    </div>
  );
}

function PhotoUpload({ itemId, onPhotoUpload }) {
  const ref = useRef();
  return (
    <>
      <button onClick={() => ref.current?.click()} className="flex items-center gap-1 text-xs text-app-accent mt-1.5">
        <Upload size={11} /> Upload photo
      </button>
      <input ref={ref} type="file" accept="image/*" className="hidden"
        onChange={e => { if (e.target.files[0]) onPhotoUpload(itemId, e.target.files[0]); }} />
    </>
  );
}

function SectionRenderer(props) {
  const { sectionType } = props;
  if (sectionType === 'tools') return <ToolsView {...props} />;
  if (sectionType === 'materials') return <MaterialsView {...props} />;
  if (sectionType === 'scope') return <ScopeView {...props} />;
  if (sectionType === 'procedure') return <ProcedureView {...props} />;
  if (sectionType === 'safety') return <SafetyView {...props} />;
  if (sectionType === 'documentation') return <DocumentationView {...props} />;
  if (sectionType === 'quality') return <QualityView {...props} />;
  return null;
}

function ToolsView({ items, editMode, session, setSessionItem, sessionPrefix, onEdit, onDelete, onReorder, onPhotoUpload }) {
  return (
    <div className="space-y-3">
      {items.map((item, i) => {
        const gathered = session[`${sessionPrefix}_tools_${item.id}`];
        return (
          <div key={item.id} className={`bg-app-card border rounded-xl overflow-hidden ${gathered && !editMode ? 'border-app-success' : 'border-app-border'}`}>
            <div className="flex gap-3 p-3">
              <div className="flex-shrink-0 w-16 h-16 rounded-lg bg-app-elevated overflow-hidden border border-app-border">
                {item.metadata?.photoUrl
                  ? <Image src={item.metadata.photoUrl} className="w-full h-full" fittingType="fill" />
                  : <div className="w-full h-full flex items-center justify-center text-2xl">🔧</div>}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-1 mb-0.5">
                  <h4 className={`font-semibold text-sm ${gathered && !editMode ? 'line-through text-app-text-muted' : 'text-app-text'}`}>{item.title}</h4>
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${item.isRequired ? 'bg-app-info-bg text-app-info' : 'bg-app-elevated text-app-text-muted'}`}>
                    {item.isRequired ? 'Required' : 'Optional'}
                  </span>
                </div>
                <p className="text-xs text-app-text-muted">Qty: {item.metadata?.quantity || 1}</p>
                {item.body && <p className="text-xs text-app-text-muted mt-0.5">{item.body}</p>}
                {editMode && <PhotoUpload itemId={item.id} onPhotoUpload={onPhotoUpload} />}
              </div>
              {!editMode && (
                <button onClick={e => { e.stopPropagation(); setSessionItem(`${sessionPrefix}_tools_${item.id}`, !gathered); }} className="flex-shrink-0 self-center ml-1 icon-btn no-select touch-active" aria-label={gathered ? 'Mark not gathered' : 'Mark gathered'}>
                  {gathered ? <CheckCircle2 size={22} className="text-app-success" /> : <Circle size={22} className="text-app-text-disabled" />}
                </button>
              )}
            </div>
            {editMode && <div className="px-3 pb-3"><AdminBar item={item} index={i} total={items.length} onEdit={onEdit} onDelete={onDelete} onReorder={onReorder} /></div>}
          </div>
        );
      })}
    </div>
  );
}

function MaterialsView({ items, editMode, session, setSessionItem, sessionPrefix, onEdit, onDelete, onReorder, onPhotoUpload }) {
  return (
    <div className="space-y-3">
      {items.map((item, i) => {
        const gathered = session[`${sessionPrefix}_materials_${item.id}`];
        return (
          <div key={item.id} className={`bg-app-card border rounded-xl overflow-hidden ${gathered && !editMode ? 'border-app-success' : 'border-app-border'}`}>
            <div className="flex gap-3 p-3">
              <div className="flex-shrink-0 w-16 h-16 rounded-lg bg-app-elevated overflow-hidden border border-app-border">
                {item.metadata?.photoUrl
                  ? <Image src={item.metadata.photoUrl} className="w-full h-full" fittingType="fill" />
                  : <div className="w-full h-full flex items-center justify-center text-2xl">📦</div>}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-1 mb-0.5">
                  <h4 className={`font-semibold text-sm ${gathered && !editMode ? 'line-through text-app-text-muted' : 'text-app-text'}`}>{item.title}</h4>
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${item.isRequired ? 'bg-app-info-bg text-app-info' : 'bg-app-elevated text-app-text-muted'}`}>
                    {item.isRequired ? 'Required' : 'Optional'}
                  </span>
                </div>
                <p className="text-xs text-app-text-muted">Qty: {item.metadata?.quantity || 1}{item.metadata?.unit ? ` ${item.metadata.unit}` : ''}</p>
                {item.metadata?.specification && <p className="text-xs text-app-accent mt-0.5">{item.metadata.specification}</p>}
                {item.body && <p className="text-xs text-app-text-muted mt-0.5">{item.body}</p>}
                {editMode && <PhotoUpload itemId={item.id} onPhotoUpload={onPhotoUpload} />}
              </div>
              {!editMode && (
                <button onClick={e => { e.stopPropagation(); setSessionItem(`${sessionPrefix}_materials_${item.id}`, !gathered); }} className="flex-shrink-0 self-center ml-1 icon-btn no-select touch-active" aria-label={gathered ? 'Mark not gathered' : 'Mark gathered'}>
                  {gathered ? <CheckCircle2 size={22} className="text-app-success" /> : <Circle size={22} className="text-app-text-disabled" />}
                </button>
              )}
            </div>
            {editMode && <div className="px-3 pb-3"><AdminBar item={item} index={i} total={items.length} onEdit={onEdit} onDelete={onDelete} onReorder={onReorder} /></div>}
          </div>
        );
      })}
    </div>
  );
}

function ScopeView({ items, editMode, onEdit, onDelete, onReorder }) {
  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div key={item.id} className="bg-app-card border border-app-border rounded-xl p-4">
          <h4 className="font-semibold text-sm text-app-text mb-1 no-select">{item.title}</h4>
          <p className={`text-sm whitespace-pre-wrap leading-relaxed selectable ${item.isCritical ? 'text-app-warning' : 'text-app-text-2'}`}>{item.body}</p>
          {editMode && <AdminBar item={item} index={i} total={items.length} onEdit={onEdit} onDelete={onDelete} onReorder={onReorder} />}
        </div>
      ))}
    </div>
  );
}

function ProcedureView({ items, editMode, session, setSessionItem, sessionPrefix, onEdit, onDelete, onReorder }) {
  return (
    <div className="space-y-3">
      {items.map((item, i) => {
        const done = session[`${sessionPrefix}_proc_${item.id}`];
        return (
          <div key={item.id} className={`bg-app-card border rounded-xl p-4 ${done && !editMode ? 'border-app-success' : 'border-app-border'}`}>
            <div className="flex items-start gap-3">
              {!editMode && (
                <button onClick={e => { e.stopPropagation(); setSessionItem(`${sessionPrefix}_proc_${item.id}`, !done); }} className="flex-shrink-0 mt-0.5 icon-btn no-select touch-active" aria-label={done ? 'Mark incomplete' : 'Mark complete'}>
                  {done ? <CheckCircle2 size={20} className="text-app-success" /> : <Circle size={20} className="text-app-text-disabled" />}
                </button>
              )}
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="flex-shrink-0 w-6 h-6 bg-app-accent text-app-accent-text rounded-full flex items-center justify-center text-xs font-bold">{i + 1}</span>
                  <h4 className={`font-semibold text-sm ${done && !editMode ? 'line-through text-app-text-muted' : 'text-app-text'}`}>{item.title}</h4>
                </div>
                <p className="text-sm text-app-text-2 ml-8 leading-relaxed selectable">{item.body}</p>
                {item.metadata?.warning && (
                  <div className="ml-8 mt-2 px-3 py-2 bg-app-danger-bg border border-app-danger rounded-lg flex items-start gap-1.5">
                    <AlertTriangle size={13} className="text-app-danger flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-app-danger"><span className="font-semibold">Warning:</span> {item.metadata.warning}</p>
                  </div>
                )}
                {item.metadata?.tip && (
                  <div className="ml-8 mt-1.5 px-3 py-2 bg-app-info-bg border border-app-info rounded-lg flex items-start gap-1.5">
                    <Info size={13} className="text-app-info flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-app-info"><span className="font-semibold">Tip:</span> {item.metadata.tip}</p>
                  </div>
                )}
              </div>
            </div>
            {editMode && <AdminBar item={item} index={i} total={items.length} onEdit={onEdit} onDelete={onDelete} onReorder={onReorder} />}
          </div>
        );
      })}
    </div>
  );
}

function SafetyView({ items, editMode, session, setSessionItem, sessionPrefix, onEdit, onDelete, onReorder }) {
  const ackKey = `${sessionPrefix}_safety_ack`;
  const acknowledged = session[ackKey];

  const SEV_STYLES = {
    Critical: { bg: 'bg-app-danger-bg', border: 'border-app-danger', text: 'text-app-danger', icon: ShieldAlert },
    Warning: { bg: 'bg-app-warning-bg', border: 'border-app-warning', text: 'text-app-warning', icon: AlertTriangle },
    Caution: { bg: 'bg-app-warning-bg', border: 'border-app-warning', text: 'text-app-warning', icon: AlertCircle },
    Information: { bg: 'bg-app-info-bg', border: 'border-app-info', text: 'text-app-info', icon: Info },
  };

  return (
    <div>
      <div className="space-y-3 mb-4">
        {items.map((item, i) => {
          const sev = SEV_STYLES[item.metadata?.severity] || SEV_STYLES.Information;
          const SevIcon = sev.icon;
          return (
            <div key={item.id} className="bg-app-card border border-app-border rounded-xl p-4">
              <div className={`p-3 rounded-lg border ${sev.bg} ${sev.border}`}>
                <div className="flex items-center gap-2 mb-1">
                  <SevIcon size={15} className={sev.text} />
                  <span className={`text-xs font-bold uppercase tracking-wide ${sev.text}`}>{item.metadata?.severity || 'Information'}</span>
                </div>
                <h4 className="font-semibold text-sm text-app-text mb-1">{item.title}</h4>
                <p className="text-sm text-app-text-2 leading-relaxed selectable">{item.body}</p>
                {item.metadata?.requiredAction && (
                  <p className="text-xs text-app-text-2 mt-2 pt-2 border-t border-app-divider">
                    <span className="font-semibold">Required Action:</span> {item.metadata.requiredAction}
                  </p>
                )}
              </div>
              {editMode && <AdminBar item={item} index={i} total={items.length} onEdit={onEdit} onDelete={onDelete} onReorder={onReorder} />}
            </div>
          );
        })}
      </div>
      {!editMode && (
        <div className={`rounded-xl p-4 border-2 ${acknowledged ? 'bg-app-success-bg border-app-success' : 'bg-app-card border-app-border'}`}>
          <label className="flex items-center gap-3 cursor-pointer no-select">
            <button onClick={e => { e.stopPropagation(); setSessionItem(ackKey, !acknowledged); }} className="icon-btn touch-active flex-shrink-0" aria-label="Acknowledge safety requirements">
              {acknowledged ? <CheckCircle2 size={24} className="text-app-success" /> : <Circle size={24} className="text-app-text-disabled" />}
            </button>
            <span className="text-sm font-medium text-app-text">I have reviewed all safety requirements for this job.</span>
          </label>
        </div>
      )}
    </div>
  );
}

function DocumentationView({ items, editMode, session, setSessionItem, sessionPrefix, onEdit, onDelete, onReorder }) {
  const completed = items.filter(i => session[`${sessionPrefix}_doc_${i.id}`]).length;
  return (
    <div>
      {items.length > 0 && (
        <div className="mb-3 bg-app-info-bg border border-app-border rounded-xl p-3">
          <div className="flex justify-between mb-1">
            <span className="text-xs font-semibold text-app-info">{completed} of {items.length} complete</span>
            <span className="text-xs text-app-info">{Math.round((completed / items.length) * 100)}%</span>
          </div>
          <div className="h-1.5 bg-app-elevated rounded-full overflow-hidden">
            <div className="h-full bg-app-accent rounded-full transition-all" style={{ width: `${(completed / items.length) * 100}%` }} />
          </div>
        </div>
      )}
      <div className="space-y-2.5">
        {items.map((item, i) => {
          const done = session[`${sessionPrefix}_doc_${i.id}`];
          const docType = item.metadata?.documentationType || 'Note';
          return (
            <div key={item.id} className={`bg-app-card border rounded-xl p-4 ${done && !editMode ? 'border-app-success' : 'border-app-border'}`}>
              <div className="flex items-start gap-3">
                {!editMode && (
                  <button onClick={e => { e.stopPropagation(); setSessionItem(`${sessionPrefix}_doc_${item.id}`, !done); }} className="flex-shrink-0 mt-0.5 icon-btn no-select touch-active" aria-label={done ? 'Mark incomplete' : 'Mark complete'}>
                    {done ? <CheckCircle2 size={20} className="text-app-success" /> : <Circle size={20} className="text-app-text-disabled" />}
                  </button>
                )}
                <div className="flex-1">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-xs px-1.5 py-0.5 bg-app-elevated text-app-text-muted rounded">{docType}</span>
                    {item.isRequired && <span className="text-xs px-1.5 py-0.5 bg-app-info-bg text-app-info rounded">Required</span>}
                  </div>
                  <h4 className="font-semibold text-sm text-app-text">{item.title}</h4>
                  {item.body && <p className="text-xs text-app-text-muted mt-0.5">{item.body}</p>}
                  {!editMode && !done && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {docType.includes('photo') && (
                        <button onClick={() => setSessionItem(`${sessionPrefix}_doc_${item.id}`, true)}
                          className="text-xs px-2.5 py-1 bg-app-accent text-app-accent-text rounded-lg flex items-center gap-1">
                          <Camera size={11} /> Add Photo
                        </button>
                      )}
                      {(docType === 'Measurement' || docType === 'Note') && (
                        <input placeholder={docType === 'Measurement' ? 'Enter measurement' : 'Add note'}
                          className="text-xs px-2 py-1 bg-app-input border border-app-border rounded-lg flex-1 min-w-0 text-app-text placeholder:text-app-text-muted"
                          onBlur={e => { if (e.target.value) setSessionItem(`${sessionPrefix}_doc_${item.id}`, true); }} />
                      )}
                      <button onClick={() => setSessionItem(`${sessionPrefix}_doc_${item.id}`, true)}
                        className="text-xs px-2.5 py-1 border border-app-border text-app-text-2 rounded-lg">Mark Done</button>
                    </div>
                  )}
                  {!editMode && done && <p className="text-xs text-app-success mt-1 flex items-center gap-1"><Check size={11} /> Completed</p>}
                </div>
              </div>
              {editMode && <AdminBar item={item} index={i} total={items.length} onEdit={onEdit} onDelete={onDelete} onReorder={onReorder} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function QualityView({ items, editMode, session, setSessionItem, sessionPrefix, onEdit, onDelete, onReorder }) {
  const [finalNotes, setFinalNotes] = useState(session[`${sessionPrefix}_quality_notes`] || '');
  const [submitted, setSubmitted] = useState(!!session[`${sessionPrefix}_quality_submitted`]);
  const allAnswered = items.every(i => session[`${sessionPrefix}_quality_${i.id}_result`]);
  const failedWithoutNote = items.some(i => session[`${sessionPrefix}_quality_${i.id}_result`] === 'Fail' && !session[`${sessionPrefix}_quality_${i.id}_note`]);

  if (submitted && !editMode) {
    return (
      <div className="bg-app-card border border-app-success rounded-xl p-6 text-center">
        <CheckCircle2 size={36} className="text-app-success mx-auto mb-2" />
        <h4 className="font-semibold text-app-text mb-1">Checklist Submitted</h4>
        <p className="text-xs text-app-text-muted">Quality inspection completed and saved.</p>
        <button onClick={() => { setSubmitted(false); setSessionItem(`${sessionPrefix}_quality_submitted`, false); }}
          className="mt-3 text-xs text-app-accent underline">Review again</button>
      </div>
    );
  }

  return (
    <div>
      <div className="space-y-2.5">
        {items.map((item, i) => {
          const result = session[`${sessionPrefix}_quality_${item.id}_result`];
          const failNote = session[`${sessionPrefix}_quality_${item.id}_note`];
          return (
            <div key={item.id} className="bg-app-card border border-app-border rounded-xl p-4">
              <div className="flex gap-1.5 mb-1.5">
                {item.isCritical && <span className="text-xs px-1.5 py-0.5 bg-app-danger-bg text-app-danger rounded font-medium">Critical</span>}
                {item.isRequired && <span className="text-xs px-1.5 py-0.5 bg-app-info-bg text-app-info rounded font-medium">Required</span>}
              </div>
              <h4 className="font-semibold text-sm text-app-text mb-1">{item.title}</h4>
              {item.body && <p className="text-xs text-app-text-muted mb-2">{item.body}</p>}
              {!editMode && (
                <>
                  <div className="flex gap-2">
                    {['Pass', 'Fail', 'Not Applicable'].map(r => (
                      <button key={r} onClick={e => {
                        e.stopPropagation();
                        setSessionItem(`${sessionPrefix}_quality_${item.id}_result`, r);
                        if (r !== 'Fail') setSessionItem(`${sessionPrefix}_quality_${item.id}_note`, undefined);
                      }} className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors no-select touch-active ${result === r ? RESULT_STYLES[r] : 'border-app-border text-app-text-muted bg-app-card'}`}>
                        {r === 'Not Applicable' ? 'N/A' : r}
                      </button>
                    ))}
                  </div>
                  {result === 'Fail' && (
                    <input placeholder="Required: Explain the failure" value={failNote || ''}
                      onChange={e => setSessionItem(`${sessionPrefix}_quality_${item.id}_note`, e.target.value)}
                      className="mt-2 w-full px-3 py-1.5 bg-app-input border border-app-danger rounded-lg text-xs text-app-text placeholder:text-app-text-muted" />
                  )}
                </>
              )}
              {editMode && <AdminBar item={item} index={i} total={items.length} onEdit={onEdit} onDelete={onDelete} onReorder={onReorder} />}
            </div>
          );
        })}
      </div>
      {!editMode && items.length > 0 && (
        <div className="mt-4 bg-app-card border border-app-border rounded-xl p-4">
          <h4 className="font-semibold text-sm text-app-text mb-2">Final Notes</h4>
          <textarea value={finalNotes} onChange={e => setFinalNotes(e.target.value)} rows={3}
            placeholder="Add final notes..."
            className="w-full px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text placeholder:text-app-text-muted" />
          <button onClick={() => { setSessionItem(`${sessionPrefix}_quality_submitted`, true); setSessionItem(`${sessionPrefix}_quality_notes`, finalNotes); setSubmitted(true); }}
            disabled={!allAnswered || failedWithoutNote}
            className="w-full mt-3 py-2.5 bg-app-accent text-app-accent-text rounded-xl text-sm font-semibold disabled:bg-app-disabled disabled:text-app-text-disabled">
            Submit Quality Checklist
          </button>
          {(!allAnswered || failedWithoutNote) && (
            <p className="text-xs text-app-warning mt-1.5 text-center">
              {!allAnswered ? 'All items must be answered.' : 'Failed items require a note.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}