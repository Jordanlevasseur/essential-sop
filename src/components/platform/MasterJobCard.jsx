import React from 'react';
import { GitBranch, Globe, Lock } from 'lucide-react';

const STATUS_CONFIG = {
  draft:    { label: 'Draft',     cls: 'text-app-warning bg-app-warning-bg' },
  active:   { label: 'Published', cls: 'text-app-success bg-app-success-bg' },
  archived: { label: 'Archived',  cls: 'text-app-text-muted bg-app-disabled' },
};

const DIST_ICON = {
  ALL_EXISTING_AND_FUTURE_COMPANIES: Globe,
  FUTURE_COMPANIES_ONLY: Globe,
  SELECTED_COMPANIES: Lock,
  MANUAL: Lock,
};

export default function MasterJobCard({ master, onClick }) {
  const status = STATUS_CONFIG[master.status] || STATUS_CONFIG.draft;
  const DistIcon = DIST_ICON[master.defaultDistributionPolicy] || Lock;
  const hasVersion = !!master.currentPublishedVersionId;

  return (
    <div
      onClick={onClick}
      className="bg-app-card border border-app-border rounded-lg p-2.5 cursor-pointer active:opacity-80 transition-opacity no-select"
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          {/* Title + status badge */}
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-sm text-app-text leading-snug">{master.title}</h3>
            <span className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-full font-medium mt-0.5 ${status.cls}`}>
              {status.label}
            </span>
          </div>

          {/* Trade · Category — mirrors JobCard's accent line */}
          <p className="text-xs text-app-accent font-medium mt-0.5">
            {[master.trade, master.category].filter(Boolean).join(' · ') || 'No trade set'}
          </p>

          {/* Tags */}
          {master.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {master.tags.slice(0, 4).map(tag => (
                <span key={tag} className="px-1.5 py-0.5 bg-app-info-bg text-app-accent text-[10px] rounded font-medium">{tag}</span>
              ))}
              {master.tags.length > 4 && (
                <span className="px-1.5 py-0.5 bg-app-elevated text-app-text-muted text-[10px] rounded">+{master.tags.length - 4}</span>
              )}
            </div>
          )}

          {/* Platform-specific metadata row */}
          <div className="flex items-center gap-2.5 mt-1.5 flex-wrap">
            {hasVersion && (
              <span className="text-xs text-app-text-muted flex items-center gap-1">
                <GitBranch size={11} />
                v{master.currentVersionNumber ?? '—'}
              </span>
            )}
            <span className="text-xs text-app-text-muted flex items-center gap-1">
              <DistIcon size={11} />
              {master.defaultDistributionPolicy === 'ALL_EXISTING_AND_FUTURE_COMPANIES' ? 'All companies'
                : master.defaultDistributionPolicy === 'FUTURE_COMPANIES_ONLY' ? 'Future companies'
                : master.defaultDistributionPolicy === 'SELECTED_COMPANIES' ? 'Selected companies'
                : 'Manual'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}