import React, { useState, useEffect, useRef } from 'react';
import { X, Loader2, Upload, FileText, AlertCircle } from 'lucide-react';

/**
 * PdfUploadDialog — Upload or Edit a Reference PDF, with an editable title.
 *
 * The File is sent directly to manageCompanyPdf via multipart (the SDK auto-
 * sends multipart when a File is in the payload). The backend performs the
 * private upload server-side — no client-supplied file_uri is ever accepted,
 * so a caller cannot attach an arbitrary private file belonging to another
 * context. The title defaults to a readable version of the filename and may
 * be edited before saving.
 *
 * In edit (replace) mode the file is optional: picking a new file replaces the
 * document; leaving it out keeps the existing file and edits only the title.
 */
const MAX_PDF_SIZE_BYTES = 25 * 1024 * 1024;

function readableTitleFromFileName(fileName) {
  const base = (fileName || '').replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim();
  return base || 'Reference PDF';
}

export default function PdfUploadDialog({ pdf, saving, error, onSave, onClose }) {
  const isReplace = !!pdf;
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState(pdf?.title || '');
  const [localError, setLocalError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (pdf) setTitle(pdf.title || '');
  }, [pdf]);

  const handlePick = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setLocalError('');
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') {
      setLocalError('Only PDF files are allowed.');
      return;
    }
    if (f.size <= 0) { setLocalError('This file is empty.'); return; }
    if (f.size > MAX_PDF_SIZE_BYTES) { setLocalError('This PDF is larger than 25 MB.'); return; }
    setFile(f);
    if (!title) setTitle(readableTitleFromFileName(f.name));
  };

  const handleSave = async () => {
    setLocalError('');
    const trimmedTitle = title.trim();
    if (!trimmedTitle) { setLocalError('Title is required.'); return; }
    if (!file && !isReplace) { setLocalError('Choose a PDF file first.'); return; }
    try {
      // Send the File (if any) + title. The backend validates and uploads.
      // For title-only edits, no file is sent (JSON request).
      await onSave(file ? { title: trimmedTitle, file } : { title: trimmedTitle });
    } catch {
      /* parent surfaces error via prop */
    }
  };

  const busy = saving;
  const displayError = localError || error;
  const sizeText = file ? `${(file.size / (1024 * 1024)).toFixed(1)} MB` : '';
  const canSubmit = isReplace || file;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => !busy && onClose()}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative bg-app-surface rounded-t-2xl overflow-y-auto"
        style={{ maxHeight: '85vh', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-app-surface border-b border-app-border px-4 py-3 flex items-center justify-between">
          <h2 className="font-semibold text-app-text">{isReplace ? 'Edit Reference PDF' : 'Add Reference PDF'}</h2>
          <button onClick={() => !busy && onClose()} aria-label="Close" disabled={busy} className="icon-btn text-app-text-muted disabled:opacity-40">
            <X size={20} />
          </button>
        </div>

        <div className="px-4 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-app-text mb-1.5">
              PDF file{isReplace ? ' (optional — leave empty to keep current file)' : ''}
            </label>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              onChange={handlePick}
              disabled={busy}
              className="hidden"
            />
            <button
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="w-full flex items-center gap-3 px-3 py-3 bg-app-input border border-app-border rounded-xl text-left disabled:opacity-50 touch-active"
            >
              <div className="w-9 h-9 rounded-lg bg-app-info-bg flex items-center justify-center flex-shrink-0">
                {file ? <FileText size={18} className="text-app-accent" /> : <Upload size={18} className="text-app-text-muted" />}
              </div>
              <div className="flex-1 min-w-0">
                {file ? (
                  <>
                    <p className="text-sm font-medium text-app-text truncate">{file.name}</p>
                    <p className="text-xs text-app-text-muted">{sizeText}</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-app-text">Choose a PDF</p>
                    <p className="text-xs text-app-text-muted">Max 25 MB</p>
                  </>
                )}
              </div>
            </button>
          </div>

          <div>
            <label className="block text-sm font-medium text-app-text mb-1.5">Title</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Document title"
              disabled={busy}
              className="w-full px-3 py-2.5 bg-app-input border border-app-border rounded-xl text-sm text-app-text placeholder:text-app-text-muted focus:outline-none focus:border-app-accent focus:ring-1 focus:ring-app-accent disabled:opacity-50"
            />
            <p className="text-xs text-app-text-muted mt-1">Shown beneath the PDF tile.</p>
          </div>

          {displayError && (
            <div className="bg-app-danger-bg border border-app-danger/30 rounded-xl px-3 py-2.5 flex items-start gap-2">
              <AlertCircle size={14} className="text-app-danger flex-shrink-0 mt-0.5" />
              <p className="text-xs text-app-danger flex-1">{displayError}</p>
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              onClick={() => !busy && onClose()}
              disabled={busy}
              className="flex-1 py-2.5 border border-app-border rounded-xl text-sm font-medium text-app-text-2 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={busy || !canSubmit}
              className="flex-1 py-2.5 bg-app-accent text-app-accent-text rounded-xl text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {busy ? <><Loader2 size={14} className="animate-spin" /> Uploading...</> : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}