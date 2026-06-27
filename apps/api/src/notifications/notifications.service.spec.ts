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
    'create' | 'findUnique' | 'update' | 'updateMany' | 'findMany' | 'count' | 'createMany',
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
      createMany: jest.fn(),
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
    it('notifies mentioned users + watchers via createMany, excludes author, auto-watches', async () => {
      prisma.watcher.upsert.mockResolvedValue({});
      // Watchers on the issue (fetched after author + mention watches are recorded):
      // author (excluded), a plain watcher, and the mentioned user (gets MENTIONED).
      prisma.watcher.findMany.mockResolvedValue([
        { userId: 'u-author' },
        { userId: 'u-watcher' },
        { userId: 'u-mentioned' },
      ]);

      // createMany is called once for MENTIONED, once for COMMENTED.
      prisma.notification.createMany.mockResolvedValue({ count: 1 });

      // findMany is called to fetch inserted rows for realtime emit.
      prisma.notification.findMany
        .mockResolvedValueOnce([
          {
            id: 'n-mentioned',
            userId: 'u-mentioned',
            actorId: 'u-author',
            type: NotificationType.MENTIONED,
            issueId: ISSUE.id,
            issueKey: ISSUE.key,
            projectId: ISSUE.projectId,
            message: 'Author mentioned you on AB-1',
            read: false,
            createdAt: new Date(),
            actor: actorRow('u-author'),
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'n-watcher',
            userId: 'u-watcher',
            actorId: 'u-author',
            type: NotificationType.COMMENTED,
            issueId: ISSUE.id,
            issueKey: ISSUE.key,
            projectId: ISSUE.projectId,
            message: 'Author commented on AB-1',
            read: false,
            createdAt: new Date(),
            actor: actorRow('u-author'),
          },
        ]);

      await service.notifyComment({
        authorId: 'u-author',
        authorName: 'Author',
        issue: ISSUE,
        mentionedUserIds: ['u-mentioned'],
      });

      // Must NOT use notification.create (serial O(N) — the old path).
      expect(prisma.notification.create).not.toHaveBeenCalled();

      // Two batched createMany calls: one for MENTIONED, one for COMMENTED.
      expect(prisma.notification.createMany).toHaveBeenCalledTimes(2);

      const [mentionCall, commentCall] = prisma.notification.createMany.mock.calls as Array<
        [{ data: Array<{ userId: string; type: NotificationType }> }]
      >;

      // MENTIONED batch: only u-mentioned (author excluded).
      expect(mentionCall[0].data).toHaveLength(1);
      expect(mentionCall[0].data[0].userId).toBe('u-mentioned');
      expect(mentionCall[0].data[0].type).toBe(NotificationType.MENTIONED);

      // COMMENTED batch: only u-watcher (author + mentioned excluded).
      expect(commentCall[0].data).toHaveLength(1);
      expect(commentCall[0].data[0].userId).toBe('u-watcher');
      expect(commentCall[0].data[0].type).toBe(NotificationType.COMMENTED);

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

      // Realtime emitted to both recipients.
      expect(realtime.emitToUser).toHaveBeenCalledWith(
        'u-mentioned',
        'notification.created',
        expect.objectContaining({ type: NotificationType.MENTIONED }),
      );
      expect(realtime.emitToUser).toHaveBeenCalledWith(
        'u-watcher',
        'notification.created',
        expect.objectContaining({ type: NotificationType.COMMENTED }),
      );
    });

    it('author is never notified even if listed as a watcher', async () => {
      prisma.watcher.upsert.mockResolvedValue({});
      prisma.watcher.findMany.mockResolvedValue([
        { userId: 'u-author' }, // only watcher is the author — nobody to notify
      ]);
      prisma.notification.createMany.mockResolvedValue({ count: 0 });
      prisma.notification.findMany.mockResolvedValue([]);

      await service.notifyComment({
        authorId: 'u-author',
        authorName: 'Author',
        issue: ISSUE,
        mentionedUserIds: [],
      });

      // No MENTIONED batch (no mentions). No COMMENTED batch (only watcher is the author).
      expect(prisma.notification.createMany).not.toHaveBeenCalled();
      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('uses a single createMany per notification type (batched, not serial)', async () => {
      prisma.watcher.upsert.mockResolvedValue({});
      // Three plain watchers + author.
      prisma.watcher.findMany.mockResolvedValue([
        { userId: 'u-author' },
        { userId: 'w1' },
        { userId: 'w2' },
        { userId: 'w3' },
      ]);
      prisma.notification.createMany.mockResolvedValue({ count: 3 });
      prisma.notification.findMany.mockResolvedValue([
        {
          id: 'n1', userId: 'w1', actorId: 'u-author',
          type: NotificationType.COMMENTED, issueId: ISSUE.id,
          issueKey: ISSUE.key, projectId: ISSUE.projectId,
          message: 'msg', read: false, createdAt: new Date(),
          actor: actorRow('u-author'),
        },
        {
          id: 'n2', userId: 'w2', actorId: 'u-author',
          type: NotificationType.COMMENTED, issueId: ISSUE.id,
          issueKey: ISSUE.key, projectId: ISSUE.projectId,
          message: 'msg', read: false, createdAt: new Date(),
          actor: actorRow('u-author'),
        },
        {
          id: 'n3', userId: 'w3', actorId: 'u-author',
          type: NotificationType.COMMENTED, issueId: ISSUE.id,
          issueKey: ISSUE.key, projectId: ISSUE.projectId,
          message: 'msg', read: false, createdAt: new Date(),
          actor: actorRow('u-author'),
        },
      ]);

      await service.notifyComment({
        authorId: 'u-author',
        authorName: 'Author',
        issue: ISSUE,
        mentionedUserIds: [],
      });

      // Exactly ONE createMany call (for COMMENTED), not 3 serial create calls.
      expect(prisma.notification.createMany).toHaveBeenCalledTimes(1);
      expect(prisma.notification.create).not.toHaveBeenCalled();

      const [call] = prisma.notification.createMany.mock.calls as Array<
        [{ data: Array<{ userId: string }> }]
      >;
      expect(call[0].data).toHaveLength(3);
      expect(call[0].data.map((d) => d.userId).sort()).toEqual(['w1', 'w2', 'w3']);
    });
  });

  describe('notifyWatchersUpdated', () => {
    const ISSUE_WITH_TITLE = {
      id: ISSUE.id,
      key: ISSUE.key,
      projectId: ISSUE.projectId,
      title: 'Fix the thing',
    };

    function makeNotificationRow(userId: string, id: string) {
      return {
        id,
        userId,
        actorId: 'u-actor',
        type: NotificationType.WATCHED_UPDATED,
        issueId: ISSUE.id,
        issueKey: ISSUE.key,
        projectId: ISSUE.projectId,
        message: 'Actor updated AB-1 (status)',
        read: false,
        createdAt: new Date(),
        actor: actorRow('u-actor', 'Actor'),
      };
    }

    it('uses createMany (batched insert) not N sequential creates', async () => {
      // Two watchers — actor is excluded.
      prisma.watcher.findMany.mockResolvedValue([
        { userId: 'u-watcher-1' },
        { userId: 'u-watcher-2' },
        { userId: 'u-actor' }, // actor, must be excluded
      ]);
      prisma.notification.createMany.mockResolvedValue({ count: 2 });
      prisma.notification.findMany.mockResolvedValue([
        makeNotificationRow('u-watcher-1', 'n-w1'),
        makeNotificationRow('u-watcher-2', 'n-w2'),
      ]);

      await service.notifyWatchersUpdated({
        actorId: 'u-actor',
        actorName: 'Actor',
        issue: ISSUE_WITH_TITLE,
        changedFields: ['status'],
      });

      // Must use createMany (one DB round-trip), not notification.create.
      expect(prisma.notification.createMany).toHaveBeenCalledTimes(1);
      expect(prisma.notification.create).not.toHaveBeenCalled();

      const createManyArgs = prisma.notification.createMany.mock.calls[0][0];
      // Both non-actor watchers are included.
      expect(createManyArgs.data).toHaveLength(2);
      expect(createManyArgs.data.map((d: { userId: string }) => d.userId)).toEqual(
        expect.arrayContaining(['u-watcher-1', 'u-watcher-2']),
      );
      expect(createManyArgs.data.every(
        (d: { type: string }) => d.type === NotificationType.WATCHED_UPDATED,
      )).toBe(true);
    });

    it('emits a realtime event per recipient via their user:<id> room', async () => {
      prisma.watcher.findMany.mockResolvedValue([
        { userId: 'u-watcher-1' },
        { userId: 'u-watcher-2' },
      ]);
      prisma.notification.createMany.mockResolvedValue({ count: 2 });
      prisma.notification.findMany.mockResolvedValue([
        makeNotificationRow('u-watcher-1', 'n-w1'),
        makeNotificationRow('u-watcher-2', 'n-w2'),
      ]);

      await service.notifyWatchersUpdated({
        actorId: 'u-actor',
        actorName: 'Actor',
        issue: ISSUE_WITH_TITLE,
        changedFields: ['status'],
      });

      expect(realtime.emitToUser).toHaveBeenCalledTimes(2);
      expect(realtime.emitToUser).toHaveBeenCalledWith(
        'u-watcher-1',
        'notification.created',
        expect.objectContaining({ type: NotificationType.WATCHED_UPDATED }),
      );
      expect(realtime.emitToUser).toHaveBeenCalledWith(
        'u-watcher-2',
        'notification.created',
        expect.objectContaining({ type: NotificationType.WATCHED_UPDATED }),
      );
    });

    it('never notifies the actor (excluded from recipients)', async () => {
      prisma.watcher.findMany.mockResolvedValue([
        { userId: 'u-actor' }, // actor only
      ]);

      await service.notifyWatchersUpdated({
        actorId: 'u-actor',
        actorName: 'Actor',
        issue: ISSUE_WITH_TITLE,
        changedFields: ['priority'],
      });

      // No inserts, no realtime — actor-only watcher list is a no-op.
      expect(prisma.notification.createMany).not.toHaveBeenCalled();
      expect(realtime.emitToUser).not.toHaveBeenCalled();
    });

    it('is a no-op when there are no watchers', async () => {
      prisma.watcher.findMany.mockResolvedValue([]);

      await service.notifyWatchersUpdated({
        actorId: 'u-actor',
        actorName: 'Actor',
        issue: ISSUE_WITH_TITLE,
        changedFields: ['status'],
      });

      expect(prisma.notification.createMany).not.toHaveBeenCalled();
      expect(realtime.emitToUser).not.toHaveBeenCalled();
    });

    it('formats single-field message correctly', async () => {
      prisma.watcher.findMany.mockResolvedValue([{ userId: 'u-w1' }]);
      prisma.notification.createMany.mockResolvedValue({ count: 1 });
      prisma.notification.findMany.mockResolvedValue([
        makeNotificationRow('u-w1', 'n1'),
      ]);

      await service.notifyWatchersUpdated({
        actorId: 'u-actor',
        actorName: 'Alice',
        issue: ISSUE_WITH_TITLE,
        changedFields: ['status'],
      });

      const data = prisma.notification.createMany.mock.calls[0][0].data[0];
      expect(data.message).toBe('Alice updated AB-1 (status)');
    });

    it('formats multi-field message correctly', async () => {
      prisma.watcher.findMany.mockResolvedValue([{ userId: 'u-w1' }]);
      prisma.notification.createMany.mockResolvedValue({ count: 1 });
      prisma.notification.findMany.mockResolvedValue([
        makeNotificationRow('u-w1', 'n1'),
      ]);

      await service.notifyWatchersUpdated({
        actorId: 'u-actor',
        actorName: 'Alice',
        issue: ISSUE_WITH_TITLE,
        changedFields: ['status', 'priority'],
      });

      const data = prisma.notification.createMany.mock.calls[0][0].data[0];
      expect(data.message).toBe('Alice updated AB-1 (status and priority)');
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
