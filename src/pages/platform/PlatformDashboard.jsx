import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { usePlatform } from '@/lib/PlatformContext';
import {
  BookOpen, Users, ShieldCheck, ScrollText, LayoutDashboard,
  ChevronRight, Activity, Building2, CheckCircle2, FileText, Archive,
} from 'lucide-react';

export default function PlatformDashboard() {
  const { user } = useAuth();
  const { platformMembership } = usePlatform();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingStats(true);
      try {
        const [mastersRes, adminsRes] = await Promise.all([
          base44.functions.invoke('manageMasterSOP', { action: 'list' }).catch(() => null),
          base44.functions.invoke('managePlatformAdmins', { action: 'list' }).catch(() => null),
        ]);
        if (cancelled) return;
        const masters = mastersRes?.data?.masters || [];
        const admins = adminsRes?.data?.memberships || [];
        setStats({
          totalSOPs: masters.length,
          publishedSOPs: masters.filter(m => m.status === 'active').length,
          draftSOPs: masters.filter(m => m.status === 'draft').length,
          archivedSOPs: masters.filter(m => m.status === 'archived').length,
          activeAdmins: admins.filter(m => m.status === 'ACTIVE').length,
          totalAdmins: admins.length,
        });
      } catch (_) {
        // non-fatal
      }
      if (!cancelled) setLoadingStats(false);
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const QUICK_LINKS = [
    {
      icon: BookOpen, label: 'Master SOP Library', desc: 'Create, edit, and publish Master SOPs',
      path: '/platform/master-library', color: 'text-app-accent',
    },
    {
      icon: Users, label: 'Platform Admins', desc: 'Manage Platform Super Admins',
      path: '/platform/admins', color: 'text-app-success',
    },
    {
      icon: ScrollText, label: 'Audit Log', desc: 'View all platform-level actions',
      path: '/platform/audit', color: 'text-app-warning',
    },
  ];

  return (
    <div className="min-h-screen bg-app-bg">
      {/* Header */}
      <div className="bg-app-surface border-b border-app-border px-6 py-5">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-3 mb-1">
            <ShieldCheck size={20} className="text-app-accent" />
            <h1 className="text-2xl font-bold text-app-text">Platform Administration</h1>
          </div>
          <p className="text-sm text-app-text-muted">
            Essential SOP — Platform Control Center
          </p>
          <p className="text-xs text-app-text-disabled mt-1">
            Signed in as {user?.email} · Platform Super Admin
          </p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        {/* Stats */}
        {!loadingStats && stats && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {[
              { label: 'Total SOPs', value: stats.totalSOPs, icon: BookOpen, cls: 'text-app-accent' },
              { label: 'Published', value: stats.publishedSOPs, icon: CheckCircle2, cls: 'text-app-success' },
              { label: 'Drafts', value: stats.draftSOPs, icon: FileText, cls: 'text-app-warning' },
              { label: 'Archived', value: stats.archivedSOPs, icon: Archive, cls: 'text-app-text-muted' },
              { label: 'Admins', value: stats.activeAdmins, icon: ShieldCheck, cls: 'text-app-info' },
            ].map(s => (
              <div key={s.label} className="bg-app-card border border-app-border rounded-xl p-4 flex items-center gap-3">
                <s.icon size={18} className={s.cls} />
                <div>
                  <p className="text-xl font-bold text-app-text">{s.value}</p>
                  <p className="text-xs text-app-text-muted">{s.label}</p>
                </div>
              </div>
            ))}
          </div>
        )}
        {loadingStats && (
          <div className="h-20 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-app-border border-t-app-accent rounded-full animate-spin" />
          </div>
        )}

        {/* Quick links */}
        <div>
          <h2 className="text-sm font-semibold text-app-text-muted uppercase tracking-wide mb-3">Administration</h2>
          <div className="grid sm:grid-cols-3 gap-3">
            {QUICK_LINKS.map(ql => (
              <button
                key={ql.path}
                onClick={() => navigate(ql.path)}
                className="bg-app-card border border-app-border rounded-xl p-5 text-left hover:border-app-accent transition-colors flex items-start gap-4"
              >
                <ql.icon size={24} className={ql.color} />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-app-text text-sm mb-0.5">{ql.label}</p>
                  <p className="text-xs text-app-text-muted">{ql.desc}</p>
                </div>
                <ChevronRight size={16} className="text-app-text-disabled flex-shrink-0 mt-0.5" />
              </button>
            ))}
          </div>
        </div>

        {/* Session info */}
        <div className="bg-app-elevated border border-app-border rounded-xl p-4 text-xs text-app-text-muted space-y-1">
          <p className="font-semibold text-app-text-2 text-sm mb-2">Platform Session</p>
          <p>Granted since: {platformMembership?.grantedAt ? new Date(platformMembership.grantedAt).toLocaleDateString() : 'Unknown'}</p>
          <p>Role: Platform Super Admin</p>
          <p>Membership ID: <span className="font-mono selectable">{platformMembership?.id || '—'}</span></p>
        </div>
      </div>
    </div>
  );
}