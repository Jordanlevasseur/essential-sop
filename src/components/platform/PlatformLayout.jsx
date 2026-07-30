import React from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/CompanyContext';
import { base44 } from '@/api/base44Client';
import {
  LayoutDashboard, BookOpen, Users, ScrollText, ShieldCheck,
  Building2, LogOut, ChevronDown,
} from 'lucide-react';
import { useState } from 'react';

const NAV_ITEMS = [
  { path: '/platform',                label: 'Dashboard',     icon: LayoutDashboard, exact: true },
  { path: '/platform/master-library', label: 'Master Library', icon: BookOpen },
  { path: '/platform/admins',         label: 'Platform Admins', icon: Users },
  { path: '/platform/audit',          label: 'Audit Log',     icon: ScrollText },
];

export default function PlatformLayout() {
  const { user } = useAuth();
  const { hasCompany } = useCompany();
  const navigate = useNavigate();
  const [showAccountMenu, setShowAccountMenu] = useState(false);

  const handleSignOut = () => {
    ['esop_mode','esop_favorites','esop_recent','esop_prefs','esop_session','esop_user','esop_fav_init'].forEach(k => localStorage.removeItem(k));
    base44.auth.logout('/');
  };

  return (
    <div className="min-h-screen flex flex-col bg-app-bg">
      {/* Top bar */}
      <header className="bg-app-surface border-b border-app-border flex-shrink-0 z-20"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="px-4 h-14 flex items-center justify-between">
          {/* Brand */}
          <div className="flex items-center gap-2">
            <ShieldCheck size={20} className="text-app-accent" />
            <div>
              <span className="font-bold text-sm text-app-text">Essential SOP</span>
              <span className="ml-2 text-[10px] px-1.5 py-0.5 bg-app-info-bg text-app-info rounded font-semibold">PLATFORM</span>
            </div>
          </div>

          {/* Account menu */}
          <div className="relative">
            <button
              onClick={() => setShowAccountMenu(v => !v)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-app-elevated text-sm text-app-text-2 no-select touch-active"
            >
              <div className="w-7 h-7 bg-app-info-bg rounded-full flex items-center justify-center">
                <span className="text-xs font-bold text-app-accent">{user?.email?.[0]?.toUpperCase() || 'A'}</span>
              </div>
              <span className="hidden sm:block max-w-40 truncate">{user?.email}</span>
              <ChevronDown size={14} />
            </button>
            {showAccountMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowAccountMenu(false)} />
                <div className="absolute right-0 top-full mt-1 w-56 bg-app-surface border border-app-border rounded-xl shadow-lg z-20 overflow-hidden">
                  <div className="px-4 py-3 border-b border-app-divider">
                    <p className="text-xs font-semibold text-app-text truncate">{user?.email}</p>
                    <p className="text-[10px] text-app-text-muted">Platform Super Admin</p>
                  </div>
                  {hasCompany && (
                    <button
                      onClick={() => { setShowAccountMenu(false); navigate('/'); }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-sm text-app-text hover:bg-app-elevated text-left"
                    >
                      <Building2 size={15} className="text-app-text-muted" />
                      Switch to Company Workspace
                    </button>
                  )}
                  <button
                    onClick={handleSignOut}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-app-danger hover:bg-app-danger-bg text-left"
                  >
                    <LogOut size={15} />
                    Sign Out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Nav tabs */}
        <nav className="flex overflow-x-auto scrollbar-hide border-t border-app-divider">
          {NAV_ITEMS.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.exact}
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors no-select ${
                  isActive
                    ? 'text-app-accent border-app-accent'
                    : 'text-app-text-muted border-transparent hover:text-app-text'
                }`
              }
            >
              <item.icon size={13} />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      {/* Page content */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}