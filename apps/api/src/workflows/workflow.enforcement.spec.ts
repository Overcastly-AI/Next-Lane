import { UnprocessableEntityException } from '@nestjs/common';
import { WorkflowService } from './workflow.service';
import type { PrismaService } from '../prisma/prisma.service';
import { StatusCategory } from '@next-lane/shared';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const PROJECT_ID = 'proj-1';
const ISSUE_ID = 'issue-1';
const STATUS_TODO = 'status-todo';
const STATUS_IN_PROGRESS = 'status-inprogress';
const STATUS_DONE = 'status-done';
const TRANSITION_ID = 'trans-1';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIssue(overrides: Partial<{
  id: string;
  projectId: string;
  type: string;
  statusId: string;
  assigneeId: string | null;
  description: string | null;
  customFields: Record<string, unknown> | null;
  linksFrom: Array<{ type: string; target: { status: { category: string } | null } | null }>;
  linksTo: Array<{ type: string; source: { status: { category: string } | null } | null }>;
}> = {}) {
  return {
    id: ISSUE_ID,
    projectId: PROJECT_ID,
    type: 'TASK',
    statusId: STATUS_TODO,
    assigneeId: null,
    description: null,
    customFields: null,
    linksFrom: [],
    linksTo: [],
    ...overrides,
  };
}

