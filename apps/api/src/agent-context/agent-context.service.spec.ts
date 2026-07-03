import { ForbiddenException } from '@nestjs/common';
import { Role, SocketEvents } from '@next-lane/shared';
import * as membership from '../common/membership.util';
import { AgentContextService } from './agent-context.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RealtimeService } from '../realtime/realtime.service';

const PROJECT_ID = 'project-1';
const USER_ID = 'user-1';

function makePrisma() {
  return {
    membership: { findUnique: jest.fn() },
    projectMembership: { findUnique: jest.fn().mockResolvedValue(null) },
    project: {
      findUnique: jest.fn().mockResolvedValue({
        workspaceId: 'ws-1',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      }),
    },
    projectAgentContext: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    activityLog: {
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    auditEvent: {
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
}
type MockPrisma = ReturnType<typeof makePrisma>;

const mockRealtime: Pick<RealtimeService, 'emitToProject'> = {
  emitToProject: jest.fn(),
};

describe('AgentContextService', () => {
  let prisma: MockPrisma;
  let service: AgentContextService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new AgentContextService(
      prisma as unknown as PrismaService,
      mockRealtime as unknown as RealtimeService,
    );
    jest.clearAllMocks();
    jest
      .spyOn(membership, 'assertProjectMember')
      .mockResolvedValue({
        workspaceId: 'ws-1',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      } as never);
  });

  afterEach(() => jest.restoreAllMocks());

  // ---- get() ------------------------------------------------------------------

  describe('get', () => {
    it('returns an empty document (never 404) when nothing has been written', async () => {
      prisma.projectAgentContext.findUnique.mockResolvedValue(null);
      prisma.activityLog.count.mockResolvedValue(0);
      prisma.auditEvent.count.mockResolvedValue(0);

      const result = await service.get(USER_ID, PROJECT_ID);

      expect(result.content).toBe('');
      expect(result.updatedAt).toBeNull();
      expect(result.updatedBy).toBeNull();
      expect(result.staleness.changesSinceUpdate).toBe(0);
    });

    it('returns the stored content + updatedBy when written', async () => {
      prisma.projectAgentContext.findUnique.mockResolvedValue({
        content: '# Handoff\n\nDone: auth module.',
        updatedAt: new Date('2026-07-01T00:00:00Z'),
        updatedBy: { id: 'user-2', name: 'Jane Doe' },
      });

      const result = await service.get(USER_ID, PROJECT_ID);

      expect(result.content).toBe('# Handoff\n\nDone: auth module.');
      expect(result.updatedAt).toBe('2026-07-01T00:00:00.000Z');
      expect(result.updatedBy).toEqual({ id: 'user-2', name: 'Jane Doe' });
    });

    it('computes changesSinceUpdate from ActivityLog + AuditEvent counts newer than updatedAt', async () => {
      prisma.projectAgentContext.findUnique.mockResolvedValue({
        content: 'stale handoff',
        updatedAt: new Date('2026-07-01T00:00:00Z'),
        updatedBy: null,
      });
      prisma.activityLog.count.mockResolvedValue(3);
      prisma.activityLog.findFirst.mockResolvedValue({
        createdAt: new Date('2026-07-02T00:00:00Z'),
      });
      prisma.auditEvent.count.mockResolvedValue(2);
      prisma.auditEvent.findFirst.mockResolvedValue({
        createdAt: new Date('2026-07-03T00:00:00Z'),
      });

      const result = await service.get(USER_ID, PROJECT_ID);

      expect(result.staleness.changesSinceUpdate).toBe(5);
      expect(result.staleness.lastProjectActivityAt).toBe('2026-07-03T00:00:00.000Z');
      // Scoped the ActivityLog count to this project's issues, since the baseline.
      expect(prisma.activityLog.count).toHaveBeenCalledWith({
        where: {
          issue: { projectId: PROJECT_ID },
          createdAt: { gt: new Date('2026-07-01T00:00:00Z') },
        },
      });
      // Scoped the AuditEvent count via the metadata.projectId JSON path.
      expect(prisma.auditEvent.count).toHaveBeenCalledWith({
        where: {
          workspaceId: 'ws-1',
          createdAt: { gt: new Date('2026-07-01T00:00:00Z') },
          metadata: { path: ['projectId'], equals: PROJECT_ID },
        },
      });
    });

    it('uses the project creation time as the baseline when never written', async () => {
      prisma.projectAgentContext.findUnique.mockResolvedValue(null);

      await service.get(USER_ID, PROJECT_ID);

      expect(prisma.activityLog.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: { gt: new Date('2026-01-01T00:00:00Z') },
          }),
        }),
      );
    });

    it('rejects a non-member (VIEWER-and-below-of-nothing)', async () => {
      jest
        .spyOn(membership, 'assertProjectMember')
        .mockRejectedValue(new ForbiddenException('Not a member of this project'));

      await expect(service.get(USER_ID, PROJECT_ID)).rejects.toThrow(ForbiddenException);
    });
  });

  // ---- upsert() ---------------------------------------------------------------

  describe('upsert', () => {
    it('requires MEMBER+ — VIEWER is rejected', async () => {
      jest
        .spyOn(membership, 'assertProjectRole')
        .mockRejectedValue(new ForbiddenException('Requires MEMBER role in this project'));

      await expect(
        service.upsert(USER_ID, PROJECT_ID, { content: 'hello' }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.projectAgentContext.upsert).not.toHaveBeenCalled();
    });

    it('creates-or-replaces the document, stamping updatedById', async () => {
      jest
        .spyOn(membership, 'assertProjectRole')
        .mockResolvedValue({ workspaceId: 'ws-1' } as never);
      prisma.projectAgentContext.upsert.mockResolvedValue({
        content: 'Current goal: ship the MCP tool.',
        updatedAt: new Date('2026-07-03T00:00:00Z'),
        updatedBy: { id: USER_ID, name: 'Agent Bot' },
      });

      const result = await service.upsert(USER_ID, PROJECT_ID, {
        content: 'Current goal: ship the MCP tool.',
      });

      expect(prisma.projectAgentContext.upsert).toHaveBeenCalledWith({
        where: { projectId: PROJECT_ID },
        create: {
          projectId: PROJECT_ID,
          content: 'Current goal: ship the MCP tool.',
          updatedById: USER_ID,
        },
        update: { content: 'Current goal: ship the MCP tool.', updatedById: USER_ID },
        select: {
          content: true,
          updatedAt: true,
          updatedBy: { select: { id: true, name: true } },
        },
      });
      expect(result.content).toBe('Current goal: ship the MCP tool.');
      expect(result.updatedBy).toEqual({ id: USER_ID, name: 'Agent Bot' });
      // Freshly written: no changes can be newer than the write that just happened.
      expect(result.staleness.changesSinceUpdate).toBe(0);
    });

    it('emits the realtime update event scoped to the project', async () => {
      jest
        .spyOn(membership, 'assertProjectRole')
        .mockResolvedValue({ workspaceId: 'ws-1' } as never);
      prisma.projectAgentContext.upsert.mockResolvedValue({
        content: 'x',
        updatedAt: new Date(),
        updatedBy: null,
      });

      await service.upsert(USER_ID, PROJECT_ID, { content: 'x' });

      expect(mockRealtime.emitToProject).toHaveBeenCalledWith(
        PROJECT_ID,
        SocketEvents.ProjectAgentContextUpdated,
        { projectId: PROJECT_ID },
      );
    });
  });
});
