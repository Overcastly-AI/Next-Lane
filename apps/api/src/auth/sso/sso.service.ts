/**
 * SsoService — SSO/OIDC Phase 2 runtime orchestrator for the N-simultaneous
 * -providers list (`SsoProvider` rows), additive alongside the Phase-1
 * single-provider `OidcService`/`/api/auth/oidc/*` routes (left completely
 * unchanged — see that module's own header comment).
 *
 * Dispatches by `SsoProvider.type`:
 *   - OIDC: same discovery/PKCE/state-cookie/token-exchange shape as the
 *     legacy `OidcService`, parameterized per-row instead of the single
 *     effective config (client discovery cached per-provider slug, keyed by
 *     a fingerprint of that provider's issuer/client id/secret).
 *   - SAML: delegates to `SamlService` for the node-saml-specific
 *     AuthnRequest/AuthnResponse plumbing; see that file for the assertion
 *     validation strictness contract.
 *
 * Both paths converge on the same find-or-JIT-provision-user +
 * `AuthService.issueSession` tail as the legacy flow (see
 * `sso-jit-provisioning.util.ts` for the JIT rule semantics).
 */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import type { Client, TokenSet } from 'openid-client';
import { generators } from 'openid-client';
import type { SsoProvider } from '@prisma/client';
import { Role, type AuthResponse } from '@next-lane/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService, randomColor } from '../auth.service';
import { discoverOidcClient } from '../oidc/oidc-client-discovery.util';
import { decryptOidcClientSecret } from '../oidc/oidc-secret-crypto.util';
import { provisionJitMembership } from '../sso-jit-provisioning.util';
import { SsoProvidersService } from '../../admin-settings/sso-providers.service';
import { SamlService } from './saml.service';

interface SsoOidcStatePayload {
  typ: 'sso_oidc_state';
  slug: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}

/** Minimal request shape needed to derive the callback URL — avoids a hard `express` dependency in the type (mirrors `oidc.service.ts`'s own `RedirectUriRequest`). */
export interface RedirectUriRequest {
  protocol: string;
  get(name: string): string | undefined;
}

function fingerprintOidc(issuerUrl: string, clientId: string, clientSecret: string): string {
  return createHash('sha256').update(`${issuerUrl}::${clientId}::${clientSecret}`).digest('hex');
}

