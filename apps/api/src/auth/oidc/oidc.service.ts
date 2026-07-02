/**
 * OidcService — SSO/OIDC Phase 1: single, env-configured generic OIDC
 * provider (works with Okta/Auth0/Keycloak/Authentik/etc via standard
 * discovery).
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
 * The OIDC client is discovered lazily and cached for the process lifetime
 * (discovery is a network round-trip; the issuer's metadata does not change
 * at runtime for a given deployment).
 */

import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { Issuer, generators } from 'openid-client';
import type { Client, TokenSet } from 'openid-client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService, randomColor } from '../auth.service';
import type { AuthResponse } from '@next-lane/shared';
import { getOidcEnvConfig, getOidcRedirectUriOverride } from './oidc.config';

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

@Injectable()
export class OidcService {
  private readonly logger = new Logger(OidcService.name);
  private clientPromise: Promise<Client> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly authService: AuthService,
  ) {}

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

  /** Lazily discovers and caches the OIDC client for the configured issuer. */
  private async getClient(): Promise<Client> {
    const env = getOidcEnvConfig();
    if (!env) {
      throw new ServiceUnavailableException('OIDC is not configured');
    }
    if (!this.clientPromise) {
      this.clientPromise = Issuer.discover(env.issuerUrl)
        .then(
          (issuer) =>
            new issuer.Client({
              client_id: env.clientId,
              client_secret: env.clientSecret,
              response_types: ['code'],
            }),
        )
        .catch((err) => {
          // Reset the cache on failure so a later request can retry discovery
          // (e.g. the IdP was briefly unreachable when the API started).
          this.clientPromise = null;
          throw err;
        });
    }
    return this.clientPromise;
  }

  /** Find-by-email or JIT-create a user for a successful SSO login. */
  private async findOrProvisionUser(email: string, name: string) {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) return existing;

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
      },
    });
  }
}
