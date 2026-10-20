import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useApp } from '@/lib/AppContext';
import { Sparkles, AlertTriangle, Loader2 } from 'lucide-react';

const MAX_PROMPT = 4000;

/**
 * AiSopEditor — compact inline "Edit with AI" field for the existing SOP editor
 * (CreateJob Step 2). Authorized GM/PM only. Calls generateCompanySopDraft
 * (action: edit_with_ai) which reads the existing editable draft and applies
 * the user's requested modifications to the draft content. Never publishes.
 * The user continues editing manually or uses the existing Save/Publish
 * workflow.
 */
export default function AiSopEditor({ jobId, onApplied }) {
  const { companyId } = useApp();
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  if (!jobId) return null;

  const handleApply = async () => {
    const p = prompt.trim();
    if (!p || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await base44.functions.invoke('generateCompanySopDraft', {
        action: 'edit_with_ai',
        companyId,
        jobId,
        instruction: p,
      });
      if (res?.data?.sections) {
        onApplied(res.data.sections);
      }
      setPrompt('');
    } catch (e) {
      const data = e?.response?.data || e?.data || {};
      const code = data.code;
      const msg = data.error || e?.message || 'AI edit failed. Please try again.';
      if (code === 'AI_OUTPUT_INVALID') {
        setError((msg + (data.details ? ' ' + data.details.join(' ') : '')).trim());
      } else if (code === 'AI_ERROR') {
        setError('The AI service could not complete the request. Please try again in a moment.');
      } else if (code === 'INVALID_PROMPT') {
        setError(msg);
      } else if (e?.response?.status === 403) {
        setError('You do not have permission to edit this SOP with AI.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-app-card border border-app-border rounded-xl p-3 space-y-2.5">
      <label className="text-xs font-semibold text-app-text-muted uppercase flex items-center gap-1.5">
        <Sparkles size={12} className="text-app-accent" />
        Edit with AI
      </label>
      <textarea
        value={prompt}
        onChange={e => setPrompt(e.target.value.slice(0, MAX_PROMPT))}
        placeholder="What would you like changed in this SOP?"
        rows={2}
        disabled={loading}
        className="w-full px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text placeholder:text-app-text-muted focus:outline-none focus:border-app-accent focus:ring-1 focus:ring-app-accent resize-y disabled:opacity-60"
      />
      {error && (
        <div className="flex items-start gap-2 text-xs text-app-danger">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      <button
        onClick={handleApply}
        disabled={!prompt.trim() || loading}
        className="w-full py-2.5 bg-app-accent text-app-accent-text rounded-lg text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:bg-app-disabled disabled:text-app-text-disabled"
      >
        {loading ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            Making changes…
          </>
        ) : (
          <>
            <Sparkles size={14} />
            Make Changes
          </>
        )}
      </button>
    </div>
  );
}