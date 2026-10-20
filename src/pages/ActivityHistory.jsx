import React, { useState, useEffect, useMemo } from 'react';
import { useSafeBack } from '@/lib/useSafeBack';
import { base44 } from '@/api/base44Client';
import { useCompany } from '@/lib/CompanyContext';
import { ArrowLeft, SlidersHorizontal, X, Search } from 'lucide-react';
import { getActivityCategory, PM_VISIBLE_ACTIONS } from '@/lib/roleLabels';

const FILTERS = [
  { id: 'all',         label: 'All' },
  { id: 'jobs',        label: 'Jobs' },
  { id: 'team',        label: 'Team' },
  { id: 'edit_access', label: 'Edit Access' },
  { id: 'account',     label: 'Account' },
];

// Actions visible to Project Leads (only their own edit-related activity)
const PL_VISIBLE_ACTIONS = [
  'edit_request_submitted', 'edit_request_approved', 'edit_request_denied',
  'temporary_access_granted', 'temporary_access_revoked', 'temporary_access_expired',
  'revision_submitted', 'revision_changes_requested', 'revision_rejected', 'revision_published',
];

// Role-based filtering is now performed server-side by resolveCompanyActivity.
// PL_VISIBLE_ACTIONS retained for reference; no longer used client-side.
const _PL_VISIBLE_ACTIONS = [
  'edit_request_submitted', 'edit_request_approved', 'edit_request_denied',
  'temporary_access_granted', 'temporary_access_revoked', 'temporary_access_expired',
  'revision_submitted', 'revision_changes_requested', 'revision_rejected', 'revision_published',
];

