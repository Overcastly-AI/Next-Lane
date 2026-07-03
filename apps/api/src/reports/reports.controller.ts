import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ReportsService, VELOCITY_TREND_DEFAULT_SPRINTS } from './reports.service';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';

@ApiTags('reports')
@ApiBearerAuth()
@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** Velocity: committed vs completed story points per completed/active sprint. */
  @Get('projects/:projectId/reports/velocity')
  velocity(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
  ) {
    return this.reports.velocity(user.id, projectId);
  }

  /**
   * Cross-sprint velocity trend: the same committed/completed figures as
   * `velocity`, bounded to the project's most recent `sprints` sprints
   * (default 6) — "are we speeding up or slowing down" at a glance. Also
   * powers the dashboard VELOCITY_TREND gadget.
   */
  @Get('projects/:projectId/reports/velocity-trend')
  velocityTrend(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Query('sprints') sprintsStr?: string,
  ) {
    const sprints = sprintsStr ? Math.round(Number(sprintsStr)) : VELOCITY_TREND_DEFAULT_SPRINTS;
    return this.reports.velocityTrend(
      user.id,
      projectId,
      isNaN(sprints) ? VELOCITY_TREND_DEFAULT_SPRINTS : sprints,
    );
  }

  /** Burndown: daily ideal vs remaining story points for one sprint. */
  @Get('projects/:projectId/sprints/:sprintId/burndown')
  burndown(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('sprintId') sprintId: string,
  ) {
    return this.reports.burndown(user.id, projectId, sprintId);
  }

  /**
   * Cumulative Flow Diagram: per-day count of issues in each status category
   * (TODO / IN_PROGRESS / DONE) over the requested window. Defaults to 30 days.
   * Historical state is reconstructed from ActivityLog status-change entries.
   */
  @Get('projects/:projectId/reports/cfd')
  cfd(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Query('days') daysStr?: string,
  ) {
    const days = daysStr ? Math.round(Number(daysStr)) : 30;
    return this.reports.cfd(user.id, projectId, isNaN(days) ? 30 : days);
  }
}
