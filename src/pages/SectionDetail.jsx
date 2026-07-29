import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useApp } from '@/lib/AppContext';
import { ArrowLeft, Plus, Pencil, Trash2, ArrowUp, ArrowDown, Copy, Check, X, AlertTriangle, Info, AlertCircle, ShieldAlert, Camera, CheckCircle2, Circle } from 'lucide-react';
import { SECTION_MAP, SEVERITY_LEVELS, DOCUMENTATION_TYPES, DISCLAIMER } from '@/lib/constants';
import ContentEditDialog from '@/components/sections/ContentEditDialog';

export default function SectionDetail() {
  const { jobId, sectionType } = useParams();
  const navigate = useNavigate();
  const { isAdmin, session, setSessionItem, clearSessionForJob, user } = useApp();
  const [job, setJob] = useState(null);
  const [section, setSection] = useState(null);
  // Editing only available for company-owned Jobs; provisioned Essential SOP Jobs are read-only
  // until customization is implemented in a future edit.
  const canEdit = isAdmin && !(job?.sourceType === 'essential_sop' && !job?.isCustomized);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editItem, setEditItem] = useState(null);
  const [showAdd, setShowAdd] = useState(false);

  const loadData = useCallback(async () => {
    try {
      // All Job content is resolved through the centralized resolveJob backend.
      const res = await base44.functions.invoke('resolveJob', { jobId });
      const { job: j, sections: secs, contentBySection: cbs } = res.data;
      setJob(j);
      setSection((secs || []).find(s => s.sectionType === sectionType) || null);
      setItems((cbs?.[sectionType] || []).sort((a, b) => a.sortOrder - b.sortOrder));
    } catch (_) {
      // fall through — items stays empty
    }
    setLoading(false);
  }, [jobId, sectionType]);

  useEffect(() => { loadData(); }, [loadData]);

  const updateSectionStatus = (newItems) => {
    if (!section) return;
    const status = newItems.length === 0 ? 'Empty' : newItems.length >= 4 ? 'Complete' : 'In Progress';
    if (section.completionStatus !== status) {
      base44.entities.JobSection.update(section.id, { completionStatus: status }).then(updated => setSection(updated));
    }
  };

  const handleSaveItem = async (data) => {
    if (editItem) {
      const updated = await base44.entities.SectionContent.update(editItem.id, data);
      setItems(prev => { const n = prev.map(i => i.id === editItem.id ? updated : i); updateSectionStatus(n); return n; });
    } else {
      const created = await base44.entities.SectionContent.create({
        ...data, sectionId: section.id, jobId, sectionType, sortOrder: items.length,
      });
      setItems(prev => { const n = [...prev, created]; updateSectionStatus(n); return n; });
    }
    setEditItem(null);
    setShowAdd(false);
  };

  const handleDelete = async (id) => {
    await base44.entities.SectionContent.delete(id);
    setItems(prev => { const n = prev.filter(i => i.id !== id); updateSectionStatus(n); return n; });
  };

  const handleDuplicate = async (item) => {
    const { id, created_date, updated_date, created_by_id, ...data } = item;
    const created = await base44.entities.SectionContent.create({ ...data, title: `${item.title} (Copy)`, sortOrder: items.length });
    setItems(prev => [...prev, created]);
  };

  const handleReorder = async (index, dir) => {
    const newItems = [...items];
    const swapIndex = index + dir;
    if (swapIndex < 0 || swapIndex >= newItems.length) return;
    [newItems[index], newItems[swapIndex]] = [newItems[swapIndex], newItems[index]];
    newItems.forEach((item, i) => { if (item.sortOrder !== i) base44.entities.SectionContent.update(item.id, { sortOrder: i }); });
    setItems(newItems.map((item, i) => ({ ...item, sortOrder: i })));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-neutral-200 border-t-blue-600 rounded-full animate-spin"></div>
      </div>
    );
  }

  const sectionDef = SECTION_MAP[sectionType];
  const sectionTitle = sectionDef?.title || sectionType;
  const sectionDesc = section?.description || sectionDef?.description || '';

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="bg-white border-b border-neutral-200 sticky top-0 z-40">
        <div className="px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate(-1)}>
            <ArrowLeft size={22} className="text-neutral-700" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-neutral-400 truncate">{job?.title}</p>
            <h1 className="font-semibold text-neutral-900 truncate">{sectionTitle}</h1>
          </div>
          {canEdit && (
            <button onClick={() => setShowAdd(true)} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium flex items-center gap-1">
              <Plus size={16} /> Add
            </button>
          )}
        </div>
      </div>

      <div className="px-4 py-4">
        <p className="text-sm text-neutral-600 mb-4">{sectionDesc}</p>

        {items.length === 0 ? (
          <div className="bg-white border border-neutral-200 rounded-xl p-8 text-center">
            <p className="text-neutral-400 text-sm">No content in this section yet.</p>
            {canEdit && <p className="text-xs text-blue-600 mt-1">Tap "Add" to create the first item.</p>}
          </div>
        ) : (
          <SectionContentRenderer
            sectionType={sectionType}
            items={items}
            isAdmin={canEdit}
            session={session}
            setSessionItem={setSessionItem}
            sessionPrefix={`${jobId}_${sectionType}`}
            onEdit={setEditItem}
            onDelete={handleDelete}
            onDuplicate={handleDuplicate}
            onReorder={handleReorder}
            user={user}
          />
        )}
      </div>

      {canEdit && (showAdd || editItem) && (
        <ContentEditDialog
          sectionType={sectionType}
          item={editItem}
          onSave={handleSaveItem}
          onClose={() => { setShowAdd(false); setEditItem(null); }}
        />
      )}
    </div>
  );
}

