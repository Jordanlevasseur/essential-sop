import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useCompany } from '@/lib/CompanyContext';
import { ArrowLeft, Bell, CheckCheck, ChevronRight } from 'lucide-react';
import { getNotificationCategory } from '@/lib/roleLabels';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'needs_attention', label: 'Needs Attention' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'team', label: 'Team' },
  { id: 'account', label: 'Account' },
];

// Notification types that are sensitive — only GM and owner see them
const ACCOUNT_RESTRICTED_TYPES = ['subscription_status_changed', 'plan_limit_reached'];

// Map type → route
function resolveDestination(n) {
  if (!n.targetId) return null;
  if (n.targetType === 'job') return `/jobs/${n.targetId}`;
  if (n.targetType === 'edit_request') return '/requests';
  if (n.targetType === 'invitation') return '/accept-invitation';
  if (n.targetType === 'membership') return '/team';
  return null;
}

function relativeTime(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export default function Notifications() {
  const navigate = useNavigate();
  const { activeCompany, activeMembership } = useCompany();
  const companyId = activeCompany?.id;
  const role = activeMembership?.role;
  const isGM = role === 'general_manager';

  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    if (!companyId) return;
    loadNotifications();
  }, [companyId]);

  const loadNotifications = async () => {
    const user = await base44.auth.me().catch(() => null);
    if (!user) return;
    const data = await base44.entities.Notification.filter({ companyId, userId: user.id }, '-created_date', 50);
    // Restrict sensitive account notifications to GM
    const filtered = (data || []).filter(n => {
      if (ACCOUNT_RESTRICTED_TYPES.includes(n.type) && !isGM) return false;
      return true;
    });
    setNotifications(filtered);
    setLoading(false);
  };

  // Optimistic mark-as-read: the unread dot clears instantly, the backend call
  // fires next, and the state rolls back if the call fails. Low-risk, reversible,
  // no data-integrity concern (the only effect is an isRead flag on the user's
  // own notification).
  const markRead = async (id) => {
    const original = notifications.find(n => n.id === id);
    if (!original || original.isRead) return;
    const nowIso = new Date().toISOString();
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true, readAt: nowIso } : n));
    try {
      await base44.entities.Notification.update(id, { isRead: true, readAt: nowIso });
    } catch (_) {
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: original.isRead, readAt: original.readAt } : n));
    }
  };

  const markAllRead = async () => {
    const unread = notifications.filter(n => !n.isRead);
    if (unread.length === 0) return;
    const nowIso = new Date().toISOString();
    // Optimistic: mark everything read immediately.
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true, readAt: n.readAt || nowIso })));
    try {
      await Promise.all(unread.map(n => base44.entities.Notification.update(n.id, { isRead: true, readAt: nowIso })));
    } catch (_) {
      // Partial failure possible — re-read the authoritative state to reconcile.
      loadNotifications();
    }
  };

  const filtered = notifications.filter(n => {
    if (filter === 'all') return true;
    return getNotificationCategory(n.type) === filter;
  });

  const unreadCount = notifications.filter(n => !n.isRead).length;

  return (
    <div className="min-h-screen bg-app-bg">
      <div className="bg-app-surface border-b border-app-border sticky top-0 z-40" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="px-3 py-2.5 flex items-center gap-2.5">
          <button onClick={() => navigate(-1)} className="icon-btn touch-active" aria-label="Back"><ArrowLeft size={22} className="text-app-text-2" /></button>
          <h1 className="font-semibold text-app-text flex-1">Notifications</h1>
          {unreadCount > 0 && (
            <button onClick={markAllRead} className="flex items-center gap-1 text-xs text-app-accent touch-active no-select">
              <CheckCheck size={14} /> Mark all read
            </button>
          )}
        </div>
        {/* Filter tabs */}
        <div className="flex overflow-x-auto scrollbar-hide border-t border-app-divider">
          {FILTERS.map(f => {
            const count = f.id === 'all' ? unreadCount : notifications.filter(n => !n.isRead && getNotificationCategory(n.type) === f.id).length;
            return (
              <button key={f.id} onClick={() => setFilter(f.id)}
                className={`flex-shrink-0 px-4 py-2.5 text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1 ${filter === f.id ? 'text-app-accent border-b-2 border-app-accent' : 'text-app-text-muted'}`}>
                {f.label}
                {count > 0 && (
                  <span className="w-4 h-4 bg-app-accent text-app-accent-text text-[9px] font-bold rounded-full flex items-center justify-center">
                    {count > 9 ? '9+' : count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="px-3 pt-4 pb-3 max-w-2xl mx-auto">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-4 border-app-border border-t-app-accent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <Bell size={32} className="text-app-text-disabled mx-auto mb-3" />
            <p className="text-sm text-app-text-muted">{filter === 'all' ? 'No notifications yet.' : 'No notifications in this category.'}</p>
          </div>
        ) : (
          <div className="space-y-1">
            {filtered.map(n => {
              const dest = resolveDestination(n);
              return (
                <div key={n.id}
                  role={dest ? 'button' : undefined}
                  tabIndex={dest ? 0 : undefined}
                  aria-label={dest ? n.title : undefined}
                  onClick={() => {
                    if (!n.isRead) markRead(n.id);
                    if (dest) navigate(dest);
                  }}
                  onKeyDown={dest ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!n.isRead) markRead(n.id); navigate(dest); } } : undefined}
                  className={`flex items-start gap-3 px-4 py-3 rounded-xl transition-colors ${dest ? 'cursor-pointer touch-active' : ''} ${n.isRead ? 'bg-app-card border border-app-border' : 'bg-app-info-bg border border-app-info/20'}`}>
                  {/* Unread dot */}
                  <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${n.isRead ? 'bg-transparent' : 'bg-app-accent'}`} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm leading-snug ${n.isRead ? 'text-app-text-2' : 'font-semibold text-app-text'}`}>{n.title}</p>
                    <p className="text-xs text-app-text-muted mt-0.5 leading-relaxed">{n.body}</p>
                    <p className="text-xs text-app-text-disabled mt-1">{relativeTime(n.created_date)}</p>
                  </div>
                  {dest && <ChevronRight size={14} className="text-app-text-disabled flex-shrink-0 mt-1" />}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ height: 'calc(16px + env(safe-area-inset-bottom))' }} />
    </div>
  );
}