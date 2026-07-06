import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { getJwtExpiresIn, getJwtSecret } from '../auth.config';
import { AuthModule } from '../auth.module';
import { AdminSettingsModule } from '../../admin-settings/admin-settings.module';
import { RedisModule } from '../../redis/redis.module';
import { SsoController } from './sso.controller';
import { SsoService } from './sso.service';
import { SamlService } from './saml.service';
import { SamlCacheProviderFactory } from './saml-cache-provider';

/**
 * SSO/OIDC Phase 2 — SAML + N-simultaneous-providers list, ADDITIVE
 * alongside `OidcModule` (Phase 1, left entirely untouched — see that
 * module's own header comment for why it stays a separate module).
 *
 * Imports `AdminSettingsModule` for `SsoProvidersService` (the config CRUD
 * + resolver — no cycle, same reasoning as `OidcModule`'s own import of it).
 * Imports `RedisModule` (`@Global`, so this import is really just
 * documentation of the dependency) for `SamlCacheProviderFactory`'s optional
 * shared replay-window cache.
 */
@Module({
  imports: [
    AuthModule,
    AdminSettingsModule,
    RedisModule,
    JwtModule.register({
      secret: getJwtSecret(),
      signOptions: { expiresIn: getJwtExpiresIn() },
    }),
  ],
  controllers: [SsoController],
  providers: [SsoService, SamlService, SamlCacheProviderFactory],
})
export class SsoModule {}