function makeTransition(overrides: Partial<{
  id: string;
  projectId: string;
  fromStatusId: string | null;
  toStatusId: string;
  issueType: string | null;
  name: string | null;
  gates: unknown[];
  createdAt: Date;
  updatedAt: Date;
}> = {}) {
  return {
    id: TRANSITION_ID,
    projectId: PROJECT_ID,
    fromStatusId: STATUS_TODO,
    toStatusId: STATUS_IN_PROGRESS,
    issueType: null,
    name: null,
    gates: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePrisma() {
  return {
    issue: { findUnique: jest.fn() },
    project: { findUnique: jest.fn() },
    status: { findMany: jest.fn() },
    workflowTransition: { findMany: jest.fn() },
    // WF-2: REQUIRE_FIELD gates that don't match customFields directly fall
    // back to resolving the gate's `field` against a CustomFieldDefinition
    // (by key/name). Default: no matching definition (falls straight to
    // rejection) unless a test overrides it.
    customFieldDefinition: { findFirst: jest.fn().mockResolvedValue(null) },
  } as unknown as PrismaService;
}

type MockPrisma = ReturnType<typeof makePrisma>;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkflowService.enforceTransition', () => {
  let prisma: MockPrisma;
  let service: WorkflowService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new WorkflowService(prisma);
  });

  afterEach(() => jest.restoreAllMocks());

  // ── Bypass cases ───────────────────────────────────────────────────────────

  it('bypasses enforcement when opts.automated is true', async () => {
    await expect(
      service.enforceTransition(ISSUE_ID, STATUS_IN_PROGRESS, { automated: true }),
    ).resolves.toBeUndefined();

    // Should not have queried the DB at all
    expect(prisma.issue.findUnique).not.toHaveBeenCalled();
  });

  it('allows when project.workflowEnforced is false (default)', async () => {
    (prisma.issue.findUnique as jest.Mock).mockResolvedValue(
      makeIssue({ statusId: STATUS_TODO }),
    );
    (prisma.project.findUnique as jest.Mock).mockResolvedValue({
      workflowEnforced: false,
    });

    await expect(
      service.enforceTransition(ISSUE_ID, STATUS_IN_PROGRESS),
    ).resolves.toBeUndefined();

    expect(prisma.workflowTransition.findMany).not.toHaveBeenCalled();
  });

  it('allows when targetStatusId equals current statusId (same-status noop)', async () => {
    (prisma.issue.findUnique as jest.Mock).mockResolvedValue(
      makeIssue({ statusId: STATUS_TODO }),
    );
    (prisma.project.findUnique as jest.Mock).mockResolvedValue({
      workflowEnforced: true,
    });

    await expect(
      service.enforceTransition(ISSUE_ID, STATUS_TODO), // same status
    ).resolves.toBeUndefined();

    expect(prisma.workflowTransition.findMany).not.toHaveBeenCalled();
  });

  it('returns without error when issue is not found', async () => {
    (prisma.issue.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(
      service.enforceTransition(ISSUE_ID, STATUS_IN_PROGRESS),
    ).resolves.toBeUndefined();
  });

  // ── Transition matching ────────────────────────────────────────────────────

  it('allows when exact (fromStatusId, toStatusId) transition exists with no gates', async () => {
    (prisma.issue.findUnique as jest.Mock).mockResolvedValue(
      makeIssue({ statusId: STATUS_TODO }),
    );
    (prisma.project.findUnique as jest.Mock).mockResolvedValue({ workflowEnforced: true });
    (prisma.workflowTransition.findMany as jest.Mock).mockResolvedValue([
      makeTransition({ fromStatusId: STATUS_TODO, toStatusId: STATUS_IN_PROGRESS, gates: [] }),
    ]);

    await expect(
      service.enforceTransition(ISSUE_ID, STATUS_IN_PROGRESS),
    ).resolves.toBeUndefined();
  });

  it('allows with wildcard fromStatus (null) matching any current status', async () => {
    (prisma.issue.findUnique as jest.Mock).mockResolvedValue(
      makeIssue({ statusId: STATUS_TODO }),
    );
    (prisma.project.findUnique as jest.Mock).mockResolvedValue({ workflowEnforced: true });
    (prisma.workflowTransition.findMany as jest.Mock).mockResolvedValue([
      makeTransition({ fromStatusId: null, toStatusId: STATUS_IN_PROGRESS, gates: [] }),
    ]);

    await expect(
      service.enforceTransition(ISSUE_ID, STATUS_IN_PROGRESS),
    ).resolves.toBeUndefined();
  });

  it('allows with wildcard issueType (null) matching any issue type', async () => {
    (prisma.issue.findUnique as jest.Mock).mockResolvedValue(
      makeIssue({ statusId: STATUS_TODO, type: 'BUG' }),
    );
    (prisma.project.findUnique as jest.Mock).mockResolvedValue({ workflowEnforced: true });
    (prisma.workflowTransition.findMany as jest.Mock).mockResolvedValue([
      makeTransition({ fromStatusId: STATUS_TODO, toStatusId: STATUS_IN_PROGRESS, issueType: null }),
    ]);

    await expect(
      service.enforceTransition(ISSUE_ID, STATUS_IN_PROGRESS),
    ).resolves.toBeUndefined();
  });

  it('allows with exact issueType match', async () => {
    (prisma.issue.findUnique as jest.Mock).mockResolvedValue(
      makeIssue({ statusId: STATUS_TODO, type: 'BUG' }),
    );
    (prisma.project.findUnique as jest.Mock).mockResolvedValue({ workflowEnforced: true });
    (prisma.workflowTransition.findMany as jest.Mock).mockResolvedValue([
      makeTransition({ fromStatusId: STATUS_TODO, toStatusId: STATUS_IN_PROGRESS, issueType: 'BUG' }),
    ]);

    await expect(
      service.enforceTransition(ISSUE_ID, STATUS_IN_PROGRESS),
    ).resolves.toBeUndefined();
  });

  it('rejects (422) when no matching transition exists', async () => {
    (prisma.issue.findUnique as jest.Mock).mockResolvedValue(
      makeIssue({ statusId: STATUS_TODO }),
    );
    (prisma.project.findUnique as jest.Mock).mockResolvedValue({ workflowEnforced: true });
    (prisma.workflowTransition.findMany as jest.Mock).mockResolvedValue([]); // no transitions to target

    // For the error message helper
    (prisma.workflowTransition.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.status.findMany as jest.Mock).mockResolvedValue([]);

    await expect(
      service.enforceTransition(ISSUE_ID, STATUS_IN_PROGRESS),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects (422) when issueType does not match the transition', async () => {
    (prisma.issue.findUnique as jest.Mock).mockResolvedValue(
      makeIssue({ statusId: STATUS_TODO, type: 'TASK' }),
    );
    (prisma.project.findUnique as jest.Mock).mockResolvedValue({ workflowEnforced: true });
    // Transition only allows BUG type
    (prisma.workflowTransition.findMany as jest.Mock).mockResolvedValue([
      makeTransition({ fromStatusId: STATUS_TODO, toStatusId: STATUS_IN_PROGRESS, issueType: 'BUG' }),
    ]);
    (prisma.status.findMany as jest.Mock).mockResolvedValue([]);

    await expect(
      service.enforceTransition(ISSUE_ID, STATUS_IN_PROGRESS),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  // ── Gate: REQUIRE_ASSIGNEE ─────────────────────────────────────────────────

  describe('gate REQUIRE_ASSIGNEE', () => {
    const gatedTransition = makeTransition({
      gates: [{ type: 'REQUIRE_ASSIGNEE' }],
    });

    it('allows when assignee is set', async () => {
      (prisma.issue.findUnique as jest.Mock).mockResolvedValue(
        makeIssue({ statusId: STATUS_TODO, assigneeId: 'user-99' }),
      );
      (prisma.project.findUnique as jest.Mock).mockResolvedValue({ workflowEnforced: true });
      (prisma.workflowTransition.findMany as jest.Mock).mockResolvedValue([gatedTransition]);

      await expect(
        service.enforceTransition(ISSUE_ID, STATUS_IN_PROGRESS),
      ).resolves.toBeUndefined();
    });

    it('rejects (422) when assignee is null', async () => {
      (prisma.issue.findUnique as jest.Mock).mockResolvedValue(
        makeIssue({ statusId: STATUS_TODO, assigneeId: null }),
      );
      (prisma.project.findUnique as jest.Mock).mockResolvedValue({ workflowEnforced: true });
      (prisma.workflowTransition.findMany as jest.Mock).mockResolvedValue([gatedTransition]);

      await expect(
        service.enforceTransition(ISSUE_ID, STATUS_IN_PROGRESS),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
  });

  // ── Gate: REQUIRE_DESCRIPTION ──────────────────────────────────────────────

  describe('gate REQUIRE_DESCRIPTION', () => {
    const gatedTransition = makeTransition({
      gates: [{ type: 'REQUIRE_DESCRIPTION' }],
    });

    it('allows when description is non-empty', async () => {
      (prisma.issue.findUnique as jest.Mock).mockResolvedValue(
        makeIssue({ statusId: STATUS_TODO, description: 'Some description' }),
      );
      (prisma.project.findUnique as jest.Mock).mockResolvedValue({ workflowEnforced: true });
      (prisma.workflowTransition.findMany as jest.Mock).mockResolvedValue([gatedTransition]);

      await expect(
        service.enforceTransition(ISSUE_ID, STATUS_IN_PROGRESS),
      ).resolves.toBeUndefined();
    });

    it('rejects (422) when description is null', async () => {
      (prisma.issue.findUnique as jest.Mock).mockResolvedValue(
        makeIssue({ statusId: STATUS_TODO, description: null }),
      );
      (prisma.project.findUnique as jest.Mock).mockResolvedValue({ workflowEnforced: true });
      (prisma.workflowTransition.findMany as jest.Mock).mockResolvedValue([gatedTransition]);

      await expect(
        service.enforceTransition(ISSUE_ID, STATUS_IN_PROGRESS),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('rejects (422) when description is whitespace only', async () => {
      (prisma.issue.findUnique as jest.Mock).mockResolvedValue(
        makeIssue({ statusId: STATUS_TODO, description: '   \n  ' }),
      );
      (prisma.project.findUnique as jest.Mock).mockResolvedValue({ workflowEnforced: true });
      (prisma.workflowTransition.findMany as jest.Mock).mockResolvedValue([gatedTransition]);

      await expect(
        service.enforceTransition(ISSUE_ID, STATUS_IN_PROGRESS),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
  });

  // ── Gate: REQUIRE_FIELD ────────────────────────────────────────────────────

  describe('gate REQUIRE_FIELD', () => {
    it('allows when core field "assignee" is set', async () => {
      const gated = makeTransition({ gates: [{ type: 'REQUIRE_FIELD', field: 'assignee' }] });
      (prisma.issue.findUnique as jest.Mock).mockResolvedValue(
        makeIssue({ statusId: STATUS_TODO, assigneeId: 'user-1' }),
      );
      (prisma.project.findUnique as jest.Mock).mockResolvedValue({ workflowEnforced: true });
      (prisma.workflowTransition.findMany as jest.Mock).mockResolvedValue([gated]);

      await expect(
        service.enforceTransition(ISSUE_ID, STATUS_IN_PROGRESS),
      ).resolves.toBeUndefined();
    });

    it('rejects (422) when core field "assignee" is not set', async () => {
      const gated = makeTransition({ gates: [{ type: 'REQUIRE_FIELD', field: 'assignee' }] });
      (prisma.issue.findUnique as jest.Mock).mockResolvedValue(
        makeIssue({ statusId: STATUS_TODO, assigneeId: null }),
      );
      (prisma.project.findUnique as jest.Mock).mockResolvedValue({ workflowEnforced: true });
      (prisma.workflowTransition.findMany as jest.Mock).mockResolvedValue([gated]);

      await expect(
        service.enforceTransition(ISSUE_ID, STATUS_IN_PROGRESS),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('allows when custom field is set in customFields JSON', async () => {
      const gated = makeTransition({ gates: [{ type: 'REQUIRE_FIELD', field: 'myCustomKey' }] });
      (prisma.issue.findUnique as jest.Mock).mockResolvedValue(
        makeIssue({
          statusId: STATUS_TODO,
          customFields: { myCustomKey: 'some-value' },
        }),
      );
      (prisma.project.findUnique as jest.Mock).mockResolvedValue({ workflowEnforced: true });
      (prisma.workflowTransition.findMany as jest.Mock).mockResolvedValue([gated]);

      await expect(
        service.enforceTransition(ISSUE_ID, STATUS_IN_PROGRESS),
      ).resolves.toBeUndefined();
    });

    it('rejects (422) when custom field is missing', async () => {
      const gated = makeTransition({ gates: [{ type: 'REQUIRE_FIELD', field: 'myCustomKey' }] });
      (prisma.issue.findUnique as jest.Mock).mockResolvedValue(
        makeIssue({ statusId: STATUS_TODO, customFields: {} }),
      );
      (prisma.project.findUnique as jest.Mock).mockResolvedValue({ workflowEnforced: true });
      (prisma.workflowTransition.findMany as jest.Mock).mockResolvedValue([gated]);

      await expect(
        service.enforceTransition(ISSUE_ID, STATUS_IN_PROGRESS),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    // ── WF-2: gate `field` resolves against CustomFieldDefinition.key/name ──
    // (this is how the gate editor's dropdown and `Issue.customFields`'
    // definitionId-keyed storage actually connect — see workflow.service.ts
    // evaluateGate's REQUIRE_FIELD case.)

    it('WF-2: allows when field is configured by the custom field KEY and the value is stored under the definition id', async () => {
      const gated = makeTransition({ gates: [{ type: 'REQUIRE_FIELD', field: 'severity' }] });
      (prisma.issue.findUnique as jest.Mock).mockResolvedValue(
        makeIssue({
          statusId: STATUS_TODO,
          // Stored keyed by the definition's opaque id — never by "severity".
          customFields: { 'def-severity-cuid': 'Critical' },
        }),
      );
      (prisma.project.findUnique as jest.Mock).mockResolvedValue({ workflowEnforced: true });
      (prisma.workflowTransition.findMany as jest.Mock).mockResolvedValue([gated]);
      (prisma.customFieldDefinition.findFirst as jest.Mock).mockResolvedValue({
        id: 'def-severity-cuid',
      });

      await expect(
        service.enforceTransition(ISSUE_ID, STATUS_IN_PROGRESS),
      ).resolves.toBeUndefined();

      expect(prisma.customFieldDefinition.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            projectId: PROJECT_ID,
            OR: [
              { key: { equals: 'severity', mode: 'insensitive' } },
              { name: { equals: 'severity', mode: 'insensitive' } },
            ],
          }),
        }),
      );
    });

    it('WF-2: allows when field is configured by the custom field NAME (case-insensitive)', async () => {
      const gated = makeTransition({ gates: [{ type: 'REQUIRE_FIELD', field: 'Severity' }] });
      (prisma.issue.findUnique as jest.Mock).mockResolvedValue(
        makeIssue({
          statusId: STATUS_TODO,
          customFields: { 'def-severity-cuid': 'Critical' },
        }),
      );
      (prisma.project.findUnique as jest.Mock).mockResolvedValue({ workflowEnforced: true });
      (prisma.workflowTransition.findMany as jest.Mock).mockResolvedValue([gated]);
      (prisma.customFieldDefinition.findFirst as jest.Mock).mockResolvedValue({
        id: 'def-severity-cuid',
      });

      await expect(
        service.enforceTransition(ISSUE_ID, STATUS_IN_PROGRESS),
      ).resolves.toBeUndefined();
    });

    it('WF-2: rejects (422) when the resolved definition exists but its value is still unset', async () => {
      const gated = makeTransition({ gates: [{ type: 'REQUIRE_FIELD', field: 'severity' }] });
      (prisma.issue.findUnique as jest.Mock).mockResolvedValue(
        makeIssue({ statusId: STATUS_TODO, customFields: {} }),
      );
      (prisma.project.findUnique as jest.Mock).mockResolvedValue({ workflowEnforced: true });
      (prisma.workflowTransition.findMany as jest.Mock).mockResolvedValue([gated]);
      (prisma.customFieldDefinition.findFirst as jest.Mock).mockResolvedValue({
        id: 'def-severity-cuid',
      });

      await expect(
        service.enforceTransition(ISSUE_ID, STATUS_IN_PROGRESS),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('WF-2: rejects (422) when no custom field definition matches the configured key/name at all', async () => {
      const gated = makeTransition({ gates: [{ type: 'REQUIRE_FIELD', field: 'nonexistent' }] });
      (prisma.issue.findUnique as jest.Mock).mockResolvedValue(
        makeIssue({ statusId: STATUS_TODO, customFields: {} }),
      );
      (prisma.project.findUnique as jest.Mock).mockResolvedValue({ workflowEnforced: true });
      (prisma.workflowTransition.findMany as jest.Mock).mockResolvedValue([gated]);
      (prisma.customFieldDefinition.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.enforceTransition(ISSUE_ID, STATUS_IN_PROGRESS),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('WF-2: backward compat — a direct customFields[fieldName] match still wins without a definition lookup', async () => {
      const gated = makeTransition({ gates: [{ type: 'REQUIRE_FIELD', field: 'myCustomKey' }] });
      (prisma.issue.findUnique as jest.Mock).mockResolvedValue(
        makeIssue({
          statusId: STATUS_TODO,
          customFields: { myCustomKey: 'some-value' },
        }),
      );
      (prisma.project.findUnique as jest.Mock).mockResolvedValue({ workflowEnforced: true });
      (prisma.workflowTransition.findMany as jest.Mock).mockResolvedValue([gated]);

      await expect(
        service.enforceTransition(ISSUE_ID, STATUS_IN_PROGRESS),
      ).resolves.toBeUndefined();

      // Direct match short-circuits — no definition lookup needed.
      expect(prisma.customFieldDefinition.findFirst).not.toHaveBeenCalled();
    });
  });

  // ── Gate: REQUIRE_LINK ─────────────────────────────────────────────────────

  describe('gate REQUIRE_LINK', () => {
    it('allows when issue has a link of the required type', async () => {
      const gated = makeTransition({ gates: [{ type: 'REQUIRE_LINK', linkType: 'BLOCKS' }] });
      (prisma.issue.findUnique as jest.Mock).mockResolvedValue(
        makeIssue({
          statusId: STATUS_TODO,
          linksFrom: [{ type: 'BLOCKS', target: { status: null } }],
        }),
      );
      (prisma.project.findUnique as jest.Mock).mockResolvedValue({ workflowEnforced: true });
      (prisma.workflowTransition.findMany as jest.Mock).mockResolvedValue([gated]);

      await expect(
        service.enforceTransition(ISSUE_ID, STATUS_IN_PROGRESS),
      ).resolves.toBeUndefined();
    });

    it('rejects (422) when issue has no link of the required type', async () => {
      const gated = makeTransition({ gates: [{ type: 'REQUIRE_LINK', linkType: 'BLOCKS' }] });
      (prisma.issue.findUnique as jest.Mock).mockResolvedValue(
        makeIssue({ statusId: STATUS_TODO, linksFrom: [], linksTo: [] }),
      );
      (prisma.project.findUnique as jest.Mock).mockResolvedValue({ workflowEnforced: true });
      (prisma.workflowTransition.findMany as jest.Mock).mockResolvedValue([gated]);

      await expect(
        service.enforceTransition(ISSUE_ID, STATUS_IN_PROGRESS),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
  });

  // ── Gate: REQUIRE_NO_OPEN_BLOCKERS ─────────────────────────────────────────

  describe('gate REQUIRE_NO_OPEN_BLOCKERS', () => {
    const gated = makeTransition({ gates: [{ type: 'REQUIRE_NO_OPEN_BLOCKERS' }] });

    it('allows when no blocking issues exist', async () => {
      (prisma.issue.findUnique as jest.Mock).mockResolvedValue(
        makeIssue({ statusId: STATUS_TODO, linksTo: [] }),
      );
      (prisma.project.findUnique as jest.Mock).mockResolvedValue({ workflowEnforced: true });
      (prisma.workflowTransition.findMany as jest.Mock).mockResolvedValue([gated]);

      await expect(
        service.enforceTransition(ISSUE_ID, STATUS_IN_PROGRESS),
      ).resolves.toBeUndefined();
    });

    it('allows when all blocking issues are in DONE status', async () => {
      (prisma.issue.findUnique as jest.Mock).mockResolvedValue(
        makeIssue({
          statusId: STATUS_TODO,
          linksTo: [
            {
              type: 'BLOCKS',
              source: { status: { category: StatusCategory.DONE } },
            },
          ],
        }),
      );
      (prisma.project.findUnique as jest.Mock).mockResolvedValue({ workflowEnforced: true });
      (prisma.workflowTransition.findMany as jest.Mock).mockResolvedValue([gated]);

      await expect(
        service.enforceTransition(ISSUE_ID, STATUS_IN_PROGRESS),
      ).resolves.toBeUndefined();
    });

    it('rejects (422) when a BLOCKS link source is in TODO status (open blocker)', async () => {
      (prisma.issue.findUnique as jest.Mock).mockResolvedValue(
        makeIssue({
          statusId: STATUS_TODO,
          linksTo: [
            {
              type: 'BLOCKS',
              source: { status: { category: StatusCategory.TODO } },
            },
          ],
        }),
      );
      (prisma.project.findUnique as jest.Mock).mockResolvedValue({ workflowEnforced: true });
      (prisma.workflowTransition.findMany as jest.Mock).mockResolvedValue([gated]);

      await expect(
        service.enforceTransition(ISSUE_ID, STATUS_IN_PROGRESS),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('rejects (422) when a BLOCKS link source is IN_PROGRESS (open blocker)', async () => {
      (prisma.issue.findUnique as jest.Mock).mockResolvedValue(
        makeIssue({
          statusId: STATUS_TODO,
          linksTo: [
            {
              type: 'BLOCKS',
              source: { status: { category: StatusCategory.IN_PROGRESS } },
            },
          ],
        }),
      );
      (prisma.project.findUnique as jest.Mock).mockResolvedValue({ workflowEnforced: true });
      (prisma.workflowTransition.findMany as jest.Mock).mockResolvedValue([gated]);

      await expect(
        service.enforceTransition(ISSUE_ID, STATUS_IN_PROGRESS),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
  });

  // ── Automation bypass ──────────────────────────────────────────────────────

  it('skips all checks (including gates) for automation-originated moves', async () => {
    // Even with a REQUIRE_ASSIGNEE gate and no assignee, automation bypasses
    (prisma.issue.findUnique as jest.Mock).mockResolvedValue(
      makeIssue({ statusId: STATUS_TODO, assigneeId: null }),
    );

    await expect(
      service.enforceTransition(ISSUE_ID, STATUS_IN_PROGRESS, { automated: true }),
    ).resolves.toBeUndefined();

    // Automation bypass returns before any DB query
    expect(prisma.issue.findUnique).not.toHaveBeenCalled();
  });
});
