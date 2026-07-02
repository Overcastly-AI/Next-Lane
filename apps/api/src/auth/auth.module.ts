import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { APP_GUARD } from '@nestjs/core';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ScopeGuard } from './scope.guard';
import { getJwtExpiresIn, getJwtSecret } from './auth.config';
import { PasswordResetService } from './password-reset.service';
import { ApiTokensModule } from '../api-tokens/api-tokens.module';
import { MailModule } from '../mail/mail.module';
import { AdminSettingsModule } from '../admin-settings/admin-settings.module';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: getJwtSecret(),
      signOptions: { expiresIn: getJwtExpiresIn() },
    }),
    // ApiTokensModule is imported so its service can be injected into JwtAuthGuard
    // to handle PAT authentication alongside normal JWT auth.
    ApiTokensModule,
    // MailModule provides MailService for SMTP / dev-log email delivery.
    MailModule,
    // AdminSettingsModule provides OidcConfigService for AuthController's
    // GET /auth/providers capability probe (reflects env OR in-app-admin-
    // configured SSO, whichever is effective). No cycle: AdminSettingsModule
    // does not import AuthModule.
    AdminSettingsModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordResetService,
    JwtStrategy,
    // Global JWT guard — routes are protected unless marked @Public()
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Global scope guard — runs AFTER JwtAuthGuard (same module, listed second).
    // Enforces @RequireScope on decorated handlers.
    // No-op for JWT sessions and unscoped PATs; scoped PATs missing the
    // declared scope receive a 403 Forbidden.
    { provide: APP_GUARD, useClass: ScopeGuard },
  ],
  exports: [AuthService, PasswordResetService],
})
export class AuthModule {}
