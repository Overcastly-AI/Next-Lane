/**
 * Unit tests for the shared SSO/OIDC Phase 2 JIT-provisioning helper, used
 * identically by the legacy `OidcService` and the new `SsoService`.
 */
import { Role } from '@next-lane/shared';
import { provisionJitMembership } from './sso-jit-provisioning.util';
import type { PrismaService } from '../prisma/prisma.service';

interface MockPrisma {
  workspace: { findUnique: jest.Mock };
  membership: { upsert: jest.Mock };
}

function makePrisma(): MockPrisma {
  return {
    workspace: { findUnique: jest.fn() },
    membership: { upsert: jest.fn() },
  };
}

describe('provisionJitMembership', () => {
  it('no-ops when jitDefaultWorkspaceId is null (JIT off — the default)', async () => {
    const prisma = makePrisma();
    await provisionJitMembership(prisma as unknown as PrismaService, 'u-1', {
      jitDefaultWorkspaceId: null,
      jitDefaultRole: Role.VIEWER,
    });
    expect(prisma.workspace.findUnique).not.toHaveBeenCalled();
    expect(prisma.membership.upsert).not.toHaveBeenCalled();
  });

  it('no-ops when the referenced workspace no longer exists (defensive)', async () => {
    const prisma = makePrisma();
    prisma.workspace.findUnique.mockResolvedValue(null);
    await provisionJitMembership(prisma as unknown as PrismaService, 'u-1', {
      jitDefaultWorkspaceId: 'ws-deleted',
      jitDefaultRole: Role.VIEWER,
    });
    expect(prisma.membership.upsert).not.toHaveBeenCalled();
  });

  it('creates a membership at the configured role when the workspace exists', async () => {
    const prisma = makePrisma();
    prisma.workspace.findUnique.mockResolvedValue({ id: 'ws-1' });
    await provisionJitMembership(prisma as unknown as PrismaService, 'u-1', {
      jitDefaultWorkspaceId: 'ws-1',
      jitDefaultRole: Role.MEMBER,
    });
    expect(prisma.membership.upsert).toHaveBeenCalledWith({
      where: { userId_workspaceId: { userId: 'u-1', workspaceId: 'ws-1' } },
      update: {},
      create: { userId: 'u-1', workspaceId: 'ws-1', role: Role.MEMBER },
    });
  });

  it('is idempotent — upsert never clobbers an existing membership', async () => {
    const prisma = makePrisma();
    prisma.workspace.findUnique.mockResolvedValue({ id: 'ws-1' });
    await provisionJitMembership(prisma as unknown as PrismaService, 'u-1', {
      jitDefaultWorkspaceId: 'ws-1',
      jitDefaultRole: Role.ADMIN,
    });
    const call = prisma.membership.upsert.mock.calls[0][0] as { update: unknown };
    expect(call.update).toEqual({});
  });
});
