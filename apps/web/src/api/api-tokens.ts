import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiTokenDto, CreateApiTokenResponse } from '@next-lane/shared';
import { request } from './client';

const TOKENS_KEY = ['apiTokens'] as const;

export function useApiTokens() {
  return useQuery({
    queryKey: TOKENS_KEY,
    queryFn: () => request<ApiTokenDto[]>('/me/tokens'),
  });
}

export interface CreateTokenInput {
  name: string;
  expiresAt?: string;
}

export function useCreateApiToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTokenInput) =>
      request<CreateApiTokenResponse>('/me/tokens', {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: TOKENS_KEY });
    },
  });
}

export function useRevokeApiToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<{ id: string }>(`/me/tokens/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: TOKENS_KEY });
    },
  });
}
