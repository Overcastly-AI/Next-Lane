/**
 * Unit tests for SsoService — the SSO/OIDC Phase 2 multi-provider runtime
 * orchestrator (OIDC + SAML dispatch, JIT provisioning tail). Mirrors
 * `oidc.service.spec.ts`'s depth for the OIDC path (mocked `openid-client`);
 * the SAML assertion-validation strictness itself is exercised end-to-end
 * against the real `@node-saml/node-saml` library in `saml.service.spec.ts`
 * — here `SamlService` is mocked so this file focuses purely on SsoService's
 * OWN logic: provider dispatch, state-cookie slug binding, and the shared
 * find-or-JIT-provision-user tail used by both providers.
 */
import { BadRequestException } from '@nestjs/common';
import { Issuer, generators } from 'openid-client';
import { Role, SsoProviderType } from '@next-lane/shared';
import { SsoService } from './sso.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { JwtService } from '@nestjs/jwt';
import type { AuthService } from '../auth.service';
import type { SsoProvidersService } from '../../admin-settings/sso-providers.service';
import type { SamlService } from './saml.service';
import { encryptOidcClientSecret } from '../oidc/oidc-secret-crypto.util';

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

const CLIENT_MOCK = { authorizationUrl: jest.fn(), callback: jest.fn() };

interface MockPrisma {
  user: { findUnique: jest.Mock; create: jest.Mock; count: jest.Mock };
  workspace: { findUnique: jest.Mock };
  membership: { upsert: jest.Mock };
}

function makePrisma(): MockPrisma {
  return {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      count: jest.fn().mockResolvedValue(1),
    },
    workspace: { findUnique: jest.fn() },
    membership: { upsert: jest.fn() },
  };
}

function makeJwt(): jest.Mocked<Pick<JwtService, 'sign' | 'verify'>> {
  return { sign: jest.fn(), verify: jest.fn() } as unknown as jest.Mocked<Pick<JwtService, 'sign' | 'verify'>>;
}

function makeAuthService(): jest.Mocked<Pick<AuthService, 'issueSession'>> {
  return { issueSession: jest.fn() };
}

function makeSsoProviders(): jest.Mocked<Pick<SsoProvidersService, 'findBySlug'>> {
  return { findBySlug: jest.fn() };
}

function makeSamlService(): jest.Mocked<Pick<SamlService, 'buildLoginRedirectUrl' | 'validateResponseAndExtractIdentity'>> {
  return {
    buildLoginRedirectUrl: jest.fn(),
    validateResponseAndExtractIdentity: jest.fn(),
  };
}

