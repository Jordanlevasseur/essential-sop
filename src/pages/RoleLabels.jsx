import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useCompany } from '@/lib/CompanyContext';
import { ArrowLeft, Save, RotateCcw } from 'lucide-react';
import {
  DEFAULT_ROLE_LABELS,
  getCustomizableRoles,
  validateRoleLabel,
  ROLE_LABEL_MAX_LENGTH,
} from '@/lib/roleLabels';

export default function RoleLabels() {
  const navigate = useNavigate();
  const { activeCompany, isGeneralManager, refreshCompanies } = useCompany();

  const customizableRoles = getCustomizableRoles();

  const initialLabels = () => {
    const out = {};
    for (const r of customizableRoles) {
      out[r] = activeCompany?.customRoleLabels?.[r] || DEFAULT_ROLE_LABELS[r];
    }
    return out;
  };

  const [labels, setLabels] = useState(initialLabels);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  if (!isGeneralManager) {
    return (
      <div className="min-h-screen bg-app-bg flex items-center justify-center p-8 text-center">
        <p className="text-sm text-app-text-muted">Only General Managers can edit role labels.</p>
      </div>
    );
  }

  const setLabel = (role, value) => {
    setLabels(prev => ({ ...prev, [role]: value }));
    setErrors(prev => ({ ...prev, [role]: '' }));
  };

  const resetRole = (role) => {
    setLabel(role, DEFAULT_ROLE_LABELS[role]);
  };

  const handleSave = async () => {
    const newErrors = {};
    for (const r of customizableRoles) {
      const err = validateRoleLabel(labels[r]);
      if (err) newErrors[r] = err;
    }
    if (Object.keys(newErrors).length > 0) { setErrors(newErrors); return; }

    setSaving(true);
    const customRoleLabels = {};
    for (const r of customizableRoles) {
      const val = labels[r].trim();
      if (val !== DEFAULT_ROLE_LABELS[r]) customRoleLabels[r] = val;
    }
    await base44.entities.Company.update(activeCompany.id, { customRoleLabels });
    refreshCompanies();
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="min-h-screen bg-app-bg">
      <div className="bg-app-surface border-b border-app-border sticky top-0 z-40" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="px-3 py-2.5 flex items-center gap-2.5">
          <button onClick={() => navigate(-1)} className="icon-btn touch-active"><ArrowLeft size={22} className="text-app-text-2" /></button>
          <h1 className="font-semibold text-app-text flex-1">Role Labels</h1>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-app-accent text-app-accent-text rounded-lg text-sm font-medium touch-active no-select disabled:opacity-60">
            <Save size={14} /> {saving ? 'Saving…' : saved ? 'Saved!' : 'Save'}
          </button>
        </div>
      </div>

      <div className="px-3 pt-4 pb-6 max-w-lg mx-auto">
        <div className="bg-app-info-bg border border-app-info/20 rounded-xl p-3.5 mb-6">
          <p className="text-xs text-app-info leading-relaxed">
            Role labels change how positions are named in this workspace. They do not change permissions.
          </p>
        </div>

        {/* Fixed role — not editable */}
        <div className="mb-4">
          <p className="text-xs font-semibold text-app-text-muted uppercase mb-2 px-1">Fixed Roles</p>
          <div className="bg-app-card border border-app-border rounded-lg p-3">
            <p className="text-sm font-medium text-app-text">General Manager</p>
            <p className="text-xs text-app-text-muted mt-0.5">This label is fixed and cannot be changed.</p>
          </div>
        </div>

        {/* Customizable roles */}
        <p className="text-xs font-semibold text-app-text-muted uppercase mb-2 px-1">Customizable Roles</p>
        <div className="space-y-3">
          {customizableRoles.map(r => (
            <div key={r} className="bg-app-card border border-app-border rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-app-text-muted">{DEFAULT_ROLE_LABELS[r]}</p>
                <button onClick={() => resetRole(r)} className="text-xs text-app-text-muted touch-active flex items-center gap-1 no-select">
                  <RotateCcw size={11} /> Reset
                </button>
              </div>
              <input
                value={labels[r]}
                onChange={e => setLabel(r, e.target.value)}
                maxLength={ROLE_LABEL_MAX_LENGTH}
                placeholder={DEFAULT_ROLE_LABELS[r]}
                className="w-full px-3 py-2.5 bg-app-input border border-app-border rounded-lg text-sm text-app-text focus:outline-none focus:border-app-accent"
              />
              {errors[r] && <p className="text-xs text-app-danger mt-1">{errors[r]}</p>}
              <p className="text-xs text-app-text-disabled text-right mt-1">{labels[r]?.length || 0}/{ROLE_LABEL_MAX_LENGTH}</p>
            </div>
          ))}
        </div>

        <p className="text-xs text-app-text-muted text-center mt-6">
          Example: Project Manager → Production Manager, Technician → Field Technician
        </p>
      </div>
    </div>
  );
}