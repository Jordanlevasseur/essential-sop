import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useApp } from '@/lib/AppContext';
import { useCompany } from '@/lib/CompanyContext';
import { ArrowLeft, Search, X, Library } from 'lucide-react';
import MasterLibraryCard from '@/components/company-master/MasterLibraryCard';

export default function CompanyMasterLibrary() {
  const navigate = useNavigate();
  const { isCompanyAdmin } = useApp();
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id;

  const [masters, setMasters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!isCompanyAdmin || !companyId) return;
    setLoading(true);
    base44.functions.invoke('resolveCompanyMasterLibrary', { companyId })
      .then(res => {
        const data = res?.data || {};
        if (data.error) throw new Error(data.error);
        setMasters(data.masters || []);
      })
      .catch(() => setError('Failed to load the Master Library.'))
      .finally(() => setLoading(false));
  }, [companyId, isCompanyAdmin]);

  const filtered = useMemo(() => {
    if (!search.trim()) return masters;
    const q = search.toLowerCase();
    return masters.filter(m =>
      [m.title, m.trade, m.category].filter(Boolean).join(' ').toLowerCase().includes(q)
    );
  }, [search, masters]);

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen bg-app-bg">
      <div className="w-8 h-8 border-4 border-app-border border-t-app-accent rounded-full animate-spin" />
    </div>
  );

  // Direct-route denial: only GM/PM (create+edit) may access this surface.
  if (!isCompanyAdmin) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen bg-app-bg">
      <div className="bg-app-surface border-b border-app-border sticky top-0 z-40" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="px-3 py-2.5 flex items-center gap-2.5">
          <button onClick={() => navigate(-1)} className="icon-btn touch-active" aria-label="Back"><ArrowLeft size={22} className="text-app-text-2" /></button>
          <h1 className="font-semibold text-app-text flex-1">Master Library</h1>
        </div>
      </div>

      <div className="px-3 pt-4 pb-3 max-w-2xl mx-auto">
        <p className="text-xs text-app-text-muted mb-3">
          Procedures provisioned to {activeCompany?.name}. These are platform Master SOPs available to your company.
        </p>

        <div className="relative mb-3">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text-muted" />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search provisioned procedures…"
            aria-label="Search master library"
            enterKeyHint="search"
            className="w-full min-h-[44px] pl-9 pr-9 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text placeholder:text-app-text-muted focus:outline-none focus:border-app-accent focus:ring-1 focus:ring-app-accent"
          />
          {search && (
            <button onClick={() => setSearch('')} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-app-text-muted icon-btn"><X size={16} /></button>
          )}
        </div>

        {error ? (
          <div className="p-4 bg-app-danger-bg border border-app-danger rounded-lg text-sm text-app-danger">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <Library size={28} className="text-app-text-muted mx-auto mb-3" />
            <p className="text-app-text-muted text-sm">{search ? 'No provisioned procedures match your search.' : 'No Master SOPs have been provisioned to your company yet.'}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(m => (
              <MasterLibraryCard key={m.masterId} master={m} onClick={() => navigate(`/company-master-library/${m.masterId}`)} />
            ))}
          </div>
        )}
      </div>
      <div style={{ height: 'calc(16px + env(safe-area-inset-bottom))' }} />
    </div>
  );
}