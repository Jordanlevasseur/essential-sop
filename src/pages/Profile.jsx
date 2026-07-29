import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/lib/AppContext';
import { useTheme } from '@/lib/ThemeContext';
import { resetDemoData } from '@/lib/seedData';
import { Star, Clock, Type, Sun, Moon, Monitor, ArrowUpDown, RotateCcw, Pencil, LogOut, HardHat, ShieldCheck, ChevronRight, Trash2, AlertTriangle } from 'lucide-react';
import DeleteAccountModal from '@/components/DeleteAccountModal';
import { SORT_OPTIONS } from '@/lib/constants';

export default function Profile() {
  const navigate = useNavigate();
  const { user, userMode, switchMode, preferences, updatePreferences, recentlyViewed, favorites } = useApp();
  const { appearance, setAppearance } = useTheme();
  const [resetting, setResetting] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const handleReset = async () => {
    if (!confirm('This will delete all jobs and restore the original demo data. Continue?')) return;
    setResetting(true);
    try {
      await resetDemoData();
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
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
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
          <p className="text-sm text-app-text-2 truncate">{user.role}</p>
          <p className="text-xs text-app-text-muted truncate">{user.company}</p>
        </div>
        <div className={`px-2.5 py-1 rounded-full text-xs font-medium ${userMode === 'admin' ? 'bg-app-info-bg text-app-info' : 'bg-app-info-bg text-app-accent'}`}>
          {userMode === 'admin' ? 'Admin' : 'Technician'}
        </div>
      </div>

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
                className={`flex-1 py-1.5 rounded-lg text-sm capitalize font-medium transition-colors ${preferences.textSize === s ? 'bg-app-accent text-app-accent-text' : 'bg-app-elevated text-app-text-2'}`}>
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
                className={`flex-1 py-2 rounded-lg text-sm font-medium flex flex-col items-center gap-1 transition-colors ${appearance === value ? 'bg-app-accent text-app-accent-text' : 'bg-app-elevated text-app-text-2'}`}>
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

      <Section title="Prototype Controls">
        <Row icon={HardHat} label="Switch to Technician View" active={userMode === 'technician'} onClick={() => switchMode('technician')} />
        <Divider />
        <Row icon={ShieldCheck} label="Switch to Administrator View" active={userMode === 'admin'} onClick={() => switchMode('admin')} />
        <Divider />
        <Row icon={RotateCcw} label={resetting ? 'Resetting...' : resetDone ? 'Reset Complete!' : 'Reset Demo Data'} onClick={resetting ? undefined : handleReset} />
      </Section>

      <Section title="Account">
        <Row icon={Pencil} label="Edit Profile" onClick={() => alert('Profile editing is not available in this prototype.')} />
        <Divider />
        <Row icon={LogOut} label="Sign Out" onClick={() => { localStorage.clear(); window.location.href = '/'; }} />
      </Section>

      {/* Danger zone */}
      <div className="mb-4">
        <div className="bg-app-card border border-app-danger/40 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-app-divider flex items-center gap-2">
            <AlertTriangle size={13} className="text-app-danger" />
            <span className="text-xs font-semibold text-app-danger uppercase tracking-wide">Danger Zone</span>
          </div>
          <button onClick={() => setShowDeleteModal(true)} className="w-full flex items-center gap-3 px-4 py-3.5 active:opacity-70">
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

      <p className="text-xs text-app-text-muted text-center mt-6">Essential SOP v1.0 · Prototype</p>
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
    <Wrapper
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 text-left no-select ${onClick ? 'touch-active' : ''} ${active ? 'bg-app-info-bg' : ''}`}
    >
      <Icon size={18} className={active ? 'text-app-accent' : 'text-app-text-muted'} aria-hidden="true" />
      <span className={`text-sm flex-1 ${active ? 'text-app-accent font-medium' : 'text-app-text'}`}>{label}</span>
      {value !== undefined && <span className="text-sm text-app-text-muted">{value}</span>}
      {onClick && <ChevronRight size={16} className="text-app-text-disabled" aria-hidden="true" />}
    </Wrapper>
  );
}