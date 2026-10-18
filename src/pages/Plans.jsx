import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useCompany } from '@/lib/CompanyContext';
import { PLANS, formatPrice } from '@/lib/plans';
import { ArrowLeft, Check, Star } from 'lucide-react';

export default function Plans() {
  const navigate = useNavigate();
  const { activeCompany } = useCompany();
  const currentPlanCode = activeCompany?.subscriptionPlanCode || 'contractor_plus';

  return (
    <div className="min-h-screen bg-app-bg">
      <div className="bg-app-surface border-b border-app-border sticky top-0 z-40" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="px-3 py-2.5 flex items-center gap-2.5">
          <button onClick={() => navigate(-1)} className="icon-btn no-select touch-active" aria-label="Back">
            <ArrowLeft size={22} className="text-app-text-2" />
          </button>
          <h1 className="font-semibold text-app-text flex-1">Compare Plans</h1>
        </div>
      </div>

      <div className="px-3 pt-4 pb-6 space-y-3">
        <p className="text-sm text-app-text-2 mb-4">All plans include full job editing, uploads, and Assistant access.</p>

        {PLANS.map(plan => {
          const isCurrent = plan.code === currentPlanCode;
          return (
            <div
              key={plan.code}
              className={`bg-app-card border rounded-2xl p-4 ${isCurrent ? 'border-app-accent' : plan.recommended ? 'border-app-border' : 'border-app-border'}`}
            >
              <div className="flex items-start justify-between mb-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-app-text">{plan.displayName}</span>
                  {plan.recommended && (
                    <span className="flex items-center gap-1 text-xs px-2 py-0.5 bg-app-accent text-app-accent-text rounded-full font-medium">
                      <Star size={10} /> Recommended
                    </span>
                  )}
                  {isCurrent && (
                    <span className="text-xs px-2 py-0.5 bg-app-success-bg text-app-success rounded-full font-medium">
                      Current Plan
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-baseline gap-3 mb-2">
                <span className="text-xl font-bold text-app-accent">{formatPrice(plan)}</span>
                <span className="text-sm text-app-text-muted">
                  {plan.seatLimit === 1 ? '1 profile' : `${plan.seatLimit} profiles`}
                </span>
              </div>

              <p className="text-xs text-app-text-muted mb-3">{plan.description}</p>

              <ul className="space-y-1.5">
                {plan.features.map(f => (
                  <li key={f} className="flex items-center gap-2 text-xs text-app-text-2">
                    <Check size={12} className="text-app-success flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>

              {isCurrent ? (
                <div className="mt-3 pt-3 border-t border-app-divider">
                  <p className="text-xs text-app-success font-medium flex items-center gap-1">
                    <Check size={12} /> Current plan
                  </p>
                </div>
              ) : (
                <button
                  onClick={() => navigate('/subscription')}
                  className="mt-3 pt-3 border-t border-app-divider w-full text-left text-xs text-app-accent font-medium"
                >
                  {plan.sortOrder > (PLANS.find(p => p.code === currentPlanCode)?.sortOrder || 0) ? 'Upgrade to this plan →' : 'Downgrade to this plan →'}
                </button>
              )}
            </div>
          );
        })}

        <div className="bg-app-warning-bg border border-app-warning/30 rounded-xl px-4 py-3 mt-2">
          <p className="text-xs text-app-warning">
            <span className="font-semibold">Prototype mode:</span> No payment is currently being processed. Billing will be connected in a future release.
          </p>
        </div>
      </div>
    </div>
  );
}