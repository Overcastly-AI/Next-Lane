import { BadRequestException } from '@nestjs/common';
import { IssuesService } from './issues.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RealtimeService } from '../realtime/realtime.service';

/**
 * DB-free unit tests for IssuesService.assertSameProject — the guard that stops
 * a member of one project from attaching their issue to another project's
 * status/sprint/parent or reordering against a foreign issue (which would
 * corrupt foreign boards / leak rank ordering). Prisma lookups are mocked.
 *
 * assertSameProject is private; we drive it through the instance to test the
 * real behavior rather than a copy.
 */

const PROJECT_ID = 'proj-1';
const OTHER_PROJECT_ID = 'proj-2';

function makePrisma() {
  return {
    status: { findUnique: jest.fn() },
    sprint: { findUnique: jest.fn() },
    issue: { findUnique: jest.fn() },
  } as unknown as PrismaService & {
    status: { findUnique: jest.Mock };
    sprint: { findUnique: jest.Mock };
    issue: { findUnique: jest.Mock };
  };
}

type MockPrisma = ReturnType<typeof makePrisma>;

interface AssertSameProjectRefs {
  statusId?: string | null;
  sprintId?: string | null;
  parentId?: string | null;
  issueId?: string | null;
}

function callAssertSameProject(
  service: IssuesService,
  projectId: string,
  refs: AssertSameProjectRefs,
): Promise<void> {
  return (
    service as unknown as {
      assertSameProject: (
        projectId: string,
        refs: AssertSameProjectRefs,
      ) => Promise<void>;
    }
  ).assertSameProject(projectId, refs);
}

describe('IssuesService.assertSameProject', () => {
  let prisma: MockPrisma;
  let service: IssuesService;

  beforeEach(() => {
    prisma = makePrisma();
    const realtime = {} as RealtimeService;
    service = new IssuesService(prisma, realtime);
  });

  it('accepts when all refs belong to the same project', async () => {
    prisma.status.findUnique.mockResolvedValue({ projectId: PROJECT_ID });
    prisma.sprint.findUnique.mockResolvedValue({ projectId: PROJECT_ID });
    prisma.issue.findUnique.mockResolvedValue({ projectId: PROJECT_ID });

    await expect(
      callAssertSameProject(service, PROJECT_ID, {
        statusId: 's-1',
        sprintId: 'sp-1',
        parentId: 'p-1',
        issueId: 'i-1',
      }),
    ).resolves.toBeUndefined();
  });

  it('skips lookups for null/undefined refs', async () => {
    await expect(
      callAssertSameProject(service, PROJECT_ID, {
        statusId: null,
        sprintId: undefined,
      }),
    ).resolves.toBeUndefined();

    expect(prisma.status.findUnique).not.toHaveBeenCalled();
    expect(prisma.sprint.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a foreign statusId', async () => {
    prisma.status.findUnique.mockResolvedValue({ projectId: OTHER_PROJECT_ID });

    await expect(
      callAssertSameProject(service, PROJECT_ID, { statusId: 's-x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a missing statusId', async () => {
    prisma.status.findUnique.mockResolvedValue(null);

    await expect(
      callAssertSameProject(service, PROJECT_ID, { statusId: 's-x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a foreign sprintId', async () => {
    prisma.sprint.findUnique.mockResolvedValue({ projectId: OTHER_PROJECT_ID });

    await expect(
      callAssertSameProject(service, PROJECT_ID, { sprintId: 'sp-x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a foreign parentId', async () => {
    prisma.issue.findUnique.mockResolvedValue({ projectId: OTHER_PROJECT_ID });

    await expect(
      callAssertSameProject(service, PROJECT_ID, { parentId: 'p-x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a foreign neighbor issueId (before/after reorder target)', async () => {
    prisma.issue.findUnique.mockResolvedValue({ projectId: OTHER_PROJECT_ID });

    await expect(
      callAssertSameProject(service, PROJECT_ID, { issueId: 'i-x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when one of several refs is foreign even if others are valid', async () => {
    prisma.status.findUnique.mockResolvedValue({ projectId: PROJECT_ID });
    prisma.sprint.findUnique.mockResolvedValue({ projectId: OTHER_PROJECT_ID });

    await expect(
      callAssertSameProject(service, PROJECT_ID, {
        statusId: 's-1',
        sprintId: 'sp-x',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
