import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  DashboardGadgetVisualization,
  IssueType,
  Priority,
  Role,
  StatusCategory,
} from '@next-lane/shared';
import * as membership from '../common/membership.util';
import {
  DashboardsService,
  DASHBOARD_ISSUES_CAP,
  MAX_DASHBOARDS_PER_PROJECT,
  MAX_GADGETS_PER_DASHBOARD,
} from './dashboards.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { ReportsService } from '../reports/reports.service';
import type { RealtimeService } from '../realtime/realtime.service';

const PROJECT_ID = 'proj-1';
const PROJECT_KEY = 'NL';
const DASHBOARD_ID = 'dash-1';

function makePrisma() {
  return {
    dashboard: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    dashboardGadget: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    customFieldDefinition: { findMany: jest.fn().mockResolvedValue([]) },
    issue: { findMany: jest.fn().mockResolvedValue([]) },
    project: { findUnique: jest.fn().mockResolvedValue({ workspaceId: 'ws-1' }) },
    membership: { findMany: jest.fn().mockResolvedValue([]) },
    sprint: { findMany: jest.fn().mockResolvedValue([]) },
  } as unknown as PrismaService & {
    dashboard: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      count: jest.Mock;
    };
    dashboardGadget: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      createMany: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      count: jest.Mock;
    };
    customFieldDefinition: { findMany: jest.Mock };
    issue: { findMany: jest.Mock };
    project: { findUnique: jest.Mock };
    membership: { findMany: jest.Mock };
    sprint: { findMany: jest.Mock };
  };
}

type MockPrisma = ReturnType<typeof makePrisma>;

function makeReports() {
  return {
    burndown: jest.fn(),
    velocityTrend: jest.fn(),
  } as unknown as ReportsService & { burndown: jest.Mock; velocityTrend: jest.Mock };
}

function makeProjectRow() {
  return {
    id: PROJECT_ID,
    key: PROJECT_KEY,
    name: 'Test Project',
    workspaceId: 'ws-1',
    archived: false,
  };
}

