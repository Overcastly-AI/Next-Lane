/**
 * Unit tests for the board-context enforcement path in IssuesService.move.
 *
 * Exercises the three resolution branches of `enforceMove`:
 *  1. boardId present + board has enforced workflow → delegates to enforceTransitionForWorkflow
 *  2. boardId present + board has no workflow / workflow not enforced → falls through to project-level
 *  3. No boardId → falls through to project-level enforceTransition
 *  4. opts.automated === true → always bypasses ALL enforcement regardless of board
 *
 * The service itself is built from real source but ALL Prisma operations and
 * both WorkflowService methods are mocked. The IssuesService.move path is
 * exercised only up to the enforcement checkpoint — the full DB write is also
 * mocked so tests focus purely on the enforcement routing.
 */
import { UnprocessableEntityException } from '@nestjs/common';
import { IssuesService } from './issues.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RealtimeService } from '../realtime/realtime.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { WebhooksService } from '../webhooks/webhooks.service';
import type { CustomFieldsService } from '../custom-fields/custom-fields.service';
import type { WorkflowService } from '../workflows/workflow.service';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { Role } from '@next-lane/shared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJECT = 'proj-1';
const WORKSPACE = 'ws-1';
const USER = 'user-1';
const STATUS_A = 'status-a';
const STATUS_B = 'status-b';
const BOARD_ID = 'board-1';
const WORKFLOW_ID = 'wf-1';
const ISSUE_ID = 'issue-1';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const noOpCustomFields = {
  validateAndNormalize: jest.fn().mockResolvedValue({}),
} as unknown as CustomFieldsService;

const noOpEventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;
const webhooksMock = { dispatch: jest.fn() } as unknown as WebhooksService;

function makeIssueRow(statusId: string = STATUS_A) {
  return {
    id: ISSUE_ID,
    number: 1,
    projectId: PROJECT,
    type: 'TASK',
    title: 'Test Issue',
    description: null,
    statusId,
    assigneeId: null,
    reporterId: null,
    priority: 'MEDIUM',
    storyPoints: null,
    parentId: null,
    sprintId: null,
    dueDate: null,
    rank: 'a0',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    status: { id: statusId, name: 'To Do', category: 'TODO', order: 0, projectId: PROJECT },
    assignee: null,
    reporter: null,
    labels: [],
    project: { key: 'NL' },
    _count: { comments: 0 },
    component: null,
    checklistItems: [],
    versions: [],
  };
}

