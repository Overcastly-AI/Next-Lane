import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  NotificationListDto,
  UnreadCountDto,
} from '@next-lane/shared';
import { request } from './client';
import { qk } from './keys';

/** The current user's recent notifications (newest first) + unread count. */
export function useNotifications() {
  return useQuery<NotificationListDto, Error>({
    queryKey: qk.notifications,
    queryFn: ({ signal }) =>
      request<NotificationListDto>('/notifications', { signal }),
    // Poll as a fallback for the realtime push (covers reconnects / missed events).
    refetchInterval: 60_000,
  });
}

/** Lightweight unread count for the bell badge (cheaper than the full list). */
export function useUnreadCount() {
  return useQuery<UnreadCountDto, Error>({
    queryKey: qk.unreadCount,
    queryFn: ({ signal }) =>
      request<UnreadCountDto>('/notifications/unread-count', { signal }),
    refetchInterval: 60_000,
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<{ id: string }>(`/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.notifications });
      void qc.invalidateQueries({ queryKey: qk.unreadCount });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      request<{ count: number }>('/notifications/read-all', { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.notifications });
      void qc.invalidateQueries({ queryKey: qk.unreadCount });
    },
  });
}
