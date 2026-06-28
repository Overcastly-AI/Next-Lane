import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { StandupsService } from './standups.service';
import { UpsertStandupDto, StandupDateQueryDto } from './dto/standup.dto';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';

@ApiTags('standups')
@ApiBearerAuth()
@Controller()
export class StandupsController {
  constructor(private readonly standups: StandupsService) {}

  /**
   * GET /projects/:projectId/standups?date=YYYY-MM-DD (VIEWER+)
   *
   * Team digest: all members' standup entries for the project on the given
   * date (defaults to today). Ordered by user name. Includes `user` and
   * `blockerLinks` with resolved issue refs.
   */
  @Get('projects/:projectId/standups')
  findDigest(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Query() query: StandupDateQueryDto,
  ) {
    return this.standups.findDigest(user.id, projectId, query.date);
  }

  /**
   * GET /projects/:projectId/standups/me?date=YYYY-MM-DD (VIEWER+)
   *
   * Returns the caller's standup entry for the given date (defaults to
   * today), or null if no entry has been submitted yet.
   *
   * IMPORTANT: this route must be declared BEFORE `findDigest`'s
   * `:projectId` sub-routes would shadow it, but it is a sibling path so
   * NestJS resolves it by path specificity — `/me` never matches a CUID.
   */
  @Get('projects/:projectId/standups/me')
  findMyEntry(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Query() query: StandupDateQueryDto,
  ) {
    return this.standups.findMyEntry(user.id, projectId, query.date);
  }

  /**
   * GET /projects/:projectId/standups/prefill (VIEWER+)
   *
   * Returns { yesterday: string, today: string } with AI-suggested text
   * derived from the caller's recent ActivityLog and assigned in-progress
   * issues. Does not persist anything — seeds the standup form.
   */
  @Get('projects/:projectId/standups/prefill')
  prefill(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
  ) {
    return this.standups.prefill(user.id, projectId);
  }

  /**
   * POST /projects/:projectId/standups (MEMBER+)
   *
   * Upsert the caller's standup entry for (userId, projectId, date).
   * Blocker issue links are replaced (not merged) on every call.
   * Returns the full StandupEntryDto.
   */
  @Post('projects/:projectId/standups')
  upsert(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: UpsertStandupDto,
  ) {
    return this.standups.upsert(user.id, projectId, dto);
  }
}
