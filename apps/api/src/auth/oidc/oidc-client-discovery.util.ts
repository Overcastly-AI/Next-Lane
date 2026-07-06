/**
 * Shared OIDC discovery-client construction, extracted from the Phase-1
 * `OidcService.getClient()` so the SSO/OIDC Phase 2 multi-provider flow
 * (`SsoOidcService`) can discover a client per-`SsoProvider` row without
 * duplicating the `openid-client` wiring. Callers own their own caching
 * (both `OidcService` and `SsoOidcService` cache by a fingerprint of the
 * effective config — see each for its own cache key).
 */
import { Issuer } from 'openid-client';
import type { Client } from 'openid-client';

export async function discoverOidcClient(
  issuerUrl: string,
  clientId: string,
  clientSecret: string,
): Promise<Client> {
  const issuer = await Issuer.discover(issuerUrl);
  return new issuer.Client({
    client_id: clientId,
    client_secret: clientSecret,
    response_types: ['code'],
  });
}
