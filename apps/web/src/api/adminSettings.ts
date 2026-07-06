import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateSsoProviderInput,
  OidcConfigDto,
  SsoProviderDto,
  UpdateOidcConfigInput,
  UpdateSsoProviderInput,
} from '@next-lane/shared';
import { request } from './client';
import { qk } from './keys';

/**
 * Instance-level SSO/OIDC configuration — the in-app admin settings screen.
 * Instance-admin gated on the server (`assertInstanceAdmin`); this hook is
 * only ever mounted behind the same client-side gate
 * (`useAuth().user?.isInstanceAdmin`), but the server enforces it
 * independently either way.
 */
export function useOidcConfig(enabled = true) {
  return useQuery({
    queryKey: qk.oidcConfig,
    queryFn: () => request<OidcConfigDto>('/admin/oidc-config'),
    enabled,
    retry: false,
  });
}

export function useUpdateOidcConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateOidcConfigInput) =>
      request<OidcConfigDto>('/admin/oidc-config', {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: (dto) => {
      qc.setQueryData(qk.oidcConfig, dto);
      // The login page's SSO button depends on this — invalidate so the very
      // next `GET /auth/providers` (or an already-mounted LoginPage in
      // another tab, on its next refetch) reflects the save immediately.
      void qc.invalidateQueries({ queryKey: qk.authProviders });
    },
  });
}

/**
 * SSO/OIDC Phase 2 — the N-simultaneous-providers list (`/admin/sso-providers`),
 * additive alongside the legacy singleton above. Same instance-admin gating
 * story (server-enforced; the client-side `isInstanceAdmin` check is UX-only).
 */
export function useSsoProviders(enabled = true) {
  return useQuery({
    queryKey: qk.ssoProviders,
    queryFn: () => request<SsoProviderDto[]>('/admin/sso-providers'),
    enabled,
    retry: false,
  });
}

export function useCreateSsoProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSsoProviderInput) =>
      request<SsoProviderDto>('/admin/sso-providers', {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.ssoProviders });
      void qc.invalidateQueries({ queryKey: qk.authProviders });
    },
  });
}

export function useUpdateSsoProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateSsoProviderInput }) =>
      request<SsoProviderDto>(`/admin/sso-providers/${id}`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.ssoProviders });
      void qc.invalidateQueries({ queryKey: qk.authProviders });
    },
  });
}

export function useDeleteSsoProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<void>(`/admin/sso-providers/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.ssoProviders });
      void qc.invalidateQueries({ queryKey: qk.authProviders });
    },
  });
}
