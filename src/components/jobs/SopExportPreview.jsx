/**
 * SopExportPreview — full-screen export preview for a published SOP.
 *
 * Shows the SOP as a responsive HTML document (SopDocumentView) that fits the
 * screen width and scrolls vertically. The "Export / Share" button delivers
 * the actual PDF (save / share / print via the device share sheet, with a
 * fallback to opening the PDF). No informational note is shown at the top.
 */
import React, { useEffect } from 'react';
import { X, Share } from 'lucide-react';
import SopDocumentView from './SopDocumentView';

export default function SopExportPreview({ job, contentBySection, companyName, resources, blob, filename, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleExport = async () => {
    try {
      const file = new File([blob], filename, { type: 'application/pdf' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return;
      }
    } catch (_) { /* fall through to open */ }
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener,noreferrer');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-app-bg flex flex-col">
      <div
        className="bg-app-surface border-b border-app-border px-3 py-2.5 flex items-center gap-2.5 flex-shrink-0"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.625rem)' }}
      >
        <button onClick={onClose} className="icon-btn no-select touch-active flex-shrink-0" aria-label="Close">
          <X size={22} className="text-app-text-2" />
        </button>
        <p className="flex-1 min-w-0 text-sm font-semibold text-app-text truncate">{filename}</p>
        <button onClick={handleExport}
          className="px-3 py-2 rounded-lg bg-app-accent text-app-accent-text text-sm font-medium flex items-center gap-1.5 no-select touch-active flex-shrink-0">
          <Share size={15} /> Export / Share
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-4">
        <SopDocumentView job={job} contentBySection={contentBySection} companyName={companyName} resources={resources} />
        <div style={{ height: 'env(safe-area-inset-bottom)' }} />
      </div>
    </div>
  );
}