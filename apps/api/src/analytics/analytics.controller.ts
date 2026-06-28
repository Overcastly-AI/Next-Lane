import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';

@ApiTags('analytics')
@ApiBearerAuth()
@Controller()
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  /**
   * GET /me/analytics?days=N
   *
   * Personal analytics for the signed-in user over a rolling day window.
   * `days` defaults to 30 when omitted; must be an integer in [1, 366] — the
   * global ValidationPipe enforces these bounds and returns 400 on violation.
   */
  @Get('me/analytics')
  personalAnalytics(
    @CurrentUser() user: AuthUser,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analytics.personalAnalytics(user.id, query.days ?? 30);
  }

  /**
   * GET /projects/:projectId/analytics?days=N
   *
   * Team analytics for a single project over a rolling day window.
   * Requires project membership. `days` defaults to 30 when omitted; must be
   * an integer in [1, 366] — the global ValidationPipe returns 400 on violation.
   */
  @Get('projects/:projectId/analytics')
  projectAnalytics(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analytics.projectAnalytics(
      user.id,
      projectId,
      query.days ?? 30,
    );
  }
}
