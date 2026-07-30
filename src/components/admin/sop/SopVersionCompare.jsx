/**
 * SopVersionCompare — Side-by-side version comparison for Master SOPs.
 * Uses logicalItemId for stable alignment across versions.
 */
import React, { useState, useEffect } from 'react';
import { X, Plus, Minus, Edit3, Equal, Loader2, AlertTriangle } from 'lucide-react';
import { base44 } from '@/api/base44Client';

const SECTION_ORDER = ['tools', 'materials', 'scope', 'procedure', 'safety', 'quality'];
const SECTION_TITLES = { tools: 'Tools', materials: 'Materials', scope: 'Scope', procedure: 'Procedure', safety: 'Safety', quality: 'Quality Standards' };

export default function SopVersionCompare({ master, versionA, versionB, onClose }) {
  // versionA = older, versionB = newer
  const [sectionsA, setSectionsA] = useState(null);
  const [sectionsB, setSectionsB] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      base44.functions.invoke('manageMasterSOP', { action: 'get_version', versionId: versionA.id }),
      base44.functions.invoke('manageMasterSOP', { action: 'get_version', versionId: versionB.id }),
    ]).then(([resA, resB]) => {
      setSectionsA(resA.data?.sections || []);
      setSectionsB(resB.data?.sections || []);
    }).catch(() => {
      setError('Failed to load version content for comparison.');
    }).finally(() => setLoading(false));
  }, [versionA.id, versionB.id]);

  return (
    <div className="fixed inset-0 z-50 bg-app-bg flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-app-surface border-b border-app-border px-6 py-3 flex-shrink-0">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <button onClick={onClose} className="icon-btn text-app-text-2 hover:text-app-text"><X size={20} /></button>
          <div className="flex-1">
            <h2 className="font-semibold text-app-text">{master.title} — Version Comparison</h2>
            <p className="text-xs text-app-text-muted">v{versionA.versionNumber} → v{versionB.versionNumber}</p>
          </div>
          <div className="flex gap-4 text-xs">
            <LegendItem icon={Plus} label="Added" color="text-app-success" />
            <LegendItem icon={Minus} label="Removed" color="text-app-danger" />
            <LegendItem icon={Edit3} label="Modified" color="text-app-warning" />
            <LegendItem icon={Equal} label="Unchanged" color="text-app-text-muted" />
          </div>
        </div>
      </div>

      {loading && (
        <div className="flex-1 flex items-center justify-center gap-3 text-app-text-muted">
          <Loader2 size={18} className="animate-spin" />
          <span className="text-sm">Loading versions…</span>
        </div>
      )}

      {error && (
        <div className="flex-1 flex items-center justify-center gap-2 text-app-warning">
          <AlertTriangle size={16} />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {!loading && !error && sectionsA && sectionsB && (
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">
            {/* Column headers */}
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center py-2 px-4 bg-app-card border border-app-border rounded-xl">
                <span className="text-sm font-semibold text-app-text">v{versionA.versionNumber}</span>
                <span className="text-xs text-app-text-muted ml-2">
                  {versionA.publishedAt ? new Date(versionA.publishedAt).toLocaleDateString() : ''}
                </span>
              </div>
              <div className="text-center py-2 px-4 bg-app-info-bg border border-app-accent/30 rounded-xl">
                <span className="text-sm font-semibold text-app-accent">v{versionB.versionNumber}</span>
                <span className="text-xs text-app-text-muted ml-2">
                  {versionB.publishedAt ? new Date(versionB.publishedAt).toLocaleDateString() : ''}
                </span>
              </div>
            </div>

            {SECTION_ORDER.map(st => (
              <SectionCompare
                key={st}
                sectionType={st}
                title={SECTION_TITLES[st]}
                itemsA={(sectionsA.find(s => s.sectionType === st)?.contentItems || [])}
                itemsB={(sectionsB.find(s => s.sectionType === st)?.contentItems || [])}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SectionCompare({ sectionType, title, itemsA, itemsB }) {
  const pairs = _alignSections(itemsA, itemsB);
  const hasChanges = pairs.some(p => p.status !== 'unchanged');

  return (
    <div className="bg-app-card border border-app-border rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-app-divider flex items-center gap-2">
        <span className="text-xs font-bold text-app-text-muted uppercase tracking-widest">{title}</span>
        {!hasChanges && <span className="text-xs px-2 py-0.5 bg-app-disabled text-app-text-muted rounded-full">No changes</span>}
      </div>
      <div className="divide-y divide-app-divider">
        {pairs.map((pair, i) => (
          <PairRow key={i} pair={pair} />
        ))}
        {pairs.length === 0 && (
          <div className="px-5 py-3 text-xs text-app-text-muted italic">Both versions have no items in this section.</div>
        )}
      </div>
    </div>
  );
}

function PairRow({ pair }) {
  const { itemA, itemB, status } = pair;

  const cellBase = 'flex-1 px-4 py-3 min-w-0';

  if (status === 'unchanged') {
    return (
      <div className="grid grid-cols-2 gap-0 divide-x divide-app-divider">
        <div className={cellBase}><ItemDisplay item={itemA} /></div>
        <div className={cellBase}><ItemDisplay item={itemB} /></div>
      </div>
    );
  }

  if (status === 'added') {
    return (
      <div className="grid grid-cols-2 gap-0 divide-x divide-app-divider">
        <div className={`${cellBase} bg-app-danger-bg/20`}><span className="text-xs text-app-text-muted italic">—</span></div>
        <div className={`${cellBase} bg-app-success-bg/30`}>
          <div className="flex items-start gap-1.5">
            <Plus size={12} className="text-app-success flex-shrink-0 mt-0.5" />
            <ItemDisplay item={itemB} />
          </div>
        </div>
      </div>
    );
  }

  if (status === 'removed') {
    return (
      <div className="grid grid-cols-2 gap-0 divide-x divide-app-divider">
        <div className={`${cellBase} bg-app-danger-bg/30`}>
          <div className="flex items-start gap-1.5">
            <Minus size={12} className="text-app-danger flex-shrink-0 mt-0.5" />
            <ItemDisplay item={itemA} dimmed />
          </div>
        </div>
        <div className={`${cellBase} bg-app-danger-bg/20`}><span className="text-xs text-app-text-muted italic">—</span></div>
      </div>
    );
  }

  if (status === 'modified') {
    return (
      <div className="grid grid-cols-2 gap-0 divide-x divide-app-divider bg-app-warning-bg/10">
        <div className={cellBase}>
          <div className="flex items-start gap-1.5">
            <Edit3 size={12} className="text-app-warning flex-shrink-0 mt-0.5" />
            <ItemDisplay item={itemA} />
          </div>
        </div>
        <div className={cellBase}>
          <div className="flex items-start gap-1.5">
            <Edit3 size={12} className="text-app-warning flex-shrink-0 mt-0.5" />
            <ItemDisplay item={itemB} highlight />
          </div>
        </div>
      </div>
    );
  }

  return null;
}

function ItemDisplay({ item, dimmed = false, highlight = false }) {
  if (!item) return null;
  return (
    <div className={dimmed ? 'opacity-60 line-through' : ''}>
      <p className={`text-sm font-medium ${highlight ? 'text-app-text' : 'text-app-text'}`}>{item.title}</p>
      {item.body && <p className="text-xs text-app-text-2 mt-0.5 line-clamp-2">{item.body}</p>}
    </div>
  );
}

function LegendItem({ icon: Icon, label, color }) {
  return (
    <span className={`flex items-center gap-1 ${color}`}>
      <Icon size={11} />
      <span>{label}</span>
    </span>
  );
}

/**
 * Align two item lists by logicalItemId, producing (status, itemA, itemB) pairs.
 */
function _alignSections(itemsA, itemsB) {
  const byId = (items) => new Map(items.map(i => [i.logicalItemId || `t:${i.title}`, i]));
  const mapA = byId(itemsA);
  const mapB = byId(itemsB);

  const allIds = [...new Set([...mapA.keys(), ...mapB.keys()])];

  return allIds.map(id => {
    const a = mapA.get(id) || null;
    const b = mapB.get(id) || null;
    let status;
    if (!a) status = 'added';
    else if (!b) status = 'removed';
    else if (a.title !== b.title || a.body !== b.body) status = 'modified';
    else status = 'unchanged';
    return { id, itemA: a, itemB: b, status };
  });
}