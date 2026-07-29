import React from 'react';
import { NavLink, useLocation, Outlet } from 'react-router-dom';
import { Briefcase, MessageSquare, User } from 'lucide-react';

const TABS = [
  { to: '/', label: 'Jobs', icon: Briefcase, end: true },
  { to: '/assistant', label: 'Assistant', icon: MessageSquare },
  { to: '/profile', label: 'Profile', icon: User },
];

// Height of the nav bar icon+label content (py-3 = 24px, icon 22px, gap 4px, label ~16px = ~66px)
// We expose this as a CSS variable so pages can reference it for bottom padding
const NAV_CONTENT_HEIGHT = 66;

export default function Layout() {
  const location = useLocation();
  const isSubPage = location.pathname.includes('/jobs/');

  return (
    <div
      className="min-h-screen bg-neutral-50 flex flex-col"
      style={{
        // Extend background color into the top safe-area (status bar region)
        paddingTop: 'env(safe-area-inset-top)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      <main
        className="flex-1 max-w-2xl w-full mx-auto w-full"
        style={{
          // On sub-pages (JobDetail) the page manages its own bottom spacing.
          // On tab pages, pad enough to clear the fixed nav + home indicator.
          paddingBottom: isSubPage
            ? 0
            : `calc(${NAV_CONTENT_HEIGHT}px + env(safe-area-inset-bottom))`,
        }}
      >
        <Outlet />
      </main>

      {!isSubPage && (
        <nav
          className="fixed bottom-0 left-0 right-0 bg-white border-t border-neutral-200 z-50"
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
                className={({ isActive }) =>
                  `flex-1 flex flex-col items-center gap-1 py-3 transition-colors ${isActive ? 'text-blue-600' : 'text-neutral-400'}`
                }
              >
                <Icon size={22} strokeWidth={2} />
                <span className="text-xs font-medium">{label}</span>
              </NavLink>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}