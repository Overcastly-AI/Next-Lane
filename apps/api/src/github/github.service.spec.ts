import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role, SocketEvents } from '@next-lane/shared';
import * as membership from '../common/membership.util';
import { GithubService } from './github.service';
import { decryptGithubToken, encryptGithubToken } from './github-crypto.util';
import { computeGithubSignature } from './github-signature.util';
import type { PrismaService } from '../prisma/prisma.service';
import type { RealtimeService } from '../realtime/realtime.service';
import type { AuditService } from '../audit/audit.service';
import type { IssuesService } from '../issues/issues.service';
import type { GithubClient } from './github-client.service';

const PROJECT_ID = 'project-1';
const OTHER_PROJECT_ID = 'project-2';

function makePrisma() {
  return {
    membership: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    // getEffectiveProjectRole consults the override table; null = inherit.
    projectMembership: { findUnique: jest.fn().mockResolvedValue(null) },
    project: { findUnique: jest.fn() },
    githubIntegration: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    status: { findUnique: jest.fn() },
    issue: { findUnique: jest.fn(), findFirst: jest.fn() },
    issueGithubLink: { findMany: jest.fn(), upsert: jest.fn() },
  };
}
type MockPrisma = ReturnType<typeof makePrisma>;

const mockAudit: Pick<AuditService, 'record'> = { record: jest.fn() };
const mockRealtime: Pick<RealtimeService, 'emitToProject'> = {
  emitToProject: jest.fn(),
};
const mockIssuesService: Pick<IssuesService, 'move'> = {
  move: jest.fn(),
};
const mockGithubClient: Pick<GithubClient, 'getPullRequestStatus'> = {
  getPullRequestStatus: jest.fn(),
};

function integrationRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'gi-1',
    projectId: PROJECT_ID,
    repoFullName: 'acme/widgets',
    tokenEncrypted: 'irrelevant-for-most-tests',
    webhookSecret: 'the-webhook-secret',
    autoTransitionOnMerge: false,
    autoTransitionStatusId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('GithubService', () => {
  let prisma: MockPrisma;
  let service: GithubService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new GithubService(
      prisma as unknown as PrismaService,
      mockRealtime as unknown as RealtimeService,
      mockAudit as unknown as AuditService,
      mockIssuesService as unknown as IssuesService,
      mockGithubClient as unknown as GithubClient,
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
      prisma.githubIntegration.findUnique.mockResolvedValue(null);

      const result = await service.get('user-1', PROJECT_ID);
      expect(result).toBeNull();
    });

    it('includes webhookSecret for an ADMIN caller', async () => {
      jest
        .spyOn(membership, 'assertProjectMember')
        .mockResolvedValue({ workspaceId: 'ws-1' } as never);
      prisma.membership.findUnique.mockResolvedValue({ role: Role.ADMIN });
      prisma.githubIntegration.findUnique.mockResolvedValue(integrationRow());

      const result = await service.get('user-1', PROJECT_ID);
      expect(result?.webhookSecret).toBe('the-webhook-secret');
      expect(result?.repoFullName).toBe('acme/widgets');
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
      prisma.githubIntegration.findUnique.mockResolvedValue(integrationRow());

      const result = await service.get('user-1', PROJECT_ID);
      expect(result?.webhookSecret).toBe('the-webhook-secret');
    });

    it('omits webhookSecret for a MEMBER caller (read-only summary)', async () => {
      jest
        .spyOn(membership, 'assertProjectMember')
        .mockResolvedValue({ workspaceId: 'ws-1' } as never);
      prisma.membership.findUnique.mockResolvedValue({ role: Role.MEMBER });
      prisma.githubIntegration.findUnique.mockResolvedValue(integrationRow());

      const result = await service.get('user-1', PROJECT_ID);
      expect(result?.webhookSecret).toBeNull();
      expect(result?.repoFullName).toBe('acme/widgets');
    });

    it('rejects when the caller is not a member of the project (tenant isolation)', async () => {
      jest
        .spyOn(membership, 'assertProjectMember')
        .mockRejectedValue(new ForbiddenException());

      await expect(service.get('outsider', OTHER_PROJECT_ID)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.githubIntegration.findUnique).not.toHaveBeenCalled();
    });
  });

  // ---- upsert() ---------------------------------------------------------------

  describe('upsert', () => {
    it('requires ADMIN role', async () => {
      jest
        .spyOn(membership, 'assertProjectRole')
        .mockRejectedValue(new ForbiddenException());

      await expect(
        service.upsert('user-1', PROJECT_ID, { repoFullName: 'acme/widgets', token: 'ghp_x' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.githubIntegration.create).not.toHaveBeenCalled();
    });

    it('creates a new integration with a generated webhookSecret and encrypts the token', async () => {
      jest
        .spyOn(membership, 'assertProjectRole')
        .mockResolvedValue({ workspaceId: 'ws-1' } as never);
      prisma.githubIntegration.findUnique.mockResolvedValue(null);
      prisma.githubIntegration.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(integrationRow({ ...data, id: 'gi-new' })),
      );

      const dto = { repoFullName: 'acme/widgets', token: 'ghp_rawTokenValue' };
      const result = await service.upsert('admin-1', PROJECT_ID, dto);

      expect(prisma.githubIntegration.create).toHaveBeenCalledTimes(1);
      const createArgs = prisma.githubIntegration.create.mock.calls[0][0];
      expect(createArgs.data.repoFullName).toBe('acme/widgets');
      expect(createArgs.data.tokenEncrypted).not.toBe('ghp_rawTokenValue');
      expect(decryptGithubToken(createArgs.data.tokenEncrypted)).toBe('ghp_rawTokenValue');
      expect(typeof createArgs.data.webhookSecret).toBe('string');
      expect((createArgs.data.webhookSecret as string).length).toBeGreaterThan(10);

      // Response never leaks the raw token; includes the generated secret (admin path).
      expect(result).not.toHaveProperty('token');
      expect(result.webhookSecret).toBe(createArgs.data.webhookSecret);
    });

    it('updates an existing integration WITHOUT rotating webhookSecret', async () => {
      jest
        .spyOn(membership, 'assertProjectRole')
        .mockResolvedValue({ workspaceId: 'ws-1' } as never);
      const existing = integrationRow();
      prisma.githubIntegration.findUnique.mockResolvedValue(existing);
      prisma.githubIntegration.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...existing, ...data }),
      );

      const result = await service.upsert('admin-1', PROJECT_ID, {
        repoFullName: 'acme/widgets-renamed',
        token: 'ghp_newTokenValue',
      });

      expect(prisma.githubIntegration.create).not.toHaveBeenCalled();
      expect(prisma.githubIntegration.update).toHaveBeenCalledTimes(1);
      expect(result.webhookSecret).toBe(existing.webhookSecret);
      expect(result.repoFullName).toBe('acme/widgets-renamed');
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
      expect(prisma.githubIntegration.delete).not.toHaveBeenCalled();
    });

    it('404s when not configured', async () => {
      jest
        .spyOn(membership, 'assertProjectRole')
        .mockResolvedValue({ workspaceId: 'ws-1' } as never);
      prisma.githubIntegration.findUnique.mockResolvedValue(null);

      await expect(service.remove('admin-1', PROJECT_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('deletes the integration when configured', async () => {
      jest
        .spyOn(membership, 'assertProjectRole')
        .mockResolvedValue({ workspaceId: 'ws-1' } as never);
      prisma.githubIntegration.findUnique.mockResolvedValue(integrationRow());
      prisma.githubIntegration.delete.mockResolvedValue({});

      const result = await service.remove('admin-1', PROJECT_ID);
      expect(result).toEqual({ ok: true });
      expect(prisma.githubIntegration.delete).toHaveBeenCalledWith({
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
      expect(prisma.issueGithubLink.findMany).not.toHaveBeenCalled();
    });

    it('returns links for a project member', async () => {
      prisma.issue.findUnique.mockResolvedValue({ projectId: PROJECT_ID });
      jest.spyOn(membership, 'assertProjectMember').mockResolvedValue({} as never);
      prisma.issueGithubLink.findMany.mockResolvedValue([
        {
          id: 'link-1',
          issueId: 'issue-1',
          kind: 'PR',
          externalId: '42',
          title: 'Fix bug',
          url: 'https://github.com/acme/widgets/pull/42',
          state: 'open',
          authorLogin: 'octocat',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const result = await service.listIssueLinks('user-1', 'issue-1');
      expect(result).toHaveLength(1);
      expect(result[0].kind).toBe('PR');
      expect(result[0].externalId).toBe('42');
    });
  });

  // ---- verifySignature() ----------------------------------------------------

  describe('verifySignature', () => {
    it('rejects when no integration is configured for the project', async () => {
      prisma.githubIntegration.findUnique.mockResolvedValue(null);
      const result = await service.verifySignature(PROJECT_ID, Buffer.from('{}'), 'sha256=whatever');
      expect(result.ok).toBe(false);
    });

    it('rejects a missing signature header', async () => {
      prisma.githubIntegration.findUnique.mockResolvedValue(integrationRow());
      const result = await service.verifySignature(PROJECT_ID, Buffer.from('{}'), undefined);
      expect(result.ok).toBe(false);
    });

    it('rejects an invalid signature', async () => {
      prisma.githubIntegration.findUnique.mockResolvedValue(integrationRow());
      const result = await service.verifySignature(
        PROJECT_ID,
        Buffer.from('{}'),
        'sha256=deadbeef',
      );
      expect(result.ok).toBe(false);
    });

    it('accepts a valid signature computed with the stored secret', async () => {
      const row = integrationRow();
      prisma.githubIntegration.findUnique.mockResolvedValue(row);
      const body = Buffer.from(JSON.stringify({ ref: 'refs/heads/main' }));
      const sig = computeGithubSignature(row.webhookSecret, body);

      const result = await service.verifySignature(PROJECT_ID, body, sig);
      expect(result.ok).toBe(true);
    });
  });

  // ---- handlePushEvent() ----------------------------------------------------

  describe('handlePushEvent', () => {
    beforeEach(() => {
      prisma.project.findUnique.mockResolvedValue({ id: PROJECT_ID, key: 'NL' });
    });

    it('upserts a COMMIT link for a single issue key in a commit message', async () => {
      prisma.issue.findFirst.mockResolvedValue({ id: 'issue-42' });
      prisma.issueGithubLink.upsert.mockResolvedValue({});

      const payload = {
        ref: 'refs/heads/feature/no-key-here',
        commits: [
          {
            id: 'abc123',
            message: 'Fix crash (NL-42)',
            url: 'https://github.com/acme/widgets/commit/abc123',
            author: { username: 'octocat' },
          },
        ],
      };

      const result = await service.handlePushEvent(PROJECT_ID, payload);
      expect(result.linksUpserted).toBe(1);
      expect(prisma.issueGithubLink.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            issueId_kind_externalId: {
              issueId: 'issue-42',
              kind: 'COMMIT',
              externalId: 'abc123',
            },
          },
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
      prisma.issueGithubLink.upsert.mockResolvedValue({});

      const payload = {
        ref: 'refs/heads/main',
        commits: [
          {
            id: 'sha-multi',
            message: 'Fixes NL-1 and NL-2',
            url: 'https://github.com/acme/widgets/commit/sha-multi',
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
            url: 'https://github.com/acme/widgets/commit/sha-other',
          },
        ],
      };

      const result = await service.handlePushEvent(PROJECT_ID, payload);
      expect(result.linksUpserted).toBe(0);
      expect(prisma.issue.findFirst).not.toHaveBeenCalled();
      expect(prisma.issueGithubLink.upsert).not.toHaveBeenCalled();
    });

    it('is idempotent: re-delivering the same push event upserts (not duplicates) the same link', async () => {
      prisma.issue.findFirst.mockResolvedValue({ id: 'issue-42' });
      prisma.issueGithubLink.upsert.mockResolvedValue({});

      const payload = {
        ref: 'refs/heads/main',
        commits: [
          {
            id: 'abc123',
            message: 'Fix crash (NL-42)',
            url: 'https://github.com/acme/widgets/commit/abc123',
          },
        ],
      };

      await service.handlePushEvent(PROJECT_ID, payload);
      await service.handlePushEvent(PROJECT_ID, payload);

      // Two deliveries, but each calls upsert with the SAME unique key —
      // Prisma's upsert guarantees no duplicate row is created.
      expect(prisma.issueGithubLink.upsert).toHaveBeenCalledTimes(2);
      const [firstCallArgs] = prisma.issueGithubLink.upsert.mock.calls[0];
      const [secondCallArgs] = prisma.issueGithubLink.upsert.mock.calls[1];
      expect(firstCallArgs.where).toEqual(secondCallArgs.where);
    });

    it('extracts a BRANCH link from the pushed branch name', async () => {
      prisma.issue.findFirst.mockResolvedValue({ id: 'issue-77' });
      prisma.issueGithubLink.upsert.mockResolvedValue({});

      const payload = {
        ref: 'refs/heads/feature/NL-77-fix-login',
        pusher: { name: 'octocat' },
        commits: [],
      };

      const result = await service.handlePushEvent(PROJECT_ID, payload);
      expect(result.linksUpserted).toBe(1);
      expect(prisma.issueGithubLink.upsert).toHaveBeenCalledWith(
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
            url: 'https://github.com/acme/widgets/commit/sha-ghost',
          },
        ],
      };

      const result = await service.handlePushEvent(PROJECT_ID, payload);
      expect(result.linksUpserted).toBe(0);
      expect(prisma.issueGithubLink.upsert).not.toHaveBeenCalled();
    });

    it('no-ops gracefully when the project no longer exists', async () => {
      prisma.project.findUnique.mockResolvedValue(null);
      const result = await service.handlePushEvent('gone-project', { commits: [] });
      expect(result.linksUpserted).toBe(0);
    });
  });

  // ---- handlePullRequestEvent() ----------------------------------------------

  describe('handlePullRequestEvent', () => {
    beforeEach(() => {
      prisma.project.findUnique.mockResolvedValue({ id: PROJECT_ID, key: 'NL' });
    });

    it('upserts a PR link with state "open"', async () => {
      prisma.issue.findFirst.mockResolvedValue({ id: 'issue-8' });
      prisma.issueGithubLink.upsert.mockResolvedValue({});

      const payload = {
        pull_request: {
          number: 101,
          title: '[NL-8] Add dark mode',
          html_url: 'https://github.com/acme/widgets/pull/101',
          state: 'open',
          merged: false,
          head: { ref: 'feature/dark-mode' },
          user: { login: 'octocat' },
        },
      };

      const result = await service.handlePullRequestEvent(PROJECT_ID, payload);
      expect(result.linksUpserted).toBe(1);
      expect(prisma.issueGithubLink.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ state: 'open', externalId: '101' }),
        }),
      );
    });

    it('sets state to "merged" when the PR was merged (overrides raw state=closed)', async () => {
      prisma.issue.findFirst.mockResolvedValue({ id: 'issue-8' });
      prisma.issueGithubLink.upsert.mockResolvedValue({});

      const payload = {
        pull_request: {
          number: 102,
          title: 'NL-8 fix',
          html_url: 'https://github.com/acme/widgets/pull/102',
          state: 'closed',
          merged: true,
          head: { ref: 'fix-branch' },
          user: { login: 'octocat' },
        },
      };

      await service.handlePullRequestEvent(PROJECT_ID, payload);
      expect(prisma.issueGithubLink.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ state: 'merged' }),
        }),
      );
    });

    it('sets state to "closed" when closed without merging', async () => {
      prisma.issue.findFirst.mockResolvedValue({ id: 'issue-8' });
      prisma.issueGithubLink.upsert.mockResolvedValue({});

      const payload = {
        pull_request: {
          number: 103,
          title: 'NL-8 abandoned',
          html_url: 'https://github.com/acme/widgets/pull/103',
          state: 'closed',
          merged: false,
          head: { ref: 'abandoned-branch' },
          user: { login: 'octocat' },
        },
      };

      await service.handlePullRequestEvent(PROJECT_ID, payload);
      expect(prisma.issueGithubLink.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ state: 'closed' }),
        }),
      );
    });

    it('matches a key from the branch name when the title has none', async () => {
      prisma.issue.findFirst.mockResolvedValue({ id: 'issue-55' });
      prisma.issueGithubLink.upsert.mockResolvedValue({});

      const payload = {
        pull_request: {
          number: 104,
          title: 'Unrelated title text',
          html_url: 'https://github.com/acme/widgets/pull/104',
          state: 'open',
          merged: false,
          head: { ref: 'feature/NL-55-thing' },
          user: { login: 'octocat' },
        },
      };

      const result = await service.handlePullRequestEvent(PROJECT_ID, payload);
      expect(result.linksUpserted).toBe(1);
    });

    it('no-ops when the payload has no pull_request object', async () => {
      const result = await service.handlePullRequestEvent(PROJECT_ID, {});
      expect(result.linksUpserted).toBe(0);
      expect(prisma.issueGithubLink.upsert).not.toHaveBeenCalled();
    });

    it('ignores a PR referencing a different project\'s key', async () => {
      const payload = {
        pull_request: {
          number: 105,
          title: 'OTHER-1 unrelated PR',
          html_url: 'https://github.com/acme/widgets/pull/105',
          state: 'open',
          merged: false,
          head: { ref: 'other-branch' },
          user: { login: 'octocat' },
        },
      };

      const result = await service.handlePullRequestEvent(PROJECT_ID, payload);
      expect(result.linksUpserted).toBe(0);
      expect(prisma.issue.findFirst).not.toHaveBeenCalled();
    });
  });

  // ---- updateAutomation() ----------------------------------------------------

  describe('updateAutomation', () => {
    it('requires ADMIN role', async () => {
      jest.spyOn(membership, 'assertProjectRole').mockRejectedValue(new ForbiddenException());
      await expect(
        service.updateAutomation('user-1', PROJECT_ID, { enabled: true, statusId: 'status-1' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.githubIntegration.update).not.toHaveBeenCalled();
    });

    it('404s when the integration is not configured', async () => {
      jest.spyOn(membership, 'assertProjectRole').mockResolvedValue({ workspaceId: 'ws-1' } as never);
      prisma.githubIntegration.findUnique.mockResolvedValue(null);
      await expect(
        service.updateAutomation('admin-1', PROJECT_ID, { enabled: true, statusId: 'status-1' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects enabling with no statusId ever configured', async () => {
      jest.spyOn(membership, 'assertProjectRole').mockResolvedValue({ workspaceId: 'ws-1' } as never);
      prisma.githubIntegration.findUnique.mockResolvedValue(integrationRow());
      await expect(
        service.updateAutomation('admin-1', PROJECT_ID, { enabled: true }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.githubIntegration.update).not.toHaveBeenCalled();
    });

    it('rejects a statusId belonging to a different project (wrong-project safety)', async () => {
      jest.spyOn(membership, 'assertProjectRole').mockResolvedValue({ workspaceId: 'ws-1' } as never);
      prisma.githubIntegration.findUnique.mockResolvedValue(integrationRow());
      prisma.status.findUnique.mockResolvedValue({ projectId: OTHER_PROJECT_ID });
      await expect(
        service.updateAutomation('admin-1', PROJECT_ID, { enabled: true, statusId: 'status-foreign' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.githubIntegration.update).not.toHaveBeenCalled();
    });

    it('enables with a valid project-scoped status', async () => {
      jest.spyOn(membership, 'assertProjectRole').mockResolvedValue({ workspaceId: 'ws-1' } as never);
      const existing = integrationRow();
      prisma.githubIntegration.findUnique.mockResolvedValue(existing);
      prisma.status.findUnique.mockResolvedValue({ projectId: PROJECT_ID });
      prisma.githubIntegration.update.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...existing, ...data }),
      );

      const result = await service.updateAutomation('admin-1', PROJECT_ID, {
        enabled: true,
        statusId: 'status-done',
      });
      expect(result.autoTransitionOnMerge).toBe(true);
      expect(result.autoTransitionStatusId).toBe('status-done');
      expect(prisma.githubIntegration.update).toHaveBeenCalledWith({
        where: { projectId: PROJECT_ID },
        data: { autoTransitionOnMerge: true, autoTransitionStatusId: 'status-done' },
      });
    });

    it('disabling does not require a statusId and keeps the stored one when omitted', async () => {
      jest.spyOn(membership, 'assertProjectRole').mockResolvedValue({ workspaceId: 'ws-1' } as never);
      const existing = integrationRow({
        autoTransitionOnMerge: true,
        autoTransitionStatusId: 'status-done',
      });
      prisma.githubIntegration.findUnique.mockResolvedValue(existing);
      prisma.githubIntegration.update.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...existing, ...data }),
      );

      prisma.status.findUnique.mockResolvedValue({ projectId: PROJECT_ID });

      const result = await service.updateAutomation('admin-1', PROJECT_ID, { enabled: false });
      expect(result.autoTransitionOnMerge).toBe(false);
      expect(result.autoTransitionStatusId).toBe('status-done');
      // The kept statusId is still validated on disable (defense-in-depth:
      // a disabled config must never hold a foreign project's status).
      expect(prisma.status.findUnique).toHaveBeenCalled();
    });

    it('rejects a foreign statusId even when only disabling (defense-in-depth)', async () => {
      jest.spyOn(membership, 'assertProjectRole').mockResolvedValue({ workspaceId: 'ws-1' } as never);
      prisma.githubIntegration.findUnique.mockResolvedValue(
        integrationRow({ autoTransitionOnMerge: true, autoTransitionStatusId: 'status-done' }),
      );
      prisma.status.findUnique.mockResolvedValue({ projectId: 'other-project' });

      await expect(
        service.updateAutomation('admin-1', PROJECT_ID, { enabled: false, statusId: 'foreign-status' }),
      ).rejects.toThrow('statusId does not belong to this project');
    });
  });

  // ---- getLiveStatus() --------------------------------------------------------

  describe('getLiveStatus', () => {
    it('404s when the issue does not exist', async () => {
      prisma.issue.findUnique.mockResolvedValue(null);
      await expect(service.getLiveStatus('user-1', 'nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns [] when GitHub is not configured', async () => {
      prisma.issue.findUnique.mockResolvedValue({ projectId: PROJECT_ID });
      jest.spyOn(membership, 'assertProjectMember').mockResolvedValue({} as never);
      prisma.githubIntegration.findUnique.mockResolvedValue(null);
      const result = await service.getLiveStatus('user-1', 'issue-1');
      expect(result).toEqual([]);
    });

    it('returns [] when there are no PR links', async () => {
      prisma.issue.findUnique.mockResolvedValue({ projectId: PROJECT_ID });
      jest.spyOn(membership, 'assertProjectMember').mockResolvedValue({} as never);
      prisma.githubIntegration.findUnique.mockResolvedValue(integrationRow());
      prisma.issueGithubLink.findMany.mockResolvedValue([]);
      const result = await service.getLiveStatus('user-1', 'issue-1');
      expect(result).toEqual([]);
      expect(mockGithubClient.getPullRequestStatus).not.toHaveBeenCalled();
    });

    it('returns live status for each PR link, decrypting the stored token', async () => {
      prisma.issue.findUnique.mockResolvedValue({ projectId: PROJECT_ID });
      jest.spyOn(membership, 'assertProjectMember').mockResolvedValue({} as never);
      const encrypted = encryptGithubToken('ghp_liveToken');
      prisma.githubIntegration.findUnique.mockResolvedValue(
        integrationRow({ tokenEncrypted: encrypted }),
      );
      prisma.issueGithubLink.findMany.mockResolvedValue([
        { id: 'link-1', externalId: '101', kind: 'PR', updatedAt: new Date() },
      ]);
      (mockGithubClient.getPullRequestStatus as jest.Mock).mockResolvedValue({
        number: 101,
        state: 'open',
        merged: false,
        mergedAt: null,
        checksState: 'pending',
        url: 'https://github.com/acme/widgets/pull/101',
      });

      const result = await service.getLiveStatus('user-1', 'issue-1');
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        linkId: 'link-1',
        externalId: '101',
        state: 'open',
        merged: false,
        checksState: 'pending',
        error: null,
      });
      expect(mockGithubClient.getPullRequestStatus).toHaveBeenCalledWith(
        'acme/widgets',
        'ghp_liveToken',
        101,
      );
    });

    it('degrades gracefully with an error entry when the live call fails', async () => {
      prisma.issue.findUnique.mockResolvedValue({ projectId: PROJECT_ID });
      jest.spyOn(membership, 'assertProjectMember').mockResolvedValue({} as never);
      const encrypted = encryptGithubToken('ghp_liveToken');
      prisma.githubIntegration.findUnique.mockResolvedValue(
        integrationRow({ tokenEncrypted: encrypted }),
      );
      prisma.issueGithubLink.findMany.mockResolvedValue([
        { id: 'link-1', externalId: '101', kind: 'PR', updatedAt: new Date() },
      ]);
      (mockGithubClient.getPullRequestStatus as jest.Mock).mockResolvedValue(null);

      const result = await service.getLiveStatus('user-1', 'issue-1');
      expect(result[0].error).toBe('GitHub API unreachable');
      expect(result[0].state).toBeNull();
    });
  });

  // ---- applyAutoTransition (via handlePullRequestEvent's merge path) --------

  describe('auto-transition-on-merge', () => {
    beforeEach(() => {
      prisma.project.findUnique.mockResolvedValue({
        id: PROJECT_ID,
        key: 'NL',
        workspaceId: 'ws-1',
        leadId: null,
      });
      prisma.issueGithubLink.upsert.mockResolvedValue({});
    });

    const mergedPayload = {
      pull_request: {
        number: 201,
        title: 'NL-8 ship it',
        html_url: 'https://github.com/acme/widgets/pull/201',
        state: 'closed',
        merged: true,
        head: { ref: 'feature/ship' },
        user: { login: 'octocat' },
      },
    };

    it('is disabled by default: does not transition when autoTransitionOnMerge is off', async () => {
      prisma.issue.findFirst.mockResolvedValue({ id: 'issue-8' });
      prisma.githubIntegration.findUnique.mockResolvedValue(
        integrationRow({ autoTransitionOnMerge: false }),
      );

      await service.handlePullRequestEvent(PROJECT_ID, mergedPayload);
      expect(mockIssuesService.move).not.toHaveBeenCalled();
    });

    it('transitions the linked issue via the automation-bypass flag when enabled', async () => {
      prisma.issue.findFirst
        .mockResolvedValueOnce({ id: 'issue-8' }) // upsertLinks resolve
        .mockResolvedValueOnce({
          id: 'issue-8',
          statusId: 'status-todo',
          assigneeId: 'user-assignee',
          reporterId: null,
        }); // applyAutoTransition lookup
      prisma.githubIntegration.findUnique.mockResolvedValue(
        integrationRow({ autoTransitionOnMerge: true, autoTransitionStatusId: 'status-done' }),
      );
      prisma.membership.findUnique.mockResolvedValue({ userId: 'user-assignee', role: Role.MEMBER });
      (mockIssuesService.move as jest.Mock).mockResolvedValue({});

      await service.handlePullRequestEvent(PROJECT_ID, mergedPayload);

      expect(mockIssuesService.move).toHaveBeenCalledWith(
        'user-assignee',
        'issue-8',
        { statusId: 'status-done' },
        { automated: true },
      );
    });

    it('skips an issue already at the target status (idempotent — no redundant rank shuffle)', async () => {
      prisma.issue.findFirst
        .mockResolvedValueOnce({ id: 'issue-8' })
        .mockResolvedValueOnce({
          id: 'issue-8',
          statusId: 'status-done',
          assigneeId: null,
          reporterId: null,
        });
      prisma.githubIntegration.findUnique.mockResolvedValue(
        integrationRow({ autoTransitionOnMerge: true, autoTransitionStatusId: 'status-done' }),
      );

      await service.handlePullRequestEvent(PROJECT_ID, mergedPayload);
      expect(mockIssuesService.move).not.toHaveBeenCalled();
    });

    it('skips gracefully (webhook still succeeds) when no eligible actor is found', async () => {
      prisma.issue.findFirst
        .mockResolvedValueOnce({ id: 'issue-8' })
        .mockResolvedValueOnce({
          id: 'issue-8',
          statusId: 'status-todo',
          assigneeId: null,
          reporterId: null,
        });
      prisma.githubIntegration.findUnique.mockResolvedValue(
        integrationRow({ autoTransitionOnMerge: true, autoTransitionStatusId: 'status-done' }),
      );
      prisma.membership.findFirst.mockResolvedValue(null);

      const result = await service.handlePullRequestEvent(PROJECT_ID, mergedPayload);
      expect(mockIssuesService.move).not.toHaveBeenCalled();
      expect(result.linksUpserted).toBe(1);
    });

    it('never transitions an issue that does not exist in THIS project (wrong-project safety)', async () => {
      prisma.issue.findFirst.mockResolvedValue(null);
      prisma.githubIntegration.findUnique.mockResolvedValue(
        integrationRow({ autoTransitionOnMerge: true, autoTransitionStatusId: 'status-done' }),
      );

      const result = await service.handlePullRequestEvent(PROJECT_ID, mergedPayload);
      expect(result.linksUpserted).toBe(0);
      expect(mockIssuesService.move).not.toHaveBeenCalled();
    });

    it('one issue failing to transition does not block a sibling issue referenced by the same PR', async () => {
      const multiIssuePayload = {
        pull_request: {
          number: 202,
          title: 'Fixes NL-8 and NL-9',
          html_url: 'https://github.com/acme/widgets/pull/202',
          state: 'closed',
          merged: true,
          head: { ref: 'feature/multi' },
          user: { login: 'octocat' },
        },
      };
      prisma.issue.findFirst
        .mockResolvedValueOnce({ id: 'issue-8' }) // upsertLinks NL-8
        .mockResolvedValueOnce({ id: 'issue-9' }) // upsertLinks NL-9
        .mockResolvedValueOnce({
          id: 'issue-8',
          statusId: 'status-todo',
          assigneeId: 'user-a',
          reporterId: null,
        }) // applyAutoTransition NL-8
        .mockResolvedValueOnce({
          id: 'issue-9',
          statusId: 'status-todo',
          assigneeId: 'user-b',
          reporterId: null,
        }); // applyAutoTransition NL-9
      prisma.githubIntegration.findUnique.mockResolvedValue(
        integrationRow({ autoTransitionOnMerge: true, autoTransitionStatusId: 'status-done' }),
      );
      prisma.membership.findUnique
        .mockResolvedValueOnce({ userId: 'user-a', role: Role.MEMBER })
        .mockResolvedValueOnce({ userId: 'user-b', role: Role.MEMBER });
      (mockIssuesService.move as jest.Mock)
        .mockRejectedValueOnce(new ForbiddenException('restricted'))
        .mockResolvedValueOnce({});

      await service.handlePullRequestEvent(PROJECT_ID, multiIssuePayload);
      expect(mockIssuesService.move).toHaveBeenCalledTimes(2);
    });
  });
});
