/**
 * DB-free unit tests for IssueLinksService.
 *
 * Covers:
 *  - create: canonical normalization (inverse types swap source/target correctly)
 *  - create: self-link rejected with BadRequestException
 *  - create: duplicate link rejected with ConflictException
 *  - create: inverse-duplicate rejected with ConflictException
 *  - create: cross-project target rejected with NotFoundException
 *  - create: non-member rejected with ForbiddenException
 *  - create: target not found rejected with NotFoundException
 *  - create: resolves target by issue key (e.g. "NL-5")
 *  - create: resolves target by id
 *  - findAll: resolves perspective + type correctly for source-side link
 *  - findAll: resolves perspective + type (inverse) correctly for target-side link
 *  - findAll: VIEWER can read links
 *  - delete: removes the link
 *  - delete: 404 for missing link
 *  - delete: non-member rejected
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { IssueLinkType, ISSUE_LINK_INVERSE, ISSUE_LINK_TYPE_LABELS, Role } from '@next-lane/shared';
import { IssueLinksService, toIssueLinkDto } from './issue-links.service';
import type { PrismaService } from '../prisma/prisma.service';

// ── constants ─────────────────────────────────────────────────────────────────

const WS_ID = 'ws-1';
const PROJ_ID = 'proj-1';
const PROJ_KEY = 'NL';
const OTHER_PROJ_ID = 'proj-2';

const SOURCE_ID = 'issue-source';
const TARGET_ID = 'issue-target';
const LINK_ID = 'link-1';

const MEMBER_ID = 'user-member';
const VIEWER_ID = 'user-viewer';
const OUTSIDER_ID = 'user-outsider';

// ── factories ─────────────────────────────────────────────────────────────────

function makeIssueRef(
  id: string,
  number: number,
  projectId = PROJ_ID,
): { id: string; number: number; type: string; title: string; statusId: string; projectId: string; project: { key: string } | null; status: null } {
  return {
    id,
    number,
    type: 'TASK',
    title: `Issue ${number}`,
    statusId: 'status-1',
    projectId,
    project: projectId === PROJ_ID ? { key: PROJ_KEY } : { key: 'OTHER' },
    status: null,
  };
}

function makeLinkRow(
  overrides: {
    id?: string;
    sourceId?: string;
    targetId?: string;
    type?: IssueLinkType;
  } = {},
) {
  const sourceId = overrides.sourceId ?? SOURCE_ID;
  const targetId = overrides.targetId ?? TARGET_ID;
  const type = overrides.type ?? IssueLinkType.BLOCKS;
  return {
    id: overrides.id ?? LINK_ID,
    sourceId,
    targetId,
    type,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    source: makeIssueRef(sourceId, 1),
    target: makeIssueRef(targetId, 2),
  };
}

function makeProject(id = PROJ_ID) {
  return {
    id,
    key: id === PROJ_ID ? PROJ_KEY : 'OTHER',
    workspaceId: WS_ID,
    name: 'Test Project',
    description: null,
    leadId: null,
    archived: false,
    issueSeq: 10,
    createdAt: new Date(),
    updatedAt: new Date(),
    workspace: { id: WS_ID, name: 'WS', slug: 'ws', createdAt: new Date(), updatedAt: new Date() },
  };
}

function makeMembership(role: Role, userId: string) {
  return { id: 'mem-1', role, userId, workspaceId: WS_ID, createdAt: new Date() };
}

/**
 * Build a minimal PrismaService mock. opts lets individual tests override
 * specific behaviours without rewriting the whole mock.
 */
