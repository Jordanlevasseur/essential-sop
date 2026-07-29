import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useCompany } from '@/lib/CompanyContext';

export default function NotificationBell() {
  const navigate = useNavigate();
  const { activeCompany, activeMembership } = useCompany();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!activeCompany?.id) return;
    const load = async () => {
      const user = await base44.auth.me().catch(() => null);
      if (!user) return;
      const data = await base44.entities.Notification.filter({ companyId: activeCompany.id, userId: user.id, isRead: false }).catch(() => []);
      setUnread((data || []).length);
    };
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [activeCompany?.id]);

  return (
    <button onClick={() => navigate('/notifications')} className="icon-btn relative touch-active no-select" aria-label="Notifications">
      <Bell size={20} className="text-app-text-2" />
      {unread > 0 && (
        <span className="absolute top-1 right-1 w-4 h-4 bg-app-danger text-white text-[10px] font-bold rounded-full flex items-center justify-center">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </button>
  );
}