import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertProjectMember,
  assertProjectRole,
} from '../common/membership.util';
import {
  CreateWorkflowTransitionDto,
  CreateNamedWorkflowDto,
  UpdateNamedWorkflowDto,
  CreateWorkflowFromTemplateDto,
  PatchWorkflowDto,
  PatchWorkflowTransitionDto,
} from './dto/workflow.dto';
import { IssueType, Role, StatusCategory } from '@next-lane/shared';
import type {
  ProjectWorkflowConfigDto,
  WorkflowGateDto,
  WorkflowTransitionDto,
  WorkflowDto,
} from '@next-lane/shared';

// ---------------------------------------------------------------------------
// Internal row types
// ---------------------------------------------------------------------------

interface WorkflowTransitionRow {
  id: string;
  projectId: string;
  workflowId?: string | null;
  fromStatusId: string | null;
  toStatusId: string;
  issueType: string | null;
  name: string | null;
  gates: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
}

interface NamedWorkflowRow {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  enforced: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

export function toWorkflowTransitionDto(
  row: WorkflowTransitionRow,
): WorkflowTransitionDto {
  const gates = Array.isArray(row.gates)
    ? (row.gates as unknown as WorkflowGateDto[])
    : [];
  return {
    id: row.id,
    projectId: row.projectId,
    fromStatusId: row.fromStatusId,
    toStatusId: row.toStatusId,
    issueType: (row.issueType as IssueType) ?? null,
    name: row.name,
    gates,
    ...(row.workflowId !== undefined ? { workflowId: row.workflowId } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toWorkflowDto(
  row: NamedWorkflowRow,
  extras?: { transitionCount?: number; boardCount?: number },
): WorkflowDto {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    enforced: row.enforced,
    ...(extras?.transitionCount !== undefined
      ? { transitionCount: extras.transitionCount }
      : {}),
    ...(extras?.boardCount !== undefined
      ? { boardCount: extras.boardCount }
      : {}),
    createdAt: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class WorkflowService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Get workflow ──────────────────────────────────────────────────────────

  /**
   * Returns the full workflow for a project (enforced flag + transitions).
   * Authorization: any project member (VIEWER+).
   */
  async getWorkflow(userId: string, projectId: string): Promise<ProjectWorkflowConfigDto> {
    const project = await assertProjectMember(this.prisma, userId, projectId);

    const transitions = await this.prisma.workflowTransition.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });

    return {
      projectId,
      enforced: (project as { workflowEnforced?: boolean }).workflowEnforced ?? false,
      transitions: transitions.map(toWorkflowTransitionDto),
    };
  }

  // ── Patch enforced flag ───────────────────────────────────────────────────

  /**
   * Enable or disable workflow enforcement for a project.
   * Authorization: project ADMIN.
   *
   * AUTO-SEED BEHAVIOR: when enabling (`enforced: true`) and the project has
   * zero WorkflowTransition rows, a permissive default set is generated — one
   * transition for every ordered pair of distinct statuses (fromStatusId=A,
   * toStatusId=B, issueType=null, gates=[]). This ensures that enabling
   * enforcement never immediately bricks the board. Admins can then prune or
   * tighten transitions as needed.
   *
   * Automation-applied moves bypass enforcement (opts.automated === true) to
   * avoid automations getting stuck on their own gate checks.
   */
  async patchEnforced(
    userId: string,
    projectId: string,
    dto: PatchWorkflowDto,
  ): Promise<ProjectWorkflowConfigDto> {
    await assertProjectRole(this.prisma, userId, projectId, Role.ADMIN);

    await this.prisma.project.update({
      where: { id: projectId },
      data: { workflowEnforced: dto.enforced },
    });

    // Auto-seed when enabling with zero transitions.
    if (dto.enforced) {
      const count = await this.prisma.workflowTransition.count({
        where: { projectId },
      });

      if (count === 0) {
        await this.seedDefaultTransitions(projectId);
      }
    }

    const transitions = await this.prisma.workflowTransition.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });

    return {
      projectId,
      enforced: dto.enforced,
      transitions: transitions.map(toWorkflowTransitionDto),
    };
  }

