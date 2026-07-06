/**
 * Unit tests for OidcService (SSO/OIDC Phase 1).
 *
 * `openid-client` is fully mocked — no real network/IdP discovery happens in
 * these tests. Covers:
 *   - authorization URL construction (state/nonce/PKCE + signed state token)
 *   - callback state/nonce CSRF guards
 *   - unverified-email rejection
 *   - token-exchange failure handling
 *   - JIT provisioning: existing user by email is reused; unknown email creates
 *     a new user with a random unusable password hash
 *   - disabled-when-unconfigured (ServiceUnavailableException)
 */

import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { Role } from '@next-lane/shared';
import { Issuer, generators } from 'openid-client';
import { OidcService } from './oidc.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { JwtService } from '@nestjs/jwt';
import type { AuthService } from '../auth.service';
import { getOidcButtonLabel, getOidcEnvConfig } from './oidc.config';
import type { OidcConfigService } from '../../admin-settings/oidc-config.service';

jest.mock('openid-client', () => ({
  Issuer: { discover: jest.fn() },
  generators: {
    state: jest.fn(),
    nonce: jest.fn(),
    codeVerifier: jest.fn(),
    codeChallenge: jest.fn(),
  },
}));

const mockedIssuerDiscover = Issuer.discover as jest.Mock;
const mockedGenerators = generators as unknown as {
  state: jest.Mock;
  nonce: jest.Mock;
  codeVerifier: jest.Mock;
  codeChallenge: jest.Mock;
};

interface MockPrisma {
  user: {
    findUnique: jest.Mock;
    create: jest.Mock;
    count: jest.Mock;
  };
  workspace: {
    findUnique: jest.Mock;
  };
  membership: {
    upsert: jest.Mock;
  };
}

function makePrisma(): MockPrisma {
  return {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      // Non-zero by default (an existing installation with users already) so
      // JIT-provisioned test users are NOT accidentally instance-admin'd;
      // individual tests override this when they care.
      count: jest.fn().mockResolvedValue(1),
    },
    // SSO/OIDC Phase 2 — JIT workspace/role provisioning
    // (sso-jit-provisioning.util.ts). Unused by tests that don't configure
    // `jitDefaultWorkspaceId` — `provisionJitMembership` no-ops before ever
    // touching these when it's null.
    workspace: {
      findUnique: jest.fn(),
    },
    membership: {
      upsert: jest.fn(),
    },
  };
}

/**
 * Stand-in for `OidcConfigService` whose `getEffectiveConfig()` mirrors the
 * real env-precedence rule by reading the actual env vars at call time — so
 * the existing `setEnv()`/`clearEnv()` helpers below keep controlling
 * "configured or not" exactly as before this refactor, with no other test
 * changes required.
 */
function makeOidcConfigService(): jest.Mocked<Pick<OidcConfigService, 'getEffectiveConfig' | 'isConfigured'>> {
  return {
    getEffectiveConfig: jest.fn(async () => {
      const env = getOidcEnvConfig();
      if (!env) return null;
      return {
        ...env,
        label: getOidcButtonLabel(),
        source: 'env' as const,
        jitDefaultWorkspaceId: null,
        jitDefaultRole: Role.VIEWER,
      };
    }),
    isConfigured: jest.fn(async () => getOidcEnvConfig() !== null),
  };
}

/** Deterministic, controllable JwtService stand-in (sign/verify are simple pass-throughs we script per test). */
function makeJwt(): jest.Mocked<Pick<JwtService, 'sign' | 'verify'>> {
  return {
    sign: jest.fn(),
    verify: jest.fn(),
  } as unknown as jest.Mocked<Pick<JwtService, 'sign' | 'verify'>>;
}

function makeAuthService(): jest.Mocked<Pick<AuthService, 'issueSession'>> {
  return { issueSession: jest.fn() };
}

const CLIENT_MOCK = {
  authorizationUrl: jest.fn(),
  callback: jest.fn(),
};

