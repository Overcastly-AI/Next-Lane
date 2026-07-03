import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AgentContextService } from './agent-context.service';
import { UpsertAgentContextDto } from './dto/upsert-agent-context.dto';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequireScope } from '../auth/require-scope.decorator';

@ApiTags('agent-context')
@ApiBearerAuth()
@Controller()
export class AgentContextController {
  constructor(private readonly agentContext: AgentContextService) {}

  /**
   * GET /projects/:projectId/agent-context (VIEWER+)
   *
   * The per-project agent handoff document, plus a staleness signal. Never
   * 404s — an unconfigured project returns an empty document so a first-time
   * caller (agent or human) gets a normal read.
   */
  @Get('projects/:projectId/agent-context')
  @RequireScope('projects:read')
  get(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.agentContext.get(user.id, projectId);
  }

  /**
   * PUT /projects/:projectId/agent-context (MEMBER+)
   *
   * Create-or-replace the handoff document. This is a full-content
   * replacement, not a merge — callers that want to preserve part of the
   * existing document should GET it first.
   */
  @Put('projects/:projectId/agent-context')
  @RequireScope('projects:write')
  upsert(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: UpsertAgentContextDto,
  ) {
    return this.agentContext.upsert(user.id, projectId, dto);
  }
}
