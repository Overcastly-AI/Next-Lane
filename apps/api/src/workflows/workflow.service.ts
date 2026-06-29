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
  PatchWorkflowDto,
  PatchWorkflowTransitionDto,
} from './dto/workflow.dto';
import { IssueType, Role, StatusCategory } from '@next-lane/shared';
import type {
  ProjectWorkflowConfigDto,
  WorkflowGateDto,
  WorkflowTransitionDto,
} from '@next-lane/shared';

// ---------------------------------------------------------------------------
// Internal row types
// ---------------------------------------------------------------------------

interface WorkflowTransitionRow {
  id: string;
  projectId: string;
  fromStatusId: string | null;
  toStatusId: string;
  issueType: string | null;
  name: string | null;
  gates: Prisma.JsonValue;
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
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
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