function setEnv() {
  process.env.OIDC_ISSUER_URL = 'https://idp.example.com';
  process.env.OIDC_CLIENT_ID = 'client-1';
  process.env.OIDC_CLIENT_SECRET = 'shh';
}

function clearEnv() {
  delete process.env.OIDC_ISSUER_URL;
  delete process.env.OIDC_CLIENT_ID;
  delete process.env.OIDC_CLIENT_SECRET;
}

describe('OidcService', () => {
  let prisma: MockPrisma;
  let jwt: jest.Mocked<Pick<JwtService, 'sign' | 'verify'>>;
  let authService: jest.Mocked<Pick<AuthService, 'issueSession'>>;
  let oidcConfigService: jest.Mocked<Pick<OidcConfigService, 'getEffectiveConfig' | 'isConfigured'>>;
  let service: OidcService;

  beforeEach(() => {
    prisma = makePrisma();
    jwt = makeJwt();
    authService = makeAuthService();
    oidcConfigService = makeOidcConfigService();
    service = new OidcService(
      prisma as unknown as PrismaService,
      jwt as unknown as JwtService,
      authService as unknown as AuthService,
      oidcConfigService as unknown as OidcConfigService,
    );

    CLIENT_MOCK.authorizationUrl.mockReset().mockReturnValue('https://idp.example.com/authorize?foo=bar');
    CLIENT_MOCK.callback.mockReset();
    mockedIssuerDiscover.mockReset().mockResolvedValue({
      Client: jest.fn().mockImplementation(() => CLIENT_MOCK),
    });
    mockedGenerators.state.mockReset().mockReturnValue('state-123');
    mockedGenerators.nonce.mockReset().mockReturnValue('nonce-456');
    mockedGenerators.codeVerifier.mockReset().mockReturnValue('verifier-789');
    mockedGenerators.codeChallenge.mockReset().mockReturnValue('challenge-abc');
  });

  afterEach(() => {
    clearEnv();
  });

  // ---------------------------------------------------------------------------
  // buildAuthorizationRequest
  // ---------------------------------------------------------------------------

  describe('buildAuthorizationRequest', () => {
    it('throws ServiceUnavailableException when OIDC is not configured', async () => {
      clearEnv();
      await expect(
        service.buildAuthorizationRequest('https://api.example.com/api/auth/oidc/callback'),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('builds the authorization URL with PKCE + state + nonce and signs a state token', async () => {
      setEnv();
      jwt.sign.mockReturnValue('signed-state-token');

      const result = await service.buildAuthorizationRequest(
        'https://api.example.com/api/auth/oidc/callback',
      );

      expect(CLIENT_MOCK.authorizationUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: 'openid email profile',
          state: 'state-123',
          nonce: 'nonce-456',
          code_challenge: 'challenge-abc',
          code_challenge_method: 'S256',
          redirect_uri: 'https://api.example.com/api/auth/oidc/callback',
        }),
      );
      expect(result.url).toBe('https://idp.example.com/authorize?foo=bar');
      expect(result.stateToken).toBe('signed-state-token');

      // The signed payload carries the state/nonce/verifier for the callback to
      // verify against, tagged with a type so it can't be confused with a real
      // session JWT.
      expect(jwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          typ: 'oidc_state',
          state: 'state-123',
          nonce: 'nonce-456',
          codeVerifier: 'verifier-789',
        }),
        expect.objectContaining({ expiresIn: '10m' }),
      );
    });

    it('discovers the issuer only once across multiple calls (cached client)', async () => {
      setEnv();
      jwt.sign.mockReturnValue('token');

      await service.buildAuthorizationRequest('https://api.example.com/api/auth/oidc/callback');
      await service.buildAuthorizationRequest('https://api.example.com/api/auth/oidc/callback');

      expect(mockedIssuerDiscover).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // handleCallback — CSRF / validation guards
  // ---------------------------------------------------------------------------

  describe('handleCallback — guards', () => {
    beforeEach(() => setEnv());

    it('rejects when the state cookie is missing', async () => {
      await expect(
        service.handleCallback({ state: 'state-123', code: 'abc' }, undefined, 'https://api.example.com/cb'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(CLIENT_MOCK.callback).not.toHaveBeenCalled();
    });

    it('rejects when the state cookie fails verification (expired/tampered)', async () => {
      jwt.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });
      await expect(
        service.handleCallback({ state: 'state-123', code: 'abc' }, 'bad-token', 'https://api.example.com/cb'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(CLIENT_MOCK.callback).not.toHaveBeenCalled();
    });

    it('rejects when the decoded token has the wrong typ claim', async () => {
      jwt.verify.mockReturnValue({
        typ: 'something_else',
        state: 'state-123',
        nonce: 'nonce-456',
        codeVerifier: 'verifier-789',
      });
      await expect(
        service.handleCallback({ state: 'state-123', code: 'abc' }, 'token', 'https://api.example.com/cb'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(CLIENT_MOCK.callback).not.toHaveBeenCalled();
    });

    it('rejects on state mismatch between cookie and query param (CSRF)', async () => {
      jwt.verify.mockReturnValue({
        typ: 'oidc_state',
        state: 'state-123',
        nonce: 'nonce-456',
        codeVerifier: 'verifier-789',
      });
      await expect(
        service.handleCallback(
          { state: 'attacker-controlled-state', code: 'abc' },
          'token',
          'https://api.example.com/cb',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(CLIENT_MOCK.callback).not.toHaveBeenCalled();
    });

    it('wraps a token-exchange failure in a sanitised BadRequestException', async () => {
      jwt.verify.mockReturnValue({
        typ: 'oidc_state',
        state: 'state-123',
        nonce: 'nonce-456',
        codeVerifier: 'verifier-789',
      });
      CLIENT_MOCK.callback.mockRejectedValue(new Error('invalid_grant: code already used'));

      await expect(
        service.handleCallback({ state: 'state-123', code: 'abc' }, 'token', 'https://api.example.com/cb'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('rejects when the provider reports email_verified: false', async () => {
      jwt.verify.mockReturnValue({
        typ: 'oidc_state',
        state: 'state-123',
        nonce: 'nonce-456',
        codeVerifier: 'verifier-789',
      });
      CLIENT_MOCK.callback.mockResolvedValue({
        claims: () => ({
          sub: 'idp-user-1',
          email: 'alice@example.com',
          email_verified: false,
          name: 'Alice',
        }),
      });

      await expect(
        service.handleCallback({ state: 'state-123', code: 'abc' }, 'token', 'https://api.example.com/cb'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('rejects when the provider does not return an email claim', async () => {
      jwt.verify.mockReturnValue({
        typ: 'oidc_state',
        state: 'state-123',
        nonce: 'nonce-456',
        codeVerifier: 'verifier-789',
      });
      CLIENT_MOCK.callback.mockResolvedValue({
        claims: () => ({ sub: 'idp-user-1' }),
      });

      await expect(
        service.handleCallback({ state: 'state-123', code: 'abc' }, 'token', 'https://api.example.com/cb'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // handleCallback — JIT provisioning
  // ---------------------------------------------------------------------------

  describe('handleCallback — JIT provisioning', () => {
    beforeEach(() => {
      setEnv();
      jwt.verify.mockReturnValue({
        typ: 'oidc_state',
        state: 'state-123',
        nonce: 'nonce-456',
        codeVerifier: 'verifier-789',
      });
    });

    it('reuses an existing user found by email (case-insensitive) instead of creating a new one', async () => {
      CLIENT_MOCK.callback.mockResolvedValue({
        claims: () => ({
          sub: 'idp-user-1',
          email: 'Alice@Example.com',
          email_verified: true,
          name: 'Alice',
        }),
      });
      const existingUser = {
        id: 'u-1',
        email: 'alice@example.com',
        name: 'Alice',
        avatarColor: '#6366f1',
        emailNotifications: true,
        isInstanceAdmin: false,
        createdAt: new Date('2024-01-01T00:00:00Z'),
      };
      prisma.user.findUnique.mockResolvedValue(existingUser);
      authService.issueSession.mockReturnValue({
        accessToken: 'jwt-token',
        user: { ...existingUser, createdAt: existingUser.createdAt.toISOString() },
      });

      const result = await service.handleCallback(
        { state: 'state-123', code: 'abc' },
        'token',
        'https://api.example.com/cb',
      );

      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'alice@example.com' } });
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(authService.issueSession).toHaveBeenCalledWith(existingUser);
      expect(result.accessToken).toBe('jwt-token');
    });

    it('creates a new user with a random unusable password hash when the email is unknown', async () => {
      CLIENT_MOCK.callback.mockResolvedValue({
        claims: () => ({
          sub: 'idp-user-2',
          email: 'new.person@example.com',
          email_verified: true,
          name: 'New Person',
        }),
      });
      prisma.user.findUnique.mockResolvedValue(null);
      const createdUser = {
        id: 'u-2',
        email: 'new.person@example.com',
        name: 'New Person',
        avatarColor: '#22c55e',
        emailNotifications: true,
        isInstanceAdmin: false,
        createdAt: new Date('2024-06-01T00:00:00Z'),
      };
      prisma.user.create.mockResolvedValue(createdUser);
      authService.issueSession.mockReturnValue({
        accessToken: 'jwt-token-2',
        user: { ...createdUser, createdAt: createdUser.createdAt.toISOString() },
      });

      await service.handleCallback({ state: 'state-123', code: 'abc' }, 'token', 'https://api.example.com/cb');

      expect(prisma.user.create).toHaveBeenCalledTimes(1);
      const created = prisma.user.create.mock.calls[0][0].data as {
        email: string;
        name: string;
        passwordHash: string;
        avatarColor: string;
      };
      expect(created.email).toBe('new.person@example.com');
      expect(created.name).toBe('New Person');
      // A real argon2 hash — never the plaintext random token, never empty.
      expect(created.passwordHash).toMatch(/^\$argon2/);
      expect(typeof created.avatarColor).toBe('string');
      expect(authService.issueSession).toHaveBeenCalledWith(createdUser);
    });

    it('falls back to the email local-part as the name when the provider omits `name`', async () => {
      CLIENT_MOCK.callback.mockResolvedValue({
        claims: () => ({
          sub: 'idp-user-3',
          email: 'no.name@example.com',
          email_verified: true,
        }),
      });
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'u-3',
        email: 'no.name@example.com',
        name: 'no.name',
        avatarColor: '#eab308',
        emailNotifications: true,
        createdAt: new Date(),
      });
      authService.issueSession.mockReturnValue({
        accessToken: 'jwt-token-3',
        user: {} as never,
      });

      await service.handleCallback({ state: 'state-123', code: 'abc' }, 'token', 'https://api.example.com/cb');

      const created = prisma.user.create.mock.calls[0][0].data as { name: string };
      expect(created.name).toBe('no.name');
    });

    // -------------------------------------------------------------------------
    // SSO/OIDC Phase 2 — JIT workspace/role provisioning for THIS (legacy)
    // provider (sso-jit-provisioning.util.ts).
    // -------------------------------------------------------------------------

    it('auto-provisions a workspace membership at the configured JIT role for a brand-new user', async () => {
      oidcConfigService.getEffectiveConfig.mockResolvedValue({
        issuerUrl: 'https://idp.example.com',
        clientId: 'client-1',
        clientSecret: 'shh',
        label: 'Single sign-on',
        source: 'env',
        jitDefaultWorkspaceId: 'ws-1',
        jitDefaultRole: Role.MEMBER,
      });
      CLIENT_MOCK.callback.mockResolvedValue({
        claims: () => ({
          sub: 'idp-user-jit',
          email: 'jit.new@example.com',
          email_verified: true,
          name: 'Jit New',
        }),
      });
      prisma.user.findUnique.mockResolvedValue(null);
      const createdUser = {
        id: 'u-jit',
        email: 'jit.new@example.com',
        name: 'Jit New',
        avatarColor: '#eab308',
        emailNotifications: true,
        isInstanceAdmin: false,
        createdAt: new Date(),
      };
      prisma.user.create.mockResolvedValue(createdUser);
      prisma.workspace.findUnique.mockResolvedValue({ id: 'ws-1' });
      authService.issueSession.mockReturnValue({ accessToken: 'jwt', user: {} as never });

      await service.handleCallback({ state: 'state-123', code: 'abc' }, 'token', 'https://api.example.com/cb');

      expect(prisma.workspace.findUnique).toHaveBeenCalledWith({
        where: { id: 'ws-1' },
        select: { id: true },
      });
      expect(prisma.membership.upsert).toHaveBeenCalledWith({
        where: { userId_workspaceId: { userId: 'u-jit', workspaceId: 'ws-1' } },
        update: {},
        create: { userId: 'u-jit', workspaceId: 'ws-1', role: Role.MEMBER },
      });
    });

    it('never auto-provisions a membership for an ALREADY-EXISTING user, even when JIT is configured', async () => {
      oidcConfigService.getEffectiveConfig.mockResolvedValue({
        issuerUrl: 'https://idp.example.com',
        clientId: 'client-1',
        clientSecret: 'shh',
        label: 'Single sign-on',
        source: 'env',
        jitDefaultWorkspaceId: 'ws-1',
        jitDefaultRole: Role.MEMBER,
      });
      CLIENT_MOCK.callback.mockResolvedValue({
        claims: () => ({
          sub: 'idp-user-existing',
          email: 'existing@example.com',
          email_verified: true,
          name: 'Existing',
        }),
      });
      const existingUser = {
        id: 'u-existing',
        email: 'existing@example.com',
        name: 'Existing',
        avatarColor: '#6366f1',
        emailNotifications: true,
        isInstanceAdmin: false,
        createdAt: new Date(),
      };
      prisma.user.findUnique.mockResolvedValue(existingUser);
      authService.issueSession.mockReturnValue({ accessToken: 'jwt', user: {} as never });

      await service.handleCallback({ state: 'state-123', code: 'abc' }, 'token', 'https://api.example.com/cb');

      expect(prisma.membership.upsert).not.toHaveBeenCalled();
      expect(prisma.workspace.findUnique).not.toHaveBeenCalled();
    });

    it('skips membership provisioning when jitDefaultWorkspaceId is null (default, Phase-1-compatible behavior)', async () => {
      // The default mock (see makeOidcConfigService) already returns
      // jitDefaultWorkspaceId: null for the env-configured path.
      CLIENT_MOCK.callback.mockResolvedValue({
        claims: () => ({
          sub: 'idp-user-nojit',
          email: 'nojit@example.com',
          email_verified: true,
          name: 'No Jit',
        }),
      });
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'u-nojit',
        email: 'nojit@example.com',
        name: 'No Jit',
        avatarColor: '#6366f1',
        emailNotifications: true,
        isInstanceAdmin: false,
        createdAt: new Date(),
      });
      authService.issueSession.mockReturnValue({ accessToken: 'jwt', user: {} as never });

      await service.handleCallback({ state: 'state-123', code: 'abc' }, 'token', 'https://api.example.com/cb');

      expect(prisma.membership.upsert).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // resolveRedirectUri
  // ---------------------------------------------------------------------------

  describe('resolveRedirectUri', () => {
    afterEach(() => {
      delete process.env.OIDC_REDIRECT_URI;
    });

    it('derives the callback URL from the request when no override is set', () => {
      const req = { protocol: 'https', get: (name: string) => (name === 'host' ? 'tracker.example.com' : undefined) };
      expect(service.resolveRedirectUri(req)).toBe('https://tracker.example.com/api/auth/oidc/callback');
    });

    it('prefers the explicit OIDC_REDIRECT_URI override', () => {
      process.env.OIDC_REDIRECT_URI = 'https://override.example.com/api/auth/oidc/callback';
      const req = { protocol: 'http', get: () => 'ignored.example.com' };
      expect(service.resolveRedirectUri(req)).toBe('https://override.example.com/api/auth/oidc/callback');
    });
  });
});
