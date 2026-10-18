/**
 * AiMasterSopBuilder — Stage 1 AI Master SOP creation page.
 *
 * Flow: Prompt → Generate → draft Master SOP created → navigate to editor
 * with location.state.isAiDraft = true so the editor shows an "AI GENERATED
 * DRAFT" banner.
 *
 * Calls the generateMasterSopDraft backend function (Platform Super Admin only).
 * On any error (network, AI failure, invalid output), shows a recoverable
 * error and allows retry. No entities are created on failure.
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { ArrowLeft, Sparkles, AlertTriangle, RefreshCw, CheckCircle2 } from 'lucide-react';

const EXAMPLE_PROMPT =
  'Create a residential construction SOP for general PPE requirements including eye protection, hearing protection, gloves, footwear, respiratory protection, PPE inspection, replacement requirements, and stop-work conditions.';

const MAX_PROMPT = 4000;

export default function AiMasterSopBuilder() {
  const navigate = useNavigate();
  const basePath = '/platform/master-library';

  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  const handleGenerate = async () => {
    const p = prompt.trim();
    if (!p || generating) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await base44.functions.invoke('generateMasterSopDraft', { prompt: p });
      const masterId = res?.data?.masterId;
      if (!masterId) {
        setError('Generation completed but no draft was returned. Please try again.');
        setGenerating(false);
        return;
      }
      navigate(`${basePath}/${masterId}/edit`, {
        replace: true,
        state: { isAiDraft: true },
      });
    } catch (e) {
      const data = e?.response?.data || e?.data || {};
      const code = data.code;
      const msg =
        data.error ||
        e?.message ||
        'AI generation failed. Please try again.';
      if (code === 'AI_OUTPUT_INVALID') {
        setError(
          (msg + (data.details ? ' ' + data.details.join(' ') : '')).trim()
        );
      } else if (code === 'AI_ERROR') {
        setError('The AI service could not complete the request. Please try again in a moment.');
      } else if (code === 'INVALID_PROMPT') {
        setError(msg);
      } else {
        setError(msg);
      }
      setGenerating(false);
    }
  };

  const handleUseExample = () => {
    setPrompt(EXAMPLE_PROMPT);
  };

  const remaining = MAX_PROMPT - prompt.length;

  return (
    <div
      className="min-h-screen bg-app-bg flex flex-col"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      {/* Header */}
      <div className="bg-app-surface border-b border-app-border sticky top-0 z-40">
        <div className="max-w-2xl mx-auto px-3 py-2.5 flex items-center gap-2.5">
          <button
            onClick={() => navigate(`${basePath}/new`)}
            className="icon-btn text-app-text-2 flex-shrink-0"
            aria-label="Back"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold text-app-text flex items-center gap-1.5">
              <Sparkles size={16} className="text-app-accent" />
              Create with AI
            </h1>
            <p className="text-xs text-app-text-muted">AI Master SOP Builder</p>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 max-w-2xl mx-auto w-full px-3 py-4">
        <div className="bg-app-info-bg border border-app-info/30 rounded-xl p-3.5 mb-5 flex items-start gap-2.5">
          <Sparkles size={16} className="text-app-accent flex-shrink-0 mt-0.5" />
          <p className="text-xs text-app-info leading-relaxed">
            Describe the standard operating procedure you need. AI generates a structured draft you can review and edit. AI never publishes automatically.
          </p>
        </div>

        <label htmlFor="ai-sop-prompt" className="text-xs font-semibold text-app-text-muted uppercase tracking-wide mb-1.5 block">
          Describe the SOP
        </label>
        <textarea
          id="ai-sop-prompt"
          value={prompt}
          onChange={e => setPrompt(e.target.value.slice(0, MAX_PROMPT))}
          rows={7}
          autoFocus
          disabled={generating}
          placeholder="e.g. Create a residential construction SOP for general PPE requirements including eye protection, hearing protection, gloves, footwear, respiratory protection, PPE inspection, replacement requirements, and stop-work conditions."
          className="w-full px-3.5 py-3 bg-app-input border border-app-border rounded-xl text-sm text-app-text placeholder:text-app-text-muted focus:outline-none focus:border-app-accent focus:ring-1 focus:ring-app-accent resize-y disabled:opacity-60"
        />
        <div className="flex items-center justify-between mt-1.5">
          <button
            onClick={handleUseExample}
            disabled={generating}
            className="text-xs text-app-accent font-medium touch-active no-select disabled:opacity-50"
          >
            Use example
          </button>
          <span className={`text-xs ${remaining < 100 ? 'text-app-warning' : 'text-app-text-muted'}`}>
            {remaining} characters left
          </span>
        </div>

        {/* Error */}
        {error && (
          <div className="mt-5 p-4 bg-app-danger-bg border border-app-danger/30 rounded-xl">
            <div className="flex items-start gap-2.5">
              <AlertTriangle size={18} className="text-app-danger flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-app-danger mb-0.5">Generation failed</p>
                <p className="text-sm text-app-text-2 leading-relaxed">{error}</p>
                <p className="text-xs text-app-text-muted mt-1.5">
                  No Master SOP was created. You can edit your prompt and retry.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={!prompt.trim() || generating}
          className="w-full mt-6 py-3.5 bg-app-accent text-app-accent-text rounded-xl text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:bg-app-disabled disabled:text-app-text-disabled touch-active"
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

        {/* What happens next */}
        <div className="mt-6 space-y-2.5">
          <p className="text-xs font-semibold text-app-text-muted uppercase tracking-wide">How it works</p>
          {[
            'AI generates a structured draft mapped to the existing Master SOP sections.',
            'You review and edit every field in the normal Master SOP editor.',
            'Saving and publishing are explicit human actions — AI never publishes.',
          ].map((t, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <CheckCircle2 size={15} className="text-app-success flex-shrink-0 mt-0.5" />
              <p className="text-sm text-app-text-2 leading-relaxed">{t}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}