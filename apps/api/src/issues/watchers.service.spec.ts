import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@next-lane/shared';
import { WatchersService } from './watchers.service';
import type { PrismaService } from '../prisma/prisma.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

const ISSUE_ID = 'issue-1';
const PROJECT_ID = 'proj-1';
const WORKSPACE_ID = 'ws-1';
const USER_ID = 'user-1';
const NON_MEMBER_ID = 'user-outsider';

/**
 * Build a minimal Prisma mock that covers the paths WatchersService exercises:
 *   - issue.findUnique  (resolve issue → projectId)
 *   - project.findUnique (assertProjectMember step 1)
 *   - membership.findUnique (assertProjectMember step 2)
 *   - watcher.upsert / watcher.deleteMany / watcher.count / watcher.findUnique
 */
function makePrisma(overrides: {
  issueRow?: object | null;
  projectRow?: object | null;
  membershipRow?: object | null;
  watcherCount?: number;
  watcherRow?: object | null;
} = {}) {
  const {
    issueRow = { projectId: PROJECT_ID },
    projectRow = { id: PROJECT_ID, workspaceId: WORKSPACE_ID, workspace: { id: WORKSPACE_ID } },
    membershipRow = { role: Role.VIEWER },
    watcherCount = 0,
    watcherRow = null,
  } = overrides;

  return {
    issue: {
      findUnique: jest.fn().mockResolvedValue(issueRow),
    },
    project: {
      findUnique: jest.fn().mockResolvedValue(projectRow),
    },
    membership: {
      findUnique: jest.fn().mockResolvedValue(membershipRow),
    },
    watcher: {
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(watcherCount),
      findUnique: jest.fn().mockResolvedValue(watcherRow),
    },
  };
}

function makeService(prisma: ReturnType<typeof makePrisma>): WatchersService {
  return new WatchersService(prisma as unknown as PrismaService);
}

// ── watch ─────────────────────────────────────────────────────────────────────

