import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PokerState, Role } from '@next-lane/shared';
import * as membership from '../common/membership.util';
import { PokerService } from './poker.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RealtimeService } from '../realtime/realtime.service';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PROJECT_ID = 'proj-1';
const SESSION_ID = 'session-1';
const ITEM_ID = 'item-1';
const ITEM2_ID = 'item-2';
const ISSUE_ID = 'issue-1';
const ISSUE2_ID = 'issue-2';
const USER_A = 'user-a';
const USER_B = 'user-b';
const VOTE_ID = 'vote-1';

function makeRealtime() {
  return { emitToProject: jest.fn() } as unknown as RealtimeService;
}

/** Build a minimal tx client that supports the transaction calls PokerService uses. */
function makeTx() {
  return {
    pokerSession: {
      create: jest.fn(),
      update: jest.fn(),
    },
    pokerItem: {
      create: jest.fn(),
    },
    issue: {
      update: jest.fn(),
    },
  };
}

type Tx = ReturnType<typeof makeTx>;

function makePrisma(overrides: Partial<Record<string, unknown>> = {}): PrismaService {
  const tx: Tx = makeTx();

  const prisma = {
    pokerSession: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    pokerItem: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    pokerVote: {
      upsert: jest.fn(),
    },
    issue: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    sprint: {
      findUnique: jest.fn(),
    },
    project: {
      findUnique: jest.fn().mockResolvedValue({
        id: PROJECT_ID,
        workspaceId: 'ws-1',
        workspace: { id: 'ws-1' },
      }),
    },
    membership: {
      findUnique: jest.fn().mockResolvedValue({ role: Role.MEMBER }),
    },
    $transaction: jest.fn((ops: unknown) => {
      // If it's a function (interactive transaction), call it with tx
      if (typeof ops === 'function') {
        return (ops as (t: Tx) => unknown)(tx);
      }
      // If it's an array of promises, resolve them all
      if (Array.isArray(ops)) {
        return Promise.all(ops);
      }
      return Promise.resolve(null);
    }),
    __tx: tx,
    ...overrides,
  };
  return prisma as unknown as PrismaService;
}

