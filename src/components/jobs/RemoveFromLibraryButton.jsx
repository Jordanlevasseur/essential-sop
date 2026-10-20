import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Trash2, Loader2 } from 'lucide-react';
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel,
} from '@/components/ui/alert-dialog';

/**
 * RemoveFromLibraryButton — company-side removal of an adopted provisioned SOP.
 *
 * GM/PM only by construction: it is rendered exclusively where
 * capabilities.canCustomize is true (resolveJob sets canCustomize =
 * isCompanyAdmin && isProvisionedSOP). The backend (removeFromCompanyLibrary)
 * independently re-verifies GM/PM membership of the Job's company.
 *
 * Archives the linked Job (isArchived=true, status='Draft') without deleting the
 * Master, platform assignment, overrides, or history. A real confirmation dialog
 * with Cancel + Remove guards the action.
 */
export default function RemoveFromLibraryButton({ job, onRemoved }) {
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState('');

  const handleRemove = async () => {
    setRemoving(true);
    setError('');
    try {
      const res = await base44.functions.invoke('removeFromCompanyLibrary', { jobId: job.id });
      const d = res?.data || {};
      if (!d.success) {
        setError(d.error || 'Failed to remove.');
        setRemoving(false);
        return;
      }
      setOpen(false);
      onRemoved?.();
    } catch (e) {
      setError(e?.message || 'Failed to remove.');
      setRemoving(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setError(''); setRemoving(false); } }}>
      <AlertDialogTrigger asChild>
        <button
          className="icon-btn text-app-danger touch-active no-select"
          aria-label="Remove from Company Library"
          title="Remove from Company Library"
        >
          <Trash2 size={18} />
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove from Company Library?</AlertDialogTitle>
          <AlertDialogDescription>
            &ldquo;{job.title}&rdquo; will be removed from your company&rsquo;s active library. This affects only your company&rsquo;s active use — the original Master SOP, the platform assignment, your customizations, and version history are all preserved. You can add it back later from the Master Library.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p className="text-sm text-app-danger -mt-2">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
          <button
            onClick={handleRemove}
            disabled={removing}
            className="inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-lg bg-app-danger text-white text-sm font-medium disabled:opacity-60 touch-active no-select"
          >
            {removing ? <><Loader2 size={14} className="animate-spin" /> Removing…</> : 'Remove'}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}