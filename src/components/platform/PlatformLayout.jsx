import React, { Suspense, useState } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/CompanyContext';
import { base44 } from '@/api/base44Client';
import { Briefcase, Building2, Settings, User } from 'lucide-react';
import OfflineBanner from '@/components/OfflineBanner';
import PageTransition from '@/components/PageTransition';
import RouteFallback from '@/components/RouteFallback';

const TABS = [
  { to: '/platform/master-library', label: 'Master Jobs', icon: Briefcase },
  { to: '/platform/companies',      label: 'Companies',   icon: Building2 },
  { to: '/platform/admins',         label: 'Admin',        icon: Settings },
  { to: '/platform/profile',        label: 'Profile',     icon: User },
];

// Sub-pages that should hide the bottom nav (editor, detail pages)
const HIDE_NAV_PATTERNS = ['/platform/master-library/'];

const NAV_CONTENT_HEIGHT = 66;

export default function PlatformLayout() {
  const { user } = useAuth();
  const { hasCompany } = useCompany();
  const navigate = useNavigate();
  const location = useLocation();

  const [showWorkspaceSwitcher, setShowWorkspaceSwitcher] = useState(false);

  // Hide bottom nav on deep sub-pages (e.g. master SOP editor)
  const isSubPage = HIDE_NAV_PATTERNS.some(p => {
    const rest = location.pathname.replace(p, '');
    return location.pathname.startsWith(p) && rest.length > 0;
  });

  const handleSignOut = () => {
    ['esop_mode', 'esop_favorites', 'esop_recent', 'esop_prefs', 'esop_session', 'esop_user', 'esop_fav_init']
      .forEach(k => localStorage.removeItem(k));
    base44.auth.logout('/');
  };

  const firstName = user?.full_name?.split(' ')[0] || user?.email?.split('@')[0] || 'You';
  const initials = user?.full_name
    ? user.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
    : (user?.email?.[0] || 'A').toUpperCase();

  return (
    <div
      className="min-h-screen bg-app-bg flex flex-col relative"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      <OfflineBanner />

      <main
        className={`flex-1 w-full ${isSubPage ? '' : 'max-w-2xl mx-auto'}`}
        style={{
          paddingBottom: isSubPage
            ? 0
            : `calc(${NAV_CONTENT_HEIGHT}px + env(safe-area-inset-bottom))`,
        }}
      >
        <Suspense fallback={<RouteFallback />}>
          <PageTransition>
            <Outlet />
          </PageTransition>
        </Suspense>
      </main>

      {/* Bottom navigation — identical structure to Company Layout */}
      {!isSubPage && (
        <nav
          aria-label="Platform navigation"
          className="fixed bottom-0 left-0 right-0 bg-app-nav border-t border-app-border z-40"
          style={{
            paddingBottom: 'env(safe-area-inset-bottom)',
            paddingLeft: 'env(safe-area-inset-left)',
            paddingRight: 'env(safe-area-inset-right)',
          }}
        >
          <div className="max-w-2xl mx-auto flex">
            {TABS.map(({ to, label, icon: Icon }) => {
              // Profile tab: render a custom button that opens the workspace switcher
              if (label === 'Profile') {
                return (
                  <button
                    key="profile"
                    onClick={() => setShowWorkspaceSwitcher(true)}
                    className="flex-1 flex flex-col items-center gap-1 py-3 transition-colors no-select touch-active text-app-nav-inactive"
                    aria-label="Profile & workspace"
                  >
                    {/* Avatar circle mirrors the Profile tab feel */}
                    <div className="w-[22px] h-[22px] bg-app-info-bg rounded-full flex items-center justify-center">
                      <span className="text-[9px] font-bold text-app-accent">{initials}</span>
                    </div>
                    <span className="text-xs font-medium">{label}</span>
                  </button>
                );
              }
              return (
                <NavLink
                  key={to}
                  to={to}
                  replace
                  aria-label={label}
                  className={({ isActive }) =>
                    `flex-1 flex flex-col items-center gap-1 py-3 transition-colors no-select touch-active ${
                      isActive ? 'text-app-nav-active' : 'text-app-nav-inactive'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon size={22} strokeWidth={isActive ? 2.5 : 2} aria-hidden="true" />
                      <span className={`text-xs ${isActive ? 'font-semibold' : 'font-medium'}`}>{label}</span>
                    </>
                  )}
                </NavLink>
              );
            })}
          </div>
        </nav>
      )}

      {/* Workspace switcher sheet */}
      {showWorkspaceSwitcher && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end"
          onClick={() => setShowWorkspaceSwitcher(false)}
        >
          <div className="absolute inset-0 bg-black/50" />
          <div
            className="relative bg-app-surface rounded-t-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* User identity */}
            <div className="px-4 pt-5 pb-4 border-b border-app-border flex items-center gap-3">
              <div className="w-10 h-10 bg-app-info-bg rounded-full flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-bold text-app-accent">{initials}</span>
              </div>
              <div>
                <p className="text-sm font-semibold text-app-text">{firstName}</p>
                <p className="text-xs text-app-text-muted truncate max-w-xs">{user?.email}</p>
              </div>
            </div>

            {/* Workspace list */}
            <div className="px-4 py-3">
              <p className="text-xs font-semibold text-app-text-muted uppercase tracking-wide mb-2">Workspaces</p>

              {/* Active: Platform */}
              <div className="flex items-center gap-3 px-3 py-3 rounded-xl bg-app-info-bg border border-app-accent/20 mb-2">
                <div className="w-8 h-8 bg-app-accent/10 rounded-lg flex items-center justify-center">
                  <Briefcase size={16} className="text-app-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-app-text">Essential SOP Platform</p>
                  <p className="text-xs text-app-text-muted">Super Admin</p>
                </div>
                <div className="w-2 h-2 rounded-full bg-app-accent flex-shrink-0" />
              </div>

              {/* Company workspace — if the user has one */}
              {hasCompany && (
                <button
                  onClick={() => { setShowWorkspaceSwitcher(false); navigate('/'); }}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-xl border border-app-border bg-app-surface text-left no-select touch-active mb-2"
                >
                  <div className="w-8 h-8 bg-app-elevated rounded-lg flex items-center justify-center">
                    <Building2 size={16} className="text-app-text-muted" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-app-text">Company Workspace</p>
                    <p className="text-xs text-app-text-muted">Switch workspace</p>
                  </div>
                </button>
              )}
            </div>

            {/* Sign out */}
            <div
              className="px-4 pb-4 pt-2 border-t border-app-border"
              style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
            >
              <button
                onClick={handleSignOut}
                className="w-full py-3 text-sm font-medium text-app-danger text-center no-select touch-active"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}