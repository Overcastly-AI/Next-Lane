import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NotificationType, type NotificationDto } from '@next-lane/shared';
import { Avatar } from './ui/Avatar';
import { relativeTime } from '@/lib/relativeTime';
import {
  useNotifications,
  useUnreadCount,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
} from '@/api/notifications';
import { useNotificationsRealtime } from '@/api/socket';
import { useAuth } from '@/auth/AuthContext';

const TYPE_LABEL: Record<NotificationType, string> = {
  [NotificationType.ASSIGNED]: 'Assigned',
  [NotificationType.MENTIONED]: 'Mentioned',
  [NotificationType.COMMENTED]: 'Comment',
  [NotificationType.WATCHED_UPDATED]: 'Update',
};

export function NotificationBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  // Live updates + polling fallback.
  useNotificationsRealtime(Boolean(user));
  const { data: count } = useUnreadCount();
  const { data: list, isLoading, isError } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const unread = count?.count ?? 0;
  const items = list?.items ?? [];

  const onOpenItem = (n: NotificationDto) => {
    if (!n.read) markRead.mutate(n.id);
    setOpen(false);
    if (n.issueId) {
      navigate(`/projects/${n.projectId}/board?issue=${n.issueId}`);
    }
  };

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={
          unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'
        }
        aria-haspopup="menu"
        aria-expanded={open}
        className="relative rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
      >
        <svg
          className="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"
          />
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 && (
          <span
            data-testid="notification-badge"
            className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            role="menu"
            aria-label="Notifications"
            className="absolute right-0 z-20 mt-2 flex max-h-[28rem] w-80 flex-col overflow-hidden rounded-xl border border-gray-100 bg-white shadow-lg sm:w-96"
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
              <p className="text-sm font-semibold text-gray-900">Notifications</p>
              {unread > 0 && (
                <button
                  type="button"
                  onClick={() => markAll.mutate()}
                  disabled={markAll.isPending}
                  className="text-xs font-medium text-brand-700 hover:text-brand-800 disabled:opacity-50"
                >
                  Mark all read
                </button>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {isLoading && (
                <p className="px-3 py-6 text-center text-sm text-gray-500">
                  Loading…
                </p>
              )}
              {isError && (
                <p className="px-3 py-6 text-center text-sm text-red-600">
                  Couldn't load notifications.
                </p>
              )}
              {!isLoading && !isError && items.length === 0 && (
                <p className="px-3 py-8 text-center text-sm text-gray-500">
                  You're all caught up.
                </p>
              )}
              <ul>
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => onOpenItem(n)}
                      className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-gray-50 ${
                        n.read ? '' : 'bg-brand-50/60'
                      }`}
                    >
                      <Avatar user={n.actor} size="sm" className="mt-0.5" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-gray-900">
                          {n.message}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-500">
                          <span className="rounded bg-gray-100 px-1 py-px font-medium text-gray-600">
                            {n.issueKey}
                          </span>
                          <span>{TYPE_LABEL[n.type]}</span>
                          <span aria-hidden="true">·</span>
                          <span>{relativeTime(n.createdAt)}</span>
                        </span>
                      </span>
                      {!n.read && (
                        <span
                          className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500"
                          aria-label="unread"
                        />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
