import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Role } from '@next-lane/shared';
import { CommentsService } from './comments.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RealtimeService } from '../realtime/realtime.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { WebhooksService } from '../webhooks/webhooks.service';
import type { EventEmitter2 } from '@nestjs/event-emitter';

const noOpEventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;
const webhooksMock = { dispatch: jest.fn() } as unknown as WebhooksService;
const realtimeMock = { emitToProject: jest.fn() } as unknown as RealtimeService;

const PROJECT_ID = 'proj-1';
const WORKSPACE_ID = 'ws-1';
const ISSUE_ID = 'issue-1';
const AUTHOR_ID = 'user-author';
const ADMIN_ID = 'user-admin';
const OTHER_MEMBER_ID = 'user-other-member';
const COMMENT_ID = 'comment-1';

function makePrisma(opts: {
  callerRole?: Role;
  authorId?: string | null;
} = {}) {
  const callerRole = opts.callerRole ?? Role.MEMBER;
  const authorId = opts.authorId === undefined ? AUTHOR_ID : opts.authorId;

  const idemStore = new Map<string, { responseBody: unknown; createdAt: Date }>();

  const prisma = {
    issue: {
      findUnique: jest.fn().mockResolvedValue({
        id: ISSUE_ID,
        projectId: PROJECT_ID,
        number: 42,
        project: { key: 'NL' },
      }),
    },
    comment: {
      findUnique: jest.fn().mockResolvedValue({
        id: COMMENT_ID,
        authorId,
        issue: { projectId: PROJECT_ID },
      }),
      create: jest.fn().mockImplementation(({ data }: { data: { body: string; authorId: string; issueId: string } }) =>
        Promise.resolve({
          id: 'new-comment',
          body: data.body,
          issueId: data.issueId,
          authorId: data.authorId,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          author: { id: data.authorId, email: 'a@b.com', name: 'Actor', avatarColor: '#fff', emailNotifications: true, createdAt: new Date() },
        }),
      ),
      update: jest.fn().mockResolvedValue({
        id: COMMENT_ID,
        body: 'Edited',
        issueId: ISSUE_ID,
        authorId,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
        author: { id: authorId, email: 'a@b.com', name: 'Author', avatarColor: '#fff', emailNotifications: true, createdAt: new Date() },
      }),
      delete: jest.fn().mockResolvedValue({}),
    },
    project: {
      findUnique: jest.fn().mockResolvedValue({ id: PROJECT_ID, workspaceId: WORKSPACE_ID }),
    },
    membership: {
      findUnique: jest.fn().mockResolvedValue({ role: callerRole }),
    },
    projectMembership: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    // Claim-first mock: create() enforces the unique constraint with a real
    // P2002, mirroring Postgres (see common/idempotency.util.spec.ts).
    idempotencyRecord: {
      create: jest.fn((args: { data: { key: string; userId: string; endpoint: string; requestHash: string } }) => {
        const k = `${args.data.key}|${args.data.userId}|${args.data.endpoint}`;
        if (idemStore.has(k)) {
          return Promise.reject(
            new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
              code: 'P2002',
              clientVersion: 'test',
            }),
          );
        }
        const row = { id: 'row-1', requestHash: args.data.requestHash, responseBody: null as unknown, createdAt: new Date() };
        idemStore.set(k, row);
        return Promise.resolve(row);
      }),
      findUnique: jest.fn((args: { where: { key_userId_endpoint: { key: string; userId: string; endpoint: string } } }) =>
        Promise.resolve(
          idemStore.get(
            `${args.where.key_userId_endpoint.key}|${args.where.key_userId_endpoint.userId}|${args.where.key_userId_endpoint.endpoint}`,
          ) ?? null,
        ),
      ),
      update: jest.fn((args: {
        where: { key_userId_endpoint: { key: string; userId: string; endpoint: string } };
        data: { responseBody: unknown };
      }) => {
        const k = `${args.where.key_userId_endpoint.key}|${args.where.key_userId_endpoint.userId}|${args.where.key_userId_endpoint.endpoint}`;
        const row = idemStore.get(k)!;
        row.responseBody = args.data.responseBody;
        return Promise.resolve(row);
      }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  return prisma;
}

function makeService(prisma: ReturnType<typeof makePrisma>) {
  return new CommentsService(
    prisma as unknown as PrismaService,
    realtimeMock,
    {
      resolveMentions: jest.fn().mockResolvedValue([]),
      notifyComment: jest.fn().mockResolvedValue(undefined),
    } as unknown as NotificationsService,
    webhooksMock,
    noOpEventEmitter,
  );
}

describe('CommentsService.create — idempotencyKey (criterion 2)', () => {
  it('creates a new comment when no idempotencyKey is passed', async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);

    await service.create(AUTHOR_ID, ISSUE_ID, { body: 'First' });
    await service.create(AUTHOR_ID, ISSUE_ID, { body: 'Second' });

    expect(prisma.comment.create).toHaveBeenCalledTimes(2);
  });

  it('replays the SAME comment on a retried create with the same idempotencyKey', async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);

    const first = await service.create(AUTHOR_ID, ISSUE_ID, {
      body: 'Retried comment',
      idempotencyKey: 'retry-1',
    });
    const second = await service.create(AUTHOR_ID, ISSUE_ID, {
      body: 'Retried comment',
      idempotencyKey: 'retry-1',
    });

    expect(second.id).toBe(first.id);
    expect(prisma.comment.create).toHaveBeenCalledTimes(1);
  });
});

