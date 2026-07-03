import * as membership from '../common/membership.util';
import { ProjectsService } from './projects.service';
import { SocketEvents, Role } from '@next-lane/shared';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { RealtimeService } from '../realtime/realtime.service';

/**
 * DB-free unit tests covering the realtime side-effect of project mutations:
 * `update` and `archive` must both push a `project.updated` event into the
 * project's room so open clients refresh stale name/key/archived state
 * without a manual reload (engineering audit Pass 11 finding).
 */

const PROJECT_ID = 'proj-1';
const WORKSPACE_ID = 'ws-1';

function makePrisma() {
  return {
    project: { update: jest.fn(), findUnique: jest.fn() },
  } as unknown as PrismaService & {
    project: { update: jest.Mock; findUnique: jest.Mock };
  };
}

const auditMock = { record: jest.fn() } as unknown as AuditService;

const projectRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: PROJECT_ID,
  key: 'PROJ',
  name: 'Project One',
  description: null,
  leadId: null,
  workspaceId: WORKSPACE_ID,
  archived: false,
  workflowEnforced: false,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

describe('ProjectsService realtime emission', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let realtime: { emitToProject: jest.Mock };
  let service: ProjectsService;

  beforeEach(() => {
    prisma = makePrisma();
    realtime = { emitToProject: jest.fn() };
    service = new ProjectsService(
      prisma,
      auditMock,
      realtime as unknown as RealtimeService,
    );
    jest
      .spyOn(membership, 'assertProjectRole')
      .mockResolvedValue({ workspaceId: WORKSPACE_ID } as never);
  });

  afterEach(() => jest.restoreAllMocks());

  it('emits project.updated with the mapped ProjectDto on update()', async () => {
    const updatedRow = projectRow({ name: 'Renamed Project' });
    prisma.project.update.mockResolvedValue(updatedRow);

    const result = await service.update('user-1', PROJECT_ID, {
      name: 'Renamed Project',
    });

    expect(result.name).toBe('Renamed Project');
    expect(realtime.emitToProject).toHaveBeenCalledTimes(1);
    expect(realtime.emitToProject).toHaveBeenCalledWith(
      PROJECT_ID,
      SocketEvents.ProjectUpdated,
      expect.objectContaining({ id: PROJECT_ID, name: 'Renamed Project' }),
    );
  });

  it('emits to the project room, not the workspace id', async () => {
    prisma.project.update.mockResolvedValue(projectRow());

    await service.update('user-1', PROJECT_ID, { name: 'X' });

    const [room] = realtime.emitToProject.mock.calls[0];
    expect(room).toBe(PROJECT_ID);
    expect(room).not.toBe(WORKSPACE_ID);
  });

  it('emits project.updated with archived: true on archive()', async () => {
    jest
      .spyOn(membership, 'assertProjectRole')
      .mockResolvedValue({ workspaceId: WORKSPACE_ID, key: 'PROJ', name: 'Project One' } as never);
    prisma.project.update.mockResolvedValue(projectRow({ archived: true }));

    const result = await service.archive('user-1', PROJECT_ID, null);

    expect(result.archived).toBe(true);
    expect(realtime.emitToProject).toHaveBeenCalledWith(
      PROJECT_ID,
      SocketEvents.ProjectUpdated,
      expect.objectContaining({ id: PROJECT_ID, archived: true }),
    );
  });

  it('requires ADMIN role to archive (delegates to assertProjectRole)', async () => {
    const spy = jest
      .spyOn(membership, 'assertProjectRole')
      .mockResolvedValue({ workspaceId: WORKSPACE_ID, key: 'PROJ', name: 'Project One' } as never);
    prisma.project.update.mockResolvedValue(projectRow({ archived: true }));

    await service.archive('user-1', PROJECT_ID, null);

    expect(spy).toHaveBeenCalledWith(prisma, 'user-1', PROJECT_ID, Role.ADMIN);
  });
});

/**
 * Agent Experience Round 2, criterion 6 — GET /projects/:id/activity: a
 * unified, chronologically-merged, cursor-paginated feed over ActivityLog +
 * Comment + WorkLog. DB-free unit tests with a mocked PrismaService.
 */
