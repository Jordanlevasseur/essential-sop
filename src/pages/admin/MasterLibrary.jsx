import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Search, SlidersHorizontal, Plus, X, AlertTriangle, ArrowUpDown, ChevronDown, Tag } from 'lucide-react';
import MasterJobCard from '@/components/platform/MasterJobCard';
import MasterJobFilterSheet from '@/components/platform/MasterJobFilterSheet';
import SelectSheet from '@/components/ui/SelectSheet';
import { useApp } from '@/lib/AppContext';
import { sortItems, SORT_OPTIONS } from '@/lib/jobsSort';

export default function MasterLibrary() {
  const navigate = useNavigate();
  const [masters, setMasters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ status: '', trade: '' });
  const [showFilters, setShowFilters] = useState(false);
  const [showSortSheet, setShowSortSheet] = useState(false);
  const [showCategorySheet, setShowCategorySheet] = useState(false);
  const searchRef = useRef(null);
  const { preferences, updatePreferences } = useApp();
  const sort = preferences.defaultSort || 'name_az';

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

  const activeCategory = categories.includes(preferences.mastersCategory) ? preferences.mastersCategory : '';

  const filtered = useMemo(() => {
    let list = masters;
    if (filters.status) list = list.filter(m => m.status === filters.status);
    if (filters.trade) list = list.filter(m => m.trade === filters.trade);
    if (activeCategory) list = list.filter(m => m.category === activeCategory);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(m =>
        m.title?.toLowerCase().includes(q) ||
        m.trade?.toLowerCase().includes(q) ||
        m.category?.toLowerCase().includes(q) ||
        (m.tags || []).some(t => t.toLowerCase().includes(q))
      );
    }
    return sortItems(list, sort);
  }, [masters, filters, search, activeCategory, sort]);

  const hasActiveFilters = search.trim() || Object.values(filters).some(Boolean) || !!activeCategory;

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
          className="px-5 py-2.5 bg-app-accent text-app-accent-text rounded-lg text-sm font-medium"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="px-3 pt-4 pb-3">
      {/* Header — mirrors Company Jobs page heading */}
      <h1 className="text-2xl font-bold text-app-heading mb-1">Master Jobs</h1>
      <p className="text-xs text-app-text-muted mb-3">Essential SOP Platform</p>

      {/* Search + filter bar — identical structure to Company Jobs */}
      <div className="flex gap-2 mb-3">
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
          onClick={() => navigate(`${basePath}/new`)}
          className="px-3 py-2.5 bg-app-accent text-app-accent-text rounded-lg flex items-center gap-1.5 text-sm font-medium"
        >
          <Plus size={18} />
          <span className="hidden sm:inline">Create</span>
        </button>
      </div>

      {/* Sort + Category controls — same approach as the Jobs screen */}
      <div className="flex gap-2 mb-3">
        <button
          onClick={() => setShowSortSheet(true)}
          className="flex-1 flex items-center justify-between px-3 py-2.5 bg-app-input border border-app-border rounded-lg text-sm text-app-text no-select touch-active"
          aria-label="Sort by"
        >
          <span className="flex items-center gap-1.5 min-w-0">
            <ArrowUpDown size={14} className="text-app-text-muted flex-shrink-0" />
            <span className="truncate"><span className="text-app-text-muted">Sort:</span> {SORT_OPTIONS.find(o => o.value === sort)?.label || 'Name: A–Z'}</span>
          </span>
          <ChevronDown size={16} className="text-app-text-muted flex-shrink-0" />
        </button>
        <button
          onClick={() => setShowCategorySheet(true)}
          className="flex-1 flex items-center justify-between px-3 py-2.5 bg-app-input border border-app-border rounded-lg text-sm text-app-text no-select touch-active"
          aria-label="Category"
        >
          <span className="flex items-center gap-1.5 min-w-0">
            <Tag size={14} className="text-app-text-muted flex-shrink-0" />
            <span className="truncate"><span className="text-app-text-muted">Category:</span> {activeCategory || 'All Categories'}</span>
          </span>
          <ChevronDown size={16} className="text-app-text-muted flex-shrink-0" />
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
            <div className="w-14 h-14 bg-app-elevated rounded-lg flex items-center justify-center text-2xl">
              📋
            </div>
            <div>
              <p className="text-base font-semibold text-app-text mb-1">No Master Jobs yet</p>
              <p className="text-sm text-app-text-muted max-w-xs">
                Create the first Master Job to begin building the standards companies will receive.
              </p>
            </div>
            <button
              onClick={() => navigate(`${basePath}/new`)}
              className="px-5 py-2.5 bg-app-accent text-app-accent-text rounded-lg text-sm font-semibold inline-flex items-center gap-1.5"
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
        <div className="space-y-2">
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
      />

      <SelectSheet
        open={showSortSheet}
        title="Sort by"
        value={sort}
        options={SORT_OPTIONS}
        onSelect={(v) => updatePreferences({ defaultSort: v })}
        onClose={() => setShowSortSheet(false)}
      />
      <SelectSheet
        open={showCategorySheet}
        title="Category"
        value={activeCategory}
        options={[{ value: '', label: 'All Categories' }, ...categories.map(c => ({ value: c, label: c }))]}
        onSelect={(v) => updatePreferences({ mastersCategory: v || '' })}
        onClose={() => setShowCategorySheet(false)}
      />


    </div>
  );
}