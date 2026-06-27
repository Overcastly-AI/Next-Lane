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
// Stricter rate limit on auth endpoints: 10 requests per 60 seconds per IP.
// This overrides the global 100 req/min limit from ThrottlerModule.
@Throttle({ global: { ttl: 60000, limit: 10 } })
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