function SectionContentRenderer({ sectionType, items, isAdmin, session, setSessionItem, sessionPrefix, onEdit, onDelete, onDuplicate, onReorder, user }) {
  if (sectionType === 'scope') return <ScopeView items={items} isAdmin={isAdmin} onEdit={onEdit} onDelete={onDelete} onReorder={onReorder} />;
  if (sectionType === 'procedure') return <ProcedureView items={items} isAdmin={isAdmin} session={session} setSessionItem={setSessionItem} sessionPrefix={sessionPrefix} onEdit={onEdit} onDelete={onDelete} onDuplicate={onDuplicate} onReorder={onReorder} />;
  if (sectionType === 'tools') return <ToolsView items={items} isAdmin={isAdmin} session={session} setSessionItem={setSessionItem} sessionPrefix={sessionPrefix} onEdit={onEdit} onDelete={onDelete} onReorder={onReorder} />;
  if (sectionType === 'materials') return <MaterialsView items={items} isAdmin={isAdmin} session={session} setSessionItem={setSessionItem} sessionPrefix={sessionPrefix} onEdit={onEdit} onDelete={onDelete} onReorder={onReorder} />;
  if (sectionType === 'safety') return <SafetyView items={items} isAdmin={isAdmin} session={session} setSessionItem={setSessionItem} sessionPrefix={sessionPrefix} onEdit={onEdit} onDelete={onDelete} onReorder={onReorder} />;
  if (sectionType === 'documentation') return <DocumentationView items={items} isAdmin={isAdmin} session={session} setSessionItem={setSessionItem} sessionPrefix={sessionPrefix} onEdit={onEdit} onDelete={onDelete} onReorder={onReorder} />;
  if (sectionType === 'quality') return <QualityView items={items} isAdmin={isAdmin} session={session} setSessionItem={setSessionItem} sessionPrefix={sessionPrefix} onEdit={onEdit} onDelete={onDelete} onReorder={onReorder} user={user} />;
  return null;
}

function AdminControls({ item, index, total, onEdit, onDelete, onDuplicate, onReorder }) {
  return (
    <div className="flex items-center gap-1 mt-2 pt-2 border-t border-neutral-100">
      <button onClick={() => onEdit(item)} className="px-2 py-1 text-xs text-blue-600 flex items-center gap-1"><Pencil size={12} /> Edit</button>
      <button onClick={() => onDuplicate(item)} className="px-2 py-1 text-xs text-neutral-500 flex items-center gap-1"><Copy size={12} /> Duplicate</button>
      <button onClick={() => onDelete(item.id)} className="px-2 py-1 text-xs text-red-500 flex items-center gap-1"><Trash2 size={12} /> Delete</button>
      <div className="flex-1" />
      <button onClick={() => onReorder(index, -1)} disabled={index === 0} className="p-1 text-neutral-400 disabled:opacity-30"><ArrowUp size={14} /></button>
      <button onClick={() => onReorder(index, 1)} disabled={index === total - 1} className="p-1 text-neutral-400 disabled:opacity-30"><ArrowDown size={14} /></button>
    </div>
  );
}

