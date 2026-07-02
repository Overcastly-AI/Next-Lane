import { Body, Controller, Delete, Get, Param, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ProjectMembershipsService } from './project-memberships.service';
import { SetProjectRoleOverrideDto } from './dto/set-project-role-override.dto';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequireScope } from '../auth/require-scope.decorator';

function extractIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress ?? null;
}

/**
 * Per-project role override surface — layered above the workspace-wide
 * members list (`WorkspacesController.members`). Nested under `projects/:id`
 * to mirror the existing project-scoped controller convention (labels,
 * sprints, webhooks, …).
 */
@ApiTags('project-memberships')
@ApiBearerAuth()
@Controller()
export class ProjectMembershipsController {
  constructor(private readonly projectMemberships: ProjectMembershipsService) {}

  @RequireScope('projects:read')
  @Get('projects/:id/members')
  listMembers(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.projectMemberships.listMembers(user.id, id);
  }

  @RequireScope('projects:write')
  @Put('projects/:id/members/:userId/role')
  setOverride(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @Body() dto: SetProjectRoleOverrideDto,
    @Req() req: Request,
  ) {
    return this.projectMemberships.setOverride(
      user.id,
      id,
      targetUserId,
      dto,
      extractIp(req),
    );
  }

  @RequireScope('projects:write')
  @Delete('projects/:id/members/:userId/role')
  clearOverride(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @Req() req: Request,
  ) {
    return this.projectMemberships.clearOverride(
      user.id,
      id,
      targetUserId,
      extractIp(req),
    );
  }
}
