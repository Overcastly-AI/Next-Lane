import { SprintState, IssueType, Priority, StatusCategory } from '@next-lane/shared';
import * as membership from '../common/membership.util';
import { BoardService, BOARD_ISSUES_CAP } from './board.service';
import type { PrismaService } from '../prisma/prisma.service';

const PROJECT_ID = 'proj-1';
const PROJECT_KEY = 'NL';

function makePrisma() {
  return {
    status: { findMany: jest.fn() },
    issue: { findMany: jest.fn() },
  } as unknown as PrismaService & {
    status: { findMany: jest.Mock };
    issue: { findMany: jest.Mock };
  };
}

type MockPrisma = ReturnType<typeof makePrisma>;

/** Minimal issue row that satisfies toIssueDto mapping requirements. */
function makeIssueRow(i: number) {
  return {
    id: `issue-${i}`,
    number: i,
    projectId: PROJECT_ID,
    type: IssueType.TASK,
    title: `Issue ${i}`,
    description: null,
    statusId: 'status-1',
    assigneeId: null,
    reporterId: null,
    priority: Priority.MEDIUM,
    storyPoints: null,
    parentId: null,
    sprintId: null,
    rank: `a${i}`,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    project: { key: PROJECT_KEY },
    status: {
      id: 'status-1',
      name: 'To Do',
      category: StatusCategory.TODO,
      order: 0,
      projectId: PROJECT_ID,
    },
    assignee: null,
    reporter: null,
    labels: [],
    _count: { comments: 0 },
  };
}

describe('BoardService', () => {
  let prisma: MockPrisma;
  let service: BoardService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new BoardService(prisma);
    jest.spyOn(membership, 'assertProjectMember').mockResolvedValue({
      key: PROJECT_KEY,
      id: PROJECT_ID,
      name: 'Test Project',
      description: null,
      leadId: null,
      workspaceId: 'ws-1',
      archived: false,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    } as never);
  });

  afterEach(() => jest.restoreAllMocks());

  it('returns issuesTruncated: false when under the cap', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => makeIssueRow(i));
    prisma.status.findMany.mockResolvedValue([
      { id: 'status-1', name: 'To Do', category: StatusCategory.TODO, order: 0, projectId: PROJECT_ID },
    ]);
    prisma.issue.findMany.mockResolvedValue(rows);

    const board = await service.getBoard('user-1', PROJECT_ID);

    expect(board.issuesTruncated).toBe(false);
    expect(board.issues).toHaveLength(10);
  });

  it('applies take: BOARD_ISSUES_CAP + 1 to the Prisma query', async () => {
    prisma.status.findMany.mockResolvedValue([]);
    prisma.issue.findMany.mockResolvedValue([]);

    await service.getBoard('user-1', PROJECT_ID);

    expect(prisma.issue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: BOARD_ISSUES_CAP + 1 }),
    );
  });

  it('sets issuesTruncated: true and slices to CAP when result exceeds cap', async () => {
    // Return CAP + 1 rows to simulate truncation.
    const rows = Array.from({ length: BOARD_ISSUES_CAP + 1 }, (_, i) =>
      makeIssueRow(i),
    );
    prisma.status.findMany.mockResolvedValue([
      { id: 'status-1', name: 'To Do', category: StatusCategory.TODO, order: 0, projectId: PROJECT_ID },
    ]);
    prisma.issue.findMany.mockResolvedValue(rows);

    const board = await service.getBoard('user-1', PROJECT_ID);

    expect(board.issuesTruncated).toBe(true);
    expect(board.issues).toHaveLength(BOARD_ISSUES_CAP);
  });

  it('preserves ordering (rank asc) when truncating', async () => {
    const rows = Array.from({ length: BOARD_ISSUES_CAP + 1 }, (_, i) =>
      makeIssueRow(i),
    );
    prisma.status.findMany.mockResolvedValue([
      { id: 'status-1', name: 'To Do', category: StatusCategory.TODO, order: 0, projectId: PROJECT_ID },
    ]);
    prisma.issue.findMany.mockResolvedValue(rows);

    const board = await service.getBoard('user-1', PROJECT_ID);

    // After slicing to CAP, the first issue must be row 0 and last row CAP-1
    // (i.e. we dropped the extra row at index CAP, not the first row).
    expect(board.issues[0].id).toBe('issue-0');
    expect(board.issues[BOARD_ISSUES_CAP - 1].id).toBe(`issue-${BOARD_ISSUES_CAP - 1}`);

    // Also verify that the prisma query requests the correct ordering.
    expect(prisma.issue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ status: { order: 'asc' } }, { rank: 'asc' }],
      }),
    );
  });

  it('filters for the active sprint or backlog via OR clause', async () => {
    prisma.status.findMany.mockResolvedValue([]);
    prisma.issue.findMany.mockResolvedValue([]);

    await service.getBoard('user-1', PROJECT_ID);

    expect(prisma.issue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { sprintId: null },
            { sprint: { state: SprintState.ACTIVE } },
          ],
        }),
      }),
    );
  });
});
