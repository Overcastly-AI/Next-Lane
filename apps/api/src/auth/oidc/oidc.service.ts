/**
 * OidcService — SSO/OIDC: a single, effective OIDC provider (env-configured
 * Phase 1, or the in-app admin-configured DB fallback — see
 * `OidcConfigService` for the precedence rule) that works with any
 * standards-compliant IdP (Okta/Auth0/Keycloak/Authentik/etc via discovery).
 *
 * Flow:
 *   1. `buildAuthorizationRequest()` — generates state/nonce/PKCE, builds the
 *      provider authorization URL, and returns a signed state token (JWT,
 *      10 min expiry) for the controller to store in a short-lived httpOnly
 *      cookie.
 *   2. `handleCallback()` — verifies the state token against the callback's
 *      `state` query param (CSRF guard), exchanges the authorization code
 *      (PKCE + nonce validated by openid-client), rejects unverified emails,
 *      then JIT-provisions (find-by-email or create) the user and issues the
 *      same JWT session shape `AuthService.login`/`register` issue.
 *
 * The OIDC client is discovered lazily (a network round-trip) and cached
 * keyed by a fingerprint of the *effective* config (issuer + client id +
 * a hash of the secret) — so an admin editing the config from the in-app
 * settings screen takes effect on the very next login attempt, with zero API
 * restart: the fingerprint changes, the cache misses, discovery re-runs.
 */

import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { Issuer, generators } from 'openid-client';
import type { Client, TokenSet } from 'openid-client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService, randomColor } from '../auth.service';
import type { AuthResponse } from '@next-lane/shared';
import { getOidcRedirectUriOverride } from './oidc.config';
import { OidcConfigService, type EffectiveOidcConfig } from '../../admin-settings/oidc-config.service';

interface OidcStatePayload {
  typ: 'oidc_state';
  state: string;
  nonce: string;
  codeVerifier: string;
}

/** Minimal request shape needed to derive the callback URL — avoids a hard `express` dependency in the type. */
export interface RedirectUriRequest {
  protocol: string;
  get(name: string): string | undefined;
}

function fingerprintConfig(config: EffectiveOidcConfig): string {
  return createHash('sha256')
    .update(`${config.issuerUrl}::${config.clientId}::${config.clientSecret}`)
    .digest('hex');
}

@Injectable()
export class OidcService {
  private readonly logger = new Logger(OidcService.name);
  private cachedClient: { fingerprint: string; client: Client } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly authService: AuthService,
    private readonly oidcConfig: OidcConfigService,
  ) {}

  /** Whether SSO is currently usable (env-configured or a saved+enabled DB config). Reflects live state, no restart needed. */
  async isConfigured(): Promise<boolean> {
    return this.oidcConfig.isConfigured();
  }

  /** Resolves the callback URL: explicit `OIDC_REDIRECT_URI` override, else derived from the incoming request. */
  resolveRedirectUri(req: RedirectUriRequest): string {
    return (
      getOidcRedirectUriOverride() ??
      `${req.protocol}://${req.get('host')}/api/auth/oidc/callback`
    );
  }

  /**
   * Builds the provider authorization URL and a signed state token for the
   * controller to persist in a short-lived httpOnly cookie.
   */
  async buildAuthorizationRequest(
    redirectUri: string,
  ): Promise<{ url: string; stateToken: string }> {
    const client = await this.getClient();

    const state = generators.state();
    const nonce = generators.nonce();
    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);

    const url = client.authorizationUrl({
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      redirect_uri: redirectUri,
    });

    const payload: OidcStatePayload = { typ: 'oidc_state', state, nonce, codeVerifier };
    const stateToken = this.jwt.sign(payload, { expiresIn: '10m' });

    return { url, stateToken };
  }

  /**
   * Verifies the callback and returns an `AuthResponse` (same shape as
   * password login) on success. Throws `BadRequestException` for any
   * state/nonce mismatch, token-exchange failure, or unverified email.
   */
  async handleCallback(
    callbackParams: Record<string, string>,
    stateCookie: string | undefined,
    redirectUri: string,
  ): Promise<AuthResponse> {
    const statePayload = this.verifyStateCookie(stateCookie);

    if (!callbackParams.state || callbackParams.state !== statePayload.state) {
      throw new BadRequestException('SSO state mismatch — possible CSRF attempt, please try signing in again');
    }

    const client = await this.getClient();

    let tokenSet: TokenSet;
    try {
      tokenSet = await client.callback(redirectUri, callbackParams, {
        state: statePayload.state,
        nonce: statePayload.nonce,
        code_verifier: statePayload.codeVerifier,
      });
    } catch (err) {
      // Never log the raw error object verbatim — it may embed tokens/codes.
      this.logger.warn(`[oidc] Token exchange failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      throw new BadRequestException('SSO sign-in failed — the identity provider rejected the request');
    }

    const claims = tokenSet.claims();

    if (claims.email_verified === false) {
      throw new BadRequestException(
        'Your identity provider reports this email address as unverified. Verify your email with your provider and try again.',
      );
    }

    const email = claims.email?.toLowerCase();
    if (!email) {
      throw new BadRequestException('The identity provider did not return an email address');
    }

    const name = (typeof claims.name === 'string' && claims.name.trim()) || email.split('@')[0];

    const user = await this.findOrProvisionUser(email, name);

    return this.authService.issueSession(user);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private verifyStateCookie(stateCookie: string | undefined): OidcStatePayload {
    if (!stateCookie) {
      throw new BadRequestException('Missing or expired SSO state — please try signing in again');
    }
    let statePayload: OidcStatePayload;
    try {
      statePayload = this.jwt.verify<OidcStatePayload>(stateCookie);
    } catch {
      throw new BadRequestException('Invalid or expired SSO state — please try signing in again');
    }
    if (statePayload.typ !== 'oidc_state') {
      throw new BadRequestException('Invalid SSO state token');
    }
    return statePayload;
  }

  /**
   * Lazily discovers and caches the OIDC client for the currently-effective
   * config. Cached under a fingerprint of that config (issuer + client id +
   * a hash of the secret) so any change — env unchanged but the DB config
   * edited via the admin settings screen, or vice versa — busts the cache
   * on the very next call instead of serving a stale client until restart.
   */
  private async getClient(): Promise<Client> {
    const config = await this.oidcConfig.getEffectiveConfig();
    if (!config) {
      throw new ServiceUnavailableException('OIDC is not configured');
    }

    const fingerprint = fingerprintConfig(config);
    if (this.cachedClient?.fingerprint === fingerprint) {
      return this.cachedClient.client;
    }

    // Only cache on success — a failed discovery (e.g. IdP briefly
    // unreachable, or an admin-typo'd issuer URL) is never cached, so the
    // very next attempt retries cleanly instead of being stuck.
    const issuer = await Issuer.discover(config.issuerUrl);
    const client = new issuer.Client({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      response_types: ['code'],
    });
    this.cachedClient = { fingerprint, client };
    return client;
  }

  /** Find-by-email or JIT-create a user for a successful SSO login. */
  private async findOrProvisionUser(email: string, name: string) {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) return existing;

    // The very first user ever created on a fresh install becomes the
    // instance admin, same rule as password registration (AuthService.register).
    const isFirstUser = (await this.prisma.user.count()) === 0;

    // Random, unusable password — this account can only authenticate via SSO
    // unless the user later sets a password through "forgot password".
    const unusablePassword = randomBytes(32).toString('hex');
    const passwordHash = await argon2.hash(unusablePassword);

    return this.prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        avatarColor: randomColor(),
        isInstanceAdmin: isFirstUser,
      },
    });
  }
}
