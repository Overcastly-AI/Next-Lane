/**
 * Unit tests for SsoProvidersService — the SSO/OIDC Phase 2
 * N-simultaneous-providers list (additive alongside the Phase-1
 * `OidcConfigService` singleton, covered separately).
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Role, SsoProviderType } from '@next-lane/shared';
import { SsoProvidersService, toSsoProviderDto, defaultSpEntityId } from './sso-providers.service';
import type { PrismaService } from '../prisma/prisma.service';

const VALID_CERT = '-----BEGIN CERTIFICATE-----\nMIIB...fake...\n-----END CERTIFICATE-----';

interface MockPrisma {
  ssoProvider: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  workspace: {
    findUnique: jest.Mock;
  };
}

function makePrisma(): MockPrisma {
  return {
    ssoProvider: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    workspace: {
      findUnique: jest.fn().mockResolvedValue({ id: 'ws-1' }),
    },
  };
}

function baseRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'sp-1',
    type: SsoProviderType.OIDC,
    enabled: true,
    label: 'Okta',
    slug: 'okta',
    issuerUrl: 'https://idp.example.com',
    clientId: 'client-1',
    clientSecretEncrypted: 'encrypted-value',
    samlEntryPoint: null,
    samlIdpIssuer: null,
    samlIdpCertificate: null,
    samlSpEntityId: null,
    samlWantAssertionsSigned: true,
    jitDefaultWorkspaceId: null,
    jitDefaultRole: Role.VIEWER,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-02T00:00:00Z'),
    ...overrides,
  };
}

describe('SsoProvidersService', () => {
  let prisma: MockPrisma;
  let service: SsoProvidersService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new SsoProvidersService(prisma as unknown as PrismaService);
  });

  describe('toSsoProviderDto — never leaks secrets', () => {
    it('maps hasClientSecret/hasSamlIdpCertificate booleans only, never the raw values', () => {
      const dto = toSsoProviderDto(
        baseRow({
          type: SsoProviderType.SAML,
          issuerUrl: null,
          clientId: null,
          clientSecretEncrypted: null,
          samlEntryPoint: 'https://idp.example.com/sso',
          samlIdpIssuer: 'https://idp.example.com',
          samlIdpCertificate: VALID_CERT,
        }) as never,
      );
      expect(dto.hasSamlIdpCertificate).toBe(true);
      expect(JSON.stringify(dto)).not.toContain('BEGIN CERTIFICATE');
      expect(dto.hasClientSecret).toBe(false);
      expect(JSON.stringify(dto)).not.toContain('encrypted-value');
    });

    it('falls back to the computed default samlSpEntityId when unset', () => {
      const dto = toSsoProviderDto(baseRow({ slug: 'adfs' }) as never);
      expect(dto.samlSpEntityId).toBe(defaultSpEntityId('adfs'));
    });
  });

  describe('create — OIDC', () => {
    it('rejects when issuerUrl/clientId/clientSecret are missing', async () => {
      await expect(
        service.create({ type: SsoProviderType.OIDC, label: 'Okta' } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.ssoProvider.create).not.toHaveBeenCalled();
    });

    it('auto-generates a slug from the label when omitted', async () => {
      prisma.ssoProvider.create.mockResolvedValue(baseRow({ slug: 'okta-eng' }));

      await service.create({
        type: SsoProviderType.OIDC,
        label: 'Okta Eng',
        issuerUrl: 'https://idp.example.com',
        clientId: 'client-1',
        clientSecret: 'shh',
      } as never);

      const data = prisma.ssoProvider.create.mock.calls[0][0].data;
      expect(data.slug).toBe('okta-eng');
    });

    it('retries slug generation on collision', async () => {
      prisma.ssoProvider.findUnique
        .mockResolvedValueOnce({ id: 'existing' }) // "okta" taken
        .mockResolvedValueOnce(null); // "okta-1" free
      prisma.ssoProvider.create.mockResolvedValue(baseRow());

      await service.create({
        type: SsoProviderType.OIDC,
        label: 'Okta',
        issuerUrl: 'https://idp.example.com',
        clientId: 'client-1',
        clientSecret: 'shh',
      } as never);

      const data = prisma.ssoProvider.create.mock.calls[0][0].data;
      expect(data.slug).toBe('okta-1');
    });

    it('encrypts the client secret — never stores it in plaintext', async () => {
      prisma.ssoProvider.create.mockResolvedValue(baseRow());

      await service.create({
        type: SsoProviderType.OIDC,
        label: 'Okta',
        slug: 'okta',
        issuerUrl: 'https://idp.example.com',
        clientId: 'client-1',
        clientSecret: 'super-secret-raw-value',
      } as never);

      const data = prisma.ssoProvider.create.mock.calls[0][0].data;
      expect(data.clientSecretEncrypted).toBeDefined();
      expect(data.clientSecretEncrypted).not.toContain('super-secret-raw-value');
    });
  });

  describe('create — SAML', () => {
    it('rejects when samlEntryPoint/samlIdpIssuer/samlIdpCertificate are missing', async () => {
      await expect(
        service.create({ type: SsoProviderType.SAML, label: 'Corp ADFS' } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a certificate value without PEM markers', async () => {
      await expect(
        service.create({
          type: SsoProviderType.SAML,
          label: 'Corp ADFS',
          samlEntryPoint: 'https://adfs.example.com/sso',
          samlIdpIssuer: 'https://adfs.example.com',
          samlIdpCertificate: 'not-a-real-certificate',
        } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.ssoProvider.create).not.toHaveBeenCalled();
    });

    it('accepts a well-formed PEM certificate', async () => {
      prisma.ssoProvider.create.mockResolvedValue(
        baseRow({
          type: SsoProviderType.SAML,
          issuerUrl: null,
          clientId: null,
          clientSecretEncrypted: null,
          samlEntryPoint: 'https://adfs.example.com/sso',
          samlIdpIssuer: 'https://adfs.example.com',
          samlIdpCertificate: VALID_CERT,
        }),
      );

      const dto = await service.create({
        type: SsoProviderType.SAML,
        label: 'Corp ADFS',
        slug: 'corp-adfs',
        samlEntryPoint: 'https://adfs.example.com/sso',
        samlIdpIssuer: 'https://adfs.example.com',
        samlIdpCertificate: VALID_CERT,
      } as never);

      expect(dto.type).toBe(SsoProviderType.SAML);
      expect(dto.hasSamlIdpCertificate).toBe(true);
    });
  });

  describe('create — JIT provisioning', () => {
    it('rejects a jitDefaultWorkspaceId that does not exist', async () => {
      prisma.workspace.findUnique.mockResolvedValue(null);

      await expect(
        service.create({
          type: SsoProviderType.OIDC,
          label: 'Okta',
          issuerUrl: 'https://idp.example.com',
          clientId: 'client-1',
          clientSecret: 'shh',
          jitDefaultWorkspaceId: 'nonexistent-ws',
        } as never),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.ssoProvider.create).not.toHaveBeenCalled();
    });

    it('defaults jitDefaultRole to VIEWER when a workspace is set without an explicit role', async () => {
      prisma.ssoProvider.create.mockResolvedValue(baseRow({ jitDefaultWorkspaceId: 'ws-1' }));

      await service.create({
        type: SsoProviderType.OIDC,
        label: 'Okta',
        issuerUrl: 'https://idp.example.com',
        clientId: 'client-1',
        clientSecret: 'shh',
        jitDefaultWorkspaceId: 'ws-1',
      } as never);

      const data = prisma.ssoProvider.create.mock.calls[0][0].data;
      expect(data.jitDefaultRole).toBe(Role.VIEWER);
    });
  });

  describe('update', () => {
    it('throws NotFoundException for an unknown id', async () => {
      prisma.ssoProvider.findUnique.mockResolvedValue(null);
      await expect(service.update('missing', { label: 'New' } as never)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('merges partial OIDC fields onto the existing row, leaving SAML fields untouched', async () => {
      prisma.ssoProvider.findUnique.mockResolvedValue(baseRow());
      prisma.ssoProvider.update.mockResolvedValue(baseRow({ label: 'Okta (renamed)' }));

      await service.update('sp-1', { label: 'Okta (renamed)' } as never);

      const data = prisma.ssoProvider.update.mock.calls[0][0].data;
      expect(data.label).toBe('Okta (renamed)');
      expect(data.issuerUrl).toBe('https://idp.example.com');
      expect(data.samlEntryPoint).toBeUndefined();
    });

    it('rejects replacing the SAML certificate with a non-PEM value', async () => {
      prisma.ssoProvider.findUnique.mockResolvedValue(
        baseRow({
          type: SsoProviderType.SAML,
          samlEntryPoint: 'https://adfs.example.com/sso',
          samlIdpIssuer: 'https://adfs.example.com',
          samlIdpCertificate: VALID_CERT,
        }),
      );

      await expect(
        service.update('sp-1', { samlIdpCertificate: 'garbage' } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.ssoProvider.update).not.toHaveBeenCalled();
    });

    it('rejects a jitDefaultWorkspaceId that does not exist', async () => {
      prisma.ssoProvider.findUnique.mockResolvedValue(baseRow());
      prisma.workspace.findUnique.mockResolvedValue(null);

      await expect(
        service.update('sp-1', { jitDefaultWorkspaceId: 'nonexistent-ws' } as never),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('clears jitDefaultWorkspaceId when explicitly set to null', async () => {
      prisma.ssoProvider.findUnique.mockResolvedValue(
        baseRow({ jitDefaultWorkspaceId: 'ws-1', jitDefaultRole: Role.MEMBER }),
      );
      prisma.ssoProvider.update.mockResolvedValue(baseRow({ jitDefaultWorkspaceId: null }));

      await service.update('sp-1', { jitDefaultWorkspaceId: null } as never);

      const data = prisma.ssoProvider.update.mock.calls[0][0].data;
      expect(data.jitDefaultWorkspaceId).toBeNull();
    });
  });

  describe('remove', () => {
    it('throws NotFoundException for an unknown id', async () => {
      prisma.ssoProvider.findUnique.mockResolvedValue(null);
      await expect(service.remove('missing')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.ssoProvider.delete).not.toHaveBeenCalled();
    });

    it('deletes an existing row', async () => {
      prisma.ssoProvider.findUnique.mockResolvedValue(baseRow());
      await service.remove('sp-1');
      expect(prisma.ssoProvider.delete).toHaveBeenCalledWith({ where: { id: 'sp-1' } });
    });
  });

  describe('findEnabledSummaries', () => {
    it('queries only enabled rows with a minimal select', async () => {
      prisma.ssoProvider.findMany.mockResolvedValue([
        { slug: 'okta', type: SsoProviderType.OIDC, label: 'Okta' },
      ]);

      const result = await service.findEnabledSummaries();

      expect(prisma.ssoProvider.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { enabled: true } }),
      );
      expect(result).toEqual([{ slug: 'okta', type: SsoProviderType.OIDC, label: 'Okta' }]);
    });
  });
});
