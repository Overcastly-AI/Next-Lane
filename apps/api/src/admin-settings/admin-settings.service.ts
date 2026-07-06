import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Role, type OidcConfigDto, type SsoProviderDto } from '@next-lane/shared';
import { PrismaService } from '../prisma/prisma.service';
import { assertInstanceAdmin } from '../common/membership.util';
import { OidcConfigService } from './oidc-config.service';
import { SsoProvidersService } from './sso-providers.service';
import { getOidcEnvConfig } from '../auth/oidc/oidc.config';
import type { UpdateOidcConfigDto } from './dto/update-oidc-config.dto';
import type { CreateSsoProviderDto } from './dto/create-sso-provider.dto';
import type { UpdateSsoProviderDto } from './dto/update-sso-provider.dto';

@Injectable()
export class AdminSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly oidcConfig: OidcConfigService,
    private readonly ssoProviders: SsoProvidersService,
  ) {}

  /** GET /admin/oidc-config — instance-admin only. Never returns the client secret. */
  async getOidcConfig(userId: string): Promise<OidcConfigDto> {
    await assertInstanceAdmin(this.prisma, userId);
    return this.oidcConfig.toDto();
  }

  /**
   * PATCH /admin/oidc-config — instance-admin only. Merges onto the existing
   * stored row (partial saves don't clobber untouched fields); the secret is
   * write-only and left unchanged when omitted. Rejects the write outright
   * when env vars are pinned — the in-app form is read-only in that state
   * (the "env-managed" banner), so a save here would silently do nothing
   * useful and should fail loudly instead.
   */
  async updateOidcConfig(userId: string, dto: UpdateOidcConfigDto): Promise<OidcConfigDto> {
    await assertInstanceAdmin(this.prisma, userId);

    if (getOidcEnvConfig()) {
      throw new BadRequestException(
        'OIDC is configured via environment variables on this deployment — the in-app form is read-only. Unset OIDC_ISSUER_URL/OIDC_CLIENT_ID/OIDC_CLIENT_SECRET to manage it here instead.',
      );
    }

    const existing = await this.oidcConfig.getRawDbConfig();

    const enabled = dto.enabled ?? existing?.enabled ?? false;
    const issuerUrl = dto.issuerUrl !== undefined ? dto.issuerUrl : (existing?.issuerUrl ?? null);
    const clientId = dto.clientId !== undefined ? dto.clientId : (existing?.clientId ?? null);
    const label = dto.label !== undefined ? dto.label : (existing?.label ?? null);
    const hasStoredSecret = !!existing?.clientSecretEncrypted;

    if (enabled && (!issuerUrl || !clientId || (!dto.clientSecret && !hasStoredSecret))) {
      throw new BadRequestException(
        'Issuer URL, client ID, and a client secret are all required to enable SSO.',
      );
    }

    // SSO/OIDC Phase 2 — JIT provisioning for this (legacy) provider.
    // `null` explicitly clears it; omitted leaves the existing rule alone.
    const jitDefaultWorkspaceId =
      dto.jitDefaultWorkspaceId !== undefined
        ? dto.jitDefaultWorkspaceId
        : (existing?.jitDefaultWorkspaceId ?? null);
    const jitDefaultRole = dto.jitDefaultRole ?? (existing?.jitDefaultRole as Role | undefined) ?? Role.VIEWER;

    if (jitDefaultWorkspaceId) {
      const workspace = await this.prisma.workspace.findUnique({
        where: { id: jitDefaultWorkspaceId },
        select: { id: true },
      });
      if (!workspace) {
        throw new NotFoundException('The selected JIT default workspace does not exist.');
      }
    }

    await this.oidcConfig.upsert({
      enabled,
      issuerUrl,
      clientId,
      label,
      clientSecret: dto.clientSecret,
      jitDefaultWorkspaceId,
      jitDefaultRole,
    });

    return this.oidcConfig.toDto();
  }

  // ---------------------------------------------------------------------------
  // SSO/OIDC Phase 2 — N-simultaneous-providers list (SsoProvider), additive
  // alongside the legacy singleton above. Every route instance-admin gated.
  // ---------------------------------------------------------------------------

  /** GET /admin/sso-providers — instance-admin only. */
  async listSsoProviders(userId: string): Promise<SsoProviderDto[]> {
    await assertInstanceAdmin(this.prisma, userId);
    return this.ssoProviders.findAll();
  }

  /** POST /admin/sso-providers — instance-admin only. */
  async createSsoProvider(userId: string, dto: CreateSsoProviderDto): Promise<SsoProviderDto> {
    await assertInstanceAdmin(this.prisma, userId);
    return this.ssoProviders.create(dto);
  }

  /** PATCH /admin/sso-providers/:id — instance-admin only. */
  async updateSsoProvider(
    userId: string,
    id: string,
    dto: UpdateSsoProviderDto,
  ): Promise<SsoProviderDto> {
    await assertInstanceAdmin(this.prisma, userId);
    return this.ssoProviders.update(id, dto);
  }

  /** DELETE /admin/sso-providers/:id — instance-admin only. */
  async removeSsoProvider(userId: string, id: string): Promise<void> {
    await assertInstanceAdmin(this.prisma, userId);
    return this.ssoProviders.remove(id);
  }
}
