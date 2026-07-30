import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Search, Plus, BookOpen, FileText, Archive, CheckCircle, ChevronRight, Filter } from 'lucide-react';

const STATUS_COLORS = {
  draft:    'bg-app-warning-bg text-app-warning',
  active:   'bg-app-success-bg text-app-success',
  archived: 'bg-app-disabled text-app-text-muted',
};

export default function MasterLibrary() {
  const navigate = useNavigate();
  const [masters, setMasters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [tradeFilter, setTradeFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [newTrade, setNewTrade] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke('manageMasterSOP', { action: 'list' });
      setMasters(res.data?.masters || []);
    } catch (_) {
      // non-fatal — list stays empty
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const stats = useMemo(() => ({
    total:    masters.length,
    draft:    masters.filter(m => m.status === 'draft').length,
    active:   masters.filter(m => m.status === 'active').length,
    archived: masters.filter(m => m.status === 'archived').length,
    lastModified: masters.reduce((latest, m) => {
      const d = new Date(m.updatedAt || m.created_date);
      return d > latest ? d : latest;
    }, new Date(0)),
  }), [masters]);

  const trades = useMemo(() => [...new Set(masters.map(m => m.trade).filter(Boolean))], [masters]);
  const categories = useMemo(() => [...new Set(masters.map(m => m.category).filter(Boolean))], [masters]);

  const filtered = useMemo(() => {
    let list = masters;
    if (statusFilter) list = list.filter(m => m.status === statusFilter);
    if (tradeFilter) list = list.filter(m => m.trade === tradeFilter);
    if (categoryFilter) list = list.filter(m => m.category === categoryFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(m => m.title.toLowerCase().includes(q) || m.trade?.toLowerCase().includes(q) || m.category?.toLowerCase().includes(q));
    }
    return list;
  }, [masters, statusFilter, tradeFilter, categoryFilter, search]);

  const basePath = window.location.pathname.startsWith('/platform') ? '/platform/master-library' : '/admin/master-library';

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const res = await base44.functions.invoke('manageMasterSOP', { action: 'create', title: newTitle.trim(), category: newCategory.trim(), trade: newTrade.trim() });
      const created = res.data?.master;
      if (created) navigate(`${basePath}/${created.id}`);
    } catch (e) {
      alert('Failed to create: ' + e.message);
    }
    setCreating(false);
  };

  return (
    <div className="min-h-screen bg-app-bg">
      {/* Header */}
      <div className="bg-app-surface border-b border-app-border px-6 py-5">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-bold text-app-text">Master SOP Library</h1>
          <span className="text-xs px-2.5 py-1 bg-app-info-bg text-app-info rounded-full font-semibold">ESOP Admin</span>
        </div>
        <p className="text-sm text-app-text-muted">Essential SOP administration — internal use only</p>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Total', value: stats.total, icon: BookOpen, cls: 'text-app-accent' },
            { label: 'Published', value: stats.active, icon: CheckCircle, cls: 'text-app-success' },
            { label: 'Draft', value: stats.draft, icon: FileText, cls: 'text-app-warning' },
            { label: 'Archived', value: stats.archived, icon: Archive, cls: 'text-app-text-muted' },
          ].map(s => (
            <div key={s.label} className="bg-app-card border border-app-border rounded-xl p-4 flex items-center gap-3">
              <s.icon size={20} className={s.cls} />
              <div>
                <p className="text-xl font-bold text-app-text">{s.value}</p>
                <p className="text-xs text-app-text-muted">{s.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Create new */}
        <div className="bg-app-card border border-app-border rounded-xl p-4 mb-5">
          <h2 className="text-sm font-semibold text-app-text mb-3">Create New Master SOP</h2>
          <div className="flex flex-wrap gap-2">
            <input value={newTitle} onChange={e => setNewTitle(e.target.value)}
              placeholder="SOP Title *"
              className="flex-1 min-w-40 px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text placeholder:text-app-text-muted focus:outline-none focus:border-app-accent" />
            <input value={newTrade} onChange={e => setNewTrade(e.target.value)}
              placeholder="Trade"
              className="w-36 px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text placeholder:text-app-text-muted focus:outline-none focus:border-app-accent" />
            <input value={newCategory} onChange={e => setNewCategory(e.target.value)}
              placeholder="Category"
              className="w-36 px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text placeholder:text-app-text-muted focus:outline-none focus:border-app-accent" />
            <button onClick={handleCreate} disabled={!newTitle.trim() || creating}
              className="px-4 py-2 bg-app-accent text-app-accent-text rounded-lg text-sm font-medium flex items-center gap-1.5 disabled:opacity-50">
              <Plus size={15} /> {creating ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 mb-4">
          <div className="relative flex-1 min-w-48">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text-muted" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search SOPs…"
              className="w-full pl-9 pr-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text placeholder:text-app-text-muted focus:outline-none focus:border-app-accent" />
          </div>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text">
            <option value="">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="active">Published</option>
            <option value="archived">Archived</option>
          </select>
          {trades.length > 0 && (
            <select value={tradeFilter} onChange={e => setTradeFilter(e.target.value)}
              className="px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text">
              <option value="">All Trades</option>
              {trades.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          {categories.length > 0 && (
            <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
              className="px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text">
              <option value="">All Categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </div>

        {/* SOP list */}
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-app-border border-t-app-accent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-app-text-muted text-sm">
            {masters.length === 0 ? 'No SOPs yet. Create the first one above.' : 'No SOPs match the current filters.'}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(master => (
              <button key={master.id} onClick={() => navigate(`${basePath}/${master.id}`)}
                className="w-full bg-app-card border border-app-border rounded-xl p-4 flex items-center gap-4 text-left hover:border-app-accent transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-semibold text-sm text-app-text truncate">{master.title}</span>
                    <span className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[master.status]}`}>
                      {master.status === 'active' ? 'Published' : master.status.charAt(0).toUpperCase() + master.status.slice(1)}
                    </span>
                  </div>
                  <p className="text-xs text-app-text-muted">{[master.trade, master.category].filter(Boolean).join(' · ') || 'No trade/category'}</p>
                </div>
                <ChevronRight size={16} className="text-app-text-disabled flex-shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}