@Injectable()
export class SsoService {
  private readonly logger = new Logger(SsoService.name);
  private readonly oidcClientCache = new Map<string, { fingerprint: string; client: Client }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly authService: AuthService,
    private readonly ssoProviders: SsoProvidersService,
    private readonly samlService: SamlService,
  ) {}

  /** The enabled provider for `slug`, or null (404 territory — the controller doesn't distinguish "unknown slug" from "disabled" to avoid enumerating configured-but-disabled providers). */
  async getEnabledProvider(slug: string): Promise<SsoProvider | null> {
    const provider = await this.ssoProviders.findBySlug(slug);
    return provider?.enabled ? provider : null;
  }

  resolveCallbackUrl(req: RedirectUriRequest, slug: string): string {
    return `${req.protocol}://${req.get('host')}/api/auth/sso/${slug}/callback`;
  }

  // ---------------------------------------------------------------------------
  // OIDC (type === OIDC)
  // ---------------------------------------------------------------------------

  async buildOidcAuthorizationRequest(
    provider: SsoProvider,
    callbackUrl: string,
  ): Promise<{ url: string; stateToken: string }> {
    const client = await this.getOidcClient(provider);

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
      redirect_uri: callbackUrl,
    });

    const payload: SsoOidcStatePayload = {
      typ: 'sso_oidc_state',
      slug: provider.slug,
      state,
      nonce,
      codeVerifier,
    };
    const stateToken = this.jwt.sign(payload, { expiresIn: '10m' });

    return { url, stateToken };
  }

  async handleOidcCallback(
    provider: SsoProvider,
    callbackParams: Record<string, string>,
    stateCookie: string | undefined,
    callbackUrl: string,
  ): Promise<AuthResponse> {
    const statePayload = this.verifyOidcStateCookie(stateCookie, provider.slug);

    if (!callbackParams.state || callbackParams.state !== statePayload.state) {
      throw new BadRequestException('SSO state mismatch — possible CSRF attempt, please try signing in again');
    }

    const client = await this.getOidcClient(provider);

    let tokenSet: TokenSet;
    try {
      tokenSet = await client.callback(callbackUrl, callbackParams, {
        state: statePayload.state,
        nonce: statePayload.nonce,
        code_verifier: statePayload.codeVerifier,
      });
    } catch (err) {
      this.logger.warn(
        `[sso:${provider.slug}] Token exchange failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
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

    return this.finishLogin(provider, email, name);
  }

  private async getOidcClient(provider: SsoProvider): Promise<Client> {
    if (!provider.issuerUrl || !provider.clientId || !provider.clientSecretEncrypted) {
      // Defensive — SsoProvidersService.create/update enforce these together at write time.
      throw new BadRequestException('This OIDC provider is missing required configuration.');
    }
    const clientSecret = decryptOidcClientSecret(provider.clientSecretEncrypted);
    const fp = fingerprintOidc(provider.issuerUrl, provider.clientId, clientSecret);

    const cached = this.oidcClientCache.get(provider.slug);
    if (cached?.fingerprint === fp) return cached.client;

    const client = await discoverOidcClient(provider.issuerUrl, provider.clientId, clientSecret);
    this.oidcClientCache.set(provider.slug, { fingerprint: fp, client });
    return client;
  }

  private verifyOidcStateCookie(stateCookie: string | undefined, expectedSlug: string): SsoOidcStatePayload {
    if (!stateCookie) {
      throw new BadRequestException('Missing or expired SSO state — please try signing in again');
    }
    let payload: SsoOidcStatePayload;
    try {
      payload = this.jwt.verify<SsoOidcStatePayload>(stateCookie);
    } catch {
      throw new BadRequestException('Invalid or expired SSO state — please try signing in again');
    }
    if (payload.typ !== 'sso_oidc_state' || payload.slug !== expectedSlug) {
      throw new BadRequestException('Invalid SSO state token');
    }
    return payload;
  }

  // ---------------------------------------------------------------------------
  // SAML (type === SAML)
  // ---------------------------------------------------------------------------

  async buildSamlLoginUrl(provider: SsoProvider, callbackUrl: string): Promise<string> {
    if (!provider.samlEntryPoint || !provider.samlIdpIssuer || !provider.samlIdpCertificate) {
      throw new BadRequestException('This SAML provider is missing required configuration.');
    }
    return this.samlService.buildLoginRedirectUrl(
      {
        slug: provider.slug,
        samlEntryPoint: provider.samlEntryPoint,
        samlIdpIssuer: provider.samlIdpIssuer,
        samlIdpCertificate: provider.samlIdpCertificate,
        samlSpEntityId: provider.samlSpEntityId,
      },
      callbackUrl,
    );
  }

  async handleSamlCallback(
    provider: SsoProvider,
    callbackUrl: string,
    samlResponse: string,
  ): Promise<AuthResponse> {
    if (!provider.samlEntryPoint || !provider.samlIdpIssuer || !provider.samlIdpCertificate) {
      throw new BadRequestException('This SAML provider is missing required configuration.');
    }
    const { email, name } = await this.samlService.validateResponseAndExtractIdentity(
      {
        slug: provider.slug,
        samlEntryPoint: provider.samlEntryPoint,
        samlIdpIssuer: provider.samlIdpIssuer,
        samlIdpCertificate: provider.samlIdpCertificate,
        samlSpEntityId: provider.samlSpEntityId,
      },
      callbackUrl,
      samlResponse,
    );

    return this.finishLogin(provider, email, name);
  }

  // ---------------------------------------------------------------------------
  // Shared tail: find-or-JIT-provision-user + issue session
  // ---------------------------------------------------------------------------

  private async finishLogin(provider: SsoProvider, email: string, name: string): Promise<AuthResponse> {
    const { user, isNewUser } = await this.findOrProvisionUser(email, name);

    if (isNewUser) {
      await provisionJitMembership(this.prisma, user.id, {
        jitDefaultWorkspaceId: provider.jitDefaultWorkspaceId,
        jitDefaultRole: provider.jitDefaultRole as Role,
      });
    }

    return this.authService.issueSession(user);
  }

  /**
   * Find-by-email or JIT-create a user. Deliberately duplicated from
   * `OidcService.findOrProvisionUser` (rather than extracted into a shared
   * util) — identical ~15-line body, but keeping Phase-1's `OidcService`
   * untouched avoids any risk of regressing its own well-covered tests while
   * this Phase-2 surface is new.
   */
  private async findOrProvisionUser(
    email: string,
    name: string,
  ): Promise<{ user: Awaited<ReturnType<PrismaService['user']['create']>>; isNewUser: boolean }> {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) return { user: existing, isNewUser: false };

    const isFirstUser = (await this.prisma.user.count()) === 0;
    const unusablePassword = randomBytes(32).toString('hex');
    const passwordHash = await argon2.hash(unusablePassword);

    const user = await this.prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        avatarColor: randomColor(),
        isInstanceAdmin: isFirstUser,
      },
    });
    return { user, isNewUser: true };
  }
}
