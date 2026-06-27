import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from './client';
import type {
  ShareTokenDto,
  CreateShareTokenResponse,
  PublicBoardDto,
} from '@next-lane/shared';
import { getApiUrl } from './config';

// ── ADMIN: share-token management ────────────────────────────────────────────

export function useShareTokens(projectId: string) {
  return useQuery<ShareTokenDto[]>({
    queryKey: ['share-tokens', projectId],
    queryFn: () => request(`/projects/${projectId}/share-tokens`),
    enabled: !!projectId,
  });
}

export function useCreateShareToken(projectId: string) {
  const qc = useQueryClient();
  return useMutation<CreateShareTokenResponse>({
    mutationFn: () =>
      request(`/projects/${projectId}/share-tokens`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['share-tokens', projectId] });
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
      void qc.invalidateQueries({ queryKey: ['share-tokens', projectId] });
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
