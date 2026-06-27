import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService, toUserDto } from './auth.service';
import { RegisterDto, LoginDto } from './dto/auth.dto';
import { Public } from './public.decorator';
import { CurrentUser, AuthUser } from './current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

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

  @ApiBearerAuth()
  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    const full = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    return toUserDto(full);
  }
}
