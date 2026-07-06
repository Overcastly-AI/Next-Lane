/**
 * Unit tests for OidcConfigService — the effective-config resolver behind
 * both the login surface (`OidcService`/`AuthController.providers()`) and
 * the admin settings screen (`AdminSettingsService`).
 *
 * Covers:
 *   - precedence: env vars win over an enabled DB config when both are set
 *   - DB config is used only when fully populated AND enabled
 *   - the client secret is decrypted for internal use but NEVER included in
 *     `toDto()` — only `hasClientSecret`
 *   - `envManaged` correctly reflects which source is in effect
 */
import { Role } from '@next-lane/shared';
import { OidcConfigService, OIDC_CONFIG_SINGLETON_ID } from './oidc-config.service';
import type { PrismaService } from '../prisma/prisma.service';
import { encryptOidcClientSecret } from '../auth/oidc/oidc-secret-crypto.util';

interface MockPrisma {
  oidcConfig: {
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
}

function makePrisma(): MockPrisma {
  return {
    oidcConfig: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
}

const ENV_KEYS = ['OIDC_ISSUER_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_BUTTON_LABEL'];

describe('OidcConfigService', () => {
  let prisma: MockPrisma;
  let service: OidcConfigService;
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      originalEnv[k] = process.env[k];
      delete process.env[k];
    }
    prisma = makePrisma();
    service = new OidcConfigService(prisma as unknown as PrismaService);
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (originalEnv[k] === undefined) delete process.env[k];
      else process.env[k] = originalEnv[k];
    }
  });

  describe('getEffectiveConfig — precedence', () => {
    it('returns null when neither env nor a DB config is set', async () => {
      prisma.oidcConfig.findUnique.mockResolvedValue(null);
      await expect(service.getEffectiveConfig()).resolves.toBeNull();
    });

    it('uses the DB config when enabled and fully populated (env unset)', async () => {
      prisma.oidcConfig.findUnique.mockResolvedValue({
        id: OIDC_CONFIG_SINGLETON_ID,
        enabled: true,
        issuerUrl: 'https://idp.example.com',
        clientId: 'db-client',
        clientSecretEncrypted: encryptOidcClientSecret('db-secret'),
        label: 'Okta (DB)',
        updatedAt: new Date(),
      });

      const config = await service.getEffectiveConfig();
      expect(config).toEqual({
        issuerUrl: 'https://idp.example.com',
        clientId: 'db-client',
        clientSecret: 'db-secret',
        label: 'Okta (DB)',
        source: 'db',
      });
    });

    it('env vars WIN over an enabled DB config when both are set', async () => {
      process.env.OIDC_ISSUER_URL = 'https://env-idp.example.com';
      process.env.OIDC_CLIENT_ID = 'env-client';
      process.env.OIDC_CLIENT_SECRET = 'env-secret';

      prisma.oidcConfig.findUnique.mockResolvedValue({
        id: OIDC_CONFIG_SINGLETON_ID,
        enabled: true,
        issuerUrl: 'https://db-idp.example.com',
        clientId: 'db-client',
        clientSecretEncrypted: encryptOidcClientSecret('db-secret'),
        label: 'DB label',
        updatedAt: new Date(),
      });

      const config = await service.getEffectiveConfig();
      expect(config?.source).toBe('env');
      expect(config?.issuerUrl).toBe('https://env-idp.example.com');
      expect(config?.clientId).toBe('env-client');
      expect(config?.clientSecret).toBe('env-secret');
      // Env is authoritative — the DB is never even queried once env is present.
      expect(prisma.oidcConfig.findUnique).not.toHaveBeenCalled();
    });

    it('ignores a DB config with enabled: false', async () => {
      prisma.oidcConfig.findUnique.mockResolvedValue({
        id: OIDC_CONFIG_SINGLETON_ID,
        enabled: false,
        issuerUrl: 'https://idp.example.com',
        clientId: 'db-client',
        clientSecretEncrypted: encryptOidcClientSecret('db-secret'),
        label: null,
        updatedAt: new Date(),
      });
      await expect(service.getEffectiveConfig()).resolves.toBeNull();
    });

    it('ignores an enabled DB config missing a required field (no secret saved yet)', async () => {
      prisma.oidcConfig.findUnique.mockResolvedValue({
        id: OIDC_CONFIG_SINGLETON_ID,
        enabled: true,
        issuerUrl: 'https://idp.example.com',
        clientId: 'db-client',
        clientSecretEncrypted: null,
        label: null,
        updatedAt: new Date(),
      });
      await expect(service.getEffectiveConfig()).resolves.toBeNull();
    });

    it('isConfigured() mirrors getEffectiveConfig() being non-null', async () => {
      prisma.oidcConfig.findUnique.mockResolvedValue(null);
      await expect(service.isConfigured()).resolves.toBe(false);

      prisma.oidcConfig.findUnique.mockResolvedValue({
        id: OIDC_CONFIG_SINGLETON_ID,
        enabled: true,
        issuerUrl: 'https://idp.example.com',
        clientId: 'db-client',
        clientSecretEncrypted: encryptOidcClientSecret('db-secret'),
        label: null,
        updatedAt: new Date(),
      });
      await expect(service.isConfigured()).resolves.toBe(true);
    });
  });

  describe('toDto — secret never serialized', () => {
    it('reports envManaged: true and hasClientSecret: true when env-configured, without ever including the secret', async () => {
      process.env.OIDC_ISSUER_URL = 'https://env-idp.example.com';
      process.env.OIDC_CLIENT_ID = 'env-client';
      process.env.OIDC_CLIENT_SECRET = 'env-secret';
      process.env.OIDC_BUTTON_LABEL = 'Continue with Env IdP';

      const dto = await service.toDto();
      expect(dto).toEqual({
        envManaged: true,
        enabled: true,
        issuerUrl: 'https://env-idp.example.com',
        clientId: 'env-client',
        label: 'Continue with Env IdP',
        hasClientSecret: true,
        updatedAt: null,
        jitDefaultWorkspaceId: null,
        jitDefaultRole: Role.VIEWER,
      });
      expect(JSON.stringify(dto)).not.toContain('env-secret');
    });

    it('reports envManaged: false with the DB row summarised, secret never included', async () => {
      const updatedAt = new Date('2026-07-02T00:00:00Z');
      prisma.oidcConfig.findUnique.mockResolvedValue({
        id: OIDC_CONFIG_SINGLETON_ID,
        enabled: true,
        issuerUrl: 'https://db-idp.example.com',
        clientId: 'db-client',
        clientSecretEncrypted: encryptOidcClientSecret('super-secret-value'),
        label: 'Okta',
        updatedAt,
      });

      const dto = await service.toDto();
      expect(dto).toEqual({
        envManaged: false,
        enabled: true,
        issuerUrl: 'https://db-idp.example.com',
        clientId: 'db-client',
        label: 'Okta',
        hasClientSecret: true,
        updatedAt: updatedAt.toISOString(),
        jitDefaultWorkspaceId: null,
        jitDefaultRole: Role.VIEWER,
      });
      expect(JSON.stringify(dto)).not.toContain('super-secret-value');
    });

    it('reports hasClientSecret: false and default label when never configured', async () => {
      prisma.oidcConfig.findUnique.mockResolvedValue(null);
      const dto = await service.toDto();
      expect(dto).toEqual({
        envManaged: false,
        enabled: false,
        issuerUrl: null,
        clientId: null,
        label: 'Single sign-on',
        hasClientSecret: false,
        updatedAt: null,
        jitDefaultWorkspaceId: null,
        jitDefaultRole: Role.VIEWER,
      });
    });
  });

  describe('upsert', () => {
    it('creates the singleton row with the encrypted secret when none exists yet', async () => {
      prisma.oidcConfig.findUnique.mockResolvedValue(null);
      prisma.oidcConfig.create.mockResolvedValue({});

      await service.upsert({
        enabled: true,
        issuerUrl: 'https://idp.example.com',
        clientId: 'client-1',
        clientSecret: 'brand-new-secret',
        label: 'Okta',
        jitDefaultWorkspaceId: null,
        jitDefaultRole: Role.VIEWER,
      });

      expect(prisma.oidcConfig.create).toHaveBeenCalledTimes(1);
      const data = prisma.oidcConfig.create.mock.calls[0][0].data;
      expect(data.id).toBe(OIDC_CONFIG_SINGLETON_ID);
      expect(data.clientSecretEncrypted).toBeDefined();
      expect(data.clientSecretEncrypted).not.toContain('brand-new-secret');
    });

    it('leaves the stored secret untouched when clientSecret is omitted on update', async () => {
      prisma.oidcConfig.findUnique.mockResolvedValue({
        id: OIDC_CONFIG_SINGLETON_ID,
        enabled: true,
        issuerUrl: 'https://idp.example.com',
        clientId: 'client-1',
        clientSecretEncrypted: 'existing-encrypted-value',
        label: 'Okta',
        updatedAt: new Date(),
      });
      prisma.oidcConfig.update.mockResolvedValue({});

      await service.upsert({
        enabled: false,
        issuerUrl: 'https://idp.example.com',
        clientId: 'client-1',
        label: 'Okta',
        jitDefaultWorkspaceId: null,
        jitDefaultRole: Role.VIEWER,
        // clientSecret intentionally omitted
      });

      expect(prisma.oidcConfig.update).toHaveBeenCalledTimes(1);
      const data = prisma.oidcConfig.update.mock.calls[0][0].data;
      expect(data.clientSecretEncrypted).toBeUndefined();
      expect(data.enabled).toBe(false);
    });

    it('persists JIT provisioning fields', async () => {
      prisma.oidcConfig.findUnique.mockResolvedValue(null);
      prisma.oidcConfig.create.mockResolvedValue({});

      await service.upsert({
        enabled: true,
        issuerUrl: 'https://idp.example.com',
        clientId: 'client-1',
        clientSecret: 'brand-new-secret',
        label: 'Okta',
        jitDefaultWorkspaceId: 'ws-1',
        jitDefaultRole: Role.MEMBER,
      });

      const data = prisma.oidcConfig.create.mock.calls[0][0].data;
      expect(data.jitDefaultWorkspaceId).toBe('ws-1');
      expect(data.jitDefaultRole).toBe(Role.MEMBER);
    });
  });

  describe('JIT provisioning surfaced by getEffectiveConfig/toDto', () => {
    it('surfaces the DB row jitDefaultWorkspaceId/jitDefaultRole in getEffectiveConfig', async () => {
      prisma.oidcConfig.findUnique.mockResolvedValue({
        id: OIDC_CONFIG_SINGLETON_ID,
        enabled: true,
        issuerUrl: 'https://idp.example.com',
        clientId: 'db-client',
        clientSecretEncrypted: encryptOidcClientSecret('db-secret'),
        label: 'Okta (DB)',
        jitDefaultWorkspaceId: 'ws-1',
        jitDefaultRole: Role.MEMBER,
        updatedAt: new Date(),
      });

      const config = await service.getEffectiveConfig();
      expect(config?.jitDefaultWorkspaceId).toBe('ws-1');
      expect(config?.jitDefaultRole).toBe(Role.MEMBER);
    });

    it('env-managed config always reports JIT off (null/VIEWER) — env vars have no room for it', async () => {
      process.env.OIDC_ISSUER_URL = 'https://env-idp.example.com';
      process.env.OIDC_CLIENT_ID = 'env-client';
      process.env.OIDC_CLIENT_SECRET = 'env-secret';

      const config = await service.getEffectiveConfig();
      expect(config?.jitDefaultWorkspaceId).toBeNull();
      expect(config?.jitDefaultRole).toBe(Role.VIEWER);

      const dto = await service.toDto();
      expect(dto.jitDefaultWorkspaceId).toBeNull();
      expect(dto.jitDefaultRole).toBe(Role.VIEWER);
    });

    it('toDto surfaces the DB row JIT rule when not env-managed', async () => {
      prisma.oidcConfig.findUnique.mockResolvedValue({
        id: OIDC_CONFIG_SINGLETON_ID,
        enabled: true,
        issuerUrl: 'https://idp.example.com',
        clientId: 'db-client',
        clientSecretEncrypted: encryptOidcClientSecret('db-secret'),
        label: 'Okta',
        jitDefaultWorkspaceId: 'ws-1',
        jitDefaultRole: Role.MEMBER,
        updatedAt: new Date(),
      });

      const dto = await service.toDto();
      expect(dto.jitDefaultWorkspaceId).toBe('ws-1');
      expect(dto.jitDefaultRole).toBe(Role.MEMBER);
    });
  });
});