function makeMovePrisma() {
  const tx = {
    issue: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    },
    activityLog: { create: jest.fn() },
    $executeRaw: jest.fn().mockResolvedValue(0),
  };

  const prisma = {
    issue: { findUnique: jest.fn(), findMany: jest.fn() },
    project: { findUnique: jest.fn() },
    membership: { findUnique: jest.fn() },
    status: { findUnique: jest.fn() },
    board: { findUnique: jest.fn() },
    activityLog: { create: jest.fn() },
    $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
    _tx: tx,
  };
  return { prisma, tx };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IssuesService.move — board-context enforcement routing', () => {
  let mocks: ReturnType<typeof makeMovePrisma>;
  let realtime: { emitToProject: jest.Mock };
  let workflowSvc: {
    enforceTransition: jest.Mock;
    enforceTransitionForWorkflow: jest.Mock;
    isEnforcementEnabled: jest.Mock;
  };
  let service: IssuesService;

  beforeEach(() => {
    mocks = makeMovePrisma();
    realtime = { emitToProject: jest.fn() };

    workflowSvc = {
      enforceTransition: jest.fn().mockResolvedValue(undefined),
      enforceTransitionForWorkflow: jest.fn().mockResolvedValue(undefined),
      isEnforcementEnabled: jest.fn().mockResolvedValue(false),
    };

    service = new IssuesService(
      mocks.prisma as unknown as PrismaService,
      realtime as unknown as RealtimeService,
      {} as NotificationsService,
      webhooksMock,
      noOpCustomFields,
      noOpEventEmitter,
      workflowSvc as unknown as WorkflowService,
    );

    // Baseline: issue exists in STATUS_A
    mocks.prisma.issue.findUnique.mockResolvedValue({
      id: ISSUE_ID,
      projectId: PROJECT,
      statusId: STATUS_A,
      rank: 'a0',
    });

    // Project + membership: ADMIN
    mocks.prisma.project.findUnique.mockResolvedValue({
      id: PROJECT,
      workspaceId: WORKSPACE,
    });
    mocks.prisma.membership.findUnique.mockResolvedValue({ role: Role.ADMIN });

    // Status belongs to the project
    mocks.prisma.status.findUnique.mockResolvedValue({ projectId: PROJECT });

    // TX: issue update returns moved row
    mocks.tx.issue.update.mockImplementation(() =>
      Promise.resolve(makeIssueRow(STATUS_B)),
    );
  });

  afterEach(() => jest.clearAllMocks());

  // ── Branch 1: board with enforced workflow ────────────────────────────────

  describe('board with enforced named workflow', () => {
    beforeEach(() => {
      mocks.prisma.board.findUnique.mockResolvedValue({
        workflowId: WORKFLOW_ID,
        workflow: { enforced: true },
      });
    });

    it('calls enforceTransitionForWorkflow instead of enforceTransition', async () => {
      await service.move(USER, ISSUE_ID, {
        statusId: STATUS_B,
        boardId: BOARD_ID,
      });

      expect(workflowSvc.enforceTransitionForWorkflow).toHaveBeenCalledWith(
        WORKFLOW_ID,
        ISSUE_ID,
        STATUS_B,
      );
      expect(workflowSvc.enforceTransition).not.toHaveBeenCalled();
    });

    it('propagates 422 from enforceTransitionForWorkflow (illegal move blocked)', async () => {
      workflowSvc.enforceTransitionForWorkflow.mockRejectedValue(
        new UnprocessableEntityException('Transition not allowed'),
      );

      await expect(
        service.move(USER, ISSUE_ID, { statusId: STATUS_B, boardId: BOARD_ID }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('automation bypass skips enforceTransitionForWorkflow', async () => {
      await service.move(
        USER,
        ISSUE_ID,
        { statusId: STATUS_B, boardId: BOARD_ID },
        { automated: true },
      );

      expect(workflowSvc.enforceTransitionForWorkflow).not.toHaveBeenCalled();
      expect(workflowSvc.enforceTransition).not.toHaveBeenCalled();
    });
  });

  // ── Branch 2: board with a workflow that is NOT enforced ─────────────────

  describe('board with non-enforced workflow', () => {
    beforeEach(() => {
      mocks.prisma.board.findUnique.mockResolvedValue({
        workflowId: WORKFLOW_ID,
        workflow: { enforced: false }, // workflow exists but not enforced
      });
    });

    it('falls through to project-level enforceTransition', async () => {
      await service.move(USER, ISSUE_ID, {
        statusId: STATUS_B,
        boardId: BOARD_ID,
      });

      expect(workflowSvc.enforceTransitionForWorkflow).not.toHaveBeenCalled();
      expect(workflowSvc.enforceTransition).toHaveBeenCalledWith(
        ISSUE_ID,
        STATUS_B,
        expect.anything(),
      );
    });
  });

  // ── Branch 2b: board with no workflow ─────────────────────────────────────

  describe('board with no workflow (workflowId null)', () => {
    beforeEach(() => {
      mocks.prisma.board.findUnique.mockResolvedValue({
        workflowId: null,
        workflow: null,
      });
    });

    it('falls through to project-level enforceTransition', async () => {
      await service.move(USER, ISSUE_ID, {
        statusId: STATUS_B,
        boardId: BOARD_ID,
      });

      expect(workflowSvc.enforceTransitionForWorkflow).not.toHaveBeenCalled();
      expect(workflowSvc.enforceTransition).toHaveBeenCalled();
    });
  });

  // ── Branch 3: no board context ────────────────────────────────────────────

  describe('no boardId in move DTO (triage / API / drawer)', () => {
    it('calls project-level enforceTransition without touching board lookup', async () => {
      await service.move(USER, ISSUE_ID, { statusId: STATUS_B });

      expect(mocks.prisma.board.findUnique).not.toHaveBeenCalled();
      expect(workflowSvc.enforceTransitionForWorkflow).not.toHaveBeenCalled();
      expect(workflowSvc.enforceTransition).toHaveBeenCalledWith(
        ISSUE_ID,
        STATUS_B,
        expect.anything(),
      );
    });
  });

  // ── Same-status (no enforcement triggered) ────────────────────────────────

  describe('same-status move', () => {
    it('does not call any enforcement when status does not change', async () => {
      // Issue already in STATUS_A; moving "to" STATUS_A = no-op
      await service.move(USER, ISSUE_ID, {
        statusId: STATUS_A, // same as current
        boardId: BOARD_ID,
      });

      expect(workflowSvc.enforceTransitionForWorkflow).not.toHaveBeenCalled();
      expect(workflowSvc.enforceTransition).not.toHaveBeenCalled();
    });
  });

  // ── Automation bypass (global) ─────────────────────────────────────────────

  describe('automation bypass', () => {
    it('skips all enforcement when opts.automated is true (no boardId)', async () => {
      await service.move(
        USER,
        ISSUE_ID,
        { statusId: STATUS_B },
        { automated: true },
      );

      expect(workflowSvc.enforceTransition).not.toHaveBeenCalled();
      expect(workflowSvc.enforceTransitionForWorkflow).not.toHaveBeenCalled();
    });
  });
});
