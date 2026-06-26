import { Controller, Get, Param } from '@nestjs/common';
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
}
