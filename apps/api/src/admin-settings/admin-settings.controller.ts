import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminSettingsService } from './admin-settings.service';
import { UpdateOidcConfigDto } from './dto/update-oidc-config.dto';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequireScope } from '../auth/require-scope.decorator';

/**
 * Instance-level admin settings — currently just the in-app SSO/OIDC
 * configuration screen. Every route here is gated on `User.isInstanceAdmin`
 * (checked inside the service via `assertInstanceAdmin`), a strictly
 * narrower, instance-wide gate than workspace-level `Membership.role: ADMIN`
 * — appropriate for a secret (the OIDC client secret) that isn't scoped to
 * any single workspace/project.
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
}
