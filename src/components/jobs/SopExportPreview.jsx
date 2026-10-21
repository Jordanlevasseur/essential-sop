/**
 * SopExportPreview — full-screen export preview for a published SOP.
 *
 * Renders the ACTUAL generated PDF (jsPDF Blob) into responsive canvases via
 * PDF.js — not an HTML recreation. Toolbar: Close | "PDF Preview" | Export / Share.
 * Respects iPhone safe areas; no top informational note. The Export / Share
 * button delivers the real PDF via the native share sheet (save/share/print)
 * with an open-PDF fallback.
 */
import React, { useEffect } from 'react';
import { X, Share } from 'lucide-react';
import PdfCanvasViewer from './PdfCanvasViewer';

export default function SopExportPreview({ blob, filename, onClose }) {
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
        <p className="flex-1 min-w-0 text-sm font-semibold text-app-text truncate">PDF Preview</p>
        <button onClick={handleExport}
          className="px-3 py-2 rounded-lg bg-app-accent text-app-accent-text text-sm font-medium flex items-center gap-1.5 no-select touch-active flex-shrink-0">
          <Share size={15} /> Export / Share
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-4">
        <PdfCanvasViewer blob={blob} />
        <div style={{ height: 'env(safe-area-inset-bottom)' }} />
      </div>
    </div>
  );
}