/**
 * SSO/OIDC — env-driven configuration for the single, generic OIDC provider
 * (Phase 1). Mirrors the SMTP config pattern in `mail.service.ts`: fully
 * optional, off unless all required variables are set, no built-in default
 * secret.
 *
 * Required (all three must be set for the feature to turn on):
 *   OIDC_ISSUER_URL    — the provider's issuer URL (OIDC discovery document
 *                         is fetched from `${OIDC_ISSUER_URL}/.well-known/openid-configuration`).
 *                         Works with any standards-compliant provider (Okta,
 *                         Auth0, Keycloak, Authentik, Google Workspace, ...).
 *   OIDC_CLIENT_ID     — the OAuth2/OIDC client id registered with the provider.
 *   OIDC_CLIENT_SECRET — the client secret. Never logged.
 *
 * Optional:
 *   OIDC_BUTTON_LABEL  — label shown on the "Continue with <label>" login
 *                        button. Default: "Single sign-on".
 *   OIDC_REDIRECT_URI  — explicit absolute callback URL registered with the
 *                        provider (e.g. https://tracker.example.com/api/auth/oidc/callback).
 *                        Recommended in production, especially behind a
 *                        TLS-terminating reverse proxy. When unset the
 *                        callback URL is derived from the incoming request's
 *                        protocol + host, which is sufficient for a direct
 *                        (non-proxied) self-host but may report "http" if a
 *                        reverse proxy doesn't forward the original scheme.
 */

export interface OidcEnvConfig {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
}

/** True when all three required OIDC env vars are non-empty. Off otherwise (zero-config path unaffected). */
export function isOidcConfigured(): boolean {
  return getOidcEnvConfig() !== null;
}

/** Returns the required OIDC env config, or null when any required var is missing/empty. */
export function getOidcEnvConfig(): OidcEnvConfig | null {
  const issuerUrl = process.env.OIDC_ISSUER_URL?.trim();
  const clientId = process.env.OIDC_CLIENT_ID?.trim();
  const clientSecret = process.env.OIDC_CLIENT_SECRET?.trim();
  if (!issuerUrl || !clientId || !clientSecret) return null;
  return { issuerUrl, clientId, clientSecret };
}

/** Label for the SSO login button. Default: "Single sign-on". */
export function getOidcButtonLabel(): string {
  return process.env.OIDC_BUTTON_LABEL?.trim() || 'Single sign-on';
}

/** Explicit callback URL override, if configured. */
export function getOidcRedirectUriOverride(): string | undefined {
  return process.env.OIDC_REDIRECT_URI?.trim() || undefined;
}
