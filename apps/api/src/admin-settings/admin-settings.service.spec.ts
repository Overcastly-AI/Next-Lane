/**
 * Unit tests for AdminSettingsService — the instance-admin gate and the
 * PATCH /admin/oidc-config validation/merge rules.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AdminSettingsService } from './admin-settings.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { OidcConfigService } from './oidc-config.service';

interface MockPrisma {
  user: { findUnique: jest.Mock };
}

function makePrisma(isInstanceAdmin: boolean): MockPrisma {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue({ isInstanceAdmin }),
    },
  };
}

function makeOidcConfig(): jest.Mocked<
  Pick<OidcConfigService, 'toDto' | 'getRawDbConfig' | 'upsert'>
> {
  return {
    toDto: jest.fn().mockResolvedValue({
      envManaged: false,
      enabled: false,
      issuerUrl: null,
      clientId: null,
      label: 'Single sign-on',
      hasClientSecret: false,
      updatedAt: null,
    }),
    getRawDbConfig: jest.fn().mockResolvedValue(null),
    upsert: jest.fn().mockResolvedValue({}),
  };
}

const ENV_KEYS = ['OIDC_ISSUER_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET'];

describe('AdminSettingsService', () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      originalEnv[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (originalEnv[k] === undefined) delete process.env[k];
      else process.env[k] = originalEnv[k];
    }
  });

  describe('instance-admin gate', () => {
    it('getOidcConfig rejects a non-instance-admin with ForbiddenException', async () => {
      const prisma = makePrisma(false);
      const oidcConfig = makeOidcConfig();
      const service = new AdminSettingsService(
        prisma as unknown as PrismaService,
        oidcConfig as unknown as OidcConfigService,
      );

      await expect(service.getOidcConfig('user-1')).rejects.toBeInstanceOf(ForbiddenException);
      expect(oidcConfig.toDto).not.toHaveBeenCalled();
    });

    it('updateOidcConfig rejects a non-instance-admin with ForbiddenException', async () => {
      const prisma = makePrisma(false);
      const oidcConfig = makeOidcConfig();
      const service = new AdminSettingsService(
        prisma as unknown as PrismaService,
        oidcConfig as unknown as OidcConfigService,
      );

      await expect(service.updateOidcConfig('user-1', { enabled: true })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(oidcConfig.upsert).not.toHaveBeenCalled();
    });

    it('getOidcConfig succeeds for an instance admin', async () => {
      const prisma = makePrisma(true);
      const oidcConfig = makeOidcConfig();
      const service = new AdminSettingsService(
        prisma as unknown as PrismaService,
        oidcConfig as unknown as OidcConfigService,
      );

      await expect(service.getOidcConfig('user-1')).resolves.toEqual(
        expect.objectContaining({ envManaged: false }),
      );
    });
  });

  describe('updateOidcConfig — env-pinned deployments', () => {
    it('rejects any write when env vars are set (form is read-only)', async () => {
      process.env.OIDC_ISSUER_URL = 'https://idp.example.com';
      process.env.OIDC_CLIENT_ID = 'client-1';
      process.env.OIDC_CLIENT_SECRET = 'shh';

      const prisma = makePrisma(true);
      const oidcConfig = makeOidcConfig();
      const service = new AdminSettingsService(
        prisma as unknown as PrismaService,
        oidcConfig as unknown as OidcConfigService,
      );

      await expect(service.updateOidcConfig('user-1', { enabled: true })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(oidcConfig.upsert).not.toHaveBeenCalled();
    });
  });

  describe('updateOidcConfig — validation', () => {
    it('rejects enabling without an issuer URL / client ID / secret', async () => {
      const prisma = makePrisma(true);
      const oidcConfig = makeOidcConfig();
      const service = new AdminSettingsService(
        prisma as unknown as PrismaService,
        oidcConfig as unknown as OidcConfigService,
      );

      await expect(service.updateOidcConfig('user-1', { enabled: true })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(oidcConfig.upsert).not.toHaveBeenCalled();
    });

    it('accepts enabling with all required fields present in one call', async () => {
      const prisma = makePrisma(true);
      const oidcConfig = makeOidcConfig();
      const service = new AdminSettingsService(
        prisma as unknown as PrismaService,
        oidcConfig as unknown as OidcConfigService,
      );

      await service.updateOidcConfig('user-1', {
        enabled: true,
        issuerUrl: 'https://idp.example.com',
        clientId: 'client-1',
        clientSecret: 'new-secret',
      });

      expect(oidcConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: true,
          issuerUrl: 'https://idp.example.com',
          clientId: 'client-1',
          clientSecret: 'new-secret',
        }),
      );
    });

    it('accepts enabling when the secret was already saved in a prior partial save', async () => {
      const prisma = makePrisma(true);
      const oidcConfig = makeOidcConfig();
      oidcConfig.getRawDbConfig.mockResolvedValue({
        id: 'singleton',
        enabled: false,
        issuerUrl: 'https://idp.example.com',
        clientId: 'client-1',
        clientSecretEncrypted: 'already-encrypted-value',
        label: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const service = new AdminSettingsService(
        prisma as unknown as PrismaService,
        oidcConfig as unknown as OidcConfigService,
      );

      // Just flipping `enabled` — no clientSecret in this call.
      await service.updateOidcConfig('user-1', { enabled: true });

      expect(oidcConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: true, issuerUrl: 'https://idp.example.com', clientId: 'client-1' }),
      );
    });

    it('allows saving issuer/client id/secret while still disabled (staged config)', async () => {
      const prisma = makePrisma(true);
      const oidcConfig = makeOidcConfig();
      const service = new AdminSettingsService(
        prisma as unknown as PrismaService,
        oidcConfig as unknown as OidcConfigService,
      );

      await service.updateOidcConfig('user-1', {
        issuerUrl: 'https://idp.example.com',
        clientId: 'client-1',
        clientSecret: 'staged-secret',
      });

      expect(oidcConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: false }),
      );
    });
  });
});
