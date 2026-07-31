import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Search, SlidersHorizontal, Plus, X, AlertTriangle } from 'lucide-react';
import MasterJobCard from '@/components/platform/MasterJobCard';
import MasterJobFilterSheet from '@/components/platform/MasterJobFilterSheet';
import CreateMasterJobSheet from '@/components/platform/CreateMasterJobSheet';

export default function MasterLibrary() {
  const navigate = useNavigate();
  const [masters, setMasters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ status: '', trade: '', category: '' });
  const [showFilters, setShowFilters] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const searchRef = useRef(null);

  const basePath = window.location.pathname.startsWith('/platform')
    ? '/platform/master-library'
    : '/admin/master-library';

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await base44.functions.invoke('manageMasterSOP', { action: 'list' });
      setMasters(res.data?.masters || []);
    } catch (_) {
      setError('Unable to load Master Jobs. Please try again.');
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const trades = useMemo(() => [...new Set(masters.map(m => m.trade).filter(Boolean))], [masters]);
  const categories = useMemo(() => [...new Set(masters.map(m => m.category).filter(Boolean))], [masters]);

  const filtered = useMemo(() => {
    let list = masters;
    if (filters.status) list = list.filter(m => m.status === filters.status);
    if (filters.trade) list = list.filter(m => m.trade === filters.trade);
    if (filters.category) list = list.filter(m => m.category === filters.category);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(m =>
        m.title?.toLowerCase().includes(q) ||
        m.trade?.toLowerCase().includes(q) ||
        m.category?.toLowerCase().includes(q) ||
        (m.tags || []).some(t => t.toLowerCase().includes(q))
      );
    }
    // Most recently updated first
    return [...list].sort((a, b) => new Date(b.updatedAt || b.created_date) - new Date(a.updatedAt || a.created_date));
  }, [masters, filters, search]);

  const hasActiveFilters = search.trim() || Object.values(filters).some(Boolean);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] bg-app-bg">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-app-border border-t-app-accent rounded-full animate-spin" />
          <p className="text-sm text-app-text-muted">Loading Master Jobs…</p>
        </div>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center gap-4">
        <AlertTriangle size={36} className="text-app-warning" />
        <p className="text-base font-semibold text-app-text">Unable to load Master Jobs</p>
        <p className="text-sm text-app-text-muted">{error}</p>
        <button
          onClick={load}
          className="px-5 py-2.5 bg-app-accent text-app-accent-text rounded-xl text-sm font-medium"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 pt-6 pb-4">
      {/* Header — mirrors Company Jobs page heading */}
      <h1 className="text-2xl font-bold text-app-text mb-1">Master Jobs</h1>
      <p className="text-xs text-app-text-muted mb-4">Essential SOP Platform</p>

      {/* Search + filter bar — identical structure to Company Jobs */}
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text-muted" />
          <input
            ref={searchRef}
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search master jobs, trade, category…"
            aria-label="Search master jobs"
            enterKeyHint="search"
            className="w-full pl-10 pr-9 py-2.5 bg-app-input border border-app-border rounded-lg text-sm text-app-text placeholder:text-app-text-muted focus:outline-none focus:border-app-accent focus:ring-1 focus:ring-app-accent"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-app-text-muted"
            >
              <X size={16} />
            </button>
          )}
        </div>
        <button
          onClick={() => setShowFilters(true)}
          className={`px-3 py-2.5 border rounded-lg flex items-center gap-1.5 no-select touch-active ${
            Object.values(filters).some(Boolean)
              ? 'border-app-accent bg-app-info-bg text-app-accent'
              : 'border-app-border bg-app-surface text-app-text-2'
          }`}
          aria-label="Filters"
        >
          <SlidersHorizontal size={18} />
        </button>
        <button
          onClick={() => setShowCreate(true)}
          className="px-3 py-2.5 bg-app-accent text-app-accent-text rounded-lg flex items-center gap-1.5 text-sm font-medium"
        >
          <Plus size={18} />
          <span className="hidden sm:inline">Create</span>
        </button>
      </div>

      {/* Result count when searching / filtering */}
      {hasActiveFilters && (
        <p className="text-xs text-app-text-muted mb-3">
          {filtered.length} master job{filtered.length !== 1 ? 's' : ''} found
        </p>
      )}

      {/* List */}
      {!hasActiveFilters && (
        <h2 className="text-sm font-semibold text-app-text-2 mb-2">All Master Jobs</h2>
      )}

      {filtered.length === 0 ? (
        masters.length === 0 ? (
          // True empty state
          <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
            <div className="w-16 h-16 bg-app-elevated rounded-2xl flex items-center justify-center text-3xl">
              📋
            </div>
            <div>
              <p className="text-base font-semibold text-app-text mb-1">No Master Jobs yet</p>
              <p className="text-sm text-app-text-muted max-w-xs">
                Create the first Master Job to begin building the standards companies will receive.
              </p>
            </div>
            <button
              onClick={() => setShowCreate(true)}
              className="px-5 py-2.5 bg-app-accent text-app-accent-text rounded-xl text-sm font-semibold inline-flex items-center gap-1.5"
            >
              <Plus size={15} /> Create Master Job
            </button>
          </div>
        ) : (
          // Filter/search empty state
          <div className="text-center py-12">
            <p className="text-sm text-app-text-muted">No master jobs match your search or filters.</p>
          </div>
        )
      ) : (
        <div className="space-y-3">
          {filtered.map(master => (
            <MasterJobCard
              key={master.id}
              master={master}
              onClick={() => navigate(`${basePath}/${master.id}`)}
            />
          ))}
        </div>
      )}

      {/* Filter sheet */}
      <MasterJobFilterSheet
        open={showFilters}
        onClose={() => setShowFilters(false)}
        filters={filters}
        setFilters={setFilters}
        trades={trades}
        categories={categories}
      />

      {/* Create sheet */}
      {showCreate && (
        <CreateMasterJobSheet
          onClose={() => setShowCreate(false)}
          onCreated={(master) => {
            // Navigate BEFORE closing — closing unmounts this component and can
            // interrupt the navigate() call if React flushes the state update first.
            const editPath = window.location.pathname.startsWith('/platform')
              ? `/platform/master-library/${master.id}/edit`
              : `/admin/master-library/${master.id}`;
            navigate(editPath);
            setShowCreate(false);
          }}
        />
      )}
    </div>
  );
}