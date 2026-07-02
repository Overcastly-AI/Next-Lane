import { BadRequestException, Injectable } from '@nestjs/common';
import type { OidcConfigDto } from '@next-lane/shared';
import { PrismaService } from '../prisma/prisma.service';
import { assertInstanceAdmin } from '../common/membership.util';
import { OidcConfigService } from './oidc-config.service';
import { getOidcEnvConfig } from '../auth/oidc/oidc.config';
import type { UpdateOidcConfigDto } from './dto/update-oidc-config.dto';

@Injectable()
export class AdminSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly oidcConfig: OidcConfigService,
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

    await this.oidcConfig.upsert({
      enabled,
      issuerUrl,
      clientId,
      label,
      clientSecret: dto.clientSecret,
    });

    return this.oidcConfig.toDto();
  }
}
