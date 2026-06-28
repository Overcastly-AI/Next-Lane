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
      create: jest.fn().mockResolvedValue({}),
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

  describe('loop guard', () => {
    it('returns immediately when event.automated is true (no rule evaluation)', async () => {
      const prisma = makePrisma([makeRule()]);
      const { engine } = makeEngine(prisma);

      await engine.onIssueCreated(makeEvent({ automated: true }));

      // Should not even query rules
      expect(prisma.automationRule.findMany).not.toHaveBeenCalled();
      expect(prisma.automationRun.create).not.toHaveBeenCalled();
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
      expect(prisma.automationRun.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ruleId: rule.id,
            matched: true,
            status: AutomationRunStatus.SUCCESS,
          }),
        }),
      );
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

      expect(prisma.automationRun.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            matched: false,
            status: AutomationRunStatus.SKIPPED,
            actionsApplied: [],
          }),
        }),
      );
    });
  });

  describe('condition parse error', () => {
    it('writes FAILED run and does not call any action services', async () => {
      const rule = makeRule({ condition: '!!! TOTALLY INVALID QUERY !!!' });
      const prisma = makePrisma([rule]);
      const { engine, issues } = makeEngine(prisma);

      await engine.onIssueCreated(makeEvent());

      expect(issues.update).not.toHaveBeenCalled();

      const createCall = prisma.automationRun.create.mock.calls[0][0];
      expect(createCall.data.status).toBe(AutomationRunStatus.FAILED);
      expect(createCall.data.matched).toBe(false);
      expect(createCall.data.error).toContain('Condition evaluation error');
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

      const createCall = prisma.automationRun.create.mock.calls[0][0];
      expect(createCall.data.status).toBe(AutomationRunStatus.FAILED);
      expect(createCall.data.error).toContain('TRANSITION failed');
      // partial actionsApplied: only the first action succeeded
      expect(createCall.data.actionsApplied).toHaveLength(1);
      expect(createCall.data.actionsApplied[0].type).toBe(AutomationActionType.SET_PRIORITY);
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
      const callOrder: string[] = [];
      const rule1 = makeRule({ id: 'rule-a', order: 1, condition: null });
      const rule2 = makeRule({ id: 'rule-b', order: 0, condition: null });
      // Note: Prisma is expected to return them pre-sorted; we verify the engine
      // iterates in the returned array order (engine trusts DB ordering).
      const prisma = makePrisma([rule2, rule1]); // sorted: order 0 first
      const { engine, issues } = makeEngine(prisma);

      // Use a mock that records which rule's actor is used (they share RULE_CREATOR_ID,
      // but we can verify via run writes).
      const createMock = prisma.automationRun.create.mockResolvedValue({});
      issues.update.mockResolvedValue({});

      await engine.onIssueCreated(makeEvent());

      // Two rules → two runs
      expect(createMock).toHaveBeenCalledTimes(2);
      // First run should be for rule-b (order 0)
      expect(createMock.mock.calls[0][0].data.ruleId).toBe('rule-b');
      // Second run should be for rule-a (order 1)
      expect(createMock.mock.calls[1][0].data.ruleId).toBe('rule-a');
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
      expect(prisma.automationRun.create).not.toHaveBeenCalled();
      expect(issues.update).not.toHaveBeenCalled();
    });
  });

  describe('issue not found after event', () => {
    it('handles gracefully without writing runs', async () => {
      const prisma = makePrisma([makeRule()]);
      prisma.issue.findUnique.mockResolvedValue(null); // deleted after event
      const { engine } = makeEngine(prisma);

      // Should not throw
      await expect(engine.onIssueCreated(makeEvent())).resolves.toBeUndefined();
      expect(prisma.automationRun.create).not.toHaveBeenCalled();
    });
  });
});