describe('CommentsService.update/remove — author-or-effective-admin gating (criterion 5)', () => {
  it('allows the author to edit their own comment', async () => {
    const prisma = makePrisma({ callerRole: Role.MEMBER, authorId: AUTHOR_ID });
    const service = makeService(prisma);

    await expect(
      service.update(AUTHOR_ID, COMMENT_ID, { body: 'Edited by author' }),
    ).resolves.toBeDefined();
  });

  it('allows a project ADMIN to edit a comment they did not author', async () => {
    const prisma = makePrisma({ callerRole: Role.ADMIN, authorId: AUTHOR_ID });
    const service = makeService(prisma);

    await expect(
      service.update(ADMIN_ID, COMMENT_ID, { body: 'Edited by admin' }),
    ).resolves.toBeDefined();
  });

  it('rejects a non-author, non-admin project member (ForbiddenException)', async () => {
    const prisma = makePrisma({ callerRole: Role.MEMBER, authorId: AUTHOR_ID });
    const service = makeService(prisma);

    await expect(
      service.update(OTHER_MEMBER_ID, COMMENT_ID, { body: 'Should not work' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a caller who is not a member of the comment’s project', async () => {
    const prisma = makePrisma({ authorId: AUTHOR_ID });
    prisma.membership.findUnique.mockResolvedValue(null);
    const service = makeService(prisma);

    await expect(
      service.update('user-foreign', COMMENT_ID, { body: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('404s when the comment does not exist', async () => {
    const prisma = makePrisma();
    prisma.comment.findUnique.mockResolvedValue(null);
    const service = makeService(prisma);

    await expect(
      service.update(AUTHOR_ID, 'missing-comment', { body: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('allows the author to delete their own comment', async () => {
    const prisma = makePrisma({ callerRole: Role.MEMBER, authorId: AUTHOR_ID });
    const service = makeService(prisma);

    await expect(service.remove(AUTHOR_ID, COMMENT_ID)).resolves.toEqual({ id: COMMENT_ID });
    expect(prisma.comment.delete).toHaveBeenCalledWith({ where: { id: COMMENT_ID } });
  });

  it('allows a project ADMIN to delete a comment they did not author', async () => {
    const prisma = makePrisma({ callerRole: Role.ADMIN, authorId: AUTHOR_ID });
    const service = makeService(prisma);

    await expect(service.remove(ADMIN_ID, COMMENT_ID)).resolves.toEqual({ id: COMMENT_ID });
  });

  it('rejects a non-author, non-admin project member trying to delete (ForbiddenException)', async () => {
    const prisma = makePrisma({ callerRole: Role.MEMBER, authorId: AUTHOR_ID });
    const service = makeService(prisma);

    await expect(service.remove(OTHER_MEMBER_ID, COMMENT_ID)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.comment.delete).not.toHaveBeenCalled();
  });
});
