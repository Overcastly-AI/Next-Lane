import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService, toMeDto } from './auth.service';
import { RegisterDto, LoginDto, ForgotPasswordDto, ResetPasswordDto } from './dto/auth.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { Public } from './public.decorator';
import { CurrentUser, AuthUser } from './current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordResetService } from './password-reset.service';
import { OidcConfigService } from '../admin-settings/oidc-config.service';

@ApiTags('auth')
@Controller('auth')
// Stricter rate limit on auth endpoints (default 10 req / 60s per IP), tunable
// via THROTTLE_AUTH_LIMIT/THROTTLE_TTL. Overrides the global ThrottlerModule
// limit; fully skippable via RATE_LIMIT_DISABLED (see ConfigurableThrottlerGuard).
@Throttle({
  global: {
    ttl: Number(process.env.THROTTLE_TTL) || 60000,
    limit: Number(process.env.THROTTLE_AUTH_LIMIT) || 10,
  },
})
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    private readonly passwordReset: PasswordResetService,
    private readonly oidcConfig: OidcConfigService,
  ) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  /**
   * Public, unauthenticated capability probe for login-surface features.
   * The frontend uses this to decide whether to render the "Continue with
   * SSO" button on LoginPage — never assume a provider is configured.
   * Reflects the LIVE effective config (env vars, or an enabled in-app-admin-
   * configured DB config) — no API restart needed after a settings-screen save.
   */
  @Public()
  @Get('providers')
  async providers(): Promise<{ oidc: { enabled: boolean; label: string } }> {
    const config = await this.oidcConfig.getEffectiveConfig();
    return {
      oidc: {
        enabled: config !== null,
        label: config?.label ?? 'Single sign-on',
      },
    };
  }

  /**
   * Request a password-reset link.
   *
   * Always returns 200 regardless of whether the email exists — callers must
   * not be able to enumerate registered addresses via the response code/body.
   * If the user exists, a single-use token is issued (prior tokens invalidated)
   * and delivered via the configured channel (logger in dev; SMTP when wired).
   */
  @Public()
  @HttpCode(200)
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<{ message: string }> {
    await this.passwordReset.requestReset(dto.email);
    return { message: 'If that email is registered you will receive a reset link.' };
  }

  /**
   * Consume a reset token and set a new password.
   *
   * Returns 200 on success. Returns 400 when the token is missing/expired/used.
   */
  @Public()
  @HttpCode(200)
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<{ message: string }> {
    await this.passwordReset.resetPassword(dto.token, dto.newPassword);
    return { message: 'Password updated successfully.' };
  }

  @ApiBearerAuth()
  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    const full = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    return toMeDto(full);
  }

  /**
   * Update the current user's own profile.
   *
   * Only the fields provided in the body are updated; omitted fields are left
   * unchanged. Currently supports: `name`, `emailNotifications`.
   */
  @ApiBearerAuth()
  @Patch('me')
  async updateMe(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.auth.updateProfile(user.id, dto);
  }
}
