/**
 * NewMasterSopChooser — Entry point for creating a Master SOP.
 *
 * Offers two options:
 *   1. Create Manually  → /platform/master-library/new-manual (existing CreateMasterJob)
 *   2. Create with AI   → /platform/master-library/new-ai     (new AiMasterSopBuilder)
 *
 * No business logic — pure navigation hub. Keeps the existing manual workflow
 * untouched and adds the AI workflow alongside it.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Pencil, Sparkles } from 'lucide-react';

export default function NewMasterSopChooser() {
  const navigate = useNavigate();
  const basePath = '/platform/master-library';

  return (
    <div
      className="min-h-screen bg-app-bg flex flex-col"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="bg-app-surface border-b border-app-border sticky top-0 z-40">
        <div className="max-w-2xl mx-auto px-3 py-2.5 flex items-center gap-2.5">
          <button
            onClick={() => navigate(basePath)}
            className="icon-btn text-app-text-2 flex-shrink-0"
            aria-label="Back to Master Jobs"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="font-semibold text-app-text">New Master Job</h1>
        </div>
      </div>

      <div className="flex-1 max-w-2xl mx-auto w-full px-4 py-8">
        <p className="text-sm text-app-text-muted mb-6">
          Choose how you want to create this Master Job.
        </p>

        <div className="space-y-3">
          {/* Manual */}
          <button
            onClick={() => navigate(`${basePath}/new-manual`)}
            className="w-full text-left bg-app-card border border-app-border rounded-2xl p-5 active:opacity-70 no-select touch-active"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-app-elevated rounded-xl flex items-center justify-center flex-shrink-0">
                <Pencil size={20} className="text-app-text-2" />
              </div>
              <div className="flex-1">
                <h2 className="font-semibold text-app-text mb-0.5">Create Manually</h2>
                <p className="text-sm text-app-text-muted leading-relaxed">
                  Enter the title and basic details, then build each section yourself in the editor.
                </p>
              </div>
            </div>
          </button>

          {/* AI */}
          <button
            onClick={() => navigate(`${basePath}/new-ai`)}
            className="w-full text-left bg-app-card border border-app-accent/30 rounded-2xl p-5 active:opacity-70 no-select touch-active"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-app-info-bg rounded-xl flex items-center justify-center flex-shrink-0">
                <Sparkles size={20} className="text-app-accent" />
              </div>
              <div className="flex-1">
                <h2 className="font-semibold text-app-text mb-0.5 flex items-center gap-1.5">
                  Create with AI
                  <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 bg-app-info-bg text-app-accent rounded-full">Beta</span>
                </h2>
                <p className="text-sm text-app-text-muted leading-relaxed">
                  Describe the SOP you need. AI generates a draft you can review and edit before saving.
                </p>
              </div>
            </div>
          </button>
        </div>

        <p className="text-xs text-app-text-muted mt-6 leading-relaxed">
          AI-generated content is a draft — you must review and edit it before publishing. AI never publishes or distributes on its own.
        </p>
      </div>
    </div>
  );
}