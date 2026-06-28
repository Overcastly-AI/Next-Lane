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
        className="relative rounded p-2 text-ink-500 transition-colors duration-[120ms] hover:bg-ink-100 hover:text-ink-700"
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
            className="absolute right-0 z-20 mt-2 flex max-h-[28rem] w-80 flex-col overflow-hidden rounded-xl border border-ink-100 bg-white shadow-dropdown sm:w-96"
          >
            <div className="flex items-center justify-between border-b border-ink-100 px-3 py-2">
              <p className="font-display text-sm font-semibold text-ink-900">Notifications</p>
              {unread > 0 && (
                <button
                  type="button"
                  onClick={() => markAll.mutate()}
                  disabled={markAll.isPending}
                  className="text-xs font-medium text-signal-700 hover:text-signal-800 disabled:opacity-50 transition-colors duration-[120ms]"
                >
                  Mark all read
                </button>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {isLoading && (
                <p className="px-3 py-6 text-center text-sm text-ink-500">
                  Loading…
                </p>
              )}
              {isError && (
                <p className="px-3 py-6 text-center text-sm text-red-600">
                  Couldn't load notifications.
                </p>
              )}
              {!isLoading && !isError && items.length === 0 && (
                <div
                  data-testid="notifications-empty"
                  className="flex flex-col items-center gap-2 px-3 py-8 text-center"
                >
                  <svg
                    className="h-8 w-8 text-ink-200"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"
                    />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.7 21a2 2 0 0 1-3.4 0" />
                  </svg>
                  <p className="text-sm font-medium text-ink-500">
                    You&rsquo;re all caught up
                  </p>
                  <p className="text-xs text-ink-400">
                    Notifications appear here when you&rsquo;re assigned to an
                    issue or someone mentions you.
                  </p>
                </div>
              )}
              <ul>
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => onOpenItem(n)}
                      className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors duration-[120ms] hover:bg-ink-50 ${
                        n.read ? '' : 'bg-signal-50/60'
                      }`}
                    >
                      <Avatar user={n.actor} size="sm" className="mt-0.5" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-ink-900">
                          {n.message}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-500">
                          <span className="rounded-sm bg-ink-100 px-1 py-px font-mono font-medium text-ink-600">
                            {n.issueKey}
                          </span>
                          <span>{TYPE_LABEL[n.type]}</span>
                          <span aria-hidden="true">·</span>
                          <span>{relativeTime(n.createdAt)}</span>
                        </span>
                      </span>
                      {!n.read && (
                        <span
                          className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-signal-500"
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
