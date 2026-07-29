import React, { useState } from 'react';
import { Building2, Plus, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useCompany } from '@/lib/CompanyContext';

/**
 * Shown when a user has no active company memberships.
 * Allows creating a new company or waiting for an invitation.
 */
export default function NoCompanyScreen() {
  const { refreshCompanies } = useCompany();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setError('Please enter a company name.'); return; }
    setLoading(true);
    setError('');
    try {
      const resp = await base44.functions.invoke('createCompany', { name: trimmed });
      if (!resp.data?.success) throw new Error(resp.data?.error || 'Failed to create company.');
      refreshCompanies();
    } catch (err) {
      setError(err.message || 'Failed to create company.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-app-bg flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm text-center">
        <div className="w-16 h-16 bg-app-info-bg rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Building2 size={32} className="text-app-accent" />
        </div>
        <h1 className="text-2xl font-bold text-app-text mb-2">Welcome to Essential SOP</h1>
        <p className="text-sm text-app-text-2 mb-8">
          You're not a member of any company yet. Create your company to get started, or contact your administrator for an invitation.
        </p>

        <div className="bg-app-card border border-app-border rounded-2xl p-5 text-left">
          <h2 className="font-semibold text-app-text mb-3">Create Your Company</h2>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            placeholder="Company name"
            className="w-full px-4 py-3 bg-app-input border border-app-border rounded-xl text-sm text-app-text placeholder:text-app-text-muted focus:outline-none focus:border-app-accent focus:ring-1 focus:ring-app-accent mb-3"
          />
          {error && <p className="text-xs text-app-danger mb-3">{error}</p>}
          <button
            onClick={handleCreate}
            disabled={loading || !name.trim()}
            className="w-full py-3 bg-app-accent text-app-accent-text rounded-xl text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? <><Loader2 size={16} className="animate-spin" /> Creating...</> : <><Plus size={16} /> Create Company</>}
          </button>
        </div>

        <p className="text-xs text-app-text-muted mt-6">
          Already have a company? Ask your General Manager to add you as a member.
        </p>

        <button
          onClick={() => { localStorage.clear(); window.location.href = '/'; }}
          className="mt-4 text-xs text-app-text-muted underline"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}