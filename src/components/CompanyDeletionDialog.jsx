import React, { useState } from 'react';
import { AlertTriangle, X, Building2 } from 'lucide-react';

/**
 * CompanyDeletionDialog — GM-only confirmation for requesting company deletion.
 *
 * Customer-facing. Requires the GM to type the EXACT company name to enable
 * submit. On submit it calls onSubmit(confirmName) (the parent invokes
 * requestCompanyClosure). The company and all its data remain intact; the
 * request simply enters the Platform Administration queue.
 *
 * No references to Base44, backend functions, or internal tooling.
 */
export default function CompanyDeletionDialog({ companyName, onSubmit, onClose }) {
  const [confirmText, setConfirmText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const trimmed = (confirmText || '').trim();
  const matches = companyName && trimmed.toLowerCase() === companyName.trim().toLowerCase();

  const handleSubmit = async () => {
    if (!matches || loading) return;
    setError(''); setLoading(true);
    try {
      const data = await onSubmit(trimmed);
      if (data?.error) {
        setError(data.error);
        setLoading(false);
        return;
      }
      if (!data?.success) {
        setError(data?.error || 'Failed to submit request.');
        setLoading(false);
        return;
      }
      setDone(true);
    } catch (e) {
      setError(e?.message || 'Failed to submit request.');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-4" onClick={done ? undefined : onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Request Company Deletion"
        className="relative bg-app-surface rounded-2xl w-full max-w-md border border-app-border shadow-xl overflow-y-auto"
        style={{ maxHeight: 'calc(95dvh - env(safe-area-inset-top))' }}
        onClick={e => e.stopPropagation()}
      >
        {!done && (
          <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-app-divider">
            <div className="flex items-center gap-2">
              <Building2 size={18} className="text-app-danger" />
              <h2 className="font-bold text-app-text">Request Company Deletion</h2>
            </div>
            <button onClick={onClose} className="icon-btn text-app-text-muted no-select" aria-label="Close">
              <X size={20} />
            </button>
          </div>
        )}

        {!done ? (
          <div className="p-5">
            <div className="bg-app-danger-bg border border-app-danger rounded-lg p-3 mb-4">
              <div className="flex items-start gap-2.5">
                <AlertTriangle size={18} className="text-app-danger flex-shrink-0 mt-0.5" />
                <p className="text-sm text-app-text leading-relaxed">
                  This will request the permanent deletion of your entire company workspace, including its SOP
                  library, resources, and associated company data. This affects everyone in the company and
                  cannot be undone once completed.
                </p>
              </div>
            </div>
            <p className="text-sm text-app-text-2 mb-4 leading-relaxed">
              Your request will be reviewed by Essential SOP administration. The workspace and all its data stay
              unchanged until it is approved and processed. You will receive confirmation when it has been processed.
            </p>
            <p className="text-sm text-app-text-2 mb-2">
              To confirm, type the company name <span className="font-bold text-app-danger">{companyName}</span> below.
            </p>
            <input
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              placeholder={companyName}
              className="w-full px-4 py-3 bg-app-input border border-app-border rounded-xl text-sm text-app-text placeholder:text-app-text-disabled focus:outline-none focus:border-app-danger focus:ring-1 focus:ring-app-danger mb-2"
            />
            {error && (
              <div className="flex items-start gap-2 bg-app-danger-bg border border-app-danger rounded-lg px-3 py-2 mb-3">
                <AlertTriangle size={14} className="text-app-danger flex-shrink-0 mt-0.5" />
                <p className="text-xs text-app-danger">{error}</p>
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={onClose} disabled={loading}
                className="flex-1 py-2.5 border border-app-border rounded-xl text-sm font-medium text-app-text-2 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={handleSubmit} disabled={!matches || loading}
                className="flex-1 py-2.5 bg-app-danger text-white rounded-xl text-sm font-semibold disabled:opacity-40 flex items-center justify-center gap-2">
                {loading ? (
                  <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Submitting…</>
                ) : (
                  <><Building2 size={14} /> Submit Request</>
                )}
              </button>
            </div>
          </div>
        ) : (
          <div className="p-6 text-center">
            <div className="w-14 h-14 bg-app-success-bg rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">✓</span>
            </div>
            <h3 className="font-bold text-app-text text-lg mb-3">Request Submitted</h3>
            <p className="text-sm text-app-text-2 leading-relaxed mb-4">
              Your company deletion request has been submitted and is pending Essential SOP administration review.
              The workspace and all its data remain unchanged until approved and processed. You will be notified
              when it has been processed.
            </p>
            <button onClick={onClose} className="w-full py-2.5 bg-app-elevated border border-app-border rounded-xl text-sm font-medium text-app-text">
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}