function ItemCard({ item, children, isAdmin, index, total, onEdit, onDelete, onDuplicate, onReorder }) {
  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-3.5">
      <div className="flex items-start gap-2">
        {item.isRequired && <span className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded font-medium flex-shrink-0">Required</span>}
        {item.isCritical && <span className="text-xs px-1.5 py-0.5 bg-red-100 text-red-700 rounded font-medium flex-shrink-0">Critical</span>}
      </div>
      {children}
      {isAdmin && <AdminControls item={item} index={index} total={total} onEdit={onEdit} onDelete={onDelete} onDuplicate={onDuplicate} onReorder={onReorder} />}
    </div>
  );
}

function ScopeView({ items, isAdmin, onEdit, onDelete, onReorder }) {
  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <ItemCard key={item.id} item={item} isAdmin={isAdmin} index={i} total={items.length} onEdit={onEdit} onDelete={onDelete} onReorder={onReorder}>
          <h3 className="font-semibold text-neutral-900 text-sm mb-1">{item.title}</h3>
          <p className={`text-sm whitespace-pre-wrap ${item.isCritical ? 'text-orange-700' : 'text-neutral-600'}`}>{item.body}</p>
        </ItemCard>
      ))}
    </div>
  );
}

function ProcedureView({ items, isAdmin, session, setSessionItem, sessionPrefix, onEdit, onDelete, onDuplicate, onReorder }) {
  return (
    <div className="space-y-3">
      {items.map((item, i) => {
        const checked = session[`${sessionPrefix}_${item.id}`];
        return (
          <ItemCard key={item.id} item={item} isAdmin={isAdmin} index={i} total={items.length} onEdit={onEdit} onDelete={onDelete} onDuplicate={onDuplicate} onReorder={onReorder}>
            <div className="flex items-start gap-3">
              {!isAdmin && (
                <button onClick={() => setSessionItem(`${sessionPrefix}_${item.id}`, !checked)}
                  className="flex-shrink-0 mt-0.5">
                  {checked ? <CheckCircle2 size={20} className="text-green-500" /> : <Circle size={20} className="text-neutral-300" />}
                </button>
              )}
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">{i + 1}</span>
                  <h3 className="font-semibold text-neutral-900 text-sm flex-1">{item.title}</h3>
                </div>
                <p className="text-sm text-neutral-600 ml-8 mb-2">{item.body}</p>
                {item.metadata?.warning && (
                  <div className="ml-8 mb-1 px-2.5 py-1.5 bg-red-50 border border-red-200 rounded-lg flex items-start gap-1.5">
                    <AlertTriangle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-red-700"><span className="font-semibold">Warning:</span> {item.metadata.warning}</p>
                  </div>
                )}
                {item.metadata?.tip && (
                  <div className="ml-8 px-2.5 py-1.5 bg-blue-50 border border-blue-200 rounded-lg flex items-start gap-1.5">
                    <Info size={14} className="text-blue-500 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-blue-700"><span className="font-semibold">Tip:</span> {item.metadata.tip}</p>
                  </div>
                )}
              </div>
            </div>
          </ItemCard>
        );
      })}
    </div>
  );
}

