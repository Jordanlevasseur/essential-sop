import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useApp } from '@/lib/AppContext';
import {
  ArrowLeft, Star, Clock, Pencil, Plus, Trash2, ArrowUp, ArrowDown,
  CheckCircle2, Circle, AlertTriangle, Info, AlertCircle, ShieldAlert,
  Camera, Check, Upload
} from 'lucide-react';
import { SECTION_MAP, SEVERITY_LEVELS } from '@/lib/constants';
import ContentEditDialog from '@/components/sections/ContentEditDialog';
import { Image } from '@/components/ui/image';

// Section display order for the single-page layout
const DISPLAY_ORDER = ['tools', 'materials', 'scope', 'procedure', 'safety', 'documentation', 'quality'];

const RESULT_STYLES = {
  'Pass': 'border-green-500 text-green-700 bg-green-50',
  'Fail': 'border-red-500 text-red-700 bg-red-50',
  'Not Applicable': 'border-neutral-400 text-neutral-600 bg-neutral-100',
};

export default function JobDetail() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const { isFavorite, toggleFavorite, addRecentlyViewed, isAdmin, session, setSessionItem } = useApp();
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
      if (j) addRecentlyViewed(j.id, j.title);
    } catch (err) {
      // Job not found — stale ID, go back to jobs list
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
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-neutral-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }
  if (!job) return <div className="p-4 text-center text-neutral-400">Job not found.</div>;

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Sticky header — sits below notch/Dynamic Island via safe-area-inset-top */}
      <div
        className="bg-white border-b border-neutral-200 sticky top-0 z-40"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate(-1)}><ArrowLeft size={22} className="text-neutral-700" /></button>
          <h1 className="font-semibold text-neutral-900 flex-1 truncate">{job.title}</h1>
          <button onClick={() => toggleFavorite(job.id)}>
            <Star size={20} className={isFavorite(job.id) ? 'text-yellow-500 fill-yellow-500' : 'text-neutral-300'} />
          </button>
          {isAdmin && (
            <button onClick={() => setEditMode(e => !e)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors ${editMode ? 'bg-blue-600 text-white' : 'bg-neutral-100 text-neutral-700'}`}>
              <Pencil size={14} />{editMode ? 'Done' : 'Edit'}
            </button>
          )}
        </div>
      </div>

      {/* Job metadata */}
      <div className="px-4 pt-4 pb-2">
        <div className="bg-white border border-neutral-200 rounded-xl p-4">
          <p className="text-xs text-blue-600 font-semibold uppercase mb-1">{job.trade} · {job.category}</p>
          <p className="text-sm text-neutral-600 mb-3">{job.shortDescription}</p>
          <div className="flex flex-wrap gap-3 text-xs text-neutral-500">
            <span className="flex items-center gap-1"><Clock size={12} />{job.estimatedDuration}</span>
            <span className="px-2 py-0.5 bg-neutral-100 rounded-full">{job.skillLevel}</span>
          </div>
          {job.tags?.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {job.tags.map(t => <span key={t} className="text-xs px-2 py-0.5 bg-neutral-100 text-neutral-500 rounded-full">#{t}</span>)}
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

      {/* Bottom spacer: clear the home indicator on sub-pages (no tab nav) */}
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

/* ── Section wrapper ─────────────────────────────────────────────────────── */
function SectionBlock({ sectionType, sectionDef, items, isAdmin, editMode, session, setSessionItem, sessionPrefix, onEdit, onDelete, onReorder, onAdd, onPhotoUpload }) {
  const Icon = sectionDef.icon;
  return (
    <div className="px-4 pt-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
            <Icon size={16} className="text-blue-600" />
          </div>
          <h2 className="font-bold text-neutral-900 text-base">{sectionDef.title}</h2>
        </div>
        {isAdmin && editMode && (
          <button onClick={onAdd} className="flex items-center gap-1 px-2.5 py-1 bg-blue-600 text-white rounded-lg text-xs font-medium">
            <Plus size={13} /> Add
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <div className="bg-white border border-dashed border-neutral-200 rounded-xl p-5 text-center">
          <p className="text-xs text-neutral-400">{isAdmin && editMode ? 'Tap Add to create the first item.' : 'No content yet.'}</p>
        </div>
      ) : (
        <SectionRenderer sectionType={sectionType} items={items} isAdmin={isAdmin} editMode={editMode}
          session={session} setSessionItem={setSessionItem} sessionPrefix={sessionPrefix}
          onEdit={onEdit} onDelete={onDelete} onReorder={onReorder} onPhotoUpload={onPhotoUpload} />
      )}
    </div>
  );
}

/* ── Admin controls bar ──────────────────────────────────────────────────── */
function AdminBar({ item, index, total, onEdit, onDelete, onReorder }) {
  return (
    <div className="flex items-center gap-1 pt-2 mt-2 border-t border-neutral-100">
      <button onClick={() => onEdit(item)} className="px-2 py-1 text-xs text-blue-600 font-medium flex items-center gap-1"><Pencil size={11} /> Edit</button>
      <button onClick={() => onDelete(item.id)} className="px-2 py-1 text-xs text-red-500 font-medium flex items-center gap-1"><Trash2 size={11} /> Delete</button>
      <div className="flex-1" />
      <button onClick={() => onReorder(index, -1)} disabled={index === 0} className="p-1 text-neutral-400 disabled:opacity-25"><ArrowUp size={13} /></button>
      <button onClick={() => onReorder(index, 1)} disabled={index === total - 1} className="p-1 text-neutral-400 disabled:opacity-25"><ArrowDown size={13} /></button>
    </div>
  );
}

/* ── Photo upload button ─────────────────────────────────────────────────── */
function PhotoUpload({ itemId, onPhotoUpload }) {
  const ref = useRef();
  return (
    <>
      <button onClick={() => ref.current?.click()} className="flex items-center gap-1 text-xs text-blue-600 mt-1.5">
        <Upload size={11} /> Upload photo
      </button>
      <input ref={ref} type="file" accept="image/*" className="hidden"
        onChange={e => { if (e.target.files[0]) onPhotoUpload(itemId, e.target.files[0]); }} />
    </>
  );
}

/* ── Section renderer router ─────────────────────────────────────────────── */
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

/* ── 1. Tools ────────────────────────────────────────────────────────────── */
function ToolsView({ items, editMode, session, setSessionItem, sessionPrefix, onEdit, onDelete, onReorder, onPhotoUpload }) {
  return (
    <div className="space-y-3">
      {items.map((item, i) => {
        const gathered = session[`${sessionPrefix}_tools_${item.id}`];
        return (
          <div key={item.id} className={`bg-white border rounded-xl overflow-hidden ${gathered && !editMode ? 'border-green-200' : 'border-neutral-200'}`}>
            <div className="flex gap-3 p-3">
              <div className="flex-shrink-0 w-16 h-16 rounded-lg bg-neutral-100 overflow-hidden">
                {item.metadata?.photoUrl
                  ? <Image src={item.metadata.photoUrl} className="w-full h-full" fittingType="fill" />
                  : <div className="w-full h-full flex items-center justify-center text-2xl">🔧</div>}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-1 mb-0.5">
                  <h4 className={`font-semibold text-sm ${gathered && !editMode ? 'line-through text-neutral-400' : 'text-neutral-900'}`}>{item.title}</h4>
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${item.isRequired ? 'bg-blue-100 text-blue-700' : 'bg-neutral-100 text-neutral-500'}`}>
                    {item.isRequired ? 'Required' : 'Optional'}
                  </span>
                </div>
                <p className="text-xs text-neutral-500">Qty: {item.metadata?.quantity || 1}</p>
                {item.body && <p className="text-xs text-neutral-400 mt-0.5">{item.body}</p>}
                {editMode && <PhotoUpload itemId={item.id} onPhotoUpload={onPhotoUpload} />}
              </div>
              {!editMode && (
                <button onClick={() => setSessionItem(`${sessionPrefix}_tools_${item.id}`, !gathered)} className="flex-shrink-0 self-center ml-1">
                  {gathered ? <CheckCircle2 size={22} className="text-green-500" /> : <Circle size={22} className="text-neutral-300" />}
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

/* ── 2. Materials ────────────────────────────────────────────────────────── */
function MaterialsView({ items, editMode, session, setSessionItem, sessionPrefix, onEdit, onDelete, onReorder, onPhotoUpload }) {
  return (
    <div className="space-y-3">
      {items.map((item, i) => {
        const gathered = session[`${sessionPrefix}_materials_${item.id}`];
        return (
          <div key={item.id} className={`bg-white border rounded-xl overflow-hidden ${gathered && !editMode ? 'border-green-200' : 'border-neutral-200'}`}>
            <div className="flex gap-3 p-3">
              <div className="flex-shrink-0 w-16 h-16 rounded-lg bg-neutral-100 overflow-hidden">
                {item.metadata?.photoUrl
                  ? <Image src={item.metadata.photoUrl} className="w-full h-full" fittingType="fill" />
                  : <div className="w-full h-full flex items-center justify-center text-2xl">📦</div>}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-1 mb-0.5">
                  <h4 className={`font-semibold text-sm ${gathered && !editMode ? 'line-through text-neutral-400' : 'text-neutral-900'}`}>{item.title}</h4>
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${item.isRequired ? 'bg-blue-100 text-blue-700' : 'bg-neutral-100 text-neutral-500'}`}>
                    {item.isRequired ? 'Required' : 'Optional'}
                  </span>
                </div>
                <p className="text-xs text-neutral-500">Qty: {item.metadata?.quantity || 1}{item.metadata?.unit ? ` ${item.metadata.unit}` : ''}</p>
                {item.metadata?.specification && <p className="text-xs text-blue-600 mt-0.5">{item.metadata.specification}</p>}
                {item.body && <p className="text-xs text-neutral-400 mt-0.5">{item.body}</p>}
                {editMode && <PhotoUpload itemId={item.id} onPhotoUpload={onPhotoUpload} />}
              </div>
              {!editMode && (
                <button onClick={() => setSessionItem(`${sessionPrefix}_materials_${item.id}`, !gathered)} className="flex-shrink-0 self-center ml-1">
                  {gathered ? <CheckCircle2 size={22} className="text-green-500" /> : <Circle size={22} className="text-neutral-300" />}
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

/* ── 3. Scope ────────────────────────────────────────────────────────────── */
function ScopeView({ items, editMode, onEdit, onDelete, onReorder }) {
  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div key={item.id} className="bg-white border border-neutral-200 rounded-xl p-4">
          <h4 className="font-semibold text-sm text-neutral-900 mb-1">{item.title}</h4>
          <p className={`text-sm whitespace-pre-wrap leading-relaxed ${item.isCritical ? 'text-orange-700' : 'text-neutral-600'}`}>{item.body}</p>
          {editMode && <AdminBar item={item} index={i} total={items.length} onEdit={onEdit} onDelete={onDelete} onReorder={onReorder} />}
        </div>
      ))}
    </div>
  );
}

/* ── 4. Procedure ────────────────────────────────────────────────────────── */
function ProcedureView({ items, editMode, session, setSessionItem, sessionPrefix, onEdit, onDelete, onReorder }) {
  return (
    <div className="space-y-3">
      {items.map((item, i) => {
        const done = session[`${sessionPrefix}_proc_${item.id}`];
        return (
          <div key={item.id} className={`bg-white border rounded-xl p-4 ${done && !editMode ? 'border-green-200' : 'border-neutral-200'}`}>
            <div className="flex items-start gap-3">
              {!editMode && (
                <button onClick={() => setSessionItem(`${sessionPrefix}_proc_${item.id}`, !done)} className="flex-shrink-0 mt-0.5">
                  {done ? <CheckCircle2 size={20} className="text-green-500" /> : <Circle size={20} className="text-neutral-300" />}
                </button>
              )}
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">{i + 1}</span>
                  <h4 className={`font-semibold text-sm ${done && !editMode ? 'line-through text-neutral-400' : 'text-neutral-900'}`}>{item.title}</h4>
                </div>
                <p className="text-sm text-neutral-600 ml-8 leading-relaxed">{item.body}</p>
                {item.metadata?.warning && (
                  <div className="ml-8 mt-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg flex items-start gap-1.5">
                    <AlertTriangle size={13} className="text-red-500 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-red-700"><span className="font-semibold">Warning:</span> {item.metadata.warning}</p>
                  </div>
                )}
                {item.metadata?.tip && (
                  <div className="ml-8 mt-1.5 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg flex items-start gap-1.5">
                    <Info size={13} className="text-blue-500 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-blue-700"><span className="font-semibold">Tip:</span> {item.metadata.tip}</p>
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

/* ── 5. Safety ───────────────────────────────────────────────────────────── */
function SafetyView({ items, editMode, session, setSessionItem, sessionPrefix, onEdit, onDelete, onReorder }) {
  const ackKey = `${sessionPrefix}_safety_ack`;
  const acknowledged = session[ackKey];
  return (
    <div>
      <div className="space-y-3 mb-4">
        {items.map((item, i) => {
          const severity = SEVERITY_LEVELS.find(s => s.value === item.metadata?.severity) || SEVERITY_LEVELS[0];
          const SevIcon = severity.icon;
          return (
            <div key={item.id} className="bg-white border border-neutral-200 rounded-xl p-4">
              <div className={`p-3 rounded-lg border ${severity.bg} ${severity.border}`}>
                <div className="flex items-center gap-2 mb-1">
                  <SevIcon size={15} className={severity.color} />
                  <span className={`text-xs font-bold uppercase tracking-wide ${severity.color}`}>{severity.value}</span>
                </div>
                <h4 className="font-semibold text-sm text-neutral-900 mb-1">{item.title}</h4>
                <p className="text-sm text-neutral-700 leading-relaxed">{item.body}</p>
                {item.metadata?.requiredAction && (
                  <p className="text-xs text-neutral-700 mt-2 pt-2 border-t border-neutral-200">
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
        <div className={`rounded-xl p-4 border-2 ${acknowledged ? 'bg-green-50 border-green-300' : 'bg-white border-neutral-300'}`}>
          <label className="flex items-center gap-3 cursor-pointer">
            <button onClick={() => setSessionItem(ackKey, !acknowledged)}>
              {acknowledged ? <CheckCircle2 size={24} className="text-green-500" /> : <Circle size={24} className="text-neutral-300" />}
            </button>
            <span className="text-sm font-medium text-neutral-900">I have reviewed all safety requirements for this job.</span>
          </label>
        </div>
      )}
    </div>
  );
}

/* ── 6. Documentation ────────────────────────────────────────────────────── */
function DocumentationView({ items, editMode, session, setSessionItem, sessionPrefix, onEdit, onDelete, onReorder }) {
  const completed = items.filter(i => session[`${sessionPrefix}_doc_${i.id}`]).length;
  return (
    <div>
      {items.length > 0 && (
        <div className="mb-3 bg-blue-50 rounded-xl p-3">
          <div className="flex justify-between mb-1">
            <span className="text-xs font-semibold text-blue-700">{completed} of {items.length} complete</span>
            <span className="text-xs text-blue-500">{Math.round((completed / items.length) * 100)}%</span>
          </div>
          <div className="h-1.5 bg-blue-200 rounded-full overflow-hidden">
            <div className="h-full bg-blue-600 rounded-full transition-all" style={{ width: `${(completed / items.length) * 100}%` }} />
          </div>
        </div>
      )}
      <div className="space-y-2.5">
        {items.map((item, i) => {
          const done = session[`${sessionPrefix}_doc_${item.id}`];
          const docType = item.metadata?.documentationType || 'Note';
          return (
            <div key={item.id} className={`bg-white border rounded-xl p-4 ${done && !editMode ? 'border-green-200' : 'border-neutral-200'}`}>
              <div className="flex items-start gap-3">
                {!editMode && (
                  <button onClick={() => setSessionItem(`${sessionPrefix}_doc_${item.id}`, !done)} className="flex-shrink-0 mt-0.5">
                    {done ? <CheckCircle2 size={20} className="text-green-500" /> : <Circle size={20} className="text-neutral-300" />}
                  </button>
                )}
                <div className="flex-1">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-xs px-1.5 py-0.5 bg-neutral-100 text-neutral-600 rounded">{docType}</span>
                    {item.isRequired && <span className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">Required</span>}
                  </div>
                  <h4 className="font-semibold text-sm text-neutral-900">{item.title}</h4>
                  {item.body && <p className="text-xs text-neutral-500 mt-0.5">{item.body}</p>}
                  {!editMode && !done && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {docType.includes('photo') && (
                        <button onClick={() => setSessionItem(`${sessionPrefix}_doc_${item.id}`, true)}
                          className="text-xs px-2.5 py-1 bg-blue-600 text-white rounded-lg flex items-center gap-1">
                          <Camera size={11} /> Add Photo
                        </button>
                      )}
                      {docType === 'Measurement' && (
                        <input placeholder="Enter measurement" className="text-xs px-2 py-1 border border-neutral-200 rounded-lg flex-1 min-w-0"
                          onBlur={e => { if (e.target.value) setSessionItem(`${sessionPrefix}_doc_${item.id}`, true); }} />
                      )}
                      {docType === 'Note' && (
                        <input placeholder="Add note" className="text-xs px-2 py-1 border border-neutral-200 rounded-lg flex-1 min-w-0"
                          onBlur={e => { if (e.target.value) setSessionItem(`${sessionPrefix}_doc_${item.id}`, true); }} />
                      )}
                      <button onClick={() => setSessionItem(`${sessionPrefix}_doc_${item.id}`, true)}
                        className="text-xs px-2.5 py-1 border border-neutral-200 text-neutral-600 rounded-lg">Mark Done</button>
                    </div>
                  )}
                  {!editMode && done && <p className="text-xs text-green-600 mt-1 flex items-center gap-1"><Check size={11} /> Completed</p>}
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

/* ── 7. Quality ──────────────────────────────────────────────────────────── */
function QualityView({ items, editMode, session, setSessionItem, sessionPrefix, onEdit, onDelete, onReorder }) {
  const [finalNotes, setFinalNotes] = useState(session[`${sessionPrefix}_quality_notes`] || '');
  const [submitted, setSubmitted] = useState(!!session[`${sessionPrefix}_quality_submitted`]);
  const allAnswered = items.every(i => session[`${sessionPrefix}_quality_${i.id}_result`]);
  const failedWithoutNote = items.some(i => session[`${sessionPrefix}_quality_${i.id}_result`] === 'Fail' && !session[`${sessionPrefix}_quality_${i.id}_note`]);

  if (submitted && !editMode) {
    return (
      <div className="bg-white border border-green-200 rounded-xl p-6 text-center">
        <CheckCircle2 size={36} className="text-green-500 mx-auto mb-2" />
        <h4 className="font-semibold text-neutral-900 mb-1">Checklist Submitted</h4>
        <p className="text-xs text-neutral-500">Quality inspection completed and saved.</p>
        <button onClick={() => { setSubmitted(false); setSessionItem(`${sessionPrefix}_quality_submitted`, false); }}
          className="mt-3 text-xs text-blue-600 underline">Review again</button>
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
            <div key={item.id} className="bg-white border border-neutral-200 rounded-xl p-4">
              <div className="flex gap-1.5 mb-1.5">
                {item.isCritical && <span className="text-xs px-1.5 py-0.5 bg-red-100 text-red-700 rounded font-medium">Critical</span>}
                {item.isRequired && <span className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded font-medium">Required</span>}
              </div>
              <h4 className="font-semibold text-sm text-neutral-900 mb-1">{item.title}</h4>
              {item.body && <p className="text-xs text-neutral-500 mb-2">{item.body}</p>}
              {!editMode && (
                <>
                  <div className="flex gap-2">
                    {['Pass', 'Fail', 'Not Applicable'].map(r => (
                      <button key={r} onClick={() => {
                        setSessionItem(`${sessionPrefix}_quality_${item.id}_result`, r);
                        if (r !== 'Fail') setSessionItem(`${sessionPrefix}_quality_${item.id}_note`, undefined);
                      }} className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${result === r ? RESULT_STYLES[r] : 'border-neutral-200 text-neutral-500 bg-white'}`}>
                        {r === 'Not Applicable' ? 'N/A' : r}
                      </button>
                    ))}
                  </div>
                  {result === 'Fail' && (
                    <input placeholder="Required: Explain the failure" value={failNote || ''}
                      onChange={e => setSessionItem(`${sessionPrefix}_quality_${item.id}_note`, e.target.value)}
                      className="mt-2 w-full px-3 py-1.5 border border-red-200 rounded-lg text-xs" />
                  )}
                </>
              )}
              {editMode && <AdminBar item={item} index={i} total={items.length} onEdit={onEdit} onDelete={onDelete} onReorder={onReorder} />}
            </div>
          );
        })}
      </div>
      {!editMode && items.length > 0 && (
        <div className="mt-4 bg-white border border-neutral-200 rounded-xl p-4">
          <h4 className="font-semibold text-sm text-neutral-900 mb-2">Final Notes</h4>
          <textarea value={finalNotes} onChange={e => setFinalNotes(e.target.value)} rows={3}
            placeholder="Add final notes..." className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm" />
          <button onClick={() => { setSessionItem(`${sessionPrefix}_quality_submitted`, true); setSessionItem(`${sessionPrefix}_quality_notes`, finalNotes); setSubmitted(true); }}
            disabled={!allAnswered || failedWithoutNote}
            className="w-full mt-3 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold disabled:bg-neutral-300">
            Submit Quality Checklist
          </button>
          {(!allAnswered || failedWithoutNote) && (
            <p className="text-xs text-orange-600 mt-1.5 text-center">
              {!allAnswered ? 'All items must be answered.' : 'Failed items require a note.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}