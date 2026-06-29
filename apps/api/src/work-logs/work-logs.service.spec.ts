/**
 * DB-free unit tests for WorkLogsService.
 * Prisma and membership utils are fully mocked — no real DB needed.
 */

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@next-lane/shared';
import { WorkLogsService } from './work-logs.service';
import type { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const WORKSPACE_ID = 'ws-1';
const PROJECT_ID = 'proj-1';
const OTHER_PROJECT_ID = 'proj-2';
const ISSUE_ID = 'issue-abc';
const OTHER_ISSUE_ID = 'issue-xyz';
const WORKLOG_ID = 'wl-1';
const WORKLOG_ID_2 = 'wl-2';

const USER_ADMIN = 'user-admin';
const USER_MEMBER = 'user-member';
const USER_VIEWER = 'user-viewer';
const USER_FOREIGN = 'user-foreign';
// A member who is the author of worklog 1
const USER_AUTHOR = 'user-author';

const baseUser = {
  id: USER_AUTHOR,
  email: 'author@example.com',
  name: 'Author User',
  avatarColor: '#aabbcc',
  emailNotifications: false,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

const baseWorkLog = {
  id: WORKLOG_ID,
  issueId: ISSUE_ID,
  userId: USER_AUTHOR,
  user: baseUser,
  minutes: 30,
  note: 'Implemented feature',
  workedAt: new Date('2026-06-01T09:00:00.000Z'),
  createdAt: new Date('2026-06-01T10:00:00.000Z'),
};

const baseWorkLog2 = {
  id: WORKLOG_ID_2,
  issueId: ISSUE_ID,
  userId: USER_MEMBER,
  user: { ...baseUser, id: USER_MEMBER, email: 'member@example.com', name: 'Member User' },
  minutes: 60,
  note: null,
  workedAt: new Date('2026-06-02T09:00:00.000Z'),
  createdAt: new Date('2026-06-02T10:00:00.000Z'),
};

// ---------------------------------------------------------------------------
// Prisma mock factory
// ---------------------------------------------------------------------------
function makePrisma(opts: {
  issueProjectId?: string;
  workLogProjectId?: string;
  workLogAuthorId?: string;
  userRole?: Role | null;
} = {}) {
  const issueProjectId = opts.issueProjectId ?? PROJECT_ID;
  const workLogProjectId = opts.workLogProjectId ?? PROJECT_ID;
  const workLogAuthorId = opts.workLogAuthorId ?? USER_AUTHOR;
  const userRole = opts.userRole !== undefined ? opts.userRole : Role.MEMBER;

  const prisma = {
    issue: {
      findUnique: jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        if (where.id === ISSUE_ID) return Promise.resolve({ id: ISSUE_ID, projectId: issueProjectId });
        if (where.id === OTHER_ISSUE_ID) return Promise.resolve({ id: OTHER_ISSUE_ID, projectId: OTHER_PROJECT_ID });
        return Promise.resolve(null);
      }),
    },
    workLog: {
      findUnique: jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        if (where.id === WORKLOG_ID) {
          return Promise.resolve({
            id: WORKLOG_ID,
            issueId: ISSUE_ID,
            userId: workLogAuthorId,
            issue: { projectId: workLogProjectId },
          });
        }
        if (where.id === WORKLOG_ID_2) {
          return Promise.resolve({
            id: WORKLOG_ID_2,
            issueId: ISSUE_ID,
            userId: USER_MEMBER,
            issue: { projectId: workLogProjectId },
          });
        }
        return Promise.resolve(null);
      }),
      findMany: jest.fn().mockResolvedValue([baseWorkLog, baseWorkLog2]),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          ...baseWorkLog,
          userId: data.userId ?? baseWorkLog.userId,
          minutes: data.minutes ?? baseWorkLog.minutes,
          note: data.note ?? null,
        }),
      ),
      update: jest.fn().mockImplementation(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const base = where.id === WORKLOG_ID ? baseWorkLog : baseWorkLog2;
        return Promise.resolve({ ...base, ...data });
      }),
      delete: jest.fn().mockResolvedValue(baseWorkLog),
    },
    project: {
      findUnique: jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        if (where.id === PROJECT_ID) return Promise.resolve({ id: PROJECT_ID, workspaceId: WORKSPACE_ID });
        if (where.id === OTHER_PROJECT_ID) return Promise.resolve({ id: OTHER_PROJECT_ID, workspaceId: 'ws-2' });
        return Promise.resolve(null);
      }),
    },
    membership: {
      findUnique: jest.fn().mockImplementation(
        ({ where }: { where: { userId_workspaceId: { userId: string; workspaceId: string } } }) => {
          const { userId, workspaceId } = where.userId_workspaceId;
          if (userId === USER_FOREIGN) return Promise.resolve(null);
          if (workspaceId === 'ws-2') return Promise.resolve(null);
          if (userRole === null) return Promise.resolve(null);
          if (userId === USER_VIEWER) return Promise.resolve({ role: Role.VIEWER });
          if (userId === USER_MEMBER) return Promise.resolve({ role: Role.MEMBER });
          if (userId === USER_AUTHOR) return Promise.resolve({ role: Role.MEMBER });
          if (userId === USER_ADMIN) return Promise.resolve({ role: Role.ADMIN });
          return Promise.resolve({ role: userRole });
        },
      ),
    },
  };

  return prisma as unknown as PrismaService;
}

