import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OidcConfigDto, UpdateOidcConfigInput } from '@next-lane/shared';
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
