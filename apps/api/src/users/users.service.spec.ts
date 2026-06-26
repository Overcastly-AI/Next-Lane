import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * DB-free unit tests for UsersService.findOne — the co-member authorization
 * guard that stops any authenticated user from fetching another tenant's user
 * (name/email/avatar) by id. Prisma lookups are mocked.
 */

const CALLER_ID = 'caller-1';
const CO_MEMBER_ID = 'co-1';
const STRANGER_ID = 'stranger-1';

function makePrisma() {
  return {
    membership: { findMany: jest.fn() },
    user: { findUnique: jest.fn(), findFirst: jest.fn() },
  } as unknown as PrismaService & {
    membership: { findMany: jest.Mock };
    user: { findUnique: jest.Mock; findFirst: jest.Mock };
  };
}

type MockPrisma = ReturnType<typeof makePrisma>;

function makeUser(id: string) {
  return {
    id,
    name: 'Name ' + id,
    email: id + '@example.com',
    avatarColor: '#abcdef',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

describe('UsersService.findOne', () => {
  let prisma: MockPrisma;
  let service: UsersService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new UsersService(prisma);
  });

  it('lets the caller fetch themselves without a co-member lookup', async () => {
    prisma.user.findUnique.mockResolvedValue(makeUser(CALLER_ID));

    const result = await service.findOne(CALLER_ID, CALLER_ID);

    expect(result.id).toBe(CALLER_ID);
    expect(prisma.membership.findMany).not.toHaveBeenCalled();
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('returns a user who shares a workspace with the caller', async () => {
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
    prisma.user.findFirst.mockResolvedValue(makeUser(CO_MEMBER_ID));

    const result = await service.findOne(CALLER_ID, CO_MEMBER_ID);

    expect(result.id).toBe(CO_MEMBER_ID);
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        id: CO_MEMBER_ID,
        memberships: { some: { workspaceId: { in: ['ws-1'] } } },
      },
    });
  });

  it('throws NotFound for a user who shares no workspace (cross-tenant)', async () => {
    prisma.membership.findMany.mockResolvedValue([{ workspaceId: 'ws-1' }]);
    // The scoped query returns null because the stranger is not a co-member.
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(
      service.findOne(CALLER_ID, STRANGER_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws NotFound when fetching self that no longer exists', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.findOne(CALLER_ID, CALLER_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
