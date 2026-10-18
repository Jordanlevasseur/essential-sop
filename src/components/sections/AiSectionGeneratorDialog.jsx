import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Sparkles, AlertTriangle, X } from 'lucide-react';

/**
 * AiSectionGeneratorDialog — per-section AI regenerate/refine in SectionDetail.
 *
 * Calls generateCompanySopDraft (action: regenerate_section), which returns
 * items WITHOUT persisting. This dialog warns that the section's current
 * content will be replaced, then hands the generated items back to the parent
 * (SectionDetail) which applies them through the existing mutation-guarded
 * SectionContent write path. Only one section is affected; others are untouched.
 */
const MAX_INSTRUCTION = 2000;

export default function AiSectionGeneratorDialog({ open, onClose, onApplied, sectionTitle, hasExisting, jobId, sectionType, companyId }) {
  const [instruction, setInstruction] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  if (!open) return null;

  const handleGenerate = async () => {
    if (generating) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await base44.functions.invoke('generateCompanySopDraft', {
        action: 'regenerate_section',
        companyId,
        jobId,
        sectionType,
        instruction: instruction.trim(),
      });
      const items = res?.data?.items;
      if (!Array.isArray(items) || items.length === 0) {
        setError('AI produced no content for this section. Please try again.');
        setGenerating(false);
        return;
      }
      setInstruction('');
      onApplied(items);
    } catch (e) {
      const data = e?.response?.data || e?.data || {};
      const code = data.code;
      const msg = data.error || e?.message || 'AI generation failed. Please try again.';
      if (code === 'AI_OUTPUT_INVALID') {
        setError((msg + (data.details ? ' ' + data.details.join(' ') : '')).trim());
      } else if (e?.response?.status === 403) {
        setError(data.error || 'You do not have permission to edit this section.');
      } else {
        setError(msg);
      }
      setGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative bg-app-surface rounded-2xl border border-app-border max-w-md w-full max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-app-border sticky top-0 bg-app-surface">
          <h3 className="font-semibold text-app-text flex items-center gap-1.5">
            <Sparkles size={16} className="text-app-accent" />
            Generate {sectionTitle} with AI
          </h3>
          <button onClick={onClose} aria-label="Close" className="icon-btn text-app-text-muted">
            <X size={18} />
          </button>
        </div>

        <div className="p-4">
          {hasExisting && (
            <div className="bg-app-warning-bg border border-app-warning/30 rounded-lg p-3 mb-3 flex items-start gap-2">
              <AlertTriangle size={16} className="text-app-warning flex-shrink-0 mt-0.5" />
              <p className="text-xs text-app-text-2 leading-relaxed">
                This replaces the current content of the {sectionTitle} section. Other sections are not affected. You can review and edit each item afterward.
              </p>
            </div>
          )}

          <label className="text-xs font-semibold text-app-text-muted uppercase mb-1.5 block">
            Instructions (optional)
          </label>
          <textarea
            value={instruction}
            onChange={e => setInstruction(e.target.value.slice(0, MAX_INSTRUCTION))}
            rows={4}
            autoFocus
            disabled={generating}
            placeholder="e.g. Make the steps more detailed for an apprentice, or add missing safety precautions."
            className="w-full px-3 py-2.5 bg-app-input border border-app-border rounded-lg text-sm text-app-text placeholder:text-app-text-muted focus:outline-none focus:border-app-accent focus:ring-1 focus:ring-app-accent resize-y disabled:opacity-60"
          />

          {error && (
            <div className="mt-3 p-3 bg-app-danger-bg border border-app-danger/30 rounded-lg flex items-start gap-2">
              <AlertTriangle size={16} className="text-app-danger flex-shrink-0 mt-0.5" />
              <p className="text-sm text-app-text-2">{error}</p>
            </div>
          )}

          <button
            onClick={handleGenerate}
            disabled={generating}
            className="w-full mt-4 py-3 bg-app-accent text-app-accent-text rounded-lg text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:bg-app-disabled disabled:text-app-text-disabled"
          >
            {generating ? (
              <>
                <div className="w-4 h-4 border-2 border-app-accent-text/40 border-t-app-accent-text rounded-full animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <Sparkles size={16} />
                {hasExisting ? 'Generate & Replace' : 'Generate Section'}
              </>
            )}
          </button>
          <p className="text-xs text-app-text-muted text-center mt-2">AI content is a draft suggestion — review before publishing.</p>
        </div>
      </div>
    </div>
  );
}