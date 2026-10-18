/**
 * MasterJobDetail — Platform Master Job Detail Container
 *
 * Owns data retrieval, normalization, platform permissions, Preview mode,
 * and Distribution controls (Distribute button + DistributionStatusPanel).
 */
import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import {
  Eye, EyeOff, CheckCircle2, AlertTriangle, Pencil, X,
  Send, ChevronDown, ChevronUp,
} from 'lucide-react';
import JobWorkspacePresentation from '@/components/job-workspace/JobWorkspacePresentation';
import DistributeDialog from '@/components/platform/DistributeDialog';
import DistributionStatusPanel from '@/components/platform/DistributionStatusPanel';

function normalizeMasterToJob(master) {
  return {
    id:                master.id,
    title:             master.title,
    shortDescription:  master.description || '',
    trade:             master.trade || '',
    category:          master.category || '',
    estimatedDuration: null,
    tags:              Array.isArray(master.tags) ? master.tags : [],
    _status:           master.status,
    _currentPublishedVersionId: master.currentPublishedVersionId,
    _distributionPolicy: master.defaultDistributionPolicy,
  };
}

function normalizeSections(sections) {
  const map = {};
  for (const section of sections || []) {
    const items = (section.contentItems || []).map((item, i) => ({
      ...item,
      id: item.logicalItemId || `${section.sectionType}_${i}`,
    }));
    map[section.sectionType] = items;
  }
  return map;
}

export default function MasterJobDetail() {
  const { masterId } = useParams();
  const navigate = useNavigate();

  const [master, setMaster] = useState(null);
  const [rawSections, setRawSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [showDistribute, setShowDistribute] = useState(false);
  const [showDistributionPanel, setShowDistributionPanel] = useState(true);
  const [distributionRefreshKey, setDistributionRefreshKey] = useState(0);

  const libraryPath = '/platform/master-library';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await base44.functions.invoke('manageMasterSOP', { action: 'get', masterId });
      const { master: m, sections: s } = res.data;
      setMaster(m);
      setRawSections(s || []);
    } catch (e) {
      setError('Unable to load Master Job. ' + (e.message || 'Please try again.'));
    }
    setLoading(false);
  }, [masterId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-app-bg">
        <div className="w-8 h-8 border-4 border-app-border border-t-app-accent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !master) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-6 text-center gap-4">
        <AlertTriangle size={36} className="text-app-warning" />
        <p className="text-base font-semibold text-app-text">{error || 'Master Job not found'}</p>
        <button onClick={load} className="px-5 py-2.5 bg-app-accent text-app-accent-text rounded-xl text-sm font-medium">Try Again</button>
        <button onClick={() => navigate(libraryPath)} className="text-sm text-app-text-muted underline">Back to Master Jobs</button>
      </div>
    );
  }

  const job = normalizeMasterToJob(master);
  const contentBySection = normalizeSections(rawSections);
  const isDraft = master.status === 'draft';
  const isActive = master.status === 'active';

  const workspace = previewMode
    ? { label: 'Preview — as company technician', editMode: false }
    : { label: 'Essential SOP Platform', editMode: false };

  // ── Header actions ────────────────────────────────────────────────────────
  const headerActions = previewMode ? (
    <button
      onClick={() => setPreviewMode(false)}
      className="px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 no-select touch-active bg-app-elevated text-app-text-2 border border-app-border"
    >
      <EyeOff size={14} /> Exit Preview
    </button>
  ) : (
    <>
      <button
        onClick={() => setPreviewMode(true)}
        className="px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 no-select touch-active border border-app-border text-app-text-2 bg-app-elevated"
      >
        <Eye size={14} /> Preview
      </button>
      {isActive && (
        <button
          onClick={() => setShowDistribute(true)}
          className="px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 no-select touch-active border border-app-border text-app-text-2 bg-app-elevated"
        >
          <Send size={14} /> Distribute
        </button>
      )}
      <button
        onClick={() => navigate(`${libraryPath}/${masterId}/edit`)}
        className="px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 no-select touch-active bg-app-accent text-app-accent-text"
      >
        <Pencil size={14} /> Edit
      </button>
    </>
  );

  // ── Context banner ────────────────────────────────────────────────────────
  const contextBanner = previewMode ? (
    <div className="mx-4 mt-4 mb-0 flex items-center gap-2 px-4 py-3 bg-app-warning-bg border border-app-warning/30 rounded-xl text-sm text-app-warning">
      <Eye size={14} className="flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="font-semibold">Previewing as Company Technician</span>
        <span className="text-app-text-muted text-xs ml-2">No company customizations applied.</span>
      </div>
      <button onClick={() => setPreviewMode(false)} className="text-app-text-muted ml-2 flex-shrink-0" aria-label="Exit preview">
        <X size={16} />
      </button>
    </div>
  ) : !isDraft ? (
    <div className="mx-4 mt-4 mb-0 flex items-center gap-2 px-4 py-3 bg-app-info-bg border border-app-info/30 rounded-xl text-sm text-app-info">
      <CheckCircle2 size={14} className="flex-shrink-0" />
      <span>Published — read only. Open the editor to create a new draft.</span>
    </div>
  ) : null;

  // ── Metadata view ─────────────────────────────────────────────────────────
  const metadataView = !previewMode ? (
    <>
      <span className={`font-medium capitalize ${
        master.status === 'active' ? 'text-app-success' :
        master.status === 'draft'  ? 'text-app-warning' : 'text-app-text-muted'
      }`}>
        {master.status === 'active' ? 'Published' : master.status}
      </span>
      {master.defaultDistributionPolicy && master.defaultDistributionPolicy !== 'MANUAL' && (
        <span className="text-app-text-muted capitalize">
          · {master.defaultDistributionPolicy.replace(/_/g, ' ').toLowerCase()}
        </span>
      )}
    </>
  ) : null;

  // ── Distribution panel (below content, only for active/published) ─────────
  const distributionPanel = isActive && !previewMode ? (
    <div className="mx-4 mt-6 bg-app-card border border-app-border rounded-xl overflow-hidden">
      <button
        onClick={() => setShowDistributionPanel(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <Send size={15} className="text-app-text-muted" />
          <span className="text-sm font-semibold text-app-text">Distribution</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); setShowDistribute(true); }}
            className="px-3 py-1 bg-app-accent text-app-accent-text rounded-lg text-xs font-medium"
          >
            Distribute
          </button>
          {showDistributionPanel ? <ChevronUp size={14} className="text-app-text-muted" /> : <ChevronDown size={14} className="text-app-text-muted" />}
        </div>
      </button>
      {showDistributionPanel && (
        <div className="px-4 pb-4 border-t border-app-border pt-3">
          <DistributionStatusPanel
            masterId={masterId}
            refreshKey={distributionRefreshKey}
          />
        </div>
      )}
    </div>
  ) : null;

  return (
    <>
      <JobWorkspacePresentation
        job={job}
        contentBySection={contentBySection}
        workspace={workspace}
        headerActions={headerActions}
        contextBanner={contextBanner}
        metadataView={metadataView}
        onBack={() => navigate(libraryPath)}
        footerSlot={distributionPanel}
      />

      {showDistribute && (
        <DistributeDialog
          master={master}
          onClose={() => setShowDistribute(false)}
          onDistributed={() => {
            setDistributionRefreshKey(k => k + 1);
          }}
        />
      )}
    </>
  );
}