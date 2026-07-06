import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role, SocketEvents } from '@next-lane/shared';
import * as membership from '../common/membership.util';
import { GiteaService } from './gitea.service';
import { decryptGiteaToken } from './gitea-crypto.util';
import { computeGiteaSignature } from './gitea-signature.util';
import type { PrismaService } from '../prisma/prisma.service';
import type { RealtimeService } from '../realtime/realtime.service';
import type { AuditService } from '../audit/audit.service';

const PROJECT_ID = 'project-1';
const OTHER_PROJECT_ID = 'project-2';

function makePrisma() {
  return {
    membership: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    // getEffectiveProjectRole consults the override table; null = inherit.
    projectMembership: { findUnique: jest.fn().mockResolvedValue(null) },
    project: { findUnique: jest.fn() },
    giteaIntegration: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    issue: { findUnique: jest.fn(), findFirst: jest.fn() },
    issueGiteaLink: { findMany: jest.fn(), upsert: jest.fn() },
  };
}
type MockPrisma = ReturnType<typeof makePrisma>;

const mockAudit: Pick<AuditService, 'record'> = { record: jest.fn() };
const mockRealtime: Pick<RealtimeService, 'emitToProject'> = {
  emitToProject: jest.fn(),
};

function integrationRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'gt-1',
    projectId: PROJECT_ID,
    giteaBaseUrl: 'https://git.example.com',
    repoFullName: 'acme/widgets',
    tokenEncrypted: 'irrelevant-for-most-tests',
    webhookSecret: 'the-webhook-secret',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('GiteaService', () => {
  let prisma: MockPrisma;
  let service: GiteaService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new GiteaService(
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
      prisma.giteaIntegration.findUnique.mockResolvedValue(null);

      const result = await service.get('user-1', PROJECT_ID);
      expect(result).toBeNull();
    });

    it('includes webhookSecret for an ADMIN caller', async () => {
      jest
        .spyOn(membership, 'assertProjectMember')
        .mockResolvedValue({ workspaceId: 'ws-1' } as never);
      prisma.membership.findUnique.mockResolvedValue({ role: Role.ADMIN });
      prisma.giteaIntegration.findUnique.mockResolvedValue(integrationRow());

      const result = await service.get('user-1', PROJECT_ID);
      expect(result?.webhookSecret).toBe('the-webhook-secret');
      expect(result?.repoFullName).toBe('acme/widgets');
      expect(result?.giteaBaseUrl).toBe('https://git.example.com');
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
      prisma.giteaIntegration.findUnique.mockResolvedValue(integrationRow());

      const result = await service.get('user-1', PROJECT_ID);
      expect(result?.webhookSecret).toBe('the-webhook-secret');
    });

    it('omits webhookSecret for a MEMBER caller (read-only summary)', async () => {
      jest
        .spyOn(membership, 'assertProjectMember')
        .mockResolvedValue({ workspaceId: 'ws-1' } as never);
      prisma.membership.findUnique.mockResolvedValue({ role: Role.MEMBER });
      prisma.giteaIntegration.findUnique.mockResolvedValue(integrationRow());

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
      expect(prisma.giteaIntegration.findUnique).not.toHaveBeenCalled();
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
          giteaBaseUrl: 'https://git.example.com',
          repoFullName: 'acme/widgets',
          token: 'gitea_x',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.giteaIntegration.create).not.toHaveBeenCalled();
    });

    it('creates a new integration with a generated webhookSecret and encrypts the token', async () => {
      jest
        .spyOn(membership, 'assertProjectRole')
        .mockResolvedValue({ workspaceId: 'ws-1' } as never);
      prisma.giteaIntegration.findUnique.mockResolvedValue(null);
      prisma.giteaIntegration.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(integrationRow({ ...data, id: 'gt-new' })),
      );

      const dto = {
        giteaBaseUrl: 'https://git.example.com',
        repoFullName: 'acme/widgets',
        token: 'gitea_rawTokenValue',
      };
      const result = await service.upsert('admin-1', PROJECT_ID, dto);

      expect(prisma.giteaIntegration.create).toHaveBeenCalledTimes(1);
      const createArgs = prisma.giteaIntegration.create.mock.calls[0][0];
      expect(createArgs.data.repoFullName).toBe('acme/widgets');
      expect(createArgs.data.giteaBaseUrl).toBe('https://git.example.com');
      expect(createArgs.data.tokenEncrypted).not.toBe('gitea_rawTokenValue');
      expect(decryptGiteaToken(createArgs.data.tokenEncrypted)).toBe('gitea_rawTokenValue');
      expect(typeof createArgs.data.webhookSecret).toBe('string');
      expect((createArgs.data.webhookSecret as string).length).toBeGreaterThan(10);

      // Response never leaks the raw token; includes the generated secret (admin path).
      expect(result).not.toHaveProperty('token');
      expect(result.webhookSecret).toBe(createArgs.data.webhookSecret);
    });

    it('strips a trailing slash from giteaBaseUrl', async () => {
      jest
        .spyOn(membership, 'assertProjectRole')
        .mockResolvedValue({ workspaceId: 'ws-1' } as never);
      prisma.giteaIntegration.findUnique.mockResolvedValue(null);
      prisma.giteaIntegration.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(integrationRow({ ...data, id: 'gt-new' })),
      );

      await service.upsert('admin-1', PROJECT_ID, {
        giteaBaseUrl: 'https://git.example.com/',
        repoFullName: 'acme/widgets',
        token: 'gitea_x',
      });
      const createArgs = prisma.giteaIntegration.create.mock.calls[0][0];
      expect(createArgs.data.giteaBaseUrl).toBe('https://git.example.com');
    });

    it('updates an existing integration WITHOUT rotating webhookSecret', async () => {
      jest
        .spyOn(membership, 'assertProjectRole')
        .mockResolvedValue({ workspaceId: 'ws-1' } as never);
      const existing = integrationRow();
      prisma.giteaIntegration.findUnique.mockResolvedValue(existing);
      prisma.giteaIntegration.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...existing, ...data }),
      );

      const result = await service.upsert('admin-1', PROJECT_ID, {
        giteaBaseUrl: 'https://git.example.com',
        repoFullName: 'acme/widgets-renamed',
        token: 'gitea_newTokenValue',
      });

      expect(prisma.giteaIntegration.create).not.toHaveBeenCalled();
      expect(prisma.giteaIntegration.update).toHaveBeenCalledTimes(1);
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
      expect(prisma.giteaIntegration.delete).not.toHaveBeenCalled();
    });

    it('404s when not configured', async () => {
      jest
        .spyOn(membership, 'assertProjectRole')
        .mockResolvedValue({ workspaceId: 'ws-1' } as never);
      prisma.giteaIntegration.findUnique.mockResolvedValue(null);

      await expect(service.remove('admin-1', PROJECT_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('deletes the integration when configured', async () => {
      jest
        .spyOn(membership, 'assertProjectRole')
        .mockResolvedValue({ workspaceId: 'ws-1' } as never);
      prisma.giteaIntegration.findUnique.mockResolvedValue(integrationRow());
      prisma.giteaIntegration.delete.mockResolvedValue({});

      const result = await service.remove('admin-1', PROJECT_ID);
      expect(result).toEqual({ ok: true });
      expect(prisma.giteaIntegration.delete).toHaveBeenCalledWith({
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
      expect(prisma.issueGiteaLink.findMany).not.toHaveBeenCalled();
    });

    it('returns links for a project member', async () => {
      prisma.issue.findUnique.mockResolvedValue({ projectId: PROJECT_ID });
      jest.spyOn(membership, 'assertProjectMember').mockResolvedValue({} as never);
      prisma.issueGiteaLink.findMany.mockResolvedValue([
        {
          id: 'link-1',
          issueId: 'issue-1',
          kind: 'PR',
          externalId: '42',
          title: 'Fix bug',
          url: 'https://git.example.com/acme/widgets/pulls/42',
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
      prisma.giteaIntegration.findUnique.mockResolvedValue(null);
      const result = await service.verifySignature(PROJECT_ID, Buffer.from('{}'), 'deadbeef');
      expect(result.ok).toBe(false);
    });

    it('rejects a missing signature header', async () => {
      prisma.giteaIntegration.findUnique.mockResolvedValue(integrationRow());
      const result = await service.verifySignature(PROJECT_ID, Buffer.from('{}'), undefined);
      expect(result.ok).toBe(false);
    });

    it('rejects an invalid signature', async () => {
      prisma.giteaIntegration.findUnique.mockResolvedValue(integrationRow());
      const result = await service.verifySignature(
        PROJECT_ID,
        Buffer.from('{}'),
        'deadbeef',
      );
      expect(result.ok).toBe(false);
    });

    it('accepts a valid signature computed with the stored secret', async () => {
      const row = integrationRow();
      prisma.giteaIntegration.findUnique.mockResolvedValue(row);
      const body = Buffer.from(JSON.stringify({ ref: 'refs/heads/main' }));
      const sig = computeGiteaSignature(row.webhookSecret, body);

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
      prisma.issueGiteaLink.upsert.mockResolvedValue({});

      const payload = {
        ref: 'refs/heads/feature/no-key-here',
        commits: [
          {
            id: 'abc123',
            message: 'Fix crash (NL-42)',
            url: 'https://git.example.com/acme/widgets/commit/abc123',
            author: { name: 'Octocat', username: 'octocat' },
          },
        ],
      };

      const result = await service.handlePushEvent(PROJECT_ID, payload);
      expect(result.linksUpserted).toBe(1);
      expect(prisma.issueGiteaLink.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            issueId_kind_externalId: {
              issueId: 'issue-42',
              kind: 'COMMIT',
              externalId: 'abc123',
            },
          },
          create: expect.objectContaining({ authorLogin: 'octocat' }),
        }),
      );
      expect(mockRealtime.emitToProject).toHaveBeenCalledWith(
        PROJECT_ID,
        SocketEvents.IssueUpdated,
        { id: 'issue-42' },
      );
    });

    it('falls back to the commit author name when username is absent', async () => {
      prisma.issue.findFirst.mockResolvedValue({ id: 'issue-42' });
      prisma.issueGiteaLink.upsert.mockResolvedValue({});

      const payload = {
        ref: 'refs/heads/main',
        commits: [
          {
            id: 'abc123',
            message: 'Fix crash (NL-42)',
            url: 'https://git.example.com/acme/widgets/commit/abc123',
            author: { name: 'Just A Name' },
          },
        ],
      };

      await service.handlePushEvent(PROJECT_ID, payload);
      expect(prisma.issueGiteaLink.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ authorLogin: 'Just A Name' }),
        }),
      );
    });

    it('upserts links for multiple issue keys referenced in one commit message', async () => {
      prisma.issue.findFirst
        .mockResolvedValueOnce({ id: 'issue-1' })
        .mockResolvedValueOnce({ id: 'issue-2' });
      prisma.issueGiteaLink.upsert.mockResolvedValue({});

      const payload = {
        ref: 'refs/heads/main',
        commits: [
          {
            id: 'sha-multi',
            message: 'Fixes NL-1 and NL-2',
            url: 'https://git.example.com/acme/widgets/commit/sha-multi',
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
            url: 'https://git.example.com/acme/widgets/commit/sha-other',
          },
        ],
      };

      const result = await service.handlePushEvent(PROJECT_ID, payload);
      expect(result.linksUpserted).toBe(0);
      expect(prisma.issue.findFirst).not.toHaveBeenCalled();
      expect(prisma.issueGiteaLink.upsert).not.toHaveBeenCalled();
    });

    it('is idempotent: re-delivering the same push event upserts (not duplicates) the same link', async () => {
      prisma.issue.findFirst.mockResolvedValue({ id: 'issue-42' });
      prisma.issueGiteaLink.upsert.mockResolvedValue({});

      const payload = {
        ref: 'refs/heads/main',
        commits: [
          {
            id: 'abc123',
            message: 'Fix crash (NL-42)',
            url: 'https://git.example.com/acme/widgets/commit/abc123',
          },
        ],
      };

      await service.handlePushEvent(PROJECT_ID, payload);
      await service.handlePushEvent(PROJECT_ID, payload);

      // Two deliveries, but each calls upsert with the SAME unique key —
      // Prisma's upsert guarantees no duplicate row is created.
      expect(prisma.issueGiteaLink.upsert).toHaveBeenCalledTimes(2);
      const [firstCallArgs] = prisma.issueGiteaLink.upsert.mock.calls[0];
      const [secondCallArgs] = prisma.issueGiteaLink.upsert.mock.calls[1];
      expect(firstCallArgs.where).toEqual(secondCallArgs.where);
    });

    it('extracts a BRANCH link from the pushed branch name, using pusher.login', async () => {
      prisma.issue.findFirst.mockResolvedValue({ id: 'issue-77' });
      prisma.issueGiteaLink.upsert.mockResolvedValue({});

      const payload = {
        ref: 'refs/heads/feature/NL-77-fix-login',
        pusher: { login: 'octocat' },
        commits: [],
      };

      const result = await service.handlePushEvent(PROJECT_ID, payload);
      expect(result.linksUpserted).toBe(1);
      expect(prisma.issueGiteaLink.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            issueId_kind_externalId: {
              issueId: 'issue-77',
              kind: 'BRANCH',
              externalId: 'feature/NL-77-fix-login',
            },
          },
          create: expect.objectContaining({ authorLogin: 'octocat' }),
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
            url: 'https://git.example.com/acme/widgets/commit/sha-ghost',
          },
        ],
      };

      const result = await service.handlePushEvent(PROJECT_ID, payload);
      expect(result.linksUpserted).toBe(0);
      expect(prisma.issueGiteaLink.upsert).not.toHaveBeenCalled();
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
      prisma.issueGiteaLink.upsert.mockResolvedValue({});

      const payload = {
        action: 'opened',
        pull_request: {
          number: 101,
          title: '[NL-8] Add dark mode',
          html_url: 'https://git.example.com/acme/widgets/pulls/101',
          state: 'open',
          merged: false,
          head: { ref: 'feature/dark-mode' },
          user: { login: 'octocat' },
        },
      };

      const result = await service.handlePullRequestEvent(PROJECT_ID, payload);
      expect(result.linksUpserted).toBe(1);
      expect(prisma.issueGiteaLink.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ state: 'open', externalId: '101' }),
        }),
      );
    });

    it('sets state to "merged" when the PR was merged (overrides raw state=closed)', async () => {
      prisma.issue.findFirst.mockResolvedValue({ id: 'issue-8' });
      prisma.issueGiteaLink.upsert.mockResolvedValue({});

      const payload = {
        action: 'closed',
        pull_request: {
          number: 102,
          title: 'NL-8 fix',
          html_url: 'https://git.example.com/acme/widgets/pulls/102',
          state: 'closed',
          merged: true,
          head: { ref: 'fix-branch' },
          user: { login: 'octocat' },
        },
      };

      await service.handlePullRequestEvent(PROJECT_ID, payload);
      expect(prisma.issueGiteaLink.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ state: 'merged' }),
        }),
      );
    });

    it('sets state to "closed" when closed without merging', async () => {
      prisma.issue.findFirst.mockResolvedValue({ id: 'issue-8' });
      prisma.issueGiteaLink.upsert.mockResolvedValue({});

      const payload = {
        action: 'closed',
        pull_request: {
          number: 103,
          title: 'NL-8 abandoned',
          html_url: 'https://git.example.com/acme/widgets/pulls/103',
          state: 'closed',
          merged: false,
          head: { ref: 'abandoned-branch' },
          user: { login: 'octocat' },
        },
      };

      await service.handlePullRequestEvent(PROJECT_ID, payload);
      expect(prisma.issueGiteaLink.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ state: 'closed' }),
        }),
      );
    });

    it('matches a key from the branch name when the title has none', async () => {
      prisma.issue.findFirst.mockResolvedValue({ id: 'issue-55' });
      prisma.issueGiteaLink.upsert.mockResolvedValue({});

      const payload = {
        pull_request: {
          number: 104,
          title: 'Unrelated title text',
          html_url: 'https://git.example.com/acme/widgets/pulls/104',
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
      expect(prisma.issueGiteaLink.upsert).not.toHaveBeenCalled();
    });

    it("ignores a PR referencing a different project's key", async () => {
      const payload = {
        pull_request: {
          number: 105,
          title: 'OTHER-1 unrelated PR',
          html_url: 'https://git.example.com/acme/widgets/pulls/105',
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

    it('no-ops gracefully when the project no longer exists', async () => {
      prisma.project.findUnique.mockResolvedValue(null);
      const result = await service.handlePullRequestEvent('gone-project', {
        pull_request: { number: 1, title: 'NL-1', head: { ref: 'x' } },
      });
      expect(result.linksUpserted).toBe(0);
    });
  });
});
