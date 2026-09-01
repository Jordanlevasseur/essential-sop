/**
 * SopPublishDialog — Publish (versioning only) dialog.
 *
 * Publishing establishes the official Platform Master SOP version and records
 * version-history notes (change summary / publishing notes). It does NOT
 * distribute to companies — distribution is a separate operation on the
 * published Master SOP page (DistributeDialog).
 *
 * Publishing-note fields are preserved and persisted on the EssentialSOPVersion
 * as changeNotes via the existing publish workflow (manageMasterSOP/publish →
 * publishMasterSOPVersion). Nothing here selects companies, sets distribution
 * policy, or provisions anything.
 */
import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Send, X, ChevronDown, ChevronUp } from 'lucide-react';

export default function SopPublishDialog({
  master, validation, onPublish, onClose,
  publishing, publishError, serverValidationErrors,
}) {
  const [changeSummary, setChangeSummary] = useState('');
  const [showValidation, setShowValidation] = useState(true);

  const hasErrors = validation.errors.length > 0;
  const hasWarnings = validation.warnings.length > 0;
  const canPublish = !hasErrors && !publishing;

  const handlePublish = () => {
    const mutationKey = `pub_${master.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    // Publishing only — no distribution policy, no selected companies.
    onPublish({ mutationKey, changeSummary });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Publish Version"
        className="bg-app-surface rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg sm:my-4 max-h-[92vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-app-border flex items-center justify-between flex-shrink-0">
          <h3 className="font-bold text-app-text">Publish Version</h3>
          <button onClick={onClose} className="icon-btn text-app-text-muted" aria-label="Close"><X size={18} /></button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">
          {/* Validation */}
          {(hasErrors || hasWarnings) && (
            <div>
              <button
                onClick={() => setShowValidation(v => !v)}
                className="w-full flex items-center justify-between text-xs font-bold uppercase tracking-wide mb-2"
              >
                <span className={hasErrors ? 'text-app-danger' : 'text-app-warning'}>
                  {hasErrors
                    ? `${validation.errors.length} Error${validation.errors.length !== 1 ? 's' : ''} — Must Fix`
                    : `${validation.warnings.length} Warning${validation.warnings.length !== 1 ? 's' : ''}`}
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

          {/* Server errors */}
          {serverValidationErrors?.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-bold text-app-danger uppercase tracking-wide">Server Errors</p>
              {serverValidationErrors.map((e, i) => (
                <div key={i} className="flex items-start gap-2 p-2.5 bg-app-danger-bg border border-app-danger/20 rounded-lg">
                  <AlertTriangle size={13} className="text-app-danger flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-app-danger">{e}</p>
                </div>
              ))}
            </div>
          )}

          {publishError && !serverValidationErrors?.length && (
            <div className="flex items-start gap-2 p-2.5 bg-app-danger-bg border border-app-danger/20 rounded-lg">
              <AlertTriangle size={13} className="text-app-danger flex-shrink-0 mt-0.5" />
              <p className="text-xs text-app-danger">{publishError}</p>
            </div>
          )}

          {/* Publishing notes / change summary (version history) */}
          <div>
            <label className="text-xs font-bold text-app-text-muted uppercase tracking-wide mb-1.5 block">
              Publishing Notes <span className="text-app-text-disabled font-normal normal-case">(optional)</span>
            </label>
            <textarea
              value={changeSummary}
              onChange={e => setChangeSummary(e.target.value)}
              rows={4}
              placeholder="What changed in this version? Why is it being published? Important notes for version history."
              className="w-full px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text focus:outline-none focus:border-app-accent"
            />
            <p className="text-xs text-app-text-muted mt-1.5">
              These notes are saved to the published version's history. Distribution to companies is a separate step on the published SOP page.
            </p>
          </div>
        </div>

        {/* Footer — single Publish action */}
        <div className="px-5 py-4 border-t border-app-border flex gap-3 flex-shrink-0" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          <button
            onClick={handlePublish}
            disabled={!canPublish}
            className="flex-1 py-2.5 bg-app-accent text-app-accent-text rounded-xl text-sm font-semibold disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {publishing
              ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Publishing…</>
              : <><Send size={14} /> Publish Version</>
            }
          </button>
          <button onClick={onClose} className="px-5 py-2.5 border border-app-border rounded-xl text-sm text-app-text-2">Cancel</button>
        </div>
      </div>
    </div>
  );
}