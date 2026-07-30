/**
 * Unit tests for PageTemplatesService.
 * Prisma and PagesService are mocked — no DB or Nest bootstrap.
 */

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Role, PAGE_TEMPLATE_STARTERS } from '@next-lane/shared';
import { PageTemplatesService } from './page-templates.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { PagesService } from '../pages/pages.service';

const WORKSPACE_ID = 'ws-1';
const PROJECT_ID = 'proj-1';
const OTHER_PROJECT_ID = 'proj-2';
const TEMPLATE_ID = 'tpl-1';
const USER_ID = 'user-1';

const wsTemplate = {
  id: TEMPLATE_ID,
  workspaceId: WORKSPACE_ID,
  projectId: null as string | null,
  name: 'Meeting notes',
  description: 'desc',
  titleTemplate: 'Notes — {{date}}',
  content: '# Notes {{date}}\n\nBy {{author}}',
  builtIn: true,
  createdAt: new Date('2026-07-30T00:00:00Z'),
  updatedAt: new Date('2026-07-30T00:00:00Z'),
};

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    pageTemplate: {
      findUnique: jest.fn().mockResolvedValue(wsTemplate),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn().mockResolvedValue(wsTemplate),
      createMany: jest.fn().mockResolvedValue({ count: PAGE_TEMPLATE_STARTERS.length }),
    },
    workspace: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ name: 'Ada Lovelace' }) },
    // Membership lookups used by assertWorkspaceRole / assertProjectRole.
    membership: {
      findUnique: jest.fn().mockResolvedValue({
        userId: USER_ID,
        workspaceId: WORKSPACE_ID,
        role: Role.ADMIN,
      }),
    },
    project: {
      findUnique: jest.fn().mockResolvedValue({
        id: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        key: 'PRJ',
      }),
    },
    projectMembership: { findUnique: jest.fn().mockResolvedValue(null) },
    ...overrides,
  } as unknown as PrismaService;
}

function makePages() {
  return {
    create: jest.fn().mockResolvedValue({ id: 'page-1' }),
    createWorkspacePage: jest.fn().mockResolvedValue({ id: 'page-ws-1' }),
  } as unknown as PagesService & {
    create: jest.Mock;
    createWorkspacePage: jest.Mock;
  };
}

function makeService(prisma = makePrisma(), pages = makePages()) {
  return { svc: new PageTemplatesService(prisma, pages), prisma, pages };
}

