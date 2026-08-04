import { IssueType } from '@next-lane/shared';
import { IssuesService } from './issues.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '@prisma/client';

/**
 * The epic date cascade (founder rule, 2026-08-02).
 *
 * Drag a CHILD past its epic and the epic grows to cover it — you extended the
 * work, and the epic containing that work cannot honestly claim to end sooner.
 * Shrink the EPIC and nothing happens to the children; the roadmap marks the
 * overrun instead, because pulling a deadline in does not make the work fit,
 * and quietly dragging a dozen stories along would hide exactly the problem
 * the founder needs to show a manager.
 *
 * So: grows only, from the child side only. These tests pin every edge of that
 * rule, including the ones where it must do NOTHING — the no-op cases are the
 * ones a careless refactor breaks.
 */
function makeService(parentRow: unknown) {
  const tx = {
    issue: {
      findUnique: jest.fn().mockResolvedValue(parentRow),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const svc = new IssuesService(
    {} as PrismaService,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { svc, tx };
}

/** Invoke the private cascade directly — it is only reachable via the update path. */
function cascade(
  svc: IssuesService,
  tx: unknown,
  child: {
    parentId: string | null;
    startDate: Date | null;
    dueDate: Date | null;
  },
  activities: Prisma.ActivityLogCreateManyInput[],
): Promise<void> {
  return (
    svc as unknown as {
      growParentEpicToFit: (
        tx: unknown,
        child: unknown,
        activities: unknown,
        actorId: string,
      ) => Promise<void>;
    }
  ).growParentEpicToFit(tx, child, activities, 'actor-1');
}

const APRIL = {
  start: new Date('2026-04-01T00:00:00.000Z'),
  end: new Date('2026-04-30T00:00:00.000Z'),
};

function epicRow(startDate: Date | null, dueDate: Date | null) {
  return { id: 'epic-1', type: IssueType.EPIC, startDate, dueDate };
}

describe('IssuesService — epic date cascade', () => {
  it("extends the epic's dueDate when a child is dragged past it", async () => {
    const { svc, tx } = makeService(epicRow(APRIL.start, APRIL.end));
    const activities: Prisma.ActivityLogCreateManyInput[] = [];

    await cascade(
      svc,
      tx,
      {
        parentId: 'epic-1',
        startDate: new Date('2026-04-20T00:00:00.000Z'),
        dueDate: new Date('2026-05-10T00:00:00.000Z'),
      },
      activities,
    );

    expect(tx.issue.update).toHaveBeenCalledWith({
      where: { id: 'epic-1' },
      data: { dueDate: new Date('2026-05-10T00:00:00.000Z') },
    });
    // The epic's start is untouched — only the end moved.
    expect(tx.issue.update.mock.calls[0][0].data.startDate).toBeUndefined();
  });

  it("pulls the epic's startDate back when a child starts before it", async () => {
    const { svc, tx } = makeService(epicRow(APRIL.start, APRIL.end));
    await cascade(
      svc,
      tx,
      {
        parentId: 'epic-1',
        startDate: new Date('2026-03-10T00:00:00.000Z'),
        dueDate: new Date('2026-03-20T00:00:00.000Z'),
      },
      [],
    );
    expect(tx.issue.update).toHaveBeenCalledWith({
      where: { id: 'epic-1' },
      data: { startDate: new Date('2026-03-10T00:00:00.000Z') },
    });
  });

  it('NEVER shrinks the epic when a child moves inside its window', async () => {
    const { svc, tx } = makeService(epicRow(APRIL.start, APRIL.end));
    await cascade(
      svc,
      tx,
      {
        parentId: 'epic-1',
        startDate: new Date('2026-04-10T00:00:00.000Z'),
        dueDate: new Date('2026-04-12T00:00:00.000Z'),
      },
      [],
    );
    // An epic that spans April must not collapse to two days because one
    // story happens to be short. Grow-only is the whole contract.
    expect(tx.issue.update).not.toHaveBeenCalled();
  });

  it('does nothing when the epic states no dates of its own', async () => {
    const { svc, tx } = makeService(epicRow(null, null));
    await cascade(
      svc,
      tx,
      {
        parentId: 'epic-1',
        startDate: new Date('2026-04-10T00:00:00.000Z'),
        dueDate: new Date('2026-04-12T00:00:00.000Z'),
      },
      [],
    );
    // The roadmap already derives this epic's window from its children.
    // Writing dates here would invent a commitment nobody made.
    expect(tx.issue.update).not.toHaveBeenCalled();
  });

  it('does nothing when the parent is not an epic', async () => {
    const { svc, tx } = makeService({
      id: 'story-parent',
      type: IssueType.STORY,
      startDate: APRIL.start,
      dueDate: APRIL.end,
    });
    await cascade(
      svc,
      tx,
      {
        parentId: 'story-parent',
        startDate: new Date('2026-09-01T00:00:00.000Z'),
        dueDate: new Date('2026-09-30T00:00:00.000Z'),
      },
      [],
    );
    expect(tx.issue.update).not.toHaveBeenCalled();
  });

  it('does nothing for a top-level issue, without querying for a parent', async () => {
    const { svc, tx } = makeService(null);
    await cascade(
      svc,
      tx,
      { parentId: null, startDate: APRIL.start, dueDate: APRIL.end },
      [],
    );
    expect(tx.issue.findUnique).not.toHaveBeenCalled();
    expect(tx.issue.update).not.toHaveBeenCalled();
  });

  it('does nothing when the child itself has no dates', async () => {
    const { svc, tx } = makeService(epicRow(APRIL.start, APRIL.end));
    await cascade(
      svc,
      tx,
      { parentId: 'epic-1', startDate: null, dueDate: null },
      [],
    );
    expect(tx.issue.findUnique).not.toHaveBeenCalled();
  });

  it('records the change on the EPIC so its dates never move invisibly', async () => {
    const { svc, tx } = makeService(epicRow(APRIL.start, APRIL.end));
    const activities: Prisma.ActivityLogCreateManyInput[] = [];

    await cascade(
      svc,
      tx,
      {
        parentId: 'epic-1',
        startDate: new Date('2026-03-01T00:00:00.000Z'),
        dueDate: new Date('2026-05-10T00:00:00.000Z'),
      },
      activities,
    );

    // Both ends moved, so both are logged — against the epic, not the child.
    expect(activities).toHaveLength(2);
    expect(activities.every((a) => a.issueId === 'epic-1')).toBe(true);
    expect(activities.every((a) => a.actorId === 'actor-1')).toBe(true);
    expect(activities.map((a) => a.field).sort()).toEqual([
      'dueDate',
      'startDate',
    ]);
    const due = activities.find((a) => a.field === 'dueDate');
    expect(due?.from).toBe(APRIL.end.toISOString());
    expect(due?.to).toBe('2026-05-10T00:00:00.000Z');
  });

  it('grows an epic that has only a dueDate', async () => {
    const { svc, tx } = makeService(epicRow(null, APRIL.end));
    await cascade(
      svc,
      tx,
      {
        parentId: 'epic-1',
        startDate: null,
        dueDate: new Date('2026-06-01T00:00:00.000Z'),
      },
      [],
    );
    expect(tx.issue.update).toHaveBeenCalledWith({
      where: { id: 'epic-1' },
      data: { dueDate: new Date('2026-06-01T00:00:00.000Z') },
    });
  });
});
