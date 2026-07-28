import React from 'react';
import { Star, Clock } from 'lucide-react';
import { SECTION_MAP } from '@/lib/constants';

const SKILL_COLORS = {
  Entry: 'bg-green-100 text-green-700',
  Intermediate: 'bg-blue-100 text-blue-700',
  Advanced: 'bg-red-100 text-red-700',
};

const TRADE_ICONS = {
  Plumbing: '🔧', Carpentry: '🪚', Electrical: '⚡', Drywall: '🧱',
  Roofing: '🏠', Inspection: '🔍', Waterproofing: '💧', HVAC: '❄️', Painting: '🎨', General: '🔨',
};

export default function JobCard({ job, isFav, onFavToggle, onClick, match }) {
  const icon = TRADE_ICONS[job.trade] || '📋';

  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-4 cursor-pointer active:bg-neutral-50 transition-colors" onClick={onClick}>
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-12 h-12 bg-neutral-100 rounded-lg flex items-center justify-center text-2xl">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-neutral-900 line-clamp-1">{job.title}</h3>
            <button onClick={(e) => { e.stopPropagation(); onFavToggle(); }} className="flex-shrink-0">
              <Star size={18} className={isFav ? 'text-yellow-500 fill-yellow-500' : 'text-neutral-300'} />
            </button>
          </div>
          <p className="text-xs text-blue-600 font-medium mb-1">{job.trade} · {job.category}</p>
          <p className="text-xs text-neutral-500 line-clamp-2 mb-2">{job.shortDescription}</p>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SKILL_COLORS[job.skillLevel] || 'bg-neutral-100 text-neutral-600'}`}>
              {job.skillLevel}
            </span>
            <span className="text-xs text-neutral-400 flex items-center gap-1">
              <Clock size={11} /> {job.estimatedDuration}
            </span>
          </div>
          {match && (
            <div className="mt-2 px-2 py-1 bg-blue-50 rounded text-xs text-blue-700">
              Matched in {match.section}: {match.item}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}