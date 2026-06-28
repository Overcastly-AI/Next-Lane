/**
 * AutomationEngineService
 *
 * Listens to automation domain events emitted by the issue/comment mutation
 * seams and evaluates enabled project rules against the triggering issue.
 *
 * Loop guard (v1): if an event carries `automated: true`, the engine returns
 * immediately without evaluating rules. This prevents infinite chaining when
 * an automation action (e.g. ADD_COMMENT) itself emits a secondary event.
 * Chaining is a planned v2 feature.
 *
 * Error isolation: the engine swallows all exceptions so a bad rule or
 * transient error never breaks the caller's original mutation response.
 * Each rule run result is written to AutomationRun for full Glass Box
 * transparency.
 */

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IssuesService } from '../issues/issues.service';
import { CommentsService } from '../comments/comments.service';
import { LabelsService } from '../labels/labels.service';
import {
  AutomationTrigger,
  AutomationActionType,
  AutomationRunStatus,
  Priority,
  parse,
  evaluate,
} from '@next-lane/shared';
import type {
  AutomationActionDto,
  AutomationRunActionDto,
  IssueDto,
  EvalContext,
  NlqlUser,
  NlqlCustomFieldDef,
} from '@next-lane/shared';
import {
  AUTOMATION_EVENTS,
  AutomationEvent,
} from './automation-events';
import { toIssueDto } from '../issues/issue.mapper';

/** Full Prisma include for building the IssueDto passed to the NLQL evaluator. */
const issueInclude = {
  status: true,
  assignee: true,
  reporter: true,
  labels: { include: { label: true } },
  project: { select: { key: true } },
  _count: { select: { comments: true } },
} satisfies Prisma.IssueInclude;

@Injectable()
export class AutomationEngineService {
  private readonly logger = new Logger(AutomationEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly issuesService: IssuesService,
    private readonly commentsService: CommentsService,
    private readonly labelsService: LabelsService,
  ) {}

  // ── Event listeners ───────────────────────────────────────────────────────

  @OnEvent(AUTOMATION_EVENTS.ISSUE_CREATED, { async: true })
  async onIssueCreated(event: AutomationEvent): Promise<void> {
    await this.handleEvent(event);
  }

  @OnEvent(AUTOMATION_EVENTS.ISSUE_UPDATED, { async: true })
  async onIssueUpdated(event: AutomationEvent): Promise<void> {
    await this.handleEvent(event);
  }

  @OnEvent(AUTOMATION_EVENTS.ISSUE_TRANSITIONED, { async: true })
  async onIssueTransitioned(event: AutomationEvent): Promise<void> {
    await this.handleEvent(event);
  }

  @OnEvent(AUTOMATION_EVENTS.ISSUE_COMMENTED, { async: true })
  async onIssueCommented(event: AutomationEvent): Promise<void> {
    await this.handleEvent(event);
  }

  // ── Core handler ──────────────────────────────────────────────────────────

  /**
   * Main entry point. Wraps everything in a broad try/catch so a bug in the
   * engine never propagates back into the EventEmitter and never breaks the
   * caller's HTTP response.
   */
  private async handleEvent(event: AutomationEvent): Promise<void> {
    // ── LOOP GUARD ───────────────────────────────────────────────────────────
    // Mutations applied by the engine itself carry automated=true. Evaluating
    // rules against those events would cause infinite chaining (v1 prevents
    // this entirely; v2 may add controlled chaining with a depth cap).
    if (event.automated) {
      return;
    }

    try {
      await this.processEvent(event);
    } catch (err) {
      this.logger.error(
        `Automation engine uncaught error for event ${event.trigger} on issue ${event.issueId}: ${String(err)}`,
      );
    }
  }

  private async processEvent(event: AutomationEvent): Promise<void> {
    const { projectId, issueId, actorUserId, trigger } = event;

    // Load enabled rules for this project + trigger, ordered by evaluation priority.
    const rules = await this.prisma.automationRule.findMany({
      where: { projectId, enabled: true, trigger },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });

    if (rules.length === 0) return;

    // Build the IssueDto once for all rules (NLQL evaluator needs full shape).
    const issueRecord = await this.prisma.issue.findUnique({
      where: { id: issueId },
      include: issueInclude,
    });

    // Issue may have been deleted between the event emission and here.
    if (!issueRecord) {
      this.logger.warn(`Automation: issue ${issueId} not found for trigger ${trigger}`);
      return;
    }

    const issueDto = toIssueDto(issueRecord);

    // Build EvalContext (custom field defs + project users for me() resolution).
    const evalCtx = await this.buildEvalContext(projectId);

    // Evaluate each rule sequentially (preserves order semantics).
    for (const rule of rules) {
      await this.evaluateRule(rule, issueDto, evalCtx, actorUserId, trigger);
    }
  }

  // ── Rule evaluation ───────────────────────────────────────────────────────