function makePrisma(opts: {
  sourceProjId?: string;
  targetProjId?: string;
  targetId?: string;
  memberRole?: Role;
  issueFindUnique?: jest.Mock;
  linkFindUnique?: jest.Mock;
  linkFindFirst?: jest.Mock;
  linkCreate?: jest.Mock;
  linkDelete?: jest.Mock;
  existingLink?: object | null;
  existingSwapped?: object | null;
} = {}) {
  const {
    sourceProjId = PROJ_ID,
    targetProjId = PROJ_ID,
    targetId: resolvedTargetId = TARGET_ID,
    memberRole = Role.MEMBER,
    existingLink = null,
    existingSwapped = null,
  } = opts;

  const sourceRow = {
    id: SOURCE_ID,
    projectId: sourceProjId,
    project: {
      id: sourceProjId,
      key: sourceProjId === PROJ_ID ? PROJ_KEY : 'OTHER',
      workspaceId: WS_ID,
    },
  };
  const targetRow = { id: resolvedTargetId, projectId: targetProjId };

  const issueFindUnique =
    opts.issueFindUnique ??
    jest.fn().mockImplementation(({ where }: { where: { id?: string; projectId_number?: { projectId: string; number: number } } }) => {
      if (where.id === SOURCE_ID) return Promise.resolve(sourceRow);
      if (where.id === TARGET_ID || where.id === resolvedTargetId)
        return Promise.resolve(targetRow);
      if (where.projectId_number) {
        const { projectId, number } = where.projectId_number;
        if (projectId === PROJ_ID && number === 2)
          return Promise.resolve(targetRow);
      }
      return Promise.resolve(null);
    });

  const projectFindUnique = jest.fn().mockImplementation(({ where }: { where: { id?: string } }) => {
    if (where.id === PROJ_ID || where.id === sourceProjId)
      return Promise.resolve(makeProject(PROJ_ID));
    if (where.id === OTHER_PROJ_ID || where.id === targetProjId)
      return Promise.resolve(makeProject(OTHER_PROJ_ID));
    return Promise.resolve(null);
  });

  const projectFindFirst = jest.fn().mockImplementation(({ where }: { where: { key?: string; workspaceId?: string } }) => {
    if (where.key === PROJ_KEY) return Promise.resolve({ id: PROJ_ID });
    if (where.key === 'OTHER') return Promise.resolve({ id: OTHER_PROJ_ID });
    return Promise.resolve(null);
  });

  const membershipFindUnique = jest.fn().mockImplementation(({ where }: { where: { userId_workspaceId: { userId: string } } }) => {
    const uid = where.userId_workspaceId.userId;
    if (uid === MEMBER_ID) return Promise.resolve(makeMembership(Role.MEMBER, uid));
    if (uid === VIEWER_ID) return Promise.resolve(makeMembership(Role.VIEWER, uid));
    return Promise.resolve(null);
  });

  // For findAll, return two links: one where SOURCE_ID is source, one where it is target
  const twoLinks = [
    makeLinkRow({ sourceId: SOURCE_ID, targetId: TARGET_ID, type: IssueLinkType.BLOCKS }),
    makeLinkRow({ id: 'link-2', sourceId: TARGET_ID, targetId: SOURCE_ID, type: IssueLinkType.BLOCKS }),
  ];

  const linkFindMany = jest.fn().mockResolvedValue(twoLinks);

  const linkFindUnique =
    opts.linkFindUnique ??
    jest.fn().mockImplementation(({ where }: { where: { id?: string; sourceId_targetId_type?: object } }) => {
      if (where.id) {
        return Promise.resolve(
          where.id === LINK_ID
            ? {
                id: LINK_ID,
                sourceId: SOURCE_ID,
                source: { projectId: PROJ_ID },
              }
            : null,
        );
      }
      // uniqueness check
      return Promise.resolve(existingLink);
    });

  const linkFindFirst =
    opts.linkFindFirst ?? jest.fn().mockResolvedValue(existingSwapped);

  const createdLinkRow = makeLinkRow({ type: IssueLinkType.BLOCKS });
  const linkCreate =
    opts.linkCreate ?? jest.fn().mockResolvedValue(createdLinkRow);

  const linkDelete = opts.linkDelete ?? jest.fn().mockResolvedValue(makeLinkRow());

  return {
    issue: { findUnique: issueFindUnique },
    project: {
      findUnique: projectFindUnique,
      findFirst: projectFindFirst,
    },
    membership: { findUnique: membershipFindUnique },
    issueLink: {
      findUnique: linkFindUnique,
      findFirst: linkFindFirst,
      findMany: linkFindMany,
      create: linkCreate,
      delete: linkDelete,
    },
  } as unknown as PrismaService;
}

