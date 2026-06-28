/**
 * Unit tests for AuthService.updateProfile.
 *
 * The method updates a user's mutable profile fields (name, emailNotifications)
 * and returns the updated UserDto. PrismaService is mocked — no real DB.
 */

import { AuthService } from './auth.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { JwtService } from '@nestjs/jwt';

interface MockPrisma {
  user: {
    update: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
  };
}

function makePrisma(): MockPrisma {
  return {
    user: {
      update: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };
}

function makeUserRow(overrides: Partial<{
  id: string;
  email: string;
  name: string;
  avatarColor: string;
  emailNotifications: boolean;
  createdAt: Date;
}> = {}) {
  return {
    id: 'u-1',
    email: 'alice@acme.dev',
    name: 'Alice',
    passwordHash: '$argon2...',
    avatarColor: '#6366f1',
    emailNotifications: true,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('AuthService.updateProfile', () => {
  let prisma: MockPrisma;
  let service: AuthService;

  beforeEach(() => {
    prisma = makePrisma();
    // JwtService is not exercised by updateProfile; provide a minimal stub.
    const jwtStub = { sign: jest.fn() } as unknown as JwtService;
    service = new AuthService(
      prisma as unknown as PrismaService,
      jwtStub,
    );
  });

  it('updates only name when emailNotifications is not provided', async () => {
    const updated = makeUserRow({ name: 'Alice Updated' });
    prisma.user.update.mockResolvedValue(updated);

    const result = await service.updateProfile('u-1', { name: 'Alice Updated' });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: { name: 'Alice Updated' },
    });
    expect(result.name).toBe('Alice Updated');
  });

  it('updates only emailNotifications when name is not provided', async () => {
    const updated = makeUserRow({ emailNotifications: false });
    prisma.user.update.mockResolvedValue(updated);

    const result = await service.updateProfile('u-1', {
      emailNotifications: false,
    });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: { emailNotifications: false },
    });
    expect(result.emailNotifications).toBe(false);
  });

  it('updates both fields when both are provided', async () => {
    const updated = makeUserRow({ name: 'Bob', emailNotifications: false });
    prisma.user.update.mockResolvedValue(updated);

    const result = await service.updateProfile('u-1', {
      name: 'Bob',
      emailNotifications: false,
    });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: { name: 'Bob', emailNotifications: false },
    });
    expect(result.name).toBe('Bob');
    expect(result.emailNotifications).toBe(false);
  });

  it('passes an empty data object when the DTO is empty (no-op patch)', async () => {
    const updated = makeUserRow();
    prisma.user.update.mockResolvedValue(updated);

    await service.updateProfile('u-1', {});

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: {},
    });
  });

  it('returns a UserDto with emailNotifications included', async () => {
    const updated = makeUserRow({ emailNotifications: true });
    prisma.user.update.mockResolvedValue(updated);

    const result = await service.updateProfile('u-1', {});

    expect(result).toMatchObject({
      id: 'u-1',
      email: 'alice@acme.dev',
      name: 'Alice',
      emailNotifications: true,
    });
    // createdAt must be an ISO string
    expect(typeof result.createdAt).toBe('string');
    expect(result.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
