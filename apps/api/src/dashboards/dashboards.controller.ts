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
import { DashboardsService } from './dashboards.service';
import { CreateDashboardDto } from './dto/create-dashboard.dto';
import { UpdateDashboardDto } from './dto/update-dashboard.dto';
import { CreateDashboardGadgetDto } from './dto/create-dashboard-gadget.dto';
import { UpdateDashboardGadgetDto } from './dto/update-dashboard-gadget.dto';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequireScope } from '../auth/require-scope.decorator';

@ApiTags('dashboards')
@ApiBearerAuth()
@Controller()
export class DashboardsController {
  constructor(private readonly dashboards: DashboardsService) {}

  /** List a project's dashboards (VIEWER+). */
  @Get('projects/:projectId/dashboards')
  @RequireScope('projects:read')
  listDashboards(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
  ) {
    return this.dashboards.listDashboards(user.id, projectId);
  }

  /** Create a dashboard in a project (MEMBER+). */
  @Post('projects/:projectId/dashboards')
  @RequireScope('projects:write')
  createDashboard(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: CreateDashboardDto,
  ) {
    return this.dashboards.createDashboard(user.id, projectId, dto);
  }

  /** Get a dashboard with its gadgets, ordered by grid position (VIEWER+). */
  @Get('dashboards/:dashboardId')
  @RequireScope('projects:read')
  getDashboard(
    @CurrentUser() user: AuthUser,
    @Param('dashboardId') dashboardId: string,
  ) {
    return this.dashboards.getDashboard(user.id, dashboardId);
  }

  /** Evaluate every gadget on a dashboard server-side (VIEWER+). */
  @Get('dashboards/:dashboardId/data')
  @RequireScope('projects:read')
  getDashboardData(
    @CurrentUser() user: AuthUser,
    @Param('dashboardId') dashboardId: string,
  ) {
    return this.dashboards.getDashboardData(user.id, dashboardId);
  }

  /** Rename or reorder a dashboard (MEMBER+). */
  @Patch('dashboards/:dashboardId')
  @RequireScope('projects:write')
  updateDashboard(
    @CurrentUser() user: AuthUser,
    @Param('dashboardId') dashboardId: string,
    @Body() dto: UpdateDashboardDto,
  ) {
    return this.dashboards.updateDashboard(user.id, dashboardId, dto);
  }

  /** Delete a dashboard (its gadgets cascade) (MEMBER+). */
  @Delete('dashboards/:dashboardId')
  @RequireScope('projects:write')
  deleteDashboard(
    @CurrentUser() user: AuthUser,
    @Param('dashboardId') dashboardId: string,
  ) {
    return this.dashboards.deleteDashboard(user.id, dashboardId);
  }

  /** Add a gadget to a dashboard (MEMBER+). */
  @Post('dashboards/:dashboardId/gadgets')
  @RequireScope('projects:write')
  createGadget(
    @CurrentUser() user: AuthUser,
    @Param('dashboardId') dashboardId: string,
    @Body() dto: CreateDashboardGadgetDto,
  ) {
    return this.dashboards.createGadget(user.id, dashboardId, dto);
  }

  /** Update a gadget's title/query/visualization/config (MEMBER+). */
  @Patch('gadgets/:gadgetId')
  @RequireScope('projects:write')
  updateGadget(
    @CurrentUser() user: AuthUser,
    @Param('gadgetId') gadgetId: string,
    @Body() dto: UpdateDashboardGadgetDto,
  ) {
    return this.dashboards.updateGadget(user.id, gadgetId, dto);
  }

  /** Delete a gadget (MEMBER+). */
  @Delete('gadgets/:gadgetId')
  @RequireScope('projects:write')
  deleteGadget(
    @CurrentUser() user: AuthUser,
    @Param('gadgetId') gadgetId: string,
  ) {
    return this.dashboards.deleteGadget(user.id, gadgetId);
  }
}
