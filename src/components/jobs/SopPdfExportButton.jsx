/**
 * SopPdfExportButton — "Export SOP" action for a published company SOP.
 *
 * On tap it re-fetches the authoritative, current published SOP through the
 * existing authorized path (resolveJob) and its resources (resolveCompanyResources),
 * then generates a client-side PDF (jsPDF) and opens a responsive preview.
 * Nothing is uploaded or written to the company database. Available to every
 * authorized company member who can read the SOP, including Technicians;
 * resolveJob enforces company isolation and the published/Master-assignment
 * gates server-side.
 */
import React, { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import { buildSopPdf } from '@/lib/sopPdfExporter';
import SopExportPreview from './SopExportPreview';

export default function SopPdfExportButton({ jobId, companyName }) {
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState(null);
  const { toast } = useToast();

  const handleExport = async () => {
    setGenerating(true);
    try {
      const [jobRes, resRes] = await Promise.all([
        base44.functions.invoke('resolveJob', { jobId }),
        base44.functions.invoke('resolveCompanyResources', { jobId }),
      ]);
      const job = jobRes?.data?.job;
      if (!job) throw new Error(jobRes?.data?.error || 'Unable to load the SOP.');
      if (job.status !== 'Published') {
        throw new Error('Only published SOPs can be exported.');
      }
      const contentBySection = jobRes.data.contentBySection || {};
      const resources = resRes?.data?.resources || [];
      const { blob, filename } = buildSopPdf({ job, contentBySection, companyName, resources });
      setPreview({ job, contentBySection, companyName, resources, blob, filename });
      toast({ title: 'Export ready', description: 'Preview is ready to save or share.' });
    } catch (e) {
      toast({ title: 'Export failed', description: e?.message || 'Failed to generate PDF.', variant: 'destructive' });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <>
      <button
        onClick={handleExport}
        disabled={generating}
        className="px-3 py-2.5 rounded-lg text-sm font-medium flex items-center gap-1.5 no-select touch-active border border-app-border text-app-text-2 bg-app-elevated disabled:opacity-50"
        aria-label="Export SOP"
      >
        {generating ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
        {generating ? 'Export...' : 'Export SOP'}
      </button>
      {preview && (
        <SopExportPreview
          job={preview.job}
          contentBySection={preview.contentBySection}
          companyName={preview.companyName}
          resources={preview.resources}
          blob={preview.blob}
          filename={preview.filename}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
}