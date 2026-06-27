import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { ListAuditEventsQueryDto } from './dto/audit-event.dto';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import type { Request } from 'express';
import { Req } from '@nestjs/common';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('workspaces/:id/audit-log')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /**
   * GET /workspaces/:id/audit-log
   *
   * Returns a cursor-paginated list of audit events for the workspace, newest
   * first. Only workspace ADMINs can access this endpoint; MEMBER and VIEWER
   * receive 403.
   */
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Query() query: ListAuditEventsQueryDto,
    @Req() req: Request,
  ) {
    void req; // available for future IP-based filtering
    return this.audit.list(user.id, workspaceId, query);
  }
}
