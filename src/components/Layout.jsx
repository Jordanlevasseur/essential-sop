import React from 'react';
import { NavLink, useLocation, Outlet } from 'react-router-dom';
import { Briefcase, MessageSquare, User } from 'lucide-react';

const TABS = [
  { to: '/', label: 'Jobs', icon: Briefcase, end: true },
  { to: '/assistant', label: 'Assistant', icon: MessageSquare },
  { to: '/profile', label: 'Profile', icon: User },
];

export default function Layout() {
  const location = useLocation();
  const isSubPage = location.pathname.includes('/jobs/') && location.pathname !== '/';

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col">
      <main className={`flex-1 ${isSubPage ? 'pb-0' : 'pb-20'} max-w-2xl w-full mx-auto`}>
        <Outlet />
      </main>
      {!isSubPage && (
        <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-neutral-200 z-50">
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