function makeService(prisma: PrismaService) {
  return new IssueLinksService(prisma);
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('IssueLinksService', () => {
  // ── toIssueLinkDto mapper ──────────────────────────────────────────────────

  describe('toIssueLinkDto()', () => {
    const link = makeLinkRow({ type: IssueLinkType.BLOCKS });

    it('returns stored type + source-perspective relatedIssue when viewer is source', () => {
      const dto = toIssueLinkDto(link, SOURCE_ID);
      expect(dto.type).toBe(IssueLinkType.BLOCKS);
      expect(dto.label).toBe(ISSUE_LINK_TYPE_LABELS[IssueLinkType.BLOCKS]);
      expect(dto.relatedIssue.id).toBe(TARGET_ID);
    });

    it('returns inverse type + target-perspective relatedIssue when viewer is target', () => {
      const dto = toIssueLinkDto(link, TARGET_ID);
      expect(dto.type).toBe(IssueLinkType.BLOCKED_BY);
      expect(dto.label).toBe(ISSUE_LINK_TYPE_LABELS[IssueLinkType.BLOCKED_BY]);
      expect(dto.relatedIssue.id).toBe(SOURCE_ID);
    });

    it('RELATES_TO stays RELATES_TO for source viewer', () => {
      const l = makeLinkRow({ type: IssueLinkType.RELATES_TO });
      const dto = toIssueLinkDto(l, SOURCE_ID);
      expect(dto.type).toBe(IssueLinkType.RELATES_TO);
    });

    it('RELATES_TO stays RELATES_TO for target viewer (symmetric inverse)', () => {
      const l = makeLinkRow({ type: IssueLinkType.RELATES_TO });
      const dto = toIssueLinkDto(l, TARGET_ID);
      expect(dto.type).toBe(
        ISSUE_LINK_INVERSE[IssueLinkType.RELATES_TO],
      );
      expect(dto.type).toBe(IssueLinkType.RELATES_TO);
    });

    it('DUPLICATES stored: source sees DUPLICATES, target sees DUPLICATED_BY', () => {
      const l = makeLinkRow({ type: IssueLinkType.DUPLICATES });
      expect(toIssueLinkDto(l, SOURCE_ID).type).toBe(IssueLinkType.DUPLICATES);
      expect(toIssueLinkDto(l, TARGET_ID).type).toBe(IssueLinkType.DUPLICATED_BY);
    });

    it('builds relatedIssue key as PROJECT_KEY-number', () => {
      const dto = toIssueLinkDto(link, SOURCE_ID);
      // target is makeIssueRef(TARGET_ID, 2) with project.key = PROJ_KEY
      expect(dto.relatedIssue.key).toBe(`${PROJ_KEY}-2`);
    });

    it('sets createdAt as ISO string', () => {
      const dto = toIssueLinkDto(link, SOURCE_ID);
      expect(dto.createdAt).toBe('2026-01-01T00:00:00.000Z');
    });
  });

  // ── create ─────────────────────────────────────────────────────────────────

  describe('create()', () => {
    it('stores BLOCKS as-is when caller passes BLOCKS', async () => {
      const prisma = makePrisma();
      const svc = makeService(prisma);

      await svc.create(MEMBER_ID, SOURCE_ID, { target: TARGET_ID, type: IssueLinkType.BLOCKS });

      const createArgs = (prisma.issueLink.create as jest.Mock).mock.calls[0][0];
      expect(createArgs.data.type).toBe(IssueLinkType.BLOCKS);
      expect(createArgs.data.sourceId).toBe(SOURCE_ID);
      expect(createArgs.data.targetId).toBe(TARGET_ID);
    });

    it('normalizes BLOCKED_BY → BLOCKS with source/target swapped', async () => {
      const prisma = makePrisma();
      const svc = makeService(prisma);

      await svc.create(MEMBER_ID, SOURCE_ID, { target: TARGET_ID, type: IssueLinkType.BLOCKED_BY });

      const createArgs = (prisma.issueLink.create as jest.Mock).mock.calls[0][0];
      expect(createArgs.data.type).toBe(IssueLinkType.BLOCKS);
      expect(createArgs.data.sourceId).toBe(TARGET_ID); // swapped
      expect(createArgs.data.targetId).toBe(SOURCE_ID); // swapped
    });

    it('normalizes DUPLICATED_BY → DUPLICATES with source/target swapped', async () => {
      const prisma = makePrisma();
      const svc = makeService(prisma);

      await svc.create(MEMBER_ID, SOURCE_ID, { target: TARGET_ID, type: IssueLinkType.DUPLICATED_BY });

      const createArgs = (prisma.issueLink.create as jest.Mock).mock.calls[0][0];
      expect(createArgs.data.type).toBe(IssueLinkType.DUPLICATES);
      expect(createArgs.data.sourceId).toBe(TARGET_ID);
      expect(createArgs.data.targetId).toBe(SOURCE_ID);
    });

    it('stores CLONES as-is (canonical, no swap)', async () => {
      const prisma = makePrisma();
      const svc = makeService(prisma);

      await svc.create(MEMBER_ID, SOURCE_ID, { target: TARGET_ID, type: IssueLinkType.CLONES });

      const createArgs = (prisma.issueLink.create as jest.Mock).mock.calls[0][0];
      expect(createArgs.data.type).toBe(IssueLinkType.CLONES);
      expect(createArgs.data.sourceId).toBe(SOURCE_ID);
    });

    it('stores RELATES_TO with source=:id (symmetric, no swap)', async () => {
      const prisma = makePrisma();
      const svc = makeService(prisma);

      await svc.create(MEMBER_ID, SOURCE_ID, { target: TARGET_ID, type: IssueLinkType.RELATES_TO });

      const createArgs = (prisma.issueLink.create as jest.Mock).mock.calls[0][0];
      expect(createArgs.data.type).toBe(IssueLinkType.RELATES_TO);
      expect(createArgs.data.sourceId).toBe(SOURCE_ID);
    });

    it('returns the created link resolved from caller\'s perspective', async () => {
      const prisma = makePrisma();
      const svc = makeService(prisma);

      const result = await svc.create(MEMBER_ID, SOURCE_ID, { target: TARGET_ID, type: IssueLinkType.BLOCKS });

      expect(result.type).toBe(IssueLinkType.BLOCKS);
      expect(result.relatedIssue.id).toBe(TARGET_ID);
    });

    it('returns BLOCKED_BY perspective when caller passed BLOCKED_BY (normalized internally)', async () => {
      // The created row stores BLOCKS(target→source). From caller's (:id=SOURCE_ID)
      // perspective, viewer is the target of the stored link → BLOCKED_BY.
      const swappedRow = makeLinkRow({
        sourceId: TARGET_ID,
        targetId: SOURCE_ID,
        type: IssueLinkType.BLOCKS,
      });
      const prisma = makePrisma({
        linkCreate: jest.fn().mockResolvedValue(swappedRow),
      });
      const svc = makeService(prisma);

      const result = await svc.create(MEMBER_ID, SOURCE_ID, { target: TARGET_ID, type: IssueLinkType.BLOCKED_BY });

      expect(result.type).toBe(IssueLinkType.BLOCKED_BY);
      expect(result.relatedIssue.id).toBe(TARGET_ID);
    });

    it('throws BadRequestException for self-link', async () => {
      const prisma = makePrisma({
        issueFindUnique: jest.fn().mockResolvedValue({
          id: SOURCE_ID,
          projectId: PROJ_ID,
          project: { id: PROJ_ID, key: PROJ_KEY, workspaceId: WS_ID },
        }),
      });
      const svc = makeService(prisma);

      await expect(
        svc.create(MEMBER_ID, SOURCE_ID, { target: SOURCE_ID, type: IssueLinkType.BLOCKS }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when the exact link already exists', async () => {
      const prisma = makePrisma({ existingLink: { id: LINK_ID } });
      const svc = makeService(prisma);

      await expect(
        svc.create(MEMBER_ID, SOURCE_ID, { target: TARGET_ID, type: IssueLinkType.BLOCKS }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when the swapped link already exists (inverse duplicate)', async () => {
      const prisma = makePrisma({ existingSwapped: { id: 'link-swap' } });
      const svc = makeService(prisma);

      await expect(
        svc.create(MEMBER_ID, SOURCE_ID, { target: TARGET_ID, type: IssueLinkType.BLOCKS }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when target belongs to a different project', async () => {
      const prisma = makePrisma({ targetProjId: OTHER_PROJ_ID });
      const svc = makeService(prisma);

      await expect(
        svc.create(MEMBER_ID, SOURCE_ID, { target: TARGET_ID, type: IssueLinkType.BLOCKS }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException for a non-member', async () => {
      const prisma = makePrisma();
      const svc = makeService(prisma);

      await expect(
        svc.create(OUTSIDER_ID, SOURCE_ID, { target: TARGET_ID, type: IssueLinkType.BLOCKS }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when target id does not exist', async () => {
      const prisma = makePrisma({
        issueFindUnique: jest.fn().mockImplementation(({ where }: { where: { id?: string; projectId_number?: object } }) => {
          if (where.id === SOURCE_ID)
            return Promise.resolve({
              id: SOURCE_ID,
              projectId: PROJ_ID,
              project: { id: PROJ_ID, key: PROJ_KEY, workspaceId: WS_ID },
            });
          return Promise.resolve(null);
        }),
      });
      const svc = makeService(prisma);

      await expect(
        svc.create(MEMBER_ID, SOURCE_ID, { target: 'nonexistent-id', type: IssueLinkType.BLOCKS }),
      ).rejects.toThrow(NotFoundException);
    });

    it('resolves target by issue key matching the source project (e.g. "NL-2")', async () => {
      const prisma = makePrisma();
      const svc = makeService(prisma);

      await svc.create(MEMBER_ID, SOURCE_ID, { target: 'NL-2', type: IssueLinkType.BLOCKS });

      // The key matches the source project, so no cross-project lookup is needed.
      expect(prisma.project.findFirst as jest.Mock).not.toHaveBeenCalled();
      // issueFindUnique was called with projectId_number scoped to the source project.
      expect(prisma.issue.findUnique as jest.Mock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { projectId_number: { projectId: PROJ_ID, number: 2 } },
        }),
      );
    });

    it('resolves a lowercase issue key ("nl-2")', async () => {
      const prisma = makePrisma();
      const svc = makeService(prisma);

      await svc.create(MEMBER_ID, SOURCE_ID, { target: 'nl-2', type: IssueLinkType.BLOCKS });

      expect(prisma.issue.findUnique as jest.Mock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { projectId_number: { projectId: PROJ_ID, number: 2 } },
        }),
      );
    });

    it('resolves a key whose PROJECT KEY itself contains hyphens (e.g. "NEXT-LANE-2")', async () => {
      // Project keys are only length-constrained, so they can contain hyphens;
      // the resolver must split on the LAST hyphen, not the first.
      const issueFindUnique = jest
        .fn()
        .mockImplementation(
          ({ where }: { where: { id?: string; projectId_number?: { projectId: string; number: number } } }) => {
            if (where.id === SOURCE_ID)
              return Promise.resolve({
                id: SOURCE_ID,
                projectId: PROJ_ID,
                project: { id: PROJ_ID, key: 'NEXT-LANE', workspaceId: WS_ID },
              });
            if (where.projectId_number?.projectId === PROJ_ID && where.projectId_number?.number === 2)
              return Promise.resolve({ id: TARGET_ID, projectId: PROJ_ID });
            return Promise.resolve(null);
          },
        );
      const prisma = makePrisma({ issueFindUnique });
      const svc = makeService(prisma);

      await expect(
        svc.create(MEMBER_ID, SOURCE_ID, { target: 'NEXT-LANE-2', type: IssueLinkType.BLOCKS }),
      ).resolves.toBeDefined();

      expect(issueFindUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { projectId_number: { projectId: PROJ_ID, number: 2 } },
        }),
      );
    });

    it('resolves a same-workspace cross-project key via a workspace-scoped lookup', async () => {
      // A key for a different project in the same workspace is resolved through
      // project.findFirst (scoped to the workspace); the same-project guard then
      // rejects it as not in the source project.
      const prisma = makePrisma();
      const svc = makeService(prisma);

      await expect(
        svc.create(MEMBER_ID, SOURCE_ID, { target: 'OTHER-2', type: IssueLinkType.BLOCKS }),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.project.findFirst as jest.Mock).toHaveBeenCalledWith(
        expect.objectContaining({ where: { workspaceId: WS_ID, key: 'OTHER' } }),
      );
    });

    it('resolves target by bare id', async () => {
      const prisma = makePrisma();
      const svc = makeService(prisma);

      await svc.create(MEMBER_ID, SOURCE_ID, { target: TARGET_ID, type: IssueLinkType.BLOCKS });

      // Should NOT have called projectFindFirst (no key pattern match)
      expect(prisma.project.findFirst as jest.Mock).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when source issue not found', async () => {
      const prisma = makePrisma({
        issueFindUnique: jest.fn().mockResolvedValue(null),
      });
      const svc = makeService(prisma);

      await expect(
        svc.create(MEMBER_ID, SOURCE_ID, { target: TARGET_ID, type: IssueLinkType.BLOCKS }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── findAll ────────────────────────────────────────────────────────────────

  describe('findAll()', () => {
    it('resolves source-side link with stored type', async () => {
      const prisma = makePrisma();
      const svc = makeService(prisma);

      const results = await svc.findAll(MEMBER_ID, SOURCE_ID);

      // First link: SOURCE_ID is source → type = BLOCKS
      const sourceLink = results.find((r) => r.relatedIssue.id === TARGET_ID);
      expect(sourceLink).toBeDefined();
      expect(sourceLink!.type).toBe(IssueLinkType.BLOCKS);
      expect(sourceLink!.label).toBe(ISSUE_LINK_TYPE_LABELS[IssueLinkType.BLOCKS]);
    });

    it('resolves target-side link with inverse type', async () => {
      const prisma = makePrisma();
      const svc = makeService(prisma);

      const results = await svc.findAll(MEMBER_ID, SOURCE_ID);

      // Second link: SOURCE_ID is target of BLOCKS(TARGET→SOURCE) → BLOCKED_BY
      const targetLink = results.find((r) => r.relatedIssue.id === TARGET_ID);
      // There are two links both pointing to TARGET_ID, one from source perspective
      // and one from target perspective. Check both perspectives appear.
      const types = results.map((r) => r.type);
      expect(types).toContain(IssueLinkType.BLOCKS);
      expect(types).toContain(IssueLinkType.BLOCKED_BY);
    });

    it('allows VIEWER to read links', async () => {
      const prisma = makePrisma();
      // Override membership to return VIEWER
      (prisma.membership.findUnique as jest.Mock).mockResolvedValue(
        makeMembership(Role.VIEWER, VIEWER_ID),
      );
      const svc = makeService(prisma);

      await expect(svc.findAll(VIEWER_ID, SOURCE_ID)).resolves.toBeDefined();
    });

    it('throws ForbiddenException for a non-member', async () => {
      const prisma = makePrisma();
      (prisma.membership.findUnique as jest.Mock).mockResolvedValue(null);
      const svc = makeService(prisma);

      await expect(svc.findAll(OUTSIDER_ID, SOURCE_ID)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws NotFoundException when issue does not exist', async () => {
      const prisma = makePrisma({
        issueFindUnique: jest.fn().mockResolvedValue(null),
      });
      const svc = makeService(prisma);

      await expect(svc.findAll(MEMBER_ID, SOURCE_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── remove ─────────────────────────────────────────────────────────────────

  describe('remove()', () => {
    it('deletes the link and returns its id', async () => {
      const prisma = makePrisma();
      const svc = makeService(prisma);

      const result = await svc.remove(MEMBER_ID, LINK_ID);

      expect(result).toEqual({ id: LINK_ID });
      expect(prisma.issueLink.delete as jest.Mock).toHaveBeenCalledWith({
        where: { id: LINK_ID },
      });
    });

    it('throws NotFoundException for a missing link', async () => {
      const prisma = makePrisma({
        linkFindUnique: jest.fn().mockResolvedValue(null),
      });
      const svc = makeService(prisma);

      await expect(svc.remove(MEMBER_ID, 'nonexistent-link')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException for a non-member', async () => {
      const prisma = makePrisma();
      (prisma.membership.findUnique as jest.Mock).mockResolvedValue(null);
      const svc = makeService(prisma);

      await expect(svc.remove(OUTSIDER_ID, LINK_ID)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException for a VIEWER attempting delete', async () => {
      const prisma = makePrisma();
      // Override membership to VIEWER for the auth check inside assertProjectRole
      (prisma.membership.findUnique as jest.Mock).mockResolvedValue(
        makeMembership(Role.VIEWER, VIEWER_ID),
      );
      const svc = makeService(prisma);

      await expect(svc.remove(VIEWER_ID, LINK_ID)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
