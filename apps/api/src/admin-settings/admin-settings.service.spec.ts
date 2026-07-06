/**
 * Unit tests for AdminSettingsService — the instance-admin gate and the
 * PATCH /admin/oidc-config validation/merge rules.
 */
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@next-lane/shared';
import { AdminSettingsService } from './admin-settings.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { OidcConfigService } from './oidc-config.service';
import type { SsoProvidersService } from './sso-providers.service';

interface MockPrisma {
  user: { findUnique: jest.Mock };
  workspace: { findUnique: jest.Mock };
}

function makePrisma(isInstanceAdmin: boolean): MockPrisma {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue({ isInstanceAdmin }),
    },
    // SSO/OIDC Phase 2 — JIT default-workspace existence check.
    workspace: {
      findUnique: jest.fn().mockResolvedValue({ id: 'ws-1' }),
    },
  };
}

function makeSsoProviders(): jest.Mocked<
  Pick<SsoProvidersService, 'findAll' | 'create' | 'update' | 'remove'>
> {
  return {
    findAll: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
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
      jitDefaultWorkspaceId: null,
      jitDefaultRole: Role.VIEWER,
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
        makeSsoProviders() as unknown as SsoProvidersService,
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
        makeSsoProviders() as unknown as SsoProvidersService,
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
        makeSsoProviders() as unknown as SsoProvidersService,
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
        makeSsoProviders() as unknown as SsoProvidersService,
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
        makeSsoProviders() as unknown as SsoProvidersService,
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
        makeSsoProviders() as unknown as SsoProvidersService,
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
        jitDefaultWorkspaceId: null,
        jitDefaultRole: Role.VIEWER,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const service = new AdminSettingsService(
        prisma as unknown as PrismaService,
        oidcConfig as unknown as OidcConfigService,
        makeSsoProviders() as unknown as SsoProvidersService,
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
        makeSsoProviders() as unknown as SsoProvidersService,
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

  describe('updateOidcConfig — JIT provisioning (Phase 2)', () => {
    it('rejects a jitDefaultWorkspaceId that does not exist', async () => {
      const prisma = makePrisma(true);
      prisma.workspace.findUnique.mockResolvedValue(null);
      const oidcConfig = makeOidcConfig();
      const service = new AdminSettingsService(
        prisma as unknown as PrismaService,
        oidcConfig as unknown as OidcConfigService,
        makeSsoProviders() as unknown as SsoProvidersService,
      );

      await expect(
        service.updateOidcConfig('user-1', { jitDefaultWorkspaceId: 'nonexistent-ws' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(oidcConfig.upsert).not.toHaveBeenCalled();
    });

    it('accepts a jitDefaultWorkspaceId that exists and defaults the role to VIEWER when omitted', async () => {
      const prisma = makePrisma(true);
      const oidcConfig = makeOidcConfig();
      const service = new AdminSettingsService(
        prisma as unknown as PrismaService,
        oidcConfig as unknown as OidcConfigService,
        makeSsoProviders() as unknown as SsoProvidersService,
      );

      await service.updateOidcConfig('user-1', { jitDefaultWorkspaceId: 'ws-1' });

      expect(prisma.workspace.findUnique).toHaveBeenCalledWith({
        where: { id: 'ws-1' },
        select: { id: true },
      });
      expect(oidcConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ jitDefaultWorkspaceId: 'ws-1', jitDefaultRole: Role.VIEWER }),
      );
    });

    it('respects an explicit jitDefaultRole', async () => {
      const prisma = makePrisma(true);
      const oidcConfig = makeOidcConfig();
      const service = new AdminSettingsService(
        prisma as unknown as PrismaService,
        oidcConfig as unknown as OidcConfigService,
        makeSsoProviders() as unknown as SsoProvidersService,
      );

      await service.updateOidcConfig('user-1', {
        jitDefaultWorkspaceId: 'ws-1',
        jitDefaultRole: Role.MEMBER,
      });

      expect(oidcConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ jitDefaultWorkspaceId: 'ws-1', jitDefaultRole: Role.MEMBER }),
      );
    });

    it('clears JIT provisioning when jitDefaultWorkspaceId is explicitly null', async () => {
      const prisma = makePrisma(true);
      const oidcConfig = makeOidcConfig();
      oidcConfig.getRawDbConfig.mockResolvedValue({
        id: 'singleton',
        enabled: false,
        issuerUrl: null,
        clientId: null,
        clientSecretEncrypted: null,
        label: null,
        jitDefaultWorkspaceId: 'ws-1',
        jitDefaultRole: Role.MEMBER,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const service = new AdminSettingsService(
        prisma as unknown as PrismaService,
        oidcConfig as unknown as OidcConfigService,
        makeSsoProviders() as unknown as SsoProvidersService,
      );

      await service.updateOidcConfig('user-1', { jitDefaultWorkspaceId: null });

      expect(prisma.workspace.findUnique).not.toHaveBeenCalled();
      expect(oidcConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ jitDefaultWorkspaceId: null }),
      );
    });

    it('leaves an existing JIT rule unchanged when jitDefaultWorkspaceId is omitted', async () => {
      const prisma = makePrisma(true);
      const oidcConfig = makeOidcConfig();
      oidcConfig.getRawDbConfig.mockResolvedValue({
        id: 'singleton',
        enabled: false,
        issuerUrl: null,
        clientId: null,
        clientSecretEncrypted: null,
        label: null,
        jitDefaultWorkspaceId: 'ws-1',
        jitDefaultRole: Role.MEMBER,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const service = new AdminSettingsService(
        prisma as unknown as PrismaService,
        oidcConfig as unknown as OidcConfigService,
        makeSsoProviders() as unknown as SsoProvidersService,
      );

      await service.updateOidcConfig('user-1', { label: 'New label' });

      expect(oidcConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ jitDefaultWorkspaceId: 'ws-1', jitDefaultRole: Role.MEMBER }),
      );
    });
  });
});
