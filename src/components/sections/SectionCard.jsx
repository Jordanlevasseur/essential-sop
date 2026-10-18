import React from 'react';
import { ChevronRight } from 'lucide-react';

const STATUS_STYLES = {
  'Empty': 'bg-app-inactive-bg text-app-text-muted',
  'In Progress': 'bg-app-warning-bg text-app-warning',
  'Complete': 'bg-app-success-bg text-app-success',
};

export default function SectionCard({ section, icon: Icon, onClick }) {
  const status = section.completionStatus || 'Empty';

  return (
    <div className="bg-app-card border border-app-border rounded-lg p-3 cursor-pointer active:bg-app-elevated transition-colors" onClick={onClick}>
      <div className="flex items-center gap-3">
        {Icon && (
          <div className="flex-shrink-0 w-10 h-10 bg-app-info-bg rounded-lg flex items-center justify-center">
            <Icon size={20} className="text-app-accent" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-app-heading text-sm">{section.title}</h3>
          <p className="text-xs text-app-text-2 line-clamp-1">{section.description}</p>
          <div className="mt-1">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[status]}`}>
              {status}
            </span>
          </div>
        </div>
        <ChevronRight size={18} className="text-app-text-muted flex-shrink-0" />
      </div>
    </div>
  );
}