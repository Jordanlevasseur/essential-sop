import React, { useState } from 'react';
import { AlertTriangle, X, Trash2, ShieldAlert } from 'lucide-react';
import { base44 } from '@/api/base44Client';

const CONFIRM_WORD = 'DELETE';

export default function DeleteAccountModal({ onClose }) {
  const [step, setStep] = useState(1); // 1=info, 2=confirm, 3=done
  const [confirmText, setConfirmText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleContinueToConfirm = () => {
    setError('');
    setStep(2);
  };

  // ONE consistent confirmation flow for ALL users (password AND Google-only):
  // a currently authenticated session (base44.auth.me() is required inside
  // deleteAccount → 401 if unauthenticated) PLUS the deliberate typed DELETE
  // word. There is NO password reentry and NO self-selected auth-provider
  // button — a user's chosen provider label cannot reliably prove their
  // actual login method, and offering one would let a password user bypass
  // reauthentication by claiming "Google". This avoids the bypass, does not
  // strand Google-only users (no password is required), and guarantees
  // initiation requires a currently authenticated session.
  const handleDelete = async () => {
    setError('');
    setLoading(true);
    try {
      const resp = await base44.functions.invoke('deleteAccount', {});

      if (resp.data?.error === 'sole_admin' || resp.data?.error === 'already_pending') {
        setError(resp.data.message);
        setLoading(false);
        return;
      }

      if (!resp.data?.success) {
        throw new Error(resp.data?.error || 'Deletion failed.');
      }

      // Clear all personal localStorage data
      localStorage.clear();

      setStep(3);

      // Sign out after brief success display
      setTimeout(() => {
        base44.auth.logout('/');
      }, 2500);

    } catch (err) {
      setError(err.message || 'An unexpected error occurred. Your account has not been deleted.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-4" onClick={step < 3 ? onClose : undefined}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Delete Account"
        className="relative bg-app-surface rounded-2xl w-full max-w-md border border-app-border shadow-xl overflow-y-auto"
        style={{ maxHeight: 'calc(95dvh - env(safe-area-inset-top))' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        {step < 3 && (
          <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-app-divider">
            <div className="flex items-center gap-2">
              <Trash2 size={18} className="text-app-danger" />
              <h2 className="font-bold text-app-text">Delete Account</h2>
            </div>
            <button onClick={onClose} className="icon-btn text-app-text-muted no-select" aria-label="Close">
              <X size={20} />
            </button>
          </div>
        )}

        {/* Step 1 — Information */}
        {step === 1 && (
          <div className="p-5">
            <div className="bg-app-danger-bg border border-app-danger rounded-lg p-3 mb-5">
              <div className="flex items-start gap-2.5">
                <AlertTriangle size={18} className="text-app-danger flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-app-danger mb-1">This action cannot be undone.</p>
                  <p className="text-sm text-app-text leading-relaxed">
                    Deleting your account will permanently remove your personal account information and access to Essential SOP.
                  </p>
                </div>
              </div>
            </div>

            <p className="text-xs font-semibold text-app-text-muted uppercase mb-3">What will happen:</p>
            <ul className="space-y-2.5 mb-4">
              {[
                { icon: '🚪', text: 'You will be signed out and lose access immediately.' },
                { icon: '👤', text: 'Your personal app data, preferences, and history will be removed.' },
                { icon: '🏢', text: 'Company-owned job templates, procedures, and shared knowledge will not be deleted.' },
                { icon: '🏘️', text: 'If you are the only member of your workspace, it will be closed as part of your deletion (its data is kept, not deleted).' },
                { icon: '🔐', text: 'A deletion request will be logged. An administrator will permanently remove your login identity via the Base44 dashboard.' },
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span className="text-base flex-shrink-0 leading-snug">{item.icon}</span>
                  <span className="text-sm text-app-text-2 leading-relaxed">{item.text}</span>
                </li>
              ))}
            </ul>
            <div className="bg-app-warning-bg border border-app-warning rounded-lg px-3 py-2 mb-5">
              <p className="text-xs text-app-warning leading-relaxed">
                <strong>Note:</strong> Authentication identity removal requires a manual step by a workspace
                administrator and may take up to 30 days to complete.
              </p>
            </div>

            <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 py-2.5 border border-app-border rounded-xl text-sm font-medium text-app-text-2 no-select touch-active">Cancel</button>
              <button onClick={handleContinueToConfirm} className="flex-1 py-2.5 bg-app-danger text-white rounded-xl text-sm font-semibold no-select touch-active">Continue</button>
            </div>
          </div>
        )}

        {/* Step 2 — Confirmation (typed DELETE + delete) */}
        {step === 2 && (
          <div className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <ShieldAlert size={20} className="text-app-danger" />
              <p className="text-sm font-semibold text-app-text">Final confirmation required</p>
            </div>
            <p className="text-sm text-app-text-2 mb-5 leading-relaxed">
              To confirm, type <span className="font-bold text-app-danger font-mono">{CONFIRM_WORD}</span> in the box below, then tap Delete My Account. Your current signed-in session is used to verify your identity.
            </p>
            <input
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              placeholder={CONFIRM_WORD}
              className="w-full px-4 py-3 bg-app-input border border-app-border rounded-xl text-sm font-mono text-app-text placeholder:text-app-text-disabled focus:outline-none focus:border-app-danger focus:ring-1 focus:ring-app-danger mb-2"
            />
            <p className="text-xs text-app-danger mb-5 flex items-center gap-1">
              <AlertTriangle size={11} /> This action is permanent and cannot be undone.
            </p>
            {error && (
              <div className="flex items-start gap-2 bg-app-danger-bg border border-app-danger rounded-lg px-3 py-2 mb-3">
                <AlertTriangle size={14} className="text-app-danger flex-shrink-0 mt-0.5" />
                <p className="text-xs text-app-danger">{error}</p>
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={onClose} disabled={loading} className="flex-1 py-2.5 border border-app-border rounded-xl text-sm font-medium text-app-text-2 disabled:opacity-50">Cancel</button>
              <button
                onClick={handleDelete}
                disabled={loading || confirmText !== CONFIRM_WORD}
                className="flex-1 py-2.5 bg-app-danger text-white rounded-xl text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Deleting...</>
                ) : (
                  <><Trash2 size={14} /> Delete My Account</>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Step 3 — Success */}
        {step === 3 && (
          <div className="p-6 text-center">
            <div className="w-14 h-14 bg-app-success-bg rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">✓</span>
            </div>
            <h3 className="font-bold text-app-text text-lg mb-3">Deletion Request Received</h3>
            <p className="text-sm text-app-text-2 leading-relaxed mb-4">
              Your account deletion request has been received and you have been signed out.
              An administrator will complete removal of your account data and login identity.
            </p>
            <div className="bg-app-info-bg border border-app-border rounded-xl p-3 text-left mb-2">
              <p className="text-xs text-app-text-muted leading-relaxed">
                Your request is now pending administrator review. Removal of your account data and
                login identity will be completed via the Base44 dashboard. You will not be able to
                sign in again.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}