/**
 * Unit tests for the named-workflow entity CRUD and from-template seeding in
 * WorkflowService. Exercises the new per-board workflow feature:
 *   - listWorkflows, createWorkflow, getWorkflowById, updateWorkflow, deleteWorkflow
 *   - createWorkflowTransition (workflow-scoped)
 *   - createWorkflowFromTemplate (all four template kinds)
 *   - enforceTransitionForWorkflow (board-context enforcement)
 *
 * Prisma is fully mocked. Auth helpers are spied on.
 */
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as membership from '../common/membership.util';
import { WorkflowService } from './workflow.service';
import type { PrismaService } from '../prisma/prisma.service';
import { Role, StatusCategory } from '@next-lane/shared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJECT_ID = 'proj-1';
const USER_ID = 'user-1';
const WF_ID = 'wf-1';
const STATUS_TODO = 'status-todo';
const STATUS_IN_PROGRESS = 'status-inprogress';
const STATUS_DONE = 'status-done';
const TRANS_ID = 'trans-1';

// ---------------------------------------------------------------------------
// Row factories
// ---------------------------------------------------------------------------

function makeWorkflowRow(overrides: Partial<{
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  enforced: boolean;
  createdAt: Date;
  updatedAt: Date;
}> = {}) {
  return {
    id: overrides.id ?? WF_ID,
    projectId: overrides.projectId ?? PROJECT_ID,
    name: overrides.name ?? 'Test Workflow',
    description: overrides.description ?? null,
    enforced: overrides.enforced ?? false,
    createdAt: overrides.createdAt ?? new Date('2026-01-01'),
    updatedAt: overrides.updatedAt ?? new Date('2026-01-01'),
  };
}

function makeTransitionRow(overrides: Partial<{
  id: string;
  projectId: string;
  workflowId: string | null;
  fromStatusId: string | null;
  toStatusId: string;
  issueType: string | null;
  name: string | null;
  gates: unknown[];
}> = {}) {
  return {
    id: overrides.id ?? TRANS_ID,
    projectId: overrides.projectId ?? PROJECT_ID,
    workflowId: overrides.workflowId ?? WF_ID,
    fromStatusId: overrides.fromStatusId ?? STATUS_TODO,
    toStatusId: overrides.toStatusId ?? STATUS_IN_PROGRESS,
    issueType: overrides.issueType ?? null,
    name: overrides.name ?? null,
    gates: overrides.gates ?? [],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };
}

function makePrisma() {
  return {
    project: { findUnique: jest.fn(), update: jest.fn() },
    status: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    workflow: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    workflowTransition: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    issue: { findUnique: jest.fn() },
    membership: { findUnique: jest.fn() },
  } as unknown as PrismaService;
}

type MockPrisma = ReturnType<typeof makePrisma>;

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

