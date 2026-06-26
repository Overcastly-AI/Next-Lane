import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { NotificationType } from '@next-lane/shared';
import { NotificationsService } from './notifications.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RealtimeService } from '../realtime/realtime.service';

/**
 * DB-free unit tests for NotificationsService. Prisma + realtime are mocked.
 * Covers the notification-creation rules (self-suppression, assignment fan-out,
 * comment + mention fan-out with auto-watch) and owner-scoping on read.
 */

interface MockPrisma {
  notification: Record<
    'create' | 'findUnique' | 'update' | 'updateMany' | 'findMany' | 'count',
    jest.Mock
  >;
  watcher: Record<'upsert' | 'findMany', jest.Mock>;
  membership: { findMany: jest.Mock };
  user: { findMany: jest.Mock };
}

function makePrisma(): MockPrisma {
  return {
    notification: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    watcher: { upsert: jest.fn(), findMany: jest.fn() },
    membership: { findMany: jest.fn() },
    user: { findMany: jest.fn() },
  };
}

function actorRow(id: string, name = 'Actor') {
  return {
    id,
    name,
    email: `${id}@x.dev`,
    avatarColor: '#000',
    createdAt: new Date('2024-01-01T00:00:00Z'),
  };
}

const ISSUE = { id: 'iss-1', key: 'AB-1', projectId: 'proj-1' };

