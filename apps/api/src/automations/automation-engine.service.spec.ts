/**
 * Unit tests for AutomationEngineService.
 *
 * Tests:
 * - Loop guard: automated=true events are silently ignored
 * - Null condition → matched=true, actions executed with {automated:true}
 * - Condition false → SKIPPED run, no action calls
 * - Condition parse error → FAILED run, no actions
 * - Action throws → FAILED run with error + partial actionsApplied, stops that rule
 * - Actor resolution: rule.createdById ?? event.actorUserId
 * - Rules evaluated in order (order asc, createdAt asc)
 */

import { AutomationEngineService } from './automation-engine.service';
import {
  AutomationTrigger,
  AutomationActionType,
  AutomationRunStatus,
  Priority,
} from '@next-lane/shared';
import type { PrismaService } from '../prisma/prisma.service';
import type { IssuesService } from '../issues/issues.service';
import type { CommentsService } from '../comments/comments.service';
import type { LabelsService } from '../labels/labels.service';
import type { IssueCreatedEvent } from './automation-events';
import { AUTOMATION_EVENTS } from './automation-events';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACTOR_USER_ID = 'user-actor';
const RULE_CREATOR_ID = 'user-rule-creator';
const PROJECT_ID = 'proj-1';
const ISSUE_ID = 'issue-1';
const WORKSPACE_ID = 'ws-1';

const ISSUE_ROW = {
  id: ISSUE_ID,
  number: 1,
  projectId: PROJECT_ID,
  type: 'TASK',
  title: 'Test issue',
  description: null,
  statusId: 'status-1',
  assigneeId: null,
  reporterId: null,
  priority: 'MEDIUM',
  storyPoints: null,
  parentId: null,
  sprintId: null,
  dueDate: null,
  rank: 'a0',
  customFields: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  project: { key: 'NL' },
  status: { id: 'status-1', name: 'To Do', category: 'TODO', order: 0, projectId: PROJECT_ID },
  assignee: null,
  reporter: null,
  labels: [],
  _count: { comments: 0 },
};

function makeRule(overrides: Partial<{
  id: string;
  condition: string | null;
  actions: object[];
  order: number;
  createdById: string | null;
  createdAt: Date;
}> = {}) {
  return {
    id: overrides.id ?? 'rule-1',
    projectId: PROJECT_ID,
    name: 'Test Rule',
    description: null,
    enabled: true,
    trigger: AutomationTrigger.ISSUE_CREATED,
    condition: overrides.condition ?? null,
    actions: overrides.actions ?? [
      { type: AutomationActionType.SET_PRIORITY, params: { priority: Priority.HIGH } },
    ],
    order: overrides.order ?? 0,
    createdById: overrides.createdById !== undefined ? overrides.createdById : RULE_CREATOR_ID,
    createdAt: overrides.createdAt ?? new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };
}

