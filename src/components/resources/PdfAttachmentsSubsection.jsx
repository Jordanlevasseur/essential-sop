import React, { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { Plus, Loader2, AlertCircle, Trash2 } from 'lucide-react';
import PdfTile from './PdfTile';
import PdfUploadDialog from './PdfUploadDialog';
import PdfViewer from './PdfViewer';

/**
 * PdfAttachmentsSubsection — the "Reference PDFs" subsection rendered
 * directly beneath the external-link resources.
 *
 * Loads PDF metadata through resolveCompanyPdfs (authorized backend path).
 * GM/PM (canManage) see Add, Edit (title), Replace (file), and Remove
 * controls. Project Leads and Technicians see a read-only grid and may
 * open PDFs. All mutations go through manageCompanyPdf, which re-verifies
 * role + ownership server-side. Opening a PDF fetches a short-lived signed
 * URL via resolveCompanyPdfFile — the private fileUri never reaches the
 * client.
 *
 * A Reference PDF is a supporting attachment only. It is never imported as
 * a new SOP, does not change the parent SOP's instructions, and does not
 * trigger AI processing. Assistant 2.0 is unchanged.
 */
export default function PdfAttachmentsSubsection({ jobId, canManage }) {
  const [pdfs, setPdfs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingPdf, setEditingPdf] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [viewingPdf, setViewingPdf] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await base44.functions.invoke('resolveCompanyPdfs', { jobId });
      setPdfs(res.data?.pdfs || []);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load PDFs');
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (formData) => {
    setSaving(true);
    setFormError('');
    try {
      // The File (if present) is sent via multipart by the SDK. The backend
      // validates and uploads it server-side — no client-supplied file_uri.
      let res;
      if (editingPdf) {
        // New file → replace; no file → title-only update.
        const action = formData.file ? 'replace' : 'update';
        res = await base44.functions.invoke('manageCompanyPdf', {
          action, jobId, pdfId: editingPdf.id,
          title: formData.title,
          ...(formData.file ? { file: formData.file } : {}),
        });
      } else {
        res = await base44.functions.invoke('manageCompanyPdf', {
          action: 'create', jobId,
          title: formData.title,
          file: formData.file,
        });
      }
      if (!res.data?.pdf) throw new Error(res.data?.error || 'Save failed');
      if (editingPdf) {
        setPdfs(prev => prev.map(p => p.id === editingPdf.id ? res.data.pdf : p));
      } else {
        setPdfs(prev => [...prev, res.data.pdf]);
      }
      setShowForm(false);
      setEditingPdf(null);
    } catch (err) {
      setFormError(err.response?.data?.error || err.message || 'Failed to save PDF');
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    setSaving(true);
    try {
      await base44.functions.invoke('manageCompanyPdf', {
        action: 'delete', jobId, pdfId: deletingId,
      });
      setPdfs(prev => prev.filter(p => p.id !== deletingId));
      setDeletingId(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to remove PDF');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-5">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-semibold text-app-text-muted uppercase tracking-wide">Reference PDFs</h4>
        {canManage && !loading && !error && (
          <button
            onClick={() => { setEditingPdf(null); setShowForm(true); }}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-app-accent text-app-accent-text rounded-lg text-xs font-medium no-select touch-active"
          >
            <Plus size={14} /> Add
          </button>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-6">
          <Loader2 size={18} className="animate-spin text-app-text-muted" />
        </div>
      )}

      {error && (
        <div className="bg-app-danger-bg border border-app-danger/30 rounded-xl px-3 py-2.5 flex items-start gap-2">
          <AlertCircle size={14} className="text-app-danger flex-shrink-0 mt-0.5" />
          <p className="text-xs text-app-danger flex-1">{error}</p>
          <button onClick={load} className="text-xs text-app-danger font-medium underline">Retry</button>
        </div>
      )}

      {!loading && !error && pdfs.length === 0 && (
        <div className="bg-app-card border border-app-border rounded-xl px-4 py-5 text-center">
          <p className="text-xs text-app-text-muted">
            {canManage ? 'No reference PDFs yet. Tap Add to upload one.' : 'No reference PDFs for this procedure.'}
          </p>
        </div>
      )}

      {!loading && !error && pdfs.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {pdfs.map((pdf) => (
            <PdfTile
              key={pdf.id}
              pdf={pdf}
              canManage={canManage}
              onOpen={() => setViewingPdf(pdf)}
              onEdit={() => { setEditingPdf(pdf); setShowForm(true); }}
              onDelete={() => setDeletingId(pdf.id)}
            />
          ))}
        </div>
      )}

      {showForm && (
        <PdfUploadDialog
          jobId={jobId}
          pdf={editingPdf}
          saving={saving}
          error={formError}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditingPdf(null); setFormError(''); }}
        />
      )}

      {viewingPdf && (
        <PdfViewer jobId={jobId} pdf={viewingPdf} onClose={() => setViewingPdf(null)} />
      )}

      {deletingId && (
        <DeletePdfDialog
          deleting={saving}
          onCancel={() => setDeletingId(null)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}

function DeletePdfDialog({ deleting, onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4" onClick={() => !deleting && onCancel()}>
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative bg-app-surface border border-app-border rounded-2xl p-5 w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
        <h3 className="font-bold text-app-text mb-2">Remove this PDF?</h3>
        <p className="text-sm text-app-text-2 mb-4">This removes the attachment from this procedure. The parent SOP is not affected.</p>
        <div className="flex gap-3">
          <button onClick={onCancel} disabled={deleting}
            className="flex-1 py-2.5 border border-app-border rounded-xl text-sm font-medium text-app-text-2 disabled:opacity-50">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={deleting}
            className="flex-1 py-2.5 bg-app-danger text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
            {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Remove
          </button>
        </div>
      </div>
    </div>
  );
}