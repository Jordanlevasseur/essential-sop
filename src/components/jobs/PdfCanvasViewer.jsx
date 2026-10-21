/**
 * PdfCanvasViewer — renders the ACTUAL generated PDF (the jsPDF Blob bytes)
 * into responsive <canvas> pages using PDF.js (pdfjs-dist).
 *
 * Each page is scaled to fit the available container width while preserving the
 * true US Letter proportions. The canvas backing store is multiplied by the
 * device pixel ratio so text stays legible on high-DPI mobile screens.
 *
 * The bytes come from the real generated PDF (buildSopPdf output) — this is
 * never an HTML reconstruction.
 */
import React, { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Loader2, AlertTriangle } from 'lucide-react';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

function PdfPage({ pdf, pageNum, targetWidth }) {
  const canvasRef = useRef(null);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    let cancelled = false;
    let renderTask = null;
    (async () => {
      try {
        const page = await pdf.getPage(pageNum);
        if (cancelled || !targetWidth) return;
        const base = page.getViewport({ scale: 1 });
        const scale = targetWidth / base.width;
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.round(viewport.width)}px`;
        canvas.style.height = `${Math.round(viewport.height)}px`;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        renderTask = page.render({ canvasContext: ctx, viewport });
        await renderTask.promise;
        if (!cancelled) setStatus('done');
      } catch (e) {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => { cancelled = true; if (renderTask) renderTask.cancel(); };
  }, [pdf, pageNum, targetWidth]);

  return (
    <div className="relative w-full flex justify-center">
      <canvas ref={canvasRef} className="block bg-white shadow-sm rounded-sm" />
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 size={18} className="animate-spin text-app-text-muted" />
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center text-app-danger">
          <AlertTriangle size={16} />
        </div>
      )}
    </div>
  );
}

export default function PdfCanvasViewer({ blob }) {
  const containerRef = useRef(null);
  const [width, setWidth] = useState(0);
  const [pdf, setPdf] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [error, setError] = useState('');

  // Track the available container width (responsive).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (w) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Load the actual PDF bytes once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError('');
      try {
        const buf = await blob.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data: buf });
        const doc = await loadingTask.promise;
        if (cancelled) return;
        setPdf(doc);
        setNumPages(doc.numPages);
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Failed to render the PDF.');
      }
    })();
    return () => { cancelled = true; };
  }, [blob]);

  if (error) {
    return (
      <div className="px-4 py-8 text-center text-sm text-app-danger">
        <AlertTriangle size={18} className="mx-auto mb-2" />
        Could not display the PDF preview. You can still use Export / Share to save the document.
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full">
      {!pdf && (
        <div className="flex justify-center py-10">
          <Loader2 size={22} className="animate-spin text-app-accent" />
        </div>
      )}
      {pdf && width > 0 && (
        <div className="space-y-3">
          {Array.from({ length: numPages }, (_, i) => (
            <PdfPage key={i + 1} pdf={pdf} pageNum={i + 1} targetWidth={width} />
          ))}
        </div>
      )}
    </div>
  );
}