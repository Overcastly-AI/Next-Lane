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