function ToolsView({ items, isAdmin, session, setSessionItem, sessionPrefix, onEdit, onDelete, onReorder }) {
  const required = items.filter(i => i.isRequired);
  const optional = items.filter(i => !i.isRequired);
  const renderGroup = (list, title) => list.length === 0 ? null : (
    <div className="mb-4">
      <h3 className="text-xs font-semibold text-neutral-500 uppercase mb-2">{title}</h3>
      <div className="space-y-2">
        {list.map((item, i) => {
          const globalIndex = items.indexOf(item);
          const gathered = session[`${sessionPrefix}_${item.id}`];
          return (
            <ItemCard key={item.id} item={item} isAdmin={isAdmin} index={globalIndex} total={items.length} onEdit={onEdit} onDelete={onDelete} onReorder={onReorder}>
              <div className="flex items-center gap-3">
                {!isAdmin && (
                  <button onClick={() => setSessionItem(`${sessionPrefix}_${item.id}`, !gathered)}>
                    {gathered ? <CheckCircle2 size={20} className="text-green-500" /> : <Circle size={20} className="text-neutral-300" />}
                  </button>
                )}
                <div className="flex-1">
                  <h4 className={`font-medium text-sm text-neutral-900 ${gathered ? 'line-through text-neutral-400' : ''}`}>{item.title}</h4>
                  {item.body && <p className="text-xs text-neutral-500">{item.body}</p>}
                  <p className="text-xs text-neutral-400">Qty: {item.metadata?.quantity || 1}</p>
                </div>
              </div>
            </ItemCard>
          );
        })}
      </div>
    </div>
  );
  return <div>{renderGroup(required, 'Required Tools')}{renderGroup(optional, 'Optional Tools')}</div>;
}

function MaterialsView({ items, isAdmin, session, setSessionItem, sessionPrefix, onEdit, onDelete, onReorder }) {
  const required = items.filter(i => i.isRequired);
  const optional = items.filter(i => !i.isRequired);
  const renderGroup = (list, title) => list.length === 0 ? null : (
    <div className="mb-4">
      <h3 className="text-xs font-semibold text-neutral-500 uppercase mb-2">{title}</h3>
      <div className="space-y-2">
        {list.map((item) => {
          const globalIndex = items.indexOf(item);
          const gathered = session[`${sessionPrefix}_${item.id}`];
          return (
            <ItemCard key={item.id} item={item} isAdmin={isAdmin} index={globalIndex} total={items.length} onEdit={onEdit} onDelete={onDelete} onReorder={onReorder}>
              <div className="flex items-center gap-3">
                {!isAdmin && (
                  <button onClick={() => setSessionItem(`${sessionPrefix}_${item.id}`, !gathered)}>
                    {gathered ? <CheckCircle2 size={20} className="text-green-500" /> : <Circle size={20} className="text-neutral-300" />}
                  </button>
                )}
                <div className="flex-1">
                  <h4 className={`font-medium text-sm text-neutral-900 ${gathered ? 'line-through text-neutral-400' : ''}`}>{item.title}</h4>
                  {item.body && <p className="text-xs text-neutral-500">{item.body}</p>}
                  <p className="text-xs text-neutral-400">Qty: {item.metadata?.quantity || 1} {item.metadata?.unit || ''}</p>
                  {item.metadata?.specification && <p className="text-xs text-blue-600">Spec: {item.metadata.specification}</p>}
                </div>
              </div>
            </ItemCard>
          );
        })}
      </div>
    </div>
  );
  return <div>{renderGroup(required, 'Required Materials')}{renderGroup(optional, 'Optional Materials')}</div>;
}

function SafetyView({ items, isAdmin, session, setSessionItem, sessionPrefix, onEdit, onDelete, onReorder }) {
  const acknowledged = session[`${sessionPrefix}_ack`];
  return (
    <div>
      <div className="space-y-2.5 mb-4">
        {items.map((item, i) => {
          const severity = SEVERITY_LEVELS.find(s => s.value === item.metadata?.severity) || SEVERITY_LEVELS[0];
          const SevIcon = severity.icon;
          return (
            <ItemCard key={item.id} item={item} isAdmin={isAdmin} index={i} total={items.length} onEdit={onEdit} onDelete={onDelete} onReorder={onReorder}>
              <div className={`p-2.5 rounded-lg border ${severity.bg} ${severity.border} mb-1`}>
                <div className="flex items-center gap-2 mb-1">
                  <SevIcon size={16} className={severity.color} />
                  <span className={`text-xs font-bold uppercase ${severity.color}`}>{severity.value}</span>
                </div>
                <h3 className="font-semibold text-neutral-900 text-sm mb-1">{item.title}</h3>
                <p className="text-sm text-neutral-600">{item.body}</p>
                {item.metadata?.requiredAction && (
                  <p className="text-xs text-neutral-700 mt-2 pt-2 border-t border-neutral-200">
                    <span className="font-semibold">Required Action:</span> {item.metadata.requiredAction}
                  </p>
                )}
              </div>
            </ItemCard>
          );
        })}
      </div>
      {!isAdmin && (
        <div className={`rounded-xl p-4 border-2 transition-colors ${acknowledged ? 'bg-green-50 border-green-300' : 'bg-white border-neutral-300'}`}>
          <label className="flex items-center gap-3 cursor-pointer">
            <button onClick={() => setSessionItem(`${sessionPrefix}_ack`, !acknowledged)}>
              {acknowledged ? <CheckCircle2 size={24} className="text-green-500" /> : <Circle size={24} className="text-neutral-300" />}
            </button>
            <span className="text-sm font-medium text-neutral-900">I have reviewed the safety requirements for this job.</span>
          </label>
        </div>
      )}
    </div>
  );
}