  private async evaluateRule(
    rule: {
      id: string;
      condition: string | null;
      actions: Prisma.JsonValue;
      createdById: string | null;
    },
    issueDto: IssueDto,
    evalCtx: EvalContext,
    actorUserId: string,
    trigger: AutomationTrigger,
  ): Promise<void> {
    // Actor for automation actions: the rule creator if available, else the
    // user who triggered the original event.
    const automationActorId = rule.createdById ?? actorUserId;

    // ── Condition evaluation ──────────────────────────────────────────────
    let matched = true;
    if (rule.condition) {
      try {
        const ast = parse(rule.condition);
        matched = evaluate(ast, issueDto, evalCtx);
      } catch (err) {
        // Parse/eval error → record FAILED run, continue to next rule.
        await this.writeRun({
          ruleId: rule.id,
          issueId: issueDto.id,
          trigger,
          matched: false,
          status: AutomationRunStatus.FAILED,
          actionsApplied: [],
          error: `Condition evaluation error: ${String(err)}`,
        });
        return;
      }
    }

    // ── Condition did not match → SKIPPED (Glass Box: always record) ──────
    if (!matched) {
      await this.writeRun({
        ruleId: rule.id,
        issueId: issueDto.id,
        trigger,
        matched: false,
        status: AutomationRunStatus.SKIPPED,
        actionsApplied: [],
        error: null,
      });
      return;
    }

    // ── Execute actions ───────────────────────────────────────────────────
    const actions = this.coerceActions(rule.actions);
    const actionsApplied: AutomationRunActionDto[] = [];
    let runStatus: AutomationRunStatus = AutomationRunStatus.SUCCESS;
    let runError: string | null = null;

    for (const action of actions) {
      try {
        const detail = await this.executeAction(
          action,
          issueDto,
          automationActorId,
        );
        actionsApplied.push({ type: action.type, detail });
      } catch (err) {
        runStatus = AutomationRunStatus.FAILED;
        runError = `Action ${action.type} failed: ${String(err)}`;
        // Stop executing remaining actions for this rule on first failure.
        break;
      }
    }

    await this.writeRun({
      ruleId: rule.id,
      issueId: issueDto.id,
      trigger,
      matched: true,
      status: runStatus,
      actionsApplied,
      error: runError,
    });
  }

  // ── Action executors ──────────────────────────────────────────────────────

  private async executeAction(
    action: AutomationActionDto,
    issue: IssueDto,
    actorUserId: string,
  ): Promise<string> {
    const params = action.params as Record<string, unknown>;
    const opts = { automated: true };

    switch (action.type) {
      case AutomationActionType.ASSIGN: {
        const assigneeId = (params.assigneeId ?? null) as string | null;
        await this.issuesService.update(actorUserId, issue.id, { assigneeId }, opts);
        return assigneeId ? `assigned to ${assigneeId}` : 'unassigned';
      }

      case AutomationActionType.SET_PRIORITY: {
        const priority = params.priority as Priority;
        await this.issuesService.update(actorUserId, issue.id, { priority }, opts);
        return `priority set to ${priority}`;
      }

      case AutomationActionType.TRANSITION: {
        const statusId = params.statusId as string;
        await this.issuesService.move(actorUserId, issue.id, { statusId }, opts);
        return `transitioned to status ${statusId}`;
      }

      case AutomationActionType.ADD_LABEL: {
        const labelId = params.labelId as string;
        await this.labelsService.addToIssue(actorUserId, issue.id, labelId);
        return `label ${labelId} added`;
      }

      case AutomationActionType.ADD_COMMENT: {
        const body = params.body as string;
        await this.commentsService.create(actorUserId, issue.id, { body }, opts);
        return `comment added`;
      }

      case AutomationActionType.SET_CUSTOM_FIELD: {
        const fieldId = params.fieldId as string;
        const value = params.value;
        await this.issuesService.update(
          actorUserId,
          issue.id,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { customFields: { [fieldId]: value } as any },
          opts,
        );
        return `custom field ${fieldId} set to ${JSON.stringify(value)}`;
      }

      default:
        throw new Error(`Unknown action type: ${String(action.type)}`);
    }
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  private async writeRun(data: {
    ruleId: string;
    issueId: string;
    trigger: AutomationTrigger;
    matched: boolean;
    status: AutomationRunStatus;
    actionsApplied: AutomationRunActionDto[];
    error: string | null;
  }): Promise<void> {
    try {
      await this.prisma.automationRun.create({
        data: {
          ruleId: data.ruleId,
          issueId: data.issueId,
          trigger: data.trigger,
          matched: data.matched,
          status: data.status,
          actionsApplied: data.actionsApplied as unknown as Prisma.InputJsonValue,
          error: data.error,
        },
      });
    } catch (err) {
      // Run persistence failure must not interrupt rule processing.
      this.logger.error(`Failed to persist AutomationRun: ${String(err)}`);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private coerceActions(raw: Prisma.JsonValue): AutomationActionDto[] {
    if (!Array.isArray(raw)) return [];
    return (raw as Prisma.JsonArray).filter(
      (item): item is Prisma.JsonObject =>
        item !== null && typeof item === 'object' && !Array.isArray(item),
    ) as unknown as AutomationActionDto[];
  }

  private async buildEvalContext(projectId: string): Promise<EvalContext> {
    // Load custom field definitions for the project.
    const fieldRows = await this.prisma.customFieldDefinition.findMany({
      where: { projectId },
      select: { id: true, key: true, name: true, type: true },
    });
    const customFieldDefs: NlqlCustomFieldDef[] = fieldRows.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      type: r.type as NlqlCustomFieldDef['type'],
    }));

    // Load all users who are members of this project's workspace.
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { workspaceId: true },
    });

    let users: NlqlUser[] = [];
    if (project) {
      const memberships = await this.prisma.membership.findMany({
        where: { workspaceId: project.workspaceId },
        include: { user: { select: { id: true, email: true, name: true } } },
      });
      users = memberships.map((m) => ({
        id: m.user.id,
        email: m.user.email,
        name: m.user.name,
      }));
    }

    return { customFieldDefs, users };
  }
}
