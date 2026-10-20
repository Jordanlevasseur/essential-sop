import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { X, Loader2, ExternalLink, AlertCircle } from 'lucide-react';

/**
 * PdfViewer — full-screen PDF viewer with a Close/Back action.
 *
 * Fetches a short-lived signed URL via resolveCompanyPdfFile (authorized,
 * 5-minute expiry) when opened, then renders the PDF in an <iframe>. The
 * iframe lets the browser's native PDF viewer handle scrolling and zooming.
 * A top bar carries a Close button and an "Open in new tab" fallback for
 * environments (e.g. some iOS WKWebView shells) where an embedded PDF does
 * not render reliably. The private fileUri never reaches the client.
 */
export default function PdfViewer({ jobId, pdf, onClose }) {
  const [signedUrl, setSignedUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await base44.functions.invoke('resolveCompanyPdfFile', { jobId, pdfId: pdf.id });
        if (cancelled) return;
        if (!res.data?.signed_url) throw new Error(res.data?.error || 'Could not open this PDF.');
        setSignedUrl(res.data.signed_url);
      } catch (err) {
        if (cancelled) return;
        setError(err.response?.data?.error || err.message || 'Could not open this PDF.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [jobId, pdf.id]);

  return (
    <div className="fixed inset-0 z-[60] bg-app-bg flex flex-col">
      {/* Top bar */}
      <div
        className="flex items-center justify-between px-3 py-2.5 bg-app-surface border-b border-app-border flex-shrink-0 safe-top"
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-app-text truncate">{pdf.title}</p>
          <p className="text-xs text-app-text-muted truncate">{pdf.fileName}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {signedUrl && (
            <a
              href={signedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-2 bg-app-elevated text-app-text rounded-lg text-xs font-medium touch-active"
            >
              <ExternalLink size={13} /> Open in new tab
            </a>
          )}
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex items-center gap-1.5 px-3 py-2 bg-app-accent text-app-accent-text rounded-lg text-xs font-semibold touch-active"
          >
            <X size={15} /> Close
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 relative overflow-hidden">
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <Loader2 size={24} className="animate-spin text-app-accent" />
            <p className="text-sm text-app-text-muted">Opening document...</p>
          </div>
        )}
        {error && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <AlertCircle size={28} className="text-app-danger" />
            <p className="text-sm text-app-text max-w-xs">{error}</p>
            <button onClick={onClose} className="px-4 py-2 bg-app-accent text-app-accent-text rounded-lg text-sm font-medium">
              Go back
            </button>
          </div>
        )}
        {signedUrl && !loading && (
          <iframe
            src={signedUrl}
            title={pdf.title}
            className="w-full h-full border-0 bg-white"
            allow="fullscreen"
          />
        )}
      </div>
    </div>
  );
}