import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useCompany } from '@/lib/CompanyContext';
import { PLANS, formatPrice } from '@/lib/plans';
import { Check, Star, Building2, Loader2, ChevronRight } from 'lucide-react';

export default function Onboarding() {
  const { refreshCompanies } = useCompany();
  const [step, setStep] = useState('plan'); // 'plan' | 'name'
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [companyName, setCompanyName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSelectPlan = (plan) => {
    setSelectedPlan(plan);
    setStep('name');
  };

  const handleCreate = async () => {
    const trimmed = companyName.trim();
    if (!trimmed) { setError('Please enter a workspace name.'); return; }
    setLoading(true);
    setError('');
    try {
      const resp = await base44.functions.invoke('createCompany', {
        name: trimmed,
        planCode: selectedPlan.code,
      });
      if (!resp.data?.success) throw new Error(resp.data?.error || 'Failed to create workspace.');
      refreshCompanies();
    } catch (err) {
      setError(err.message || 'Failed to create workspace.');
      setLoading(false);
    }
  };

  if (step === 'name') {
    return (
      <div className="min-h-screen bg-app-bg flex flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-sm">
          <button onClick={() => setStep('plan')} className="text-xs text-app-text-muted mb-6 flex items-center gap-1">
            ← Back to plans
          </button>

          <div className="w-12 h-12 bg-app-info-bg rounded-xl flex items-center justify-center mb-4">
            <Building2 size={24} className="text-app-accent" />
          </div>

          <h1 className="text-2xl font-bold text-app-text mb-1">Name your workspace</h1>
          <p className="text-sm text-app-text-2 mb-2">
            Selected plan: <span className="font-semibold text-app-accent">{selectedPlan.displayName}</span> — {formatPrice(selectedPlan)}
          </p>
          <p className="text-xs text-app-text-muted mb-6">
            {selectedPlan.seatLimit === 1 ? '1 profile' : `Up to ${selectedPlan.seatLimit} profiles`}
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

            <div className="bg-app-warning-bg border border-app-warning/40 rounded-xl px-3 py-2 mb-4">
              <p className="text-xs text-app-warning">
                <span className="font-semibold">Prototype mode:</span> No payment is processed during testing.
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
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-app-info-bg rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Building2 size={32} className="text-app-accent" />
          </div>
          <h1 className="text-2xl font-bold text-app-text mb-2">Choose your plan</h1>
          <p className="text-sm text-app-text-2">Select the plan that fits your team size.</p>
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

        <p className="text-xs text-app-text-muted text-center mt-6">
          All plans run in test mode — no charges apply.
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
          <span className="text-lg font-bold text-app-accent">{formatPrice(plan)}</span>
        </div>
        <div className="text-right flex-shrink-0 ml-3">
          <div className="text-sm font-semibold text-app-text">
            {plan.seatLimit === 1 ? '1 profile' : `${plan.seatLimit} profiles`}
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