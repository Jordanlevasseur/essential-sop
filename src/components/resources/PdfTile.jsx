import React from 'react';
import { FileText, Pencil, Trash2 } from 'lucide-react';

/**
 * PdfTile — compact, tappable portrait tile for a Reference PDF.
 *
 * Shows a portrait-oriented preview area with a clean PDF icon (first-page
 * rasterization is not available without a PDF rendering library, so the
 * icon fallback is used — explicitly allowed by the spec). The user-assigned
 * title sits directly underneath the preview. The whole preview area is
 * tappable and opens the full document. GM/PM see Edit and Remove controls
 * below the title as separate buttons so they never trigger the viewer.
 */
function formatSize(bytes) {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function PdfTile({ pdf, canManage, onOpen, onEdit, onDelete }) {
  return (
    <div className="flex flex-col">
      <button
        onClick={onOpen}
        className="relative w-full aspect-[3/4] bg-app-elevated border border-app-border rounded-xl flex flex-col items-center justify-center overflow-hidden no-select touch-active"
        aria-label={`Open ${pdf.title}`}
      >
        <div className="flex-1 flex items-center justify-center w-full">
          <FileText size={36} className="text-app-accent" strokeWidth={1.5} />
        </div>
        <div className="w-full px-2 py-1.5 bg-app-card border-t border-app-divider">
          <p className="text-[10px] text-app-text-muted truncate text-center uppercase tracking-wide font-medium">
            {formatSize(pdf.fileSize) || 'PDF'}
          </p>
        </div>
      </button>
      <p className="text-xs font-medium text-app-text mt-1.5 leading-snug line-clamp-2 px-0.5">{pdf.title}</p>
      {canManage && (
        <div className="flex items-center gap-2 mt-1 px-0.5 no-select">
          <button
            onClick={onEdit}
            className="text-[11px] text-app-accent font-medium flex items-center gap-1 touch-active"
          >
            <Pencil size={10} /> Edit
          </button>
          <button
            onClick={onDelete}
            className="text-[11px] text-app-danger font-medium flex items-center gap-1 touch-active"
          >
            <Trash2 size={10} /> Remove
          </button>
        </div>
      )}
    </div>
  );
}