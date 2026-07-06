import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MeService } from './me.service';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { CreateQuickLinkDto, UpdateQuickLinkDto } from './dto/quick-link.dto';

/**
 * Every route on this controller is intentionally NOT `@RequireScope`-gated.
 * "My work" and "quick links" are user-private data resolved strictly from
 * the caller's own identity (`userId` from the JWT/PAT principal) — never a
 * shared team/project resource a PAT scope model is meant to restrict.
 * Same exemption rationale as `GET/PATCH /auth/me`.
 */
@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

  /** The caller's personal work across all their workspaces, grouped. */
  @Get('work')
  work(@CurrentUser() user: AuthUser) {
    return this.me.getMyWork(user.id);
  }

  // ── Quick links ───────────────────────────────────────────────────────────

  /** GET /me/quick-links — the caller's personal shortcuts, ordered. */
  @Get('quick-links')
  listQuickLinks(@CurrentUser() user: AuthUser) {
    return this.me.listQuickLinks(user.id);
  }

  /** POST /me/quick-links — add a personal shortcut. */
  @Post('quick-links')
  createQuickLink(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateQuickLinkDto,
  ) {
    return this.me.createQuickLink(user.id, dto);
  }

  /** PATCH /me/quick-links/:id — rename / re-point / reorder a shortcut. */
  @Patch('quick-links/:id')
  updateQuickLink(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateQuickLinkDto,
  ) {
    return this.me.updateQuickLink(user.id, id, dto);
  }

  /** DELETE /me/quick-links/:id — remove a shortcut. */
  @Delete('quick-links/:id')
  deleteQuickLink(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.me.deleteQuickLink(user.id, id);
  }
}
