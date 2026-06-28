/**
 * Notifications center — full history page at /notifications.
 *
 * The API returns the most recent 50 notifications (server-side cap, no
 * pagination param available). Client-side type filtering is applied over
 * this loaded set. True pagination is a backend follow-up item.
 *
 * Design: Dispatch system — ink neutrals, signal accent, IBM Plex Sans/Mono,
 * Space Grotesk display headings. Accessible list semantics, visible focus
 * rings, responsive at all viewport widths.
 */
import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { NotificationType, type NotificationDto } from '@next-lane/shared';
import { AppHeader } from '@/components/AppHeader';
import { Avatar } from '@/components/ui/Avatar';
import { EmptyState, ErrorState } from '@/components/ui/States';
import {
  useNotifications,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
} from '@/api/notifications';
import { relativeTime } from '@/lib/relativeTime';
import { cn } from '@/lib/cn';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FilterType = 'ALL' | NotificationType;

interface FilterOption {
  value: FilterType;
  label: string;
  testId: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FILTER_OPTIONS: FilterOption[] = [
  { value: 'ALL',                            label: 'All',       testId: 'notification-filter-all' },
  { value: NotificationType.ASSIGNED,        label: 'Assigned',  testId: 'notification-filter-assigned' },
  { value: NotificationType.MENTIONED,       label: 'Mentioned', testId: 'notification-filter-mentioned' },
  { value: NotificationType.COMMENTED,       label: 'Commented', testId: 'notification-filter-commented' },
  { value: NotificationType.WATCHED_UPDATED, label: 'Watching',  testId: 'notification-filter-watching' },
];

const TYPE_LABEL: Record<NotificationType, string> = {
  [NotificationType.ASSIGNED]:        'Assigned',
  [NotificationType.MENTIONED]:       'Mentioned',
  [NotificationType.COMMENTED]:       'Comment',
  [NotificationType.WATCHED_UPDATED]: 'Update',
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Per-type icon. Each is a 16×16 svg aria-hidden. */
function NotificationTypeIcon({ type }: { type: NotificationType }) {
  switch (type) {
    case NotificationType.ASSIGNED:
      return (
        <svg
          className="h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case NotificationType.MENTIONED:
      return (
        <svg
          className="h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="4" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94" />
        </svg>
      );
    case NotificationType.COMMENTED:
      return (
        <svg
          className="h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      );
    case NotificationType.WATCHED_UPDATED:
      return (
        <svg
          className="h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
  }
}

const TYPE_ICON_COLOR: Record<NotificationType, string> = {
  [NotificationType.ASSIGNED]:        'text-signal-600 bg-signal-50',
  [NotificationType.MENTIONED]:       'text-amber-600 bg-amber-50',
  [NotificationType.COMMENTED]:       'text-emerald-600 bg-emerald-50',
  [NotificationType.WATCHED_UPDATED]: 'text-ink-500 bg-ink-100',
};

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function NotificationSkeleton() {
  return (
    <li className="flex items-start gap-3 border-b border-ink-100 px-4 py-3.5 last:border-0 sm:px-6">
      {/* avatar placeholder */}
      <div className="mt-0.5 h-7 w-7 shrink-0 animate-pulse rounded-full bg-ink-100" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="h-3.5 w-3/4 animate-pulse rounded bg-ink-100" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-ink-100" />
      </div>
      {/* type badge placeholder */}
      <div className="h-5 w-16 shrink-0 animate-pulse rounded-full bg-ink-100" />
    </li>
  );
}

// ---------------------------------------------------------------------------
// Single notification row
// ---------------------------------------------------------------------------

interface RowProps {
  notification: NotificationDto;
  onAction: (n: NotificationDto) => void;
}

function NotificationRow({ notification: n, onAction }: RowProps) {
  return (
    <li data-testid="notification-row">
      <button
        type="button"
        onClick={() => onAction(n)}
        className={cn(
          'group flex w-full items-start gap-3 border-b border-ink-100 px-4 py-3.5 text-left outline-none last:border-0',
          'transition-colors duration-[120ms] hover:bg-ink-50',
          'focus-visible:bg-ink-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal-500',
          n.read ? 'bg-white' : 'bg-signal-50/50',
        )}
        aria-label={`${n.message}${n.read ? '' : ' (unread)'}`}
      >
        {/* Actor avatar */}
        <Avatar user={n.actor} size="sm" className="mt-0.5 shrink-0" />

        {/* Main content */}
        <span className="min-w-0 flex-1">
          <span className="block text-sm leading-snug text-ink-900">
            {n.message}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-500">
            {n.issueKey && (
              <span className="rounded-sm bg-ink-100 px-1.5 py-px font-mono font-medium text-ink-700">
                {n.issueKey}
              </span>
            )}
            <span aria-hidden="true">·</span>
            <time dateTime={n.createdAt}>{relativeTime(n.createdAt)}</time>
          </span>
        </span>

        {/* Type badge */}
        <span
          className={cn(
            'mt-0.5 flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
            TYPE_ICON_COLOR[n.type],
          )}
        >
          <NotificationTypeIcon type={n.type} />
          <span className="hidden sm:inline">{TYPE_LABEL[n.type]}</span>
        </span>

        {/* Unread dot */}
        {!n.read && (
          <span
            className="mt-2 h-2 w-2 shrink-0 rounded-full bg-signal-500"
            aria-label="unread"
          />
        )}
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Filter pills
// ---------------------------------------------------------------------------

interface FilterPillsProps {
  active: FilterType;
  onChange: (v: FilterType) => void;
  counts: Record<FilterType, number>;
}

function FilterPills({ active, onChange, counts }: FilterPillsProps) {
  return (
    <div
      role="group"
      aria-label="Filter notifications by type"
      data-testid="notification-filter"
      className="flex flex-wrap gap-1.5"
    >
      {FILTER_OPTIONS.map((opt) => {
        const isActive = active === opt.value;
        const count = counts[opt.value];
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            data-testid={opt.testId}
            onClick={() => onChange(opt.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-[120ms]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1',
              isActive
                ? 'border-signal-600 bg-signal-600 text-white shadow-sm'
                : 'border-ink-200 bg-white text-ink-600 hover:border-ink-300 hover:bg-ink-50 hover:text-ink-900',
            )}
          >
            {opt.label}
            {count > 0 && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-px text-[10px] font-semibold leading-none',
                  isActive ? 'bg-white/25 text-white' : 'bg-ink-100 text-ink-600',
                )}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------------

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col overflow-x-clip bg-ink-50">
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
        {children}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function NotificationsPage() {
  const navigate = useNavigate();
  const [activeFilter, setActiveFilter] = useState<FilterType>('ALL');

  const { data, isLoading, isError, error, refetch } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const items = data?.items ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  // Client-side filter over the loaded set.
  const filtered = activeFilter === 'ALL'
    ? items
    : items.filter((n) => n.type === activeFilter);

  // Per-filter counts (excluding 'ALL' from the loop, computed separately).
  const counts: Record<FilterType, number> = {
    ALL:                              items.length,
    [NotificationType.ASSIGNED]:        items.filter((n) => n.type === NotificationType.ASSIGNED).length,
    [NotificationType.MENTIONED]:       items.filter((n) => n.type === NotificationType.MENTIONED).length,
    [NotificationType.COMMENTED]:       items.filter((n) => n.type === NotificationType.COMMENTED).length,
    [NotificationType.WATCHED_UPDATED]: items.filter((n) => n.type === NotificationType.WATCHED_UPDATED).length,
  };

  const onOpenItem = useCallback(
    (n: NotificationDto) => {
      if (!n.read) markRead.mutate(n.id);
      if (n.issueId && n.projectId) {
        navigate(`/projects/${n.projectId}/board?issue=${n.issueId}`);
      }
    },
    [markRead, navigate],
  );

  const onMarkAll = () => {
    if (markAll.isPending) return;
    markAll.mutate();
  };

  return (
    <Shell>
      <div data-testid="notifications-page">
        {/* Page header */}
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-semibold text-ink-900">
              Notifications
            </h1>
            {!isLoading && unreadCount > 0 && (
              <p className="mt-1 text-sm text-ink-500">
                {unreadCount} unread{' '}
                <span aria-hidden="true">·</span>{' '}
                {items.length} total (last 50)
              </p>
            )}
            {!isLoading && unreadCount === 0 && items.length > 0 && (
              <p className="mt-1 text-sm text-ink-500">
                {items.length} notification{items.length !== 1 ? 's' : ''} (last 50)
              </p>
            )}
          </div>

          {unreadCount > 0 && !isLoading && (
            <button
              type="button"
              data-testid="notifications-mark-all-read"
              onClick={onMarkAll}
              disabled={markAll.isPending}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm font-medium text-ink-700',
                'shadow-xs transition-colors duration-[120ms]',
                'hover:border-ink-300 hover:bg-ink-50 hover:text-ink-900',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M20 6L9 17l-5-5" />
              </svg>
              Mark all read
            </button>
          )}
        </div>

        {/* Filter row */}
        {!isLoading && !isError && items.length > 0 && (
          <div className="mb-4">
            <FilterPills
              active={activeFilter}
              onChange={setActiveFilter}
              counts={counts}
            />
          </div>
        )}

        {/* Loading skeletons */}
        {isLoading && (
          <div className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-xs">
            <ul aria-label="Loading notifications" aria-busy="true">
              {Array.from({ length: 6 }).map((_, i) => (
                <NotificationSkeleton key={i} />
              ))}
            </ul>
          </div>
        )}

        {/* Error state */}
        {isError && !isLoading && (
          <div className="rounded-xl border border-ink-200 bg-white shadow-xs">
            <ErrorState error={error} onRetry={() => refetch()} />
          </div>
        )}

        {/* Empty: no notifications at all */}
        {!isLoading && !isError && items.length === 0 && (
          <EmptyState
            title="You're all caught up"
            description="Notifications appear here when you're assigned to an issue, mentioned in a comment, or a watched issue is updated."
            icon={
              <svg
                className="h-10 w-10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.7 21a2 2 0 0 1-3.4 0" />
              </svg>
            }
          />
        )}

        {/* Empty: filter has no matches */}
        {!isLoading && !isError && items.length > 0 && filtered.length === 0 && (
          <EmptyState
            title="No notifications in this category"
            description="Try a different filter to see your other notifications."
          />
        )}

        {/* Notification list */}
        {!isLoading && !isError && filtered.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-xs">
            <ul aria-label="Notifications" role="list">
              {filtered.map((n) => (
                <NotificationRow
                  key={n.id}
                  notification={n}
                  onAction={onOpenItem}
                />
              ))}
            </ul>

            {/* Footer note about the 50-item cap */}
            <p className="border-t border-ink-100 px-4 py-2.5 text-center text-xs text-ink-400 sm:px-6">
              Showing up to 50 most recent notifications.
              Older history and pagination require a backend update.
            </p>
          </div>
        )}
      </div>
    </Shell>
  );
}
