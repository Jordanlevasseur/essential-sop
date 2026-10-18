import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useApp } from '@/lib/AppContext';
import { useCompany } from '@/lib/CompanyContext';
import { Search, SlidersHorizontal, Plus, X, ArrowUpDown, ChevronDown, Tag } from 'lucide-react';
import JobCard from '@/components/jobs/JobCard';
import FilterSheet from '@/components/jobs/FilterSheet';
import SelectSheet from '@/components/ui/SelectSheet';
import PullToRefresh from '@/components/PullToRefresh';
import { useJobsListState } from '@/lib/useJobsListState';
import { sortItems, SORT_OPTIONS } from '@/lib/jobsSort';

export default function Jobs() {
  const navigate = useNavigate();
  const { isCompanyAdmin, preferences, updatePreferences } = useApp();
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id;
  const [jobs, setJobs] = useState([]);
  const [contentIndex, setContentIndex] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [showSortSheet, setShowSortSheet] = useState(false);
  const [showCategorySheet, setShowCategorySheet] = useState(false);
  const [filters, setFilters] = useState({ trade: '', skillLevel: '' });
  const { saveListState, restoreListState } = useJobsListState();
  const scrollRestoredRef = useRef(false);

  const sort = preferences.defaultSort || 'name_az';

  // Restore saved list state (search + filters) on mount when returning from Job Detail.
  // Sort and category are persisted per-user in localStorage (preferences), so they
  // restore across sessions without sessionStorage.
  useEffect(() => {
    const saved = restoreListState();
    if (saved) {
      if (saved.search) setSearch(saved.search);
      if (saved.filters) setFilters({ trade: saved.filters.trade || '', skillLevel: saved.filters.skillLevel || '' });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    saveListState({ search, filters, scrollY: window.scrollY });
  }, [search, filters]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchJobs = useCallback(async () => {
    if (!companyId) return;
    try {
      const res = await base44.functions.invoke('resolveJobsForCompany', { companyId });
      setJobs(res?.data?.jobs || []);
      setContentIndex(res?.data?.contentIndex || []);
    } catch (_) {
      // best-effort refresh; existing list is preserved on failure
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    fetchJobs();
  }, [fetchJobs]);

  // Restore scroll position after list has rendered (only once per mount)
  useEffect(() => {
    if (loading || scrollRestoredRef.current) return;
    const saved = restoreListState();
    if (saved?.scrollY) {
      requestAnimationFrame(() => {
        window.scrollTo({ top: saved.scrollY, behavior: 'instant' });
        scrollRestoredRef.current = true;
      });
    }
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const publishedJobs = useMemo(() => jobs.filter(j => !j.isArchived && j.status === 'Published'), [jobs]);

  const searchResults = useMemo(() => {
    if (!search.trim()) return null;
    const q = search.toLowerCase();
    const results = [];
    const matchMap = {};

    for (const job of publishedJobs) {
      const jobFields = [job.title, job.shortDescription, job.trade, job.category, ...(job.tags || [])].join(' ').toLowerCase();
      if (jobFields.includes(q)) { results.push({ job, match: null }); matchMap[job.id] = true; }
    }

    const contentByJob = {};
    for (const item of contentIndex) {
      if (!contentByJob[item.jobId]) contentByJob[item.jobId] = {};
      if (!contentByJob[item.jobId][item.sectionType]) contentByJob[item.jobId][item.sectionType] = [];
      contentByJob[item.jobId][item.sectionType].push(item);
    }

    for (const job of publishedJobs) {
      if (matchMap[job.id]) continue;
      const sections = contentByJob[job.id];
      if (!sections) continue;
      let foundMatch = null;
      for (const [sectionType, items] of Object.entries(sections)) {
        for (const item of items) {
          const text = [item.title, item.body].join(' ').toLowerCase();
          if (text.includes(q)) {
            const sectionLabel = sectionType === 'quality' ? 'Quality Checklist' : sectionType.charAt(0).toUpperCase() + sectionType.slice(1);
            foundMatch = { section: sectionLabel, item: item.title };
            break;
          }
        }
        if (foundMatch) break;
      }
      if (foundMatch) results.push({ job, match: foundMatch });
    }
    return results;
  }, [search, publishedJobs, contentIndex]);

  const trades = useMemo(() => [...new Set(publishedJobs.map(j => j.trade).filter(Boolean))], [publishedJobs]);
  const categories = useMemo(() => [...new Set(publishedJobs.map(j => j.category).filter(Boolean))], [publishedJobs]);

  // Category preference: fall back to All Categories if the saved value is no
  // longer present in the accessible collection.
  const activeCategory = categories.includes(preferences.jobsCategory) ? preferences.jobsCategory : '';

  const filteredJobs = useMemo(() => {
    let list = searchResults ? searchResults.map(r => r.job) : publishedJobs;
    if (filters.trade) list = list.filter(j => j.trade === filters.trade);
    if (filters.skillLevel) list = list.filter(j => j.skillLevel === filters.skillLevel);
    if (activeCategory) list = list.filter(j => j.category === activeCategory);
    return sortItems(list, sort);
  }, [searchResults, publishedJobs, filters, activeCategory, sort]);

  const sortLabel = SORT_OPTIONS.find(o => o.value === sort)?.label || 'Name: A–Z';
  const categoryLabel = activeCategory || 'All Categories';
  const categoryOptions = useMemo(
    () => [{ value: '', label: 'All Categories' }, ...categories.map(c => ({ value: c, label: c }))],
    [categories]
  );
  const hasFilters = filters.trade || filters.skillLevel || !!activeCategory;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-app-bg">
        <div className="w-8 h-8 border-4 border-app-border border-t-app-accent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="px-3 pt-4 pb-3">
      <PullToRefresh onRefresh={fetchJobs} disabled={showFilters} />
      <h1 className="text-2xl font-bold text-app-heading mb-1">Company Procedures</h1>
      {activeCompany && <p className="text-xs text-app-text-muted mb-3">{activeCompany.name}</p>}

      <div className="flex gap-2 mb-3">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text-muted" />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search procedures…"
            aria-label="Search jobs"
            enterKeyHint="search"
            className="w-full pl-10 pr-9 py-2.5 bg-app-input border border-app-border rounded-lg text-sm text-app-text placeholder:text-app-text-muted focus:outline-none focus:border-app-accent focus:ring-1 focus:ring-app-accent"
          />
          {search && (
            <button onClick={() => setSearch('')} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 text-app-text-muted">
              <X size={16} />
            </button>
          )}
        </div>
        {isCompanyAdmin && (
          <button
            onClick={() => navigate('/create-job')}
            className="px-3 py-2.5 bg-app-accent text-app-accent-text rounded-lg flex items-center gap-1.5 text-sm font-medium"
          >
            <Plus size={18} />
            Create
          </button>
        )}
      </div>

      {/* Sort + Category controls — independent of each other and of search */}
      <div className="flex gap-2 mb-3">
        <button
          onClick={() => setShowSortSheet(true)}
          className="flex-1 flex items-center justify-between px-3 py-2.5 bg-app-input border border-app-border rounded-lg text-sm text-app-text no-select touch-active"
          aria-label="Sort by"
        >
          <span className="flex items-center gap-1.5 min-w-0">
            <ArrowUpDown size={14} className="text-app-text-muted flex-shrink-0" />
            <span className="truncate"><span className="text-app-text-muted">Sort:</span> {sortLabel}</span>
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
            <span className="truncate"><span className="text-app-text-muted">Category:</span> {categoryLabel}</span>
          </span>
          <ChevronDown size={16} className="text-app-text-muted flex-shrink-0" />
        </button>
        <button
          onClick={() => setShowFilters(true)}
          className={`px-3 py-2.5 border rounded-lg flex items-center gap-1.5 no-select touch-active ${filters.trade || filters.skillLevel ? 'border-app-accent bg-app-info-bg text-app-accent' : 'border-app-border bg-app-surface text-app-text-2'}`}
          aria-label="Filters"
        >
          <SlidersHorizontal size={18} />
        </button>
      </div>

      {searchResults && (
        <p className="text-xs text-app-text-muted mb-3">{searchResults.length} job{searchResults.length !== 1 ? 's' : ''} found</p>
      )}

      <div className="space-y-2">
        {!search && <h2 className="text-sm font-semibold text-app-text-2">All Jobs</h2>}
        {filteredJobs.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-app-text-muted text-sm mb-3">
              {search || hasFilters
                ? 'No jobs match your search or filters.'
                : 'No published jobs yet.'}
            </p>
            {!search && !hasFilters && isCompanyAdmin && (
              <button
                onClick={() => navigate('/create-job')}
                className="px-4 py-2 bg-app-accent text-app-accent-text rounded-lg text-sm font-medium inline-flex items-center gap-1.5"
              >
                <Plus size={15} /> Create your first job
              </button>
            )}
          </div>
        ) : (
          filteredJobs.map(job => {
            const match = searchResults?.find(r => r.job.id === job.id)?.match;
            return (
              <JobCard
                key={job.id}
                job={job}
                onClick={() => { saveListState({ search, filters, scrollY: window.scrollY }); navigate(`/jobs/${job.id}`); }}
                match={match}
              />
            );
          })
        )}
      </div>

      <FilterSheet
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
        options={categoryOptions}
        onSelect={(v) => updatePreferences({ jobsCategory: v || '' })}
        onClose={() => setShowCategorySheet(false)}
      />
    </div>
  );
}