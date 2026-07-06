import { Controller, Get, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { PublicService } from './public.service';

/**
 * Public (unauthenticated) endpoints. Every route here is decorated with
 * @Public() to bypass the global JwtAuthGuard.
 *
 * Rate-limited at a lower threshold than authenticated endpoints to reduce
 * scraping/enumeration risk:  60 requests / 60 seconds per IP.
 *
 * Not `@RequireScope`-gated (and cannot be): `ScopeGuard` enforcement is
 * keyed off `request.user`, which `@Public()` routes never populate — there
 * is no PAT/JWT principal to check a scope against. Authorization here is
 * entirely capability-based (possession of the share token itself).
 */
@ApiTags('public')
@Controller('public')
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  /**
   * Return a read-only board snapshot for a valid share token.
   *
   * No authentication required. The token encodes project access; cross-project
   * access is impossible (projectId is always derived from the stored token row).
   * An invalid or revoked token returns 404 — no oracle distinguishing the two.
   */
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('board/:token')
  getBoard(@Param('token') token: string) {
    return this.publicService.getPublicBoard(token);
  }
}
