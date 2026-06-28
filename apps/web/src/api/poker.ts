import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PokerSessionDto, PokerItemDto } from '@next-lane/shared';
import { request } from './client';
import { qk } from './keys';
import { getSocket } from './socket';

// ── Poker socket event names ──────────────────────────────────────────────────

const POKER_EVENTS = [
  'poker.vote.cast',
  'poker.item.revealed',
  'poker.session.updated',
  'poker.item.added',
  'poker.item.removed',
  'poker.estimate.committed',
] as const;

type PokerSocketEvent = (typeof POKER_EVENTS)[number];

// ── Queries ───────────────────────────────────────────────────────────────────

/** List all poker sessions for a project. */
export function usePokerSessions(projectId: string | undefined) {
  return useQuery({
    queryKey: qk.pokerSessions(projectId ?? ''),
    enabled: !!projectId,
    queryFn: () =>
      request<PokerSessionDto[]>(`/projects/${projectId}/poker-sessions`),
  });
}

/** Fetch a single session (with items + votes). */
export function usePokerSession(sessionId: string | undefined) {
  return useQuery({
    queryKey: qk.pokerSession(sessionId ?? ''),
    enabled: !!sessionId,
    queryFn: () => request<PokerSessionDto>(`/poker-sessions/${sessionId}`),
  });
}

/**
 * Subscribe to realtime poker events for the currently open session.
 * On any poker.* event matching this session, we invalidate the session query
 * so the UI gets fresh data. We also re-subscribe when the socket reconnects.
 */
export function usePokerRealtime(
  projectId: string | undefined,
  sessionId: string | undefined,
): void {
  const qc = useQueryClient();
  // Keep stable reference to avoid stale closure over sessionId.
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  useEffect(() => {
    if (!projectId || !sessionId) return;
    const s = getSocket();

    const emitSubscribe = () => s.emit('subscribe', projectId);
    if (s.connected) emitSubscribe();
    s.on('connect', emitSubscribe);

    const handlers: Array<{ event: PokerSocketEvent; fn: (payload: unknown) => void }> =
      POKER_EVENTS.map((event) => {
        const fn = (payload: unknown) => {
          // Only react if the event belongs to our session.
          const eventSessionId = (payload as { sessionId?: string } | null)
            ?.sessionId;
          if (eventSessionId && eventSessionId !== sessionIdRef.current) return;
          void qc.invalidateQueries({
            queryKey: qk.pokerSession(sessionIdRef.current ?? ''),
          });
        };
        s.on(event, fn);
        return { event, fn };
      });

    return () => {
      s.off('connect', emitSubscribe);
      handlers.forEach(({ event, fn }) => s.off(event, fn));
    };
  }, [projectId, sessionId, qc]);
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export interface CreatePokerSessionInput {
  name?: string;
  sprintId?: string;
  issueIds: string[];
}

export function useCreatePokerSession(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePokerSessionInput) =>
      request<PokerSessionDto>(`/projects/${projectId}/poker-sessions`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.pokerSessions(projectId) });
    },
  });
}

export interface UpdatePokerSessionInput {
  name?: string;
  state?: string;
  activeItemId?: string | null;
}

export function useUpdatePokerSession(sessionId: string, projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdatePokerSessionInput) =>
      request<PokerSessionDto>(`/poker-sessions/${sessionId}`, {
        method: 'PATCH',
        body: patch,
      }),
    onSuccess: (updated) => {
      qc.setQueryData<PokerSessionDto>(qk.pokerSession(sessionId), (prev) =>
        prev ? { ...prev, ...updated } : updated,
      );
      void qc.invalidateQueries({ queryKey: qk.pokerSessions(projectId) });
    },
  });
}

export function useAddPokerItem(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (issueId: string) =>
      request<PokerItemDto>(`/poker-sessions/${sessionId}/items`, {
        method: 'POST',
        body: { issueId },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.pokerSession(sessionId) });
    },
  });
}

export function useRemovePokerItem(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) =>
      request<void>(`/poker-items/${itemId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.pokerSession(sessionId) });
    },
  });
}

export function useCastVote(itemId: string, sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (value: string) =>
      request<void>(`/poker-items/${itemId}/vote`, {
        method: 'POST',
        body: { value },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.pokerSession(sessionId) });
    },
  });
}

export function useRevealItem(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) =>
      request<PokerItemDto>(`/poker-items/${itemId}/reveal`, { method: 'POST' }),
    onSuccess: (updated) => {
      qc.setQueryData<PokerSessionDto>(qk.pokerSession(sessionId), (prev) => {
        if (!prev?.items) return prev;
        return {
          ...prev,
          items: prev.items.map((i) => (i.id === updated.id ? updated : i)),
        };
      });
      void qc.invalidateQueries({ queryKey: qk.pokerSession(sessionId) });
    },
  });
}

export function useCommitEstimate(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      itemId,
      finalEstimate,
    }: {
      itemId: string;
      finalEstimate: number;
    }) =>
      request<PokerItemDto>(`/poker-items/${itemId}/commit`, {
        method: 'POST',
        body: { finalEstimate },
      }),
    onSuccess: (updated) => {
      qc.setQueryData<PokerSessionDto>(qk.pokerSession(sessionId), (prev) => {
        if (!prev?.items) return prev;
        return {
          ...prev,
          items: prev.items.map((i) => (i.id === updated.id ? updated : i)),
        };
      });
      void qc.invalidateQueries({ queryKey: qk.pokerSession(sessionId) });
    },
  });
}
