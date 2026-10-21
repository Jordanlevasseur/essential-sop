/**
 * SopDocumentView — responsive HTML rendering of a published company SOP that
 * mirrors the exported PDF (navy header band, branding, section order, item
 * markers, references). Used as the on-screen preview so the page always fits
 * the available width, preserves aspect, and scrolls vertically on iOS.
 *
 * The actual paginated PDF (with page numbers) is produced separately by
 * sopPdfExporter for save/share/print; this view is the in-app preview only.
 */
import React from 'react';
import { getResourceTypeConfig } from '@/components/resources/resourceTypes';

const DISPLAY_ORDER = ['scope', 'tools', 'materials', 'procedure', 'safety', 'quality'];

const SECTION_TITLES = {
  scope: 'Scope of Work',
  tools: 'Tools',
  materials: 'Materials',
  procedure: 'Procedure',
  safety: 'Safety',
  quality: 'Quality Standards',
};

function itemMarker(item, idx) {
  switch (item.contentType) {
    case 'numberedStep': return `${idx + 1}.`;
    case 'tool':
    case 'material':
    case 'qualityCheck': return '\u2022';
    case 'checklist': return '[ ]';
    default: return null;
  }
}

export default function SopDocumentView({ job, contentBySection = {}, companyName, resources = [] }) {
  const meta = [
    job.trade && `Trade: ${job.trade}`,
    job.category && `Category: ${job.category}`,
    job.skillLevel && `Skill Level: ${job.skillLevel}`,
    job.estimatedDuration && `Est. Duration: ${job.estimatedDuration}`,
  ].filter(Boolean);

  return (
    <div className="w-full max-w-[460px] mx-auto bg-app-card rounded-xl shadow-sm overflow-hidden">
      {/* Title header band */}
      <div className="bg-app-heading text-white px-5 pt-4 pb-3 relative">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-bold text-sm tracking-wide">ESSENTIAL SOP</p>
            <p className="text-[11px] text-white/70 mt-0.5">Standard Operating Procedure</p>
          </div>
          {companyName && (
            <p className="text-[11px] font-semibold text-right break-words min-w-0">{companyName}</p>
          )}
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-app-accent" />
      </div>

      <div className="px-5 py-4">
        {companyName && (
          <p className="text-[11px] text-app-text-muted mb-1">Workspace: {companyName}</p>
        )}
        <h1 className="text-app-heading font-bold text-lg leading-snug">{job.title || 'Untitled SOP'}</h1>

        {job.shortDescription && (
          <p className="text-sm text-app-text-2 mt-1.5">{job.shortDescription}</p>
        )}

        {meta.length > 0 && (
          <p className="text-[11px] text-app-text-muted mt-2">{meta.join('    ')}</p>
        )}
        {Array.isArray(job.tags) && job.tags.length > 0 && (
          <p className="text-[11px] text-app-text-muted mt-1">Tags: {job.tags.join(', ')}</p>
        )}

        <div className="h-px bg-app-divider mt-3" />

        {DISPLAY_ORDER.map((st) => {
          const items = contentBySection[st] || [];
          if (!items.length) return null;
          return (
            <section key={st} className="mt-4">
              <div className="flex items-center gap-2">
                <h2 className="text-app-heading font-bold text-[13px]">{SECTION_TITLES[st] || st}</h2>
                <div className="flex-1 h-px bg-app-divider" />
              </div>
              <div className="mt-2 space-y-2">
                {items.map((item, idx) => (
                  <ItemView key={item.id || idx} item={item} idx={idx} />
                ))}
              </div>
            </section>
          );
        })}

        {resources.length > 0 && (
          <section className="mt-4">
            <div className="flex items-center gap-2">
              <h2 className="text-app-heading font-bold text-[13px]">References</h2>
              <div className="flex-1 h-px bg-app-divider" />
            </div>
            <div className="mt-2 space-y-2">
              {resources.map((r) => {
                const typeLabel = getResourceTypeConfig(r.resourceType)?.label || r.resourceType || 'Resource';
                return (
                  <div key={r.id} className="text-sm">
                    <p className="font-semibold text-app-text"><span className="text-app-text-2">{'\u2022'}  </span>{r.title || 'Reference'}</p>
                    <p className="text-[11px] text-app-text-muted">{[typeLabel, r.url].filter(Boolean).join(' - ')}</p>
                    {r.description && <p className="text-[11px] text-app-text-muted">{r.description}</p>}
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function ItemView({ item, idx }) {
  if (item.contentType === 'warning') {
    return (
      <div className="text-sm">
        <p className="font-bold text-app-warning">Warning{item.title ? ': ' + item.title : ''}</p>
        {item.body && <p className="text-app-text-2 mt-0.5">{item.body}</p>}
      </div>
    );
  }
  const marker = itemMarker(item, idx);
  const isReq = item.isRequired && (item.contentType === 'tool' || item.contentType === 'material' || item.contentType === 'checklist');
  return (
    <div className="text-sm">
      <p className="font-semibold text-app-text">
        {marker && <span className="text-app-text-2 mr-1.5">{marker}</span>}
        {item.title}
        {isReq && <span className="font-normal text-app-text-muted ml-1">(Required)</span>}
      </p>
      {item.body && <p className="text-app-text-2 mt-0.5">{item.body}</p>}
    </div>
  );
}