describe('NotificationsService', () => {
  let prisma: MockPrisma;
  let realtime: { emitToUser: jest.Mock };
  let service: NotificationsService;

  beforeEach(() => {
    prisma = makePrisma();
    realtime = { emitToUser: jest.fn() };
    service = new NotificationsService(
      prisma as unknown as PrismaService,
      realtime as unknown as RealtimeService,
    );
  });

  describe('notify', () => {
    it('creates a notification and emits to the recipient room', async () => {
      prisma.notification.create.mockResolvedValue({
        id: 'n1',
        type: NotificationType.ASSIGNED,
        issueId: ISSUE.id,
        issueKey: ISSUE.key,
        projectId: ISSUE.projectId,
        message: 'hi',
        read: false,
        createdAt: new Date('2024-01-02T00:00:00Z'),
        actor: actorRow('u-actor'),
      });

      const dto = await service.notify({
        userId: 'u-recipient',
        actorId: 'u-actor',
        type: NotificationType.ASSIGNED,
        issue: ISSUE,
        message: 'hi',
      });

      expect(dto).not.toBeNull();
      expect(dto?.id).toBe('n1');
      expect(dto?.actor?.id).toBe('u-actor');
      expect(prisma.notification.create).toHaveBeenCalledTimes(1);
      expect(realtime.emitToUser).toHaveBeenCalledWith(
        'u-recipient',
        'notification.created',
        expect.objectContaining({ id: 'n1' }),
      );
    });

    it('suppresses a self-notification (actor === recipient)', async () => {
      const dto = await service.notify({
        userId: 'u-same',
        actorId: 'u-same',
        type: NotificationType.COMMENTED,
        issue: ISSUE,
        message: 'self',
      });
      expect(dto).toBeNull();
      expect(prisma.notification.create).not.toHaveBeenCalled();
      expect(realtime.emitToUser).not.toHaveBeenCalled();
    });
  });

  describe('notifyAssigned', () => {
    it('auto-watches the assignee and creates an ASSIGNED notification', async () => {
      prisma.watcher.upsert.mockResolvedValue({});
      prisma.notification.create.mockResolvedValue({
        id: 'n2',
        type: NotificationType.ASSIGNED,
        issueId: ISSUE.id,
        issueKey: ISSUE.key,
        projectId: ISSUE.projectId,
        message: 'Boss assigned AB-1 to you',
        read: false,
        createdAt: new Date(),
        actor: actorRow('u-boss', 'Boss'),
      });

      await service.notifyAssigned({
        assigneeId: 'u-assignee',
        actorId: 'u-boss',
        actorName: 'Boss',
        issue: ISSUE,
      });

      expect(prisma.watcher.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { issueId_userId: { issueId: ISSUE.id, userId: 'u-assignee' } },
        }),
      );
      expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('notifyComment', () => {
    it('notifies mentioned users + watchers, excludes author, auto-watches', async () => {
      prisma.watcher.upsert.mockResolvedValue({});
      // Watchers on the issue: author (excluded), a plain watcher, and the
      // mentioned user (should get MENTIONED, not COMMENTED).
      prisma.watcher.findMany.mockResolvedValue([
        { userId: 'u-author' },
        { userId: 'u-watcher' },
        { userId: 'u-mentioned' },
      ]);
      prisma.notification.create.mockImplementation((args: {
        data: {
          userId: string;
          actorId: string;
          type: NotificationType;
          message: string;
        };
      }) => {
        const { data } = args;
        return Promise.resolve({
          id: `n-${data.userId}`,
          type: data.type,
          issueId: ISSUE.id,
          issueKey: ISSUE.key,
          projectId: ISSUE.projectId,
          message: data.message,
          read: false,
          createdAt: new Date(),
          actor: actorRow(data.actorId),
        });
      });

      await service.notifyComment({
        authorId: 'u-author',
        authorName: 'Author',
        issue: ISSUE,
        mentionedUserIds: ['u-mentioned'],
      });

      const calls = prisma.notification.create.mock.calls.map(
        (c: [{ data: { userId: string; type: NotificationType } }]) =>
          c[0].data,
      );
      const byUser = new Map(calls.map((c) => [c.userId, c.type]));
      // Author is never notified.
      expect(byUser.has('u-author')).toBe(false);
      // Mentioned user gets MENTIONED (precedence over COMMENTED).
      expect(byUser.get('u-mentioned')).toBe(NotificationType.MENTIONED);
      // Plain watcher gets COMMENTED.
      expect(byUser.get('u-watcher')).toBe(NotificationType.COMMENTED);
      // Commenter auto-watch + mentioned auto-watch.
      expect(prisma.watcher.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { issueId_userId: { issueId: ISSUE.id, userId: 'u-author' } },
        }),
      );
      expect(prisma.watcher.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            issueId_userId: { issueId: ISSUE.id, userId: 'u-mentioned' },
          },
        }),
      );
    });
  });

  describe('resolveMentions', () => {
    it('matches @email tokens scoped to the author co-members only', async () => {
      prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
      // Only the co-member resolves; the foreign email is filtered by the query.
      prisma.user.findMany.mockResolvedValue([{ id: 'u-comember' }]);

      const ids = await service.resolveMentions(
        'u-author',
        'hey @alice@acme.dev and @stranger@evil.dev please look',
      );

      expect(ids).toEqual(['u-comember']);
      // The DB query was scoped to the author's workspaces.
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            email: { in: ['alice@acme.dev', 'stranger@evil.dev'] },
            memberships: { some: { workspaceId: { in: ['ws-1'] } } },
          }),
        }),
      );
    });

    it('returns empty when there are no @email tokens', async () => {
      const ids = await service.resolveMentions('u-author', 'no mentions here');
      expect(ids).toEqual([]);
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('excludes the author even if they mention themselves', async () => {
      prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
      prisma.user.findMany.mockResolvedValue([
        { id: 'u-author' },
        { id: 'u-other' },
      ]);
      const ids = await service.resolveMentions(
        'u-author',
        '@me@self.dev @other@x.dev',
      );
      expect(ids).toEqual(['u-other']);
    });
  });

  describe('markRead', () => {
    it('rejects marking another user notification read', async () => {
      prisma.notification.findUnique.mockResolvedValue({ userId: 'someone' });
      await expect(service.markRead('me', 'n1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.notification.update).not.toHaveBeenCalled();
    });

    it('throws NotFound for a missing notification', async () => {
      prisma.notification.findUnique.mockResolvedValue(null);
      await expect(service.markRead('me', 'nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('marks the recipient own notification read', async () => {
      prisma.notification.findUnique.mockResolvedValue({ userId: 'me' });
      prisma.notification.update.mockResolvedValue({});
      const res = await service.markRead('me', 'n1');
      expect(res).toEqual({ id: 'n1' });
      expect(prisma.notification.update).toHaveBeenCalledWith({
        where: { id: 'n1' },
        data: { read: true },
      });
    });
  });

  describe('list / unreadCount', () => {
    it('returns items newest-first with an unread count', async () => {
      prisma.notification.findMany.mockResolvedValue([
        {
          id: 'n1',
          type: NotificationType.MENTIONED,
          issueId: ISSUE.id,
          issueKey: ISSUE.key,
          projectId: ISSUE.projectId,
          message: 'm',
          read: false,
          createdAt: new Date(),
          actor: actorRow('u-actor'),
        },
      ]);
      prisma.notification.count.mockResolvedValue(1);
      const res = await service.list('me');
      expect(res.unreadCount).toBe(1);
      expect(res.items).toHaveLength(1);
      expect(res.items[0].actor?.id).toBe('u-actor');
    });
  });
});
