import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminSettingsService } from './admin-settings.service';
import { UpdateOidcConfigDto } from './dto/update-oidc-config.dto';
import { CreateSsoProviderDto } from './dto/create-sso-provider.dto';
import { UpdateSsoProviderDto } from './dto/update-sso-provider.dto';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequireScope } from '../auth/require-scope.decorator';

/**
 * Instance-level admin settings — the in-app SSO/OIDC configuration screens.
 * Every route here is gated on `User.isInstanceAdmin` (checked inside the
 * service via `assertInstanceAdmin`), a strictly narrower, instance-wide gate
 * than workspace-level `Membership.role: ADMIN` — appropriate for secrets
 * (client secrets, IdP certificates) that aren't scoped to any single
 * workspace/project.
 *
 * `/admin/oidc-config` — SSO/OIDC Phase 1, the legacy single-provider
 *   singleton (env-var-precedence).
 * `/admin/sso-providers` — SSO/OIDC Phase 2, the N-simultaneous-providers
 *   list (OIDC and/or SAML rows), additive alongside the above.
 */
@ApiTags('admin-settings')
@Controller('admin')
export class AdminSettingsController {
  constructor(private readonly service: AdminSettingsService) {}

  @ApiBearerAuth()
  @Get('oidc-config')
  @RequireScope('admin:read')
  getOidcConfig(@CurrentUser() user: AuthUser) {
    return this.service.getOidcConfig(user.id);
  }

  @ApiBearerAuth()
  @Patch('oidc-config')
  @RequireScope('admin:write')
  updateOidcConfig(@CurrentUser() user: AuthUser, @Body() dto: UpdateOidcConfigDto) {
    return this.service.updateOidcConfig(user.id, dto);
  }

  @ApiBearerAuth()
  @Get('sso-providers')
  @RequireScope('admin:read')
  listSsoProviders(@CurrentUser() user: AuthUser) {
    return this.service.listSsoProviders(user.id);
  }

  @ApiBearerAuth()
  @Post('sso-providers')
  @RequireScope('admin:write')
  createSsoProvider(@CurrentUser() user: AuthUser, @Body() dto: CreateSsoProviderDto) {
    return this.service.createSsoProvider(user.id, dto);
  }

  @ApiBearerAuth()
  @Patch('sso-providers/:id')
  @RequireScope('admin:write')
  updateSsoProvider(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateSsoProviderDto,
  ) {
    return this.service.updateSsoProvider(user.id, id, dto);
  }

  @ApiBearerAuth()
  @Delete('sso-providers/:id')
  @RequireScope('admin:write')
  removeSsoProvider(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.removeSsoProvider(user.id, id);
  }
}
