import React from 'react';
import { ChevronRight } from 'lucide-react';

const STATUS_STYLES = {
  'Empty': 'bg-neutral-100 text-neutral-400',
  'In Progress': 'bg-yellow-100 text-yellow-700',
  'Complete': 'bg-green-100 text-green-700',
};

export default function SectionCard({ section, icon: Icon, onClick }) {
  const status = section.completionStatus || 'Empty';

  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-4 cursor-pointer active:bg-neutral-50 transition-colors" onClick={onClick}>
      <div className="flex items-center gap-3">
        {Icon && (
          <div className="flex-shrink-0 w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
            <Icon size={20} className="text-blue-600" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-neutral-900 text-sm">{section.title}</h3>
          <p className="text-xs text-neutral-500 line-clamp-1">{section.description}</p>
          <div className="mt-1">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[status]}`}>
              {status}
            </span>
          </div>
        </div>
        <ChevronRight size={18} className="text-neutral-300 flex-shrink-0" />
      </div>
    </div>
  );
}