function makeDashboardRow(overrides: Partial<{ id: string; name: string; order: number }> = {}) {
  return {
    id: overrides.id ?? DASHBOARD_ID,
    projectId: PROJECT_ID,
    name: overrides.name ?? 'Team overview',
    order: overrides.order ?? 0,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function makeGadgetRow(overrides: Partial<{
  id: string;
  dashboardId: string;
  title: string;
  query: string;
  visualization: DashboardGadgetVisualization;
  config: unknown;
}> = {}) {
  return {
    id: overrides.id ?? 'gadget-1',
    dashboardId: overrides.dashboardId ?? DASHBOARD_ID,
    title: overrides.title ?? 'Total issues',
    query: overrides.query ?? '',
    visualization: overrides.visualization ?? DashboardGadgetVisualization.STAT,
    config: overrides.config ?? { position: 0 },
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function makeIssueRow(
  i: number,
  overrides: Partial<{ statusName: string; sprintId: string | null; assigneeId: string | null }> = {},
) {
  return {
    id: `issue-${i}`,
    key: `${PROJECT_KEY}-${i}`,
    number: i,
    projectId: PROJECT_ID,
    type: IssueType.TASK,
    title: `Issue ${i}`,
    description: null,
    statusId: 'status-1',
    assigneeId: overrides.assigneeId ?? null,
    reporterId: null,
    priority: Priority.MEDIUM,
    storyPoints: null,
    parentId: null,
    sprintId: overrides.sprintId ?? null,
    dueDate: null,
    rank: `a${i}`,
    componentId: null,
    originalEstimateMinutes: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    project: { key: PROJECT_KEY },
    status: {
      id: 'status-1',
      name: overrides.statusName ?? 'To Do',
      category: StatusCategory.TODO,
      order: 0,
      projectId: PROJECT_ID,
    },
    assignee: null,
    labels: [],
    component: null,
  };
}

describe('DashboardsService', () => {
  let prisma: MockPrisma;
  let reports: ReturnType<typeof makeReports>;
  let realtime: { emitToProject: jest.Mock };
  let service: DashboardsService;

  beforeEach(() => {
    prisma = makePrisma();
    reports = makeReports();
    realtime = { emitToProject: jest.fn() };
    service = new DashboardsService(prisma, reports, realtime as unknown as RealtimeService);
    jest
      .spyOn(membership, 'assertProjectMember')
      .mockResolvedValue(makeProjectRow() as never);
    jest
      .spyOn(membership, 'assertProjectRole')
      .mockResolvedValue(makeProjectRow() as never);
  });

  afterEach(() => jest.restoreAllMocks());

  // ── listDashboards ─────────────────────────────────────────────────────

  it('listDashboards requires project membership and maps gadgetCount', async () => {
    prisma.dashboard.findMany.mockResolvedValue([
      { ...makeDashboardRow(), _count: { gadgets: 3 } },
    ]);

    const result = await service.listDashboards('user-1', PROJECT_ID);

    expect(membership.assertProjectMember).toHaveBeenCalledWith(prisma, 'user-1', PROJECT_ID);
    expect(result).toEqual([
      expect.objectContaining({ id: DASHBOARD_ID, gadgetCount: 3 }),
    ]);
  });

  // ── createDashboard ────────────────────────────────────────────────────

  it('createDashboard requires MEMBER role and appends after the last order', async () => {
    prisma.dashboard.count.mockResolvedValue(3); // project already has dashboards
    prisma.dashboard.findFirst.mockResolvedValue({ order: 2 });
    prisma.dashboard.create.mockResolvedValue(makeDashboardRow({ order: 3 }));

    const result = await service.createDashboard('user-1', PROJECT_ID, { name: 'New' });

    expect(membership.assertProjectRole).toHaveBeenCalledWith(prisma, 'user-1', PROJECT_ID, Role.MEMBER);
    expect(prisma.dashboard.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ order: 3, projectId: PROJECT_ID }) }),
    );
    // Not the project's first dashboard — no default gadgets seeded.
    expect(result.gadgetCount).toBe(0);
    expect(prisma.dashboardGadget.createMany).not.toHaveBeenCalled();
    expect(realtime.emitToProject).toHaveBeenCalledTimes(1);
    expect(realtime.emitToProject).toHaveBeenCalledWith(
      PROJECT_ID,
      'dashboard.updated',
      { dashboardId: DASHBOARD_ID },
    );
  });

  it('createDashboard rejects at the MAX_DASHBOARDS_PER_PROJECT cap', async () => {
    prisma.dashboard.count.mockResolvedValue(MAX_DASHBOARDS_PER_PROJECT);

    await expect(
      service.createDashboard('user-1', PROJECT_ID, { name: 'One too many' }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.dashboard.create).not.toHaveBeenCalled();
  });

  it('createDashboard seeds default gadgets on a project’s first dashboard', async () => {
    prisma.dashboard.count.mockResolvedValue(0);
    prisma.dashboard.findFirst.mockResolvedValue(null);
    prisma.dashboard.create.mockResolvedValue(makeDashboardRow({ order: 0 }));

    const result = await service.createDashboard('user-1', PROJECT_ID, { name: 'First' });

    expect(prisma.dashboardGadget.createMany).toHaveBeenCalledTimes(1);
    const created = prisma.dashboardGadget.createMany.mock.calls[0][0].data as Array<{
      dashboardId: string;
      visualization: DashboardGadgetVisualization;
    }>;
    expect(created).toHaveLength(3);
    expect(created.every((g) => g.dashboardId === DASHBOARD_ID)).toBe(true);
    expect(result.gadgetCount).toBe(3);
  });

  it('createDashboard defaults order to 0 when no dashboards exist', async () => {
    prisma.dashboard.count.mockResolvedValue(0);
    prisma.dashboard.findFirst.mockResolvedValue(null);
    prisma.dashboard.create.mockResolvedValue(makeDashboardRow({ order: 0 }));

    await service.createDashboard('user-1', PROJECT_ID, { name: 'First' });

    expect(prisma.dashboard.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ order: 0 }) }),
    );
  });

  // ── getDashboard ───────────────────────────────────────────────────────

  it('getDashboard 404s when the dashboard does not exist', async () => {
    prisma.dashboard.findUnique.mockResolvedValue(null);
    await expect(service.getDashboard('user-1', 'nope')).rejects.toThrow(NotFoundException);
  });

  it('getDashboard sorts gadgets by config.position', async () => {
    prisma.dashboard.findUnique.mockResolvedValue(makeDashboardRow());
    prisma.dashboardGadget.findMany.mockResolvedValue([
      makeGadgetRow({ id: 'g-2', config: { position: 1 } }),
      makeGadgetRow({ id: 'g-1', config: { position: 0 } }),
    ]);

    const result = await service.getDashboard('user-1', DASHBOARD_ID);

    expect(result.gadgets.map((g) => g.id)).toEqual(['g-1', 'g-2']);
  });

  // ── updateDashboard / deleteDashboard ──────────────────────────────────

  it('updateDashboard patches name and order', async () => {
    prisma.dashboard.findUnique.mockResolvedValue(makeDashboardRow());
    prisma.dashboard.update.mockResolvedValue(makeDashboardRow({ name: 'Renamed', order: 5 }));
    prisma.dashboardGadget.count.mockResolvedValue(0);

    const result = await service.updateDashboard('user-1', DASHBOARD_ID, { name: 'Renamed', order: 5 });

    expect(prisma.dashboard.update).toHaveBeenCalledWith({
      where: { id: DASHBOARD_ID },
      data: { name: 'Renamed', order: 5 },
    });
    expect(result.name).toBe('Renamed');
    expect(realtime.emitToProject).toHaveBeenCalledWith(
      PROJECT_ID,
      'dashboard.updated',
      { dashboardId: DASHBOARD_ID },
    );
  });

  it('deleteDashboard requires MEMBER role and deletes by id', async () => {
    prisma.dashboard.findUnique.mockResolvedValue(makeDashboardRow());
    prisma.dashboard.delete.mockResolvedValue(undefined);

    await service.deleteDashboard('user-1', DASHBOARD_ID);

    expect(membership.assertProjectRole).toHaveBeenCalledWith(prisma, 'user-1', PROJECT_ID, Role.MEMBER);
    expect(prisma.dashboard.delete).toHaveBeenCalledWith({ where: { id: DASHBOARD_ID } });
    expect(realtime.emitToProject).toHaveBeenCalledWith(
      PROJECT_ID,
      'dashboard.updated',
      { dashboardId: DASHBOARD_ID },
    );
  });

  // ── createGadget ───────────────────────────────────────────────────────

  it('createGadget rejects an invalid NLQL query with 400', async () => {
    prisma.dashboard.findUnique.mockResolvedValue(makeDashboardRow());

    await expect(
      service.createGadget('user-1', DASHBOARD_ID, {
        title: 'Bad',
        query: 'status = ',
        visualization: DashboardGadgetVisualization.STAT,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('createGadget rejects BREAKDOWN gadgets missing config.field', async () => {
    prisma.dashboard.findUnique.mockResolvedValue(makeDashboardRow());

    await expect(
      service.createGadget('user-1', DASHBOARD_ID, {
        title: 'Breakdown',
        query: '',
        visualization: DashboardGadgetVisualization.BREAKDOWN,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('createGadget assigns the next grid position and persists', async () => {
    prisma.dashboard.findUnique.mockResolvedValue(makeDashboardRow());
    prisma.dashboardGadget.findMany.mockResolvedValue([
      makeGadgetRow({ id: 'g-1', config: { position: 0 } }),
    ]);
    prisma.dashboardGadget.create.mockResolvedValue(
      makeGadgetRow({ id: 'g-2', config: { position: 1 } }),
    );

    const result = await service.createGadget('user-1', DASHBOARD_ID, {
      title: 'Total issues',
      query: '',
      visualization: DashboardGadgetVisualization.STAT,
    });

    expect(prisma.dashboardGadget.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dashboardId: DASHBOARD_ID,
          config: expect.objectContaining({ position: 1 }),
        }),
      }),
    );
    expect(result.id).toBe('g-2');
    expect(realtime.emitToProject).toHaveBeenCalledWith(
      PROJECT_ID,
      'dashboard.updated',
      { dashboardId: DASHBOARD_ID },
    );
  });

  it('createGadget rejects at the MAX_GADGETS_PER_DASHBOARD cap', async () => {
    prisma.dashboard.findUnique.mockResolvedValue(makeDashboardRow());
    prisma.dashboardGadget.count.mockResolvedValue(MAX_GADGETS_PER_DASHBOARD);

    await expect(
      service.createGadget('user-1', DASHBOARD_ID, {
        title: 'One too many',
        query: '',
        visualization: DashboardGadgetVisualization.STAT,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.dashboardGadget.create).not.toHaveBeenCalled();
  });

  // ── updateGadget ───────────────────────────────────────────────────────

  it('updateGadget 404s for a missing gadget', async () => {
    prisma.dashboardGadget.findUnique.mockResolvedValue(null);
    await expect(
      service.updateGadget('user-1', 'nope', { title: 'x' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('updateGadget rejects switching to BREAKDOWN without a field in the merged config', async () => {
    prisma.dashboardGadget.findUnique.mockResolvedValue({
      ...makeGadgetRow({ visualization: DashboardGadgetVisualization.STAT, config: { position: 0 } }),
      dashboard: makeDashboardRow(),
    });

    await expect(
      service.updateGadget('user-1', 'gadget-1', {
        visualization: DashboardGadgetVisualization.BREAKDOWN,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('updateGadget merges config instead of replacing it', async () => {
    prisma.dashboardGadget.findUnique.mockResolvedValue({
      ...makeGadgetRow({
        visualization: DashboardGadgetVisualization.BREAKDOWN,
        config: { position: 2, field: 'status' },
      }),
      dashboard: makeDashboardRow(),
    });
    prisma.dashboardGadget.update.mockResolvedValue(
      makeGadgetRow({ config: { position: 2, field: 'status', size: 2 } }),
    );

    await service.updateGadget('user-1', 'gadget-1', { config: { size: 2 } });

    expect(prisma.dashboardGadget.update).toHaveBeenCalledWith({
      where: { id: 'gadget-1' },
      data: { config: { position: 2, field: 'status', size: 2 } },
    });
    expect(realtime.emitToProject).toHaveBeenCalledWith(
      PROJECT_ID,
      'dashboard.updated',
      { dashboardId: DASHBOARD_ID },
    );
  });

  // ── deleteGadget ───────────────────────────────────────────────────────

  it('deleteGadget requires MEMBER role scoped to the gadget dashboard project', async () => {
    prisma.dashboardGadget.findUnique.mockResolvedValue({
      ...makeGadgetRow(),
      dashboard: makeDashboardRow(),
    });

    await service.deleteGadget('user-1', 'gadget-1');

    expect(membership.assertProjectRole).toHaveBeenCalledWith(prisma, 'user-1', PROJECT_ID, Role.MEMBER);
    expect(prisma.dashboardGadget.delete).toHaveBeenCalledWith({ where: { id: 'gadget-1' } });
    expect(realtime.emitToProject).toHaveBeenCalledWith(
      PROJECT_ID,
      'dashboard.updated',
      { dashboardId: DASHBOARD_ID },
    );
  });

  // ── getDashboardData ───────────────────────────────────────────────────

  describe('getDashboardData', () => {
    beforeEach(() => {
      prisma.dashboard.findUnique.mockResolvedValue(makeDashboardRow());
    });

    it('computes a STAT gadget from the project issue set', async () => {
      prisma.dashboardGadget.findMany.mockResolvedValue([
        makeGadgetRow({ query: '', visualization: DashboardGadgetVisualization.STAT }),
      ]);
      prisma.issue.findMany.mockResolvedValue([makeIssueRow(1), makeIssueRow(2)]);

      const result = await service.getDashboardData('user-1', DASHBOARD_ID);

      expect(result.gadgets).toHaveLength(1);
      expect(result.gadgets[0].data).toEqual({ kind: 'STAT', count: 2 });
      expect(result.gadgets[0].error).toBeUndefined();
      expect(result.issuesTruncated).toBe(false);
    });

    it('scopes STAT to the gadget query (NLQL) rather than counting every issue', async () => {
      prisma.dashboardGadget.findMany.mockResolvedValue([
        makeGadgetRow({ query: 'status = "In Progress"' }),
      ]);
      prisma.issue.findMany.mockResolvedValue([
        makeIssueRow(1, { statusName: 'In Progress' }),
        makeIssueRow(2, { statusName: 'To Do' }),
      ]);

      const result = await service.getDashboardData('user-1', DASHBOARD_ID);

      expect(result.gadgets[0].data).toEqual({ kind: 'STAT', count: 1 });
    });

    it('returns a per-gadget error for invalid stored NLQL instead of throwing', async () => {
      prisma.dashboardGadget.findMany.mockResolvedValue([
        makeGadgetRow({ query: 'status = ' }),
      ]);
      prisma.issue.findMany.mockResolvedValue([makeIssueRow(1)]);

      const result = await service.getDashboardData('user-1', DASHBOARD_ID);

      expect(result.gadgets[0].data).toBeUndefined();
      expect(result.gadgets[0].error).toBeTruthy();
    });

    it('computes a BREAKDOWN gadget grouped by status', async () => {
      prisma.dashboardGadget.findMany.mockResolvedValue([
        makeGadgetRow({
          query: '',
          visualization: DashboardGadgetVisualization.BREAKDOWN,
          config: { position: 0, field: 'status' },
        }),
      ]);
      prisma.issue.findMany.mockResolvedValue([
        makeIssueRow(1, { statusName: 'To Do' }),
        makeIssueRow(2, { statusName: 'To Do' }),
        makeIssueRow(3, { statusName: 'Done' }),
      ]);

      const result = await service.getDashboardData('user-1', DASHBOARD_ID);

      expect(result.gadgets[0].data).toEqual({
        kind: 'BREAKDOWN',
        field: 'status',
        buckets: expect.arrayContaining([
          { key: 'To Do', count: 2 },
          { key: 'Done', count: 1 },
        ]),
      });
    });

    it('resolves a BURNDOWN gadget to the single sprint its issues belong to', async () => {
      prisma.dashboardGadget.findMany.mockResolvedValue([
        makeGadgetRow({ query: '', visualization: DashboardGadgetVisualization.BURNDOWN }),
      ]);
      prisma.issue.findMany.mockResolvedValue([
        makeIssueRow(1, { sprintId: 'sprint-1' }),
        makeIssueRow(2, { sprintId: 'sprint-1' }),
      ]);
      reports.burndown.mockResolvedValue({
        sprintId: 'sprint-1',
        sprintName: 'Sprint 1',
        state: 'ACTIVE',
        startDate: null,
        endDate: null,
        totalCommitted: 8,
        series: [{ date: '2026-01-01', ideal: 8, remaining: 8 }],
      });

      const result = await service.getDashboardData('user-1', DASHBOARD_ID);

      expect(reports.burndown).toHaveBeenCalledWith('user-1', PROJECT_ID, 'sprint-1');
      expect(result.gadgets[0].data).toMatchObject({
        kind: 'BURNDOWN',
        sprintId: 'sprint-1',
        sprintName: 'Sprint 1',
        totalCommitted: 8,
      });
    });

    it('errors a BURNDOWN gadget whose issues span no sprint', async () => {
      prisma.dashboardGadget.findMany.mockResolvedValue([
        makeGadgetRow({ query: '', visualization: DashboardGadgetVisualization.BURNDOWN }),
      ]);
      prisma.issue.findMany.mockResolvedValue([makeIssueRow(1, { sprintId: null })]);

      const result = await service.getDashboardData('user-1', DASHBOARD_ID);

      expect(result.gadgets[0].data).toBeUndefined();
      expect(result.gadgets[0].error).toMatch(/no issues matched/i);
      expect(reports.burndown).not.toHaveBeenCalled();
    });

    it('computes a VELOCITY_TREND gadget project-wide, ignoring the gadget query', async () => {
      prisma.dashboardGadget.findMany.mockResolvedValue([
        makeGadgetRow({
          query: 'priority = HIGH', // deliberately non-matching — must be ignored
          visualization: DashboardGadgetVisualization.VELOCITY_TREND,
          config: { position: 0, sprints: 4 },
        }),
      ]);
      prisma.issue.findMany.mockResolvedValue([makeIssueRow(1)]); // priority MEDIUM
      reports.velocityTrend.mockResolvedValue({
        projectId: PROJECT_ID,
        sprints: 4,
        points: [
          { sprintId: 'sp-1', sprintName: 'Sprint 1', state: 'COMPLETED', committed: 10, completed: 8 },
          { sprintId: 'sp-2', sprintName: 'Sprint 2', state: 'ACTIVE', committed: 6, completed: 0 },
        ],
      });

      const result = await service.getDashboardData('user-1', DASHBOARD_ID);

      expect(reports.velocityTrend).toHaveBeenCalledWith('user-1', PROJECT_ID, 4);
      expect(result.gadgets[0].data).toEqual({
        kind: 'VELOCITY_TREND',
        sprints: 4,
        points: [
          { sprintId: 'sp-1', sprintName: 'Sprint 1', state: 'COMPLETED', committed: 10, completed: 8 },
          { sprintId: 'sp-2', sprintName: 'Sprint 2', state: 'ACTIVE', committed: 6, completed: 0 },
        ],
      });
      expect(result.gadgets[0].error).toBeUndefined();
    });

    it('defaults VELOCITY_TREND to 6 sprints when config.sprints is unset', async () => {
      prisma.dashboardGadget.findMany.mockResolvedValue([
        makeGadgetRow({ query: '', visualization: DashboardGadgetVisualization.VELOCITY_TREND }),
      ]);
      prisma.issue.findMany.mockResolvedValue([]);
      reports.velocityTrend.mockResolvedValue({ projectId: PROJECT_ID, sprints: 6, points: [] });

      await service.getDashboardData('user-1', DASHBOARD_ID);

      expect(reports.velocityTrend).toHaveBeenCalledWith('user-1', PROJECT_ID, 6);
    });

    it('returns a per-gadget error when velocityTrend fails, instead of throwing', async () => {
      prisma.dashboardGadget.findMany.mockResolvedValue([
        makeGadgetRow({ query: '', visualization: DashboardGadgetVisualization.VELOCITY_TREND }),
      ]);
      prisma.issue.findMany.mockResolvedValue([]);
      reports.velocityTrend.mockRejectedValue(new Error('boom'));

      const result = await service.getDashboardData('user-1', DASHBOARD_ID);

      expect(result.gadgets[0].data).toBeUndefined();
      expect(result.gadgets[0].error).toBe('boom');
    });

    it('evaluates every gadget in parallel (order preserved, one bad gadget does not block the rest)', async () => {
      prisma.dashboardGadget.findMany.mockResolvedValue([
        makeGadgetRow({ id: 'g-1', query: 'status = ' }), // invalid — errors
        makeGadgetRow({ id: 'g-2', query: '', visualization: DashboardGadgetVisualization.STAT }),
      ]);
      prisma.issue.findMany.mockResolvedValue([makeIssueRow(1), makeIssueRow(2)]);

      const result = await service.getDashboardData('user-1', DASHBOARD_ID);

      expect(result.gadgets.map((g) => g.gadgetId)).toEqual(['g-1', 'g-2']);
      expect(result.gadgets[0].error).toBeTruthy();
      expect(result.gadgets[1].data).toEqual({ kind: 'STAT', count: 2 });
    });

    it('sets issuesTruncated when the project issue set exceeds the cap', async () => {
      prisma.dashboardGadget.findMany.mockResolvedValue([
        makeGadgetRow({ query: '', visualization: DashboardGadgetVisualization.STAT }),
      ]);
      const rows = Array.from({ length: DASHBOARD_ISSUES_CAP + 1 }, (_, i) => makeIssueRow(i));
      prisma.issue.findMany.mockResolvedValue(rows);

      const result = await service.getDashboardData('user-1', DASHBOARD_ID);

      expect(result.issuesTruncated).toBe(true);
      expect(result.gadgets[0].data).toEqual({ kind: 'STAT', count: DASHBOARD_ISSUES_CAP });
    });

    // ── NLQL person/sprint name resolution (MCP-QA pass 1, finding 1) ──────
    //
    // `get_dashboard_data` filters the project's issues through each
    // gadget's stored NLQL query server-side — the same evaluator used by
    // exportCsv. Before the fix, a gadget's `assignee = "<name>"` or
    // `sprint = "<name>"` silently matched zero issues.

    it('resolves assignee by display name in a gadget query', async () => {
      prisma.dashboardGadget.findMany.mockResolvedValue([
        makeGadgetRow({ query: 'assignee = "Alex Rivera"' }),
      ]);
      prisma.issue.findMany.mockResolvedValue([
        makeIssueRow(1, { assigneeId: 'u-alex' }),
        makeIssueRow(2, { assigneeId: 'u-jordan' }),
      ]);
      prisma.membership.findMany.mockResolvedValue([
        { user: { id: 'u-alex', email: 'alex@nextlane.dev', name: 'Alex Rivera' } },
        { user: { id: 'u-jordan', email: 'jordan@nextlane.dev', name: 'Jordan Lee' } },
      ]);

      const result = await service.getDashboardData('user-1', DASHBOARD_ID);

      expect(result.gadgets[0].data).toEqual({ kind: 'STAT', count: 1 });
      expect(result.gadgets[0].error).toBeUndefined();
    });

    it('resolves sprint by name in a gadget query', async () => {
      prisma.dashboardGadget.findMany.mockResolvedValue([
        makeGadgetRow({ query: 'sprint = "July-B"' }),
      ]);
      prisma.issue.findMany.mockResolvedValue([
        makeIssueRow(1, { sprintId: 'sp-july-b' }),
        makeIssueRow(2, { sprintId: 'sp-july-b' }),
        makeIssueRow(3, { sprintId: 'sp-other' }),
      ]);
      prisma.sprint.findMany.mockResolvedValue([
        { id: 'sp-july-b', name: 'July-B' },
        { id: 'sp-other', name: 'Other Sprint' },
      ]);

      const result = await service.getDashboardData('user-1', DASHBOARD_ID);

      expect(result.gadgets[0].data).toEqual({ kind: 'STAT', count: 2 });
    });

    it('loads workspace members / sprints at most once for the whole dashboard, across multiple gadgets', async () => {
      prisma.dashboardGadget.findMany.mockResolvedValue([
        makeGadgetRow({ id: 'g-1', query: 'assignee = "Alex Rivera"' }),
        makeGadgetRow({ id: 'g-2', query: 'sprint = "July-B"' }),
        makeGadgetRow({ id: 'g-3', query: 'assignee = "Alex Rivera" AND sprint = "July-B"' }),
      ]);
      prisma.issue.findMany.mockResolvedValue([makeIssueRow(1, { assigneeId: 'u-alex', sprintId: 'sp-july-b' })]);
      prisma.membership.findMany.mockResolvedValue([
        { user: { id: 'u-alex', email: 'alex@nextlane.dev', name: 'Alex Rivera' } },
      ]);
      prisma.sprint.findMany.mockResolvedValue([{ id: 'sp-july-b', name: 'July-B' }]);

      await service.getDashboardData('user-1', DASHBOARD_ID);

      expect(prisma.membership.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.sprint.findMany).toHaveBeenCalledTimes(1);
    });

    it('does not query workspace members or sprints when no gadget references those fields', async () => {
      prisma.dashboardGadget.findMany.mockResolvedValue([
        makeGadgetRow({ query: 'status = "In Progress"' }),
      ]);
      prisma.issue.findMany.mockResolvedValue([makeIssueRow(1)]);

      await service.getDashboardData('user-1', DASHBOARD_ID);

      expect(prisma.membership.findMany).not.toHaveBeenCalled();
      expect(prisma.sprint.findMany).not.toHaveBeenCalled();
    });

    // ── Unresolved user/sprint name → per-gadget error (MCP-QA pass 1,
    // finding 1 RESIDUAL) ────────────────────────────────────────────────
    //
    // A typo'd/nonexistent name must surface as THAT gadget's error state,
    // never a 500/400 for the whole dashboard read — one bad gadget must
    // never take down its siblings (docs/BACKLOG.md).

    it('flags a single gadget with an unresolved assignee name, without failing the whole read', async () => {
      prisma.dashboardGadget.findMany.mockResolvedValue([
        makeGadgetRow({ id: 'g-bad', query: 'assignee = "Nobody By This Name"' }),
        makeGadgetRow({ id: 'g-good', query: '' }),
      ]);
      prisma.issue.findMany.mockResolvedValue([makeIssueRow(1, { assigneeId: 'u-alex' })]);
      prisma.membership.findMany.mockResolvedValue([
        { user: { id: 'u-alex', email: 'alex@nextlane.dev', name: 'Alex Rivera' } },
      ]);

      const result = await service.getDashboardData('user-1', DASHBOARD_ID);

      const bad = result.gadgets.find((g) => g.gadgetId === 'g-bad');
      const good = result.gadgets.find((g) => g.gadgetId === 'g-good');
      expect(bad?.error).toBe(
        'unknown user "Nobody By This Name" — use an exact display name, an id, or me(); see list_users',
      );
      expect(bad?.data).toBeUndefined();
      expect(good?.error).toBeUndefined();
      expect(good?.data).toEqual({ kind: 'STAT', count: 1 });
    });

    it('flags a gadget with an unresolved sprint name', async () => {
      prisma.dashboardGadget.findMany.mockResolvedValue([
        makeGadgetRow({ query: 'sprint = "Nonexistent Sprint"' }),
      ]);
      prisma.issue.findMany.mockResolvedValue([makeIssueRow(1, { sprintId: 'sp-july-b' })]);
      prisma.sprint.findMany.mockResolvedValue([{ id: 'sp-july-b', name: 'July-B' }]);

      const result = await service.getDashboardData('user-1', DASHBOARD_ID);

      expect(result.gadgets[0].error).toBe(
        'unknown sprint "Nonexistent Sprint" — use an exact sprint name or an id; see list_sprints',
      );
    });

    it('does not flag an opaque-id-shaped assignee operand even when unresolved', async () => {
      const staleId = 'usr-cljk3n9d80000ab12removedmember';
      prisma.dashboardGadget.findMany.mockResolvedValue([
        makeGadgetRow({ query: `assignee = "${staleId}"` }),
      ]);
      prisma.issue.findMany.mockResolvedValue([makeIssueRow(1, { assigneeId: 'u-alex' })]);
      prisma.membership.findMany.mockResolvedValue([
        { user: { id: 'u-alex', email: 'alex@nextlane.dev', name: 'Alex Rivera' } },
      ]);

      const result = await service.getDashboardData('user-1', DASHBOARD_ID);

      expect(result.gadgets[0].error).toBeUndefined();
      expect(result.gadgets[0].data).toEqual({ kind: 'STAT', count: 0 });
    });

    it('evaluates gadgets in grid-position order', async () => {
      prisma.dashboardGadget.findMany.mockResolvedValue([
        makeGadgetRow({ id: 'g-2', title: 'Second', config: { position: 1 } }),
        makeGadgetRow({ id: 'g-1', title: 'First', config: { position: 0 } }),
      ]);
      prisma.issue.findMany.mockResolvedValue([]);

      const result = await service.getDashboardData('user-1', DASHBOARD_ID);

      expect(result.gadgets.map((g) => g.gadgetId)).toEqual(['g-1', 'g-2']);
    });
  });
});
