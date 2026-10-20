import React from 'react';
import { ExternalLink, Pencil, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { getResourceTypeConfig } from './resourceTypes';

/**
 * ResourceCard — a single company resource link with optional GM/PM controls.
 *
 * The card body is an <a> tag that opens the external URL in a new tab with
 * noopener/noreferrer for safe handling in both the web app and the native iOS
 * wrapper. GM/PM controls (Edit, Remove, Reorder) are rendered below the link
 * as separate buttons so they never trigger the external navigation.
 */
export default function ResourceCard({ resource, canManage, index, total, onEdit, onDelete, onReorder }) {
  const config = getResourceTypeConfig(resource.resourceType);
  const Icon = config.icon;

  return (
    <div className="bg-app-card border border-app-border rounded-xl overflow-hidden">
      <a
        href={resource.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block px-3 py-3 no-select touch-active"
      >
        <div className="flex items-start gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-app-info-bg flex items-center justify-center flex-shrink-0">
            <Icon size={18} className="text-app-accent" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-medium text-app-text truncate flex-1">{resource.title}</p>
              <ExternalLink size={13} className="text-app-text-muted flex-shrink-0" />
            </div>
            <p className="text-xs text-app-text-muted mt-0.5">{config.label}</p>
            {resource.description && (
              <p className="text-xs text-app-text-2 mt-1.5 leading-relaxed selectable">{resource.description}</p>
            )}
          </div>
        </div>
      </a>
      {canManage && (
        <div className="flex items-center gap-1 px-3 pt-2 pb-2.5 border-t border-app-divider no-select">
          <button
            onClick={onEdit}
            className="px-2 py-1 text-xs text-app-accent font-medium flex items-center gap-1 touch-active"
          >
            <Pencil size={11} /> Edit
          </button>
          <button
            onClick={onDelete}
            className="px-2 py-1 text-xs text-app-danger font-medium flex items-center gap-1 touch-active"
          >
            <Trash2 size={11} /> Remove
          </button>
          <div className="flex-1" />
          <button
            onClick={() => onReorder(index, -1)}
            disabled={index === 0}
            className="icon-btn text-app-text-muted disabled:opacity-25 touch-active"
            aria-label="Move up"
          >
            <ArrowUp size={13} />
          </button>
          <button
            onClick={() => onReorder(index, 1)}
            disabled={index === total - 1}
            className="icon-btn text-app-text-muted disabled:opacity-25 touch-active"
            aria-label="Move down"
          >
            <ArrowDown size={13} />
          </button>
        </div>
      )}
    </div>
  );
}