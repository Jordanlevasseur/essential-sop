import React from 'react';
import { getResourceTypeConfig } from '@/components/resources/resourceTypes';

/**
 * AssistantResourceCard — a visually distinct card for authorized Company
 * Resource links returned by the Assistant. Rendered separately from SOP
 * source cards (which use bg-app-elevated) so employees can distinguish an
 * external reference link from an internal procedure citation.
 *
 * The entire card is an <a> tag that opens the external HTTPS URL in a new
 * tab with noopener/noreferrer — the same safe-external-link convention used
 * by the existing ResourceCard component for the web app and native iOS
 * wrapper. No external content is fetched by the app.
 */
export default function AssistantResourceCard({ resource }) {
  const config = getResourceTypeConfig(resource.resourceType);
  const Icon = config.icon;

  return (
    <a
      href={resource.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block p-2.5 bg-app-info-bg rounded-lg border border-app-border no-select touch-active"
    >
      <div className="flex items-start gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-app-card flex items-center justify-center flex-shrink-0">
          <Icon size={16} className="text-app-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-app-text truncate">{resource.title}</p>
          <p className="text-xs text-app-text-muted mt-0.5">{config.label} · {resource.parentJobTitle}</p>
          {resource.description && (
            <p className="text-xs text-app-text-2 mt-1 leading-relaxed line-clamp-2">{resource.description}</p>
          )}
        </div>
      </div>
    </a>
  );
}