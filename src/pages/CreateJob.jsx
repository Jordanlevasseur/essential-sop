import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useApp } from '@/lib/AppContext';
import { createJobWithSections } from '@/lib/seedData';
import { ArrowLeft, Check, Eye, Save, Send } from 'lucide-react';
import { SECTION_DEFINITIONS, TRADES, CATEGORIES, SKILL_LEVELS } from '@/lib/constants';

export default function CreateJob() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('edit');
  const { } = useApp();

  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    title: '', shortDescription: '', trade: '', category: '', skillLevel: 'Intermediate',
    estimatedDuration: '', tags: [], status: 'Draft', isArchived: false,
  });
  const [tagInput, setTagInput] = useState('');
  const [sections, setSections] = useState([]);
  const [saving, setSaving] = useState(false);
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);
  const [jobId, setJobId] = useState(null);

  useEffect(() => {
    if (editId) {
      Promise.all([
        base44.entities.Job.get(editId),
        base44.entities.JobSection.filter({ jobId: editId }, 'sortOrder', 10),
      ]).then(([j, secs]) => {
        setForm({
          title: j.title, shortDescription: j.shortDescription || '', trade: j.trade || '',
          category: j.category || '', skillLevel: j.skillLevel || 'Intermediate',
          estimatedDuration: j.estimatedDuration || '', tags: j.tags || [], status: j.status || 'Draft', isArchived: j.isArchived || false,
        });
        setJobId(j.id);
        setSections(secs || []);
        setStep(2);
      });
    }
  }, [editId]);

  const set = (key, val) => setForm(prev => ({ ...prev, [key]: val }));

  const handleAddTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (t && !form.tags.includes(t)) set('tags', [...form.tags, t]);
    setTagInput('');
  };

  const handleSaveDraft = async () => {
    if (!form.title.trim()) { alert('Job Title is required.'); return; }
    setSaving(true);
    try {
      if (jobId) {
        await base44.entities.Job.update(jobId, { ...form, status: 'Draft' });
      } else {
        const { job } = await createJobWithSections({ ...form, status: 'Draft' });
        setJobId(job.id);
        const secs = await base44.entities.JobSection.filter({ jobId: job.id }, 'sortOrder', 10);
        setSections(secs || []);
      }
      setStep(2);
    } catch (e) {
      alert('Save failed: ' + (e.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!form.title.trim()) { alert('Job Title is required.'); return; }
    setSaving(true);
    try {
      if (jobId) {
        await base44.entities.Job.update(jobId, { ...form, status: 'Published' });
      } else {
        const { job } = await createJobWithSections({ ...form, status: 'Published' });
        setJobId(job.id);
      }
      setShowPublishConfirm(false);
      navigate(`/jobs/${jobId || form.id}`);
    } catch (e) {
      alert('Publish failed: ' + (e.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const sectionStatus = (sectionType) => {
    const sec = sections.find(s => s.sectionType === sectionType);
    return sec?.completionStatus || 'Empty';
  };

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="bg-white border-b border-neutral-200 sticky top-0 z-40">
        <div className="px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate(-1)}>
            <ArrowLeft size={22} className="text-neutral-700" />
          </button>
          <h1 className="font-semibold text-neutral-900 flex-1">{editId ? 'Edit Job' : 'Create Job'}</h1>
          {step === 2 && (
            <span className="text-xs px-2 py-1 bg-neutral-100 rounded-full text-neutral-600">Step 2 of 2</span>
          )}
        </div>
      </div>

      <div className="px-4 py-4">
        {step === 1 && (
          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-neutral-500 uppercase mb-1 block">Job Title *</label>
              <input value={form.title} onChange={e => set('title', e.target.value)}
                placeholder="e.g., Water Heater Replacement"
                className="w-full px-3 py-2.5 border border-neutral-200 rounded-lg text-sm" />
            </div>
            <div>
              <label className="text-xs font-semibold text-neutral-500 uppercase mb-1 block">Short Description</label>
              <textarea value={form.shortDescription} onChange={e => set('shortDescription', e.target.value)} rows={2}
                placeholder="Brief summary of the job..."
                className="w-full px-3 py-2.5 border border-neutral-200 rounded-lg text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-neutral-500 uppercase mb-1 block">Trade</label>
                <select value={form.trade} onChange={e => set('trade', e.target.value)}
                  className="w-full px-3 py-2.5 border border-neutral-200 rounded-lg text-sm">
                  <option value="">Select...</option>
                  {TRADES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-neutral-500 uppercase mb-1 block">Category</label>
                <select value={form.category} onChange={e => set('category', e.target.value)}
                  className="w-full px-3 py-2.5 border border-neutral-200 rounded-lg text-sm">
                  <option value="">Select...</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-neutral-500 uppercase mb-1 block">Skill Level</label>
                <select value={form.skillLevel} onChange={e => set('skillLevel', e.target.value)}
                  className="w-full px-3 py-2.5 border border-neutral-200 rounded-lg text-sm">
                  {SKILL_LEVELS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-neutral-500 uppercase mb-1 block">Estimated Duration</label>
                <input value={form.estimatedDuration} onChange={e => set('estimatedDuration', e.target.value)}
                  placeholder="e.g., 4-6 hours"
                  className="w-full px-3 py-2.5 border border-neutral-200 rounded-lg text-sm" />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-neutral-500 uppercase mb-1 block">Tags</label>
              <div className="flex gap-2">
                <input value={tagInput} onChange={e => setTagInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddTag())}
                  placeholder="Add tag and press Enter"
                  className="flex-1 px-3 py-2.5 border border-neutral-200 rounded-lg text-sm" />
                <button onClick={handleAddTag} className="px-3 py-2.5 bg-neutral-100 text-neutral-600 rounded-lg text-sm">Add</button>
              </div>
              {form.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {form.tags.map(tag => (
                    <span key={tag} className="text-xs px-2 py-1 bg-neutral-100 text-neutral-600 rounded-full flex items-center gap-1">
                      #{tag}
                      <button onClick={() => set('tags', form.tags.filter(t => t !== tag))}>×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="text-xs font-semibold text-neutral-500 uppercase mb-1 block">Status</label>
              <div className="flex gap-2">
                {['Draft', 'Published'].map(s => (
                  <button key={s} onClick={() => set('status', s)}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-medium ${form.status === s ? 'bg-blue-600 text-white' : 'bg-neutral-100 text-neutral-600'}`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-2">
              <button onClick={handleSaveDraft} disabled={saving || !form.title.trim()}
                className="w-full py-3 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:bg-neutral-300 flex items-center justify-center gap-2">
                <Save size={16} /> {saving ? 'Saving...' : 'Save & Continue'}
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="bg-blue-50 rounded-lg p-3">
              <p className="text-sm text-blue-700">Seven sections have been created for <strong>{form.title}</strong>. Tap any section to add content.</p>
            </div>

            <div className="space-y-2">
              {SECTION_DEFINITIONS.map(def => {
                const status = sectionStatus(def.sectionType);
                const Icon = def.icon;
                return (
                  <button key={def.sectionType} onClick={() => navigate(`/jobs/${jobId}/${def.sectionType}`)}
                    className="w-full bg-white border border-neutral-200 rounded-xl p-3.5 flex items-center gap-3 active:bg-neutral-50">
                    <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Icon size={20} className="text-blue-600" />
                    </div>
                    <div className="flex-1 text-left">
                      <h3 className="font-semibold text-sm text-neutral-900">{def.title}</h3>
                      <p className="text-xs text-neutral-500 line-clamp-1">{def.description}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${status === 'Empty' ? 'bg-neutral-100 text-neutral-400' : status === 'In Progress' ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}`}>
                      {status}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="space-y-2 pt-2">
              <button onClick={handleSaveDraft} disabled={saving}
                className="w-full py-3 border border-neutral-200 rounded-lg text-sm font-medium text-neutral-700 flex items-center justify-center gap-2">
                <Save size={16} /> Save Draft
              </button>
              <button onClick={() => navigate(`/jobs/${jobId}`)}
                className="w-full py-3 border border-neutral-200 rounded-lg text-sm font-medium text-neutral-700 flex items-center justify-center gap-2">
                <Eye size={16} /> Preview as Technician
              </button>
              <button onClick={() => setShowPublishConfirm(true)} disabled={saving}
                className="w-full py-3 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:bg-neutral-300 flex items-center justify-center gap-2">
                <Send size={16} /> Publish
              </button>
            </div>
          </div>
        )}
      </div>

      {showPublishConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowPublishConfirm(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-white rounded-2xl p-5 max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-neutral-900 mb-2">Publish Job?</h3>
            <p className="text-sm text-neutral-600 mb-4">Once published, this job will be visible to all technicians in the Jobs library. You can still edit it later.</p>
            <div className="flex gap-2">
              <button onClick={() => setShowPublishConfirm(false)} className="flex-1 py-2.5 border border-neutral-200 rounded-lg text-sm font-medium text-neutral-600">Cancel</button>
              <button onClick={handlePublish} className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium">Publish</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}