import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useApp } from '@/lib/AppContext';
import { Sparkles, AlertTriangle, X } from 'lucide-react';

/**
 * AiSopGeneratorDialog — company "Generate with AI" entry in CreateJob step 1.
 *
 * Calls generateCompanySopDraft (action: generate) — authorized GM/PM only,
 * draft-first. On success, navigates to the created draft's edit flow so the
 * user reviews every section before publishing. No promotional styling.
 */
const MAX_PROMPT = 4000;

export default function AiSopGeneratorDialog({ open, onClose, onGenerated, hints }) {
  const { companyId } = useApp();
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  if (!open) return null;

  const handleGenerate = async () => {
    const p = prompt.trim();
    if (!p || generating) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await base44.functions.invoke('generateCompanySopDraft', {
        action: 'generate',
        companyId,
        prompt: p,
        title: hints?.title || '',
        trade: hints?.trade || '',
        category: hints?.category || '',
      });
      const jobId = res?.data?.jobId;
      if (!jobId) {
        setError('Generation completed but no draft was returned. Please try again.');
        setGenerating(false);
        return;
      }
      setPrompt('');
      onGenerated(jobId);
    } catch (e) {
      const data = e?.response?.data || e?.data || {};
      const code = data.code;
      const msg = data.error || e?.message || 'AI generation failed. Please try again.';
      if (code === 'AI_OUTPUT_INVALID') {
        setError((msg + (data.details ? ' ' + data.details.join(' ') : '')).trim());
      } else if (code === 'AI_ERROR') {
        setError('The AI service could not complete the request. Please try again in a moment.');
      } else if (code === 'INVALID_PROMPT') {
        setError(msg);
      } else if (e?.response?.status === 403) {
        setError('You do not have permission to author company SOPs.');
      } else {
        setError(msg);
      }
      setGenerating(false);
    }
  };

  const remaining = MAX_PROMPT - prompt.length;

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
            Generate with AI
          </h3>
          <button onClick={onClose} aria-label="Close" className="icon-btn text-app-text-muted">
            <X size={18} />
          </button>
        </div>

        <div className="p-4">
          <div className="bg-app-info-bg border border-app-info/30 rounded-lg p-3 mb-3 flex items-start gap-2">
            <Sparkles size={14} className="text-app-accent flex-shrink-0 mt-0.5" />
            <p className="text-xs text-app-info leading-relaxed">
              Describe the procedure. AI creates a structured draft you review and edit. AI never publishes automatically.
            </p>
          </div>

          <label className="text-xs font-semibold text-app-text-muted uppercase mb-1.5 block">Describe the SOP</label>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value.slice(0, MAX_PROMPT))}
            rows={5}
            autoFocus
            disabled={generating}
            placeholder="e.g. Create an SOP for replacing a residential water heater, including shutoff, drainage, removal, installation, and safety precautions."
            className="w-full px-3 py-2.5 bg-app-input border border-app-border rounded-lg text-sm text-app-text placeholder:text-app-text-muted focus:outline-none focus:border-app-accent focus:ring-1 focus:ring-app-accent resize-y disabled:opacity-60"
          />
          <div className="text-right mt-1">
            <span className={`text-xs ${remaining < 100 ? 'text-app-warning' : 'text-app-text-muted'}`}>{remaining} characters left</span>
          </div>

          {error && (
            <div className="mt-3 p-3 bg-app-danger-bg border border-app-danger/30 rounded-lg flex items-start gap-2">
              <AlertTriangle size={16} className="text-app-danger flex-shrink-0 mt-0.5" />
              <p className="text-sm text-app-text-2">{error}</p>
            </div>
          )}

          <button
            onClick={handleGenerate}
            disabled={!prompt.trim() || generating}
            className="w-full mt-4 py-3 bg-app-accent text-app-accent-text rounded-lg text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:bg-app-disabled disabled:text-app-text-disabled"
          >
            {generating ? (
              <>
                <div className="w-4 h-4 border-2 border-app-accent-text/40 border-t-app-accent-text rounded-full animate-spin" />
                Generating draft…
              </>
            ) : (
              <>
                <Sparkles size={16} />
                Generate Draft
              </>
            )}
          </button>
          <p className="text-xs text-app-text-muted text-center mt-2">A draft is created — you review every section before publishing.</p>
        </div>
      </div>
    </div>
  );
}