type MockPrisma = ReturnType<typeof makePrisma> & {
  pokerSession: {
    create: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
  };
  pokerItem: {
    create: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  pokerVote: { upsert: jest.Mock };
  issue: { findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
  sprint: { findUnique: jest.Mock };
  project: { findUnique: jest.Mock };
  membership: { findUnique: jest.Mock };
  $transaction: jest.Mock;
  __tx: Tx;
};

function nowISO() {
  return new Date().toISOString();
}

function makeSession(
  state: PokerState = PokerState.VOTING,
  items: Array<{ id: string; order: number }> = [],
): {
  id: string;
  projectId: string;
  sprintId: null;
  name: string | null;
  state: string;
  activeItemId: string | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  items: Array<{
    id: string;
    sessionId: string;
    issueId: string;
    order: number;
    revealed: boolean;
    finalEstimate: null;
    createdAt: Date;
    votes: never[];
  }>;
} {
  return {
    id: SESSION_ID,
    projectId: PROJECT_ID,
    sprintId: null,
    name: null,
    state,
    activeItemId: items[0]?.id ?? null,
    createdById: USER_A,
    createdAt: new Date(),
    updatedAt: new Date(),
    items: items.map((i) => ({
      id: i.id,
      sessionId: SESSION_ID,
      issueId: ISSUE_ID,
      order: i.order,
      revealed: false,
      finalEstimate: null,
      createdAt: new Date(),
      votes: [],
    })),
  };
}

function makeItem(
  opts: Partial<{
    id: string;
    sessionId: string;
    issueId: string;
    order: number;
    revealed: boolean;
    finalEstimate: number | null;
    votes: Array<{ id: string; itemId: string; userId: string; value: string; createdAt: Date; updatedAt: Date }>;
    session: { id: string; projectId: string; state: string };
  }> = {},
) {
  return {
    id: opts.id ?? ITEM_ID,
    sessionId: opts.sessionId ?? SESSION_ID,
    issueId: opts.issueId ?? ISSUE_ID,
    order: opts.order ?? 0,
    revealed: opts.revealed ?? false,
    finalEstimate: opts.finalEstimate ?? null,
    createdAt: new Date(),
    votes: opts.votes ?? [],
    session: opts.session ?? {
      id: SESSION_ID,
      projectId: PROJECT_ID,
      state: PokerState.VOTING,
    },
  };
}

function makeVote(userId: string, value: string) {
  return {
    id: VOTE_ID,
    itemId: ITEM_ID,
    userId,
    value,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PokerService', () => {
  let prisma: MockPrisma;
  let realtime: ReturnType<typeof makeRealtime>;
  let service: PokerService;

  beforeEach(() => {
    prisma = makePrisma() as MockPrisma;
    realtime = makeRealtime();
    service = new PokerService(prisma, realtime);

    // Allow membership checks to pass by default
    jest
      .spyOn(membership, 'assertProjectRole')
      .mockResolvedValue({ id: PROJECT_ID, workspaceId: 'ws-1' } as never);
    jest
      .spyOn(membership, 'assertProjectMember')
      .mockResolvedValue({ id: PROJECT_ID, workspaceId: 'ws-1' } as never);
  });

  afterEach(() => jest.restoreAllMocks());

  // ── createSession ──────────────────────────────────────────────────────────

  describe('createSession', () => {
    it('creates a session with items and sets activeItemId to the first item', async () => {
      // issues belong to the project
      prisma.issue.findMany.mockResolvedValue([
        { id: ISSUE_ID },
        { id: ISSUE2_ID },
      ]);

      const createdSession = { id: SESSION_ID, projectId: PROJECT_ID };
      const createdItem1 = {
        id: ITEM_ID,
        sessionId: SESSION_ID,
        issueId: ISSUE_ID,
        order: 0,
      };
      const createdItem2 = {
        id: ITEM2_ID,
        sessionId: SESSION_ID,
        issueId: ISSUE2_ID,
        order: 1,
      };

      // tx.pokerSession.create → initial session
      prisma.__tx.pokerSession.create.mockResolvedValue(createdSession);
      // tx.pokerItem.create → items in order
      prisma.__tx.pokerItem.create
        .mockResolvedValueOnce(createdItem1)
        .mockResolvedValueOnce(createdItem2);
      // tx.pokerSession.update → set activeItemId
      prisma.__tx.pokerSession.update.mockResolvedValue(
        makeSession(PokerState.VOTING, [
          { id: ITEM_ID, order: 0 },
          { id: ITEM2_ID, order: 1 },
        ]),
      );

      const result = await service.createSession(USER_A, PROJECT_ID, {
        issueIds: [ISSUE_ID, ISSUE2_ID],
      });

      expect(result.id).toBe(SESSION_ID);
      expect(result.state).toBe(PokerState.VOTING);
      expect(result.activeItemId).toBe(ITEM_ID);
      expect(result.items).toHaveLength(2);
      expect(result.items![0].order).toBe(0);
      expect(result.items![1].order).toBe(1);

      // activeItemId should have been set to the first item
      expect(prisma.__tx.pokerSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ activeItemId: ITEM_ID }),
        }),
      );
    });

    it('rejects when issueIds contains IDs not in the project', async () => {
      // Return only 1 of the 2 requested issues
      prisma.issue.findMany.mockResolvedValue([{ id: ISSUE_ID }]);

      await expect(
        service.createSession(USER_A, PROJECT_ID, {
          issueIds: [ISSUE_ID, 'foreign-issue'],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when sprintId does not belong to the project', async () => {
      prisma.issue.findMany.mockResolvedValue([{ id: ISSUE_ID }]);
      prisma.sprint.findUnique.mockResolvedValue({
        id: 'sprint-x',
        projectId: 'other-project',
      });

      await expect(
        service.createSession(USER_A, PROJECT_ID, {
          issueIds: [ISSUE_ID],
          sprintId: 'sprint-x',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('orders items by the array index, not lexicographically', async () => {
      prisma.issue.findMany.mockResolvedValue([
        { id: ISSUE_ID },
        { id: ISSUE2_ID },
      ]);
      prisma.__tx.pokerSession.create.mockResolvedValue({ id: SESSION_ID, projectId: PROJECT_ID });
      prisma.__tx.pokerItem.create
        .mockResolvedValueOnce({ id: ITEM_ID, order: 0 })
        .mockResolvedValueOnce({ id: ITEM2_ID, order: 1 });
      prisma.__tx.pokerSession.update.mockResolvedValue(
        makeSession(PokerState.VOTING, [
          { id: ITEM_ID, order: 0 },
          { id: ITEM2_ID, order: 1 },
        ]),
      );

      const result = await service.createSession(USER_A, PROJECT_ID, {
        issueIds: [ISSUE_ID, ISSUE2_ID],
      });

      // Verify item creation order: ISSUE_ID first (index 0), ISSUE2_ID second (index 1)
      const firstCall = prisma.__tx.pokerItem.create.mock.calls[0][0];
      const secondCall = prisma.__tx.pokerItem.create.mock.calls[1][0];
      expect(firstCall.data.issueId).toBe(ISSUE_ID);
      expect(firstCall.data.order).toBe(0);
      expect(secondCall.data.issueId).toBe(ISSUE2_ID);
      expect(secondCall.data.order).toBe(1);

      expect(result.items).toHaveLength(2);
    });
  });

  // ── castVote ───────────────────────────────────────────────────────────────

  describe('castVote', () => {
    it('upserts the vote for a valid deck value', async () => {
      prisma.pokerItem.findUnique.mockResolvedValue(makeItem());
      prisma.pokerVote.upsert.mockResolvedValue(makeVote(USER_A, '5'));

      const result = await service.castVote(USER_A, ITEM_ID, { value: '5' });

      expect(result.userId).toBe(USER_A);
      expect(result.value).toBe('5');
      expect(prisma.pokerVote.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { itemId_userId: { itemId: ITEM_ID, userId: USER_A } },
          create: expect.objectContaining({ value: '5' }),
          update: expect.objectContaining({ value: '5' }),
        }),
      );
    });

    it('rejects a value not in the deck', async () => {
      await expect(
        service.castVote(USER_A, ITEM_ID, { value: '999' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      // Should not hit the DB
      expect(prisma.pokerItem.findUnique).not.toHaveBeenCalled();
    });

    it('rejects a vote on a revealed item', async () => {
      prisma.pokerItem.findUnique.mockResolvedValue(
        makeItem({ revealed: true }),
      );

      await expect(
        service.castVote(USER_A, ITEM_ID, { value: '8' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a vote in a CLOSED session', async () => {
      prisma.pokerItem.findUnique.mockResolvedValue(
        makeItem({
          session: { id: SESSION_ID, projectId: PROJECT_ID, state: PokerState.CLOSED },
        }),
      );

      await expect(
        service.castVote(USER_A, ITEM_ID, { value: '3' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('emits VoteCast event WITHOUT the vote value', async () => {
      prisma.pokerItem.findUnique.mockResolvedValue(makeItem());
      prisma.pokerVote.upsert.mockResolvedValue(makeVote(USER_A, '13'));

      await service.castVote(USER_A, ITEM_ID, { value: '13' });

      expect(realtime.emitToProject).toHaveBeenCalledTimes(1);
      const [, event, payload] = (realtime.emitToProject as jest.Mock).mock.calls[0] as [
        string,
        string,
        { sessionId: string; itemId: string; userId: string; value?: string },
      ];
      expect(event).toBe('poker.vote.cast');
      expect(payload.userId).toBe(USER_A);
      // value must NOT be present in the realtime event
      expect('value' in payload).toBe(false);
    });

    it('allows casting special deck values like ? and coffee', async () => {
      prisma.pokerItem.findUnique.mockResolvedValue(makeItem());
      prisma.pokerVote.upsert.mockResolvedValue(makeVote(USER_A, '?'));

      const r1 = await service.castVote(USER_A, ITEM_ID, { value: '?' });
      expect(r1.value).toBe('?');

      prisma.pokerVote.upsert.mockResolvedValue(makeVote(USER_A, '☕'));
      const r2 = await service.castVote(USER_A, ITEM_ID, { value: '☕' });
      expect(r2.value).toBe('☕');
    });
  });

  // ── Vote masking ───────────────────────────────────────────────────────────

  describe('vote masking in getSession', () => {
    it('masks other users\' vote values pre-reveal but keeps own vote visible', async () => {
      const votes = [
        makeVote(USER_A, '5'),
        makeVote(USER_B, '13'),
      ];
      const sessionWithItem = {
        ...makeSession(PokerState.VOTING, [{ id: ITEM_ID, order: 0 }]),
        items: [
          {
            ...makeItem({ revealed: false, votes }),
          },
        ],
      };
      prisma.pokerSession.findUnique.mockResolvedValue(sessionWithItem);

      // USER_A fetches the session
      const resultA = await service.getSession(USER_A, SESSION_ID);
      const item = resultA.items![0];

      // USER_A's own vote is visible
      const voteA = item.votes!.find((v) => v.userId === USER_A);
      expect(voteA?.value).toBe('5');

      // USER_B's vote is masked
      const voteB = item.votes!.find((v) => v.userId === USER_B);
      expect(voteB?.value).toBe('');
    });

    it('exposes all vote values after item is revealed', async () => {
      const votes = [
        makeVote(USER_A, '5'),
        makeVote(USER_B, '13'),
      ];
      const sessionWithItem = {
        ...makeSession(PokerState.REVEALED, [{ id: ITEM_ID, order: 0 }]),
        items: [
          {
            ...makeItem({ revealed: true, votes }),
          },
        ],
      };
      prisma.pokerSession.findUnique.mockResolvedValue(sessionWithItem);

      // USER_A fetches the session
      const resultA = await service.getSession(USER_A, SESSION_ID);
      const item = resultA.items![0];

      // Both votes are visible after reveal
      const voteA = item.votes!.find((v) => v.userId === USER_A);
      const voteB = item.votes!.find((v) => v.userId === USER_B);
      expect(voteA?.value).toBe('5');
      expect(voteB?.value).toBe('13');
    });

    it('another user also gets their own vote unmasked, others masked pre-reveal', async () => {
      const votes = [
        makeVote(USER_A, '5'),
        makeVote(USER_B, '13'),
      ];
      const sessionWithItem = {
        ...makeSession(PokerState.VOTING, [{ id: ITEM_ID, order: 0 }]),
        items: [
          {
            ...makeItem({ revealed: false, votes }),
          },
        ],
      };
      prisma.pokerSession.findUnique.mockResolvedValue(sessionWithItem);

      // USER_B fetches the session
      const resultB = await service.getSession(USER_B, SESSION_ID);
      const item = resultB.items![0];

      // USER_B sees their own vote
      const voteB = item.votes!.find((v) => v.userId === USER_B);
      expect(voteB?.value).toBe('13');

      // USER_A's vote is masked from USER_B
      const voteA = item.votes!.find((v) => v.userId === USER_A);
      expect(voteA?.value).toBe('');
    });
  });

  // ── revealItem ─────────────────────────────────────────────────────────────

  describe('revealItem', () => {
    it('sets revealed=true and emits ItemRevealed with all vote values', async () => {
      const votes = [makeVote(USER_A, '5'), makeVote(USER_B, '8')];
      prisma.pokerItem.findUnique.mockResolvedValue(
        makeItem({ revealed: false, votes }),
      );
      prisma.pokerItem.update.mockResolvedValue(
        makeItem({ revealed: true, votes }),
      );

      const result = await service.revealItem(USER_A, ITEM_ID);

      expect(result.revealed).toBe(true);
      expect(prisma.pokerItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { revealed: true },
        }),
      );

      // Realtime event should include all vote values
      expect(realtime.emitToProject).toHaveBeenCalledWith(
        PROJECT_ID,
        'poker.item.revealed',
        expect.objectContaining({
          item: expect.objectContaining({ revealed: true }),
        }),
      );
    });

    it('rejects revealing an item in a CLOSED session', async () => {
      prisma.pokerItem.findUnique.mockResolvedValue(
        makeItem({
          session: { id: SESSION_ID, projectId: PROJECT_ID, state: PokerState.CLOSED },
        }),
      );

      await expect(
        service.revealItem(USER_A, ITEM_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ── commitEstimate ─────────────────────────────────────────────────────────

  describe('commitEstimate', () => {
    it('sets finalEstimate on the item AND writes storyPoints to the issue', async () => {
      prisma.pokerItem.findUnique.mockResolvedValue(makeItem());

      const updatedItem = makeItem({ finalEstimate: 8 });
      // $transaction with array: resolve both operations
      prisma.$transaction.mockImplementation((ops: unknown) => {
        if (Array.isArray(ops)) {
          return Promise.resolve([updatedItem, { id: ISSUE_ID, storyPoints: 8 }]);
        }
        return Promise.resolve(null);
      });

      const result = await service.commitEstimate(USER_A, ITEM_ID, {
        finalEstimate: 8,
      });

      expect(result.finalEstimate).toBe(8);

      // Both updates must be queued atomically in the same $transaction call
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const ops = (prisma.$transaction as jest.Mock).mock.calls[0][0];
      expect(Array.isArray(ops)).toBe(true);
      expect(ops).toHaveLength(2);
    });

    it('emits EstimateCommitted with the updated item', async () => {
      prisma.pokerItem.findUnique.mockResolvedValue(makeItem());
      const updatedItem = makeItem({ finalEstimate: 13 });
      prisma.$transaction.mockResolvedValue([
        updatedItem,
        { id: ISSUE_ID, storyPoints: 13 },
      ]);

      await service.commitEstimate(USER_A, ITEM_ID, { finalEstimate: 13 });

      expect(realtime.emitToProject).toHaveBeenCalledWith(
        PROJECT_ID,
        'poker.estimate.committed',
        expect.objectContaining({
          item: expect.objectContaining({ finalEstimate: 13 }),
        }),
      );
    });

    it('rejects committing in a CLOSED session', async () => {
      prisma.pokerItem.findUnique.mockResolvedValue(
        makeItem({
          session: { id: SESSION_ID, projectId: PROJECT_ID, state: PokerState.CLOSED },
        }),
      );

      await expect(
        service.commitEstimate(USER_A, ITEM_ID, { finalEstimate: 5 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ── updateSession – activeItemId validation ───────────────────────────────

  describe('updateSession – activeItemId validation', () => {
    it('rejects an activeItemId that does not belong to the session', async () => {
      prisma.pokerSession.findUnique.mockResolvedValue({
        ...makeSession(),
        items: [{ id: ITEM_ID }],
      });

      await expect(
        service.updateSession(USER_A, SESSION_ID, {
          activeItemId: 'foreign-item-id',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts an activeItemId that belongs to the session', async () => {
      prisma.pokerSession.findUnique.mockResolvedValue({
        ...makeSession(),
        items: [{ id: ITEM_ID }, { id: ITEM2_ID }],
      });
      prisma.pokerSession.update.mockResolvedValue(
        makeSession(PokerState.VOTING, [
          { id: ITEM_ID, order: 0 },
          { id: ITEM2_ID, order: 1 },
        ]),
      );

      const result = await service.updateSession(USER_A, SESSION_ID, {
        activeItemId: ITEM2_ID,
      });

      expect(result).toBeDefined();
      expect(prisma.pokerSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ activeItemId: ITEM2_ID }),
        }),
      );
    });

    it('allows setting activeItemId to null', async () => {
      prisma.pokerSession.findUnique.mockResolvedValue({
        ...makeSession(),
        items: [{ id: ITEM_ID }],
      });
      prisma.pokerSession.update.mockResolvedValue(
        makeSession(PokerState.VOTING, [{ id: ITEM_ID, order: 0 }]),
      );

      await expect(
        service.updateSession(USER_A, SESSION_ID, { activeItemId: null }),
      ).resolves.toBeDefined();

      expect(prisma.pokerSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ activeItemId: null }),
        }),
      );
    });
  });

  // ── State transition validation ────────────────────────────────────────────

  describe('updateSession – state transitions', () => {
    const sessionStub = (state: PokerState) => ({
      ...makeSession(state),
      items: [{ id: ITEM_ID }],
    });

    it.each([
      [PokerState.VOTING, PokerState.REVEALED],
      [PokerState.VOTING, PokerState.CLOSED],
      [PokerState.REVEALED, PokerState.CLOSED],
      [PokerState.REVEALED, PokerState.VOTING],
    ])('allows %s → %s', async (from, to) => {
      prisma.pokerSession.findUnique.mockResolvedValue(sessionStub(from));
      prisma.pokerSession.update.mockResolvedValue(makeSession(to, [{ id: ITEM_ID, order: 0 }]));

      await expect(
        service.updateSession(USER_A, SESSION_ID, { state: to }),
      ).resolves.toBeDefined();
    });

    it('rejects CLOSED → anything', async () => {
      prisma.pokerSession.findUnique.mockResolvedValue(sessionStub(PokerState.CLOSED));

      await expect(
        service.updateSession(USER_A, SESSION_ID, { state: PokerState.VOTING }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ── validateSessionMembership ──────────────────────────────────────────────

  describe('validateSessionMembership', () => {
    it('returns projectId when user is a member', async () => {
      prisma.pokerSession.findUnique.mockResolvedValue({
        projectId: PROJECT_ID,
      });

      const projectId = await service.validateSessionMembership(
        USER_A,
        SESSION_ID,
      );
      expect(projectId).toBe(PROJECT_ID);
    });

    it('throws ForbiddenException when session does not exist', async () => {
      prisma.pokerSession.findUnique.mockResolvedValue(null);

      await expect(
        service.validateSessionMembership(USER_A, SESSION_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws ForbiddenException when user is not a member', async () => {
      prisma.pokerSession.findUnique.mockResolvedValue({
        projectId: PROJECT_ID,
      });
      jest
        .spyOn(membership, 'assertProjectMember')
        .mockRejectedValue(new ForbiddenException('Not a member'));

      await expect(
        service.validateSessionMembership('non-member', SESSION_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // ── removeItem ─────────────────────────────────────────────────────────────

  describe('removeItem', () => {
    it('deletes the item and emits ItemRemoved', async () => {
      prisma.pokerItem.findUnique.mockResolvedValue(makeItem());
      prisma.pokerItem.delete.mockResolvedValue({ id: ITEM_ID });

      const result = await service.removeItem(USER_A, ITEM_ID);
      expect(result).toEqual({ id: ITEM_ID });
      expect(realtime.emitToProject).toHaveBeenCalledWith(
        PROJECT_ID,
        'poker.item.removed',
        expect.objectContaining({ itemId: ITEM_ID }),
      );
    });

    it('rejects removing an item from a CLOSED session', async () => {
      prisma.pokerItem.findUnique.mockResolvedValue(
        makeItem({
          session: { id: SESSION_ID, projectId: PROJECT_ID, state: PokerState.CLOSED },
        }),
      );

      await expect(
        service.removeItem(USER_A, ITEM_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException for unknown item', async () => {
      prisma.pokerItem.findUnique.mockResolvedValue(null);

      await expect(
        service.removeItem(USER_A, ITEM_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
