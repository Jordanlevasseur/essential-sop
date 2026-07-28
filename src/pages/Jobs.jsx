import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useApp } from '@/lib/AppContext';
import { Search, SlidersHorizontal, Plus, Star, Clock, X } from 'lucide-react';
import JobCard from '@/components/jobs/JobCard';
import FilterSheet from '@/components/jobs/FilterSheet';

export default function Jobs() {
  const navigate = useNavigate();
  const { isAdmin, favorites, toggleFavorite, isFavorite, preferences } = useApp();
  const [jobs, setJobs] = useState([]);
  const [allContent, setAllContent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({ trade: '', skillLevel: '', category: '' });

  useEffect(() => {
    Promise.all([
      base44.entities.Job.list('-updated_date', 200),
      base44.entities.SectionContent.list('-sortOrder', 500),
    ]).then(([j, c]) => {
      setJobs(j || []);
      setAllContent(c || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const publishedJobs = useMemo(() => jobs.filter(j => !j.isArchived && j.status === 'Published'), [jobs]);

  const favoriteJobs = useMemo(() => publishedJobs.filter(j => isFavorite(j.id)), [publishedJobs, isFavorite]);

  const searchResults = useMemo(() => {
    if (!search.trim()) return null;
    const q = search.toLowerCase();
    const results = [];
    const matchMap = {};

    for (const job of publishedJobs) {
      const jobFields = [job.title, job.shortDescription, job.trade, job.category, ...(job.tags || [])].join(' ').toLowerCase();
      if (jobFields.includes(q)) {
        results.push({ job, match: null });
        matchMap[job.id] = true;
      }
    }

    const contentByJob = {};
    for (const item of allContent) {
      if (!contentByJob[item.jobId]) contentByJob[item.jobId] = {};
      const section = item.sectionType;
      if (!contentByJob[item.jobId][section]) contentByJob[item.jobId][section] = [];
      contentByJob[item.jobId][section].push(item);
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
  }, [search, publishedJobs, allContent]);

  const filteredJobs = useMemo(() => {
    let list = searchResults ? searchResults.map(r => r.job) : publishedJobs;
    if (filters.trade) list = list.filter(j => j.trade === filters.trade);
    if (filters.skillLevel) list = list.filter(j => j.skillLevel === filters.skillLevel);
    if (filters.category) list = list.filter(j => j.category === filters.category);

    if (preferences.defaultSort === 'title') list = [...list].sort((a, b) => a.title.localeCompare(b.title));
    else if (preferences.defaultSort === 'trade') list = [...list].sort((a, b) => a.trade.localeCompare(b.trade));
    else list = [...list].sort((a, b) => new Date(b.updated_date) - new Date(a.updated_date));

    return list;
  }, [searchResults, publishedJobs, filters, preferences.defaultSort]);

  const trades = [...new Set(publishedJobs.map(j => j.trade))];
  const categories = [...new Set(publishedJobs.map(j => j.category))];

  const handleJobClick = (job) => navigate(`/jobs/${job.id}`);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-neutral-200 border-t-blue-600 rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="px-4 pt-6 pb-4">
      <h1 className="text-2xl font-bold text-neutral-900 mb-4">Jobs</h1>

      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search jobs, tools, materials, procedures, or keywords"
            className="w-full pl-10 pr-9 py-2.5 bg-white border border-neutral-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400">
              <X size={16} />
            </button>
          )}
        </div>
        <button
          onClick={() => setShowFilters(true)}
          className={`px-3 py-2.5 border rounded-lg flex items-center gap-1.5 ${Object.values(filters).some(Boolean) ? 'border-blue-500 bg-blue-50 text-blue-600' : 'border-neutral-200 bg-white text-neutral-600'}`}
        >
          <SlidersHorizontal size={18} />
        </button>
        {isAdmin && (
          <button
            onClick={() => navigate('/create-job')}
            className="px-3 py-2.5 bg-blue-600 text-white rounded-lg flex items-center gap-1.5 text-sm font-medium"
          >
            <Plus size={18} />
            Create
          </button>
        )}
      </div>

      {searchResults && (
        <p className="text-xs text-neutral-500 mb-3">{searchResults.length} job{searchResults.length !== 1 ? 's' : ''} found</p>
      )}

      {!search && favoriteJobs.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-neutral-700 mb-2 flex items-center gap-1.5">
            <Star size={14} className="text-yellow-500 fill-yellow-500" />
            Favorites
          </h2>
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
            {favoriteJobs.map(job => (
              <div key={job.id} className="flex-shrink-0 w-56 bg-white border border-neutral-200 rounded-xl p-3 cursor-pointer" onClick={() => handleJobClick(job)}>
                <div className="flex items-start justify-between mb-1">
                  <h3 className="font-semibold text-sm text-neutral-900 line-clamp-2 flex-1 pr-2">{job.title}</h3>
                  <button onClick={(e) => { e.stopPropagation(); toggleFavorite(job.id); }}>
                    <Star size={16} className="text-yellow-500 fill-yellow-500 flex-shrink-0" />
                  </button>
                </div>
                <p className="text-xs text-blue-600 font-medium mb-1">{job.trade}</p>
                <p className="text-xs text-neutral-500 line-clamp-2">{job.shortDescription}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {!search && favoriteJobs.length === 0 && (
        <div className="mb-6 bg-neutral-100 rounded-xl p-4 text-center">
          <Star size={20} className="text-neutral-300 mx-auto mb-1.5" />
          <p className="text-xs text-neutral-500">No favorite jobs yet. Tap the star on a job to add it here.</p>
        </div>
      )}

      <div className="space-y-3">
        {!search && <h2 className="text-sm font-semibold text-neutral-700">All Jobs</h2>}
        {filteredJobs.length === 0 ? (
          <div className="text-center py-12 text-neutral-400 text-sm">No jobs found.</div>
        ) : (
          filteredJobs.map(job => {
            const match = searchResults?.find(r => r.job.id === job.id)?.match;
            return (
              <JobCard
                key={job.id}
                job={job}
                isFav={isFavorite(job.id)}
                onFavToggle={() => toggleFavorite(job.id)}
                onClick={() => handleJobClick(job)}
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