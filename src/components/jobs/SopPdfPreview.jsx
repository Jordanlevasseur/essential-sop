/**
 * SopPdfPreview — full-screen PDF preview with native Share/Save support.
 *
 * Renders the generated PDF blob in an <iframe> (iOS WKWebView renders PDFs
 * with its built-in viewer, which includes a share affordance). The Share
 * button uses the Web Share API with a File when available (opens the iOS
 * share sheet: Save to Files, Print, AirDrop, Mail...), falling back to
 * opening the blob URL in a new tab. The caller owns the object URL lifecycle.
 */
import React, { useEffect } from 'react';
import { X, Share } from 'lucide-react';

export default function SopPdfPreview({ url, blob, filename, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleShare = async () => {
    try {
      const file = new File([blob], filename, { type: 'application/pdf' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return;
      }
    } catch (_) { /* fall through to open */ }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="fixed inset-0 z-50 bg-app-bg flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="bg-app-surface border-b border-app-border px-3 py-2.5 flex items-center gap-2.5 flex-shrink-0">
        <button onClick={onClose} className="icon-btn no-select touch-active" aria-label="Close">
          <X size={22} className="text-app-text-2" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-app-text truncate">{filename}</p>
          <p className="text-xs text-app-text-muted">PDF preview - tap Share to save or print</p>
        </div>
        <button onClick={handleShare}
          className="px-3 py-2 rounded-lg bg-app-accent text-app-accent-text text-sm font-medium flex items-center gap-1.5 no-select touch-active flex-shrink-0">
          <Share size={15} /> Share
        </button>
      </div>
      <div className="flex-1 min-h-0 bg-white">
        <iframe src={url} title="SOP PDF preview" className="w-full h-full border-0" />
      </div>
      <div style={{ height: 'env(safe-area-inset-bottom)' }} />
    </div>
  );
}