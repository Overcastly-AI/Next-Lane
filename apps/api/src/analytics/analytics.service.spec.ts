/**
 * Unit tests for AnalyticsService.
 *
 * Strategy: inject a minimal Prisma mock (same pattern as personal-boards.service.spec.ts).
 * assertProjectMember is spy-mocked. $queryRaw is mocked to return shaped rows.
 */

import * as membershipUtil from '../common/membership.util';
import { AnalyticsService } from './analytics.service';
import type { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const USER_ID = 'user-1';
const PROJECT_ID = 'proj-1';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeStatus(
  overrides: Partial<{ id: string; category: string; projectId: string }> = {},
) {
  return {
    id: overrides.id ?? 'status-todo',
    category: overrides.category ?? 'TODO',
    projectId: overrides.projectId ?? PROJECT_ID,
  };
}

function makeIssue(
  overrides: Partial<{
    id: string;
    projectId: string;
    type: string;
    priority: string;
    assigneeId: string | null;
    createdAt: Date;
    dueDate: Date | null;
    statusCategory: string;
  }> = {},
) {
  const category = overrides.statusCategory ?? 'TODO';
  return {
    id: overrides.id ?? 'issue-1',
    projectId: overrides.projectId ?? PROJECT_ID,
    type: overrides.type ?? 'TASK',
    priority: overrides.priority ?? 'MEDIUM',
    assigneeId: overrides.assigneeId ?? null,
    createdAt: overrides.createdAt ?? new Date('2026-06-01T00:00:00Z'),
    dueDate: overrides.dueDate ?? null,
    status: { category, projectId: overrides.projectId ?? PROJECT_ID },
  };
}

// ---------------------------------------------------------------------------
// Prisma mock
// ---------------------------------------------------------------------------

function makePrisma() {
  return {
    status: {
      findMany: jest.fn(),
    },
    issue: {
      findMany: jest.fn(),
    },
    personalCard: {
      count: jest.fn(),
    },
    membership: {
      findUnique: jest.fn(),
    },
    project: {
      findUnique: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
    },
    $queryRaw: jest.fn(),
  } as unknown as PrismaService & {
    status: { findMany: jest.Mock };
    issue: { findMany: jest.Mock };
    personalCard: { count: jest.Mock };
    membership: { findUnique: jest.Mock };
    project: { findUnique: jest.Mock };
    user: { findMany: jest.Mock };
    $queryRaw: jest.Mock;
  };
}

/**
 * Capture the `where` clause passed to the most recent `issue.findMany` call.
 */
function captureIssueFindManyWhere(prisma: ReturnType<typeof makePrisma>) {
  const calls = (prisma.issue.findMany as jest.Mock).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[0][0]?.where as Record<string, unknown>;
}

type MockPrisma = ReturnType<typeof makePrisma>;

// ---------------------------------------------------------------------------
// Helper: build a window start date
// ---------------------------------------------------------------------------

function windowStartDate(days: number): Date {
  const today = new Date();
  return new Date(
    Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate() - days + 1,
    ),
  );
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('AnalyticsService', () => {
  let prisma: MockPrisma;
  let service: AnalyticsService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new AnalyticsService(prisma as unknown as PrismaService);
    // Default: allow project membership.
    jest
      .spyOn(membershipUtil, 'assertProjectMember')
      .mockResolvedValue({} as never);
  });

  afterEach(() => jest.restoreAllMocks());

  // ── personalAnalytics ──────────────────────────────────────────────────────

  describe('personalAnalytics', () => {
    // Helper: set up a minimal "no issues, empty board" scenario.
    function setupEmpty() {
      prisma.issue.findMany.mockResolvedValue([]);
      prisma.status.findMany.mockResolvedValue([]);
      prisma.$queryRaw.mockResolvedValue([]);
      prisma.personalCard.count.mockResolvedValue(0);
    }

    it('returns zeroed counts when the user has no assigned issues', async () => {
      setupEmpty();

      const result = await service.personalAnalytics(USER_ID, 30);

      expect(result.days).toBe(30);
      expect(result.assigned.open).toBe(0);
      expect(result.assigned.completed).toBe(0);
      expect(result.assigned.overdue).toBe(0);
      expect(result.avgCycleTimeDays).toBeNull();
      expect(result.byType).toEqual([]);
      expect(result.byPriority).toEqual([]);
      expect(result.personalBoard.totalCards).toBe(0);
    });

    it('clamps days to 1 at minimum', async () => {
      setupEmpty();
      const result = await service.personalAnalytics(USER_ID, 0);
      expect(result.days).toBe(1);
    });

    it('clamps days to 366 at maximum', async () => {
      setupEmpty();
      const result = await service.personalAnalytics(USER_ID, 999);
      expect(result.days).toBe(366);
    });

    it('throughput has exactly `days` entries (zero-filled)', async () => {
      setupEmpty();
      const result = await service.personalAnalytics(USER_ID, 7);
      expect(result.throughput).toHaveLength(7);
      // Each entry should have created=0 and completed=0.
      for (const point of result.throughput) {
        expect(point.created).toBe(0);
        expect(point.completed).toBe(0);
        expect(point.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });

    it('throughput series dates are in ascending order', async () => {
      setupEmpty();
      const result = await service.personalAnalytics(USER_ID, 10);
      const dates = result.throughput.map((p) => p.date);
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i] > dates[i - 1]).toBe(true);
      }
    });

    it('counts open, overdue, and completed correctly', async () => {
      const overdueIssue = makeIssue({
        id: 'i-overdue',
        statusCategory: 'TODO',
        dueDate: new Date('2020-01-01'), // far in the past
      });
      const openIssue = makeIssue({ id: 'i-open', statusCategory: 'IN_PROGRESS' });
      const doneIssue = makeIssue({
        id: 'i-done',
        statusCategory: 'DONE',
        projectId: PROJECT_ID,
      });

      prisma.issue.findMany.mockResolvedValue([overdueIssue, openIssue, doneIssue]);

      // One DONE status for the project.
      prisma.status.findMany.mockResolvedValue([
        makeStatus({ id: 'status-done', category: 'DONE' }),
      ]);

      // completionMap: i-done completed today.
      prisma.$queryRaw.mockResolvedValue([
        {
          issue_id: 'i-done',
          completed_day: todayKey(),
          completed_ts: new Date(),
          created_at: doneIssue.createdAt,
        },
      ]);

      prisma.personalCard.count.mockResolvedValue(0);

      const result = await service.personalAnalytics(USER_ID, 30);

      expect(result.assigned.open).toBe(2);       // overdueIssue + openIssue
      expect(result.assigned.completed).toBe(1);  // doneIssue
      expect(result.assigned.overdue).toBe(1);    // overdueIssue
    });

    it('byType and byPriority reflect open issues only', async () => {
      const openTask = makeIssue({
        id: 'i-task',
        type: 'TASK',
        priority: 'HIGH',
        statusCategory: 'TODO',
      });
      const openBug = makeIssue({
        id: 'i-bug',
        type: 'BUG',
        priority: 'HIGH',
        statusCategory: 'IN_PROGRESS',
      });
      const doneTask = makeIssue({
        id: 'i-done',
        type: 'TASK',
        priority: 'LOW',
        statusCategory: 'DONE',
      });

      prisma.issue.findMany.mockResolvedValue([openTask, openBug, doneTask]);
      prisma.status.findMany.mockResolvedValue([
        makeStatus({ id: 'status-done', category: 'DONE' }),
      ]);
      prisma.$queryRaw.mockResolvedValue([]);
      prisma.personalCard.count.mockResolvedValue(0);

      const result = await service.personalAnalytics(USER_ID, 30);

      // byType: TASK=1, BUG=1 (done TASK excluded).
      const typeMap = Object.fromEntries(result.byType.map((c) => [c.key, c.count]));
      expect(typeMap['TASK']).toBe(1);
      expect(typeMap['BUG']).toBe(1);
      expect(typeMap['LOW']).toBeUndefined(); // priority key shouldn't appear in type

      // byPriority: HIGH=2 (two open issues with HIGH).
      const priorityMap = Object.fromEntries(result.byPriority.map((c) => [c.key, c.count]));
      expect(priorityMap['HIGH']).toBe(2);
      // LOW is only on the done issue — not counted.
      expect(priorityMap['LOW']).toBeUndefined();
    });

    it('avgCycleTimeDays is null when no issues completed in the window', async () => {
      prisma.issue.findMany.mockResolvedValue([
        makeIssue({ id: 'i-open', statusCategory: 'TODO' }),
      ]);
      prisma.status.findMany.mockResolvedValue([
        makeStatus({ id: 'status-done', category: 'DONE' }),
      ]);
      prisma.$queryRaw.mockResolvedValue([]); // no completions
      prisma.personalCard.count.mockResolvedValue(0);

      const result = await service.personalAnalytics(USER_ID, 30);
      expect(result.avgCycleTimeDays).toBeNull();
    });

    it('avgCycleTimeDays is computed correctly from completion data', async () => {
      const createdAt = new Date('2026-06-01T00:00:00Z');
      const completedTs = new Date('2026-06-04T00:00:00Z'); // 3 days later

      prisma.issue.findMany.mockResolvedValue([
        makeIssue({ id: 'i-done', statusCategory: 'DONE', createdAt }),
      ]);
      prisma.status.findMany.mockResolvedValue([
        makeStatus({ id: 'status-done', category: 'DONE' }),
      ]);
      prisma.$queryRaw.mockResolvedValue([
        {
          issue_id: 'i-done',
          completed_day: '2026-06-04',
          completed_ts: completedTs,
          created_at: createdAt,
        },
      ]);
      prisma.personalCard.count.mockResolvedValue(0);

      const result = await service.personalAnalytics(USER_ID, 30);
      // 3 days exactly.
      expect(result.avgCycleTimeDays).toBe(3);
    });

    it('personalBoard counts are forwarded correctly', async () => {
      prisma.issue.findMany.mockResolvedValue([]);
      prisma.status.findMany.mockResolvedValue([]);
      prisma.$queryRaw.mockResolvedValue([]);
      // Return different values per call: count, promoted, createdInWindow.
      prisma.personalCard.count
        .mockResolvedValueOnce(10)   // totalCards
        .mockResolvedValueOnce(3)    // promoted
        .mockResolvedValueOnce(2);   // createdInWindow

      const result = await service.personalAnalytics(USER_ID, 30);
      expect(result.personalBoard.totalCards).toBe(10);
      expect(result.personalBoard.promoted).toBe(3);
      expect(result.personalBoard.createdInWindow).toBe(2);
    });

    // ── Tenant isolation regression ────────────────────────────────────────

    it('scopes issue query to workspaces the user is a member of (tenant isolation)', async () => {
      // This test guards against the P1 security finding: without the workspace
      // membership scope, a user who is assigned to an issue in a workspace they
      // are NOT a member of (e.g. removed from the workspace after assignment)
      // would see that issue's counts in their personal analytics dashboard.
      //
      // We verify that the `where` clause passed to issue.findMany includes
      // the nested workspace-membership filter — not just `assigneeId: userId`.
      setupEmpty();
      await service.personalAnalytics(USER_ID, 30);

      const where = captureIssueFindManyWhere(prisma);

      // Must still scope to the requesting user as assignee.
      expect(where['assigneeId']).toBe(USER_ID);

      // Must additionally restrict to projects whose workspace the user belongs to.
      // Prisma path: issue.project.workspace.memberships (some { userId })
      const projectFilter = where['project'] as Record<string, unknown> | undefined;
      expect(projectFilter).toBeDefined();
      const workspaceFilter = projectFilter!['workspace'] as Record<string, unknown> | undefined;
      expect(workspaceFilter).toBeDefined();
      const membershipsFilter = workspaceFilter!['memberships'] as Record<string, unknown> | undefined;
      expect(membershipsFilter).toBeDefined();
      expect(membershipsFilter!['some']).toMatchObject({ userId: USER_ID });
    });

    it('does NOT count issues from workspaces the user is not a member of', async () => {
      // Simulate: prisma returns zero issues because the workspace-membership
      // filter excluded the cross-workspace issue. The service must report 0
      // open/completed regardless of what the DB might hold without the filter.
      prisma.issue.findMany.mockResolvedValue([]); // filter excluded all issues
      prisma.status.findMany.mockResolvedValue([]);
      prisma.$queryRaw.mockResolvedValue([]);
      prisma.personalCard.count.mockResolvedValue(0);

      const result = await service.personalAnalytics(USER_ID, 30);

      // Counts must be zero — cross-workspace issues must not be aggregated.
      expect(result.assigned.open).toBe(0);
      expect(result.assigned.completed).toBe(0);
      expect(result.assigned.overdue).toBe(0);
    });

    it('throughput created count increments on the issue createdAt day', async () => {
      // Issue created today.
      const today = new Date();
      const todayUtc = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
      );
      const issue = makeIssue({
        id: 'i-new',
        statusCategory: 'TODO',
        createdAt: todayUtc,
      });

      prisma.issue.findMany.mockResolvedValue([issue]);
      prisma.status.findMany.mockResolvedValue([]);
      prisma.$queryRaw.mockResolvedValue([]);
      prisma.personalCard.count.mockResolvedValue(0);

      const result = await service.personalAnalytics(USER_ID, 7);

      const todayPoint = result.throughput.find((p) => p.date === todayKey());
      expect(todayPoint).toBeDefined();
      expect(todayPoint!.created).toBe(1);
    });
  });

  // ── projectAnalytics ───────────────────────────────────────────────────────

  describe('projectAnalytics', () => {
    function setupEmpty() {
      prisma.issue.findMany.mockResolvedValue([]);
      prisma.status.findMany.mockResolvedValue([]);
      prisma.$queryRaw.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([]);
    }

    it('calls assertProjectMember to enforce authorization', async () => {
      setupEmpty();
      await service.projectAnalytics(USER_ID, PROJECT_ID, 30);
      expect(membershipUtil.assertProjectMember).toHaveBeenCalledWith(
        expect.anything(),
        USER_ID,
        PROJECT_ID,
      );
    });

    it('returns zeroed payload when the project has no issues', async () => {
      setupEmpty();

      const result = await service.projectAnalytics(USER_ID, PROJECT_ID, 30);

      expect(result.projectId).toBe(PROJECT_ID);
      expect(result.days).toBe(30);
      expect(result.createdTotal).toBe(0);
      expect(result.completedTotal).toBe(0);
      expect(result.avgCycleTimeDays).toBeNull();
      expect(result.workload).toEqual([]);
    });

    it('flow series is zero-filled with exactly `days` entries', async () => {
      setupEmpty();

      const result = await service.projectAnalytics(USER_ID, PROJECT_ID, 14);
      expect(result.flow).toHaveLength(14);
      for (const point of result.flow) {
        expect(point.created).toBe(0);
        expect(point.completed).toBe(0);
      }
    });

    it('flow series dates are in ascending order', async () => {
      setupEmpty();
      const result = await service.projectAnalytics(USER_ID, PROJECT_ID, 10);
      for (let i = 1; i < result.flow.length; i++) {
        expect(result.flow[i].date > result.flow[i - 1].date).toBe(true);
      }
    });

    it('cycleTime always returns all 5 buckets even when all counts are 0', async () => {
      setupEmpty();
      const result = await service.projectAnalytics(USER_ID, PROJECT_ID, 30);

      expect(result.cycleTime).toHaveLength(5);
      const labels = result.cycleTime.map((b) => b.bucket);
      expect(labels).toEqual(['<1d', '1–3d', '3–7d', '1–2w', '>2w']);
      for (const b of result.cycleTime) {
        expect(b.count).toBe(0);
      }
    });

    it('cycleTime bucket boundaries: <1d, 1–3d, 3–7d, 1–2w, >2w', async () => {
      const base = new Date('2026-06-01T00:00:00Z');

      // 5 issues with distinct cycle times.
      const issues = [
        makeIssue({ id: 'i1', statusCategory: 'DONE', createdAt: base }),
        makeIssue({ id: 'i2', statusCategory: 'DONE', createdAt: base }),
        makeIssue({ id: 'i3', statusCategory: 'DONE', createdAt: base }),
        makeIssue({ id: 'i4', statusCategory: 'DONE', createdAt: base }),
        makeIssue({ id: 'i5', statusCategory: 'DONE', createdAt: base }),
      ];

      prisma.issue.findMany.mockResolvedValue(issues);
      prisma.status.findMany.mockResolvedValue([
        makeStatus({ id: 'status-done', category: 'DONE' }),
      ]);

      // Completion timestamps: 0.5d, 2d, 5d, 10d, 20d after createdAt.
      const mkTs = (hours: number) =>
        new Date(base.getTime() + hours * 3600000);

      const today = todayKey();
      prisma.$queryRaw.mockResolvedValue([
        { issue_id: 'i1', completed_day: today, completed_ts: mkTs(12),   created_at: base },
        { issue_id: 'i2', completed_day: today, completed_ts: mkTs(48),   created_at: base },
        { issue_id: 'i3', completed_day: today, completed_ts: mkTs(120),  created_at: base },
        { issue_id: 'i4', completed_day: today, completed_ts: mkTs(240),  created_at: base },
        { issue_id: 'i5', completed_day: today, completed_ts: mkTs(480),  created_at: base },
      ]);

      prisma.user.findMany.mockResolvedValue([]);

      const result = await service.projectAnalytics(USER_ID, PROJECT_ID, 30);
      const bucketMap = Object.fromEntries(
        result.cycleTime.map((b) => [b.bucket, b.count]),
      );

      // 0.5d → <1d; 2d → 1–3d; 5d → 3–7d; 10d → 1–2w; 20d → >2w.
      expect(bucketMap['<1d']).toBe(1);
      expect(bucketMap['1–3d']).toBe(1);
      expect(bucketMap['3–7d']).toBe(1);
      expect(bucketMap['1–2w']).toBe(1);
      expect(bucketMap['>2w']).toBe(1);
    });

    it('avgCycleTimeDays is null when no issues completed in the window', async () => {
      prisma.issue.findMany.mockResolvedValue([
        makeIssue({ id: 'i1', statusCategory: 'TODO' }),
      ]);
      prisma.status.findMany.mockResolvedValue([]);
      prisma.$queryRaw.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([]);

      const result = await service.projectAnalytics(USER_ID, PROJECT_ID, 30);
      expect(result.avgCycleTimeDays).toBeNull();
    });

    it('workload groups open issues by assignee, sorted busiest first', async () => {
      const issues = [
        makeIssue({ id: 'i1', assigneeId: 'user-a', statusCategory: 'TODO' }),
        makeIssue({ id: 'i2', assigneeId: 'user-a', statusCategory: 'IN_PROGRESS' }),
        makeIssue({ id: 'i3', assigneeId: 'user-b', statusCategory: 'TODO' }),
      ];
      prisma.issue.findMany.mockResolvedValue(issues);
      prisma.status.findMany.mockResolvedValue([]);
      prisma.$queryRaw.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([
        { id: 'user-a', name: 'Alice', email: 'alice@example.com' },
        { id: 'user-b', name: 'Bob', email: 'bob@example.com' },
      ]);

      const result = await service.projectAnalytics(USER_ID, PROJECT_ID, 30);

      // user-a has 2 open, user-b has 1 → Alice first.
      expect(result.workload[0].userId).toBe('user-a');
      expect(result.workload[0].name).toBe('Alice');
      expect(result.workload[0].open).toBe(2);
      expect(result.workload[1].userId).toBe('user-b');
      expect(result.workload[1].name).toBe('Bob');
      expect(result.workload[1].open).toBe(1);
    });

    it('workload includes unassigned row when there are unassigned open issues', async () => {
      const issues = [
        makeIssue({ id: 'i1', assigneeId: null, statusCategory: 'TODO' }),
        makeIssue({ id: 'i2', assigneeId: null, statusCategory: 'IN_PROGRESS' }),
        makeIssue({ id: 'i3', assigneeId: 'user-a', statusCategory: 'TODO' }),
      ];
      prisma.issue.findMany.mockResolvedValue(issues);
      prisma.status.findMany.mockResolvedValue([]);
      prisma.$queryRaw.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([
        { id: 'user-a', name: 'Alice', email: 'alice@example.com' },
      ]);

      const result = await service.projectAnalytics(USER_ID, PROJECT_ID, 30);

      const unassignedRow = result.workload.find((r) => r.userId === null);
      expect(unassignedRow).toBeDefined();
      expect(unassignedRow!.name).toBe('Unassigned');
      expect(unassignedRow!.open).toBe(2);
    });

    it('workload excludes unassigned row when all issues are assigned', async () => {
      const issues = [
        makeIssue({ id: 'i1', assigneeId: 'user-a', statusCategory: 'TODO' }),
      ];
      prisma.issue.findMany.mockResolvedValue(issues);
      prisma.status.findMany.mockResolvedValue([]);
      prisma.$queryRaw.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([
        { id: 'user-a', name: 'Alice', email: 'alice@example.com' },
      ]);

      const result = await service.projectAnalytics(USER_ID, PROJECT_ID, 30);
      const unassignedRow = result.workload.find((r) => r.userId === null);
      expect(unassignedRow).toBeUndefined();
    });

    it('workload excludes DONE issues from counts', async () => {
      const issues = [
        makeIssue({ id: 'i1', assigneeId: 'user-a', statusCategory: 'DONE' }),
        makeIssue({ id: 'i2', assigneeId: 'user-a', statusCategory: 'TODO' }),
      ];
      prisma.issue.findMany.mockResolvedValue(issues);
      prisma.status.findMany.mockResolvedValue([
        makeStatus({ id: 'status-done', category: 'DONE' }),
      ]);
      prisma.$queryRaw.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([
        { id: 'user-a', name: 'Alice', email: 'alice@example.com' },
      ]);

      const result = await service.projectAnalytics(USER_ID, PROJECT_ID, 30);
      const aliceRow = result.workload.find((r) => r.userId === 'user-a');
      expect(aliceRow).toBeDefined();
      expect(aliceRow!.open).toBe(1); // only the TODO issue
    });

    it('unassigned row appears AFTER sorted assignees (busiest first overall)', async () => {
      const issues = [
        makeIssue({ id: 'i1', assigneeId: 'user-a', statusCategory: 'TODO' }),
        makeIssue({ id: 'i2', assigneeId: 'user-a', statusCategory: 'TODO' }),
        makeIssue({ id: 'i3', assigneeId: 'user-a', statusCategory: 'TODO' }),
        makeIssue({ id: 'i4', assigneeId: null, statusCategory: 'TODO' }),
        makeIssue({ id: 'i5', assigneeId: null, statusCategory: 'TODO' }),
      ];
      prisma.issue.findMany.mockResolvedValue(issues);
      prisma.status.findMany.mockResolvedValue([]);
      prisma.$queryRaw.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([
        { id: 'user-a', name: 'Alice', email: 'alice@example.com' },
      ]);

      const result = await service.projectAnalytics(USER_ID, PROJECT_ID, 30);
      // user-a has 3 open (busiest), Unassigned has 2.
      // Unassigned should be LAST regardless of its count.
      const lastRow = result.workload[result.workload.length - 1];
      expect(lastRow.userId).toBeNull();
    });

    it('createdTotal and completedTotal reflect window sums', async () => {
      const today = new Date();
      const todayUtc = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
      );

      const issues = [
        makeIssue({ id: 'i1', statusCategory: 'DONE', createdAt: todayUtc }),
        makeIssue({ id: 'i2', statusCategory: 'TODO', createdAt: todayUtc }),
      ];

      prisma.issue.findMany.mockResolvedValue(issues);
      prisma.status.findMany.mockResolvedValue([
        makeStatus({ id: 'status-done', category: 'DONE' }),
      ]);

      // One completion today.
      prisma.$queryRaw.mockResolvedValue([
        {
          issue_id: 'i1',
          completed_day: todayKey(),
          completed_ts: new Date(),
          created_at: todayUtc,
        },
      ]);

      prisma.user.findMany.mockResolvedValue([]);

      const result = await service.projectAnalytics(USER_ID, PROJECT_ID, 30);
      expect(result.createdTotal).toBe(2);
      expect(result.completedTotal).toBe(1);
    });

    it('clamps days to [1, 366]', async () => {
      setupEmpty();

      const r1 = await service.projectAnalytics(USER_ID, PROJECT_ID, 0);
      expect(r1.days).toBe(1);

      setupEmpty();
      const r2 = await service.projectAnalytics(USER_ID, PROJECT_ID, 1000);
      expect(r2.days).toBe(366);
    });
  });
});
