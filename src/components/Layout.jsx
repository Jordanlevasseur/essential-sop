import React, { Suspense } from 'react';
import { NavLink, useLocation, Outlet } from 'react-router-dom';
import { Briefcase, MessageSquare, User } from 'lucide-react';
import OfflineBanner from '@/components/OfflineBanner';
import PageTransition from '@/components/PageTransition';
import RouteFallback from '@/components/RouteFallback';

const TABS = [
  { to: '/', label: 'Jobs', icon: Briefcase, end: true },
  { to: '/assistant', label: 'Assistant', icon: MessageSquare },
  { to: '/profile', label: 'Profile', icon: User },
];

const NAV_CONTENT_HEIGHT = 60;

export default function Layout() {
  const location = useLocation();
  const isSubPage = location.pathname.includes('/jobs/');

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
        className="flex-1 max-w-2xl w-full mx-auto"
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

      {!isSubPage && (
        <nav
          aria-label="Main navigation"
          className="fixed bottom-0 left-0 right-0 bg-app-nav border-t border-app-border z-40"
          style={{
            paddingBottom: 'env(safe-area-inset-bottom)',
            paddingLeft: 'env(safe-area-inset-left)',
            paddingRight: 'env(safe-area-inset-right)',
          }}
        >
          <div className="max-w-2xl mx-auto flex">
            {TABS.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                replace
                aria-label={label}
                className={({ isActive }) =>
                  `flex-1 flex flex-col items-center gap-1 py-2.5 transition-colors no-select touch-active ${isActive ? 'text-app-nav-active' : 'text-app-nav-inactive'}`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon size={20} strokeWidth={isActive ? 2.5 : 2} aria-hidden="true" />
                    <span className={`text-xs ${isActive ? 'font-semibold' : 'font-medium'}`}>{label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}