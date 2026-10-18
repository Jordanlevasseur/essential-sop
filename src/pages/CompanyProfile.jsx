import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useCompany } from '@/lib/CompanyContext';
import { ArrowLeft, Save } from 'lucide-react';

const TRADE_SPECIALTIES = [
  'Carpentry', 'Concrete', 'Drywall', 'Electrical', 'Flooring', 'Framing',
  'HVAC', 'Insulation', 'Landscaping', 'Masonry', 'Painting', 'Plumbing',
  'Roofing', 'Siding', 'Tile', 'Windows & Doors',
];

export default function CompanyProfile() {
  const navigate = useNavigate();
  const { activeCompany, isGeneralManager, refreshCompanies } = useCompany();

  const [form, setForm] = useState({
    name: activeCompany?.name || '',
    phone: activeCompany?.phone || '',
    email: activeCompany?.email || '',
    website: activeCompany?.website || '',
    location: activeCompany?.location || '',
    description: activeCompany?.description || '',
    tradeSpecialties: activeCompany?.tradeSpecialties || [],
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  if (!isGeneralManager) {
    return (
      <div className="min-h-screen bg-app-bg flex items-center justify-center p-8 text-center">
        <p className="text-sm text-app-text-muted">Only General Managers can edit the company profile.</p>
      </div>
    );
  }

  const set = (field, value) => setForm(f => ({ ...f, [field]: value }));

  const toggleSpecialty = (s) => set('tradeSpecialties', form.tradeSpecialties.includes(s)
    ? form.tradeSpecialties.filter(x => x !== s)
    : [...form.tradeSpecialties, s]);

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Company name is required.'); return; }
    setSaving(true); setError('');
    try {
      await base44.entities.Company.update(activeCompany.id, {
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        website: form.website.trim(),
        location: form.location.trim(),
        description: form.description.trim(),
        tradeSpecialties: form.tradeSpecialties,
      });
      // Log activity
      const user = await base44.auth.me().catch(() => null);
      if (user) {
        await base44.entities.ActivityLog.create({
          companyId: activeCompany.id,
          actingUserId: user.id,
          actionType: 'job_edited', // closest available — company settings change
          summary: `${user.full_name || user.email} updated company profile for ${form.name.trim()}`,
          timestamp: new Date().toISOString(),
        }).catch(() => {});
      }
      refreshCompanies();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e.message || 'Failed to save.');
    }
    setSaving(false);
  };

  const initials = form.name?.slice(0, 2).toUpperCase() || '??';

  return (
    <div className="min-h-screen bg-app-bg">
      <div className="bg-app-surface border-b border-app-border sticky top-0 z-40" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="px-3 py-2.5 flex items-center gap-2.5">
          <button onClick={() => navigate(-1)} className="icon-btn touch-active"><ArrowLeft size={22} className="text-app-text-2" /></button>
          <h1 className="font-semibold text-app-text flex-1">Company Profile</h1>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-app-accent text-app-accent-text rounded-lg text-sm font-medium touch-active no-select disabled:opacity-60">
            <Save size={14} /> {saving ? 'Saving…' : saved ? 'Saved!' : 'Save'}
          </button>
        </div>
      </div>

      <div className="px-3 pt-4 pb-6 max-w-lg mx-auto space-y-4">
        {/* Logo placeholder */}
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-app-info-bg flex items-center justify-center">
            <span className="text-xl font-bold text-app-accent">{initials}</span>
          </div>
          <div>
            <p className="text-sm font-semibold text-app-text">{form.name || 'Company Name'}</p>
            <p className="text-xs text-app-text-muted mt-0.5">Company workspace</p>
          </div>
        </div>

        {error && <div className="p-3 bg-app-danger-bg border border-app-danger rounded-lg text-sm text-app-danger">{error}</div>}

        <Field label="Company Name *">
          <input value={form.name} onChange={e => set('name', e.target.value)} maxLength={80}
            placeholder="e.g. Horizon Contracting"
            className="w-full px-3 py-2.5 bg-app-input border border-app-border rounded-lg text-sm text-app-text focus:outline-none focus:border-app-accent" />
        </Field>

        <Field label="Phone">
          <input value={form.phone} onChange={e => set('phone', e.target.value)} type="tel"
            placeholder="(907) 555-0100"
            className="w-full px-3 py-2.5 bg-app-input border border-app-border rounded-lg text-sm text-app-text focus:outline-none focus:border-app-accent" />
        </Field>

        <Field label="Business Email">
          <input value={form.email} onChange={e => set('email', e.target.value)} type="email"
            placeholder="hello@yourcompany.com"
            className="w-full px-3 py-2.5 bg-app-input border border-app-border rounded-lg text-sm text-app-text focus:outline-none focus:border-app-accent" />
        </Field>

        <Field label="Website">
          <input value={form.website} onChange={e => set('website', e.target.value)} type="url"
            placeholder="https://yourcompany.com"
            className="w-full px-3 py-2.5 bg-app-input border border-app-border rounded-lg text-sm text-app-text focus:outline-none focus:border-app-accent" />
        </Field>

        <Field label="Location" hint="General area, e.g. Anchorage, AK">
          <input value={form.location} onChange={e => set('location', e.target.value)} maxLength={80}
            placeholder="City, State"
            className="w-full px-3 py-2.5 bg-app-input border border-app-border rounded-lg text-sm text-app-text focus:outline-none focus:border-app-accent" />
        </Field>

        <Field label="Description">
          <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={3} maxLength={300}
            placeholder="A short description of your company and the work you do."
            className="w-full px-3 py-2.5 bg-app-input border border-app-border rounded-lg text-sm text-app-text focus:outline-none focus:border-app-accent resize-none" />
        </Field>

        <div>
          <p className="text-xs font-semibold text-app-text-muted uppercase mb-2">Trade Specialties</p>
          <div className="flex flex-wrap gap-2">
            {TRADE_SPECIALTIES.map(s => (
              <button key={s} onClick={() => toggleSpecialty(s)}
                className={`px-3 py-1 rounded-full text-xs font-medium border no-select touch-active ${form.tradeSpecialties.includes(s) ? 'bg-app-accent text-app-accent-text border-app-accent' : 'border-app-border text-app-text-2 bg-app-elevated'}`}>
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="text-xs font-semibold text-app-text-muted uppercase mb-1 block">{label}</label>
      {hint && <p className="text-xs text-app-text-muted mb-1">{hint}</p>}
      {children}
    </div>
  );
}