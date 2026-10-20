import React, { useState, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useApp } from '@/lib/AppContext';
import { Upload, FileText, X, AlertTriangle, Loader2, ClipboardPaste, ChevronRight, ArrowLeft } from 'lucide-react';

/**
 * ImportSopDialog — Import an existing company document as a new SOP draft.
 *
 * Two input modes:
 *   - File: user selects a PDF/DOCX/TXT/MD file (max 10MB). The file is
 *     uploaded to private storage (UploadPrivateFile), then the file_uri is
 *     passed to the importCompanySop backend function for AI conversion.
 *   - Paste Text: user pastes document text directly (no file upload needed).
 *
 * If the document contains multiple separate SOPs, the backend returns the
 * detected list and the user selects which to generate.
 *
 * On success, navigates to the created draft's edit flow for review/publish.
 * The original document is preserved as a private attachment on the Job.
 */
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md', '.markdown'];

export default function ImportSopDialog({ open, onClose, onImported }) {
  const { companyId } = useApp();
  const fileInputRef = useRef(null);
  const [mode, setMode] = useState('file'); // 'file' | 'text'
  const [selectedFile, setSelectedFile] = useState(null);
  const [pastedText, setPastedText] = useState('');
  const [processing, setProcessing] = useState(false);
  const [stage, setStage] = useState(''); // 'Uploading...' | 'Generating...'
  const [error, setError] = useState(null);
  const [multipleSops, setMultipleSops] = useState(null);

  if (!open) return null;

  const reset = () => {
    setSelectedFile(null);
    setPastedText('');
    setProcessing(false);
    setStage('');
    setError(null);
    setMultipleSops(null);
    setMode('file');
  };

  const handleClose = () => {
    if (processing) return;
    reset();
    onClose();
  };

  const validateFile = (file) => {
    const ext = '.' + (file.name.split('.').pop() || '').toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return `Unsupported format. Please use: ${ALLOWED_EXTENSIONS.join(', ')}`;
    }
    if (file.size > MAX_FILE_SIZE) {
      return 'File is too large. Maximum size is 10 MB.';
    }
    return null;
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const err = validateFile(file);
    if (err) { setError(err); return; }
    setError(null);
    setSelectedFile(file);
    setMultipleSops(null);
  };

  const handleGenerate = async (sopTitle) => {
    if (processing) return;
    setProcessing(true);
    setError(null);
    setMultipleSops(null);

    let fileUri = '';
    let fileName = '';

    // Upload file if in file mode
    if (mode === 'file' && selectedFile && !sopTitle) {
      setStage('Uploading file...');
      try {
        const uploadRes = await base44.integrations.Core.UploadPrivateFile({ file: selectedFile });
        fileUri = uploadRes?.file_uri || '';
        if (!fileUri) throw new Error('Upload failed');
        fileName = selectedFile.name;
      } catch (e) {
        setError('Could not upload the file. Please try again or paste the text instead.');
        setProcessing(false);
        setStage('');
        return;
      }
    } else if (mode === 'file' && selectedFile && sopTitle) {
      // Re-using a previously uploaded file for a specific SOP — re-upload is
      // simpler than caching the file_uri across the multi-SOP selection step.
      setStage('Uploading file...');
      try {
        const uploadRes = await base44.integrations.Core.UploadPrivateFile({ file: selectedFile });
        fileUri = uploadRes?.file_uri || '';
        fileName = selectedFile.name;
      } catch (e) {
        setError('Could not upload the file. Please try again.');
        setProcessing(false);
        setStage('');
        return;
      }
    }

    // Call the backend import function
    setStage('Generating draft...');
    try {
      const payload = { action: 'generate', companyId };
      if (fileUri) { payload.file_uri = fileUri; payload.fileName = fileName; }
      if (mode === 'text' && pastedText) { payload.pastedText = pastedText; }
      if (sopTitle) { payload.sopTitle = sopTitle; }

      const res = await base44.functions.invoke('importCompanySop', payload);
      const data = res?.data;

      if (data?.noDraft && data?.multipleSops) {
        // Multiple SOPs detected — show selection
        setMultipleSops(data.multipleSops);
        setProcessing(false);
        setStage('');
        return;
      }

      const jobId = data?.jobId;
      if (!jobId) {
        throw new Error(data?.error || 'Import completed but no draft was created.');
      }

      // Success — navigate to the draft
      reset();
      onImported(jobId);
    } catch (e) {
      const data = e?.response?.data || e?.data || {};
      const code = data.code;
      if (code === 'AI_ERROR') {
        setError('The AI service could not process the document. Please try again, or paste the text directly.');
      } else if (code === 'AI_OUTPUT_INVALID') {
        setError('The document could not be converted to a valid SOP. ' + (data.details?.join(' ') || 'Please try pasting the text instead.'));
      } else if (code === 'FILE_ACCESS_FAILED') {
        setError('Could not access the uploaded file. Please try again or paste the text directly.');
      } else if (e?.response?.status === 403) {
        setError('You do not have permission to import SOPs.');
      } else {
        setError(data.error || e?.message || 'Import failed. Please try again.');
      }
      setProcessing(false);
      setStage('');
    }
  };

  const canGenerate = mode === 'file' ? !!selectedFile : pastedText.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" onClick={handleClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative bg-app-surface rounded-t-2xl sm:rounded-2xl border border-app-border w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        {/* Header */}
        <div className="sticky top-0 bg-app-surface border-b border-app-border px-4 py-3 flex items-center justify-between z-10">
          <h3 className="font-semibold text-app-text flex items-center gap-1.5">
            {multipleSops ? (
              <>
                <button onClick={() => { setMultipleSops(null); setError(null); }} className="icon-btn -ml-2 text-app-text-muted">
                  <ArrowLeft size={18} />
                </button>
                Select SOP
              </>
            ) : (
              <><Upload size={16} className="text-app-accent" /> Import Existing SOP</>
            )}
          </h3>
          {!processing && (
            <button onClick={handleClose} aria-label="Close" className="icon-btn text-app-text-muted">
              <X size={18} />
            </button>
          )}
        </div>

        <div className="p-4">
          {/* Multiple SOPs selection */}
          {multipleSops ? (
            <div className="space-y-3">
              <div className="bg-app-info-bg border border-app-info/30 rounded-lg p-3">
                <p className="text-xs text-app-info leading-relaxed">
                  Multiple separate SOPs were detected in this document. Select one to generate a draft. You can import the others separately.
                </p>
              </div>
              {multipleSops.map((sop, i) => (
                <button
                  key={i}
                  onClick={() => handleGenerate(sop.title)}
                  disabled={processing}
                  className="w-full text-left bg-app-card border border-app-border rounded-xl p-3.5 no-select touch-active disabled:opacity-50"
                >
                  <p className="text-sm font-medium text-app-text">{sop.title}</p>
                  {sop.summary && <p className="text-xs text-app-text-muted mt-1 leading-relaxed">{sop.summary}</p>}
                  <div className="flex items-center gap-1 mt-2 text-xs text-app-accent font-medium">
                    Generate <ChevronRight size={12} />
                  </div>
                </button>
              ))}
            </div>
          ) : processing ? (
            /* Processing state */
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 size={28} className="animate-spin text-app-accent mb-3" />
              <p className="text-sm font-medium text-app-text">{stage || 'Processing...'}</p>
              <p className="text-xs text-app-text-muted mt-1">This may take a moment for large documents.</p>
            </div>
          ) : (
            /* Input mode */
            <div className="space-y-4">
              {/* Mode toggle */}
              <div className="flex gap-2">
                <button
                  onClick={() => { setMode('file'); setError(null); }}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 no-select touch-active ${
                    mode === 'file' ? 'bg-app-accent text-app-accent-text' : 'bg-app-elevated text-app-text-2'
                  }`}
                >
                  <FileText size={14} /> File
                </button>
                <button
                  onClick={() => { setMode('text'); setError(null); }}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 no-select touch-active ${
                    mode === 'text' ? 'bg-app-accent text-app-accent-text' : 'bg-app-elevated text-app-text-2'
                  }`}
                >
                  <ClipboardPaste size={14} /> Paste Text
                </button>
              </div>

              {mode === 'file' ? (
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.docx,.txt,.md,.markdown"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full border-2 border-dashed border-app-border rounded-xl py-8 flex flex-col items-center gap-2 no-select touch-active"
                  >
                    <Upload size={24} className="text-app-text-muted" />
                    <span className="text-sm text-app-text-2">
                      {selectedFile ? selectedFile.name : 'Tap to select a file'}
                    </span>
                    {!selectedFile && (
                      <span className="text-xs text-app-text-muted">PDF, DOCX, TXT, or Markdown · Max 10 MB</span>
                    )}
                  </button>
                  {selectedFile && (
                    <button
                      onClick={() => setSelectedFile(null)}
                      className="mt-2 text-xs text-app-text-muted underline"
                    >
                      Remove file
                    </button>
                  )}
                </div>
              ) : (
                <div>
                  <textarea
                    value={pastedText}
                    onChange={e => setPastedText(e.target.value.slice(0, 50000))}
                    rows={6}
                    autoFocus
                    placeholder="Paste the document text here..."
                    className="w-full px-3 py-2.5 bg-app-input border border-app-border rounded-lg text-sm text-app-text placeholder:text-app-text-muted focus:outline-none focus:border-app-accent focus:ring-1 focus:ring-app-accent resize-y"
                  />
                  <div className="text-right mt-1">
                    <span className="text-xs text-app-text-muted">{pastedText.length} / 50,000 characters</span>
                  </div>
                </div>
              )}

              {error && (
                <div className="p-3 bg-app-danger-bg border border-app-danger/30 rounded-lg flex items-start gap-2">
                  <AlertTriangle size={16} className="text-app-danger flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-app-text-2">{error}</p>
                </div>
              )}

              <button
                onClick={() => handleGenerate()}
                disabled={!canGenerate}
                className="w-full py-3 bg-app-accent text-app-accent-text rounded-lg text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:bg-app-disabled disabled:text-app-text-disabled"
              >
                <Upload size={16} /> Generate Draft
              </button>
              <p className="text-xs text-app-text-muted text-center">
                A draft is created — you review and edit every section before publishing. The original document is saved privately for comparison.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}