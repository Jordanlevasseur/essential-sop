import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, Navigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useApp } from '@/lib/AppContext';
import { useCompany } from '@/lib/CompanyContext';
import { ArrowLeft, AlertTriangle, ExternalLink } from 'lucide-react';
import MasterSectionView from '@/components/company-master/MasterSectionView';

const STATUS_INFO = {
  adopted: { label: 'In your company library', cls: 'bg-app-success-bg text-app-success border-app-success' },
  available: { label: 'Available — not in your company library', cls: 'bg-app-info-bg text-app-info border-app-info/30' },
  removed: { label: 'Removed from your company library', cls: 'bg-app-warning-bg text-app-warning border-app-warning/30' },
};

export default function CompanyMasterPreview() {
  const { masterId } = useParams();
  const navigate = useNavigate();
  const { isCompanyAdmin } = useApp();
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isCompanyAdmin || !companyId || !masterId) return;
    setLoading(true);
    base44.functions.invoke('resolveCompanyMasterPreview', { companyId, masterId })
      .then(res => {
        const d = res?.data || {};
        if (d.error) {
          setError(d.code === 'NOT_PROVISIONED' ? 'not_provisioned' : d.error);
          return;
        }
        setData(d);
      })
      .catch(() => setError('Failed to load this Master SOP.'))
      .finally(() => setLoading(false));
  }, [companyId, masterId, isCompanyAdmin]);

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen bg-app-bg">
      <div className="w-8 h-8 border-4 border-app-border border-t-app-accent rounded-full animate-spin" />
    </div>
  );

  // Direct-route denial: only GM/PM (create+edit) may access this surface.
  if (!isCompanyAdmin) return <Navigate to="/" replace />;

  if (error === 'not_provisioned') return (
    <div className="min-h-screen bg-app-bg">
      <PreviewHeader onBack={() => navigate('/company-master-library')} />
      <div className="px-4 py-10 text-center">
        <AlertTriangle size={28} className="text-app-warning mx-auto mb-3" />
        <p className="text-sm text-app-text">This Master SOP is not provisioned to your company.</p>
        <button onClick={() => navigate('/company-master-library')} className="mt-4 text-xs text-app-accent underline touch-active">Back to Master Library</button>
      </div>
    </div>
  );
  if (error) return (
    <div className="min-h-screen bg-app-bg">
      <PreviewHeader onBack={() => navigate('/company-master-library')} />
      <div className="px-4 py-10 text-center"><p className="text-sm text-app-danger">{error}</p></div>
    </div>
  );
  if (!data) return null;

  const s = STATUS_INFO[data.adoptionState] || STATUS_INFO.available;

  return (
    <div className="min-h-screen bg-app-bg">
      <div className="bg-app-surface border-b border-app-border sticky top-0 z-40" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="px-3 py-2.5 flex items-center gap-2.5">
          <button onClick={() => navigate('/company-master-library')} className="icon-btn touch-active" aria-label="Back"><ArrowLeft size={22} className="text-app-text-2" /></button>
          <h1 className="font-semibold text-app-text flex-1 truncate">{data.master.title}</h1>
        </div>
      </div>

      <div className="px-3 pt-4 pb-3 max-w-2xl mx-auto space-y-3">
        <div className="bg-app-card border border-app-border rounded-xl p-3.5">
          <p className="text-xs text-app-text-muted mb-1">
            {[data.master.trade, data.master.category].filter(Boolean).join(' · ') || 'Master SOP'}
            {data.master.versionNumber ? ` · v${data.master.versionNumber}` : ''}
          </p>
          <h2 className="text-lg font-bold text-app-heading">{data.master.title}</h2>
          {data.master.changeNotes && <p className="text-xs text-app-text-2 mt-1.5">{data.master.changeNotes}</p>}
          <div className={`mt-3 text-xs px-2.5 py-1.5 rounded-lg border font-medium inline-block ${s.cls}`}>{s.label}</div>
          {data.adoptionState === 'adopted' && data.jobId && (
            <button
              onClick={() => navigate(`/jobs/${data.jobId}`)}
              className="mt-3 w-full py-2.5 bg-app-accent text-app-accent-text rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 touch-active no-select"
            >
              <ExternalLink size={14} /> View in Company Library
            </button>
          )}
        </div>

        <p className="text-xs text-app-text-muted px-1 pt-1">
          This is the platform-published Master SOP content (read-only). Your company's customized version, if any, lives in the Company Library.
        </p>

        {data.sections.length === 0 ? (
          <p className="text-sm text-app-text-muted text-center py-8">This Master SOP has no published content yet.</p>
        ) : (
          <div className="space-y-2">
            {data.sections.map(sec => (
              <MasterSectionView key={sec.sectionType} section={sec} />
            ))}
          </div>
        )}
      </div>
      <div style={{ height: 'calc(16px + env(safe-area-inset-bottom))' }} />
    </div>
  );
}

function PreviewHeader({ onBack }) {
  return (
    <div className="bg-app-surface border-b border-app-border sticky top-0 z-40" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="px-3 py-2.5 flex items-center gap-2.5">
        <button onClick={onBack} className="icon-btn touch-active" aria-label="Back"><ArrowLeft size={22} className="text-app-text-2" /></button>
        <h1 className="font-semibold text-app-text flex-1">Master SOP</h1>
      </div>
    </div>
  );
}