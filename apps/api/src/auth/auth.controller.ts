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
import { SsoProvidersService } from '../admin-settings/sso-providers.service';
import type { SsoProviderSummaryDto } from '@next-lane/shared';

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
    private readonly ssoProviders: SsoProvidersService,
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
   * The frontend uses this to decide which SSO buttons to render on
   * LoginPage — never assume a provider is configured.
   * Reflects the LIVE effective config (env vars, or an enabled in-app-admin-
   * configured DB config) — no API restart needed after a settings-screen save.
   *
   * `oidc` is the Phase-1 legacy single-provider config (unchanged shape,
   * for backward compat with anything reading this field). `providers` is
   * the SSO/OIDC Phase 2 addition — every currently-ENABLED row from the
   * N-simultaneous-providers list (`SsoProvider`), OIDC and/or SAML alike.
   */
  @Public()
  @Get('providers')
  async providers(): Promise<{
    oidc: { enabled: boolean; label: string };
    providers: SsoProviderSummaryDto[];
  }> {
    const [config, providers] = await Promise.all([
      this.oidcConfig.getEffectiveConfig(),
      this.ssoProviders.findEnabledSummaries(),
    ]);
    return {
      oidc: {
        enabled: config !== null,
        label: config?.label ?? 'Single sign-on',
      },
      providers,
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

  /**
   * `GET`/`PATCH /auth/me` are intentionally NOT `@RequireScope`-gated.
   * Every route here is either `@Public()` (register/login/providers/
   * forgot-password/reset-password — no `request.user` exists yet for
   * `ScopeGuard` to check) or operates on the caller's own identity as
   * resolved directly from the bearer token itself (JWT or PAT — either way
   * "acting as this user"). A PAT scope model restricts what a token can do
   * *to shared team resources*; it has no meaningful reduction to apply to
   * "read/update the profile of the very user this token authenticates as" —
   * the same reasoning that keeps `/me/work` and `/me/quick-links` (see
   * `me.controller.ts`) ungated.
   */
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
