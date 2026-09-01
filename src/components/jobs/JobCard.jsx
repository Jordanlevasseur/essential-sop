import React from 'react';
import { Star, Clock } from 'lucide-react';
import { TRADE_EMOJI } from '@/lib/constants';

const SKILL_COLORS = {
  Entry: 'text-app-success bg-app-success-bg',
  Intermediate: 'text-app-warning bg-app-warning-bg',
  Advanced: 'text-app-danger bg-app-danger-bg',
};

export default function JobCard({ job, isFav, onFavToggle, onClick, match }) {
  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-label={job.title}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      className="bg-app-card border border-app-border rounded-xl p-4 cursor-pointer active:opacity-80 transition-opacity no-select"
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-10 h-10 bg-app-elevated rounded-lg flex items-center justify-center text-xl">
          {TRADE_EMOJI[job.trade] || '🔨'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-sm text-app-text leading-snug">{job.title}</h3>
            <button
              onClick={e => { e.stopPropagation(); onFavToggle(); }}
              className="flex-shrink-0 mt-0.5 icon-btn no-select touch-active"
              aria-label="Toggle favorite"
            >
              <Star size={18} className={isFav ? 'text-yellow-500 fill-yellow-500' : 'text-app-text-disabled'} />
            </button>
          </div>
          <p className="text-xs text-app-accent font-medium mt-0.5">{job.trade} · {job.category}</p>
          <p className="text-xs text-app-text-muted mt-1 line-clamp-2">{job.shortDescription}</p>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
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
            <p className="text-xs text-app-info mt-1.5">
              Found in {match.section}: "{match.item}"
            </p>
          )}
        </div>
      </div>
    </div>
  );
}