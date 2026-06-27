import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { SocketEvents, type SocketEvent, type PresenceViewer } from '@next-lane/shared';
import { API_URL, getToken } from './client';
import { qk } from './keys';

let socket: Socket | null = null;

/** Lazily create a single shared socket connection to the API origin. */
export function getSocket(): Socket {
  if (!socket) {
    socket = io(API_URL, {
      transports: ['websocket'],
      autoConnect: true,
      auth: { token: getToken() },
    });
  }
  return socket;
}

export type RealtimeHandler = (event: SocketEvent, payload: unknown) => void;

/**
 * Subscribe to the current user's PRIVATE notification feed. The socket joins
 * its own `user:<id>` room (authorized server-side from the JWT, never a
 * client-supplied id) and, on each `notification.created` push, invalidates the
 * notification list + unread-count queries so the bell updates live.
 */
export function useNotificationsRealtime(enabled: boolean): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    const s = getSocket();

    const emitSubscribe = () => s.emit('subscribe:user');
    if (s.connected) emitSubscribe();
    s.on('connect', emitSubscribe);

    const onNotification = () => {
      void qc.invalidateQueries({ queryKey: qk.notifications });
      void qc.invalidateQueries({ queryKey: qk.unreadCount });
    };
    s.on(SocketEvents.NotificationCreated, onNotification);

    return () => {
      s.off('connect', emitSubscribe);
      s.off(SocketEvents.NotificationCreated, onNotification);
    };
  }, [enabled, qc]);
}

const ALL_EVENTS: SocketEvent[] = Object.values(SocketEvents);

/**
 * Subscribe to a project's realtime room. On any board-affecting event we
 * invalidate the board query so the cache re-syncs, then forward the event to
 * an optional caller-supplied handler (e.g. to refresh an open issue/comments).
 *
 * Pass `boardId` to also invalidate the board-view cache (keyed by the specific
 * board id) so the multi-board page stays in sync with realtime events.
 */
export function useBoardRealtime(
  projectId: string | undefined,
  onEvent?: RealtimeHandler,
  boardId?: string,
): void {
  const qc = useQueryClient();
  const handlerRef = useRef<RealtimeHandler | undefined>(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!projectId) return;
    const s = getSocket();

    const emitSubscribe = () => s.emit('subscribe', projectId);
    if (s.connected) emitSubscribe();
    s.on('connect', emitSubscribe);

    const listeners = ALL_EVENTS.map((event) => {
      const fn = (payload: unknown) => {
        void qc.invalidateQueries({ queryKey: qk.board(projectId) });
        if (boardId) {
          void qc.invalidateQueries({ queryKey: qk.boardView(boardId) });
        }
        if (event === SocketEvents.CommentCreated) {
          const issueId = (payload as { issueId?: string } | null)?.issueId;
          if (issueId) {
            void qc.invalidateQueries({ queryKey: qk.comments(issueId) });
            void qc.invalidateQueries({ queryKey: qk.activity(issueId) });
          }
        }
        if (
          event === SocketEvents.IssueUpdated ||
          event === SocketEvents.IssueMoved
        ) {
          const id = (payload as { id?: string } | null)?.id;
          if (id) {
            void qc.invalidateQueries({ queryKey: qk.issue(id) });
            void qc.invalidateQueries({ queryKey: qk.activity(id) });
          }
        }
        if (event === SocketEvents.SprintUpdated) {
          // A sprint start/complete reshuffles which issues are on the board
          // (active sprint) vs. the backlog, so refresh both views.
          void qc.invalidateQueries({ queryKey: qk.sprints(projectId) });
        }
        handlerRef.current?.(event, payload);
      };
      s.on(event, fn);
      return { event, fn };
    });

    return () => {
      s.off('connect', emitSubscribe);
      listeners.forEach(({ event, fn }) => s.off(event, fn));
    };
  }, [projectId, boardId, qc]);
}

/**
 * Subscribe to `presence.update` events for a project board and return the
 * current list of viewers. Self is excluded from the returned list using the
 * caller-supplied `selfUserId`.
 *
 * The hook also emits `unsubscribe` on unmount so the gateway can eagerly evict
 * this socket from the presence set without waiting for a disconnect event
 * (which only fires when the whole socket closes, not when the component
 * navigates away).
 */
export function usePresence(
  projectId: string | undefined,
  selfUserId: string | undefined,
): PresenceViewer[] {
  const [viewers, setViewers] = useState<PresenceViewer[]>([]);

  useEffect(() => {
    if (!projectId) {
      setViewers([]);
      return;
    }
    const s = getSocket();

    const onPresenceUpdate = (payload: { projectId: string; viewers: PresenceViewer[] }) => {
      if (payload.projectId !== projectId) return;
      // Deduplicate and exclude self.
      const unique = new Map<string, PresenceViewer>();
      for (const v of payload.viewers) {
        if (v.userId !== selfUserId) {
          unique.set(v.userId, v);
        }
      }
      setViewers(Array.from(unique.values()));
    };

    s.on(SocketEvents.PresenceUpdate, onPresenceUpdate);

    return () => {
      s.off(SocketEvents.PresenceUpdate, onPresenceUpdate);
      // Eagerly leave presence when navigating away from the board.
      if (s.connected) {
        s.emit('unsubscribe', projectId);
      }
      setViewers([]);
    };
  }, [projectId, selfUserId]);

  return viewers;
}
