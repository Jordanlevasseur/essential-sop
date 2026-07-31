/**
 * SopPublishDialog — Publish + Distribution dialog.
 *
 * Step 1: Validation review + release notes + distribution scope selection
 * Step 2: Confirmation summary
 * Step 3: Publishing in progress
 *
 * Distribution scopes:
 *   PUBLISH_ONLY          — publish without distributing to any company
 *   ALL_COMPANIES         — publish + distribute to all active companies
 *   SELECTED_COMPANIES    — publish + distribute to manually chosen companies
 */
import React, { useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle2, Send, X, ChevronDown, ChevronUp, Building2, Search, Users } from 'lucide-react';
import { base44 } from '@/api/base44Client';
// Note: SopVersionImpactPreview removed — distribution scope replaces it

const SCOPES = [
  {
    id: 'PUBLISH_ONLY',
    label: 'Publish only',
    description: 'Creates the published version. No companies receive it now — distribute later.',
  },
  {
    id: 'ALL_COMPANIES',
    label: 'Publish to all companies',
    description: 'Publishes and provisions this SOP to every active company immediately.',
  },
  {
    id: 'SELECTED_COMPANIES',
    label: 'Publish to selected companies',
    description: 'Publishes and provisions to specific companies you choose.',
  },
];

export default function SopPublishDialog({
  master, draftSections, validation, onPublish, onClose,
  publishing, publishError, serverValidationErrors,
}) {
  const [scope, setScope] = useState('PUBLISH_ONLY');
  const [changeSummary, setChangeSummary] = useState('');
  const [showValidation, setShowValidation] = useState(true);

  // Company selection
  const [companies, setCompanies] = useState([]);
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [companySearch, setCompanySearch] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());

  const hasErrors = validation.errors.length > 0;
  const hasWarnings = validation.warnings.length > 0;

  // Load companies when SELECTED_COMPANIES is chosen
  useEffect(() => {
    if (scope !== 'SELECTED_COMPANIES' || companies.length > 0) return;
    setLoadingCompanies(true);
    base44.functions.invoke('manageMasterSOP', { action: 'list_companies', masterId: master.id })
      .then(res => setCompanies(res.data?.companies || []))
      .catch(() => {})
      .finally(() => setLoadingCompanies(false));
  }, [scope]);

  const filteredCompanies = companies.filter(c =>
    c.name.toLowerCase().includes(companySearch.toLowerCase())
  );

  const toggleCompany = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handlePublish = () => {
    if (hasErrors) return;
    const mutationKey = `pub_${master.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const payload = { mutationKey, changeSummary };

    if (scope === 'ALL_COMPANIES') {
      payload.distributionPolicyOverride = 'ALL_EXISTING_AND_FUTURE_COMPANIES';
      // Mark distributionStatus as customer_available for policy to take effect
      payload.distributionStatus = 'customer_available';
    } else if (scope === 'SELECTED_COMPANIES') {
      payload.distributionPolicyOverride = 'SELECTED_COMPANIES';
      payload.selectedCompanyIds = [...selectedIds];
      payload.distributionStatus = 'customer_available';
    }
    // PUBLISH_ONLY: no distributionPolicyOverride — backend defaults to MANUAL

    onPublish(payload);
  };

  const canPublish = !hasErrors && !publishing &&
    (scope !== 'SELECTED_COMPANIES' || selectedIds.size > 0);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto" onClick={onClose}>
      <div
        className="bg-app-surface rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg sm:my-4 max-h-[92vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-app-border flex items-center justify-between flex-shrink-0">
          <h3 className="font-bold text-app-text">Publish & Distribute</h3>
          <button onClick={onClose} className="icon-btn text-app-text-muted"><X size={18} /></button>
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

          {/* Distribution scope */}
          <div>
            <p className="text-xs font-bold text-app-text-muted uppercase tracking-wide mb-2">Distribution</p>
            <div className="space-y-2">
              {SCOPES.map(s => (
                <button
                  key={s.id}
                  onClick={() => setScope(s.id)}
                  className={`w-full text-left px-4 py-3 rounded-xl border transition-colors ${
                    scope === s.id
                      ? 'border-app-accent bg-app-info-bg'
                      : 'border-app-border bg-app-surface'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                      scope === s.id ? 'border-app-accent' : 'border-app-border'
                    }`}>
                      {scope === s.id && <div className="w-2 h-2 rounded-full bg-app-accent" />}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-app-text">{s.label}</p>
                      <p className="text-xs text-app-text-muted">{s.description}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Company selector */}
          {scope === 'SELECTED_COMPANIES' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold text-app-text-muted uppercase tracking-wide">
                  Select Companies
                </p>
                {selectedIds.size > 0 && (
                  <span className="text-xs text-app-accent font-semibold">{selectedIds.size} selected</span>
                )}
              </div>
              <div className="relative mb-2">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text-muted" />
                <input
                  value={companySearch}
                  onChange={e => setCompanySearch(e.target.value)}
                  placeholder="Search companies…"
                  className="w-full pl-8 pr-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text focus:outline-none focus:border-app-accent"
                />
              </div>
              {loadingCompanies ? (
                <div className="flex items-center justify-center py-6">
                  <div className="w-5 h-5 border-2 border-app-border border-t-app-accent rounded-full animate-spin" />
                </div>
              ) : filteredCompanies.length === 0 ? (
                <p className="text-sm text-app-text-muted text-center py-4">
                  {companies.length === 0 ? 'No active companies found.' : 'No companies match your search.'}
                </p>
              ) : (
                <div className="space-y-1 max-h-48 overflow-y-auto border border-app-border rounded-xl p-1">
                  {filteredCompanies.map(c => (
                    <button
                      key={c.id}
                      onClick={() => toggleCompany(c.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                        selectedIds.has(c.id) ? 'bg-app-info-bg' : 'hover:bg-app-elevated'
                      }`}
                    >
                      <div className={`w-4 h-4 rounded border-2 flex-shrink-0 flex items-center justify-center ${
                        selectedIds.has(c.id) ? 'border-app-accent bg-app-accent' : 'border-app-border'
                      }`}>
                        {selectedIds.has(c.id) && (
                          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                            <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-app-text truncate">{c.name}</p>
                        {c.provisioned && (
                          <p className="text-xs text-app-success">Already provisioned</p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {selectedIds.size > 0 && (
                <div className="flex gap-2 mt-2">
                  <button onClick={() => setSelectedIds(new Set(filteredCompanies.map(c => c.id)))} className="text-xs text-app-accent">Select all</button>
                  <span className="text-app-text-muted">·</span>
                  <button onClick={() => setSelectedIds(new Set())} className="text-xs text-app-text-muted">Clear</button>
                </div>
              )}
            </div>
          )}

          {/* Release notes */}
          <div>
            <label className="text-xs font-bold text-app-text-muted uppercase tracking-wide mb-1.5 block">
              Release Notes <span className="text-app-text-disabled font-normal normal-case">(optional)</span>
            </label>
            <textarea
              value={changeSummary}
              onChange={e => setChangeSummary(e.target.value)}
              rows={3}
              placeholder="What changed in this version? This is shown to company administrators when they review updates."
              className="w-full px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text focus:outline-none focus:border-app-accent"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-app-border flex gap-3 flex-shrink-0" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          <button
            onClick={handlePublish}
            disabled={!canPublish}
            className="flex-1 py-2.5 bg-app-accent text-app-accent-text rounded-xl text-sm font-semibold disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {publishing
              ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Publishing…</>
              : scope === 'PUBLISH_ONLY'
                ? <><Send size={14} /> Publish Version</>
                : scope === 'ALL_COMPANIES'
                  ? <><Users size={14} /> Publish to All Companies</>
                  : <><Building2 size={14} /> Publish to {selectedIds.size} {selectedIds.size === 1 ? 'Company' : 'Companies'}</>
            }
          </button>
          <button onClick={onClose} className="px-5 py-2.5 border border-app-border rounded-xl text-sm text-app-text-2">Cancel</button>
        </div>
      </div>
    </div>
  );
}