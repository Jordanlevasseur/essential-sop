/**
 * SopPublishDialog — Structured publish flow with:
 * - Pre-publish validation errors/warnings
 * - Version impact preview
 * - Structured change summary form
 * - Idempotent publish with generated mutationKey
 */
import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Send, X, ChevronDown, ChevronUp } from 'lucide-react';
import SopVersionImpactPreview from './SopVersionImpactPreview';

export default function SopPublishDialog({ master, draftSections, validation, onPublish, onClose, publishing, publishError, serverValidationErrors }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [majorChanges, setMajorChanges] = useState('');
  const [minorImprovements, setMinorImprovements] = useState('');
  const [breakingChanges, setBreakingChanges] = useState('');
  const [migrationNotes, setMigrationNotes] = useState('');
  const [showImpact, setShowImpact] = useState(true);
  const [showValidation, setShowValidation] = useState(true);

  const hasErrors = validation.errors.length > 0;
  const hasWarnings = validation.warnings.length > 0;

  const buildChangeSummary = () => {
    const parts = [];
    if (title.trim()) parts.push(`## ${title.trim()}`);
    if (description.trim()) parts.push(description.trim());
    if (majorChanges.trim()) parts.push(`**Major Changes:**\n${majorChanges.trim()}`);
    if (minorImprovements.trim()) parts.push(`**Minor Improvements:**\n${minorImprovements.trim()}`);
    if (breakingChanges.trim()) parts.push(`**Breaking Changes:**\n${breakingChanges.trim()}`);
    if (migrationNotes.trim()) parts.push(`**Migration Notes:**\n${migrationNotes.trim()}`);
    return parts.join('\n\n');
  };

  const handlePublish = () => {
    if (hasErrors) return;
    const mutationKey = `pub_${master.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    onPublish({ mutationKey, changeSummary: buildChangeSummary() });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div
        className="bg-app-surface rounded-2xl w-full max-w-lg my-4"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-app-border flex items-center justify-between">
          <h3 className="font-bold text-app-text">Publish New Version</h3>
          <button onClick={onClose} className="icon-btn text-app-text-muted hover:text-app-text"><X size={18} /></button>
        </div>

        <div className="px-6 py-5 space-y-5 max-h-[75vh] overflow-y-auto">
          {/* Validation */}
          {(hasErrors || hasWarnings) && (
            <div>
              <button
                onClick={() => setShowValidation(v => !v)}
                className="w-full flex items-center justify-between text-xs font-bold uppercase tracking-wide mb-2"
              >
                <span className={hasErrors ? 'text-app-danger' : 'text-app-warning'}>
                  {hasErrors ? `${validation.errors.length} Error${validation.errors.length !== 1 ? 's' : ''} — Must Fix` : `${validation.warnings.length} Warning${validation.warnings.length !== 1 ? 's' : ''}`}
                </span>
                {showValidation ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>
              {showValidation && (
                <div className="space-y-1.5">
                  {validation.errors.map((e, i) => (
                    <div key={i} className="flex items-start gap-2 p-2.5 bg-app-danger-bg border border-app-danger/20 rounded-lg">
                      <AlertTriangle size={13} className="text-app-danger flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-app-danger">{e}</p>
                    </div>
                  ))}
                  {validation.warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-2 p-2.5 bg-app-warning-bg border border-app-warning/20 rounded-lg">
                      <AlertTriangle size={13} className="text-app-warning flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-app-warning">{w}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {!hasErrors && !hasWarnings && (
            <div className="flex items-center gap-2 p-3 bg-app-success-bg border border-app-success/20 rounded-lg">
              <CheckCircle2 size={14} className="text-app-success flex-shrink-0" />
              <p className="text-sm text-app-success font-medium">All validation checks passed</p>
            </div>
          )}

          {/* Server validation errors from last attempt */}
          {serverValidationErrors?.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-bold text-app-danger uppercase tracking-wide">Server Validation Errors</p>
              {serverValidationErrors.map((e, i) => (
                <div key={i} className="flex items-start gap-2 p-2.5 bg-app-danger-bg border border-app-danger/20 rounded-lg">
                  <AlertTriangle size={13} className="text-app-danger flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-app-danger">{e}</p>
                </div>
              ))}
            </div>
          )}

          {/* Publish error */}
          {publishError && !serverValidationErrors?.length && (
            <div className="flex items-start gap-2 p-2.5 bg-app-danger-bg border border-app-danger/20 rounded-lg">
              <AlertTriangle size={13} className="text-app-danger flex-shrink-0 mt-0.5" />
              <p className="text-xs text-app-danger">{publishError}</p>
            </div>
          )}

          {/* Impact preview */}
          {!hasErrors && (
            <div>
              <button
                onClick={() => setShowImpact(v => !v)}
                className="w-full flex items-center justify-between text-xs font-bold text-app-text-muted uppercase tracking-wide mb-2"
              >
                <span>Structural Change Preview</span>
                {showImpact ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>
              {showImpact && (
                <SopVersionImpactPreview master={master} draftSections={draftSections} />
              )}
            </div>
          )}

          {/* Change summary */}
          <div className="space-y-3">
            <p className="text-xs font-bold text-app-text-muted uppercase tracking-wide">Release Summary</p>
            <div>
              <label className="text-xs font-medium text-app-text-2 mb-1 block">Version Title</label>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Safety protocol update — Q3 2026"
                className="w-full px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text focus:outline-none focus:border-app-accent"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-app-text-2 mb-1 block">Description</label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={2}
                placeholder="What does this version update include?"
                className="w-full px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text focus:outline-none focus:border-app-accent"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-medium text-app-text-2 mb-1 block">Major Changes</label>
                <textarea value={majorChanges} onChange={e => setMajorChanges(e.target.value)} rows={2} placeholder="List major changes…"
                  className="w-full px-3 py-2 bg-app-input border border-app-border rounded-lg text-xs text-app-text focus:outline-none focus:border-app-accent" />
              </div>
              <div>
                <label className="text-xs font-medium text-app-text-2 mb-1 block">Minor Improvements</label>
                <textarea value={minorImprovements} onChange={e => setMinorImprovements(e.target.value)} rows={2} placeholder="List improvements…"
                  className="w-full px-3 py-2 bg-app-input border border-app-border rounded-lg text-xs text-app-text focus:outline-none focus:border-app-accent" />
              </div>
              <div>
                <label className="text-xs font-medium text-app-text-2 mb-1 block">Breaking Changes</label>
                <textarea value={breakingChanges} onChange={e => setBreakingChanges(e.target.value)} rows={2} placeholder="Any breaking changes?"
                  className="w-full px-3 py-2 bg-app-input border border-app-border rounded-lg text-xs text-app-text focus:outline-none focus:border-app-accent" />
              </div>
              <div>
                <label className="text-xs font-medium text-app-text-2 mb-1 block">Migration Notes</label>
                <textarea value={migrationNotes} onChange={e => setMigrationNotes(e.target.value)} rows={2} placeholder="Company adoption guidance…"
                  className="w-full px-3 py-2 bg-app-input border border-app-border rounded-lg text-xs text-app-text focus:outline-none focus:border-app-accent" />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-app-border flex gap-3">
          <button
            onClick={handlePublish}
            disabled={hasErrors || publishing}
            className="flex-1 py-2.5 bg-app-accent text-app-accent-text rounded-xl text-sm font-semibold disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {publishing
              ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Publishing…</>
              : <><Send size={14} /> Publish Version</>
            }
          </button>
          <button onClick={onClose} className="px-5 py-2.5 border border-app-border rounded-xl text-sm text-app-text-2">Cancel</button>
        </div>
      </div>
    </div>
  );
}