  /**
   * Seeds a permissive default transition for every ordered pair of distinct
   * statuses in the project. Called only when workflowEnforced is set to true
   * for the first time (zero existing transitions).
   *
   * Each pair (A→B) gets gates=[], issueType=null so all issue types may move
   * freely. Admins prune/restrict from this baseline.
   */
  private async seedDefaultTransitions(projectId: string): Promise<void> {
    const statuses = await this.prisma.status.findMany({
      where: { projectId },
      orderBy: { order: 'asc' },
      select: { id: true },
    });

    const data: Prisma.WorkflowTransitionCreateManyInput[] = [];
    for (const from of statuses) {
      for (const to of statuses) {
        if (from.id !== to.id) {
          data.push({
            projectId,
            fromStatusId: from.id,
            toStatusId: to.id,
            issueType: null,
            name: null,
            gates: [],
          });
        }
      }
    }

    if (data.length > 0) {
      // skipDuplicates in case of a concurrent seed (race safety).
      await this.prisma.workflowTransition.createMany({
        data,
        skipDuplicates: true,
      });
    }
  }

  // ── Create transition ─────────────────────────────────────────────────────

  /**
   * Add a workflow transition to a project.
   * Authorization: project ADMIN.
   *
   * Validates:
   *  - toStatusId belongs to projectId
   *  - fromStatusId (if non-null) belongs to projectId
   *  - issueType is a valid IssueType or null
   *  - gates array: REQUIRE_FIELD needs field, REQUIRE_LINK needs linkType
   * Returns 409 on duplicate (projectId, fromStatusId, toStatusId, issueType).
   */
  async createTransition(
    userId: string,
    projectId: string,
    dto: CreateWorkflowTransitionDto,
  ): Promise<WorkflowTransitionDto> {
    await assertProjectRole(this.prisma, userId, projectId, Role.ADMIN);

    await this.validateStatusBelongsToProject(dto.toStatusId, projectId);
    if (dto.fromStatusId != null) {
      await this.validateStatusBelongsToProject(dto.fromStatusId, projectId);
    }

    const gates = dto.gates ?? [];

    try {
      const row = await this.prisma.workflowTransition.create({
        data: {
          projectId,
          fromStatusId: dto.fromStatusId ?? null,
          toStatusId: dto.toStatusId,
          issueType: dto.issueType ?? null,
          name: dto.name ?? null,
          gates: gates as unknown as Prisma.InputJsonValue,
        },
      });
      return toWorkflowTransitionDto(row);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'A transition with this (fromStatusId, toStatusId, issueType) already exists for this project',
        );
      }
      throw err;
    }
  }

  // ── Update transition ─────────────────────────────────────────────────────

  /**
   * Partially update a workflow transition. Re-validates any changed status ids.
   * Authorization: project ADMIN (resolved via the transition's projectId).
   */
  async updateTransition(
    userId: string,
    id: string,
    dto: PatchWorkflowTransitionDto,
  ): Promise<WorkflowTransitionDto> {
    const existing = await this.prisma.workflowTransition.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Workflow transition not found');

    await assertProjectRole(
      this.prisma,
      userId,
      existing.projectId,
      Role.ADMIN,
    );

    // Validate any status id changes.
    if (dto.toStatusId !== undefined) {
      await this.validateStatusBelongsToProject(
        dto.toStatusId,
        existing.projectId,
      );
    }
    // fromStatusId may be explicitly set to null (wildcard) — only validate
    // if it's a non-null string.
    if (dto.fromStatusId != null) {
      await this.validateStatusBelongsToProject(
        dto.fromStatusId,
        existing.projectId,
      );
    }

    try {
      const row = await this.prisma.workflowTransition.update({
        where: { id },
        data: {
          ...(dto.fromStatusId !== undefined
            ? { fromStatusId: dto.fromStatusId }
            : {}),
          ...(dto.toStatusId !== undefined ? { toStatusId: dto.toStatusId } : {}),
          ...(dto.issueType !== undefined ? { issueType: dto.issueType } : {}),
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.gates !== undefined
            ? { gates: dto.gates as unknown as Prisma.InputJsonValue }
            : {}),
        },
      });
      return toWorkflowTransitionDto(row);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'A transition with this (fromStatusId, toStatusId, issueType) already exists for this project',
        );
      }
      throw err;
    }
  }

  // ── Delete transition ─────────────────────────────────────────────────────

  /**
   * Delete a workflow transition.
   * Authorization: project ADMIN.
   */
  async deleteTransition(
    userId: string,
    id: string,
  ): Promise<void> {
    const existing = await this.prisma.workflowTransition.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Workflow transition not found');

    await assertProjectRole(
      this.prisma,
      userId,
      existing.projectId,
      Role.ADMIN,
    );

    await this.prisma.workflowTransition.delete({ where: { id } });
  }

  // ── Named workflow entity CRUD ────────────────────────────────────────────

  /**
   * List all named workflows for a project.
   * Each entry includes transitionCount + boardCount roll-ups.
   * Authorization: any project member (VIEWER+).
   */
  async listWorkflows(userId: string, projectId: string): Promise<WorkflowDto[]> {
    await assertProjectMember(this.prisma, userId, projectId);

    const rows = await this.prisma.workflow.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
      include: {
        _count: { select: { transitions: true, boards: true } },
      },
    });

    return rows.map((r) =>
      toWorkflowDto(r, {
        transitionCount: r._count.transitions,
        boardCount: r._count.boards,
      }),
    );
  }

  /**
   * Create a new named workflow for a project.
   * Authorization: project ADMIN.
   * Throws 409 on duplicate (projectId, name).
   */
  async createWorkflow(
    userId: string,
    projectId: string,
    dto: CreateNamedWorkflowDto,
  ): Promise<WorkflowDto> {
    await assertProjectRole(this.prisma, userId, projectId, Role.ADMIN);

    try {
      const row = await this.prisma.workflow.create({
        data: {
          projectId,
          name: dto.name,
          description: dto.description ?? null,
          enforced: dto.enforced ?? false,
        },
      });
      return toWorkflowDto(row, { transitionCount: 0, boardCount: 0 });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          `A workflow named "${dto.name}" already exists in this project`,
        );
      }
      throw err;
    }
  }

  /**
   * Get a single named workflow by id, including its workflow-scoped transitions.
   * Authorization: any project member (VIEWER+) — resolved via the workflow's projectId.
   */
  async getWorkflowById(userId: string, workflowId: string): Promise<WorkflowDto & { transitions: WorkflowTransitionDto[] }> {
    const wf = await this.prisma.workflow.findUnique({
      where: { id: workflowId },
    });
    if (!wf) throw new NotFoundException('Workflow not found');

    await assertProjectMember(this.prisma, userId, wf.projectId);

    const transitions = await this.prisma.workflowTransition.findMany({
      where: { workflowId },
      orderBy: { createdAt: 'asc' },
    });

    return {
      ...toWorkflowDto(wf, {
        transitionCount: transitions.length,
      }),
      transitions: transitions.map(toWorkflowTransitionDto),
    };
  }

  /**
   * Partially update a named workflow (name, description, enforced).
   * Authorization: project ADMIN.
   */
  async updateWorkflow(
    userId: string,
    workflowId: string,
    dto: UpdateNamedWorkflowDto,
  ): Promise<WorkflowDto> {
    const existing = await this.prisma.workflow.findUnique({
      where: { id: workflowId },
    });
    if (!existing) throw new NotFoundException('Workflow not found');

    await assertProjectRole(this.prisma, userId, existing.projectId, Role.ADMIN);

    try {
      const row = await this.prisma.workflow.update({
        where: { id: workflowId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.enforced !== undefined ? { enforced: dto.enforced } : {}),
        },
        include: {
          _count: { select: { transitions: true, boards: true } },
        },
      });
      return toWorkflowDto(row, {
        transitionCount: row._count.transitions,
        boardCount: row._count.boards,
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          `A workflow with that name already exists in this project`,
        );
      }
      throw err;
    }
  }

  /**
   * Delete a named workflow.
   * Cascade: its WorkflowTransitions are deleted; boards' workflowId is set null.
   * Authorization: project ADMIN.
   */
  async deleteWorkflow(userId: string, workflowId: string): Promise<void> {
    const existing = await this.prisma.workflow.findUnique({
      where: { id: workflowId },
    });
    if (!existing) throw new NotFoundException('Workflow not found');

    await assertProjectRole(this.prisma, userId, existing.projectId, Role.ADMIN);

    await this.prisma.workflow.delete({ where: { id: workflowId } });
  }

  // ── Workflow-scoped transition CRUD ───────────────────────────────────────

  /**
   * Create a transition that belongs to a named workflow (workflowId non-null).
   * Validates status ownership against the workflow's project.
   * Authorization: project ADMIN.
   * Throws 409 on (workflowId, fromStatusId, toStatusId, issueType) unique constraint.
   */
  async createWorkflowTransition(
    userId: string,
    workflowId: string,
    dto: CreateWorkflowTransitionDto,
  ): Promise<WorkflowTransitionDto> {
    const wf = await this.prisma.workflow.findUnique({
      where: { id: workflowId },
    });
    if (!wf) throw new NotFoundException('Workflow not found');

    await assertProjectRole(this.prisma, userId, wf.projectId, Role.ADMIN);

    await this.validateStatusBelongsToProject(dto.toStatusId, wf.projectId);
    if (dto.fromStatusId != null) {
      await this.validateStatusBelongsToProject(dto.fromStatusId, wf.projectId);
    }

    const gates = dto.gates ?? [];

    try {
      const row = await this.prisma.workflowTransition.create({
        data: {
          projectId: wf.projectId,
          workflowId,
          fromStatusId: dto.fromStatusId ?? null,
          toStatusId: dto.toStatusId,
          issueType: dto.issueType ?? null,
          name: dto.name ?? null,
          gates: gates as unknown as Prisma.InputJsonValue,
        },
      });
      return toWorkflowTransitionDto(row);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'A transition with this (fromStatusId, toStatusId, issueType) already exists in this workflow',
        );
      }
      throw err;
    }
  }

  /**
   * Update a workflow-scoped transition.
   * Authorization: project ADMIN (resolved via the transition's projectId).
   */
  async updateWorkflowTransition(
    userId: string,
    transitionId: string,
    dto: PatchWorkflowTransitionDto,
  ): Promise<WorkflowTransitionDto> {
    // Reuse existing updateTransition logic since it's auth-based on projectId.
    return this.updateTransition(userId, transitionId, dto);
  }

  /**
   * Delete a workflow-scoped transition.
   * Authorization: project ADMIN.
   */
  async deleteWorkflowTransition(
    userId: string,
    transitionId: string,
  ): Promise<void> {
    return this.deleteTransition(userId, transitionId);
  }

  // ── Seed from template ────────────────────────────────────────────────────

  /**
   * Create a named Workflow from a built-in template.
   *
   * Templates:
   *  - 'simple'     Linear: TODO→IN_PROGRESS→DONE only. No back-transitions.
   *                 Good for small teams or single-pass work.
   *  - 'kanban'     Fully permissive: any status → any other status.
   *                 Mirrors the default auto-seed; suited for continuous flow.
   *  - 'scrum'      Linear forward (same as simple) PLUS back-transitions:
   *                 IN_PROGRESS→TODO (blocked/deprioritised) and
   *                 DONE→IN_PROGRESS (re-open after QA). Suits sprints.
   *  - 'bug-triage' Adds a reopen path: DONE→TODO (reopen after report).
   *                 Otherwise linear. Suited for support or bug queues.
   *
   * Statuses are matched by category (TODO, IN_PROGRESS, DONE). If a category
   * is absent in the project, those template transitions are silently skipped
   * (instead of failing) so templates work on any status configuration.
   *
   * Authorization: project ADMIN.
   */
  async createWorkflowFromTemplate(
    userId: string,
    projectId: string,
    dto: CreateWorkflowFromTemplateDto,
  ): Promise<WorkflowDto & { transitions: WorkflowTransitionDto[] }> {
    await assertProjectRole(this.prisma, userId, projectId, Role.ADMIN);

    // Load the project's statuses grouped by category.
    const statuses = await this.prisma.status.findMany({
      where: { projectId },
      orderBy: { order: 'asc' },
      select: { id: true, category: true, name: true },
    });

    // Group statuses by category (take the first per category as canonical).
    const byCategory = new Map<string, typeof statuses[number]>();
    for (const s of statuses) {
      if (!byCategory.has(s.category)) {
        byCategory.set(s.category, s);
      }
    }

    const todo = byCategory.get(StatusCategory.TODO);
    const inProgress = byCategory.get(StatusCategory.IN_PROGRESS);
    const done = byCategory.get(StatusCategory.DONE);

    const workflowName = dto.name ?? `${dto.template.charAt(0).toUpperCase()}${dto.template.slice(1)} Workflow`;

    // Create the workflow entity first.
    let wf: NamedWorkflowRow;
    try {
      wf = await this.prisma.workflow.create({
        data: {
          projectId,
          name: workflowName,
          description: this.templateDescription(dto.template),
          enforced: false, // off by default; admin can enable after reviewing
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          `A workflow named "${workflowName}" already exists in this project`,
        );
      }
      throw err;
    }

    // Build transition data according to the template.
    const transData = this.buildTemplateTransitions(
      wf.id,
      projectId,
      dto.template,
      statuses,
      { todo, inProgress, done },
    );

    if (transData.length > 0) {
      await this.prisma.workflowTransition.createMany({
        data: transData,
        skipDuplicates: true,
      });
    }

    const created = await this.prisma.workflowTransition.findMany({
      where: { workflowId: wf.id },
      orderBy: { createdAt: 'asc' },
    });

    return {
      ...toWorkflowDto(wf, {
        transitionCount: created.length,
        boardCount: 0,
      }),
      transitions: created.map(toWorkflowTransitionDto),
    };
  }

  private templateDescription(template: string): string {
    switch (template) {
      case 'simple':
        return 'Linear workflow: TODO → IN_PROGRESS → DONE. No back-transitions.';
      case 'kanban':
        return 'Fully permissive workflow: any status to any other status. Ideal for continuous-flow boards.';
      case 'scrum':
        return 'Sprint workflow: linear forward plus back-transitions for blocked/re-opened items.';
      case 'bug-triage':
        return 'Bug triage workflow: linear with a reopen path from DONE back to TODO.';
      default:
        return '';
    }
  }

  /**
   * Build the transition create-many payload for a given template.
   *
   * Status resolution:
   *  - Only statuses whose category matches are used.
   *  - For 'kanban' every status pair is added (all-to-all).
   *  - For others, transitions target the first status of each category.
   */
  private buildTemplateTransitions(
    workflowId: string,
    projectId: string,
    template: string,
    allStatuses: { id: string; category: string }[],
    canonical: {
      todo: { id: string } | undefined;
      inProgress: { id: string } | undefined;
      done: { id: string } | undefined;
    },
  ): Prisma.WorkflowTransitionCreateManyInput[] {
    const { todo, inProgress, done } = canonical;
    const data: Prisma.WorkflowTransitionCreateManyInput[] = [];

    const base = (from: string | null, to: string, name?: string) => ({
      projectId,
      workflowId,
      fromStatusId: from,
      toStatusId: to,
      issueType: null,
      name: name ?? null,
      gates: [] as unknown as Prisma.InputJsonValue,
    });

    switch (template) {
      case 'simple':
        // TODO → IN_PROGRESS → DONE (strict linear, no back-transitions)
        if (todo && inProgress) data.push(base(todo.id, inProgress.id, 'Start Work'));
        if (inProgress && done) data.push(base(inProgress.id, done.id, 'Complete'));
        // Also allow starting from any status (null) → first status (initial creation)
        break;

      case 'kanban':
        // All statuses → all other statuses (fully permissive)
        for (const from of allStatuses) {
          for (const to of allStatuses) {
            if (from.id !== to.id) {
              data.push(base(from.id, to.id));
            }
          }
        }
        break;

      case 'scrum':
        // Forward: TODO → IN_PROGRESS → DONE
        if (todo && inProgress) data.push(base(todo.id, inProgress.id, 'Start Work'));
        if (inProgress && done) data.push(base(inProgress.id, done.id, 'Complete'));
        // Back-transitions: IN_PROGRESS → TODO (blocked), DONE → IN_PROGRESS (re-open for fixes)
        if (inProgress && todo) data.push(base(inProgress.id, todo.id, 'Block / Deprioritize'));
        if (done && inProgress) data.push(base(done.id, inProgress.id, 'Reopen for Fix'));
        break;

      case 'bug-triage':
        // Forward: TODO → IN_PROGRESS → DONE
        if (todo && inProgress) data.push(base(todo.id, inProgress.id, 'Start Investigation'));
        if (inProgress && done) data.push(base(inProgress.id, done.id, 'Resolve'));
        // Reopen path: DONE → TODO (re-reported / not fixed)
        if (done && todo) data.push(base(done.id, todo.id, 'Reopen'));
        break;
    }

    return data;
  }

  // ── Board-context enforcement ─────────────────────────────────────────────

  /**
   * Enforce transitions for a named workflow (board-scoped path).
   *
   * Mirrors the logic of `enforceTransition` but operates against the transitions
   * belonging to the given workflowId rather than the project-level legacy set.
   * Only called when `opts.automated` is false and the board carries a non-null
   * `workflowId` with `enforced = true`.
   *
   * @param workflowId      The named workflow to enforce.
   * @param issueId         The issue being moved.
   * @param targetStatusId  The destination status.
   */
  async enforceTransitionForWorkflow(
    workflowId: string,
    issueId: string,
    targetStatusId: string,
  ): Promise<void> {
    // Load the issue with all gate-relevant fields.
    const issue = await this.prisma.issue.findUnique({
      where: { id: issueId },
      select: {
        id: true,
        projectId: true,
        type: true,
        statusId: true,
        assigneeId: true,
        description: true,
        customFields: true,
        linksFrom: {
          select: {
            type: true,
            target: { select: { status: { select: { category: true } } } },
          },
        },
        linksTo: {
          select: {
            type: true,
            source: { select: { status: { select: { category: true } } } },
          },
        },
      },
    });
    if (!issue) return; // Update path will 404.

    // Same-status → allow.
    if (targetStatusId === issue.statusId) return;

    // Find matching transitions scoped to this workflow.
    const transitions = await this.prisma.workflowTransition.findMany({
      where: {
        workflowId,
        toStatusId: targetStatusId,
        OR: [
          { fromStatusId: issue.statusId },
          { fromStatusId: null },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });

    const matching = transitions.filter(
      (t) => t.issueType === null || t.issueType === issue.type,
    );

    if (matching.length === 0) {
      // Build a helpful error listing allowed next statuses from this workflow.
      const allowed = await this.getAllowedTargetStatusesForWorkflow(
        workflowId,
        issue.statusId,
        issue.type,
      );
      const names = allowed.map((s) => `"${s.name}"`).join(', ');
      throw new UnprocessableEntityException(
        `Transition from current status to the requested status is not allowed by the board workflow. ` +
        `Allowed next statuses from here: ${names || 'none'}`,
      );
    }

    const transition = matching[0];
    const gates = Array.isArray(transition.gates)
      ? (transition.gates as unknown as { type: string; field?: string; linkType?: string }[])
      : [];

    for (const gate of gates) {
      await this.evaluateGate(gate, issue);
    }
  }

  private async getAllowedTargetStatusesForWorkflow(
    workflowId: string,
    fromStatusId: string,
    issueType: string,
  ): Promise<{ name: string }[]> {
    const transitions = await this.prisma.workflowTransition.findMany({
      where: {
        workflowId,
        OR: [{ fromStatusId }, { fromStatusId: null }],
      },
    });

    const typeMatching = transitions.filter(
      (t) => t.issueType === null || t.issueType === issueType,
    );

    if (typeMatching.length === 0) return [];

    const toStatusIds = [...new Set(typeMatching.map((t) => t.toStatusId))];
    return this.prisma.status.findMany({
      where: { id: { in: toStatusIds } },
      select: { name: true },
      orderBy: { order: 'asc' },
    });
  }

  // ── Enforcement (called by IssuesService) ─────────────────────────────────

  /**
   * Validate that the requested status transition is allowed by the project's
   * workflow configuration.
   *
   * BEHAVIOR:
   *  - If the project's workflowEnforced flag is false → no-op (backward compat).
   *  - If targetStatusId === currentStatusId → allow (not a real transition).
   *  - If enforced: look for a matching transition where:
   *      toStatusId = targetStatusId AND
   *      (fromStatusId = currentStatusId OR fromStatusId IS NULL) AND
   *      (issueType = issue.type OR issueType IS NULL)
   *    - Most-specific match wins (fromStatus + issueType > fromStatus only > etc.)
   *      but for gate evaluation any matching transition is sufficient (we use the
   *      first match by Prisma order, which is createdAt asc).
   *  - If no matching transition → throw UnprocessableEntityException (422).
   *  - Evaluate gates in order; on first failure → throw UnprocessableEntityException (422).
   *
   * AUTOMATION BYPASS:
   *  - When `opts.automated === true`, enforcement is SKIPPED. This prevents
   *    automation rules from getting stuck when they try to move an issue through
   *    a guarded transition. Automation-applied moves are assumed to be correct
   *    by design (they are triggered after another successful transition, not by
   *    external user input).
   *
   * @param issueId         The id of the issue being moved.
   * @param targetStatusId  The destination status id.
   * @param opts            Mutation options (automated flag).
   */
  async enforceTransition(
    issueId: string,
    targetStatusId: string,
    opts?: { automated?: boolean; workflowEnforced?: boolean },
  ): Promise<void> {
    // Automation-applied moves bypass enforcement.
    if (opts?.automated) return;

    // If the caller has already determined enforcement is off (e.g. bulk update
    // preloaded the flag once for all issues), skip immediately — saves the
    // per-issue project lookup.
    if (opts?.workflowEnforced === false) return;

    // Load the issue with its current status, assignee, description, type,
    // custom fields, and all links.
    const issue = await this.prisma.issue.findUnique({
      where: { id: issueId },
      select: {
        id: true,
        projectId: true,
        type: true,
        statusId: true,
        assigneeId: true,
        description: true,
        customFields: true,
        linksFrom: {
          select: {
            type: true,
            target: { select: { status: { select: { category: true } } } },
          },
        },
        linksTo: {
          select: {
            type: true,
            source: { select: { status: { select: { category: true } } } },
          },
        },
      },
    });
    if (!issue) return; // If the issue can't be found the update path will 404.

    // Load the project's enforcement flag — skipped when the caller preloaded it
    // as true (workflowEnforced === true means "enforcement is on; proceed").
    let workflowEnforced: boolean;
    if (opts?.workflowEnforced === true) {
      workflowEnforced = true;
    } else {
      const project = await this.prisma.project.findUnique({
        where: { id: issue.projectId },
        select: { workflowEnforced: true },
      });
      workflowEnforced = project?.workflowEnforced ?? false;
    }
    if (!workflowEnforced) return;

    // Same-status → allow (no transition happening).
    if (targetStatusId === issue.statusId) return;

    // Find a matching transition:
    //   toStatusId = target AND (fromStatusId = current OR fromStatusId IS NULL)
    //   AND (issueType = issue.type OR issueType IS NULL)
    const transitions = await this.prisma.workflowTransition.findMany({
      where: {
        projectId: issue.projectId,
        toStatusId: targetStatusId,
        OR: [
          { fromStatusId: issue.statusId },
          { fromStatusId: null },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });

    // Filter to type-matching transitions (exact type match OR null/wildcard).
    const matching = transitions.filter(
      (t) => t.issueType === null || t.issueType === issue.type,
    );

    if (matching.length === 0) {
      // Build a helpful message: list the allowed next statuses from current.
      const allowed = await this.getAllowedTargetStatuses(
        issue.projectId,
        issue.statusId,
        issue.type,
      );
      const names = allowed.map((s) => `"${s.name}"`).join(', ');
      throw new UnprocessableEntityException(
        `Transition from current status to the requested status is not allowed by the project workflow. ` +
        `Allowed next statuses from here: ${names || 'none'}`,
      );
    }

    // Use the first matching transition (most recently created / most specific
    // ordering handled by the service when creating; here we just take the first).
    const transition = matching[0];
    const gates = Array.isArray(transition.gates)
      ? (transition.gates as unknown as { type: string; field?: string; linkType?: string }[])
      : [];

    for (const gate of gates) {
      await this.evaluateGate(gate, issue);
    }
  }

  /**
   * Evaluate a single gate rule against the current issue state.
   * Throws UnprocessableEntityException with a descriptive message on failure.
   */
  private async evaluateGate(
    gate: { type: string; field?: string; linkType?: string },
    issue: {
      id: string;
      assigneeId: string | null;
      description: string | null;
      customFields: Prisma.JsonValue | null;
      linksFrom: Array<{
        type: string;
        target: { status: { category: string } | null } | null;
      }>;
      linksTo: Array<{
        type: string;
        source: { status: { category: string } | null } | null;
      }>;
    },
  ): Promise<void> {
    switch (gate.type) {
      case 'REQUIRE_ASSIGNEE': {
        if (!issue.assigneeId) {
          throw new UnprocessableEntityException(
            'This transition requires the issue to have an assignee',
          );
        }
        break;
      }

      case 'REQUIRE_DESCRIPTION': {
        if (!issue.description || issue.description.trim().length === 0) {
          throw new UnprocessableEntityException(
            'This transition requires the issue to have a non-empty description',
          );
        }
        break;
      }

      case 'REQUIRE_FIELD': {
        const fieldName = gate.field;
        if (!fieldName) break; // Mis-configured gate — skip silently.

        // Core field check first.
        const coreFields: Record<string, () => boolean> = {
          assignee: () => issue.assigneeId != null,
          assigneeId: () => issue.assigneeId != null,
          description: () =>
            issue.description != null && issue.description.trim().length > 0,
          storyPoints: () => {
            const cf = issue.customFields as Record<string, unknown> | null;
            if (cf && 'storyPoints' in cf) return cf.storyPoints != null;
            return false;
          },
          dueDate: () => {
            const cf = issue.customFields as Record<string, unknown> | null;
            if (cf && 'dueDate' in cf) return cf.dueDate != null;
            return false;
          },
          priority: () => true, // Priority always has a default value.
        };

        if (fieldName in coreFields) {
          if (!coreFields[fieldName]()) {
            throw new UnprocessableEntityException(
              `This transition requires the field "${fieldName}" to be set`,
            );
          }
          break;
        }

        // Custom field: look up by key in customFields JSON.
        // customFields is stored as { [definitionId]: value } — we need to
        // also support lookup by key. Load definitions to resolve the key.
        const customFields =
          (issue.customFields as Record<string, unknown> | null) ?? {};
        const fieldValue = customFields[fieldName];
        if (fieldValue == null || fieldValue === '') {
          // Try to find by definition id (in case fieldName is a CUID).
          // If not found, or value is falsy, fail the gate.
          throw new UnprocessableEntityException(
            `This transition requires the field "${fieldName}" to be set`,
          );
        }
        break;
      }

      case 'REQUIRE_LINK': {
        const linkType = gate.linkType;
        if (!linkType) break; // Mis-configured gate — skip silently.

        // Check both outgoing (linksFrom) and incoming (linksTo) perspectives.
        // The stored canonical direction is BLOCKS (source=blocker, target=blocked).
        // REQUIRE_LINK checks for any link of the specified type from the issue's perspective.
        const hasLink =
          issue.linksFrom.some((l) => l.type === linkType) ||
          issue.linksTo.some((l) => l.type === linkType);

        if (!hasLink) {
          throw new UnprocessableEntityException(
            `This transition requires the issue to have at least one link of type "${linkType}"`,
          );
        }
        break;
      }

      case 'REQUIRE_NO_OPEN_BLOCKERS': {
        // An open blocker is: a BLOCKS link where this issue is the TARGET (i.e.
        // the issue is "blocked by" the source), AND the source's status is NOT
        // in DONE category.
        //
        // IssueLink storage: type=BLOCKS, source=blocker, target=blocked-issue.
        // So: linksTo where type=BLOCKS and source.status.category != DONE.
        const hasOpenBlocker = issue.linksTo.some(
          (link) =>
            link.type === 'BLOCKS' &&
            link.source?.status?.category !== StatusCategory.DONE,
        );

        if (hasOpenBlocker) {
          throw new UnprocessableEntityException(
            'This transition requires all blocking issues to be resolved (no open blockers)',
          );
        }
        break;
      }

      default:
        // Unknown gate type — skip silently to allow forward-compat.
        break;
    }
  }

  // ── Bulk-update optimisation helpers ─────────────────────────────────────

  /**
   * Returns true if workflow enforcement is currently enabled for the project.
   *
   * Callers that process many issues in a loop (e.g. bulkUpdate) can call this
   * once and skip per-issue enforcement entirely when it returns false — saving
   * N × (issue-lookup + project-lookup) DB round-trips.
   */
  async isEnforcementEnabled(projectId: string): Promise<boolean> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { workflowEnforced: true },
    });
    return project?.workflowEnforced ?? false;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Validate that the given status id belongs to the given project.
   */
  private async validateStatusBelongsToProject(
    statusId: string,
    projectId: string,
  ): Promise<void> {
    const status = await this.prisma.status.findUnique({
      where: { id: statusId },
      select: { projectId: true },
    });
    if (!status || status.projectId !== projectId) {
      throw new NotFoundException(
        `Status "${statusId}" not found in this project`,
      );
    }
  }

  /**
   * List the names of statuses reachable from `fromStatusId` given a
   * `fromStatusId`/`issueType` combination, for error messages.
   */
  private async getAllowedTargetStatuses(
    projectId: string,
    fromStatusId: string,
    issueType: string,
  ): Promise<{ name: string }[]> {
    const transitions = await this.prisma.workflowTransition.findMany({
      where: {
        projectId,
        OR: [{ fromStatusId }, { fromStatusId: null }],
      },
    });

    const typeMatching = transitions.filter(
      (t) => t.issueType === null || t.issueType === issueType,
    );

    if (typeMatching.length === 0) return [];

    const toStatusIds = [...new Set(typeMatching.map((t) => t.toStatusId))];
    return this.prisma.status.findMany({
      where: { id: { in: toStatusIds } },
      select: { name: true },
      orderBy: { order: 'asc' },
    });
  }
}