function DocumentationView({ items, isAdmin, session, setSessionItem, sessionPrefix, onEdit, onDelete, onReorder }) {
  const completed = items.filter(i => session[`${sessionPrefix}_${i.id}`]).length;
  const total = items.length;

  return (
    <div>
      {total > 0 && (
        <div className="mb-4 bg-blue-50 rounded-lg p-3 text-center">
          <p className="text-sm font-semibold text-blue-700">{completed} of {total} requirements complete</p>
          <div className="mt-1.5 h-2 bg-blue-200 rounded-full overflow-hidden">
            <div className="h-full bg-blue-600 rounded-full transition-all" style={{ width: `${(completed / total) * 100}%` }} />
          </div>
        </div>
      )}
      <div className="space-y-2.5">
        {items.map((item, i) => {
          const done = session[`${sessionPrefix}_${item.id}`];
          const docType = item.metadata?.documentationType || 'Note';
          return (
            <ItemCard key={item.id} item={item} isAdmin={isAdmin} index={i} total={items.length} onEdit={onEdit} onDelete={onDelete} onReorder={onReorder}>
              <div className="flex items-start gap-3">
                {!isAdmin && (
                  <button onClick={() => setSessionItem(`${sessionPrefix}_${item.id}`, !done)}>
                    {done ? <CheckCircle2 size={20} className="text-green-500" /> : <Circle size={20} className="text-neutral-300" />}
                  </button>
                )}
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Camera size={14} className="text-neutral-400" />
                    <span className="text-xs px-1.5 py-0.5 bg-neutral-100 text-neutral-600 rounded">{docType}</span>
                  </div>
                  <h3 className="font-semibold text-sm text-neutral-900">{item.title}</h3>
                  {item.body && <p className="text-xs text-neutral-500 mt-0.5">{item.body}</p>}
                  {!isAdmin && !done && (
                    <div className="mt-2 flex gap-2">
                      {['Before photo', 'During photo', 'After photo'].includes(docType) && (
                        <button onClick={() => setSessionItem(`${sessionPrefix}_${item.id}`, true)} className="text-xs px-2 py-1 bg-blue-600 text-white rounded">Simulate Photo</button>
                      )}
                      {docType === 'Measurement' && (
                        <input placeholder="Enter measurement" className="text-xs px-2 py-1 border border-neutral-200 rounded flex-1" onBlur={e => { if (e.target.value) setSessionItem(`${sessionPrefix}_${item.id}`, true); }} />
                      )}
                      {docType === 'Note' && (
                        <input placeholder="Add note" className="text-xs px-2 py-1 border border-neutral-200 rounded flex-1" onBlur={e => { if (e.target.value) setSessionItem(`${sessionPrefix}_${item.id}`, true); }} />
                      )}
                      <button onClick={() => setSessionItem(`${sessionPrefix}_${item.id}`, true)} className="text-xs px-2 py-1 border border-neutral-200 text-neutral-600 rounded">Mark Complete</button>
                    </div>
                  )}
                  {!isAdmin && done && <p className="text-xs text-green-600 mt-1">✓ Completed</p>}
                </div>
              </div>
            </ItemCard>
          );
        })}
      </div>
    </div>
  );
}

