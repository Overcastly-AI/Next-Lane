import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { SocketEvents, type SocketEvent } from '@next-lane/shared';
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

const ALL_EVENTS: SocketEvent[] = Object.values(SocketEvents);

/**
 * Subscribe to a project's realtime room. On any board-affecting event we
 * invalidate the board query so the cache re-syncs, then forward the event to
 * an optional caller-supplied handler (e.g. to refresh an open issue/comments).
 */
export function useBoardRealtime(
  projectId: string | undefined,
  onEvent?: RealtimeHandler,
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
        handlerRef.current?.(event, payload);
      };
      s.on(event, fn);
      return { event, fn };
    });

    return () => {
      s.off('connect', emitSubscribe);
      listeners.forEach(({ event, fn }) => s.off(event, fn));
    };
  }, [projectId, qc]);
}
