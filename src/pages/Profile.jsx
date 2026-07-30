import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useApp } from '@/lib/AppContext';
import { useTheme } from '@/lib/ThemeContext';
import { resetDemoData } from '@/lib/seedData';
import { useCompany } from '@/lib/CompanyContext';
import CompanySelector from '@/components/CompanySelector';
import {
  Star, Clock, Type, Sun, Moon, Monitor, ArrowUpDown, RotateCcw,
  Pencil, LogOut, HardHat, ShieldCheck, ChevronRight, Trash2,
  AlertTriangle, FileText, ScrollText, ClipboardList, CreditCard,
  Users, GitPullRequest, Activity, Bell, Building2, Tag, ShieldAlert,
} from 'lucide-react';
import { getPlan, formatPrice } from '@/lib/plans';
import { getRoleLabel } from '@/lib/roleLabels';
import DeleteAccountModal from '@/components/DeleteAccountModal';
import { SORT_OPTIONS } from '@/lib/constants';
import { resolveLegalLink } from '@/lib/appSettings';

export default function Profile() {
  const navigate = useNavigate();
  const { user, userMode, switchMode, preferences, updatePreferences, recentlyViewed, favorites, isPlatformSuperAdmin, companyId } = useApp();
  const { activeCompany, activeMembership, companies, isGeneralManager } = useCompany();
  const { appearance, setAppearance } = useTheme();
  const currentPlan = getPlan(activeCompany?.subscriptionPlanCode);
  const isHomeowner = activeCompany?.subscriptionPlanCode === 'homeowner';
  const role = activeMembership?.role;
  const isProjectManager = role === 'project_manager';
  const isProjectLead = role === 'project_lead';
  const isTechnician = role === 'technician';
  const [resetting, setResetting] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const rl = (code) => getRoleLabel(code, activeCompany);

  const handleReset = async () => {
    if (!confirm('This will delete all jobs and restore the original demo data. Continue?')) return;
    setResetting(true);
    try {
      await resetDemoData(companyId);
      setResetDone(true);
      setTimeout(() => { window.location.href = '/'; }, 1500);
    } catch (e) {
      alert('Reset failed: ' + (e.message || 'Unknown error'));
    } finally {
      setResetting(false);
    }
  };

  const APPEARANCE_OPTIONS = [
    { value: 'system', label: 'System', icon: Monitor },
    { value: 'light',  label: 'Light',  icon: Sun },
    { value: 'dark',   label: 'Dark',   icon: Moon },
  ];

  return (
    <div className="px-4 pt-6 pb-4">
      <h1 className="text-2xl font-bold text-app-text mb-4">Profile</h1>

      {/* User card */}
      <div className="bg-app-card border border-app-border rounded-xl p-4 mb-4 flex items-center gap-3">
        <div className="w-14 h-14 bg-app-info-bg rounded-full flex items-center justify-center flex-shrink-0">
          <span className="text-xl font-bold text-app-accent">{user.name?.charAt(0) || 'U'}</span>
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-app-text truncate">{user.name}</h2>
          <p className="text-sm text-app-text-2 truncate">{rl(activeMembership?.role) || user.role}</p>
          <p className="text-xs text-app-text-muted truncate">{activeCompany?.name || user.company}</p>
        </div>
        <div className="px-2.5 py-1 rounded-full text-xs font-medium bg-app-disabled text-app-text-muted">
          {userMode === 'admin' ? 'Demo: Admin' : 'Demo: View'}
        </div>
      </div>

      {/* Company selector */}
      <CompanySelector />

      {/* ── COMPANY SECTION ── */}
      {isHomeowner ? (
        /* Homeowner: Workspace section */
        <Section title="Workspace">
          <Row icon={Building2} label="Workspace Profile" onClick={() => navigate('/company-profile')} />
          <Divider />
          <Row icon={Activity} label="Content History" onClick={() => navigate('/activity')} />
          <Divider />
          <Row icon={CreditCard} label="Subscription" onClick={() => navigate('/subscription')} />
          <Divider />
          <Row icon={Bell} label="Notifications" onClick={() => navigate('/notifications')} />
        </Section>
      ) : isGeneralManager ? (
        /* General Manager: full company section */
        <Section title="Company">
          <Row icon={Building2} label="Company Profile" onClick={() => navigate('/company-profile')} />
          <Divider />
          <Row icon={Users} label="Team Members" onClick={() => navigate('/team')} />
          <Divider />
          <Row icon={GitPullRequest} label="Edit Requests" onClick={() => navigate('/requests')} />
          <Divider />
          <Row icon={Activity} label="Activity History" onClick={() => navigate('/activity')} />
          <Divider />
          <Row icon={Tag} label="Role Labels" onClick={() => navigate('/role-labels')} />
          <Divider />
          <Row icon={CreditCard} label="Subscription" onClick={() => navigate('/subscription')} />
          <Divider />
          <Row icon={ShieldAlert} label="Ownership &amp; Account" onClick={() => navigate('/ownership')} />
          <Divider />
          <Row icon={Bell} label="Notifications" onClick={() => navigate('/notifications')} />
        </Section>
      ) : isProjectManager ? (
        /* Project Manager: limited company section */
        <Section title="Company">
          <Row icon={GitPullRequest} label="Edit Requests" onClick={() => navigate('/requests')} />
          <Divider />
          <Row icon={Activity} label="Activity History" onClick={() => navigate('/activity')} />
          <Divider />
          <Row icon={Bell} label="Notifications" onClick={() => navigate('/notifications')} />
        </Section>
      ) : isProjectLead ? (
        /* Project Lead: only own edit requests + notifications */
        <Section title="Company">
          <Row icon={GitPullRequest} label="My Edit Requests" onClick={() => navigate('/requests')} />
          <Divider />
          <Row icon={Bell} label="Notifications" onClick={() => navigate('/notifications')} />
        </Section>
      ) : !isTechnician ? null : (
        /* Technician: notifications only */
        <Section title="Company">
          <Row icon={Bell} label="Notifications" onClick={() => navigate('/notifications')} />
        </Section>
      )}

      {/* Subscription — shown only for homeowner (non-homeowner GM already sees it above) */}
      {!isHomeowner && !isGeneralManager && (
        <Section title="Subscription">
          <button onClick={() => navigate('/subscription')} className="w-full flex items-center gap-3 px-4 py-3.5 text-left no-select touch-active">
            <CreditCard size={18} className="text-app-text-muted" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-app-text">{currentPlan?.displayName || 'Subscription'}</p>
              <p className="text-xs text-app-text-muted">
                {currentPlan ? formatPrice(currentPlan) : ''}{activeCompany?.subscriptionStatus === 'prototype' ? ' · Prototype' : ''}
              </p>
            </div>
            <ChevronRight size={16} className="text-app-text-disabled" />
          </button>
        </Section>
      )}

      <Section title="Saved Content">
        <Row icon={Star} label="Favorite Jobs" value={favorites.length} onClick={() => navigate('/')} />
        <Divider />
        <Row icon={Clock} label="Recently Viewed" value={recentlyViewed.length} onClick={() => navigate('/')} />
      </Section>

      <Section title="Preferences">
        {/* Text Size */}
        <div className="px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <Type size={16} className="text-app-text-muted" />
            <span className="text-sm text-app-text">Text Size</span>
          </div>
          <div className="flex gap-2">
            {['small', 'medium', 'large'].map(s => (
              <button key={s} onClick={() => updatePreferences({ textSize: s })}
                className={`flex-1 py-1.5 rounded-lg text-sm capitalize font-medium transition-colors no-select touch-active ${preferences.textSize === s ? 'bg-app-accent text-app-accent-text' : 'bg-app-elevated text-app-text-2'}`}>
                {s}
              </button>
            ))}
          </div>
        </div>
        <Divider />
        {/* Appearance */}
        <div className="px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <Monitor size={16} className="text-app-text-muted" />
            <span className="text-sm text-app-text">Appearance</span>
          </div>
          <div className="flex gap-2">
            {APPEARANCE_OPTIONS.map(({ value, label, icon: Icon }) => (
              <button key={value} onClick={() => setAppearance(value)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium flex flex-col items-center gap-1 transition-colors no-select touch-active ${appearance === value ? 'bg-app-accent text-app-accent-text' : 'bg-app-elevated text-app-text-2'}`}>
                <Icon size={16} />
                <span className="text-xs">{label}</span>
              </button>
            ))}
          </div>
        </div>
        <Divider />
        {/* Default Sort */}
        <div className="px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <ArrowUpDown size={16} className="text-app-text-muted" />
            <span className="text-sm text-app-text">Default Job Sort</span>
          </div>
          <select value={preferences.defaultSort} onChange={e => updatePreferences({ defaultSort: e.target.value })}
            className="w-full px-3 py-2 bg-app-input border border-app-border rounded-lg text-sm text-app-text">
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </Section>

      {/* Prototype Controls — presentation-only UI switchers. No backend permissions change. */}
      <Section title="Prototype Controls (Presentation Only)">
        <Row icon={HardHat} label="Technician View" active={userMode === 'technician'} onClick={() => switchMode('technician')} />
        <Divider />
        <Row icon={ShieldCheck} label="Administrator View" active={userMode === 'admin'} onClick={() => switchMode('admin')} />
        <Divider />
        <Row icon={RotateCcw} label={resetting ? 'Resetting…' : resetDone ? 'Reset Complete!' : 'Reset Demo Data'} onClick={resetting ? undefined : handleReset} />
      </Section>

      {/* Platform Admin — gated on verified PlatformMembership, not company role */}
      {isPlatformSuperAdmin && (
        <Section title="Platform Administration">
          <Row icon={ShieldCheck} label="Platform Dashboard" onClick={() => navigate('/platform')} />
          <Divider />
          <Row icon={ClipboardList} label="Account Deletion Requests" onClick={() => navigate('/admin/deletion-requests')} />
        </Section>
      )}

      <Section title="Account">
        <Row icon={Pencil} label="Edit Profile" onClick={() => alert('Profile editing is not available in this prototype.')} />
        <Divider />
        <Row icon={LogOut} label="Sign Out" onClick={() => {
          // Only clear this app's known keys — do not wipe origin-wide localStorage
          ['esop_mode','esop_favorites','esop_recent','esop_prefs','esop_session','esop_user','esop_fav_init'].forEach(k => localStorage.removeItem(k));
          base44.auth.logout('/');
        }} />
      </Section>

      <Section title="Legal">
        <Row icon={FileText} label="Privacy Policy" onClick={() => {
          const r = resolveLegalLink('privacyPolicyUrl', '/privacy-policy');
          if (!r.external) navigate(r.route);
        }} />
        <Divider />
        <Row icon={ScrollText} label="Terms of Service" onClick={() => {
          const r = resolveLegalLink('termsOfServiceUrl', '/terms-of-service');
          if (!r.external) navigate(r.route);
        }} />
      </Section>

      {/* Danger zone */}
      <div className="mb-4">
        <div className="bg-app-card border border-app-danger/40 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-app-divider flex items-center gap-2">
            <AlertTriangle size={13} className="text-app-danger" />
            <span className="text-xs font-semibold text-app-danger uppercase tracking-wide">Danger Zone</span>
          </div>
          <button onClick={() => setShowDeleteModal(true)} className="w-full flex items-center gap-3 px-4 py-3.5 touch-active">
            <Trash2 size={18} className="text-app-danger" />
            <div className="flex-1 text-left">
              <span className="text-sm font-medium text-app-danger">Delete Account</span>
              <p className="text-xs text-app-text-muted mt-0.5">Permanently delete your account and personal data.</p>
            </div>
            <ChevronRight size={16} className="text-app-danger/60" />
          </button>
        </div>
      </div>

      {showDeleteModal && <DeleteAccountModal onClose={() => setShowDeleteModal(false)} />}

      <p className="text-xs text-app-text-muted text-center mt-6">Essential SOP v4.2</p>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="mb-4">
      <h3 className="text-xs font-semibold text-app-text-muted uppercase mb-2 px-1">{title}</h3>
      <div className="bg-app-card border border-app-border rounded-xl overflow-hidden">{children}</div>
    </div>
  );
}

function Divider() {
  return <div className="h-px bg-app-divider mx-4" />;
}

function Row({ icon: Icon, label, value, onClick, active }) {
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 text-left no-select ${onClick ? 'touch-active' : ''} ${active ? 'bg-app-info-bg' : ''}`}>
      <Icon size={18} className={active ? 'text-app-accent' : 'text-app-text-muted'} aria-hidden="true" />
      <span className={`text-sm flex-1 ${active ? 'text-app-accent font-medium' : 'text-app-text'}`}
        dangerouslySetInnerHTML={{ __html: label }} />
      {value !== undefined && <span className="text-sm text-app-text-muted">{value}</span>}
      {onClick && <ChevronRight size={16} className="text-app-text-disabled" aria-hidden="true" />}
    </Wrapper>
  );
}