describe('ProjectsService.getActivity', () => {
  const ISSUE_ID = 'issue-1';
  const ACTOR = { id: 'user-1', name: 'Alice' };
  const issueRef = { number: 7, project: { key: 'NL' } };

  function makeActivityPrisma() {
    return {
      project: { findUnique: jest.fn() },
      membership: { findUnique: jest.fn().mockResolvedValue({ role: Role.VIEWER }) },
      activityLog: { findMany: jest.fn().mockResolvedValue([]) },
      comment: { findMany: jest.fn().mockResolvedValue([]) },
      workLog: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService & {
      project: { findUnique: jest.Mock };
      membership: { findUnique: jest.Mock };
      activityLog: { findMany: jest.Mock };
      comment: { findMany: jest.Mock };
      workLog: { findMany: jest.Mock };
    };
  }

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('requires project membership (VIEWER+)', async () => {
    const prisma = makeActivityPrisma();
    const spy = jest
      .spyOn(membership, 'assertProjectMember')
      .mockResolvedValue({ id: PROJECT_ID, workspaceId: WORKSPACE_ID } as never);
    const service = new ProjectsService(prisma, auditMock, { emitToProject: jest.fn() } as unknown as RealtimeService);

    await service.getActivity('user-1', PROJECT_ID, {});

    expect(spy).toHaveBeenCalledWith(prisma, 'user-1', PROJECT_ID);
  });

  it('merges ActivityLog, Comment, and WorkLog rows in chronological order', async () => {
    const prisma = makeActivityPrisma();
    jest.spyOn(membership, 'assertProjectMember').mockResolvedValue({ id: PROJECT_ID, workspaceId: WORKSPACE_ID } as never);

    prisma.activityLog.findMany.mockResolvedValue([
      {
        id: 'act-2',
        issueId: ISSUE_ID,
        actorId: ACTOR.id,
        actor: ACTOR,
        field: 'status',
        from: 'To Do',
        to: 'In Progress',
        createdAt: new Date('2026-01-01T10:00:00.000Z'),
        issue: issueRef,
      },
    ]);
    prisma.comment.findMany.mockResolvedValue([
      {
        id: 'cmt-1',
        issueId: ISSUE_ID,
        authorId: ACTOR.id,
        author: ACTOR,
        createdAt: new Date('2026-01-01T09:00:00.000Z'),
        issue: issueRef,
      },
    ]);
    prisma.workLog.findMany.mockResolvedValue([
      {
        id: 'wl-1',
        issueId: ISSUE_ID,
        userId: ACTOR.id,
        user: ACTOR,
        minutes: 30,
        note: null,
        createdAt: new Date('2026-01-01T11:00:00.000Z'),
        issue: issueRef,
      },
    ]);

    const service = new ProjectsService(prisma, auditMock, { emitToProject: jest.fn() } as unknown as RealtimeService);
    const result = await service.getActivity('user-1', PROJECT_ID, {});

    expect(result.items.map((i) => i.id)).toEqual(['cmt-1', 'act-2', 'wl-1']);
    expect(result.items[0]).toMatchObject({ kind: 'COMMENT', issueKey: 'NL-7', summary: 'commented' });
    expect(result.items[1]).toMatchObject({
      kind: 'ISSUE_FIELD',
      field: 'status',
      summary: 'status: To Do → In Progress',
    });
    expect(result.items[2]).toMatchObject({ kind: 'WORK_LOG', summary: 'logged 30m' });
    expect(result.nextCursor).toBeNull();
  });

  it('passes `since` through as a createdAt > filter on every source table', async () => {
    const prisma = makeActivityPrisma();
    jest.spyOn(membership, 'assertProjectMember').mockResolvedValue({ id: PROJECT_ID, workspaceId: WORKSPACE_ID } as never);
    const service = new ProjectsService(prisma, auditMock, { emitToProject: jest.fn() } as unknown as RealtimeService);

    await service.getActivity('user-1', PROJECT_ID, { since: '2026-01-01T00:00:00.000Z' });

    for (const mock of [prisma.activityLog.findMany, prisma.comment.findMany, prisma.workLog.findMany]) {
      expect(mock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: { gt: new Date('2026-01-01T00:00:00.000Z') },
          }),
        }),
      );
    }
  });

  it('paginates correctly when the merged set exceeds `limit` (k-way merge correctness)', async () => {
    const prisma = makeActivityPrisma();
    jest.spyOn(membership, 'assertProjectMember').mockResolvedValue({ id: PROJECT_ID, workspaceId: WORKSPACE_ID } as never);

    // 3 activity rows, spaced 1 minute apart — exceeds limit=2.
    prisma.activityLog.findMany.mockResolvedValue(
      [0, 1, 2].map((i) => ({
        id: `act-${i}`,
        issueId: ISSUE_ID,
        actorId: ACTOR.id,
        actor: ACTOR,
        field: 'priority',
        from: 'LOW',
        to: 'HIGH',
        createdAt: new Date(2026, 0, 1, 0, i, 0),
        issue: issueRef,
      })),
    );

    const service = new ProjectsService(prisma, auditMock, { emitToProject: jest.fn() } as unknown as RealtimeService);
    const result = await service.getActivity('user-1', PROJECT_ID, { limit: 2 });

    expect(result.items).toHaveLength(2);
    expect(result.items.map((i) => i.id)).toEqual(['act-0', 'act-1']);
    expect(result.nextCursor).not.toBeNull();

    // Follow the cursor: the mock doesn't apply real filtering, but we can at
    // least assert the cursor round-trips to a valid (createdAt, id) pair the
    // service itself produced (base64url `iso|id`).
    const decoded = Buffer.from(result.nextCursor as string, 'base64url').toString('utf8');
    expect(decoded).toContain('act-1');
  });

  it('summarizes a "created" ActivityLog row distinctly from a field-change row', async () => {
    const prisma = makeActivityPrisma();
    jest.spyOn(membership, 'assertProjectMember').mockResolvedValue({ id: PROJECT_ID, workspaceId: WORKSPACE_ID } as never);
    prisma.activityLog.findMany.mockResolvedValue([
      {
        id: 'act-created',
        issueId: ISSUE_ID,
        actorId: ACTOR.id,
        actor: ACTOR,
        field: 'created',
        from: null,
        to: null,
        createdAt: new Date('2026-01-01T08:00:00.000Z'),
        issue: issueRef,
      },
    ]);

    const service = new ProjectsService(prisma, auditMock, { emitToProject: jest.fn() } as unknown as RealtimeService);
    const result = await service.getActivity('user-1', PROJECT_ID, {});

    expect(result.items[0].summary).toBe('created the issue');
  });
});