function QualityView({ items, isAdmin, session, setSessionItem, sessionPrefix, onEdit, onDelete, onReorder, user }) {
  const getResult = (id) => session[`${sessionPrefix}_${id}_result`];
  const [showSubmit, setShowSubmit] = useState(false);
  const [submitted, setSubmitted] = useState(session[`${sessionPrefix}_submitted`]);
  const [finalNotes, setFinalNotes] = useState(session[`${sessionPrefix}_notes`] || '');

  const allAnswered = items.every(i => getResult(i.id));
  const failedWithoutNote = items.some(i => getResult(i.id) === 'Fail' && !session[`${sessionPrefix}_${i.id}_note`]);

  const setResult = (id, result) => {
    setSessionItem(`${sessionPrefix}_${id}_result`, result);
    if (result !== 'Fail') setSessionItem(`${sessionPrefix}_${id}_note`, undefined);
  };

  const handleSubmit = () => {
    setSessionItem(`${sessionPrefix}_submitted`, true);
    setSessionItem(`${sessionPrefix}_notes`, finalNotes);
    setSubmitted(true);
    setShowSubmit(false);
  };

  if (submitted) {
    return (
      <div className="bg-white border border-green-200 rounded-xl p-6 text-center">
        <CheckCircle2 size={40} className="text-green-500 mx-auto mb-2" />
        <h3 className="font-semibold text-neutral-900 mb-1">Checklist Submitted</h3>
        <p className="text-sm text-neutral-500">Quality checklist has been saved for this session.</p>
        <p className="text-xs text-neutral-400 mt-2">Technician: {user?.name || 'Unknown'}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="space-y-2.5">
        {items.map((item, i) => {
          const result = getResult(item.id);
          const failNote = session[`${sessionPrefix}_${item.id}_note`];
          return (
            <ItemCard key={item.id} item={item} isAdmin={isAdmin} index={i} total={items.length} onEdit={onEdit} onDelete={onDelete} onReorder={onReorder}>
              <h3 className="font-semibold text-sm text-neutral-900 mb-1">{item.title}</h3>
              {item.body && <p className="text-xs text-neutral-500 mb-2"><span className="font-medium">Criteria:</span> {item.body}</p>}
              {!isAdmin && (
                <>
                  <div className="flex gap-2">
                    {['Pass', 'Fail', 'Not Applicable'].map(r => (
                      <button key={r} onClick={() => setResult(item.id, r)}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-medium border ${result === r ? RESULT_STYLES[r] : 'border-neutral-200 text-neutral-500 bg-white'}`}>
                        {r === 'Not Applicable' ? 'N/A' : r}
                      </button>
                    ))}
                  </div>
                  {result === 'Fail' && (
                    <input placeholder="Required: Explain the failure" value={failNote || ''}
                      onChange={e => setSessionItem(`${sessionPrefix}_${item.id}_note`, e.target.value)}
                      className="mt-2 w-full px-2 py-1.5 border border-red-200 rounded text-xs" />
                  )}
                </>
              )}
            </ItemCard>
          );
        })}
      </div>
      {!isAdmin && items.length > 0 && (
        <div className="mt-4 bg-white border border-neutral-200 rounded-xl p-4">
          <h3 className="font-semibold text-sm text-neutral-900 mb-2">Final Notes</h3>
          <textarea value={finalNotes} onChange={e => setFinalNotes(e.target.value)} rows={3}
            placeholder="Add any final notes..." className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm" />
          <p className="text-xs text-neutral-400 mt-2">Technician: {user?.name || 'Unknown'}</p>
          <button onClick={handleSubmit} disabled={!allAnswered || failedWithoutNote}
            className="w-full mt-3 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:bg-neutral-300">
            Submit Checklist
          </button>
          {(!allAnswered || failedWithoutNote) && (
            <p className="text-xs text-orange-600 mt-1 text-center">{!allAnswered ? 'All items must be answered.' : 'Failed items require a note.'}</p>
          )}
        </div>
      )}
    </div>
  );
}

const RESULT_STYLES = {
  'Pass': 'border-green-500 text-green-700 bg-green-50',
  'Fail': 'border-red-500 text-red-700 bg-red-50',
  'Not Applicable': 'border-neutral-400 text-neutral-600 bg-neutral-100',
};