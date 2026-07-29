import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { X, CheckCircle2 } from 'lucide-react';

const SECTIONS = [
  { value: 'tools', label: 'Tools' },
  { value: 'materials', label: 'Materials' },
  { value: 'scope', label: 'Scope' },
  { value: 'procedure', label: 'Procedure' },
  { value: 'safety', label: 'Safety' },
  { value: 'quality_standards', label: 'Quality Standards' },
];

const URGENCY = [
  { value: 'normal', label: 'Normal' },
  { value: 'important', label: 'Important' },
  { value: 'urgent_safety_correction', label: 'Urgent — Safety' },
];

export default function EditRequestForm({ job, onClose }) {
  const [sections, setSections] = useState([]);
  const [reason, setReason] = useState('');
  const [proposed, setProposed] = useState('');
  const [urgency, setUrgency] = useState('normal');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const toggleSection = (val) => setSections(prev => prev.includes(val) ? prev.filter(s => s !== val) : [...prev, val]);

  const handleSubmit = async () => {
    if (!sections.length || !reason.trim() || !proposed.trim()) return;
    setSubmitting(true);
    setError('');
    const res = await base44.functions.invoke('submitEditRequest', {
      companyId: job.companyId,
      jobId: job.id,
      requestedSectionTypes: sections,
      reason, proposedChangeSummary: proposed, urgency,
      supportingNote: note,
    });
    setSubmitting(false);
    if (res.data?.success) {
      setSubmitted(true);
    } else {
      setError(res.data?.error || 'Failed to submit request');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative bg-app-surface rounded-t-2xl flex flex-col" style={{ maxHeight: 'calc(92dvh - env(safe-area-inset-top))' }} onClick={e => e.stopPropagation()}>
        <div className="flex-shrink-0 bg-app-surface border-b border-app-border px-4 py-3 flex items-center justify-between rounded-t-2xl">
          <h2 className="font-semibold text-app-text">Request Edit Access</h2>
          <button onClick={onClose} className="icon-btn"><X size={20} className="text-app-text-muted" /></button>
        </div>

        {submitted ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <CheckCircle2 size={40} className="text-app-success mb-3" />
            <p className="font-semibold text-app-text mb-1">Request Submitted</p>
            <p className="text-sm text-app-text-2">A General Manager or Project Manager will review your request.</p>
            <button onClick={onClose} className="mt-5 px-5 py-2.5 bg-app-accent text-app-accent-text rounded-lg text-sm font-medium">Done</button>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div>
                <p className="text-xs font-semibold text-app-text-muted uppercase mb-1">Job</p>
                <p className="text-sm text-app-text">{job.title}</p>
              </div>

              <div>
                <p className="text-xs font-semibold text-app-text-muted uppercase mb-2">Sections to Edit *</p>
                <div className="flex flex-wrap gap-2">
                  {SECTIONS.map(s => (
                    <button key={s.value} onClick={() => toggleSection(s.value)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border ${sections.includes(s.value) ? 'bg-app-accent text-app-accent-text border-app-accent' : 'border-app-border text-app-text-2 bg-app-elevated'}`}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-app-text-muted uppercase mb-1 block">Reason for Request *</label>
                <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder="Why do these sections need updating?"
                  className="w-full px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text" />
              </div>

              <div>
                <label className="text-xs font-semibold text-app-text-muted uppercase mb-1 block">Proposed Change *</label>
                <textarea value={proposed} onChange={e => setProposed(e.target.value)} rows={2} placeholder="What changes do you want to make?"
                  className="w-full px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text" />
              </div>

              <div>
                <label className="text-xs font-semibold text-app-text-muted uppercase mb-2 block">Urgency</label>
                <div className="flex gap-2">
                  {URGENCY.map(u => (
                    <button key={u.value} onClick={() => setUrgency(u.value)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-medium ${urgency === u.value ? 'bg-app-accent text-app-accent-text' : 'bg-app-elevated text-app-text-2'}`}>
                      {u.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-app-text-muted uppercase mb-1 block">Additional Note (optional)</label>
                <input value={note} onChange={e => setNote(e.target.value)} placeholder="Any other context..."
                  className="w-full px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text" />
              </div>

              {error && <p className="text-sm text-app-danger">{error}</p>}
            </div>

            <div className="flex-shrink-0 bg-app-surface border-t border-app-border p-4 flex gap-3" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
              <button onClick={onClose} className="flex-1 py-2.5 border border-app-border rounded-lg text-sm text-app-text-2">Cancel</button>
              <button onClick={handleSubmit} disabled={submitting || !sections.length || !reason.trim() || !proposed.trim()}
                className="flex-1 py-2.5 bg-app-accent text-app-accent-text rounded-lg text-sm font-medium disabled:bg-app-disabled disabled:text-app-text-disabled">
                {submitting ? 'Submitting…' : 'Submit Request'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}