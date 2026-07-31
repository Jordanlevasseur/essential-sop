/**
 * DistributeDialog — Post-publish distribution for an already-published Master SOP.
 * Allows distributing without republishing.
 */
import React, { useState, useEffect } from 'react';
import { X, Search, Building2, Users, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react';
import { base44 } from '@/api/base44Client';

export default function DistributeDialog({ master, onClose, onDistributed }) {
  const [scope, setScope] = useState('SELECTED_COMPANIES');
  const [companies, setCompanies] = useState([]);
  const [loadingCompanies, setLoadingCompanies] = useState(true);
  const [companySearch, setCompanySearch] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [distributing, setDistributing] = useState(false);
  const [result, setResult] = useState(null); // { distributed, skipped, failed, total }
  const [error, setError] = useState(null);

  useEffect(() => {
    base44.functions.invoke('manageMasterSOP', { action: 'list_companies', masterId: master.id })
      .then(res => setCompanies(res.data?.companies || []))
      .catch(() => setError('Failed to load companies.'))
      .finally(() => setLoadingCompanies(false));
  }, [master.id]);

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

  const handleDistribute = async () => {
    if (distributing) return;
    if (scope === 'SELECTED_COMPANIES' && selectedIds.size === 0) return;
    setDistributing(true);
    setError(null);
    try {
      const payload = {
        action: 'distribute',
        masterId: master.id,
        distributionPolicy: scope === 'ALL_COMPANIES'
          ? 'ALL_EXISTING_AND_FUTURE_COMPANIES'
          : 'SELECTED_COMPANIES',
      };
      if (scope === 'SELECTED_COMPANIES') {
        payload.selectedCompanyIds = [...selectedIds];
      }
      const res = await base44.functions.invoke('manageMasterSOP', payload);
      setResult(res.data);
      onDistributed?.(res.data);
    } catch (e) {
      setError(e?.message || 'Distribution failed. Please try again.');
    } finally {
      setDistributing(false);
    }
  };

  const canDistribute = !distributing &&
    (scope === 'ALL_COMPANIES' || selectedIds.size > 0);

  if (result) {
    return (
      <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
        <div
          className="bg-app-surface rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-6 space-y-4"
          onClick={e => e.stopPropagation()}
          style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
        >
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-app-text">Distribution Complete</h3>
            <button onClick={onClose} className="icon-btn text-app-text-muted"><X size={18} /></button>
          </div>
          <div className={`p-4 rounded-xl border ${result.failed > 0 ? 'bg-app-warning-bg border-app-warning/30' : 'bg-app-success-bg border-app-success/30'}`}>
            <div className="flex items-center gap-2 mb-3">
              {result.failed > 0
                ? <AlertTriangle size={16} className="text-app-warning" />
                : <CheckCircle2 size={16} className="text-app-success" />
              }
              <p className="font-semibold text-app-text text-sm">
                {result.failed > 0 ? 'Completed with errors' : 'All companies provisioned'}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-app-surface rounded-lg p-2">
                <p className="text-lg font-bold text-app-success">{result.distributed ?? 0}</p>
                <p className="text-xs text-app-text-muted">Provisioned</p>
              </div>
              <div className="bg-app-surface rounded-lg p-2">
                <p className="text-lg font-bold text-app-text-2">{result.skipped ?? 0}</p>
                <p className="text-xs text-app-text-muted">Already had it</p>
              </div>
              <div className="bg-app-surface rounded-lg p-2">
                <p className={`text-lg font-bold ${result.failed > 0 ? 'text-app-danger' : 'text-app-text-2'}`}>{result.failed ?? 0}</p>
                <p className="text-xs text-app-text-muted">Failed</p>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-full py-3 bg-app-accent text-app-accent-text rounded-xl text-sm font-semibold"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-app-surface rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[92vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-app-border flex items-center justify-between flex-shrink-0">
          <div>
            <h3 className="font-bold text-app-text">Distribute</h3>
            <p className="text-xs text-app-text-muted truncate max-w-xs">{master.title}</p>
          </div>
          <button onClick={onClose} className="icon-btn text-app-text-muted"><X size={18} /></button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {error && (
            <div className="flex items-start gap-2 p-3 bg-app-danger-bg border border-app-danger/20 rounded-lg">
              <AlertTriangle size={14} className="text-app-danger flex-shrink-0 mt-0.5" />
              <p className="text-xs text-app-danger">{error}</p>
            </div>
          )}

          {/* Scope */}
          <div className="space-y-2">
            <button
              onClick={() => setScope('ALL_COMPANIES')}
              className={`w-full text-left px-4 py-3 rounded-xl border transition-colors ${
                scope === 'ALL_COMPANIES' ? 'border-app-accent bg-app-info-bg' : 'border-app-border'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${scope === 'ALL_COMPANIES' ? 'border-app-accent' : 'border-app-border'}`}>
                  {scope === 'ALL_COMPANIES' && <div className="w-2 h-2 rounded-full bg-app-accent" />}
                </div>
                <div>
                  <p className="text-sm font-semibold text-app-text">All active companies</p>
                  <p className="text-xs text-app-text-muted">Provisions to all {companies.length} active companies.</p>
                </div>
              </div>
            </button>
            <button
              onClick={() => setScope('SELECTED_COMPANIES')}
              className={`w-full text-left px-4 py-3 rounded-xl border transition-colors ${
                scope === 'SELECTED_COMPANIES' ? 'border-app-accent bg-app-info-bg' : 'border-app-border'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${scope === 'SELECTED_COMPANIES' ? 'border-app-accent' : 'border-app-border'}`}>
                  {scope === 'SELECTED_COMPANIES' && <div className="w-2 h-2 rounded-full bg-app-accent" />}
                </div>
                <div>
                  <p className="text-sm font-semibold text-app-text">Selected companies</p>
                  <p className="text-xs text-app-text-muted">Choose which companies receive this SOP.</p>
                </div>
              </div>
            </button>
          </div>

          {/* Company picker */}
          {scope === 'SELECTED_COMPANIES' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-app-text-muted">Companies</p>
                {selectedIds.size > 0 && (
                  <span className="text-xs text-app-accent font-semibold">{selectedIds.size} selected</span>
                )}
              </div>
              <div className="relative mb-2">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text-muted" />
                <input
                  value={companySearch}
                  onChange={e => setCompanySearch(e.target.value)}
                  placeholder="Search…"
                  className="w-full pl-8 pr-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text focus:outline-none focus:border-app-accent"
                />
              </div>
              {loadingCompanies ? (
                <div className="flex items-center justify-center py-6">
                  <div className="w-5 h-5 border-2 border-app-border border-t-app-accent rounded-full animate-spin" />
                </div>
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
                          <p className="text-xs text-app-success flex items-center gap-1">
                            <CheckCircle2 size={10} /> Already provisioned
                          </p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {selectedIds.size > 0 && (
                <div className="flex gap-2 mt-1.5">
                  <button onClick={() => setSelectedIds(new Set(filteredCompanies.map(c => c.id)))} className="text-xs text-app-accent">Select all</button>
                  <span className="text-app-text-muted text-xs">·</span>
                  <button onClick={() => setSelectedIds(new Set())} className="text-xs text-app-text-muted">Clear</button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-app-border flex gap-3 flex-shrink-0" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          <button
            onClick={handleDistribute}
            disabled={!canDistribute}
            className="flex-1 py-2.5 bg-app-accent text-app-accent-text rounded-xl text-sm font-semibold disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {distributing
              ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Distributing…</>
              : scope === 'ALL_COMPANIES'
                ? <><Users size={14} /> Distribute to All</>
                : <><Building2 size={14} /> Distribute to {selectedIds.size} {selectedIds.size === 1 ? 'Company' : 'Companies'}</>
            }
          </button>
          <button onClick={onClose} className="px-5 py-2.5 border border-app-border rounded-xl text-sm text-app-text-2">Cancel</button>
        </div>
      </div>
    </div>
  );
}