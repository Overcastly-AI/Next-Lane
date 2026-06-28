import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { WorkflowService } from './workflow.service';
import {
  CreateWorkflowTransitionDto,
  PatchWorkflowDto,
  PatchWorkflowTransitionDto,
} from './dto/workflow.dto';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';

@ApiTags('workflows')
@ApiBearerAuth()
@Controller()
export class WorkflowController {
  constructor(private readonly workflow: WorkflowService) {}

  /**
   * GET /projects/:projectId/workflow
   * Returns the full workflow for a project (enforced flag + transition list).
   * Authorization: any project member (VIEWER+).
   */
  @Get('projects/:projectId/workflow')
  getWorkflow(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
  ) {
    return this.workflow.getWorkflow(user.id, projectId);
  }

  /**
   * PATCH /projects/:projectId/workflow
   * Enable or disable enforcement. When enabling with zero transitions, a
   * permissive default set is auto-seeded (every ordered pair of statuses).
   * Authorization: project ADMIN.
   */
  @Patch('projects/:projectId/workflow')
  patchWorkflow(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: PatchWorkflowDto,
  ) {
    return this.workflow.patchEnforced(user.id, projectId, dto);
  }

  /**
   * POST /projects/:projectId/workflow/transitions
   * Create a new transition in the project's workflow graph.
   * Authorization: project ADMIN.
   */
  @Post('projects/:projectId/workflow/transitions')
  createTransition(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: CreateWorkflowTransitionDto,
  ) {
    return this.workflow.createTransition(user.id, projectId, dto);
  }

  /**
   * PATCH /workflow/transitions/:id
   * Partially update a workflow transition.
   * Authorization: project ADMIN (resolved from the transition's projectId).
   */
  @Patch('workflow/transitions/:id')
  updateTransition(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: PatchWorkflowTransitionDto,
  ) {
    return this.workflow.updateTransition(user.id, id, dto);
  }

  /**
   * DELETE /workflow/transitions/:id
   * Remove a workflow transition.
   * Authorization: project ADMIN.
   */
  @Delete('workflow/transitions/:id')
  @HttpCode(204)
  async deleteTransition(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.workflow.deleteTransition(user.id, id);
  }
}
