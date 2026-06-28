import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';

@ApiTags('analytics')
@ApiBearerAuth()
@Controller()
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  /**
   * GET /me/analytics?days=N
   *
   * Personal analytics for the signed-in user over a rolling day window.
   * `days` defaults to 30; clamped to [1, 366].
   */
  @Get('me/analytics')
  personalAnalytics(
    @CurrentUser() user: AuthUser,
    @Query('days') daysStr?: string,
  ) {
    const days = daysStr ? Number(daysStr) : 30;
    return this.analytics.personalAnalytics(user.id, isNaN(days) ? 30 : days);
  }

  /**
   * GET /projects/:projectId/analytics?days=N
   *
   * Team analytics for a single project over a rolling day window.
   * Requires project membership. `days` defaults to 30; clamped to [1, 366].
   */
  @Get('projects/:projectId/analytics')
  projectAnalytics(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Query('days') daysStr?: string,
  ) {
    const days = daysStr ? Number(daysStr) : 30;
    return this.analytics.projectAnalytics(
      user.id,
      projectId,
      isNaN(days) ? 30 : days,
    );
  }
}
