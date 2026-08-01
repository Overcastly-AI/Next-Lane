import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from './client';
import { qk } from './keys';
import type {
  ShareTokenDto,
  CreateShareTokenResponse,
  PublicBoardDto,
  DashboardShareTokenDto,
  CreateDashboardShareTokenResponse,
  PublicDashboardDto,
} from '@next-lane/shared';
import { getApiUrl } from './config';

// ── ADMIN: share-token management ────────────────────────────────────────────

export function useShareTokens(projectId: string) {
  return useQuery<ShareTokenDto[]>({
    queryKey: ['share-tokens', projectId],
    // `signal` matters here, and not only as good hygiene. Creating a token
    // invalidates this query, and if the on-mount GET is still in flight the
    // two responses can land out of order — the stale `[]` arriving last and
    // overwriting the fresh list, permanently, with no further refetch to
    // correct it. React Query aborts the superseded fetch, but only reaches
    // the actual `fetch()` if the signal is threaded through. Reproduced
    // deterministically by holding the first response back.
    queryFn: ({ signal }) =>
      request(`/projects/${projectId}/share-tokens`, { signal }),
    enabled: !!projectId,
  });
}

/**
 * Invalidate the token list so it reflects a write that just landed.
 *
 * `cancelQueries` first, and it is not defensive noise. A plain
 * `invalidateQueries` is absorbed by a list fetch that is ALREADY in flight:
 * React Query does not start a second one, so the response that eventually
 * arrives is the one issued *before* the write — and it becomes the final
 * state, with nothing scheduled to correct it. Click "+ Create link" quickly
 * enough after opening Project Settings and you get the new-token banner above
 * a list that reads "No share links yet", permanently, until you reload.
 *
 * That is exactly how `share-link.spec.ts:178` failed under parallel load, and
 * it reproduces deterministically by holding the on-mount GET back until after
 * the POST. Cancelling first aborts the stale read (which is why the queries
 * above thread `signal`) and lets the invalidation issue a genuinely new one.
 */
async function refreshTokens(
  qc: ReturnType<typeof useQueryClient>,
  projectId: string,
): Promise<void> {
  const queryKey = ['share-tokens', projectId];
  await qc.cancelQueries({ queryKey });
  await qc.invalidateQueries({ queryKey });
}

export function useCreateShareToken(projectId: string) {
  const qc = useQueryClient();
  return useMutation<CreateShareTokenResponse>({
    mutationFn: () =>
      request(`/projects/${projectId}/share-tokens`, { method: 'POST' }),
    onSuccess: () => {
      void refreshTokens(qc, projectId);
    },
  });
}

export function useRevokeShareToken(projectId: string) {
  const qc = useQueryClient();
  return useMutation<ShareTokenDto, Error, string>({
    mutationFn: (tokenId) =>
      request(`/projects/${projectId}/share-tokens/${tokenId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void refreshTokens(qc, projectId);
    },
  });
}

// ── Public (unauthenticated): board snapshot ─────────────────────────────────

/**
 * Fetch the public board snapshot for a share token.
 * Uses a plain fetch (no auth header) so it works for unauthenticated visitors.
 */
async function fetchPublicBoard(rawToken: string): Promise<PublicBoardDto> {
  const apiUrl = getApiUrl();
  const res = await fetch(`${apiUrl}/api/public/board/${rawToken}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let message = `Request failed (${res.status})`;
    try {
      const data = JSON.parse(text) as { message?: string | string[] };
      if (Array.isArray(data.message)) message = data.message.join(', ');
      else if (typeof data.message === 'string') message = data.message;
    } catch {
      // ignore parse errors
    }
    throw new Error(message);
  }
  return res.json() as Promise<PublicBoardDto>;
}

export function usePublicBoard(rawToken: string) {
  return useQuery<PublicBoardDto, Error>({
    queryKey: ['public-board', rawToken],
    queryFn: () => fetchPublicBoard(rawToken),
    enabled: !!rawToken,
    retry: false, // a 404 (revoked/invalid) should not be retried
  });
}

// ── ADMIN: dashboard share-token management ──────────────────────────────────

export function useDashboardShareTokens(dashboardId: string | undefined) {
  return useQuery<DashboardShareTokenDto[]>({
    queryKey: qk.dashboardShareTokens(dashboardId ?? ''),
    queryFn: () => request(`/dashboards/${dashboardId}/share-tokens`),
    enabled: !!dashboardId,
  });
}

export function useCreateDashboardShareToken(dashboardId: string | undefined) {
  const qc = useQueryClient();
  return useMutation<CreateDashboardShareTokenResponse>({
    mutationFn: () =>
      request(`/dashboards/${dashboardId}/share-tokens`, { method: 'POST' }),
    onSuccess: () => {
      if (dashboardId) {
        void qc.invalidateQueries({ queryKey: qk.dashboardShareTokens(dashboardId) });
      }
    },
  });
}

export function useRevokeDashboardShareToken(dashboardId: string | undefined) {
  const qc = useQueryClient();
  return useMutation<DashboardShareTokenDto, Error, string>({
    mutationFn: (tokenId) =>
      request(`/dashboards/${dashboardId}/share-tokens/${tokenId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      if (dashboardId) {
        void qc.invalidateQueries({ queryKey: qk.dashboardShareTokens(dashboardId) });
      }
    },
  });
}

// ── Public (unauthenticated): dashboard snapshot ─────────────────────────────

/**
 * Fetch the public, fully-evaluated dashboard snapshot for a share token.
 * Uses a plain fetch (no auth header) so it works for unauthenticated visitors.
 */
async function fetchPublicDashboard(rawToken: string): Promise<PublicDashboardDto> {
  const apiUrl = getApiUrl();
  const res = await fetch(`${apiUrl}/api/public/dashboard/${rawToken}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let message = `Request failed (${res.status})`;
    try {
      const data = JSON.parse(text) as { message?: string | string[] };
      if (Array.isArray(data.message)) message = data.message.join(', ');
      else if (typeof data.message === 'string') message = data.message;
    } catch {
      // ignore parse errors
    }
    throw new Error(message);
  }
  return res.json() as Promise<PublicDashboardDto>;
}

export function usePublicDashboard(rawToken: string) {
  return useQuery<PublicDashboardDto, Error>({
    queryKey: ['public-dashboard', rawToken],
    queryFn: () => fetchPublicDashboard(rawToken),
    enabled: !!rawToken,
    retry: false, // a 404 (revoked/invalid) should not be retried
  });
}
