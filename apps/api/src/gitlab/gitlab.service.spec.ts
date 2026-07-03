import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role, SocketEvents } from '@next-lane/shared';
import * as membership from '../common/membership.util';
import { GitlabService } from './gitlab.service';
import { decryptGitlabToken } from './gitlab-crypto.util';
import type { PrismaService } from '../prisma/prisma.service';
import type { RealtimeService } from '../realtime/realtime.service';
import type { AuditService } from '../audit/audit.service';

const PROJECT_ID = 'project-1';
const OTHER_PROJECT_ID = 'project-2';

function makePrisma() {
  return {
    membership: { findUnique: jest.fn() },
    // getEffectiveProjectRole consults the override table; null = inherit.
    projectMembership: { findUnique: jest.fn().mockResolvedValue(null) },
    project: { findUnique: jest.fn() },
    gitlabIntegration: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    issue: { findUnique: jest.fn(), findFirst: jest.fn() },
    issueGitlabLink: { findMany: jest.fn(), upsert: jest.fn() },
  };
}
type MockPrisma = ReturnType<typeof makePrisma>;

const mockAudit: Pick<AuditService, 'record'> = { record: jest.fn() };
const mockRealtime: Pick<RealtimeService, 'emitToProject'> = {
  emitToProject: jest.fn(),
};

function integrationRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'gli-1',
    projectId: PROJECT_ID,
    gitlabBaseUrl: 'https://gitlab.com',
    projectPath: 'acme/widgets',
    tokenEncrypted: 'irrelevant-for-most-tests',
    webhookSecret: 'the-webhook-secret',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('GitlabService', () => {
  let prisma: MockPrisma;
  let service: GitlabService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new GitlabService(
      prisma as unknown as PrismaService,
      mockRealtime as unknown as RealtimeService,
      mockAudit as unknown as AuditService,
    );
    jest.clearAllMocks();
  });

  afterEach(() => jest.restoreAllMocks());

  // ---- get() ----------------------------------------------------------------

  describe('get', () => {
    it('returns null when not configured', async () => {
      jest
        .spyOn(membership, 'assertProjectMember')
        .mockResolvedValue({ workspaceId: 'ws-1' } as never);
      prisma.membership.findUnique.mockResolvedValue({ role: Role.MEMBER });
      prisma.gitlabIntegration.findUnique.mockResolvedValue(null);

      const result = await service.get('user-1', PROJECT_ID);
      expect(result).toBeNull();
    });

    it('includes webhookSecret for an ADMIN caller', async () => {
      jest
        .spyOn(membership, 'assertProjectMember')
        .mockResolvedValue({ workspaceId: 'ws-1' } as never);
      prisma.membership.findUnique.mockResolvedValue({ role: Role.ADMIN });
      prisma.gitlabIntegration.findUnique.mockResolvedValue(integrationRow());

      const result = await service.get('user-1', PROJECT_ID);
      expect(result?.webhookSecret).toBe('the-webhook-secret');
      expect(result?.projectPath).toBe('acme/widgets');
      expect(result?.gitlabBaseUrl).toBe('https://gitlab.com');
      expect(result?.hasToken).toBe(true);
    });

    it('includes webhookSecret for a project-ADMIN-via-override caller (workspace MEMBER)', async () => {
      jest
        .spyOn(membership, 'assertProjectMember')
        .mockResolvedValue({ workspaceId: 'ws-1' } as never);
      prisma.membership.findUnique.mockResolvedValue({ role: Role.MEMBER });
      prisma.projectMembership.findUnique.mockResolvedValue({
        role: Role.ADMIN,
      });
      prisma.gitlabIntegration.findUnique.mockResolvedValue(integrationRow());

      const result = await service.get('user-1', PROJECT_ID);
      expect(result?.webhookSecret).toBe('the-webhook-secret');
    });

    it('omits webhookSecret for a MEMBER caller (read-only summary)', async () => {
      jest
        .spyOn(membership, 'assertProjectMember')
        .mockResolvedValue({ workspaceId: 'ws-1' } as never);
      prisma.membership.findUnique.mockResolvedValue({ role: Role.MEMBER });
      prisma.gitlabIntegration.findUnique.mockResolvedValue(integrationRow());

      const result = await service.get('user-1', PROJECT_ID);
      expect(result?.webhookSecret).toBeNull();
      expect(result?.projectPath).toBe('acme/widgets');
    });

    it('rejects when the caller is not a member of the project (tenant isolation)', async () => {
      jest
        .spyOn(membership, 'assertProjectMember')
        .mockRejectedValue(new ForbiddenException());

      await expect(service.get('outsider', OTHER_PROJECT_ID)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.gitlabIntegration.findUnique).not.toHaveBeenCalled();
    });
  });

  // ---- upsert() ---------------------------------------------------------------

  describe('upsert', () => {
    it('requires ADMIN role', async () => {
      jest
        .spyOn(membership, 'assertProjectRole')
        .mockRejectedValue(new ForbiddenException());

      await expect(
        service.upsert('user-1', PROJECT_ID, {
          projectPath: 'acme/widgets',
          token: 'glpat-x',
        } as never),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.gitlabIntegration.create).not.toHaveBeenCalled();
    });

    it('creates a new integration with a generated webhookSecret, default gitlabBaseUrl, and encrypts the token', async () => {
      jest
        .spyOn(membership, 'assertProjectRole')
        .mockResolvedValue({ workspaceId: 'ws-1' } as never);
      prisma.gitlabIntegration.findUnique.mockResolvedValue(null);
      prisma.gitlabIntegration.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve(integrationRow({ ...data, id: 'gli-new' })),
      );

      const dto = { projectPath: 'acme/widgets', token: 'glpat_rawTokenValue' };
      const result = await service.upsert('admin-1', PROJECT_ID, dto as never);

      expect(prisma.gitlabIntegration.create).toHaveBeenCalledTimes(1);
      const createArgs = prisma.gitlabIntegration.create.mock.calls[0][0];
      expect(createArgs.data.projectPath).toBe('acme/widgets');
      expect(createArgs.data.gitlabBaseUrl).toBe('https://gitlab.com');
      expect(createArgs.data.tokenEncrypted).not.toBe('glpat_rawTokenValue');
      expect(decryptGitlabToken(createArgs.data.tokenEncrypted)).toBe('glpat_rawTokenValue');
      expect(typeof createArgs.data.webhookSecret).toBe('string');
      expect((createArgs.data.webhookSecret as string).length).toBeGreaterThan(10);

      // Response never leaks the raw token; includes the generated secret (admin path).
      expect(result).not.toHaveProperty('token');
      expect(result.webhookSecret).toBe(createArgs.data.webhookSecret);
    });

    it('honors an explicit self-hosted gitlabBaseUrl and strips a trailing slash', async () => {
      jest
        .spyOn(membership, 'assertProjectRole')
        .mockResolvedValue({ workspaceId: 'ws-1' } as never);
      prisma.gitlabIntegration.findUnique.mockResolvedValue(null);
      prisma.gitlabIntegration.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve(integrationRow({ ...data, id: 'gli-new' })),
      );

      await service.upsert(
        'admin-1',
        PROJECT_ID,
        {
          projectPath: 'acme/widgets',
          gitlabBaseUrl: 'https://gitlab.example.com/',
          token: 'glpat_selfhosted',
        } as never,
      );

      const createArgs = prisma.gitlabIntegration.create.mock.calls[0][0];
      expect(createArgs.data.gitlabBaseUrl).toBe('https://gitlab.example.com');
    });

    it('updates an existing integration WITHOUT rotating webhookSecret', async () => {
      jest
        .spyOn(membership, 'assertProjectRole')
        .mockResolvedValue({ workspaceId: 'ws-1' } as never);
      const existing = integrationRow();
      prisma.gitlabIntegration.findUnique.mockResolvedValue(existing);
      prisma.gitlabIntegration.update.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...existing, ...data }),
      );

      const result = await service.upsert('admin-1', PROJECT_ID, {
        projectPath: 'acme/widgets-renamed',
        token: 'glpat_newTokenValue',
      } as never);

      expect(prisma.gitlabIntegration.create).not.toHaveBeenCalled();
      expect(prisma.gitlabIntegration.update).toHaveBeenCalledTimes(1);
      expect(result.webhookSecret).toBe(existing.webhookSecret);
      expect(result.projectPath).toBe('acme/widgets-renamed');
    });
  });

  // ---- remove() -----------------------------------------------------------

  describe('remove', () => {
    it('requires ADMIN role', async () => {
      jest
        .spyOn(membership, 'assertProjectRole')
        .mockRejectedValue(new ForbiddenException());

      await expect(service.remove('user-1', PROJECT_ID)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.gitlabIntegration.delete).not.toHaveBeenCalled();
    });

    it('404s when not configured', async () => {
      jest
        .spyOn(membership, 'assertProjectRole')
        .mockResolvedValue({ workspaceId: 'ws-1' } as never);
      prisma.gitlabIntegration.findUnique.mockResolvedValue(null);

      await expect(service.remove('admin-1', PROJECT_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('deletes the integration when configured', async () => {
      jest
        .spyOn(membership, 'assertProjectRole')
        .mockResolvedValue({ workspaceId: 'ws-1' } as never);
      prisma.gitlabIntegration.findUnique.mockResolvedValue(integrationRow());
      prisma.gitlabIntegration.delete.mockResolvedValue({});

      const result = await service.remove('admin-1', PROJECT_ID);
      expect(result).toEqual({ ok: true });
      expect(prisma.gitlabIntegration.delete).toHaveBeenCalledWith({
        where: { projectId: PROJECT_ID },
      });
    });
  });

  // ---- listIssueLinks() -----------------------------------------------------

  describe('listIssueLinks', () => {
    it('404s when the issue does not exist', async () => {
      prisma.issue.findUnique.mockResolvedValue(null);
      await expect(service.listIssueLinks('user-1', 'nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects a caller who is not a member of the issue-owning project (tenant isolation)', async () => {
      prisma.issue.findUnique.mockResolvedValue({ projectId: OTHER_PROJECT_ID });
      jest
        .spyOn(membership, 'assertProjectMember')
        .mockRejectedValue(new ForbiddenException());

      await expect(
        service.listIssueLinks('outsider', 'issue-in-other-project'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.issueGitlabLink.findMany).not.toHaveBeenCalled();
    });

    it('returns links for a project member', async () => {
      prisma.issue.findUnique.mockResolvedValue({ projectId: PROJECT_ID });
      jest.spyOn(membership, 'assertProjectMember').mockResolvedValue({} as never);
      prisma.issueGitlabLink.findMany.mockResolvedValue([
        {
          id: 'link-1',
          issueId: 'issue-1',
          kind: 'MR',
          externalId: '42',
          title: 'Fix bug',
          url: 'https://gitlab.com/acme/widgets/-/merge_requests/42',
          state: 'open',
          authorLogin: 'octocat',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const result = await service.listIssueLinks('user-1', 'issue-1');
      expect(result).toHaveLength(1);
      expect(result[0].kind).toBe('MR');
      expect(result[0].externalId).toBe('42');
    });
  });

  // ---- verifyToken() ----------------------------------------------------

  describe('verifyToken', () => {
    it('rejects when no integration is configured for the project', async () => {
      prisma.gitlabIntegration.findUnique.mockResolvedValue(null);
      const result = await service.verifyToken(PROJECT_ID, 'whatever');
      expect(result.ok).toBe(false);
    });

    it('rejects a missing token header', async () => {
      prisma.gitlabIntegration.findUnique.mockResolvedValue(integrationRow());
      const result = await service.verifyToken(PROJECT_ID, undefined);
      expect(result.ok).toBe(false);
    });

    it('rejects an invalid token (wrong value)', async () => {
      prisma.gitlabIntegration.findUnique.mockResolvedValue(integrationRow());
      const result = await service.verifyToken(PROJECT_ID, 'not-the-secret-at-all');
      expect(result.ok).toBe(false);
    });

    it('accepts the exact stored secret (timing-safe compare)', async () => {
      const row = integrationRow();
      prisma.gitlabIntegration.findUnique.mockResolvedValue(row);
      const result = await service.verifyToken(PROJECT_ID, row.webhookSecret);
      expect(result.ok).toBe(true);
    });
  });

  // ---- handlePushEvent() ----------------------------------------------------

  describe('handlePushEvent', () => {
    beforeEach(() => {
      prisma.project.findUnique.mockResolvedValue({ id: PROJECT_ID, key: 'NL' });
    });

    it('upserts a COMMIT link for a single issue key in a commit message (real GitLab Push Hook shape)', async () => {
      prisma.issue.findFirst.mockResolvedValue({ id: 'issue-42' });
      prisma.issueGitlabLink.upsert.mockResolvedValue({});

      const payload = {
        object_kind: 'push',
        event_name: 'push',
        before: '95790bf891e76fee5e1747ab589903a6a1f80f22',
        after: 'da1560886d4f094c3e6c9ef40349f7d38b5d27d7',
        ref: 'refs/heads/feature/no-key-here',
        user_id: 4,
        user_name: 'John Smith',
        user_username: 'jsmith',
        project_id: 15,
        commits: [
          {
            id: 'abc123',
            message: 'Fix crash (NL-42)',
            title: 'Fix crash (NL-42)',
            timestamp: '2011-12-12T14:27:31+02:00',
            url: 'https://gitlab.com/acme/widgets/-/commit/abc123',
            author: { name: 'Jordi Mallach', email: 'jordi@example.com' },
          },
        ],
        total_commits_count: 1,
      };

      const result = await service.handlePushEvent(PROJECT_ID, payload);
      expect(result.linksUpserted).toBe(1);
      expect(prisma.issueGitlabLink.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            issueId_kind_externalId: {
              issueId: 'issue-42',
              kind: 'COMMIT',
              externalId: 'abc123',
            },
          },
          create: expect.objectContaining({ authorLogin: 'Jordi Mallach' }),
        }),
      );
      expect(mockRealtime.emitToProject).toHaveBeenCalledWith(
        PROJECT_ID,
        SocketEvents.IssueUpdated,
        { id: 'issue-42' },
      );
    });

    it('upserts links for multiple issue keys referenced in one commit message', async () => {
      prisma.issue.findFirst
        .mockResolvedValueOnce({ id: 'issue-1' })
        .mockResolvedValueOnce({ id: 'issue-2' });
      prisma.issueGitlabLink.upsert.mockResolvedValue({});

      const payload = {
        ref: 'refs/heads/main',
        commits: [
          {
            id: 'sha-multi',
            message: 'Fixes NL-1 and NL-2',
            url: 'https://gitlab.com/acme/widgets/-/commit/sha-multi',
          },
        ],
      };

      const result = await service.handlePushEvent(PROJECT_ID, payload);
      expect(result.linksUpserted).toBe(2);
    });

    it('ignores keys belonging to a different project prefix', async () => {
      const payload = {
        ref: 'refs/heads/main',
        commits: [
          {
            id: 'sha-other',
            message: 'Fixes OTHER-99 unrelated',
            url: 'https://gitlab.com/acme/widgets/-/commit/sha-other',
          },
        ],
      };

      const result = await service.handlePushEvent(PROJECT_ID, payload);
      expect(result.linksUpserted).toBe(0);
      expect(prisma.issue.findFirst).not.toHaveBeenCalled();
      expect(prisma.issueGitlabLink.upsert).not.toHaveBeenCalled();
    });

    it('is idempotent: re-delivering the same push event upserts (not duplicates) the same link', async () => {
      prisma.issue.findFirst.mockResolvedValue({ id: 'issue-42' });
      prisma.issueGitlabLink.upsert.mockResolvedValue({});

      const payload = {
        ref: 'refs/heads/main',
        commits: [
          {
            id: 'abc123',
            message: 'Fix crash (NL-42)',
            url: 'https://gitlab.com/acme/widgets/-/commit/abc123',
          },
        ],
      };

      await service.handlePushEvent(PROJECT_ID, payload);
      await service.handlePushEvent(PROJECT_ID, payload);

      // Two deliveries, but each calls upsert with the SAME unique key —
      // Prisma's upsert guarantees no duplicate row is created.
      expect(prisma.issueGitlabLink.upsert).toHaveBeenCalledTimes(2);
      const [firstCallArgs] = prisma.issueGitlabLink.upsert.mock.calls[0];
      const [secondCallArgs] = prisma.issueGitlabLink.upsert.mock.calls[1];
      expect(firstCallArgs.where).toEqual(secondCallArgs.where);
    });

    it('extracts a BRANCH link from the pushed branch name', async () => {
      prisma.issue.findFirst.mockResolvedValue({ id: 'issue-77' });
      prisma.issueGitlabLink.upsert.mockResolvedValue({});

      const payload = {
        ref: 'refs/heads/feature/NL-77-fix-login',
        user_username: 'jsmith',
        commits: [],
      };

      const result = await service.handlePushEvent(PROJECT_ID, payload);
      expect(result.linksUpserted).toBe(1);
      expect(prisma.issueGitlabLink.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            issueId_kind_externalId: {
              issueId: 'issue-77',
              kind: 'BRANCH',
              externalId: 'feature/NL-77-fix-login',
            },
          },
        }),
      );
    });

    it('skips commits whose issue number does not resolve to a real issue in this project', async () => {
      prisma.issue.findFirst.mockResolvedValue(null);

      const payload = {
        ref: 'refs/heads/main',
        commits: [
          {
            id: 'sha-ghost',
            message: 'References NL-9999 which does not exist',
            url: 'https://gitlab.com/acme/widgets/-/commit/sha-ghost',
          },
        ],
      };

      const result = await service.handlePushEvent(PROJECT_ID, payload);
      expect(result.linksUpserted).toBe(0);
      expect(prisma.issueGitlabLink.upsert).not.toHaveBeenCalled();
    });

    it('no-ops gracefully when the project no longer exists', async () => {
      prisma.project.findUnique.mockResolvedValue(null);
      const result = await service.handlePushEvent('gone-project', { commits: [] });
      expect(result.linksUpserted).toBe(0);
    });
  });

  // ---- handleMergeRequestEvent() ----------------------------------------------

  describe('handleMergeRequestEvent', () => {
    beforeEach(() => {
      prisma.project.findUnique.mockResolvedValue({ id: PROJECT_ID, key: 'NL' });
    });

    it('upserts an MR link with state "open" (normalized from GitLab\'s "opened", real MR Hook shape)', async () => {
      prisma.issue.findFirst.mockResolvedValue({ id: 'issue-8' });
      prisma.issueGitlabLink.upsert.mockResolvedValue({});

      const payload = {
        object_kind: 'merge_request',
        event_type: 'merge_request',
        user: { name: 'Administrator', username: 'root' },
        object_attributes: {
          id: 99,
          iid: 101,
          target_branch: 'main',
          source_branch: 'feature/dark-mode',
          title: '[NL-8] Add dark mode',
          description: 'Implements the dark mode toggle.',
          state: 'opened',
          url: 'https://gitlab.com/acme/widgets/-/merge_requests/101',
          action: 'open',
        },
      };

      const result = await service.handleMergeRequestEvent(PROJECT_ID, payload);
      expect(result.linksUpserted).toBe(1);
      expect(prisma.issueGitlabLink.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            state: 'open',
            externalId: '101',
            authorLogin: 'root',
          }),
        }),
      );
    });

    it('sets state to "merged" verbatim', async () => {
      prisma.issue.findFirst.mockResolvedValue({ id: 'issue-8' });
      prisma.issueGitlabLink.upsert.mockResolvedValue({});

      const payload = {
        user: { username: 'root' },
        object_attributes: {
          iid: 102,
          title: 'NL-8 fix',
          state: 'merged',
          url: 'https://gitlab.com/acme/widgets/-/merge_requests/102',
          source_branch: 'fix-branch',
        },
      };

      await service.handleMergeRequestEvent(PROJECT_ID, payload);
      expect(prisma.issueGitlabLink.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ state: 'merged' }),
        }),
      );
    });

    it('sets state to "closed" verbatim', async () => {
      prisma.issue.findFirst.mockResolvedValue({ id: 'issue-8' });
      prisma.issueGitlabLink.upsert.mockResolvedValue({});

      const payload = {
        user: { username: 'root' },
        object_attributes: {
          iid: 103,
          title: 'NL-8 abandoned',
          state: 'closed',
          url: 'https://gitlab.com/acme/widgets/-/merge_requests/103',
          source_branch: 'abandoned-branch',
        },
      };

      await service.handleMergeRequestEvent(PROJECT_ID, payload);
      expect(prisma.issueGitlabLink.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ state: 'closed' }),
        }),
      );
    });

    it('matches a key from the source branch name when the title has none', async () => {
      prisma.issue.findFirst.mockResolvedValue({ id: 'issue-55' });
      prisma.issueGitlabLink.upsert.mockResolvedValue({});

      const payload = {
        user: { username: 'root' },
        object_attributes: {
          iid: 104,
          title: 'Unrelated title text',
          state: 'opened',
          url: 'https://gitlab.com/acme/widgets/-/merge_requests/104',
          source_branch: 'feature/NL-55-thing',
        },
      };

      const result = await service.handleMergeRequestEvent(PROJECT_ID, payload);
      expect(result.linksUpserted).toBe(1);
    });

    it('matches a key from the description when the title and branch have none', async () => {
      prisma.issue.findFirst.mockResolvedValue({ id: 'issue-66' });
      prisma.issueGitlabLink.upsert.mockResolvedValue({});

      const payload = {
        user: { username: 'root' },
        object_attributes: {
          iid: 105,
          title: 'Unrelated title',
          description: 'Closes NL-66 by adding the missing check.',
          state: 'opened',
          url: 'https://gitlab.com/acme/widgets/-/merge_requests/105',
          source_branch: 'unrelated-branch',
        },
      };

      const result = await service.handleMergeRequestEvent(PROJECT_ID, payload);
      expect(result.linksUpserted).toBe(1);
    });

    it('no-ops when the payload has no object_attributes (or no iid)', async () => {
      const result = await service.handleMergeRequestEvent(PROJECT_ID, {});
      expect(result.linksUpserted).toBe(0);
      expect(prisma.issueGitlabLink.upsert).not.toHaveBeenCalled();
    });

    it("ignores an MR referencing a different project's key", async () => {
      const payload = {
        user: { username: 'root' },
        object_attributes: {
          iid: 106,
          title: 'OTHER-1 unrelated MR',
          state: 'opened',
          url: 'https://gitlab.com/acme/widgets/-/merge_requests/106',
          source_branch: 'other-branch',
        },
      };

      const result = await service.handleMergeRequestEvent(PROJECT_ID, payload);
      expect(result.linksUpserted).toBe(0);
      expect(prisma.issue.findFirst).not.toHaveBeenCalled();
    });

    it('no-ops gracefully when the project no longer exists', async () => {
      prisma.project.findUnique.mockResolvedValue(null);
      const result = await service.handleMergeRequestEvent('gone-project', {
        object_attributes: { iid: 1, title: 'x', state: 'opened' },
      });
      expect(result.linksUpserted).toBe(0);
    });
  });
});
