import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useCompany } from '@/lib/CompanyContext';
import { ArrowLeft, Bell, CheckCheck } from 'lucide-react';

export default function Notifications() {
  const navigate = useNavigate();
  const { activeCompany, activeMembership } = useCompany();
  const companyId = activeCompany?.id;
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!companyId || !activeMembership?.userId) return;
    loadNotifications();
  }, [companyId, activeMembership]);

  const loadNotifications = async () => {
    const user = await base44.auth.me();
    if (!user) return;
    const data = await base44.entities.Notification.filter({ companyId, userId: user.id }, '-created_date', 50);
    setNotifications(data || []);
    setLoading(false);
  };

  const markRead = async (id) => {
    await base44.entities.Notification.update(id, { isRead: true, readAt: new Date().toISOString() });
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
  };

  const markAllRead = async () => {
    const unread = notifications.filter(n => !n.isRead);
    await Promise.all(unread.map(n => base44.entities.Notification.update(n.id, { isRead: true, readAt: new Date().toISOString() })));
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
  };

  const unreadCount = notifications.filter(n => !n.isRead).length;

  return (
    <div className="min-h-screen bg-app-bg">
      <div className="bg-app-surface border-b border-app-border sticky top-0 z-40" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="icon-btn touch-active"><ArrowLeft size={22} className="text-app-text-2" /></button>
          <h1 className="font-semibold text-app-text flex-1">Notifications</h1>
          {unreadCount > 0 && (
            <button onClick={markAllRead} className="flex items-center gap-1 text-xs text-app-accent touch-active">
              <CheckCheck size={14} /> Mark all read
            </button>
          )}
        </div>
      </div>

      <div className="px-4 pt-4 pb-4 max-w-2xl mx-auto">
        {loading ? (
          <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-app-border border-t-app-accent rounded-full animate-spin" /></div>
        ) : notifications.length === 0 ? (
          <div className="text-center py-16">
            <Bell size={32} className="text-app-text-disabled mx-auto mb-3" />
            <p className="text-sm text-app-text-muted">No notifications yet.</p>
          </div>
        ) : (
          <div className="space-y-1">
            {notifications.map(n => (
              <div key={n.id} onClick={() => !n.isRead && markRead(n.id)}
                className={`flex gap-3 px-4 py-3 rounded-xl cursor-pointer touch-active ${n.isRead ? 'bg-app-card border border-app-border' : 'bg-app-info-bg border border-app-info/30'}`}>
                <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${n.isRead ? 'bg-transparent' : 'bg-app-accent'}`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm ${n.isRead ? 'text-app-text-2' : 'font-semibold text-app-text'}`}>{n.title}</p>
                  <p className="text-xs text-app-text-muted mt-0.5">{n.body}</p>
                  <p className="text-xs text-app-text-disabled mt-1">{new Date(n.created_date || n.createdAt).toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ height: 'calc(16px + env(safe-area-inset-bottom))' }} />
    </div>
  );
}