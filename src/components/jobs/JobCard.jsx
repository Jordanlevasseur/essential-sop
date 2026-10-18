import React from 'react';
import { Clock } from 'lucide-react';

const SKILL_COLORS = {
  Entry: 'text-app-success bg-app-success-bg',
  Intermediate: 'text-app-warning bg-app-warning-bg',
  Advanced: 'text-app-danger bg-app-danger-bg',
};

export default function JobCard({ job, onClick, match }) {
  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-label={job.title}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      className="bg-app-card border border-app-border rounded-lg p-2.5 cursor-pointer active:opacity-80 transition-opacity no-select"
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm text-app-text leading-snug">{job.title}</h3>
          <p className="text-xs text-app-accent font-medium mt-0.5">{job.trade} · {job.category}</p>
          <p className="text-xs text-app-text-muted mt-0.5 line-clamp-2">{job.shortDescription}</p>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {job.skillLevel && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SKILL_COLORS[job.skillLevel] || 'text-app-text-2 bg-app-elevated'}`}>
                {job.skillLevel}
              </span>
            )}
            {job.estimatedDuration && (
              <span className="text-xs text-app-text-muted flex items-center gap-1">
                <Clock size={11} />{job.estimatedDuration}
              </span>
            )}
          </div>
          {match && (
            <p className="text-xs text-app-info mt-1">
              Found in {match.section}: "{match.item}"
            </p>
          )}
        </div>
      </div>
    </div>
  );
}