function oidcProvider(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'sp-1',
    type: SsoProviderType.OIDC,
    enabled: true,
    label: 'Okta Eng',
    slug: 'okta-eng',
    issuerUrl: 'https://idp.example.com',
    clientId: 'client-1',
    clientSecretEncrypted: encryptOidcClientSecret('shh'),
    samlEntryPoint: null,
    samlIdpIssuer: null,
    samlIdpCertificate: null,
    samlSpEntityId: null,
    samlWantAssertionsSigned: true,
    jitDefaultWorkspaceId: null,
    jitDefaultRole: Role.VIEWER,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function samlProvider(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'sp-2',
    type: SsoProviderType.SAML,
    enabled: true,
    label: 'Corp ADFS',
    slug: 'corp-adfs',
    issuerUrl: null,
    clientId: null,
    clientSecretEncrypted: null,
    samlEntryPoint: 'https://adfs.example.com/sso',
    samlIdpIssuer: 'https://adfs.example.com',
    samlIdpCertificate: '-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----',
    samlSpEntityId: null,
    samlWantAssertionsSigned: true,
    jitDefaultWorkspaceId: null,
    jitDefaultRole: Role.VIEWER,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('SsoService', () => {
  let prisma: MockPrisma;
  let jwt: jest.Mocked<Pick<JwtService, 'sign' | 'verify'>>;
  let authService: jest.Mocked<Pick<AuthService, 'issueSession'>>;
  let ssoProviders: jest.Mocked<Pick<SsoProvidersService, 'findBySlug'>>;
  let samlService: jest.Mocked<Pick<SamlService, 'buildLoginRedirectUrl' | 'validateResponseAndExtractIdentity'>>;
  let service: SsoService;

  beforeEach(() => {
    prisma = makePrisma();
    jwt = makeJwt();
    authService = makeAuthService();
    ssoProviders = makeSsoProviders();
    samlService = makeSamlService();
    service = new SsoService(
      prisma as unknown as PrismaService,
      jwt as unknown as JwtService,
      authService as unknown as AuthService,
      ssoProviders as unknown as SsoProvidersService,
      samlService as unknown as SamlService,
    );

    CLIENT_MOCK.authorizationUrl.mockReset().mockReturnValue('https://idp.example.com/authorize?foo=bar');
    CLIENT_MOCK.callback.mockReset();
    mockedIssuerDiscover.mockReset().mockResolvedValue({ Client: jest.fn().mockImplementation(() => CLIENT_MOCK) });
    mockedGenerators.state.mockReset().mockReturnValue('state-123');
    mockedGenerators.nonce.mockReset().mockReturnValue('nonce-456');
    mockedGenerators.codeVerifier.mockReset().mockReturnValue('verifier-789');
    mockedGenerators.codeChallenge.mockReset().mockReturnValue('challenge-abc');
  });

  describe('getEnabledProvider', () => {
    it('returns null for an unknown slug', async () => {
      ssoProviders.findBySlug.mockResolvedValue(null);
      await expect(service.getEnabledProvider('nope')).resolves.toBeNull();
    });

    it('returns null for a DISABLED provider (no distinguishing 404 from "disabled")', async () => {
      ssoProviders.findBySlug.mockResolvedValue(oidcProvider({ enabled: false }) as never);
      await expect(service.getEnabledProvider('okta-eng')).resolves.toBeNull();
    });

    it('returns the provider row when enabled', async () => {
      const provider = oidcProvider();
      ssoProviders.findBySlug.mockResolvedValue(provider as never);
      await expect(service.getEnabledProvider('okta-eng')).resolves.toEqual(provider);
    });
  });

  describe('OIDC flow', () => {
    it('buildOidcAuthorizationRequest signs a state token binding the provider slug', async () => {
      jwt.sign.mockReturnValue('signed-state-token');
      const { url, stateToken } = await service.buildOidcAuthorizationRequest(
        oidcProvider() as never,
        'https://tracker.example.com/api/auth/sso/okta-eng/callback',
      );
      expect(url).toBe('https://idp.example.com/authorize?foo=bar');
      expect(stateToken).toBe('signed-state-token');
      const signedPayload = jwt.sign.mock.calls[0][0] as { typ: string; slug: string };
      expect(signedPayload.typ).toBe('sso_oidc_state');
      expect(signedPayload.slug).toBe('okta-eng');
    });

    it('handleOidcCallback rejects when the state cookie slug does not match the callback provider slug', async () => {
      jwt.verify.mockReturnValue({
        typ: 'sso_oidc_state',
        slug: 'a-different-provider',
        state: 'state-123',
        nonce: 'nonce-456',
        codeVerifier: 'verifier-789',
      });

      await expect(
        service.handleOidcCallback(oidcProvider() as never, { state: 'state-123' }, 'cookie', 'https://cb'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(CLIENT_MOCK.callback).not.toHaveBeenCalled();
    });

    it('handleOidcCallback rejects a state/nonce mismatch (CSRF guard)', async () => {
      jwt.verify.mockReturnValue({
        typ: 'sso_oidc_state',
        slug: 'okta-eng',
        state: 'state-123',
        nonce: 'nonce-456',
        codeVerifier: 'verifier-789',
      });

      await expect(
        service.handleOidcCallback(
          oidcProvider() as never,
          { state: 'WRONG-state', code: 'abc' },
          'cookie',
          'https://cb',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('handleOidcCallback JIT-provisions a workspace membership for a brand-new user per THIS provider config', async () => {
      jwt.verify.mockReturnValue({
        typ: 'sso_oidc_state',
        slug: 'okta-eng',
        state: 'state-123',
        nonce: 'nonce-456',
        codeVerifier: 'verifier-789',
      });
      CLIENT_MOCK.callback.mockResolvedValue({
        claims: () => ({ email: 'new@example.com', email_verified: true, name: 'New Person' }),
      });
      prisma.user.findUnique.mockResolvedValue(null);
      const createdUser = { id: 'u-new', email: 'new@example.com', name: 'New Person' };
      prisma.user.create.mockResolvedValue(createdUser);
      prisma.workspace.findUnique.mockResolvedValue({ id: 'ws-1' });
      authService.issueSession.mockReturnValue({ accessToken: 'jwt', user: {} as never });

      const provider = oidcProvider({ jitDefaultWorkspaceId: 'ws-1', jitDefaultRole: Role.MEMBER });
      await service.handleOidcCallback(provider as never, { state: 'state-123', code: 'abc' }, 'cookie', 'https://cb');

      expect(prisma.membership.upsert).toHaveBeenCalledWith({
        where: { userId_workspaceId: { userId: 'u-new', workspaceId: 'ws-1' } },
        update: {},
        create: { userId: 'u-new', workspaceId: 'ws-1', role: Role.MEMBER },
      });
    });

    it('never re-provisions a membership for an EXISTING user on a later login', async () => {
      jwt.verify.mockReturnValue({
        typ: 'sso_oidc_state',
        slug: 'okta-eng',
        state: 'state-123',
        nonce: 'nonce-456',
        codeVerifier: 'verifier-789',
      });
      CLIENT_MOCK.callback.mockResolvedValue({
        claims: () => ({ email: 'existing@example.com', email_verified: true }),
      });
      prisma.user.findUnique.mockResolvedValue({ id: 'u-existing', email: 'existing@example.com' });
      authService.issueSession.mockReturnValue({ accessToken: 'jwt', user: {} as never });

      const provider = oidcProvider({ jitDefaultWorkspaceId: 'ws-1', jitDefaultRole: Role.MEMBER });
      await service.handleOidcCallback(provider as never, { state: 'state-123', code: 'abc' }, 'cookie', 'https://cb');

      expect(prisma.membership.upsert).not.toHaveBeenCalled();
    });

    it('caches the discovered client per provider slug and busts it when the secret fingerprint changes', async () => {
      const provider = oidcProvider();
      ssoProviders.findBySlug.mockResolvedValue(provider as never);
      jwt.sign.mockReturnValue('token');

      await service.buildOidcAuthorizationRequest(provider as never, 'https://cb');
      await service.buildOidcAuthorizationRequest(provider as never, 'https://cb');
      expect(mockedIssuerDiscover).toHaveBeenCalledTimes(1);

      const rotated = oidcProvider({ clientSecretEncrypted: encryptOidcClientSecret('new-secret') });
      await service.buildOidcAuthorizationRequest(rotated as never, 'https://cb');
      expect(mockedIssuerDiscover).toHaveBeenCalledTimes(2);
    });
  });

  describe('SAML flow', () => {
    it('buildSamlLoginUrl delegates to SamlService with the provider config', async () => {
      samlService.buildLoginRedirectUrl.mockResolvedValue('https://adfs.example.com/sso?SAMLRequest=...');
      const url = await service.buildSamlLoginUrl(samlProvider() as never, 'https://cb');
      expect(url).toBe('https://adfs.example.com/sso?SAMLRequest=...');
      expect(samlService.buildLoginRedirectUrl).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'corp-adfs', samlEntryPoint: 'https://adfs.example.com/sso' }),
        'https://cb',
      );
    });

    it('rejects a SAML provider missing required configuration before ever calling SamlService', async () => {
      await expect(
        service.buildSamlLoginUrl(samlProvider({ samlIdpCertificate: null }) as never, 'https://cb'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(samlService.buildLoginRedirectUrl).not.toHaveBeenCalled();
    });

    it('handleSamlCallback JIT-provisions a brand-new user per this SAML provider config', async () => {
      samlService.validateResponseAndExtractIdentity.mockResolvedValue({
        email: 'sam@corp.example.com',
        name: 'Sam',
      });
      prisma.user.findUnique.mockResolvedValue(null);
      const createdUser = { id: 'u-sam', email: 'sam@corp.example.com', name: 'Sam' };
      prisma.user.create.mockResolvedValue(createdUser);
      prisma.workspace.findUnique.mockResolvedValue({ id: 'ws-2' });
      authService.issueSession.mockReturnValue({ accessToken: 'jwt', user: {} as never });

      const provider = samlProvider({ jitDefaultWorkspaceId: 'ws-2', jitDefaultRole: Role.ADMIN });
      await service.handleSamlCallback(provider as never, 'https://cb', 'base64-response');

      expect(prisma.membership.upsert).toHaveBeenCalledWith({
        where: { userId_workspaceId: { userId: 'u-sam', workspaceId: 'ws-2' } },
        update: {},
        create: { userId: 'u-sam', workspaceId: 'ws-2', role: Role.ADMIN },
      });
      expect(authService.issueSession).toHaveBeenCalledWith(createdUser);
    });

    it('propagates SamlService validation failures unchanged (BadRequestException)', async () => {
      samlService.validateResponseAndExtractIdentity.mockRejectedValue(
        new BadRequestException("SSO sign-in failed — the identity provider's response could not be verified"),
      );
      await expect(
        service.handleSamlCallback(samlProvider() as never, 'https://cb', 'forged-response'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });
});
