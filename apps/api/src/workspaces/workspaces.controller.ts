import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { WorkspacesService } from './workspaces.service';
import { CreateWorkspaceDto, AddMemberDto } from './dto/workspace.dto';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';

/** Extract the caller's IP for audit logging (proxy-safe: prefer X-Forwarded-For). */
function extractIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress ?? null;
}

@ApiTags('workspaces')
@ApiBearerAuth()
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.workspaces.findAll(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateWorkspaceDto) {
    return this.workspaces.create(user.id, dto);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.workspaces.findOne(user.id, id);
  }

  @Get(':id/members')
  members(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.workspaces.members(user.id, id);
  }

  @Post(':id/members')
  addMember(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AddMemberDto,
    @Req() req: Request,
  ) {
    return this.workspaces.addMember(user.id, id, dto, extractIp(req));
  }

  @Delete(':id/members/:membershipId')
  removeMember(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Param('membershipId') membershipId: string,
    @Req() req: Request,
  ) {
    return this.workspaces.removeMember(user.id, workspaceId, membershipId, extractIp(req));
  }
}