describe('WorkflowService — named workflow entity CRUD', () => {
  let prisma: MockPrisma;
  let service: WorkflowService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new WorkflowService(prisma);
    jest
      .spyOn(membership, 'assertProjectMember')
      .mockResolvedValue({ workflowEnforced: false } as never);
    jest
      .spyOn(membership, 'assertProjectRole')
      .mockResolvedValue({ workflowEnforced: false } as never);
  });

  afterEach(() => jest.restoreAllMocks());

  // ── listWorkflows ────────────────────────────────────────────────────────

  describe('listWorkflows', () => {
    it('returns all workflows with transitionCount and boardCount', async () => {
      (prisma.workflow.findMany as jest.Mock).mockResolvedValue([
        {
          ...makeWorkflowRow(),
          _count: { transitions: 3, boards: 1 },
        },
      ]);

      const result = await service.listWorkflows(USER_ID, PROJECT_ID);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(WF_ID);
      expect(result[0].transitionCount).toBe(3);
      expect(result[0].boardCount).toBe(1);
    });

    it('returns empty array when no workflows exist', async () => {
      (prisma.workflow.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.listWorkflows(USER_ID, PROJECT_ID);

      expect(result).toEqual([]);
    });

    it('requires project membership', async () => {
      jest
        .spyOn(membership, 'assertProjectMember')
        .mockRejectedValue(new ForbiddenException('Not a member'));

      await expect(
        service.listWorkflows(USER_ID, PROJECT_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // ── createWorkflow ────────────────────────────────────────────────────────

  describe('createWorkflow', () => {
    it('creates a workflow with name, description, and enforced flag', async () => {
      (prisma.workflow.create as jest.Mock).mockResolvedValue(makeWorkflowRow({
        name: 'Sprint Flow',
        description: 'For sprints',
        enforced: true,
      }));

      const result = await service.createWorkflow(USER_ID, PROJECT_ID, {
        name: 'Sprint Flow',
        description: 'For sprints',
        enforced: true,
      });

      expect(result.name).toBe('Sprint Flow');
      expect(result.description).toBe('For sprints');
      expect(result.enforced).toBe(true);
      expect(result.transitionCount).toBe(0);
      expect(result.boardCount).toBe(0);
    });

    it('defaults enforced to false when not specified', async () => {
      (prisma.workflow.create as jest.Mock).mockResolvedValue(makeWorkflowRow({
        enforced: false,
      }));

      const result = await service.createWorkflow(USER_ID, PROJECT_ID, {
        name: 'My Workflow',
      });

      expect(result.enforced).toBe(false);
    });

    it('throws 409 ConflictException on duplicate name (P2002)', async () => {
      (prisma.workflow.create as jest.Mock).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.createWorkflow(USER_ID, PROJECT_ID, { name: 'Existing' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('requires ADMIN role', async () => {
      jest
        .spyOn(membership, 'assertProjectRole')
        .mockRejectedValue(new ForbiddenException('Requires ADMIN role'));

      await expect(
        service.createWorkflow(USER_ID, PROJECT_ID, { name: 'X' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('surfacing project isolation: ADMIN check uses projectId from param', async () => {
      (prisma.workflow.create as jest.Mock).mockResolvedValue(makeWorkflowRow());

      await service.createWorkflow(USER_ID, PROJECT_ID, { name: 'Wf' });

      expect(membership.assertProjectRole).toHaveBeenCalledWith(
        expect.anything(),
        USER_ID,
        PROJECT_ID,
        Role.ADMIN,
      );
    });
  });

  // ── getWorkflowById ────────────────────────────────────────────────────────

  describe('getWorkflowById', () => {
    it('returns workflow with its transitions', async () => {
      (prisma.workflow.findUnique as jest.Mock).mockResolvedValue(makeWorkflowRow());
      (prisma.workflowTransition.findMany as jest.Mock).mockResolvedValue([
        makeTransitionRow(),
      ]);

      const result = await service.getWorkflowById(USER_ID, WF_ID);

      expect(result.id).toBe(WF_ID);
      expect(result.transitions).toHaveLength(1);
      expect(result.transitions[0].workflowId).toBe(WF_ID);
    });

    it('throws 404 when workflow does not exist', async () => {
      (prisma.workflow.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.getWorkflowById(USER_ID, 'nonexistent'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('verifies membership against the workflow\'s projectId', async () => {
      const wf = makeWorkflowRow({ projectId: 'other-proj' });
      (prisma.workflow.findUnique as jest.Mock).mockResolvedValue(wf);
      (prisma.workflowTransition.findMany as jest.Mock).mockResolvedValue([]);

      await service.getWorkflowById(USER_ID, WF_ID);

      expect(membership.assertProjectMember).toHaveBeenCalledWith(
        expect.anything(),
        USER_ID,
        'other-proj',
      );
    });
  });

  // ── updateWorkflow ────────────────────────────────────────────────────────

  describe('updateWorkflow', () => {
    it('updates name, description, and enforced flag', async () => {
      (prisma.workflow.findUnique as jest.Mock).mockResolvedValue(makeWorkflowRow());
      (prisma.workflow.update as jest.Mock).mockResolvedValue({
        ...makeWorkflowRow({ name: 'New Name', enforced: true }),
        _count: { transitions: 2, boards: 1 },
      });

      const result = await service.updateWorkflow(USER_ID, WF_ID, {
        name: 'New Name',
        enforced: true,
      });

      expect(result.name).toBe('New Name');
      expect(result.enforced).toBe(true);
    });

    it('throws 404 when workflow not found', async () => {
      (prisma.workflow.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updateWorkflow(USER_ID, 'bad-id', { name: 'X' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws 409 on duplicate name (P2002)', async () => {
      (prisma.workflow.findUnique as jest.Mock).mockResolvedValue(makeWorkflowRow());
      (prisma.workflow.update as jest.Mock).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.updateWorkflow(USER_ID, WF_ID, { name: 'Duplicate' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('requires ADMIN role', async () => {
      (prisma.workflow.findUnique as jest.Mock).mockResolvedValue(makeWorkflowRow());
      jest
        .spyOn(membership, 'assertProjectRole')
        .mockRejectedValue(new ForbiddenException('Requires ADMIN'));

      await expect(
        service.updateWorkflow(USER_ID, WF_ID, { name: 'X' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // ── deleteWorkflow ────────────────────────────────────────────────────────

  describe('deleteWorkflow', () => {
    it('deletes a workflow successfully (204 no content)', async () => {
      (prisma.workflow.findUnique as jest.Mock).mockResolvedValue(makeWorkflowRow());
      (prisma.workflow.delete as jest.Mock).mockResolvedValue({});

      await expect(service.deleteWorkflow(USER_ID, WF_ID)).resolves.toBeUndefined();
      expect(prisma.workflow.delete).toHaveBeenCalledWith({ where: { id: WF_ID } });
    });

    it('throws 404 when workflow not found', async () => {
      (prisma.workflow.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.deleteWorkflow(USER_ID, 'nonexistent'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('requires ADMIN role', async () => {
      (prisma.workflow.findUnique as jest.Mock).mockResolvedValue(makeWorkflowRow());
      jest
        .spyOn(membership, 'assertProjectRole')
        .mockRejectedValue(new ForbiddenException('Requires ADMIN'));

      await expect(
        service.deleteWorkflow(USER_ID, WF_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.workflow.delete).not.toHaveBeenCalled();
    });
  });

  // ── createWorkflowTransition ──────────────────────────────────────────────

  describe('createWorkflowTransition', () => {
    it('creates a transition belonging to the workflow', async () => {
      (prisma.workflow.findUnique as jest.Mock).mockResolvedValue(makeWorkflowRow());
      (prisma.status.findUnique as jest.Mock).mockResolvedValue({ projectId: PROJECT_ID });
      (prisma.workflowTransition.create as jest.Mock).mockResolvedValue(
        makeTransitionRow({ workflowId: WF_ID }),
      );

      const result = await service.createWorkflowTransition(USER_ID, WF_ID, {
        fromStatusId: STATUS_TODO,
        toStatusId: STATUS_IN_PROGRESS,
      });

      expect(result.workflowId).toBe(WF_ID);
      expect(prisma.workflowTransition.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            workflowId: WF_ID,
            projectId: PROJECT_ID,
          }),
        }),
      );
    });

    it('throws 404 when workflow not found', async () => {
      (prisma.workflow.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createWorkflowTransition(USER_ID, 'bad-wf', {
          toStatusId: STATUS_IN_PROGRESS,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('validates status ownership against workflow project', async () => {
      (prisma.workflow.findUnique as jest.Mock).mockResolvedValue(makeWorkflowRow());
      (prisma.status.findUnique as jest.Mock).mockResolvedValue({
        projectId: 'other-project',
      });

      await expect(
        service.createWorkflowTransition(USER_ID, WF_ID, {
          toStatusId: 'foreign-status',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws 409 on duplicate (workflowId, fromStatusId, toStatusId, issueType)', async () => {
      (prisma.workflow.findUnique as jest.Mock).mockResolvedValue(makeWorkflowRow());
      (prisma.status.findUnique as jest.Mock).mockResolvedValue({ projectId: PROJECT_ID });
      (prisma.workflowTransition.create as jest.Mock).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.createWorkflowTransition(USER_ID, WF_ID, {
          toStatusId: STATUS_IN_PROGRESS,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});

// ---------------------------------------------------------------------------
// Template seeding tests
// ---------------------------------------------------------------------------

describe('WorkflowService.createWorkflowFromTemplate', () => {
  let prisma: MockPrisma;
  let service: WorkflowService;

  const TODO_STATUS = { id: STATUS_TODO, category: StatusCategory.TODO, name: 'To Do', order: 0 };
  const IP_STATUS = { id: STATUS_IN_PROGRESS, category: StatusCategory.IN_PROGRESS, name: 'In Progress', order: 1 };
  const DONE_STATUS = { id: STATUS_DONE, category: StatusCategory.DONE, name: 'Done', order: 2 };
  const ALL_STATUSES = [TODO_STATUS, IP_STATUS, DONE_STATUS];

  beforeEach(() => {
    prisma = makePrisma();
    service = new WorkflowService(prisma);
    jest.spyOn(membership, 'assertProjectRole').mockResolvedValue({} as never);

    // Default: statuses are present, createMany succeeds
    (prisma.status.findMany as jest.Mock).mockResolvedValue(ALL_STATUSES);
    (prisma.workflow.create as jest.Mock).mockResolvedValue(makeWorkflowRow());
    (prisma.workflowTransition.createMany as jest.Mock).mockResolvedValue({ count: 2 });
    (prisma.workflowTransition.findMany as jest.Mock).mockResolvedValue([]);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('template: simple', () => {
    it('creates TODO→IN_PROGRESS and IN_PROGRESS→DONE transitions only', async () => {
      await service.createWorkflowFromTemplate(USER_ID, PROJECT_ID, {
        template: 'simple',
        name: 'Simple Wf',
      });

      const createManyCall = (prisma.workflowTransition.createMany as jest.Mock).mock.calls[0][0];
      const data: Array<{ fromStatusId: string | null; toStatusId: string; name: string | null }> = createManyCall.data;

      // Simple: only 2 forward transitions, no back-transitions
      expect(data).toHaveLength(2);
      expect(data).toContainEqual(
        expect.objectContaining({ fromStatusId: STATUS_TODO, toStatusId: STATUS_IN_PROGRESS }),
      );
      expect(data).toContainEqual(
        expect.objectContaining({ fromStatusId: STATUS_IN_PROGRESS, toStatusId: STATUS_DONE }),
      );
      // No back-transitions
      expect(data.find((t) => t.toStatusId === STATUS_TODO)).toBeUndefined();
    });

    it('uses the provided name for the workflow', async () => {
      await service.createWorkflowFromTemplate(USER_ID, PROJECT_ID, {
        template: 'simple',
        name: 'My Simple',
      });

      expect(prisma.workflow.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'My Simple' }),
        }),
      );
    });

    it('generates a default name from template when name is omitted', async () => {
      await service.createWorkflowFromTemplate(USER_ID, PROJECT_ID, {
        template: 'simple',
      });

      expect(prisma.workflow.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'Simple Workflow' }),
        }),
      );
    });
  });

  describe('template: kanban', () => {
    it('creates all-to-all transitions among project statuses', async () => {
      await service.createWorkflowFromTemplate(USER_ID, PROJECT_ID, {
        template: 'kanban',
      });

      const createManyCall = (prisma.workflowTransition.createMany as jest.Mock).mock.calls[0][0];
      const data: Array<{ fromStatusId: string; toStatusId: string }> = createManyCall.data;

      // 3 statuses × 2 (A→B, A→C, B→A, B→C, C→A, C→B) = 6 pairs
      expect(data).toHaveLength(6);
      // No self-transitions
      for (const t of data) {
        expect(t.fromStatusId).not.toBe(t.toStatusId);
      }
    });
  });

  describe('template: scrum', () => {
    it('creates forward AND back-transitions (4 total)', async () => {
      await service.createWorkflowFromTemplate(USER_ID, PROJECT_ID, {
        template: 'scrum',
      });

      const createManyCall = (prisma.workflowTransition.createMany as jest.Mock).mock.calls[0][0];
      const data: Array<{ fromStatusId: string; toStatusId: string }> = createManyCall.data;

      expect(data).toHaveLength(4);
      // Forward
      expect(data).toContainEqual(expect.objectContaining({ fromStatusId: STATUS_TODO, toStatusId: STATUS_IN_PROGRESS }));
      expect(data).toContainEqual(expect.objectContaining({ fromStatusId: STATUS_IN_PROGRESS, toStatusId: STATUS_DONE }));
      // Back
      expect(data).toContainEqual(expect.objectContaining({ fromStatusId: STATUS_IN_PROGRESS, toStatusId: STATUS_TODO }));
      expect(data).toContainEqual(expect.objectContaining({ fromStatusId: STATUS_DONE, toStatusId: STATUS_IN_PROGRESS }));
    });
  });

  describe('template: bug-triage', () => {
    it('creates forward transitions plus DONE→TODO reopen path', async () => {
      await service.createWorkflowFromTemplate(USER_ID, PROJECT_ID, {
        template: 'bug-triage',
      });

      const createManyCall = (prisma.workflowTransition.createMany as jest.Mock).mock.calls[0][0];
      const data: Array<{ fromStatusId: string; toStatusId: string }> = createManyCall.data;

      expect(data).toHaveLength(3);
      expect(data).toContainEqual(expect.objectContaining({ fromStatusId: STATUS_TODO, toStatusId: STATUS_IN_PROGRESS }));
      expect(data).toContainEqual(expect.objectContaining({ fromStatusId: STATUS_IN_PROGRESS, toStatusId: STATUS_DONE }));
      // Reopen path
      expect(data).toContainEqual(expect.objectContaining({ fromStatusId: STATUS_DONE, toStatusId: STATUS_TODO }));
    });
  });

  it('throws 409 when workflow name is duplicate', async () => {
    (prisma.workflow.create as jest.Mock).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(
      service.createWorkflowFromTemplate(USER_ID, PROJECT_ID, { template: 'simple' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('requires ADMIN role', async () => {
    jest
      .spyOn(membership, 'assertProjectRole')
      .mockRejectedValue(new ForbiddenException('Requires ADMIN'));

    await expect(
      service.createWorkflowFromTemplate(USER_ID, PROJECT_ID, { template: 'kanban' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('gracefully skips transitions when a category has no status', async () => {
    // No IN_PROGRESS status in the project
    (prisma.status.findMany as jest.Mock).mockResolvedValue([TODO_STATUS, DONE_STATUS]);

    await service.createWorkflowFromTemplate(USER_ID, PROJECT_ID, {
      template: 'simple',
    });

    // simple template needs IN_PROGRESS; without it, createMany should NOT be
    // called at all (the service guards `transData.length > 0`).
    expect(prisma.workflowTransition.createMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Board-context enforcement
// ---------------------------------------------------------------------------

describe('WorkflowService.enforceTransitionForWorkflow', () => {
  let prisma: MockPrisma;
  let service: WorkflowService;

  const ISSUE_ID = 'issue-1';
  const WORKFLOW_ID = 'wf-1';

  function makeIssue(overrides: Partial<{
    statusId: string;
    type: string;
    assigneeId: string | null;
    description: string | null;
    customFields: Record<string, unknown> | null;
    linksFrom: Array<{ type: string; target: { status: { category: string } | null } | null }>;
    linksTo: Array<{ type: string; source: { status: { category: string } | null } | null }>;
  }> = {}) {
    return {
      id: ISSUE_ID,
      projectId: PROJECT_ID,
      type: overrides.type ?? 'TASK',
      statusId: overrides.statusId ?? STATUS_TODO,
      assigneeId: overrides.assigneeId ?? null,
      description: overrides.description ?? null,
      customFields: overrides.customFields ?? null,
      linksFrom: overrides.linksFrom ?? [],
      linksTo: overrides.linksTo ?? [],
    };
  }

  function makeWfTransition(overrides: Partial<{
    fromStatusId: string | null;
    toStatusId: string;
    issueType: string | null;
    gates: unknown[];
  }> = {}) {
    return {
      id: TRANS_ID,
      projectId: PROJECT_ID,
      workflowId: WORKFLOW_ID,
      fromStatusId: overrides.fromStatusId ?? STATUS_TODO,
      toStatusId: overrides.toStatusId ?? STATUS_IN_PROGRESS,
      issueType: overrides.issueType ?? null,
      name: null,
      gates: overrides.gates ?? [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  beforeEach(() => {
    prisma = makePrisma();
    service = new WorkflowService(prisma);
  });

  afterEach(() => jest.restoreAllMocks());

  it('allows a legal transition when a matching transition exists with no gates', async () => {
    (prisma.issue.findUnique as jest.Mock).mockResolvedValue(
      makeIssue({ statusId: STATUS_TODO }),
    );
    (prisma.workflowTransition.findMany as jest.Mock).mockResolvedValue([
      makeWfTransition({ fromStatusId: STATUS_TODO, toStatusId: STATUS_IN_PROGRESS }),
    ]);

    await expect(
      service.enforceTransitionForWorkflow(WORKFLOW_ID, ISSUE_ID, STATUS_IN_PROGRESS),
    ).resolves.toBeUndefined();
  });

  it('allows same-status (no-op) without querying transitions', async () => {
    (prisma.issue.findUnique as jest.Mock).mockResolvedValue(
      makeIssue({ statusId: STATUS_TODO }),
    );

    await expect(
      service.enforceTransitionForWorkflow(WORKFLOW_ID, ISSUE_ID, STATUS_TODO),
    ).resolves.toBeUndefined();

    expect(prisma.workflowTransition.findMany).not.toHaveBeenCalled();
  });

  it('throws 422 when no matching transition exists in the workflow', async () => {
    (prisma.issue.findUnique as jest.Mock).mockResolvedValue(
      makeIssue({ statusId: STATUS_TODO }),
    );
    (prisma.workflowTransition.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.status.findMany as jest.Mock).mockResolvedValue([]);

    await expect(
      service.enforceTransitionForWorkflow(WORKFLOW_ID, ISSUE_ID, STATUS_DONE),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects a move blocked by REQUIRE_ASSIGNEE gate', async () => {
    (prisma.issue.findUnique as jest.Mock).mockResolvedValue(
      makeIssue({ statusId: STATUS_TODO, assigneeId: null }),
    );
    (prisma.workflowTransition.findMany as jest.Mock).mockResolvedValue([
      makeWfTransition({ gates: [{ type: 'REQUIRE_ASSIGNEE' }] }),
    ]);

    await expect(
      service.enforceTransitionForWorkflow(WORKFLOW_ID, ISSUE_ID, STATUS_IN_PROGRESS),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('allows a gated move when the gate condition is satisfied', async () => {
    (prisma.issue.findUnique as jest.Mock).mockResolvedValue(
      makeIssue({ statusId: STATUS_TODO, assigneeId: 'user-99' }),
    );
    (prisma.workflowTransition.findMany as jest.Mock).mockResolvedValue([
      makeWfTransition({ gates: [{ type: 'REQUIRE_ASSIGNEE' }] }),
    ]);

    await expect(
      service.enforceTransitionForWorkflow(WORKFLOW_ID, ISSUE_ID, STATUS_IN_PROGRESS),
    ).resolves.toBeUndefined();
  });

  it('filters transitions by workflowId (tenant isolation)', async () => {
    (prisma.issue.findUnique as jest.Mock).mockResolvedValue(
      makeIssue({ statusId: STATUS_TODO }),
    );
    (prisma.workflowTransition.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.status.findMany as jest.Mock).mockResolvedValue([]);

    await expect(
      service.enforceTransitionForWorkflow(WORKFLOW_ID, ISSUE_ID, STATUS_IN_PROGRESS),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    // Verify the DB query scopes to the specific workflow
    expect(prisma.workflowTransition.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workflowId: WORKFLOW_ID }),
      }),
    );
  });

  it('returns immediately without error when issue is not found', async () => {
    (prisma.issue.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(
      service.enforceTransitionForWorkflow(WORKFLOW_ID, ISSUE_ID, STATUS_IN_PROGRESS),
    ).resolves.toBeUndefined();
  });
});
