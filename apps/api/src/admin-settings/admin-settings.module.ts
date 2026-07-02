import { Module } from '@nestjs/common';
import { AdminSettingsController } from './admin-settings.controller';
import { AdminSettingsService } from './admin-settings.service';
import { OidcConfigService } from './oidc-config.service';

/**
 * Deliberately has NO dependency on `AuthModule`/`OidcModule` — both of
 * those import THIS module (for `OidcConfigService`), so importing back
 * would be circular. `PrismaService` is global (`PrismaModule`), and the
 * `CurrentUser`/`AuthUser` decorator used by the controller is a plain TS
 * import (no DI), so this module can sit "below" auth in the import graph
 * while still serving auth-adjacent endpoints.
 */
@Module({
  controllers: [AdminSettingsController],
  providers: [AdminSettingsService, OidcConfigService],
  exports: [OidcConfigService],
})
export class AdminSettingsModule {}
