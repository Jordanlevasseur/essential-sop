/**
 * MasterJobDetail — Platform Master Job Detail Container (Platform Workspace Wrapper)
 *
 * This is the Platform workspace wrapper. It owns:
 *   - data retrieval (manageMasterSOP → get)
 *   - normalization from Master SOP shape → shared presentation interface
 *   - Platform-specific permissions
 *   - "Preview as Company" rendering mode (data stays the same, workspace config changes)
 *   - Platform-specific slots: headerActions, contextBanner, metadataView
 *
 * The visible experience is delegated entirely to JobWorkspacePresentation.
 * No Company services, Company Jobs, overrides, or Company state are loaded.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import {
  Eye, EyeOff, CheckCircle2, AlertTriangle, Send, History,
  Copy, Archive, Pencil, X,
} from 'lucide-react';
import JobWorkspacePresentation from '@/components/job-workspace/JobWorkspacePresentation';

// ── Normalization ─────────────────────────────────────────────────────────────
// Maps the manageMasterSOP "get" response into the shape JobWorkspacePresentation expects.

function normalizeMasterToJob(master) {
  return {
    id:                master.id,
    title:             master.title,
    shortDescription:  master.description || '',
    trade:             master.trade || '',
    category:          master.category || '',
    skillLevel:        null,
    estimatedDuration: null,
    tags:              [],
    // pass-through for platform metadata display
    _status:           master.status,
    _currentPublishedVersionId: master.currentPublishedVersionId,
    _distributionPolicy: master.defaultDistributionPolicy,
  };
}

function normalizeSections(sections) {
  // Sections from manageMasterSOP already use the same sectionType keys.
  // Convert contentItems arrays into the contentBySection map.
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

// ── Component ─────────────────────────────────────────────────────────────────

export default function MasterJobDetail() {
  const { masterId } = useParams();
  const navigate = useNavigate();

  const [master, setMaster] = useState(null);
  const [rawSections, setRawSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Preview as Company mode — changes workspace config only, not data source
  const [previewMode, setPreviewMode] = useState(false);

  const libraryPath = '/platform/master-library';

  // ── Load ────────────────────────────────────────────────────────────────────
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

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-app-bg">
        <div className="w-8 h-8 border-4 border-app-border border-t-app-accent rounded-full animate-spin" />
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  if (error || !master) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-6 text-center gap-4">
        <AlertTriangle size={36} className="text-app-warning" />
        <p className="text-base font-semibold text-app-text">
          {error || 'Master Job not found'}
        </p>
        <button
          onClick={load}
          className="px-5 py-2.5 bg-app-accent text-app-accent-text rounded-xl text-sm font-medium"
        >
          Try Again
        </button>
        <button
          onClick={() => navigate(libraryPath)}
          className="text-sm text-app-text-muted underline"
        >
          Back to Master Jobs
        </button>
      </div>
    );
  }

  // ── Data normalization ───────────────────────────────────────────────────────
  const job = normalizeMasterToJob(master);
  const contentBySection = normalizeSections(rawSections);
  const isDraft = master.status === 'draft';
  const isActive = master.status === 'active';

  // ── Workspace configuration ─────────────────────────────────────────────────
  // In preview mode: show as a technician would see it (read-only, no platform controls).
  // The data is still Master Job data — no Company state is loaded.
  const workspace = previewMode
    ? {
        label: 'Preview — as company technician',
        editMode: false,
      }
    : {
        label: 'Essential SOP Platform',
        editMode: false,
      };

  // ── Header actions slot ─────────────────────────────────────────────────────
  const headerActions = previewMode ? (
    // Preview mode: only show exit preview button
    <button
      onClick={() => setPreviewMode(false)}
      className="px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 no-select touch-active bg-app-elevated text-app-text-2 border border-app-border"
    >
      <EyeOff size={14} /> Exit Preview
    </button>
  ) : (
    // Platform mode: full authority controls
    <>
      <button
        onClick={() => setPreviewMode(true)}
        className="px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 no-select touch-active border border-app-border text-app-text-2 bg-app-elevated"
        title="Preview how this job appears to a company technician"
      >
        <Eye size={14} /> Preview
      </button>
      <button
        onClick={() => navigate(`${libraryPath}/${masterId}/edit`)}
        className="px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 no-select touch-active bg-app-accent text-app-accent-text"
        title="Open editor"
      >
        <Pencil size={14} /> Edit
      </button>
    </>
  );

  // ── Context banner slot ─────────────────────────────────────────────────────
  const contextBanner = previewMode ? (
    // Preview banner — clearly labels the viewing mode
    <div className="mx-4 mt-4 mb-0 flex items-center gap-2 px-4 py-3 bg-app-warning-bg border border-app-warning/30 rounded-xl text-sm text-app-warning">
      <Eye size={14} className="flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="font-semibold">Previewing as Company Technician</span>
        <span className="text-app-text-muted text-xs ml-2">
          This shows the standard job as provisioned. No company customizations are applied.
        </span>
      </div>
      <button
        onClick={() => setPreviewMode(false)}
        className="text-app-text-muted ml-2 flex-shrink-0"
        aria-label="Exit preview"
      >
        <X size={16} />
      </button>
    </div>
  ) : !isDraft ? (
    // Published read-only notice
    <div className="mx-4 mt-4 mb-0 flex items-center gap-2 px-4 py-3 bg-app-info-bg border border-app-info/30 rounded-xl text-sm text-app-info">
      <CheckCircle2 size={14} className="flex-shrink-0" />
      <span>Published — read only. Open the editor to create a new draft.</span>
    </div>
  ) : null;

  // ── Metadata view slot ──────────────────────────────────────────────────────
  const metadataView = !previewMode ? (
    <>
      <span className={`font-medium capitalize ${
        master.status === 'active'   ? 'text-app-success' :
        master.status === 'draft'    ? 'text-app-warning' :
        'text-app-text-muted'
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

  return (
    <JobWorkspacePresentation
      job={job}
      contentBySection={contentBySection}
      workspace={workspace}
      headerActions={headerActions}
      contextBanner={contextBanner}
      metadataView={metadataView}
      onBack={() => navigate(libraryPath)}
    />
  );
}