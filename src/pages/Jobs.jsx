import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useApp } from '@/lib/AppContext';
import { useCompany } from '@/lib/CompanyContext';
import { Search, SlidersHorizontal, Plus, Star, X } from 'lucide-react';
import JobCard from '@/components/jobs/JobCard';
import FilterSheet from '@/components/jobs/FilterSheet';
import PullToRefresh from '@/components/PullToRefresh';
import { useJobsListState } from '@/lib/useJobsListState';

export default function Jobs() {
  const navigate = useNavigate();
  const { isCompanyAdmin, toggleFavorite, isFavorite, preferences } = useApp();
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id;
  const [jobs, setJobs] = useState([]);
  const [contentIndex, setContentIndex] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({ trade: '', skillLevel: '', category: '' });
  const { saveListState, restoreListState } = useJobsListState();
  const scrollRestoredRef = useRef(false);

  // Restore saved list state (search + filters) on mount when returning from Job Detail
  useEffect(() => {
    const saved = restoreListState();
    if (saved) {
      if (saved.search) setSearch(saved.search);
      if (saved.filters) setFilters(saved.filters);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist search/filters across tab switches so returning to Jobs restores the
  // user's last list view rather than a full reset. Uses the existing
  // sessionStorage slot; the explicit save on job-open (onClick below) still
  // captures the precise pre-detail scroll position.
  useEffect(() => {
    saveListState({ search, filters, scrollY: window.scrollY });
  }, [search, filters]); // eslint-disable-line react-hooks/exhaustive-deps

  // Read-only re-fetch used both on mount and by PullToRefresh.
  // Never mutates; safe to call repeatedly (no duplicate Jobs, no provisioning).
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
      // rAF ensures DOM has painted before scrolling
      requestAnimationFrame(() => {
        window.scrollTo({ top: saved.scrollY, behavior: 'instant' });
        scrollRestoredRef.current = true;
      });
    }
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const publishedJobs = useMemo(() => jobs.filter(j => !j.isArchived && j.status === 'Published'), [jobs]);
  const favoriteJobs = useMemo(() => publishedJobs.filter(j => isFavorite(j.id)), [publishedJobs, isFavorite]);

  const searchResults = useMemo(() => {
    if (!search.trim()) return null;
    const q = search.toLowerCase();
    const results = [];
    const matchMap = {};

    // Match against resolved job metadata (title already override-resolved from server)
    for (const job of publishedJobs) {
      const jobFields = [job.title, job.shortDescription, job.trade, job.category, ...(job.tags || [])].join(' ').toLowerCase();
      if (jobFields.includes(q)) { results.push({ job, match: null }); matchMap[job.id] = true; }
    }

    // Match against resolved content index (includes SOP master + override content)
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

  const filteredJobs = useMemo(() => {
    let list = searchResults ? searchResults.map(r => r.job) : publishedJobs;
    if (filters.trade) list = list.filter(j => j.trade === filters.trade);
    if (filters.skillLevel) list = list.filter(j => j.skillLevel === filters.skillLevel);
    if (filters.category) list = list.filter(j => j.category === filters.category);
    if (preferences.defaultSort === 'title') list = [...list].sort((a, b) => a.title.localeCompare(b.title));
    else if (preferences.defaultSort === 'trade') list = [...list].sort((a, b) => (a.trade || '').localeCompare(b.trade || ''));
    else list = [...list].sort((a, b) => new Date(b.updated_date) - new Date(a.updated_date));
    return list;
  }, [searchResults, publishedJobs, filters, preferences.defaultSort]);

  const trades = [...new Set(publishedJobs.map(j => j.trade).filter(Boolean))];
  const categories = [...new Set(publishedJobs.map(j => j.category).filter(Boolean))];

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-app-bg">
        <div className="w-8 h-8 border-4 border-app-border border-t-app-accent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="px-4 pt-6 pb-4">
      <PullToRefresh onRefresh={fetchJobs} disabled={showFilters} />
      <h1 className="text-2xl font-bold text-app-heading mb-1">Company Procedures</h1>
      {activeCompany && <p className="text-xs text-app-text-muted mb-4">{activeCompany.name}</p>}

      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text-muted" />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search jobs, tools, materials, procedures..."
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
        <button
          onClick={() => setShowFilters(true)}
          className={`px-3 py-2.5 border rounded-lg flex items-center gap-1.5 no-select touch-active ${Object.values(filters).some(Boolean) ? 'border-app-accent bg-app-info-bg text-app-accent' : 'border-app-border bg-app-surface text-app-text-2'}`}
          aria-label="Filters"
        >
          <SlidersHorizontal size={18} />
        </button>
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

      {searchResults && (
        <p className="text-xs text-app-text-muted mb-3">{searchResults.length} job{searchResults.length !== 1 ? 's' : ''} found</p>
      )}

      {!search && favoriteJobs.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-app-text-2 mb-2 flex items-center gap-1.5">
            <Star size={14} className="text-yellow-500 fill-yellow-500" />
            Favorites
          </h2>
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
            {favoriteJobs.map(job => (
              <div key={job.id} role="button" tabIndex={0} aria-label={job.title} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); saveListState({ search, filters, scrollY: window.scrollY }); navigate(`/jobs/${job.id}`); } }} className="flex-shrink-0 w-56 bg-app-card border border-app-border rounded-xl p-3 cursor-pointer no-select touch-active" onClick={() => { saveListState({ search, filters, scrollY: window.scrollY }); navigate(`/jobs/${job.id}`); }}>
                <div className="flex items-start justify-between mb-1">
                  <h3 className="font-semibold text-sm text-app-text line-clamp-2 flex-1 pr-2">{job.title}</h3>
                  <button onClick={(e) => { e.stopPropagation(); toggleFavorite(job.id); }} className="icon-btn touch-active" aria-label="Remove from favorites">
                    <Star size={16} className="text-yellow-500 fill-yellow-500 flex-shrink-0" />
                  </button>
                </div>
                <p className="text-xs text-app-accent font-medium mb-1">{job.trade}</p>
                <p className="text-xs text-app-text-muted line-clamp-2">{job.shortDescription}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {!search && favoriteJobs.length === 0 && (
        <div className="mb-6 bg-app-surface border border-app-border rounded-xl p-4 text-center">
          <Star size={20} className="text-app-text-disabled mx-auto mb-1.5" />
          <p className="text-xs text-app-text-muted">No favorite jobs yet. Tap the star on a job to add it here.</p>
        </div>
      )}

      <div className="space-y-3">
        {!search && <h2 className="text-sm font-semibold text-app-text-2">All Jobs</h2>}
        {filteredJobs.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-app-text-muted text-sm mb-3">
              {search || Object.values(filters).some(Boolean)
                ? 'No jobs match your search or filters.'
                : 'No published jobs yet.'}
            </p>
            {!search && !Object.values(filters).some(Boolean) && isCompanyAdmin && (
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
                isFav={isFavorite(job.id)}
                onFavToggle={() => toggleFavorite(job.id)}
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
        categories={categories}
      />
    </div>
  );
}