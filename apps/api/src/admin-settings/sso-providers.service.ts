/**
 * SsoProvidersService — CRUD + resolution for the SSO/OIDC Phase 2
 * N-simultaneous-providers list (`SsoProvider` table), ADDITIVE alongside
 * (never replacing) the Phase-1 `OidcConfigService` singleton. See
 * `SsoProvider`'s Prisma doc comment for the full model rationale.
 *
 * Every write here is instance-admin gated by the controller
 * (`assertInstanceAdmin`, same as `AdminSettingsService`).
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type SsoProvider } from '@prisma/client';
import { Role, SsoProviderType, type SsoProviderDto } from '@next-lane/shared';
import { PrismaService } from '../prisma/prisma.service';
import { encryptOidcClientSecret } from '../auth/oidc/oidc-secret-crypto.util';
import type { CreateSsoProviderDto } from './dto/create-sso-provider.dto';
import type { UpdateSsoProviderDto } from './dto/update-sso-provider.dto';

/** Very loose PEM sanity check — a real X.509 parse happens on first actual login attempt (node-saml/xml-crypto); this just catches "pasted the wrong thing" early. */
const PEM_CERT_MARKER = /-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/;

function slugify(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function toSsoProviderDto(row: SsoProvider): SsoProviderDto {
  return {
    id: row.id,
    type: row.type as SsoProviderType,
    enabled: row.enabled,
    label: row.label,
    slug: row.slug,
    issuerUrl: row.issuerUrl,
    clientId: row.clientId,
    hasClientSecret: !!row.clientSecretEncrypted,
    samlEntryPoint: row.samlEntryPoint,
    samlIdpIssuer: row.samlIdpIssuer,
    hasSamlIdpCertificate: !!row.samlIdpCertificate,
    samlSpEntityId: row.samlSpEntityId ?? defaultSpEntityId(row.slug),
    jitDefaultWorkspaceId: row.jitDefaultWorkspaceId,
    jitDefaultRole: row.jitDefaultRole as Role,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Default SP Entity ID / expected `<AudienceRestriction>` when the admin doesn't set an explicit override. */
export function defaultSpEntityId(slug: string): string {
  const base = (process.env.WEB_BASE_URL ?? process.env.RESET_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  return `${base}/api/auth/sso/${slug}`;
}

@Injectable()
export class SsoProvidersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<SsoProviderDto[]> {
    const rows = await this.prisma.ssoProvider.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map(toSsoProviderDto);
  }

  /** All ENABLED providers — the public, unauthenticated summary the login page renders buttons from. */
  async findEnabledSummaries(): Promise<Array<{ slug: string; type: SsoProviderType; label: string }>> {
    const rows = await this.prisma.ssoProvider.findMany({
      where: { enabled: true },
      orderBy: { createdAt: 'asc' },
      select: { slug: true, type: true, label: true },
    });
    return rows.map((r) => ({ slug: r.slug, type: r.type as SsoProviderType, label: r.label }));
  }

  /** The raw row (secrets stay encrypted) for a given slug, or null. Used by `SsoService` to resolve a login/callback request. */
  async findBySlug(slug: string): Promise<SsoProvider | null> {
    return this.prisma.ssoProvider.findUnique({ where: { slug } });
  }

  private async assertJitWorkspaceExists(workspaceId: string): Promise<void> {
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } });
    if (!workspace) {
      throw new NotFoundException('The selected JIT default workspace does not exist.');
    }
  }

  /** Optimistic unique slug from `label` (or the admin-supplied one): reads existing rows and appends `-N` on a match. This is only the pre-check — the create() write path catches the P2002 a concurrent create can still cause and retries, mirroring `WorkspacesService`. */
  private async uniqueSlug(candidate: string): Promise<string> {
    const base = candidate || 'provider';
    let slug = base;
    let n = 1;
    while (await this.prisma.ssoProvider.findUnique({ where: { slug } })) {
      slug = `${base}-${n++}`;
    }
    return slug;
  }

  async create(dto: CreateSsoProviderDto): Promise<SsoProviderDto> {
    if (dto.type === SsoProviderType.OIDC) {
      if (!dto.issuerUrl || !dto.clientId || !dto.clientSecret) {
        throw new BadRequestException(
          'issuerUrl, clientId, and clientSecret are all required for an OIDC provider.',
        );
      }
    } else {
      if (!dto.samlEntryPoint || !dto.samlIdpIssuer || !dto.samlIdpCertificate) {
        throw new BadRequestException(
          'samlEntryPoint, samlIdpIssuer, and samlIdpCertificate are all required for a SAML provider.',
        );
      }
      if (!PEM_CERT_MARKER.test(dto.samlIdpCertificate)) {
        throw new BadRequestException(
          'samlIdpCertificate must contain one or more PEM-encoded certificates (-----BEGIN CERTIFICATE-----...-----END CERTIFICATE-----).',
        );
      }
    }

    if (dto.jitDefaultWorkspaceId) {
      await this.assertJitWorkspaceExists(dto.jitDefaultWorkspaceId);
    }

    const baseSlug = dto.slug ? dto.slug : slugify(dto.label);
    const data = {
      type: dto.type,
      label: dto.label,
      enabled: dto.enabled ?? true,
      issuerUrl: dto.type === SsoProviderType.OIDC ? (dto.issuerUrl ?? null) : null,
      clientId: dto.type === SsoProviderType.OIDC ? (dto.clientId ?? null) : null,
      clientSecretEncrypted:
        dto.type === SsoProviderType.OIDC && dto.clientSecret
          ? encryptOidcClientSecret(dto.clientSecret)
          : null,
      samlEntryPoint: dto.type === SsoProviderType.SAML ? (dto.samlEntryPoint ?? null) : null,
      samlIdpIssuer: dto.type === SsoProviderType.SAML ? (dto.samlIdpIssuer ?? null) : null,
      samlIdpCertificate: dto.type === SsoProviderType.SAML ? (dto.samlIdpCertificate ?? null) : null,
      samlSpEntityId: dto.type === SsoProviderType.SAML ? (dto.samlSpEntityId ?? null) : null,
      jitDefaultWorkspaceId: dto.jitDefaultWorkspaceId ?? null,
      jitDefaultRole: dto.jitDefaultRole ?? Role.VIEWER,
    };

    // The uniqueSlug pre-check is optimistic; a concurrent create can still
    // win the unique index between our read and write. Catch that P2002 and
    // retry with a freshly-computed slug (mirrors WorkspacesService.create).
    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = await this.uniqueSlug(baseSlug);
      try {
        const row = await this.prisma.ssoProvider.create({ data: { ...data, slug } });
        return toSsoProviderDto(row);
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002' &&
          attempt < 4
        ) {
          continue; // slug raced — recompute and retry
        }
        throw err;
      }
    }
    // Unreachable in practice (the loop returns or throws on the last attempt).
    throw new ConflictException('Could not allocate a unique SSO provider slug.');
  }

  async update(id: string, dto: UpdateSsoProviderDto): Promise<SsoProviderDto> {
    const existing = await this.prisma.ssoProvider.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('SSO provider not found.');
    }

    if (dto.jitDefaultWorkspaceId) {
      await this.assertJitWorkspaceExists(dto.jitDefaultWorkspaceId);
    }

    // Re-validate the SAML cert marker only when a new one is actually being set.
    if (existing.type === SsoProviderType.SAML && dto.samlIdpCertificate && !PEM_CERT_MARKER.test(dto.samlIdpCertificate)) {
      throw new BadRequestException(
        'samlIdpCertificate must contain one or more PEM-encoded certificates (-----BEGIN CERTIFICATE-----...-----END CERTIFICATE-----).',
      );
    }

    const row = await this.prisma.ssoProvider.update({
      where: { id },
      data: {
        label: dto.label ?? existing.label,
        enabled: dto.enabled ?? existing.enabled,
        ...(existing.type === SsoProviderType.OIDC
          ? {
              issuerUrl: dto.issuerUrl ?? existing.issuerUrl,
              clientId: dto.clientId ?? existing.clientId,
              ...(dto.clientSecret ? { clientSecretEncrypted: encryptOidcClientSecret(dto.clientSecret) } : {}),
            }
          : {
              samlEntryPoint: dto.samlEntryPoint ?? existing.samlEntryPoint,
              samlIdpIssuer: dto.samlIdpIssuer ?? existing.samlIdpIssuer,
              samlIdpCertificate: dto.samlIdpCertificate ?? existing.samlIdpCertificate,
              samlSpEntityId: dto.samlSpEntityId !== undefined ? dto.samlSpEntityId : existing.samlSpEntityId,
            }),
        jitDefaultWorkspaceId:
          dto.jitDefaultWorkspaceId !== undefined ? dto.jitDefaultWorkspaceId : existing.jitDefaultWorkspaceId,
        jitDefaultRole: dto.jitDefaultRole ?? existing.jitDefaultRole,
      },
    });

    return toSsoProviderDto(row);
  }

  async remove(id: string): Promise<void> {
    const existing = await this.prisma.ssoProvider.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('SSO provider not found.');
    }
    await this.prisma.ssoProvider.delete({ where: { id } });
  }
}
