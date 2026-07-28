import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/lib/AppContext';
import { resetDemoData } from '@/lib/seedData';
import { Star, Clock, Type, Moon, ArrowUpDown, RotateCcw, Pencil, LogOut, HardHat, ShieldCheck, ChevronRight } from 'lucide-react';
import { SORT_OPTIONS } from '@/lib/constants';

export default function Profile() {
  const navigate = useNavigate();
  const { user, userMode, switchMode, preferences, updatePreferences, recentlyViewed, favorites } = useApp();
  const [resetting, setResetting] = useState(false);
  const [resetDone, setResetDone] = useState(false);

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

  return (
    <div className="px-4 pt-6 pb-4">
      <h1 className="text-2xl font-bold text-neutral-900 mb-4">Profile</h1>

      <div className="bg-white border border-neutral-200 rounded-xl p-4 mb-4 flex items-center gap-3">
        <div className="w-14 h-14 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
          <span className="text-xl font-bold text-blue-600">{user.name?.charAt(0) || 'U'}</span>
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-neutral-900 truncate">{user.name}</h2>
          <p className="text-sm text-neutral-500 truncate">{user.role}</p>
          <p className="text-xs text-neutral-400 truncate">{user.company}</p>
        </div>
        <div className={`px-2.5 py-1 rounded-full text-xs font-medium ${userMode === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
          {userMode === 'admin' ? 'Admin' : 'Technician'}
        </div>
      </div>

      <Section title="Saved Content">
        <Row icon={Star} label="Favorite Jobs" value={favorites.length} onClick={() => navigate('/')} />
        <Row icon={Clock} label="Recently Viewed" value={recentlyViewed.length} onClick={() => navigate('/')} />
      </Section>

      <Section title="Preferences">
        <div className="px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <Type size={16} className="text-neutral-400" />
            <span className="text-sm text-neutral-700">Text Size</span>
          </div>
          <div className="flex gap-2">
            {['small', 'medium', 'large'].map(s => (
              <button key={s} onClick={() => updatePreferences({ textSize: s })}
                className={`flex-1 py-1.5 rounded-lg text-sm capitalize ${preferences.textSize === s ? 'bg-blue-600 text-white' : 'bg-neutral-100 text-neutral-600'}`}>
                {s}
              </button>
            ))}
          </div>
        </div>
        <Divider />
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Moon size={16} className="text-neutral-400" />
            <span className="text-sm text-neutral-700">Dark Mode</span>
          </div>
          <button onClick={() => updatePreferences({ darkMode: !preferences.darkMode })}
            className={`w-11 h-6 rounded-full transition-colors ${preferences.darkMode ? 'bg-blue-600' : 'bg-neutral-200'}`}>
            <div className={`w-5 h-5 bg-white rounded-full transition-transform ${preferences.darkMode ? 'translate-x-5' : 'translate-x-0.5'} mt-0.5`} />
          </button>
        </div>
        <Divider />
        <div className="px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <ArrowUpDown size={16} className="text-neutral-400" />
            <span className="text-sm text-neutral-700">Default Job Sort</span>
          </div>
          <select value={preferences.defaultSort} onChange={e => updatePreferences({ defaultSort: e.target.value })}
            className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm">
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </Section>

      <Section title="Prototype Controls">
        <button onClick={() => switchMode('technician')} className="w-full">
          <Row icon={HardHat} label="Switch to Technician View" active={userMode === 'technician'} />
        </button>
        <Divider />
        <button onClick={() => switchMode('admin')} className="w-full">
          <Row icon={ShieldCheck} label="Switch to Administrator View" active={userMode === 'admin'} />
        </button>
        <Divider />
        <button onClick={handleReset} disabled={resetting} className="w-full">
          <Row icon={RotateCcw} label={resetting ? 'Resetting...' : resetDone ? 'Reset Complete!' : 'Reset Demo Data'} />
        </button>
      </Section>

      <Section title="Account">
        <Row icon={Pencil} label="Edit Profile" onClick={() => alert('Profile editing is not available in this prototype.')} />
        <Divider />
        <button onClick={() => { localStorage.clear(); window.location.href = '/'; }} className="w-full">
          <Row icon={LogOut} label="Sign Out" />
        </button>
      </Section>

      <p className="text-xs text-neutral-400 text-center mt-6">Essential SOP v1.0 · Prototype</p>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="mb-4">
      <h3 className="text-xs font-semibold text-neutral-500 uppercase mb-2 px-1">{title}</h3>
      <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">{children}</div>
    </div>
  );
}

function Divider() {
  return <div className="h-px bg-neutral-100 mx-4" />;
}

function Row({ icon: Icon, label, value, onClick, active }) {
  return (
    <div onClick={onClick} className={`flex items-center gap-3 px-4 py-3 ${onClick ? 'cursor-pointer active:bg-neutral-50' : ''} ${active ? 'bg-blue-50' : ''}`}>
      <Icon size={18} className={active ? 'text-blue-600' : 'text-neutral-400'} />
      <span className={`text-sm flex-1 ${active ? 'text-blue-700 font-medium' : 'text-neutral-700'}`}>{label}</span>
      {value !== undefined && <span className="text-sm text-neutral-400">{value}</span>}
      {onClick && <ChevronRight size={16} className="text-neutral-300" />}
    </div>
  );
}