describe('WatchersService.watch', () => {
  it('upserts a Watcher row and returns { watching: true }', async () => {
    const prisma = makePrisma();
    const svc = makeService(prisma);

    const result = await svc.watch(ISSUE_ID, USER_ID);

    expect(result).toEqual({ watching: true });
    expect(prisma.watcher.upsert).toHaveBeenCalledWith({
      where: { issueId_userId: { issueId: ISSUE_ID, userId: USER_ID } },
      create: { issueId: ISSUE_ID, userId: USER_ID },
      update: {},
    });
  });

  it('is idempotent: returns { watching: true } when already watching', async () => {
    // upsert is inherently idempotent; we just verify it does not throw
    const prisma = makePrisma({
      watcherRow: { issueId: ISSUE_ID, userId: USER_ID },
    });
    const svc = makeService(prisma);

    const first = await svc.watch(ISSUE_ID, USER_ID);
    const second = await svc.watch(ISSUE_ID, USER_ID);

    expect(first).toEqual({ watching: true });
    expect(second).toEqual({ watching: true });
    expect(prisma.watcher.upsert).toHaveBeenCalledTimes(2);
  });

  it('throws NotFoundException when the issue does not exist', async () => {
    const prisma = makePrisma({ issueRow: null });
    const svc = makeService(prisma);

    await expect(svc.watch(ISSUE_ID, USER_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.watcher.upsert).not.toHaveBeenCalled();
  });

  it('throws ForbiddenException when the caller is not a project member', async () => {
    const prisma = makePrisma({ membershipRow: null });
    const svc = makeService(prisma);

    await expect(svc.watch(ISSUE_ID, NON_MEMBER_ID)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.watcher.upsert).not.toHaveBeenCalled();
  });

  it('allows a VIEWER role member to watch', async () => {
    const prisma = makePrisma({ membershipRow: { role: Role.VIEWER } });
    const svc = makeService(prisma);

    await expect(svc.watch(ISSUE_ID, USER_ID)).resolves.toEqual({
      watching: true,
    });
  });

  it('allows a MEMBER role member to watch', async () => {
    const prisma = makePrisma({ membershipRow: { role: Role.MEMBER } });
    const svc = makeService(prisma);

    await expect(svc.watch(ISSUE_ID, USER_ID)).resolves.toEqual({
      watching: true,
    });
  });

  it('allows an ADMIN role member to watch', async () => {
    const prisma = makePrisma({ membershipRow: { role: Role.ADMIN } });
    const svc = makeService(prisma);

    await expect(svc.watch(ISSUE_ID, USER_ID)).resolves.toEqual({
      watching: true,
    });
  });
});

// ── unwatch ───────────────────────────────────────────────────────────────────

describe('WatchersService.unwatch', () => {
  it('deletes the Watcher row and returns { watching: false }', async () => {
    const prisma = makePrisma({ watcherRow: { issueId: ISSUE_ID, userId: USER_ID } });
    const svc = makeService(prisma);

    const result = await svc.unwatch(ISSUE_ID, USER_ID);

    expect(result).toEqual({ watching: false });
    expect(prisma.watcher.deleteMany).toHaveBeenCalledWith({
      where: { issueId: ISSUE_ID, userId: USER_ID },
    });
  });

  it('is idempotent: returns { watching: false } when not watching', async () => {
    // deleteMany returns { count: 0 } when nothing to delete — no error
    const prisma = makePrisma({ watcherRow: null });
    prisma.watcher.deleteMany.mockResolvedValue({ count: 0 });
    const svc = makeService(prisma);

    const result = await svc.unwatch(ISSUE_ID, USER_ID);

    expect(result).toEqual({ watching: false });
    expect(prisma.watcher.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('throws NotFoundException when the issue does not exist', async () => {
    const prisma = makePrisma({ issueRow: null });
    const svc = makeService(prisma);

    await expect(svc.unwatch(ISSUE_ID, USER_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.watcher.deleteMany).not.toHaveBeenCalled();
  });

  it('throws ForbiddenException when the caller is not a project member', async () => {
    const prisma = makePrisma({ membershipRow: null });
    const svc = makeService(prisma);

    await expect(svc.unwatch(ISSUE_ID, NON_MEMBER_ID)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.watcher.deleteMany).not.toHaveBeenCalled();
  });
});

// ── getWatcherInfo ────────────────────────────────────────────────────────────

describe('WatchersService.getWatcherInfo', () => {
  it('returns { count, isWatching: true } when caller watches the issue', async () => {
    const prisma = makePrisma({
      watcherCount: 3,
      watcherRow: { issueId: ISSUE_ID, userId: USER_ID },
    });
    const svc = makeService(prisma);

    const result = await svc.getWatcherInfo(ISSUE_ID, USER_ID);

    expect(result).toEqual({ count: 3, isWatching: true });
  });

  it('returns { count, isWatching: false } when caller is not watching', async () => {
    const prisma = makePrisma({
      watcherCount: 5,
      watcherRow: null,
    });
    const svc = makeService(prisma);

    const result = await svc.getWatcherInfo(ISSUE_ID, USER_ID);

    expect(result).toEqual({ count: 5, isWatching: false });
  });

  it('returns { count: 0, isWatching: false } for an unwatched issue', async () => {
    const prisma = makePrisma({ watcherCount: 0, watcherRow: null });
    const svc = makeService(prisma);

    const result = await svc.getWatcherInfo(ISSUE_ID, USER_ID);

    expect(result).toEqual({ count: 0, isWatching: false });
  });

  it('reflects count update after a watch call', async () => {
    // Simulate: before watch → count 2, not watching.  After watch → count 3, watching.
    const prismaBefore = makePrisma({ watcherCount: 2, watcherRow: null });
    const svcBefore = makeService(prismaBefore);
    expect(await svcBefore.getWatcherInfo(ISSUE_ID, USER_ID)).toEqual({
      count: 2,
      isWatching: false,
    });

    const prismaAfter = makePrisma({
      watcherCount: 3,
      watcherRow: { issueId: ISSUE_ID, userId: USER_ID },
    });
    const svcAfter = makeService(prismaAfter);
    expect(await svcAfter.getWatcherInfo(ISSUE_ID, USER_ID)).toEqual({
      count: 3,
      isWatching: true,
    });
  });

  it('throws NotFoundException when the issue does not exist', async () => {
    const prisma = makePrisma({ issueRow: null });
    const svc = makeService(prisma);

    await expect(svc.getWatcherInfo(ISSUE_ID, USER_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.watcher.count).not.toHaveBeenCalled();
    expect(prisma.watcher.findUnique).not.toHaveBeenCalled();
  });

  it('throws ForbiddenException when the caller is not a project member', async () => {
    const prisma = makePrisma({ membershipRow: null });
    const svc = makeService(prisma);

    await expect(
      svc.getWatcherInfo(ISSUE_ID, NON_MEMBER_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.watcher.count).not.toHaveBeenCalled();
  });

  it('issues count and findUnique queries in parallel (both called once)', async () => {
    const prisma = makePrisma({ watcherCount: 1, watcherRow: null });
    const svc = makeService(prisma);

    await svc.getWatcherInfo(ISSUE_ID, USER_ID);

    expect(prisma.watcher.count).toHaveBeenCalledTimes(1);
    expect(prisma.watcher.findUnique).toHaveBeenCalledTimes(1);
  });
});