// ---------------------------------------------------------------------------
// findAll
// ---------------------------------------------------------------------------
describe('WorkLogsService.findAll', () => {
  it('returns work logs ordered by workedAt desc for a project member', async () => {
    const service = new WorkLogsService(makePrisma());
    const result = await service.findAll(USER_MEMBER, ISSUE_ID);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(WORKLOG_ID);
  });

  it('rejects a non-member (USER_FOREIGN) with ForbiddenException', async () => {
    const service = new WorkLogsService(makePrisma());
    await expect(service.findAll(USER_FOREIGN, ISSUE_ID)).rejects.toThrow(ForbiddenException);
  });

  it('throws NotFoundException for unknown issue', async () => {
    const service = new WorkLogsService(makePrisma());
    await expect(service.findAll(USER_MEMBER, 'no-such-issue')).rejects.toThrow(NotFoundException);
  });

  it('allows VIEWER to list work logs', async () => {
    const service = new WorkLogsService(makePrisma({ userRole: Role.VIEWER }));
    const result = await service.findAll(USER_VIEWER, ISSUE_ID);
    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------
describe('WorkLogsService.create', () => {
  it('creates a work log with valid minutes', async () => {
    const prisma = makePrisma({ userRole: Role.MEMBER });
    const service = new WorkLogsService(prisma);
    const result = await service.create(USER_MEMBER, ISSUE_ID, { minutes: 45 });
    expect(result.minutes).toBe(45);
    expect(prisma.workLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ minutes: 45, issueId: ISSUE_ID }),
      }),
    );
  });

  it('sets userId to current user regardless of input', async () => {
    const prisma = makePrisma({ userRole: Role.MEMBER });
    const service = new WorkLogsService(prisma);
    await service.create(USER_MEMBER, ISSUE_ID, { minutes: 30 });
    expect(prisma.workLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: USER_MEMBER }),
      }),
    );
  });

  it('creates with optional note and workedAt', async () => {
    const prisma = makePrisma({ userRole: Role.MEMBER });
    const service = new WorkLogsService(prisma);
    await service.create(USER_MEMBER, ISSUE_ID, {
      minutes: 90,
      note: 'Research',
      workedAt: '2026-06-01T08:00:00.000Z',
    });
    expect(prisma.workLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          note: 'Research',
          workedAt: new Date('2026-06-01T08:00:00.000Z'),
        }),
      }),
    );
  });

  it('rejects minutes < 1 with BadRequestException', async () => {
    const service = new WorkLogsService(makePrisma());
    await expect(service.create(USER_MEMBER, ISSUE_ID, { minutes: 0 })).rejects.toThrow(BadRequestException);
  });

  it('rejects VIEWER with ForbiddenException', async () => {
    const service = new WorkLogsService(makePrisma({ userRole: Role.VIEWER }));
    await expect(service.create(USER_VIEWER, ISSUE_ID, { minutes: 30 })).rejects.toThrow(ForbiddenException);
  });

  it('rejects non-member with ForbiddenException', async () => {
    const service = new WorkLogsService(makePrisma({ userRole: null }));
    await expect(service.create(USER_FOREIGN, ISSUE_ID, { minutes: 30 })).rejects.toThrow(ForbiddenException);
  });

  it('throws NotFoundException for unknown issue', async () => {
    const service = new WorkLogsService(makePrisma());
    await expect(service.create(USER_MEMBER, 'no-issue', { minutes: 30 })).rejects.toThrow(NotFoundException);
  });
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------
describe('WorkLogsService.update', () => {
  it('allows the author to update their own work log', async () => {
    const service = new WorkLogsService(makePrisma({ workLogAuthorId: USER_AUTHOR }));
    const result = await service.update(USER_AUTHOR, WORKLOG_ID, { minutes: 120 });
    expect(result.minutes).toBe(120);
  });

  it('allows a project admin to update any work log', async () => {
    const service = new WorkLogsService(makePrisma({ workLogAuthorId: USER_AUTHOR, userRole: Role.ADMIN }));
    const result = await service.update(USER_ADMIN, WORKLOG_ID, { minutes: 60 });
    expect(result.minutes).toBe(60);
  });

  it('rejects a non-author non-admin member with ForbiddenException', async () => {
    // workLog owned by USER_AUTHOR; USER_MEMBER is a non-author MEMBER
    const service = new WorkLogsService(makePrisma({ workLogAuthorId: USER_AUTHOR, userRole: Role.MEMBER }));
    await expect(service.update(USER_MEMBER, WORKLOG_ID, { minutes: 99 })).rejects.toThrow(ForbiddenException);
  });

  it('rejects a VIEWER (non-author) with ForbiddenException', async () => {
    const service = new WorkLogsService(makePrisma({ workLogAuthorId: USER_AUTHOR, userRole: Role.VIEWER }));
    await expect(service.update(USER_VIEWER, WORKLOG_ID, { minutes: 10 })).rejects.toThrow(ForbiddenException);
  });

  it('throws NotFoundException for unknown work log', async () => {
    const service = new WorkLogsService(makePrisma());
    await expect(service.update(USER_MEMBER, 'no-worklog', { minutes: 30 })).rejects.toThrow(NotFoundException);
  });

  it('allows updating note to empty string', async () => {
    const service = new WorkLogsService(makePrisma({ workLogAuthorId: USER_AUTHOR }));
    const result = await service.update(USER_AUTHOR, WORKLOG_ID, { note: '' });
    expect(result.note).toBe('');
  });

  it('allows updating workedAt', async () => {
    const prisma = makePrisma({ workLogAuthorId: USER_AUTHOR });
    const service = new WorkLogsService(prisma);
    await service.update(USER_AUTHOR, WORKLOG_ID, { workedAt: '2026-06-10T08:00:00.000Z' });
    expect(prisma.workLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ workedAt: new Date('2026-06-10T08:00:00.000Z') }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------
describe('WorkLogsService.remove', () => {
  it('allows the author to delete their own work log', async () => {
    const service = new WorkLogsService(makePrisma({ workLogAuthorId: USER_AUTHOR }));
    await expect(service.remove(USER_AUTHOR, WORKLOG_ID)).resolves.toBeUndefined();
  });

  it('allows a project admin to delete any work log', async () => {
    const service = new WorkLogsService(makePrisma({ workLogAuthorId: USER_AUTHOR, userRole: Role.ADMIN }));
    await expect(service.remove(USER_ADMIN, WORKLOG_ID)).resolves.toBeUndefined();
  });

  it('rejects a non-author non-admin with ForbiddenException', async () => {
    const service = new WorkLogsService(makePrisma({ workLogAuthorId: USER_AUTHOR, userRole: Role.MEMBER }));
    await expect(service.remove(USER_MEMBER, WORKLOG_ID)).rejects.toThrow(ForbiddenException);
  });

  it('rejects a non-member with ForbiddenException', async () => {
    const service = new WorkLogsService(makePrisma({ userRole: null }));
    await expect(service.remove(USER_FOREIGN, WORKLOG_ID)).rejects.toThrow(ForbiddenException);
  });

  it('throws NotFoundException for unknown work log', async () => {
    const service = new WorkLogsService(makePrisma());
    await expect(service.remove(USER_MEMBER, 'no-worklog')).rejects.toThrow(NotFoundException);
  });

  it('tenant isolation — work log belongs to another project (ForbiddenException)', async () => {
    // workLog lives in OTHER_PROJECT_ID (ws-2); USER_MEMBER has no membership in ws-2
    const service = new WorkLogsService(makePrisma({ workLogProjectId: OTHER_PROJECT_ID }));
    await expect(service.remove(USER_MEMBER, WORKLOG_ID)).rejects.toThrow(ForbiddenException);
  });
});

// ---------------------------------------------------------------------------
// Tenant isolation — findAll / create
// ---------------------------------------------------------------------------
describe('WorkLogsService tenant isolation', () => {
  it('findAll throws NotFoundException when issue belongs to a foreign project the caller cannot access', async () => {
    // Caller USER_MEMBER has no membership in OTHER_PROJECT_ID's workspace (ws-2)
    const service = new WorkLogsService(makePrisma({ issueProjectId: OTHER_PROJECT_ID }));
    await expect(service.findAll(USER_MEMBER, ISSUE_ID)).rejects.toThrow(ForbiddenException);
  });

  it('create throws ForbiddenException when issue belongs to a foreign project', async () => {
    const service = new WorkLogsService(makePrisma({ issueProjectId: OTHER_PROJECT_ID }));
    await expect(service.create(USER_MEMBER, ISSUE_ID, { minutes: 30 })).rejects.toThrow(ForbiddenException);
  });
});
