import React, { useState } from 'react';
import { AlertTriangle, X, Trash2, ShieldAlert, Eye, EyeOff } from 'lucide-react';
import { base44 } from '@/api/base44Client';

const CONFIRM_WORD = 'DELETE';

export default function DeleteAccountModal({ onClose }) {
  const [step, setStep] = useState(1); // 1=info, 2=confirm, 3=reauth, 4=done
  const [confirmText, setConfirmText] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleContinueToConfirm = () => {
    setError('');
    setStep(2);
  };

  const handleContinueToReauth = () => {
    if (confirmText !== CONFIRM_WORD) return;
    setError('');
    setStep(3);
  };

  const handleDelete = async (method) => {
    setError('');
    setLoading(true);

    try {
      // Reauthenticate / verify identity before deleting.
      // - Password accounts: verify the current password (reauthentication).
      // - Google/OAuth-only accounts: no password exists, so the authenticated
      //   session IS the identity verification. The typed DELETE word in the
      //   previous step is the deliberate confirmation for BOTH methods.
      //   An unauthenticated user can never reach this step (auth.me() required).
      const userResp = await base44.auth.me();
      if (!userResp) throw new Error('Not authenticated.');

      if (method === 'password') {
        if (!password.trim()) {
          setError('Please enter your password to confirm your identity.');
          setLoading(false);
          return;
        }
        try {
          await base44.auth.loginViaEmailPassword(userResp.email, password);
        } catch {
          setError('Incorrect password. Please try again, or use the Google sign-in option below.');
          setLoading(false);
          return;
        }
      }
      // method === 'google': authenticated session is the verification; proceed.

      // Call backend deletion function
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

      setStep(4);

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
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-4" onClick={step < 4 ? onClose : undefined}>
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
        {step < 4 && (
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

        {/* Step 2 — Confirmation */}
        {step === 2 && (
          <div className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <ShieldAlert size={20} className="text-app-danger" />
              <p className="text-sm font-semibold text-app-text">Final confirmation required</p>
            </div>
            <p className="text-sm text-app-text-2 mb-5 leading-relaxed">
              To confirm, type <span className="font-bold text-app-danger font-mono">{CONFIRM_WORD}</span> in the box below.
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
            <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 py-2.5 border border-app-border rounded-xl text-sm font-medium text-app-text-2">Cancel</button>
              <button
                onClick={handleContinueToReauth}
                disabled={confirmText !== CONFIRM_WORD}
                className="flex-1 py-2.5 bg-app-danger text-white rounded-xl text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Step 3 — Reauthentication */}
        {step === 3 && (
          <div className="p-5">
            <p className="text-sm text-app-text-2 mb-5 leading-relaxed">
              For your security, verify your identity before deleting your account. Enter your password, or use the Google option below if you sign in with Google.
            </p>
            <div className="relative mb-2">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleDelete()}
                placeholder="Current password"
                className="w-full px-4 py-3 pr-11 bg-app-input border border-app-border rounded-xl text-sm text-app-text placeholder:text-app-text-muted focus:outline-none focus:border-app-danger focus:ring-1 focus:ring-app-danger"
              />
              <button
                onClick={() => setShowPassword(s => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-app-text-muted"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {error && (
              <div className="flex items-start gap-2 bg-app-danger-bg border border-app-danger rounded-lg px-3 py-2 mb-3">
                <AlertTriangle size={14} className="text-app-danger flex-shrink-0 mt-0.5" />
                <p className="text-xs text-app-danger">{error}</p>
              </div>
            )}
            <div className="flex gap-3 mt-4">
              <button onClick={onClose} disabled={loading} className="flex-1 py-2.5 border border-app-border rounded-xl text-sm font-medium text-app-text-2 disabled:opacity-50">Cancel</button>
              <button
                onClick={() => handleDelete('password')}
                disabled={loading || !password.trim()}
                className="flex-1 py-2.5 bg-app-danger text-white rounded-xl text-sm font-semibold disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Deleting...</>
                ) : (
                  <><Trash2 size={14} /> Delete My Account</>
                )}
              </button>
            </div>
            <div className="flex items-center gap-3 my-3">
              <div className="flex-1 h-px bg-app-divider" />
              <span className="text-xs text-app-text-muted">or</span>
              <div className="flex-1 h-px bg-app-divider" />
            </div>
            <button
              onClick={() => handleDelete('google')}
              disabled={loading}
              className="w-full py-2.5 border border-app-border rounded-xl text-sm font-medium text-app-text-2 flex items-center justify-center gap-2 disabled:opacity-50 no-select touch-active"
            >
              I sign in with Google — continue deletion
            </button>
          </div>
        )}

        {/* Step 4 — Success */}
        {step === 4 && (
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