import React, { useState } from 'react';
import { useCompany } from '@/lib/CompanyContext';
import { Building2, Check, ChevronRight } from 'lucide-react';

/**
 * CompanySelector — shown in Profile when the user belongs to more than one company.
 * Confirms before switching if the user is in admin/edit mode.
 */
export default function CompanySelector({ onSwitchRequested }) {
  const { activeCompany, companies, switchCompany, activeMembership } = useCompany();
  const [confirming, setConfirming] = useState(null); // companyId to confirm switch to

  if (!companies || companies.length <= 1) return null;

  const handleSelect = (companyId) => {
    if (companyId === activeCompany?.id) return;
    // If onSwitchRequested is provided (e.g. admin has unsaved edits), ask the parent
    if (onSwitchRequested) {
      onSwitchRequested(() => switchCompany(companyId));
      return;
    }
    setConfirming(companyId);
  };

  const handleConfirm = () => {
    if (confirming) switchCompany(confirming);
    setConfirming(null);
  };

  const confirmTarget = confirming ? companies.find(c => c.id === confirming) : null;

  return (
    <div className="mb-4">
      <h3 className="text-xs font-semibold text-app-text-muted uppercase mb-2 px-1">Company</h3>
      <div className="bg-app-card border border-app-border rounded-xl overflow-hidden">
        {companies.map((company, i) => {
          const isActive = company.id === activeCompany?.id;
          return (
            <React.Fragment key={company.id}>
              {i > 0 && <div className="h-px bg-app-divider mx-4" />}
              <button
                onClick={() => handleSelect(company.id)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 text-left no-select touch-active ${isActive ? 'bg-app-info-bg' : ''}`}
              >
                {company.logo ? (
                  <img src={company.logo} alt="" className="w-8 h-8 rounded-lg object-cover flex-shrink-0" />
                ) : (
                  <div className="w-8 h-8 bg-app-elevated rounded-lg flex items-center justify-center flex-shrink-0">
                    <Building2 size={16} className="text-app-text-muted" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium truncate ${isActive ? 'text-app-accent' : 'text-app-text'}`}>{company.name}</p>
                  {isActive && activeMembership && (
                    <p className="text-xs text-app-text-muted capitalize">{activeMembership.role.replace('_', ' ')}</p>
                  )}
                </div>
                {isActive
                  ? <Check size={16} className="text-app-accent flex-shrink-0" />
                  : <ChevronRight size={16} className="text-app-text-disabled flex-shrink-0" />
                }
              </button>
            </React.Fragment>
          );
        })}
      </div>

      {/* Switch confirmation modal */}
      {confirmTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setConfirming(null)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative bg-app-surface border border-app-border rounded-2xl p-5 max-w-sm w-full shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-app-text mb-2">Switch Company?</h3>
            <p className="text-sm text-app-text-2 mb-4">
              You'll switch to <span className="font-semibold">{confirmTarget.name}</span>. The app will reload to show that company's data.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirming(null)} className="flex-1 py-2.5 border border-app-border rounded-xl text-sm font-medium text-app-text-2">Cancel</button>
              <button onClick={handleConfirm} className="flex-1 py-2.5 bg-app-accent text-app-accent-text rounded-xl text-sm font-semibold">Switch</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}