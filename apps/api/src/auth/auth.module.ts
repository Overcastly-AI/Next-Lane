import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { APP_GUARD } from '@nestjs/core';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';
import { getJwtExpiresIn, getJwtSecret } from './auth.config';
import { PasswordResetService } from './password-reset.service';
import { ApiTokensModule } from '../api-tokens/api-tokens.module';

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
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordResetService,
    JwtStrategy,
    // Global JWT guard — routes are protected unless marked @Public()
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [AuthService, PasswordResetService],
})
export class AuthModule {}
