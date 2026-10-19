/**
 * PlatformCompanies — Platform view of all registered companies.
 * Shows company list, provisioning status, membership counts, and
 * allows triggering a company library provisioning run.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import {
  Building2, RefreshCw, Users, CheckCircle2, AlertTriangle,
  BookOpen, ChevronRight, Loader2, Search, X,
} from 'lucide-react';

const STATUS_BADGE = {
  active:    'bg-app-success-bg text-app-success',
  suspended: 'bg-app-warning-bg text-app-warning',
  closed:    'bg-app-danger-bg text-app-danger',
};

export default function PlatformCompanies() {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [provisioningId, setProvisioningId] = useState(null); // companyId being provisioned
  const [provisionResults, setProvisionResults] = useState({}); // companyId → result message

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Company entity is RLS-closed; the platform company list is resolved
      // server-side and requires an active Platform Super Admin membership.
      const res = await base44.functions.invoke('resolvePlatformCompanies', {});
      setCompanies(res.data?.companies || []);
    } catch (e) {
      setError('Failed to load companies.');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleProvision = async (company) => {
    setProvisioningId(company.id);
    setProvisionResults(prev => ({ ...prev, [company.id]: null }));
    try {
      const res = await base44.functions.invoke('provisionCompanyLibrary', {
        companyId: company.id,
        initiatedBy: 'admin',
      });
      const d = res.data;
      const msg = d?.createdCount > 0
        ? `✓ Provisioned ${d.createdCount} new SOP${d.createdCount !== 1 ? 's' : ''}.`
        : d?.skippedCount > 0 || d?.existingProvisionedCount > 0
        ? '✓ Already up to date.'
        : d?.status === 'failed'
        ? `⚠ ${d.errorSummary || 'Provisioning failed.'}`
        : '✓ Complete.';
      setProvisionResults(prev => ({ ...prev, [company.id]: { ok: true, msg } }));
    } catch (e) {
      setProvisionResults(prev => ({
        ...prev, [company.id]: { ok: false, msg: e.message || 'Provisioning failed.' },
      }));
    }
    setProvisioningId(null);
  };

  const filtered = companies.filter(c =>
    !search.trim() || c.name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-app-bg">
      {/* Header */}
      <div className="bg-app-surface border-b border-app-border px-4 py-4 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <Building2 size={20} className="text-app-accent flex-shrink-0" />
          <div className="flex-1">
            <h1 className="font-bold text-app-text">Companies</h1>
            <p className="text-xs text-app-text-muted">{companies.length} registered</p>
          </div>
          <button onClick={load} className="icon-btn text-app-text-muted" aria-label="Refresh">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-5 space-y-4">
        {/* Info banner */}
        <div className="flex items-start gap-3 p-4 bg-app-info-bg border border-app-info/20 rounded-xl text-sm text-app-info">
          <BookOpen size={15} className="flex-shrink-0 mt-0.5" />
          <p>
            Provisioning pushes all eligible Master SOPs (distribution status: customer_available)
            to a company's job library. Existing customizations are never overwritten.
          </p>
        </div>

        {/* Search */}
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text-muted" />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search companies…"
            className="w-full pl-9 pr-8 py-2.5 bg-app-input border border-app-border rounded-lg text-sm text-app-text placeholder:text-app-text-muted focus:outline-none focus:border-app-accent"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-app-text-muted">
              <X size={14} />
            </button>
          )}
        </div>

        {/* List */}
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-app-border border-t-app-accent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <AlertTriangle size={24} className="text-app-warning" />
            <p className="text-sm text-app-danger">{error}</p>
            <button onClick={load} className="px-4 py-2 bg-app-accent text-app-accent-text rounded-lg text-sm font-medium">
              Retry
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-app-text-muted text-sm">
            {search ? 'No companies match your search.' : 'No companies registered yet.'}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(company => {
              const statusCls = STATUS_BADGE[company.status] || STATUS_BADGE.active;
              const result = provisionResults[company.id];
              const isProvisioning = provisioningId === company.id;
              return (
                <div key={company.id} className="bg-app-card border border-app-border rounded-lg p-3">
                  <div className="flex items-center gap-3">
                    {/* Avatar */}
                    <div className="w-10 h-10 bg-app-elevated rounded-lg flex items-center justify-center flex-shrink-0">
                      {company.logo
                        ? <img src={company.logo} alt="" className="w-10 h-10 rounded-lg object-cover" />
                        : <Building2 size={18} className="text-app-text-muted" />
                      }
                    </div>
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-semibold text-sm text-app-text truncate">{company.name}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${statusCls}`}>
                          {company.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-app-text-muted">
                        {company.subscriptionPlanCode && (
                          <span className="capitalize">{company.subscriptionPlanCode.replace(/_/g, ' ')}</span>
                        )}
                        {company.location && <span>{company.location}</span>}
                        <span className="font-mono text-app-text-disabled text-[10px] selectable">{company.id.slice(-6)}</span>
                      </div>
                    </div>
                    {/* Provision button */}
                    <button
                      onClick={() => handleProvision(company)}
                      disabled={isProvisioning || !!provisioningId}
                      title="Provision Master SOP Library"
                      className="flex-shrink-0 px-3 py-1.5 border border-app-border rounded-lg text-xs text-app-text-2 flex items-center gap-1.5 disabled:opacity-40 hover:border-app-accent hover:text-app-accent transition-colors"
                    >
                      {isProvisioning
                        ? <Loader2 size={13} className="animate-spin" />
                        : <BookOpen size={13} />
                      }
                      {isProvisioning ? 'Provisioning…' : 'Provision'}
                    </button>
                  </div>
                  {/* Result message */}
                  {result && (
                    <div className={`mt-2 text-xs flex items-center gap-1.5 ${result.ok ? 'text-app-success' : 'text-app-danger'}`}>
                      {result.ok ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                      {result.msg}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}