function relativeTime(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export default function ActivityHistory() {
  const handleBack = useSafeBack('/profile');
  const { activeCompany, activeMembership } = useCompany();
  const companyId = activeCompany?.id;
  const role = activeMembership?.role;
  const isGM = role === 'general_manager';
  const isPM = role === 'project_manager';
  const isPL = role === 'project_lead';
  const canView = isGM || isPM || isPL;

  const [logs, setLogs] = useState([]);
  const [users, setUsers] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [showFilterSheet, setShowFilterSheet] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    if (!companyId || !canView) return;
    base44.functions.invoke('resolveCompanyActivity', { companyId }).then((res) => {
      const data = res.data;
      if (!data || data.error) { setLoading(false); return; }
      setLogs(data.logs || []);
      setUsers(data.users || []);
      setJobs(data.jobs || []);
      setLoading(false);
    }).catch(() => { setLoading(false); });
  }, [companyId, canView]);

  const getUser = id => users.find(u => u.id === id);
  const getJob = id => jobs.find(j => j.id === id);

  const filtered = useMemo(() => {
    let list = logs;

    // Category filter
    if (filter !== 'all') list = list.filter(l => getActivityCategory(l.actionType) === filter);

    // Date range
    if (dateFrom) list = list.filter(l => l.timestamp && new Date(l.timestamp) >= new Date(dateFrom));
    if (dateTo) list = list.filter(l => l.timestamp && new Date(l.timestamp) <= new Date(dateTo + 'T23:59:59'));

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(l => {
        const u = getUser(l.actingUserId);
        const j = getJob(l.targetId);
        const text = [l.summary, u?.full_name, u?.email, j?.title, l.actionType].join(' ').toLowerCase();
        return text.includes(q);
      });
    }

    return list;
  }, [logs, filter, search, dateFrom, dateTo]);

  if (!canView) {
    return (
      <div className="min-h-screen bg-app-bg flex items-center justify-center p-8 text-center">
        <p className="text-sm text-app-text-muted">Activity History is not available for your role.</p>
      </div>
    );
  }

  const hasActiveFilters = filter !== 'all' || dateFrom || dateTo || search;

  return (
    <div className="min-h-screen bg-app-bg">
      <div className="bg-app-surface border-b border-app-border sticky top-0 z-40" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="px-3 py-2.5 flex items-center gap-2.5">
          <button onClick={handleBack} className="icon-btn touch-active"><ArrowLeft size={22} className="text-app-text-2" /></button>
          <h1 className="font-semibold text-app-text flex-1">Activity History</h1>
          <button onClick={() => setShowFilterSheet(true)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border touch-active no-select ${hasActiveFilters ? 'border-app-accent bg-app-info-bg text-app-accent' : 'border-app-border bg-app-elevated text-app-text-2'}`}>
            <SlidersHorizontal size={14} /> Filter
          </button>
        </div>
        {/* Category tabs */}
        <div className="flex overflow-x-auto scrollbar-hide border-t border-app-divider">
          {FILTERS.map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={`flex-shrink-0 px-4 py-2.5 text-xs font-semibold whitespace-nowrap transition-colors ${filter === f.id ? 'text-app-accent border-b-2 border-app-accent' : 'text-app-text-muted'}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-3 pt-4 pb-3 max-w-2xl mx-auto">
        {/* Search */}
        <div className="relative mb-4">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text-muted" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by person or job…"
            className="w-full pl-9 pr-8 py-2.5 bg-app-input border border-app-border rounded-lg text-sm text-app-text placeholder:text-app-text-muted focus:outline-none focus:border-app-accent" />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-app-text-muted">
              <X size={14} />
            </button>
          )}
        </div>

        {/* Active filter chips */}
        {(dateFrom || dateTo) && (
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            {dateFrom && (
              <span className="flex items-center gap-1 text-xs px-2.5 py-1 bg-app-info-bg text-app-accent rounded-full">
                From {dateFrom}
                <button onClick={() => setDateFrom('')}><X size={10} /></button>
              </span>
            )}
            {dateTo && (
              <span className="flex items-center gap-1 text-xs px-2.5 py-1 bg-app-info-bg text-app-accent rounded-full">
                To {dateTo}
                <button onClick={() => setDateTo('')}><X size={10} /></button>
              </span>
            )}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-4 border-app-border border-t-app-accent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-app-text-muted text-center py-12">No activity found.</p>
        ) : (
          <div className="space-y-px">
            {filtered.map(log => {
              const actor = getUser(log.actingUserId);
              return (
                <div key={log.id} className="flex gap-3 py-3 border-b border-app-divider last:border-0">
                  <div className="w-7 h-7 rounded-full bg-app-elevated flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-xs font-bold text-app-text-muted">
                      {actor?.full_name?.charAt(0)?.toUpperCase() || '?'}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-app-text leading-snug">
                      {log.summary || log.actionType.replace(/_/g, ' ')}
                    </p>
                    <p className="text-xs text-app-text-disabled mt-0.5">{relativeTime(log.timestamp)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Filter sheet */}
      {showFilterSheet && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setShowFilterSheet(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-app-surface rounded-t-2xl p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-app-text mb-4">Filter Activity</h3>

            <p className="text-xs font-semibold text-app-text-muted uppercase mb-2">Date Range</p>
            <div className="flex gap-3 mb-4">
              <div className="flex-1">
                <label className="text-xs text-app-text-muted block mb-1">From</label>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                  className="w-full px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text" />
              </div>
              <div className="flex-1">
                <label className="text-xs text-app-text-muted block mb-1">To</label>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                  className="w-full px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text" />
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={() => { setDateFrom(''); setDateTo(''); setFilter('all'); setShowFilterSheet(false); }}
                className="flex-1 py-2.5 border border-app-border rounded-lg text-sm text-app-text-2 touch-active no-select">
                Clear Filters
              </button>
              <button onClick={() => setShowFilterSheet(false)}
                className="flex-1 py-2.5 bg-app-accent text-app-accent-text rounded-lg text-sm font-medium touch-active no-select">
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ height: 'calc(16px + env(safe-area-inset-bottom))' }} />
    </div>
  );
}