import { Role } from '@next-lane/shared';
import { resolveAutomationActor } from './automation-actor.util';
import type { PrismaService } from '../prisma/prisma.service';

const WORKSPACE = 'ws-1';
const PROJECT = { id: 'proj-1', workspaceId: WORKSPACE, leadId: 'lead-1' };

/**
 * Mock prisma for getEffectiveProjectRole (membership + projectMembership)
 * and the ADMIN fallback (membership.findMany). `roles` maps userId → their
 * workspace Role (absent = not a member); `overrides` maps userId → their
 * per-project override Role.
 */
function makePrisma(
  roles: Record<string, Role>,
  overrides: Record<string, Role> = {},
) {
  return {
    membership: {
      findUnique: jest.fn(
        ({ where }: { where: { userId_workspaceId: { userId: string } } }) => {
          const role = roles[where.userId_workspaceId.userId];
          return Promise.resolve(role ? { role } : null);
        },
      ),
      findMany: jest.fn(() =>
        Promise.resolve(
          Object.entries(roles)
            .filter(([, r]) => r === Role.ADMIN)
            .map(([userId]) => ({ userId })),
        ),
      ),
    },
    projectMembership: {
      findUnique: jest.fn(
        ({ where }: { where: { projectId_userId: { userId: string } } }) => {
          const role = overrides[where.projectId_userId.userId];
          return Promise.resolve(role ? { role } : null);
        },
      ),
    },
  } as unknown as PrismaService;
}

describe('resolveAutomationActor', () => {
  it('returns the assignee when they are an eligible project MEMBER', async () => {
    const prisma = makePrisma({ 'assignee-1': Role.MEMBER });

    const actor = await resolveAutomationActor(prisma, PROJECT, {
      assigneeId: 'assignee-1',
      reporterId: 'reporter-1',
    });

    expect(actor).toBe('assignee-1');
  });

  it('SKIPS a project-VIEWER-restricted assignee and falls back to the reporter (review follow-up on 71ae9a0)', async () => {
    // Assignee IS a workspace member — the old workspace-membership-only
    // check would have stopped here and the transition would then fail.
    const prisma = makePrisma(
      { 'assignee-1': Role.MEMBER, 'reporter-1': Role.MEMBER },
      { 'assignee-1': Role.VIEWER },
    );

    const actor = await resolveAutomationActor(prisma, PROJECT, {
      assigneeId: 'assignee-1',
      reporterId: 'reporter-1',
    });

    expect(actor).toBe('reporter-1');
  });

  it('skips a workspace VIEWER assignee and reporter, using the project lead', async () => {
    const prisma = makePrisma({
      'assignee-1': Role.VIEWER,
      'reporter-1': Role.VIEWER,
      'lead-1': Role.MEMBER,
    });

    const actor = await resolveAutomationActor(prisma, PROJECT, {
      assigneeId: 'assignee-1',
      reporterId: 'reporter-1',
    });

    expect(actor).toBe('lead-1');
  });

  it('skips removed users (no membership) entirely', async () => {
    const prisma = makePrisma({ 'reporter-1': Role.MEMBER });

    const actor = await resolveAutomationActor(prisma, PROJECT, {
      assigneeId: 'gone-user',
      reporterId: 'reporter-1',
    });

    expect(actor).toBe('reporter-1');
  });

  it('falls back to a workspace ADMIN when no issue-level candidate is eligible', async () => {
    const prisma = makePrisma({
      'assignee-1': Role.VIEWER,
      'admin-1': Role.ADMIN,
    });

    const actor = await resolveAutomationActor(
      prisma,
      { ...PROJECT, leadId: null },
      { assigneeId: 'assignee-1', reporterId: null },
    );

    expect(actor).toBe('admin-1');
  });

  it('returns null when nobody at all is eligible', async () => {
    const prisma = makePrisma({ 'assignee-1': Role.VIEWER });

    const actor = await resolveAutomationActor(
      prisma,
      { ...PROJECT, leadId: null },
      { assigneeId: 'assignee-1', reporterId: null },
    );

    expect(actor).toBeNull();
  });
});
