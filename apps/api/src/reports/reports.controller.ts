import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
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
