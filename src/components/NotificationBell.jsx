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
      try {
        const res = await base44.functions.invoke('resolveNotifications', { action: 'unread_count', companyId: activeCompany.id });
        setUnread(res.data?.count ?? 0);
      } catch (_) {
        setUnread(0);
      }
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