function makeEvent(overrides: Partial<IssueCreatedEvent> = {}): IssueCreatedEvent {
  return {
    projectId: PROJECT_ID,
    issueId: ISSUE_ID,
    actorUserId: ACTOR_USER_ID,
    trigger: AutomationTrigger.ISSUE_CREATED,
    automated: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

function makePrisma(rules: object[] = []) {
  return {
    automationRule: {
      findMany: jest.fn().mockResolvedValue(rules),
    },
    issue: {
      findUnique: jest.fn().mockResolvedValue(ISSUE_ROW),
    },
    automationRun: {
      // Batch insert — replaces the previous per-rule create() loop.
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    customFieldDefinition: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    project: {
      findUnique: jest.fn().mockResolvedValue({ workspaceId: WORKSPACE_ID }),
    },
    membership: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    sprint: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

function makeIssuesService() {
  return {
    update: jest.fn().mockResolvedValue({}),
    move: jest.fn().mockResolvedValue({}),
  };
}

function makeCommentsService() {
  return {
    create: jest.fn().mockResolvedValue({}),
  };
}

function makeLabelsService() {
  return {
    addToIssue: jest.fn().mockResolvedValue([]),
  };
}

function makeEngine(prisma: ReturnType<typeof makePrisma>) {
  const issues = makeIssuesService();
  const comments = makeCommentsService();
  const labels = makeLabelsService();
  const engine = new AutomationEngineService(
    prisma as unknown as PrismaService,
    issues as unknown as IssuesService,
    comments as unknown as CommentsService,
    labels as unknown as LabelsService,
  );
  return { engine, issues, comments, labels };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AutomationEngineService', () => {

  // ── Helper: extract the first run row from a createMany batch ──────────────
  //
  // The engine now collects all run rows across rules and issues a single
  // createMany({ data: [...] }) call. Tests use this helper to inspect the
  // batch instead of per-call create() arguments.

  function firstRunRow(prisma: ReturnType<typeof makePrisma>) {
    const call = prisma.automationRun.createMany.mock.calls[0];
    expect(call).toBeDefined(); // fail fast if no call was made
    const rows = call[0].data as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    return rows[0];
  }

  function allRunRows(prisma: ReturnType<typeof makePrisma>) {
    const call = prisma.automationRun.createMany.mock.calls[0];
    expect(call).toBeDefined();
    return call[0].data as Array<Record<string, unknown>>;
  }

  describe('loop guard', () => {
    it('returns immediately when event.automated is true (no rule evaluation)', async () => {
      const prisma = makePrisma([makeRule()]);
      const { engine } = makeEngine(prisma);

      await engine.onIssueCreated(makeEvent({ automated: true }));

      // Should not even query rules
      expect(prisma.automationRule.findMany).not.toHaveBeenCalled();
      expect(prisma.automationRun.createMany).not.toHaveBeenCalled();
    });
  });

  describe('null condition (unconditional rule)', () => {
    it('evaluates as matched and calls IssuesService.update with {automated:true}', async () => {
      const rule = makeRule({ condition: null });
      const prisma = makePrisma([rule]);
      const { engine, issues } = makeEngine(prisma);

      await engine.onIssueCreated(makeEvent());

      expect(issues.update).toHaveBeenCalledWith(
        RULE_CREATOR_ID,
        ISSUE_ID,
        { priority: Priority.HIGH },
        { automated: true },
      );

      // createMany called once with a batch containing the SUCCESS row.
      expect(prisma.automationRun.createMany).toHaveBeenCalledTimes(1);
      const row = firstRunRow(prisma);
      expect(row.ruleId).toBe(rule.id);
      expect(row.matched).toBe(true);
      expect(row.status).toBe(AutomationRunStatus.SUCCESS);
    });
  });

  describe('condition evaluates to false', () => {
    it('writes SKIPPED run and does not call any action services', async () => {
      // NLQL condition that will be false for our issue (priority=MEDIUM, condition wants HIGH)
      const rule = makeRule({ condition: 'priority = High' });
      const prisma = makePrisma([rule]);
      const { engine, issues, comments, labels } = makeEngine(prisma);

      await engine.onIssueCreated(makeEvent());

      expect(issues.update).not.toHaveBeenCalled();
      expect(comments.create).not.toHaveBeenCalled();
      expect(labels.addToIssue).not.toHaveBeenCalled();

      expect(prisma.automationRun.createMany).toHaveBeenCalledTimes(1);
      const row = firstRunRow(prisma);
      expect(row.matched).toBe(false);
      expect(row.status).toBe(AutomationRunStatus.SKIPPED);
      expect(row.actionsApplied).toEqual([]);
    });
  });

  describe('condition parse error', () => {
    it('writes FAILED run and does not call any action services', async () => {
      const rule = makeRule({ condition: '!!! TOTALLY INVALID QUERY !!!' });
      const prisma = makePrisma([rule]);
      const { engine, issues } = makeEngine(prisma);

      await engine.onIssueCreated(makeEvent());

      expect(issues.update).not.toHaveBeenCalled();

      expect(prisma.automationRun.createMany).toHaveBeenCalledTimes(1);
      const row = firstRunRow(prisma);
      expect(row.status).toBe(AutomationRunStatus.FAILED);
      expect(row.matched).toBe(false);
      expect(String(row.error)).toContain('Condition evaluation error');
    });
  });

  describe('action throws', () => {
    it('writes FAILED run with error, records partial actionsApplied, stops remaining actions', async () => {
      // Two actions: first succeeds, second throws
      const rule = makeRule({
        condition: null,
        actions: [
          { type: AutomationActionType.SET_PRIORITY, params: { priority: Priority.HIGH } },
          { type: AutomationActionType.TRANSITION, params: { statusId: 'status-done' } },
        ],
      });
      const prisma = makePrisma([rule]);
      const { engine, issues } = makeEngine(prisma);

      // First call (SET_PRIORITY) succeeds; second (TRANSITION → move) throws
      issues.update.mockResolvedValueOnce({});
      issues.move.mockRejectedValueOnce(new Error('Status not found'));

      await engine.onIssueCreated(makeEvent());

      // update called once (SET_PRIORITY), move called once (TRANSITION)
      expect(issues.update).toHaveBeenCalledTimes(1);
      expect(issues.move).toHaveBeenCalledTimes(1);

      expect(prisma.automationRun.createMany).toHaveBeenCalledTimes(1);
      const row = firstRunRow(prisma);
      expect(row.status).toBe(AutomationRunStatus.FAILED);
      expect(String(row.error)).toContain('TRANSITION failed');
      // partial actionsApplied: only the first action succeeded
      const applied = row.actionsApplied as Array<{ type: string }>;
      expect(applied).toHaveLength(1);
      expect(applied[0].type).toBe(AutomationActionType.SET_PRIORITY);
    });
  });

  describe('actor resolution', () => {
    it('uses rule.createdById as the actor when present', async () => {
      const rule = makeRule({ condition: null, createdById: RULE_CREATOR_ID });
      const prisma = makePrisma([rule]);
      const { engine, issues } = makeEngine(prisma);

      await engine.onIssueCreated(makeEvent({ actorUserId: 'some-other-user' }));

      expect(issues.update).toHaveBeenCalledWith(
        RULE_CREATOR_ID,
        ISSUE_ID,
        expect.anything(),
        expect.anything(),
      );
    });

    it('falls back to event.actorUserId when rule.createdById is null', async () => {
      const rule = makeRule({ condition: null, createdById: null });
      const prisma = makePrisma([rule]);
      const { engine, issues } = makeEngine(prisma);

      await engine.onIssueCreated(makeEvent({ actorUserId: ACTOR_USER_ID }));

      expect(issues.update).toHaveBeenCalledWith(
        ACTOR_USER_ID,
        ISSUE_ID,
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe('rules evaluated in order', () => {
    it('evaluates rules in ascending order (order asc, createdAt asc)', async () => {
      const rule1 = makeRule({ id: 'rule-a', order: 1, condition: null });
      const rule2 = makeRule({ id: 'rule-b', order: 0, condition: null });
      // Note: Prisma is expected to return them pre-sorted; we verify the engine
      // iterates in the returned array order (engine trusts DB ordering).
      const prisma = makePrisma([rule2, rule1]); // sorted: order 0 first
      const { engine, issues } = makeEngine(prisma);

      issues.update.mockResolvedValue({});

      await engine.onIssueCreated(makeEvent());

      // One createMany call with 2 rows in evaluation order.
      expect(prisma.automationRun.createMany).toHaveBeenCalledTimes(1);
      const rows = allRunRows(prisma);
      expect(rows).toHaveLength(2);
      // First row should be for rule-b (order 0)
      expect(rows[0].ruleId).toBe('rule-b');
      // Second row should be for rule-a (order 1)
      expect(rows[1].ruleId).toBe('rule-a');
    });
  });

  describe('batch insert: multiple rules produce one createMany call', () => {
    it('issues exactly one createMany regardless of rule count', async () => {
      const rules = [
        makeRule({ id: 'rule-1', order: 0, condition: null }),
        makeRule({ id: 'rule-2', order: 1, condition: 'priority = High' }), // SKIPPED
        makeRule({ id: 'rule-3', order: 2, condition: null }),
      ];
      const prisma = makePrisma(rules);
      const { engine, issues } = makeEngine(prisma);
      issues.update.mockResolvedValue({});

      await engine.onIssueCreated(makeEvent());

      // Exactly one createMany call with all 3 rows.
      expect(prisma.automationRun.createMany).toHaveBeenCalledTimes(1);
      const rows = allRunRows(prisma);
      expect(rows).toHaveLength(3);
      expect(rows[0].ruleId).toBe('rule-1');
      expect(rows[0].status).toBe(AutomationRunStatus.SUCCESS);
      expect(rows[1].ruleId).toBe('rule-2');
      expect(rows[1].status).toBe(AutomationRunStatus.SKIPPED);
      expect(rows[2].ruleId).toBe('rule-3');
      expect(rows[2].status).toBe(AutomationRunStatus.SUCCESS);
    });
  });

  describe('ADD_COMMENT action', () => {
    it('calls CommentsService.create with {automated:true}', async () => {
      const rule = makeRule({
        condition: null,
        actions: [{ type: AutomationActionType.ADD_COMMENT, params: { body: 'Auto comment' } }],
      });
      const prisma = makePrisma([rule]);
      const { engine, comments } = makeEngine(prisma);

      await engine.onIssueCreated(makeEvent());

      expect(comments.create).toHaveBeenCalledWith(
        RULE_CREATOR_ID,
        ISSUE_ID,
        { body: 'Auto comment' },
        { automated: true },
      );
    });
  });

  describe('ADD_LABEL action', () => {
    it('calls LabelsService.addToIssue', async () => {
      const rule = makeRule({
        condition: null,
        actions: [{ type: AutomationActionType.ADD_LABEL, params: { labelId: 'label-1' } }],
      });
      const prisma = makePrisma([rule]);
      const { engine, labels } = makeEngine(prisma);

      await engine.onIssueCreated(makeEvent());

      expect(labels.addToIssue).toHaveBeenCalledWith(RULE_CREATOR_ID, ISSUE_ID, 'label-1');
    });
  });

  describe('no matching rules', () => {
    it('does not query issues or write runs when no rules exist', async () => {
      const prisma = makePrisma([]); // no rules
      const { engine, issues } = makeEngine(prisma);

      await engine.onIssueCreated(makeEvent());

      expect(prisma.issue.findUnique).not.toHaveBeenCalled();
      expect(prisma.automationRun.createMany).not.toHaveBeenCalled();
      expect(issues.update).not.toHaveBeenCalled();
    });
  });

  // ── NLQL person/sprint name resolution (MCP-QA pass 1, finding 1) ─────────
  //
  // Automations run per-event, so context loading is conditional on what the
  // triggered rules' conditions actually reference (getReferencedFieldKinds).

  describe('condition — assignee/sprint name resolution', () => {
    it('resolves assignee by display name in a rule condition', async () => {
      const rule = makeRule({ condition: 'assignee = "Alex Rivera"' });
      const prisma = makePrisma([rule]);
      prisma.issue.findUnique.mockResolvedValue({ ...ISSUE_ROW, assigneeId: 'u-alex' });
      prisma.membership.findMany.mockResolvedValue([
        { user: { id: 'u-alex', email: 'alex@nextlane.dev', name: 'Alex Rivera' } },
      ]);
      const { engine, issues } = makeEngine(prisma);

      await engine.onIssueCreated(makeEvent());

      // Condition matched -> the rule's default SET_PRIORITY action ran.
      expect(issues.update).toHaveBeenCalledWith(
        RULE_CREATOR_ID,
        ISSUE_ID,
        { priority: Priority.HIGH },
        { automated: true },
      );
      const row = firstRunRow(prisma);
      expect(row.matched).toBe(true);
      expect(row.status).toBe(AutomationRunStatus.SUCCESS);
    });

    it('resolves sprint by name in a rule condition', async () => {
      const rule = makeRule({ condition: 'sprint = "July-B"' });
      const prisma = makePrisma([rule]);
      prisma.issue.findUnique.mockResolvedValue({ ...ISSUE_ROW, sprintId: 'sp-july-b' });
      prisma.sprint.findMany.mockResolvedValue([{ id: 'sp-july-b', name: 'July-B' }]);
      const { engine, issues } = makeEngine(prisma);

      await engine.onIssueCreated(makeEvent());

      expect(issues.update).toHaveBeenCalledWith(
        RULE_CREATOR_ID,
        ISSUE_ID,
        { priority: Priority.HIGH },
        { automated: true },
      );
    });

    // ── Unresolved name → FAILED run (MCP-QA pass 1, finding 1 RESIDUAL) ────
    //
    // Was: an unresolved name silently evaluated the condition to `false`
    // (SKIPPED — indistinguishable from a real non-match). Now: the engine
    // mirrors its existing invalid-condition handling exactly (a FAILED run
    // with a clear error, logged, no actions run) rather than crashing the
    // event pipeline or silently skipping — a rule author debugging "why
    // didn't this fire" needs to see "no such user", not "condition false".

    it('a name that resolves to no known user is FAILED with an actionable error, not silently SKIPPED', async () => {
      const rule = makeRule({ condition: 'assignee = "Nobody By This Name"' });
      const prisma = makePrisma([rule]);
      prisma.issue.findUnique.mockResolvedValue({ ...ISSUE_ROW, assigneeId: 'u-alex' });
      prisma.membership.findMany.mockResolvedValue([
        { user: { id: 'u-alex', email: 'alex@nextlane.dev', name: 'Alex Rivera' } },
      ]);
      const { engine, issues } = makeEngine(prisma);

      await engine.onIssueCreated(makeEvent());

      expect(issues.update).not.toHaveBeenCalled();
      const row = firstRunRow(prisma);
      expect(row.matched).toBe(false);
      expect(row.status).toBe(AutomationRunStatus.FAILED);
      expect(String(row.error)).toContain(
        'unknown user "Nobody By This Name" — use an exact display name, an id, or me(); see list_users',
      );
    });

    it('an unresolved sprint name is FAILED with an actionable error', async () => {
      const rule = makeRule({ condition: 'sprint = "Nonexistent Sprint"' });
      const prisma = makePrisma([rule]);
      prisma.issue.findUnique.mockResolvedValue({ ...ISSUE_ROW, sprintId: 'sp-july-b' });
      prisma.sprint.findMany.mockResolvedValue([{ id: 'sp-july-b', name: 'July-B' }]);
      const { engine } = makeEngine(prisma);

      await engine.onIssueCreated(makeEvent());

      const row = firstRunRow(prisma);
      expect(row.status).toBe(AutomationRunStatus.FAILED);
      expect(String(row.error)).toContain(
        'unknown sprint "Nonexistent Sprint" — use an exact sprint name or an id; see list_sprints',
      );
    });

    it('one rule with an unresolved name FAILs without blocking a sibling rule on the same event', async () => {
      const rules = [
        makeRule({ id: 'rule-bad', order: 0, condition: 'assignee = "Nobody By This Name"' }),
        makeRule({ id: 'rule-good', order: 1, condition: null }),
      ];
      const prisma = makePrisma(rules);
      const { engine, issues } = makeEngine(prisma);

      await engine.onIssueCreated(makeEvent());

      // The good (unconditional) rule's default action still ran.
      expect(issues.update).toHaveBeenCalledWith(
        RULE_CREATOR_ID,
        ISSUE_ID,
        { priority: Priority.HIGH },
        { automated: true },
      );
      const rows = allRunRows(prisma);
      const bad = rows.find((r) => r.ruleId === 'rule-bad');
      const good = rows.find((r) => r.ruleId === 'rule-good');
      expect(bad).toBeDefined();
      expect(good).toBeDefined();
      expect(bad?.status).toBe(AutomationRunStatus.FAILED);
      expect(good?.status).toBe(AutomationRunStatus.SUCCESS);
    });

    it('does not fail on assignee = me()', async () => {
      const rule = makeRule({ condition: 'assignee = me()' });
      const prisma = makePrisma([rule]);
      prisma.issue.findUnique.mockResolvedValue({ ...ISSUE_ROW, assigneeId: ACTOR_USER_ID });
      const { engine } = makeEngine(prisma);

      await engine.onIssueCreated(makeEvent());

      const row = firstRunRow(prisma);
      expect(row.status).not.toBe(AutomationRunStatus.FAILED);
    });

    it('does not fail on an opaque-id-shaped assignee operand even when unresolved', async () => {
      const staleId = 'usr-cljk3n9d80000ab12removedmember';
      const rule = makeRule({ condition: `assignee = "${staleId}"` });
      const prisma = makePrisma([rule]);
      prisma.issue.findUnique.mockResolvedValue({ ...ISSUE_ROW, assigneeId: 'u-alex' });
      prisma.membership.findMany.mockResolvedValue([
        { user: { id: 'u-alex', email: 'alex@nextlane.dev', name: 'Alex Rivera' } },
      ]);
      const { engine, issues } = makeEngine(prisma);

      await engine.onIssueCreated(makeEvent());

      // Falls back to the pure evaluator's literal-id comparison (no match,
      // since the issue's assigneeId is 'u-alex'), not a FAILED run.
      expect(issues.update).not.toHaveBeenCalled();
      const row = firstRunRow(prisma);
      expect(row.status).toBe(AutomationRunStatus.SKIPPED);
    });

    it('does not query workspace members or sprints when no triggered rule condition references those fields', async () => {
      const rule = makeRule({ condition: 'priority = High' });
      const prisma = makePrisma([rule]);
      const { engine } = makeEngine(prisma);

      await engine.onIssueCreated(makeEvent());

      expect(prisma.membership.findMany).not.toHaveBeenCalled();
      expect(prisma.sprint.findMany).not.toHaveBeenCalled();
    });

    it('queries workspace members once even with multiple user-referencing rules on the same event', async () => {
      const rules = [
        makeRule({ id: 'rule-1', order: 0, condition: 'assignee = "Alex Rivera"' }),
        makeRule({ id: 'rule-2', order: 1, condition: 'reporter = "Alex Rivera"' }),
      ];
      const prisma = makePrisma(rules);
      prisma.issue.findUnique.mockResolvedValue({
        ...ISSUE_ROW,
        assigneeId: 'u-alex',
        reporterId: 'u-alex',
      });
      prisma.membership.findMany.mockResolvedValue([
        { user: { id: 'u-alex', email: 'alex@nextlane.dev', name: 'Alex Rivera' } },
      ]);
      const { engine } = makeEngine(prisma);

      await engine.onIssueCreated(makeEvent());

      expect(prisma.membership.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('issue not found after event', () => {
    it('handles gracefully without writing runs', async () => {
      const prisma = makePrisma([makeRule()]);
      prisma.issue.findUnique.mockResolvedValue(null); // deleted after event
      const { engine } = makeEngine(prisma);

      // Should not throw
      await expect(engine.onIssueCreated(makeEvent())).resolves.toBeUndefined();
      expect(prisma.automationRun.createMany).not.toHaveBeenCalled();
    });
  });
});
