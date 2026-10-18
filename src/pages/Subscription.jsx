import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useCompany } from '@/lib/CompanyContext';
import { useApp } from '@/lib/AppContext';
import { getPlan, PLANS, formatPrice, getUpgradeOptions, getDowngradeOptions, seatLimitLabel } from '@/lib/plans';
import { ArrowLeft, CreditCard, Users, ArrowUp, ArrowDown, AlertTriangle, CheckCircle2, Loader2, Info } from 'lucide-react';

export default function Subscription() {
  const navigate = useNavigate();
  const { activeCompany, refreshCompanies, activeMembership } = useCompany();
  const { isCompanyAdmin: isAdmin } = useApp();
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [planAction, setPlanAction] = useState(null); // { plan, type: 'upgrade'|'downgrade' }
  const [confirming, setConfirming] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');

  useEffect(() => {
    if (!activeCompany?.id) return;
    setLoading(true);
    base44.functions.invoke('seatCheck', { companyId: activeCompany.id })
      .then(r => { setUsage(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [activeCompany?.id]);

  const currentPlanCode = activeCompany?.subscriptionPlanCode || 'contractor';
  const currentPlan = getPlan(currentPlanCode);
  const upgradeOptions = getUpgradeOptions(currentPlanCode);
  const downgradeOptions = getDowngradeOptions(currentPlanCode);
  const isPrototype = activeCompany?.subscriptionStatus === 'prototype';

  const handlePlanChange = async () => {
    if (!planAction) return;
    setConfirming(true);
    setActionError('');
    try {
      const resp = await base44.functions.invoke('managePlan', {
        companyId: activeCompany.id,
        targetPlanCode: planAction.plan.code,
      });
      if (!resp.data?.success) throw new Error(resp.data?.error || 'Plan change failed.');
      setActionSuccess(`Plan updated to ${planAction.plan.displayName}.`);
      setPlanAction(null);
      refreshCompanies();
      // Refresh seat usage
      const r2 = await base44.functions.invoke('seatCheck', { companyId: activeCompany.id });
      setUsage(r2.data);
    } catch (err) {
      setActionError(err.message || 'Failed to change plan.');
    } finally {
      setConfirming(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-app-bg flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-app-border border-t-app-accent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-app-bg">
      {/* Header */}
      <div className="bg-app-surface border-b border-app-border sticky top-0 z-40" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="px-3 py-2.5 flex items-center gap-2.5">
          <button onClick={() => navigate(-1)} className="icon-btn no-select touch-active" aria-label="Back">
            <ArrowLeft size={22} className="text-app-text-2" />
          </button>
          <h1 className="font-semibold text-app-text flex-1">Subscription</h1>
        </div>
      </div>

      <div className="px-3 pt-4 pb-6 space-y-4">

        {/* Prototype notice */}
        {isPrototype && (
          <div className="bg-app-warning-bg border border-app-warning/40 rounded-xl px-4 py-3 flex items-start gap-2">
            <Info size={15} className="text-app-warning flex-shrink-0 mt-0.5" />
            <p className="text-xs text-app-warning">
              <span className="font-semibold">Prototype billing is active.</span> No payment is currently being processed. Apple IAP and web billing are not connected.
            </p>
          </div>
        )}

        {/* Over-limit warning */}
        {usage?.isOverLimit && (
          <div className="bg-app-danger-bg border border-app-danger/40 rounded-xl px-4 py-3 flex items-start gap-2">
            <AlertTriangle size={15} className="text-app-danger flex-shrink-0 mt-0.5" />
            <p className="text-xs text-app-danger">
              <span className="font-semibold">Over profile limit.</span> This workspace has more active profiles than the current plan allows. Upgrade the plan or suspend profiles to restore full account management.
            </p>
          </div>
        )}

        {/* Current plan card */}
        <Section title="Current Plan">
          <div className="px-3 py-3">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="font-bold text-lg text-app-text">{currentPlan?.displayName || currentPlanCode}</p>
                <p className="text-app-accent font-semibold">{formatPrice(currentPlan)}</p>
              </div>
              <StatusBadge status={activeCompany?.subscriptionStatus} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <StatBox label="Profiles used" value={usage?.isUnlimited ? `${usage?.activeSeatCount ?? 0} of Unlimited` : `${usage?.activeSeatCount ?? '—'} of ${usage?.seatLimit ?? '—'}`} />
              <StatBox label="Profiles remaining" value={usage?.isUnlimited ? 'Unlimited' : (usage?.remainingSeatCount ?? '—')} />
            </div>
            {usage && (
              <div className="mt-3">
                <div className="flex justify-between text-xs text-app-text-muted mb-1">
                  <span>{usage.activeSeatCount} active</span>
                  <span>{usage.isUnlimited ? 'Unlimited max' : `${usage.seatLimit} max`}</span>
                </div>
                <div className="h-2 bg-app-elevated rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${usage.isOverLimit ? 'bg-app-danger' : usage.isAtLimit ? 'bg-app-warning' : 'bg-app-accent'}`}
                    style={{ width: `${usage.isUnlimited ? 100 : Math.min(100, (usage.activeSeatCount / usage.seatLimit) * 100)}%` }}
                  />
                </div>
              </div>
            )}
          </div>
          <div className="h-px bg-app-divider mx-4" />
          <div className="px-4 py-3">
            <p className="text-xs text-app-text-muted">
              <span className="font-medium">Billing source:</span> {activeCompany?.subscriptionSource === 'prototype' ? 'Prototype (no charge)' : activeCompany?.subscriptionSource || 'None'}
            </p>
          </div>
        </Section>

        {/* Success/error feedback */}
        {actionSuccess && (
          <div className="bg-app-success-bg border border-app-success/40 rounded-xl px-4 py-3 flex items-center gap-2">
            <CheckCircle2 size={15} className="text-app-success" />
            <p className="text-xs text-app-success font-medium">{actionSuccess}</p>
          </div>
        )}

        {/* Upgrade options */}
        {isAdmin && upgradeOptions.length > 0 && (
          <Section title="Upgrade Plan">
            <div className="divide-y divide-app-divider">
              {upgradeOptions.map(plan => (
                <button key={plan.code} onClick={() => { setPlanAction({ plan, type: 'upgrade' }); setActionError(''); setActionSuccess(''); }}
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-left no-select touch-active">
                  <ArrowUp size={16} className="text-app-success flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-app-text">{plan.displayName}</p>
                    <p className="text-xs text-app-text-muted">{formatPrice(plan)} · {seatLimitLabel(plan)}</p>
                  </div>
                  <span className="text-xs text-app-success font-medium">Upgrade</span>
                </button>
              ))}
            </div>
          </Section>
        )}

        {/* Downgrade options */}
        {isAdmin && downgradeOptions.length > 0 && (
          <Section title="Downgrade Plan">
            <div className="divide-y divide-app-divider">
              {downgradeOptions.map(plan => (
                <button key={plan.code} onClick={() => { setPlanAction({ plan, type: 'downgrade' }); setActionError(''); setActionSuccess(''); }}
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-left no-select touch-active">
                  <ArrowDown size={16} className="text-app-text-muted flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-app-text">{plan.displayName}</p>
                    <p className="text-xs text-app-text-muted">{formatPrice(plan)} · {seatLimitLabel(plan)}</p>
                  </div>
                  <span className="text-xs text-app-text-muted font-medium">Downgrade</span>
                </button>
              ))}
            </div>
          </Section>
        )}

        {/* Cancel placeholder */}
        <Section title="Manage">
          <button className="w-full flex items-center gap-3 px-4 py-3.5 text-left no-select touch-active">
            <CreditCard size={16} className="text-app-text-muted flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm text-app-text">Cancel Subscription</p>
              <p className="text-xs text-app-text-muted">Not available in prototype mode</p>
            </div>
          </button>
          <div className="h-px bg-app-divider mx-4" />
          <button className="w-full flex items-center gap-3 px-4 py-3.5 text-left no-select touch-active" disabled>
            <Users size={16} className="text-app-text-disabled flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm text-app-text-disabled">Restore Purchases</p>
              <p className="text-xs text-app-text-muted">Apple billing not yet configured</p>
            </div>
          </button>
        </Section>

        <button onClick={() => navigate('/plans')} className="w-full py-3 border border-app-border rounded-xl text-sm text-app-text-2 font-medium no-select touch-active">
          Compare All Plans
        </button>

      </div>

      {/* Plan change confirmation modal */}
      {planAction && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4" onClick={() => !confirming && setPlanAction(null)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative bg-app-surface border border-app-border rounded-2xl p-5 w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-app-text mb-2">
              {planAction.type === 'upgrade' ? 'Upgrade to' : 'Downgrade to'} {planAction.plan.displayName}?
            </h3>
            <p className="text-sm text-app-text-2 mb-3">
              You are changing this workspace to the <span className="font-semibold">{planAction.plan.displayName}</span> prototype plan. No payment will be processed in this test environment.
            </p>
            <div className="bg-app-elevated rounded-xl px-3 py-2 mb-4 space-y-1 text-xs text-app-text-muted">
              <p><span className="font-medium">New plan:</span> {planAction.plan.displayName}</p>
              <p><span className="font-medium">Price:</span> {formatPrice(planAction.plan)}</p>
              <p><span className="font-medium">Profile limit:</span> {seatLimitLabel(planAction.plan)}</p>
            </div>
            {actionError && (
              <div className="bg-app-danger-bg border border-app-danger/30 rounded-xl px-3 py-2 mb-3">
                <p className="text-xs text-app-danger">{actionError}</p>
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={() => { setPlanAction(null); setActionError(''); }} disabled={confirming}
                className="flex-1 py-2.5 border border-app-border rounded-xl text-sm font-medium text-app-text-2 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={handlePlanChange} disabled={confirming}
                className="flex-1 py-2.5 bg-app-accent text-app-accent-text rounded-xl text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
                {confirming ? <><Loader2 size={14} className="animate-spin" /> Updating...</> : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-app-text-muted uppercase mb-2 px-1">{title}</h3>
      <div className="bg-app-card border border-app-border rounded-xl overflow-hidden">{children}</div>
    </div>
  );
}

function StatBox({ label, value }) {
  return (
    <div className="bg-app-elevated rounded-xl px-3 py-2.5">
      <p className="text-xs text-app-text-muted mb-0.5">{label}</p>
      <p className="font-bold text-app-text">{value}</p>
    </div>
  );
}

function StatusBadge({ status }) {
  const styles = {
    prototype: 'bg-app-warning-bg text-app-warning',
    active: 'bg-app-success-bg text-app-success',
    trialing: 'bg-app-info-bg text-app-info',
    past_due: 'bg-app-danger-bg text-app-danger',
    cancelled: 'bg-app-elevated text-app-text-muted',
    suspended: 'bg-app-danger-bg text-app-danger',
  };
  const labels = {
    prototype: 'Prototype',
    active: 'Active',
    trialing: 'Trial',
    past_due: 'Past Due',
    cancelled: 'Cancelled',
    suspended: 'Suspended',
  };
  return (
    <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${styles[status] || styles.prototype}`}>
      {labels[status] || status}
    </span>
  );
}