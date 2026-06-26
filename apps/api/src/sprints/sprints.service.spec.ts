import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SprintState, StatusCategory } from '@next-lane/shared';
import * as membership from '../common/membership.util';
import { SprintsService } from './sprints.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RealtimeService } from '../realtime/realtime.service';

/**
 * DB-free unit tests for SprintsService lifecycle behavior, driving the real
 * service methods with mocked Prisma + membership guards:
 *  - starting a sprint is rejected when another is already ACTIVE
 *    (the "one active sprint per project" invariant the board relies on);
 *  - completing a sprint returns its incomplete issues (those NOT in a
 *    DONE-category status) to the backlog by nulling their sprintId.
 */

const PROJECT_ID = 'proj-1';
const SPRINT_ID = 'sprint-1';

function makePrisma() {
  const tx = {
    sprint: { update: jest.fn(), findFirst: jest.fn() },
    status: { findMany: jest.fn() },
    issue: { updateMany: jest.fn() },
  };
  return {
    sprint: { findUnique: jest.fn() },
    $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
    __tx: tx,
  } as unknown as PrismaService & {
    sprint: { findUnique: jest.Mock };
    __tx: typeof tx;
  };
}

type MockPrisma = ReturnType<typeof makePrisma>;

const sprintRow = (state: SprintState) => ({
  id: SPRINT_ID,
  projectId: PROJECT_ID,
  state,
  name: 'Sprint 1',
  goal: null,
  startDate: null,
  endDate: null,
});

describe('SprintsService lifecycle (update)', () => {
  let prisma: MockPrisma;
  let service: SprintsService;
  let realtime: { emitToProject: jest.Mock };

  beforeEach(() => {
    prisma = makePrisma();
    realtime = { emitToProject: jest.fn() };
    service = new SprintsService(prisma, realtime as unknown as RealtimeService);
    // Membership is enforced elsewhere; permit it here so we test lifecycle.
    jest
      .spyOn(membership, 'assertProjectRole')
      .mockResolvedValue({} as never);
  });

  afterEach(() => jest.restoreAllMocks());

  it('rejects starting a sprint when another is already ACTIVE (checked in-tx)', async () => {
    prisma.sprint.findUnique.mockResolvedValue(sprintRow(SprintState.PLANNED));
    prisma.__tx.sprint.findFirst.mockResolvedValue({ name: 'Sprint 2' });

    await expect(
      service.update('user-1', SPRINT_ID, { state: SprintState.ACTIVE }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // The active-sprint guard must run on the transaction client so the
    // check-then-write is atomic and TOCTOU-safe.
    expect(prisma.__tx.sprint.findFirst).toHaveBeenCalledTimes(1);
    // Must not have written the state change.
    expect(prisma.__tx.sprint.update).not.toHaveBeenCalled();
  });

  it('maps the partial-unique-index race (P2002) to a 409 on start', async () => {
    prisma.sprint.findUnique.mockResolvedValue(sprintRow(SprintState.PLANNED));
    // The in-tx guard passes (no other ACTIVE seen) but a concurrent tx wins
    // the partial unique index, so the write raises P2002.
    prisma.__tx.sprint.findFirst.mockResolvedValue(null);
    prisma.__tx.sprint.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(
      service.update('user-1', SPRINT_ID, { state: SprintState.ACTIVE }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows starting a sprint when none other is ACTIVE', async () => {
    prisma.sprint.findUnique.mockResolvedValue(sprintRow(SprintState.PLANNED));
    prisma.__tx.sprint.findFirst.mockResolvedValue(null);
    prisma.__tx.sprint.update.mockResolvedValue(sprintRow(SprintState.ACTIVE));

    const result = await service.update('user-1', SPRINT_ID, {
      state: SprintState.ACTIVE,
    });

    expect(result.state).toBe(SprintState.ACTIVE);
    expect(prisma.__tx.sprint.update).toHaveBeenCalledTimes(1);
    // Completion-only cleanup must not run when merely starting.
    expect(prisma.__tx.issue.updateMany).not.toHaveBeenCalled();
    // Other tabs must be notified the sprint started.
    expect(realtime.emitToProject).toHaveBeenCalledWith(
      PROJECT_ID,
      'sprint.updated',
      expect.objectContaining({ id: SPRINT_ID, state: SprintState.ACTIVE }),
    );
  });

  it('returns incomplete issues to the backlog when completing a sprint', async () => {
    prisma.sprint.findUnique.mockResolvedValue(sprintRow(SprintState.ACTIVE));
    prisma.__tx.sprint.update.mockResolvedValue(
      sprintRow(SprintState.COMPLETED),
    );
    prisma.__tx.status.findMany.mockResolvedValue([{ id: 'done-1' }]);
    prisma.__tx.issue.updateMany.mockResolvedValue({ count: 2 });

    await service.update('user-1', SPRINT_ID, {
      state: SprintState.COMPLETED,
    });

    expect(prisma.__tx.status.findMany).toHaveBeenCalledWith({
      where: { projectId: PROJECT_ID, category: StatusCategory.DONE },
      select: { id: true },
    });
    expect(prisma.__tx.issue.updateMany).toHaveBeenCalledWith({
      where: { sprintId: SPRINT_ID, statusId: { notIn: ['done-1'] } },
      data: { sprintId: null },
    });
    // Other tabs must be notified the sprint completed.
    expect(realtime.emitToProject).toHaveBeenCalledWith(
      PROJECT_ID,
      'sprint.updated',
      expect.objectContaining({ id: SPRINT_ID, state: SprintState.COMPLETED }),
    );
  });

  it('does not touch issues when the state is unchanged (e.g. rename)', async () => {
    prisma.sprint.findUnique.mockResolvedValue(sprintRow(SprintState.PLANNED));
    prisma.__tx.sprint.update.mockResolvedValue(
      sprintRow(SprintState.PLANNED),
    );

    await service.update('user-1', SPRINT_ID, { name: 'Renamed' });

    expect(prisma.__tx.sprint.findFirst).not.toHaveBeenCalled();
    expect(prisma.__tx.issue.updateMany).not.toHaveBeenCalled();
    // A plain rename is not a lifecycle transition, so no realtime emit.
    expect(realtime.emitToProject).not.toHaveBeenCalled();
  });
});
