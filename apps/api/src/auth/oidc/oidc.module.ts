import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { getJwtExpiresIn, getJwtSecret } from '../auth.config';
import { AuthModule } from '../auth.module';
import { OidcController } from './oidc.controller';
import { OidcService } from './oidc.service';

/**
 * SSO/OIDC — Phase 1 (generic, single-provider OIDC login).
 *
 * A separate module (rather than folding straight into AuthModule) keeps the
 * `openid-client` dependency and provider-discovery/JIT-provisioning logic
 * isolated: it is entirely optional, always safe to import (no-ops when
 * unconfigured), and easy to delete/replace when Phase 2 (SAML,
 * multi-provider) lands.
 *
 * Reuses AuthModule's JwtModule registration for signing/verifying the
 * short-lived OIDC state token — same secret, independent `typ` claim guards
 * against confusion with real session tokens.
 */
@Module({
  imports: [
    AuthModule,
    JwtModule.register({
      secret: getJwtSecret(),
      signOptions: { expiresIn: getJwtExpiresIn() },
    }),
  ],
  controllers: [OidcController],
  providers: [OidcService],
})
export class OidcModule {}
