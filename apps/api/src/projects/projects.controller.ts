import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ListProjectActivityQueryDto } from './dto/list-project-activity.dto';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequireScope } from '../auth/require-scope.decorator';

function extractIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress ?? null;
}

@ApiTags('projects')
@ApiBearerAuth()
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @RequireScope('projects:read')
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('workspaceId') workspaceId: string,
  ) {
    return this.projects.findAll(user.id, workspaceId);
  }

  @Post()
  @RequireScope('projects:write')
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateProjectDto,
    @Req() req: Request,
  ) {
    return this.projects.create(user.id, dto, extractIp(req));
  }

  @Get(':id')
  @RequireScope('projects:read')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.projects.findOne(user.id, id);
  }

  /**
   * GET /projects/:id/activity (VIEWER+, `projects:read` PAT scope)
   *
   * Unified project activity feed — issue field changes, comments, and work
   * logs across every issue in the project, chronologically merged and
   * cursor-paginated. Agent Experience Round 2, criterion 6.
   */
  @Get(':id/activity')
  @RequireScope('projects:read')
  activity(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: ListProjectActivityQueryDto,
  ) {
    return this.projects.getActivity(user.id, id, query);
  }

  @Patch(':id')
  @RequireScope('projects:write')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projects.update(user.id, id, dto);
  }

  @Delete(':id')
  @RequireScope('projects:write')
  archive(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.projects.archive(user.id, id, extractIp(req));
  }
}