describe('PageTemplatesService', () => {
  describe('createPageFromTemplate — destination resolution', () => {
    it('creates a WORKSPACE page when a workspace-wide template gets no projectId', async () => {
      const { svc, pages } = makeService();
      await svc.createPageFromTemplate(USER_ID, TEMPLATE_ID, {});
      expect(pages.createWorkspacePage).toHaveBeenCalledTimes(1);
      expect(pages.create).not.toHaveBeenCalled();
      expect(pages.createWorkspacePage.mock.calls[0][1]).toBe(WORKSPACE_ID);
    });

    it('creates a PROJECT page when a workspace-wide template is given a projectId', async () => {
      const { svc, pages } = makeService();
      await svc.createPageFromTemplate(USER_ID, TEMPLATE_ID, { projectId: PROJECT_ID });
      expect(pages.create).toHaveBeenCalledTimes(1);
      expect(pages.create.mock.calls[0][1]).toBe(PROJECT_ID);
      expect(pages.createWorkspacePage).not.toHaveBeenCalled();
    });

    it('uses a project template’s OWN project when no projectId is given', async () => {
      const prisma = makePrisma();
      (prisma.pageTemplate.findUnique as jest.Mock).mockResolvedValue({
        ...wsTemplate,
        projectId: PROJECT_ID,
      });
      const { svc, pages } = makeService(prisma);
      await svc.createPageFromTemplate(USER_ID, TEMPLATE_ID, {});
      expect(pages.create.mock.calls[0][1]).toBe(PROJECT_ID);
    });

    it('REJECTS redirecting a project template to a different project', async () => {
      // Silently honouring the override would write the page somewhere the
      // caller's template doesn't belong.
      const prisma = makePrisma();
      (prisma.pageTemplate.findUnique as jest.Mock).mockResolvedValue({
        ...wsTemplate,
        projectId: PROJECT_ID,
      });
      const { svc, pages } = makeService(prisma);
      await expect(
        svc.createPageFromTemplate(USER_ID, TEMPLATE_ID, { projectId: OTHER_PROJECT_ID }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(pages.create).not.toHaveBeenCalled();
    });

    it('accepts a projectId that MATCHES the project template’s own project', async () => {
      const prisma = makePrisma();
      (prisma.pageTemplate.findUnique as jest.Mock).mockResolvedValue({
        ...wsTemplate,
        projectId: PROJECT_ID,
      });
      const { svc, pages } = makeService(prisma);
      await svc.createPageFromTemplate(USER_ID, TEMPLATE_ID, { projectId: PROJECT_ID });
      expect(pages.create).toHaveBeenCalledTimes(1);
    });

    it('404s on an unknown template', async () => {
      const prisma = makePrisma();
      (prisma.pageTemplate.findUnique as jest.Mock).mockResolvedValue(null);
      const { svc } = makeService(prisma);
      await expect(
        svc.createPageFromTemplate(USER_ID, 'nope', {}),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('createPageFromTemplate — rendering', () => {
    it('renders tokens in BOTH the title and the body', async () => {
      const { svc, pages } = makeService();
      await svc.createPageFromTemplate(USER_ID, TEMPLATE_ID, {});
      const dto = pages.createWorkspacePage.mock.calls[0][2];
      expect(dto.title).toMatch(/^Notes — \d{4}-\d{2}-\d{2}$/);
      expect(dto.content).toContain('By Ada Lovelace');
      expect(dto.content).not.toContain('{{');
    });

    it('lets an explicit title override the titleTemplate', async () => {
      const { svc, pages } = makeService();
      await svc.createPageFromTemplate(USER_ID, TEMPLATE_ID, { title: 'Custom' });
      expect(pages.createWorkspacePage.mock.calls[0][2].title).toBe('Custom');
    });

    it('resolves {{title}} inside the BODY to the final title', async () => {
      const prisma = makePrisma();
      (prisma.pageTemplate.findUnique as jest.Mock).mockResolvedValue({
        ...wsTemplate,
        content: '# {{title}}',
      });
      const { svc, pages } = makeService(prisma);
      await svc.createPageFromTemplate(USER_ID, TEMPLATE_ID, { title: 'Q3 Plan' });
      expect(pages.createWorkspacePage.mock.calls[0][2].content).toBe('# Q3 Plan');
    });

    it('400s when neither a title nor a titleTemplate is available', async () => {
      const prisma = makePrisma();
      (prisma.pageTemplate.findUnique as jest.Mock).mockResolvedValue({
        ...wsTemplate,
        titleTemplate: null,
      });
      const { svc } = makeService(prisma);
      await expect(
        svc.createPageFromTemplate(USER_ID, TEMPLATE_ID, {}),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('400s when a titleTemplate renders to only whitespace', async () => {
      const prisma = makePrisma();
      (prisma.pageTemplate.findUnique as jest.Mock).mockResolvedValue({
        ...wsTemplate,
        titleTemplate: '  {{title}}  ',
      });
      const { svc } = makeService(prisma);
      await expect(
        svc.createPageFromTemplate(USER_ID, TEMPLATE_ID, {}),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('REJECTS a rendered title containing wiki-link delimiters', async () => {
      // {{author}} expands to a user-controlled display name. A name with a
      // pipe would otherwise produce a page no [[wiki-link]] can address.
      const prisma = makePrisma();
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ name: 'a|b' });
      (prisma.pageTemplate.findUnique as jest.Mock).mockResolvedValue({
        ...wsTemplate,
        titleTemplate: 'Notes by {{author}}',
      });
      const { svc, pages } = makeService(prisma);
      await expect(
        svc.createPageFromTemplate(USER_ID, TEMPLATE_ID, {}),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(pages.createWorkspacePage).not.toHaveBeenCalled();
    });

    it('rejects a rendered body over the page byte limit', async () => {
      const prisma = makePrisma();
      (prisma.pageTemplate.findUnique as jest.Mock).mockResolvedValue({
        ...wsTemplate,
        // Multi-byte chars: 200k chars is well past the 256 KiB BYTE cap.
        content: 'é'.repeat(200_000),
      });
      const { svc, pages } = makeService(prisma);
      await expect(
        svc.createPageFromTemplate(USER_ID, TEMPLATE_ID, {}),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(pages.createWorkspacePage).not.toHaveBeenCalled();
    });

    it('falls back to a placeholder author when the user row is missing', async () => {
      const prisma = makePrisma();
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      const { svc, pages } = makeService(prisma);
      await svc.createPageFromTemplate(USER_ID, TEMPLATE_ID, {});
      expect(pages.createWorkspacePage.mock.calls[0][2].content).toContain('By Unknown');
    });

    it('passes parentId through so a templated page can be nested', async () => {
      const { svc, pages } = makeService();
      await svc.createPageFromTemplate(USER_ID, TEMPLATE_ID, { parentId: 'parent-1' });
      expect(pages.createWorkspacePage.mock.calls[0][2].parentId).toBe('parent-1');
    });
  });

  describe('findAllForProject', () => {
    it('returns project templates BEFORE inherited workspace ones', async () => {
      const prisma = makePrisma();
      (prisma.pageTemplate.findMany as jest.Mock).mockResolvedValue([
        { ...wsTemplate, id: 'a', name: 'Alpha (ws)', projectId: null },
        { ...wsTemplate, id: 'b', name: 'Beta (proj)', projectId: PROJECT_ID },
      ]);
      const { svc } = makeService(prisma);
      const out = await svc.findAllForProject(USER_ID, PROJECT_ID);
      expect(out.map((t) => t.id)).toEqual(['b', 'a']);
    });

    it('queries only the project’s own rows when inheritance is off', async () => {
      const prisma = makePrisma();
      const { svc } = makeService(prisma);
      await svc.findAllForProject(USER_ID, PROJECT_ID, false);
      expect((prisma.pageTemplate.findMany as jest.Mock).mock.calls[0][0].where).toEqual({
        projectId: PROJECT_ID,
      });
    });
  });

  describe('seedStarters', () => {
    it('claims the marker CONDITIONALLY so concurrent boots cannot double-seed', async () => {
      const prisma = makePrisma();
      const { svc } = makeService(prisma);
      await svc.seedStarters(WORKSPACE_ID);
      const where = (prisma.workspace.updateMany as jest.Mock).mock.calls[0][0].where;
      expect(where).toEqual({ id: WORKSPACE_ID, pageTemplatesSeededAt: null });
    });

    it('inserts every starter as a workspace-wide builtIn row', async () => {
      const prisma = makePrisma();
      const { svc } = makeService(prisma);
      expect(await svc.seedStarters(WORKSPACE_ID)).toBe(true);
      const arg = (prisma.pageTemplate.createMany as jest.Mock).mock.calls[0][0];
      expect(arg.data).toHaveLength(PAGE_TEMPLATE_STARTERS.length);
      expect(arg.skipDuplicates).toBe(true);
      for (const row of arg.data) {
        expect(row.projectId).toBeNull();
        expect(row.builtIn).toBe(true);
        expect(row.workspaceId).toBe(WORKSPACE_ID);
      }
    });

    it('does NOT insert when the marker was already claimed', async () => {
      const prisma = makePrisma();
      (prisma.workspace.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
      const { svc } = makeService(prisma);
      expect(await svc.seedStarters(WORKSPACE_ID)).toBe(false);
      expect(prisma.pageTemplate.createMany).not.toHaveBeenCalled();
    });

    it('backfill targets workspaces by NULL MARKER, never by template count', async () => {
      // Keyed on the count, a workspace whose owner deleted all six starters
      // would have them resurrected on the next restart.
      const prisma = makePrisma();
      const { svc } = makeService(prisma);
      await svc.onModuleInit();
      expect((prisma.workspace.findMany as jest.Mock).mock.calls[0][0].where).toEqual({
        pageTemplatesSeededAt: null,
      });
    });

    it('never lets a backfill failure break boot', async () => {
      const prisma = makePrisma();
      (prisma.workspace.findMany as jest.Mock).mockRejectedValue(new Error('db down'));
      const { svc } = makeService(prisma);
      await expect(svc.onModuleInit()).resolves.toBeUndefined();
    });
  });

  describe('name conflicts', () => {
    it('maps a unique violation to 409 with a scope-appropriate message', async () => {
      const prisma = makePrisma();
      (prisma.pageTemplate.create as jest.Mock).mockRejectedValue({ code: 'P2002' });
      const { svc } = makeService(prisma);
      await expect(
        svc.createForWorkspace(USER_ID, WORKSPACE_ID, { name: 'Runbook' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
