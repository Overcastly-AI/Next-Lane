import { Module } from '@nestjs/common';
import { AdminSettingsController } from './admin-settings.controller';
import { AdminSettingsService } from './admin-settings.service';
import { OidcConfigService } from './oidc-config.service';
import { SsoProvidersService } from './sso-providers.service';

/**
 * Deliberately has NO dependency on `AuthModule`/`OidcModule`/`SsoModule` —
 * all of those import THIS module (for `OidcConfigService`/
 * `SsoProvidersService`), so importing back would be circular.
 * `PrismaService` is global (`PrismaModule`), and the `CurrentUser`/
 * `AuthUser` decorator used by the controller is a plain TS import (no DI),
 * so this module can sit "below" auth in the import graph while still
 * serving auth-adjacent endpoints.
 */
@Module({
  controllers: [AdminSettingsController],
  providers: [AdminSettingsService, OidcConfigService, SsoProvidersService],
  exports: [OidcConfigService, SsoProvidersService],
})
export class AdminSettingsModule {}
