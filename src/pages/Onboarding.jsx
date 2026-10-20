import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useCompany } from '@/lib/CompanyContext';
import { useAuth } from '@/lib/AuthContext';
import { PLANS, formatPrice, seatLimitLabel } from '@/lib/plans';
import { Check, Star, Building2, Loader2, ChevronRight } from 'lucide-react';

export default function Onboarding() {
  const { refreshCompanies } = useCompany();
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState('plan'); // 'plan' | 'name'
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [companyName, setCompanyName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // A brand-new customer must register/sign in BEFORE creating a workspace.
  // When an unauthenticated visitor selects a plan, we persist it and send them
  // to /register; after auth they return here (via NoCompanyScreen) and resume
  // at the "name" step with their plan pre-selected.
  const PENDING_PLAN_KEY = 'esop_pending_plan';

  useEffect(() => {
    const pendingCode = sessionStorage.getItem(PENDING_PLAN_KEY);
    if (!pendingCode) return;
    const plan = PLANS.find(p => p.code === pendingCode);
    if (plan) {
      setSelectedPlan(plan);
      setStep('name');
    }
  }, []);

  const handleSelectPlan = (plan) => {
    setSelectedPlan(plan);
    if (!isAuthenticated) {
      // No account yet — register/sign in first, then return to name the workspace.
      sessionStorage.setItem(PENDING_PLAN_KEY, plan.code);
      navigate('/register');
      return;
    }
    setStep('name');
  };

  const handleCreate = async () => {
    const trimmed = companyName.trim();
    if (!trimmed) { setError('Please enter a workspace name.'); return; }
    // Safety net: the plan-select gate sends an unauthenticated user to /register.
    // If we ever reach here without a session, do NOT call the backend (it
    // requires auth and returns 401) — send the user to register instead.
    if (!isAuthenticated) {
      sessionStorage.setItem(PENDING_PLAN_KEY, selectedPlan.code);
      setError('Please sign in or create an account to continue.');
      navigate('/register');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const resp = await base44.functions.invoke('createCompany', {
        name: trimmed,
        planCode: selectedPlan.code,
      });
      if (!resp.data?.success) throw new Error(resp.data?.error || 'We could not create your workspace right now.');
      sessionStorage.removeItem(PENDING_PLAN_KEY);
      refreshCompanies();
    } catch (err) {
      // Surface the backend's safe error message (err.response.data.error)
      // instead of Axios's generic "Request failed with status code 500".
      const backendMsg = err?.response?.data?.error || err?.data?.error;
      setError(backendMsg || 'We could not create your workspace right now. Please try again.');
      setLoading(false);
    }
  };

  if (step === 'name') {
    return (
      <div className="min-h-screen bg-app-bg flex flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-sm">
          <button onClick={() => { sessionStorage.removeItem(PENDING_PLAN_KEY); setStep('plan'); }} className="text-xs text-app-text-muted mb-6 flex items-center gap-1">
            ← Back to plans
          </button>
          {!isAuthenticated && (
            <p className="text-xs text-app-text-muted mb-6 text-center">
              Already have an account?{' '}
              <Link to="/login" className="text-app-accent font-medium">Sign in</Link>
            </p>
          )}

          <div className="w-12 h-12 bg-app-info-bg rounded-xl flex items-center justify-center mb-4">
            <Building2 size={24} className="text-app-accent" />
          </div>

          <h1 className="text-2xl font-bold text-app-heading mb-1">Name your workspace</h1>
          <p className="text-sm text-app-text-2 mb-2">
            Selected plan: <span className="font-semibold text-app-accent">{selectedPlan.displayName}</span> — Free during beta
          </p>
          <p className="text-xs text-app-text-muted mb-6">
            {seatLimitLabel(selectedPlan)}
          </p>

          <div className="bg-app-card border border-app-border rounded-2xl p-5">
            <label className="block text-sm font-medium text-app-text mb-2">Workspace name</label>
            <input
              value={companyName}
              onChange={e => setCompanyName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !loading && handleCreate()}
              placeholder={selectedPlan.accountType === 'individual' ? 'e.g. My Home Projects' : 'e.g. Apex Contracting LLC'}
              autoFocus
              className="w-full px-4 py-3 bg-app-input border border-app-border rounded-xl text-sm text-app-text placeholder:text-app-text-muted focus:outline-none focus:border-app-accent focus:ring-1 focus:ring-app-accent mb-3"
            />
            {error && <p className="text-xs text-app-danger mb-3">{error}</p>}

            <div className="bg-app-success-bg border border-app-success/30 rounded-xl px-3 py-2 mb-4">
              <p className="text-xs text-app-success">
                <span className="font-semibold">Free during beta.</span> No payment method required.
              </p>
            </div>

            <button
              onClick={handleCreate}
              disabled={loading || !companyName.trim()}
              className="w-full py-3 bg-app-accent text-app-accent-text rounded-xl text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading
                ? <><Loader2 size={16} className="animate-spin" /> Creating workspace...</>
                : <>Create Workspace <ChevronRight size={16} /></>}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-app-bg px-4 py-8">
      <div className="max-w-sm mx-auto">
        {!isAuthenticated && (
          <div className="flex items-center justify-between mb-6">
            <span className="text-sm font-semibold text-app-text">Essential SOP</span>
            <Link
              to="/login"
              className="px-3.5 py-2 text-sm font-semibold text-app-accent border border-app-accent rounded-lg no-select touch-active"
            >
              Sign In
            </Link>
          </div>
        )}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-app-info-bg rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Building2 size={32} className="text-app-accent" />
          </div>
          <h1 className="text-2xl font-bold text-app-heading mb-2">Choose your plan</h1>
          <p className="text-sm text-app-text-2">All plans are free during beta. No payment method required.</p>
        </div>

        <div className="space-y-3">
          {PLANS.map(plan => (
            <PlanCard
              key={plan.code}
              plan={plan}
              onSelect={() => handleSelectPlan(plan)}
            />
          ))}
        </div>

        {!isAuthenticated && (
          <p className="text-sm text-app-text-2 text-center mt-5">
            Already have an account?{' '}
            <Link to="/login" className="text-app-accent font-medium">Sign in</Link>
          </p>
        )}

        <p className="text-xs text-app-text-muted text-center mt-6">
          All plans are free during beta. Standard pricing applies after beta ends.
        </p>

        <button
          onClick={() => {
            ['esop_mode','esop_favorites','esop_recent','esop_prefs','esop_session','esop_user','esop_fav_init','esop_active_company_id'].forEach(k => localStorage.removeItem(k));
            base44.auth.logout('/');
          }}
          className="mt-4 w-full text-xs text-app-text-muted underline text-center"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

function PlanCard({ plan, onSelect }) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left bg-app-card border rounded-2xl p-4 no-select touch-active transition-colors ${plan.recommended ? 'border-app-accent' : 'border-app-border'}`}
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-bold text-app-text">{plan.displayName}</span>
            {plan.recommended && (
              <span className="flex items-center gap-1 text-xs px-2 py-0.5 bg-app-accent text-app-accent-text rounded-full font-medium">
                <Star size={10} /> Recommended
              </span>
            )}
          </div>
          <span className="text-lg font-bold text-app-success">Free during beta</span>
          <span className="text-xs text-app-text-muted ml-2">Standard: {formatPrice(plan)}</span>
        </div>
        <div className="text-right flex-shrink-0 ml-3">
          <div className="text-sm font-semibold text-app-text">
            {seatLimitLabel(plan)}
          </div>
        </div>
      </div>

      <p className="text-xs text-app-text-muted mb-3">{plan.description}</p>

      <ul className="space-y-1">
        {plan.features.map(f => (
          <li key={f} className="flex items-center gap-2 text-xs text-app-text-2">
            <Check size={12} className="text-app-success flex-shrink-0" />
            {f}
          </li>
        ))}
      </ul>

      <div className="mt-3 pt-3 border-t border-app-divider flex items-center justify-between">
        <span className="text-xs text-app-text-muted">Select this plan</span>
        <ChevronRight size={16} className="text-app-text-disabled" />
      </div>
    </button>
  );
}