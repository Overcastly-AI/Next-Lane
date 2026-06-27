import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService, toUserDto } from './auth.service';
import { RegisterDto, LoginDto, ForgotPasswordDto, ResetPasswordDto } from './dto/auth.dto';
import { Public } from './public.decorator';
import { CurrentUser, AuthUser } from './current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordResetService } from './password-reset.service';

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
    return toUserDto(full);
  }
}
