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
  CreateNamedWorkflowDto,
  UpdateNamedWorkflowDto,
  CreateWorkflowFromTemplateDto,
  PatchWorkflowDto,
  PatchWorkflowTransitionDto,
} from './dto/workflow.dto';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';

@ApiTags('workflows')
@ApiBearerAuth()
@Controller()
export class WorkflowController {
  constructor(private readonly workflow: WorkflowService) {}

  // ── Legacy project-level workflow (back-compat) ────────────────────────────

  /**
   * GET /projects/:projectId/workflow
   * Returns the full project-level workflow (enforced flag + legacy transitions).
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
   * Create a new (legacy, project-level) transition in the project's workflow graph.
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
   * Partially update a legacy workflow transition.
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
   * Remove a legacy workflow transition.
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

  // ── Named Workflow entity CRUD ─────────────────────────────────────────────

  /**
   * GET /projects/:projectId/workflows
   * List all named workflows for a project, with transitionCount + boardCount.
   * Authorization: any project member (VIEWER+).
   */
  @Get('projects/:projectId/workflows')
  listWorkflows(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
  ) {
    return this.workflow.listWorkflows(user.id, projectId);
  }

  /**
   * POST /projects/:projectId/workflows
   * Create a named workflow.
   * Authorization: project ADMIN.
   */
  @Post('projects/:projectId/workflows')
  createWorkflow(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: CreateNamedWorkflowDto,
  ) {
    return this.workflow.createWorkflow(user.id, projectId, dto);
  }

  /**
   * POST /projects/:projectId/workflows/from-template
   * Create a named workflow pre-populated with transitions from a template.
   * Templates: 'simple' | 'kanban' | 'scrum' | 'bug-triage'.
   * Authorization: project ADMIN.
   */
  @Post('projects/:projectId/workflows/from-template')
  createWorkflowFromTemplate(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: CreateWorkflowFromTemplateDto,
  ) {
    return this.workflow.createWorkflowFromTemplate(user.id, projectId, dto);
  }

  /**
   * GET /workflows/:id
   * Get a named workflow by id, including its transitions.
   * Authorization: any project member (VIEWER+).
   */
  @Get('workflows/:id')
  getWorkflowById(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.workflow.getWorkflowById(user.id, id);
  }

  /**
   * PATCH /workflows/:id
   * Update name/description/enforced of a named workflow.
   * Authorization: project ADMIN.
   */
  @Patch('workflows/:id')
  updateWorkflow(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateNamedWorkflowDto,
  ) {
    return this.workflow.updateWorkflow(user.id, id, dto);
  }

  /**
   * DELETE /workflows/:id
   * Delete a named workflow (204). Transitions cascade; boards.workflowId set null.
   * Authorization: project ADMIN.
   */
  @Delete('workflows/:id')
  @HttpCode(204)
  async deleteWorkflow(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.workflow.deleteWorkflow(user.id, id);
  }

  // ── Workflow-scoped transition CRUD ────────────────────────────────────────

  /**
   * POST /workflows/:id/transitions
   * Add a transition to a named workflow.
   * Validates status ownership in the workflow's project.
   * Authorization: project ADMIN.
   */
  @Post('workflows/:id/transitions')
  createWorkflowTransition(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateWorkflowTransitionDto,
  ) {
    return this.workflow.createWorkflowTransition(user.id, id, dto);
  }

  /**
   * PATCH /workflow-transitions/:id
   * Update a workflow-scoped transition (non-colliding path vs legacy).
   * Authorization: project ADMIN.
   */
  @Patch('workflow-transitions/:id')
  updateWorkflowTransition(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: PatchWorkflowTransitionDto,
  ) {
    return this.workflow.updateWorkflowTransition(user.id, id, dto);
  }

  /**
   * DELETE /workflow-transitions/:id
   * Delete a workflow-scoped transition.
   * Authorization: project ADMIN.
   */
  @Delete('workflow-transitions/:id')
  @HttpCode(204)
  async deleteWorkflowTransition(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.workflow.deleteWorkflowTransition(user.id, id);
  }
}
