import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role, initialRanks } from '@next-lane/shared';
import {
  PagesService,
  MAX_GRAPH_NODES,
  MAX_GRAPH_EDGES,
  MAX_OUTGOING_LINKS,
  MAX_LINKED_ISSUES,
  MAX_LINKED_PAGES,
} from './pages.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RealtimeService } from '../realtime/realtime.service';

// ---------------------------------------------------------------------------
// DB-free unit tests for PagesService, backed by a small in-memory fake
// Prisma client (page/pageVersion/pageLink/project/membership tables) rather
// than per-call jest mocks — the tree/version/wiki-link reconciliation logic
// under test genuinely needs a working little "database" to exercise
// realistically (e.g. "create page A, create page B linking to A, assert the
// PageLink row exists").
// ---------------------------------------------------------------------------

const WORKSPACE_ID = 'ws-1';
const PROJECT_ID = 'proj-1';
const OTHER_PROJECT_ID = 'proj-2';
const ADMIN = 'user-admin';
const MEMBER = 'user-member';
const VIEWER = 'user-viewer';
const FOREIGN = 'user-foreign';

interface FakePageRow {
  id: string;
  workspaceId: string;
  /** Null = a workspace-level page (org-level-docs epic, Slice 2). */
  projectId: string | null;
  parentId: string | null;
  title: string;
  content: string;
  rank: string;
  archived: boolean;
  authorId: string | null;
  lastEditedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface FakeVersionRow {
  id: string;
  pageId: string;
  versionNumber: number;
  title: string;
  content: string;
  editedById: string | null;
  createdAt: Date;
}

interface FakeLinkRow {
  id: string;
  sourcePageId: string;
  targetPageId: string;
  createdAt: Date;
}

interface FakeIssueRow {
  id: string;
  projectId: string;
  number: number;
  type: string;
  title: string;
  statusId: string | null;
  project: { key: string };
  status:
    | { id: string; name: string; category: string; order: number; wipLimit: number | null; projectId: string }
    | null;
}

interface FakePageIssueLinkRow {
  id: string;
  pageId: string;
  issueId: string;
  createdAt: Date;
}

function matchOp(val: unknown, cond: unknown): boolean {
  if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
    const c = cond as Record<string, unknown>;
    if ('equals' in c) {
      if (c.mode === 'insensitive') {
        if (String(val).toLowerCase() !== String(c.equals).toLowerCase()) return false;
      } else if (val !== c.equals) {
        return false;
      }
    }
    if ('not' in c && val === c.not) return false;
    if ('lt' in c && !((val as number) < (c.lt as number))) return false;
    if ('in' in c && !(c.in as unknown[]).includes(val)) return false;
    return true;
  }
  return val === cond;
}

function matchesWhere(
  row: Record<string, unknown>,
  where: Record<string, unknown> | undefined,
  resolvePage: (id: string) => FakePageRow | undefined,
): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'OR') {
      if (!(cond as Record<string, unknown>[]).some((sub) => matchesWhere(row, sub, resolvePage))) {
        return false;
      }
      continue;
    }
    if (key === 'sourcePage' || key === 'targetPage') {
      const relatedId = key === 'sourcePage' ? (row.sourcePageId as string) : (row.targetPageId as string);
      const related = resolvePage(relatedId);
      if (!related || !matchesWhere(related as unknown as Record<string, unknown>, cond as Record<string, unknown>, resolvePage)) {
        return false;
      }
      continue;
    }
    if (!matchOp(row[key], cond)) return false;
  }
  return true;
}

function sortRows<T>(
  rows: T[],
  orderBy: Record<string, 'asc' | 'desc'> | undefined,
): void {
  if (!orderBy) return;
  const [key, dir] = Object.entries(orderBy)[0];
  rows.sort((a, b) => {
    const av = (a as Record<string, unknown>)[key];
    const bv = (b as Record<string, unknown>)[key];
    let cmp = 0;
    if (av instanceof Date && bv instanceof Date) cmp = av.getTime() - bv.getTime();
    else if ((av as number | string) < (bv as number | string)) cmp = -1;
    else if ((av as number | string) > (bv as number | string)) cmp = 1;
    return dir === 'desc' ? -cmp : cmp;
  });
}

class Harness {
  pages = new Map<string, FakePageRow>();
  versions = new Map<string, FakeVersionRow>();
  links = new Map<string, FakeLinkRow>();
  issues = new Map<string, FakeIssueRow>();
  issueLinks = new Map<string, FakePageIssueLinkRow>();
  roles = new Map<string, Role>();
  /** Per-project issue-key prefix (defaults to 'NL' for PROJECT_ID). */
  projectKeys = new Map<string, string>([
    [PROJECT_ID, 'NL'],
    [OTHER_PROJECT_ID, 'OTHER'],
  ]);
  private seq = 0;

  nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  setRole(userId: string, role: Role): void {
    this.roles.set(userId, role);
  }

  addPage(partial: Partial<FakePageRow> & { id?: string }): FakePageRow {
    const id = partial.id ?? this.nextId('page');
    const row: FakePageRow = {
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      parentId: null,
      title: 'Untitled',
      content: '',
      rank: 'a0',
      archived: false,
      authorId: null,
      lastEditedById: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...partial,
      id,
    };
    this.pages.set(id, row);
    return row;
  }

  addVersion(partial: Partial<FakeVersionRow> & { pageId: string; versionNumber: number; title: string; content: string }): FakeVersionRow {
    const id = this.nextId('ver');
    const row: FakeVersionRow = { editedById: null, createdAt: new Date(), ...partial, id };
    this.versions.set(id, row);
    return row;
  }

  addIssue(partial: Partial<FakeIssueRow> & { number: number }): FakeIssueRow {
    const id = partial.id ?? this.nextId('issue');
    const projectId = partial.projectId ?? PROJECT_ID;
    const row: FakeIssueRow = {
      projectId,
      type: 'TASK',
      title: `Issue ${partial.number}`,
      statusId: null,
      project: { key: this.projectKeys.get(projectId) ?? 'NL' },
      status: null,
      ...partial,
      id,
    };
    this.issues.set(id, row);
    return row;
  }

  addPageIssueLink(pageId: string, issueId: string): FakePageIssueLinkRow {
    const id = this.nextId('pil');
    const row: FakePageIssueLinkRow = { id, pageId, issueId, createdAt: new Date() };
    this.issueLinks.set(id, row);
    return row;
  }

  get prisma(): PrismaService {
    const self = this;
    const fake = {
      project: {
        findUnique: ({ where }: { where: { id: string } }) => {
          if (where.id === PROJECT_ID) {
            return Promise.resolve({ id: PROJECT_ID, key: self.projectKeys.get(PROJECT_ID), workspaceId: WORKSPACE_ID, workspace: { id: WORKSPACE_ID } });
          }
          if (where.id === OTHER_PROJECT_ID) {
            return Promise.resolve({ id: OTHER_PROJECT_ID, key: self.projectKeys.get(OTHER_PROJECT_ID), workspaceId: 'ws-2', workspace: { id: 'ws-2' } });
          }
          return Promise.resolve(null);
        },
      },
      membership: {
        findUnique: ({
          where,
        }: {
          where: { userId_workspaceId: { userId: string; workspaceId: string } };
        }) => {
          const { userId, workspaceId } = where.userId_workspaceId;
          if (workspaceId !== WORKSPACE_ID) return Promise.resolve(null);
          const role = self.roles.get(userId);
          return Promise.resolve(role ? { role } : null);
        },
      },
      projectMembership: {
        findUnique: () => Promise.resolve(null),
      },
      page: {
        findUnique: ({ where }: { where: { id: string } }) =>
          Promise.resolve(self.pages.get(where.id) ?? null),
        findFirst: ({
          where,
          orderBy,
        }: {
          where?: Record<string, unknown>;
          orderBy?: Record<string, 'asc' | 'desc'>;
        }) => {
          const rows = [...self.pages.values()].filter((r) =>
            matchesWhere(r as unknown as Record<string, unknown>, where, (id) => self.pages.get(id)),
          );
          sortRows(rows, orderBy);
          return Promise.resolve(rows[0] ?? null);
        },
        findMany: ({
          where,
          orderBy,
          take,
        }: {
          where?: Record<string, unknown>;
          orderBy?: Record<string, 'asc' | 'desc'>;
          take?: number;
        }) => {
          let rows = [...self.pages.values()].filter((r) =>
            matchesWhere(r as unknown as Record<string, unknown>, where, (id) => self.pages.get(id)),
          );
          sortRows(rows, orderBy);
          if (take) rows = rows.slice(0, take);
          return Promise.resolve(rows);
        },
        create: ({ data }: { data: Partial<FakePageRow> }) => {
          const row = self.addPage(data);
          return Promise.resolve(row);
        },
        update: ({ where, data }: { where: { id: string }; data: Partial<FakePageRow> }) => {
          const row = self.pages.get(where.id);
          if (!row) return Promise.reject(new Error('page not found'));
          Object.assign(row, data, { updatedAt: new Date() });
          return Promise.resolve(row);
        },
        delete: ({ where }: { where: { id: string } }) => {
          const row = self.pages.get(where.id);
          self.pages.delete(where.id);
          return Promise.resolve(row);
        },
        count: ({ where }: { where?: Record<string, unknown> }) =>
          Promise.resolve(
            [...self.pages.values()].filter((r) =>
              matchesWhere(r as unknown as Record<string, unknown>, where, (id) => self.pages.get(id)),
            ).length,
          ),
      },
      pageVersion: {
        create: ({ data }: { data: Omit<FakeVersionRow, 'id' | 'createdAt'> }) => {
          const row = self.addVersion(data);
          return Promise.resolve(row);
        },
        findFirst: ({
          where,
          orderBy,
        }: {
          where?: Record<string, unknown>;
          orderBy?: Record<string, 'asc' | 'desc'>;
        }) => {
          const rows = [...self.versions.values()].filter((r) =>
            matchesWhere(r as unknown as Record<string, unknown>, where, () => undefined),
          );
          sortRows(rows, orderBy);
          return Promise.resolve(rows[0] ?? null);
        },
        findMany: ({
          where,
          orderBy,
          take,
        }: {
          where?: Record<string, unknown>;
          orderBy?: Record<string, 'asc' | 'desc'>;
          take?: number;
        }) => {
          let rows = [...self.versions.values()].filter((r) =>
            matchesWhere(r as unknown as Record<string, unknown>, where, () => undefined),
          );
          sortRows(rows, orderBy);
          if (take) rows = rows.slice(0, take);
          return Promise.resolve(rows);
        },
        findUnique: ({
          where,
        }: {
          where: { pageId_versionNumber?: { pageId: string; versionNumber: number }; id?: string };
        }) => {
          if (where.pageId_versionNumber) {
            const { pageId, versionNumber } = where.pageId_versionNumber;
            const found = [...self.versions.values()].find(
              (r) => r.pageId === pageId && r.versionNumber === versionNumber,
            );
            return Promise.resolve(found ?? null);
          }
          return Promise.resolve(where.id ? self.versions.get(where.id) ?? null : null);
        },
      },
      pageLink: {
        findMany: ({
          where,
          include,
          orderBy,
          take,
        }: {
          where?: Record<string, unknown>;
          include?: { sourcePage?: unknown; targetPage?: unknown };
          orderBy?: Record<string, 'asc' | 'desc'>;
          take?: number;
        }) => {
          let rows = [...self.links.values()].filter((r) =>
            matchesWhere(r as unknown as Record<string, unknown>, where, (id) => self.pages.get(id)),
          );
          sortRows(rows, orderBy);
          if (typeof take === 'number') rows = rows.slice(0, take);
          return Promise.resolve(
            rows.map((r) => {
              let out: Record<string, unknown> = { ...r };
              if (include?.sourcePage) out = { ...out, sourcePage: self.pages.get(r.sourcePageId) ?? null };
              if (include?.targetPage) out = { ...out, targetPage: self.pages.get(r.targetPageId) ?? null };
              return out;
            }),
          );
        },
        createMany: ({ data }: { data: Array<{ sourcePageId: string; targetPageId: string }> }) => {
          let count = 0;
          for (const d of data) {
            const dup = [...self.links.values()].some(
              (l) => l.sourcePageId === d.sourcePageId && l.targetPageId === d.targetPageId,
            );
            if (dup) continue;
            const id = self.nextId('link');
            self.links.set(id, { id, sourcePageId: d.sourcePageId, targetPageId: d.targetPageId, createdAt: new Date() });
            count += 1;
          }
          return Promise.resolve({ count });
        },
        deleteMany: ({ where }: { where: { id: { in: string[] } } }) => {
          for (const id of where.id.in) self.links.delete(id);
          return Promise.resolve({ count: where.id.in.length });
        },
        count: ({ where }: { where?: { targetPageId?: string; sourcePageId?: string } }) =>
          Promise.resolve(
            [...self.links.values()].filter((r) => {
              if (where?.targetPageId !== undefined && r.targetPageId !== where.targetPageId) return false;
              if (where?.sourcePageId !== undefined && r.sourcePageId !== where.sourcePageId) return false;
              return true;
            }).length,
          ),
      },
      issue: {
        findUnique: ({ where }: { where: { id: string } }) =>
          Promise.resolve(self.issues.get(where.id) ?? null),
        findMany: ({
          where,
        }: {
          where?: { projectId?: string; number?: { in?: number[] } };
        }) => {
          const rows = [...self.issues.values()].filter((r) => {
            if (where?.projectId !== undefined && r.projectId !== where.projectId) return false;
            if (where?.number?.in && !where.number.in.includes(r.number)) return false;
            return true;
          });
          return Promise.resolve(rows);
        },
      },
      pageIssueLink: {
        findMany: ({
          where,
          include,
          orderBy,
          take,
        }: {
          where?: { pageId?: string; issueId?: string };
          include?: { issue?: unknown; page?: unknown };
          orderBy?: Record<string, 'asc' | 'desc'>;
          take?: number;
        }) => {
          let rows = [...self.issueLinks.values()].filter((r) => {
            if (where?.pageId !== undefined && r.pageId !== where.pageId) return false;
            if (where?.issueId !== undefined && r.issueId !== where.issueId) return false;
            return true;
          });
          sortRows(rows, orderBy);
          if (typeof take === 'number') rows = rows.slice(0, take);
          return Promise.resolve(
            rows.map((r) => {
              let out: Record<string, unknown> = { ...r };
              if (include?.issue) out = { ...out, issue: self.issues.get(r.issueId) ?? null };
              if (include?.page) out = { ...out, page: self.pages.get(r.pageId) ?? null };
              return out;
            }),
          );
        },
        createMany: ({ data }: { data: Array<{ pageId: string; issueId: string }> }) => {
          let count = 0;
          for (const d of data) {
            const dup = [...self.issueLinks.values()].some(
              (l) => l.pageId === d.pageId && l.issueId === d.issueId,
            );
            if (dup) continue;
            self.addPageIssueLink(d.pageId, d.issueId);
            count += 1;
          }
          return Promise.resolve({ count });
        },
        deleteMany: ({ where }: { where: { id: { in: string[] } } }) => {
          for (const id of where.id.in) self.issueLinks.delete(id);
          return Promise.resolve({ count: where.id.in.length });
        },
      },
      $transaction: (cb: (tx: unknown) => unknown) => Promise.resolve(cb(fake)),
    };
    return fake as unknown as PrismaService;
  }
}

const realtimeMock = {
  emitToProject: jest.fn(),
  emitToWorkspace: jest.fn(),
  emitToUser: jest.fn(),
  emit: jest.fn(),
} as unknown as RealtimeService;

function makeService(h: Harness): PagesService {
  return new PagesService(h.prisma, realtimeMock);
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------
describe('PagesService.create', () => {
  it('creates a top-level page, writes version 1, and defaults content to ""', async () => {
    const h = new Harness();
    h.setRole(MEMBER, Role.MEMBER);
    const service = makeService(h);

    const page = await service.create(MEMBER, PROJECT_ID, { title: 'Onboarding' });

    expect(page.title).toBe('Onboarding');
    expect(page.content).toBe('');
    expect(page.parentId).toBeNull();
    expect(page.authorId).toBe(MEMBER);

    const versions = [...h.versions.values()];
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ versionNumber: 1, title: 'Onboarding', content: '' });
    expect(realtimeMock.emitToProject).toHaveBeenCalledWith(
      PROJECT_ID,
      'page.updated',
      { projectId: PROJECT_ID, pageId: page.id },
    );
  });

  it('rejects a VIEWER (ForbiddenException)', async () => {
    const h = new Harness();
    h.setRole(VIEWER, Role.VIEWER);
    const service = makeService(h);
    await expect(service.create(VIEWER, PROJECT_ID, { title: 'x' })).rejects.toThrow(ForbiddenException);
  });

  it('rejects a parentId belonging to another project (BadRequestException)', async () => {
    const h = new Harness();
    h.setRole(MEMBER, Role.MEMBER);
    const foreignParent = h.addPage({ projectId: OTHER_PROJECT_ID });
    const service = makeService(h);
    await expect(
      service.create(MEMBER, PROJECT_ID, { title: 'x', parentId: foreignParent.id }),
    ).rejects.toThrow(BadRequestException);
  });

  it('resolves an existing [[wiki-link]] in the new content into a PageLink edge', async () => {
    const h = new Harness();
    h.setRole(MEMBER, Role.MEMBER);
    const target = h.addPage({ title: 'Runbook' });
    const service = makeService(h);

    const page = await service.create(MEMBER, PROJECT_ID, {
      title: 'Incident Postmortem',
      content: 'See [[Runbook]] for the response steps.',
    });

    const links = [...h.links.values()];
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ sourcePageId: page.id, targetPageId: target.id });
  });

  it('does not create an edge (or error) for an unresolved [[wiki-link]] to a not-yet-created page', async () => {
    const h = new Harness();
    h.setRole(MEMBER, Role.MEMBER);
    const service = makeService(h);

    const page = await service.create(MEMBER, PROJECT_ID, {
      title: 'Draft',
      content: 'This links to [[Not Created Yet]].',
    });

    expect(page).toBeDefined();
    expect(h.links.size).toBe(0);
  });

  it('excludes a self-link (content links to its own title) from PageLink edges', async () => {
    const h = new Harness();
    h.setRole(MEMBER, Role.MEMBER);
    const service = makeService(h);

    // A page whose body links to its OWN title should not create a
    // self-referencing edge — the source row is excluded from candidate
    // resolution regardless of the parsed link text.
    const page = await service.create(MEMBER, PROJECT_ID, {
      title: 'Self Page',
      content: 'See also [[Self Page]] (itself).',
    });

    expect(h.links.size).toBe(0);
    expect(page.title).toBe('Self Page');
  });
});

// ---------------------------------------------------------------------------
// findOne
// ---------------------------------------------------------------------------
describe('PagesService.findOne', () => {
  it('returns the page for a VIEWER (read-only) member', async () => {
    const h = new Harness();
    h.setRole(VIEWER, Role.VIEWER);
    const page = h.addPage({ title: 'Handbook' });
    const service = makeService(h);
    const dto = await service.findOne(VIEWER, page.id);
    expect(dto.title).toBe('Handbook');
  });

  it('404s for a nonexistent page', async () => {
    const h = new Harness();
    h.setRole(MEMBER, Role.MEMBER);
    const service = makeService(h);
    await expect(service.findOne(MEMBER, 'nope')).rejects.toThrow(NotFoundException);
  });

  it('rejects a non-member of the workspace (ForbiddenException)', async () => {
    const h = new Harness();
    const page = h.addPage({ title: 'Secret' });
    const service = makeService(h);
    await expect(service.findOne(FOREIGN, page.id)).rejects.toThrow(ForbiddenException);
  });
});

// ---------------------------------------------------------------------------
// update — content edits write a version; parentId/rank/archived don't
// ---------------------------------------------------------------------------
describe('PagesService.update', () => {
  it('writes a new PageVersion when content changes, and updates the live content', async () => {
    const h = new Harness();
    h.setRole(MEMBER, Role.MEMBER);
    const page = h.addPage({ title: 'Doc', content: 'v1 content' });
    h.addVersion({ pageId: page.id, versionNumber: 1, title: 'Doc', content: 'v1 content' });
    const service = makeService(h);

    const updated = await service.update(MEMBER, page.id, { content: 'v2 content' });

    expect(updated.content).toBe('v2 content');
    const versions = [...h.versions.values()].filter((v) => v.pageId === page.id);
    expect(versions).toHaveLength(2);
    expect(versions[1]).toMatchObject({ versionNumber: 2, content: 'v2 content' });
  });

  it('does NOT write a new version for an archived-only change', async () => {
    const h = new Harness();
    h.setRole(MEMBER, Role.MEMBER);
    const page = h.addPage({ title: 'Doc', content: 'body' });
    h.addVersion({ pageId: page.id, versionNumber: 1, title: 'Doc', content: 'body' });
    const service = makeService(h);

    await service.update(MEMBER, page.id, { archived: true });

    const versions = [...h.versions.values()].filter((v) => v.pageId === page.id);
    expect(versions).toHaveLength(1);
  });

  it('does NOT write a new version for a rank/parentId-only change', async () => {
    const h = new Harness();
    h.setRole(MEMBER, Role.MEMBER);
    const parent = h.addPage({ title: 'Parent' });
    const page = h.addPage({ title: 'Doc', content: 'body' });
    h.addVersion({ pageId: page.id, versionNumber: 1, title: 'Doc', content: 'body' });
    const service = makeService(h);

    await service.update(MEMBER, page.id, { parentId: parent.id, rank: 'z' });

    const versions = [...h.versions.values()].filter((v) => v.pageId === page.id);
    expect(versions).toHaveLength(1);
    expect(h.pages.get(page.id)?.parentId).toBe(parent.id);
    expect(h.pages.get(page.id)?.rank).toBe('z');
  });

  it('rejects reparenting a page to be its own parent (BadRequestException)', async () => {
    const h = new Harness();
    h.setRole(MEMBER, Role.MEMBER);
    const page = h.addPage({ title: 'Doc' });
    const service = makeService(h);
    await expect(service.update(MEMBER, page.id, { parentId: page.id })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects reparenting a page under its own descendant (cycle)', async () => {
    const h = new Harness();
    h.setRole(MEMBER, Role.MEMBER);
    const grandparent = h.addPage({ title: 'A' });
    const parent = h.addPage({ title: 'B', parentId: grandparent.id });
    const child = h.addPage({ title: 'C', parentId: parent.id });
    const service = makeService(h);

    // Moving A (grandparent) under C (its own grandchild) is a cycle.
    await expect(
      service.update(MEMBER, grandparent.id, { parentId: child.id }),
    ).rejects.toThrow(BadRequestException);
  });

  it('re-syncs wiki-links when content changes: adds a new edge and removes a stale one', async () => {
    const h = new Harness();
    h.setRole(MEMBER, Role.MEMBER);
    const pageA = h.addPage({ title: 'Page A' });
    const pageB = h.addPage({ title: 'Page B' });
    const source = h.addPage({ title: 'Source', content: '[[Page A]]' });
    h.links.set('link-1', { id: 'link-1', sourcePageId: source.id, targetPageId: pageA.id, createdAt: new Date() });
    const service = makeService(h);

    await service.update(MEMBER, source.id, { content: 'Now links to [[Page B]] instead.' });

    const links = [...h.links.values()].filter((l) => l.sourcePageId === source.id);
    expect(links).toHaveLength(1);
    expect(links[0].targetPageId).toBe(pageB.id);
  });

  it('404s for a nonexistent page', async () => {
    const h = new Harness();
    h.setRole(MEMBER, Role.MEMBER);
    const service = makeService(h);
    await expect(service.update(MEMBER, 'nope', { title: 'x' })).rejects.toThrow(NotFoundException);
  });
});

// ---------------------------------------------------------------------------
// remove — explicit 400 when the page has children
// ---------------------------------------------------------------------------
describe('PagesService.remove', () => {
  it('deletes a childless page', async () => {
    const h = new Harness();
    h.setRole(MEMBER, Role.MEMBER);
    const page = h.addPage({ title: 'Leaf' });
    const service = makeService(h);

    const result = await service.remove(MEMBER, page.id);

    expect(result).toEqual({ id: page.id, orphanedBacklinks: 0 });
    expect(h.pages.has(page.id)).toBe(false);
    expect(realtimeMock.emitToProject).toHaveBeenCalled();
  });

  it('reports how many inbound backlinks the delete orphaned (informed-consent signal)', async () => {
    const h = new Harness();
    h.setRole(MEMBER, Role.MEMBER);
    const hub = h.addPage({ title: 'Hub' });
    const s1 = h.addPage({ title: 'Source One' });
    const s2 = h.addPage({ title: 'Source Two' });
    h.links.set('l1', { id: 'l1', sourcePageId: s1.id, targetPageId: hub.id, createdAt: new Date() });
    h.links.set('l2', { id: 'l2', sourcePageId: s2.id, targetPageId: hub.id, createdAt: new Date() });
    // An OUTGOING link from the hub must not count — only inbound ones orphan.
    h.links.set('l3', { id: 'l3', sourcePageId: hub.id, targetPageId: s1.id, createdAt: new Date() });
    const service = makeService(h);

    const result = await service.remove(MEMBER, hub.id);

    expect(result).toEqual({ id: hub.id, orphanedBacklinks: 2 });
    expect(h.pages.has(hub.id)).toBe(false);
  });

  it('rejects deleting a page that has children (BadRequestException, no cascade)', async () => {
    const h = new Harness();
    h.setRole(MEMBER, Role.MEMBER);
    const parent = h.addPage({ title: 'Parent' });
    h.addPage({ title: 'Child', parentId: parent.id });
    const service = makeService(h);

    await expect(service.remove(MEMBER, parent.id)).rejects.toThrow(BadRequestException);
    // Not deleted — the rejection must not have side effects.
    expect(h.pages.has(parent.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// tree
// ---------------------------------------------------------------------------
describe('PagesService.tree', () => {
  it('builds a nested tree ordered by rank, VIEWER can read', async () => {
    const h = new Harness();
    h.setRole(VIEWER, Role.VIEWER);
    const root1 = h.addPage({ title: 'Root 1', rank: 'a' });
    const root2 = h.addPage({ title: 'Root 2', rank: 'b' });
    h.addPage({ title: 'Child of Root 1', parentId: root1.id, rank: 'a' });
    const service = makeService(h);

    const tree = await service.tree(VIEWER, PROJECT_ID);

    expect(tree).toHaveLength(2);
    expect(tree[0].id).toBe(root1.id);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[1].id).toBe(root2.id);
    expect(tree[1].children).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// move
// ---------------------------------------------------------------------------
describe('PagesService.move', () => {
  it('reorders a page between two siblings via beforeId/afterId', async () => {
    const h = new Harness();
    h.setRole(MEMBER, Role.MEMBER);
    const [rankA, rankB, rankC] = initialRanks(3);
    const a = h.addPage({ title: 'A', rank: rankA });
    const b = h.addPage({ title: 'B', rank: rankB });
    const c = h.addPage({ title: 'C', rank: rankC });
    const service = makeService(h);

    const moved = await service.move(MEMBER, c.id, { beforeId: a.id, afterId: b.id });

    expect(moved.rank > a.rank).toBe(true);
    expect(moved.rank < b.rank).toBe(true);
  });

  it('appends to the end of the destination sibling list when no beforeId/afterId given', async () => {
    const h = new Harness();
    h.setRole(MEMBER, Role.MEMBER);
    const [existingRank, movingRank] = initialRanks(2);
    const parent = h.addPage({ title: 'Parent' });
    const existingChild = h.addPage({ title: 'Existing child', parentId: parent.id, rank: existingRank });
    const page = h.addPage({ title: 'Moving page', rank: movingRank });
    const service = makeService(h);

    const moved = await service.move(MEMBER, page.id, { parentId: parent.id });

    expect(moved.parentId).toBe(parent.id);
    expect(moved.rank > existingChild.rank).toBe(true);
  });

  it('rejects a move that would create a cycle (reparent under own descendant)', async () => {
    const h = new Harness();
    h.setRole(MEMBER, Role.MEMBER);
    const grandparent = h.addPage({ title: 'A' });
    const parent = h.addPage({ title: 'B', parentId: grandparent.id });
    const child = h.addPage({ title: 'C', parentId: parent.id });
    const service = makeService(h);

    await expect(
      service.move(MEMBER, grandparent.id, { parentId: child.id }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects moving a page to be its own parent', async () => {
    const h = new Harness();
    h.setRole(MEMBER, Role.MEMBER);
    const page = h.addPage({ title: 'A' });
    const service = makeService(h);
    await expect(service.move(MEMBER, page.id, { parentId: page.id })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a parentId from another project', async () => {
    const h = new Harness();
    h.setRole(MEMBER, Role.MEMBER);
    const page = h.addPage({ title: 'A' });
    const foreignParent = h.addPage({ projectId: OTHER_PROJECT_ID, title: 'Foreign' });
    const service = makeService(h);
    await expect(
      service.move(MEMBER, page.id, { parentId: foreignParent.id }),
    ).rejects.toThrow(BadRequestException);
  });
});

// ---------------------------------------------------------------------------
// version history
// ---------------------------------------------------------------------------
describe('PagesService version history', () => {
  it('lists versions newest-first, compact (no content field)', async () => {
    const h = new Harness();
    h.setRole(VIEWER, Role.VIEWER);
    const page = h.addPage({ title: 'Doc' });
    h.addVersion({ pageId: page.id, versionNumber: 1, title: 'Doc', content: 'a' });
    h.addVersion({ pageId: page.id, versionNumber: 2, title: 'Doc', content: 'b' });
    h.addVersion({ pageId: page.id, versionNumber: 3, title: 'Doc', content: 'c' });
    const service = makeService(h);

    const result = await service.listVersions(VIEWER, page.id, {});

    expect(result.items.map((v) => v.versionNumber)).toEqual([3, 2, 1]);
    expect((result.items[0] as unknown as { content?: string }).content).toBeUndefined();
    expect(result.nextCursor).toBeNull();
  });

  it('paginates with a cursor', async () => {
    const h = new Harness();
    h.setRole(VIEWER, Role.VIEWER);
    const page = h.addPage({ title: 'Doc' });
    for (let n = 1; n <= 5; n += 1) {
      h.addVersion({ pageId: page.id, versionNumber: n, title: 'Doc', content: `v${n}` });
    }
    const service = makeService(h);

    const first = await service.listVersions(VIEWER, page.id, { limit: 2 });
    expect(first.items.map((v) => v.versionNumber)).toEqual([5, 4]);
    expect(first.nextCursor).not.toBeNull();

    const second = await service.listVersions(VIEWER, page.id, { limit: 2, cursor: first.nextCursor! });
    expect(second.items.map((v) => v.versionNumber)).toEqual([3, 2]);
  });

  it('getVersion 404s for a nonexistent version number', async () => {
    const h = new Harness();
    h.setRole(VIEWER, Role.VIEWER);
    const page = h.addPage({ title: 'Doc' });
    h.addVersion({ pageId: page.id, versionNumber: 1, title: 'Doc', content: 'a' });
    const service = makeService(h);
    await expect(service.getVersion(VIEWER, page.id, 99)).rejects.toThrow(NotFoundException);
  });

  it('restoreVersion writes a NEW version (never mutates history) with the old content', async () => {
    const h = new Harness();
    h.setRole(MEMBER, Role.MEMBER);
    const page = h.addPage({ title: 'Doc v3', content: 'content v3' });
    h.addVersion({ pageId: page.id, versionNumber: 1, title: 'Doc v1', content: 'content v1' });
    h.addVersion({ pageId: page.id, versionNumber: 2, title: 'Doc v2', content: 'content v2' });
    h.addVersion({ pageId: page.id, versionNumber: 3, title: 'Doc v3', content: 'content v3' });
    const service = makeService(h);

    const restored = await service.restoreVersion(MEMBER, page.id, 1);

    expect(restored.content).toBe('content v1');
    expect(restored.title).toBe('Doc v1');

    const versions = [...h.versions.values()]
      .filter((v) => v.pageId === page.id)
      .sort((a, b) => a.versionNumber - b.versionNumber);
    expect(versions).toHaveLength(4);
    expect(versions[3]).toMatchObject({ versionNumber: 4, title: 'Doc v1', content: 'content v1' });
    // Old versions untouched.
    expect(versions[0]).toMatchObject({ versionNumber: 1, title: 'Doc v1', content: 'content v1' });
    expect(versions[2]).toMatchObject({ versionNumber: 3, title: 'Doc v3', content: 'content v3' });
  });
});

// ---------------------------------------------------------------------------
// backlinks
// ---------------------------------------------------------------------------
describe('PagesService.backlinks', () => {
  it('returns compact refs for every page linking TO this page', async () => {
    const h = new Harness();
    h.setRole(VIEWER, Role.VIEWER);
    const target = h.addPage({ title: 'Target' });
    const source1 = h.addPage({ title: 'Source One' });
    const source2 = h.addPage({ title: 'Source Two' });
    h.links.set('l1', { id: 'l1', sourcePageId: source1.id, targetPageId: target.id, createdAt: new Date('2026-01-01') });
    h.links.set('l2', { id: 'l2', sourcePageId: source2.id, targetPageId: target.id, createdAt: new Date('2026-01-02') });
    const service = makeService(h);

    const backlinks = await service.backlinks(VIEWER, target.id);

    expect(backlinks).toHaveLength(2);
    expect(backlinks.map((b) => b.sourcePageTitle).sort()).toEqual(['Source One', 'Source Two']);
  });

  it('returns an empty array for a page with no backlinks', async () => {
    const h = new Harness();
    h.setRole(VIEWER, Role.VIEWER);
    const page = h.addPage({ title: 'Lonely' });
    const service = makeService(h);
    const backlinks = await service.backlinks(VIEWER, page.id);
    expect(backlinks).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// links (outgoing)
// ---------------------------------------------------------------------------
describe('PagesService.links', () => {
  it('resolves outgoing links from stored PageLink rows (authoritative), not re-derived from titles', async () => {
    const h = new Harness();
    h.setRole(VIEWER, Role.VIEWER);
    const target = h.addPage({ title: 'Target', createdAt: new Date('2026-01-01') });
    // A DUPLICATE title created later — proves the resolver trusts the stored
    // edge (oldest-page-wins tie-break already applied on save), not a
    // client-side guess that might pick the wrong same-titled page.
    h.addPage({ title: 'Target', createdAt: new Date('2026-02-01') });
    const source = h.addPage({ title: 'Source', content: 'see [[Target]] and [[Ghost]]' });
    h.links.set('l1', { id: 'l1', sourcePageId: source.id, targetPageId: target.id, createdAt: new Date() });
    const service = makeService(h);

    const result = await service.links(VIEWER, source.id);

    expect(result.resolved).toEqual([{ targetPageId: target.id, targetPageTitle: 'Target' }]);
    expect(result.unresolvedTitles).toEqual(['Ghost']);
    expect(result.truncated).toBe(false);
  });

  it('returns empty resolved + unresolved for a page with no links', async () => {
    const h = new Harness();
    h.setRole(VIEWER, Role.VIEWER);
    const page = h.addPage({ title: 'Plain', content: 'no links here' });
    const service = makeService(h);
    const result = await service.links(VIEWER, page.id);
    expect(result).toEqual({ resolved: [], unresolvedTitles: [], truncated: false });
  });

  it('caps resolved at MAX_OUTGOING_LINKS and sets truncated: true', async () => {
    const h = new Harness();
    h.setRole(VIEWER, Role.VIEWER);
    const source = h.addPage({ title: 'Hub' });
    for (let i = 0; i < MAX_OUTGOING_LINKS + 5; i += 1) {
      const t = h.addPage({ title: `T${i}` });
      h.links.set(`l${i}`, { id: `l${i}`, sourcePageId: source.id, targetPageId: t.id, createdAt: new Date(2026, 0, 1, 0, 0, i) });
    }
    const service = makeService(h);

    const result = await service.links(VIEWER, source.id);

    expect(result.resolved).toHaveLength(MAX_OUTGOING_LINKS);
    expect(result.truncated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// issue cross-links (PageIssueLink sync + the two link endpoints)
// ---------------------------------------------------------------------------
describe('PagesService issue cross-links', () => {
  it('create parses issue keys and links to same-project issues, ignoring cross-project keys', async () => {
    const h = new Harness();
    h.setRole(MEMBER, Role.MEMBER);
    const issue1 = h.addIssue({ number: 1 }); // PROJECT_ID, key NL
    h.addIssue({ number: 2, projectId: OTHER_PROJECT_ID }); // OTHER-2, must NOT match
    const service = makeService(h);

    // "NL-1" resolves (same project); "NL-2" has no issue #2 in NL; "OTHER-2"
    // never matches NL's key prefix at all.
    const page = await service.create(MEMBER, PROJECT_ID, {
      title: 'Design',
      content: 'Implements NL-1 and NL-2; see OTHER-2 for context.',
    });

    const links = [...h.issueLinks.values()].filter((l) => l.pageId === page.id);
    expect(links).toHaveLength(1);
    expect(links[0].issueId).toBe(issue1.id);
  });

  it('update reconciles links — adds newly-referenced, removes no-longer-referenced', async () => {
    const h = new Harness();
    h.setRole(MEMBER, Role.MEMBER);
    const issue1 = h.addIssue({ number: 1 });
    const issue2 = h.addIssue({ number: 2 });
    const page = await service_createLinked(h, 'Uses NL-1');
    expect([...h.issueLinks.values()].map((l) => l.issueId)).toEqual([issue1.id]);

    const service = makeService(h);
    await service.update(MEMBER, page.id, { content: 'Now uses NL-2 instead' });

    const after = [...h.issueLinks.values()].filter((l) => l.pageId === page.id);
    expect(after.map((l) => l.issueId)).toEqual([issue2.id]);
  });

  it('pageIssues returns compact issue refs (key composed) for a page', async () => {
    const h = new Harness();
    h.setRole(VIEWER, Role.VIEWER);
    const page = h.addPage({ title: 'Doc' });
    const issue = h.addIssue({ number: 7, title: 'Ship it' });
    h.addPageIssueLink(page.id, issue.id);
    const service = makeService(h);

    const result = await service.pageIssues(VIEWER, page.id);

    expect(result.truncated).toBe(false);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: issue.id, key: 'NL-7', title: 'Ship it' });
  });

  it('issuePages returns compact page refs linking TO an issue', async () => {
    const h = new Harness();
    h.setRole(VIEWER, Role.VIEWER);
    const issue = h.addIssue({ number: 9 });
    const p1 = h.addPage({ title: 'Spec' });
    const p2 = h.addPage({ title: 'Runbook' });
    h.addPageIssueLink(p1.id, issue.id);
    h.addPageIssueLink(p2.id, issue.id);
    const service = makeService(h);

    const result = await service.issuePages(VIEWER, issue.id);

    expect(result.truncated).toBe(false);
    expect(result.items.map((i) => i.title).sort()).toEqual(['Runbook', 'Spec']);
  });

  it('pageIssues caps at MAX_LINKED_ISSUES and sets truncated', async () => {
    const h = new Harness();
    h.setRole(VIEWER, Role.VIEWER);
    const page = h.addPage({ title: 'Mega' });
    for (let i = 0; i < MAX_LINKED_ISSUES + 3; i += 1) {
      const issue = h.addIssue({ number: 1000 + i });
      h.addPageIssueLink(page.id, issue.id);
    }
    const service = makeService(h);

    const result = await service.pageIssues(VIEWER, page.id);

    expect(result.items).toHaveLength(MAX_LINKED_ISSUES);
    expect(result.truncated).toBe(true);
  });

  it('issuePages caps at MAX_LINKED_PAGES and sets truncated', async () => {
    const h = new Harness();
    h.setRole(VIEWER, Role.VIEWER);
    const issue = h.addIssue({ number: 42 });
    for (let i = 0; i < MAX_LINKED_PAGES + 3; i += 1) {
      const page = h.addPage({ title: `P${i}` });
      h.addPageIssueLink(page.id, issue.id);
    }
    const service = makeService(h);

    const result = await service.issuePages(VIEWER, issue.id);

    expect(result.items).toHaveLength(MAX_LINKED_PAGES);
    expect(result.truncated).toBe(true);
  });
});

/** Create a page as MEMBER and return it (issue-link tests helper). */
async function service_createLinked(h: Harness, content: string) {
  return makeService(h).create(MEMBER, PROJECT_ID, { title: 'Linked', content });
}

// ---------------------------------------------------------------------------
// graph
// ---------------------------------------------------------------------------
describe('PagesService.graph', () => {
  it('returns all pages as nodes and all PageLink rows as edges, scoped to the project', async () => {
    const h = new Harness();
    h.setRole(VIEWER, Role.VIEWER);
    const a = h.addPage({ title: 'A' });
    const b = h.addPage({ title: 'B' });
    h.addPage({ projectId: OTHER_PROJECT_ID, title: 'Foreign' });
    h.links.set('l1', { id: 'l1', sourcePageId: a.id, targetPageId: b.id, createdAt: new Date() });
    const service = makeService(h);

    const graph = await service.graph(VIEWER, PROJECT_ID);

    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes.map((n) => n.id).sort()).toEqual([a.id, b.id].sort());
    expect(graph.edges).toEqual([{ sourceId: a.id, targetId: b.id }]);
    expect(graph.truncated).toBe(false);
  });

  it('caps nodes at MAX_GRAPH_NODES and sets truncated: true, dropping edges that touch a cut node', async () => {
    const h = new Harness();
    h.setRole(VIEWER, Role.VIEWER);
    const ids: string[] = [];
    for (let i = 0; i < MAX_GRAPH_NODES + 1; i += 1) {
      const p = h.addPage({ title: `Page ${i}`, createdAt: new Date(2026, 0, 1, 0, 0, i) });
      ids.push(p.id);
    }
    // Edge from the very first page to the very last (which gets truncated).
    h.links.set('l1', { id: 'l1', sourcePageId: ids[0], targetPageId: ids[ids.length - 1], createdAt: new Date() });
    const service = makeService(h);

    const graph = await service.graph(VIEWER, PROJECT_ID);

    expect(graph.nodes).toHaveLength(MAX_GRAPH_NODES);
    expect(graph.truncated).toBe(true);
    expect(graph.edges).toEqual([]); // the edge touched the truncated-out node
  });

  it('caps edges at MAX_GRAPH_EDGES and sets truncated (resource-exhaustion guard, review must-fix)', async () => {
    const h = new Harness();
    h.setRole(VIEWER, Role.VIEWER);
    // ~102 nodes (well under the node cap) densely linked to exceed the edge
    // cap — proves the edge query is bounded independently of the node cap.
    const ids: string[] = [];
    for (let i = 0; i < 102; i += 1) ids.push(h.addPage({ title: `N${i}` }).id);
    let e = 0;
    outer: for (const s of ids) {
      for (const t of ids) {
        if (s === t) continue;
        h.links.set(`l${e}`, { id: `l${e}`, sourcePageId: s, targetPageId: t, createdAt: new Date() });
        e += 1;
        if (e > MAX_GRAPH_EDGES) break outer;
      }
    }
    const service = makeService(h);

    const graph = await service.graph(VIEWER, PROJECT_ID);

    expect(graph.edges).toHaveLength(MAX_GRAPH_EDGES);
    expect(graph.truncated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Workspace-level docs (org-level-docs epic, Slice 2)
//
// A workspace page is a `Page` with `projectId: null` — not attached to any
// single project (e.g. a company handbook). Authorization for these routes
// goes through `assertWorkspaceRole` (workspace `Membership.role`) instead of
// `assertProjectRole`; every other CRUD/tree/graph/link behavior is exercised
// through the SAME service methods a project page uses (the service branches
// internally via `PagesService.assertPageRole`/`scopeOf`).
// ---------------------------------------------------------------------------
describe('PagesService workspace-level pages (org-level-docs epic, Slice 2)', () => {
  describe('createWorkspacePage', () => {
    it('creates a top-level workspace page (projectId: null, workspaceId set), writes version 1', async () => {
      const h = new Harness();
      h.setRole(MEMBER, Role.MEMBER);
      const service = makeService(h);

      const page = await service.createWorkspacePage(MEMBER, WORKSPACE_ID, { title: 'Handbook' });

      expect(page.projectId).toBeNull();
      expect(page.workspaceId).toBe(WORKSPACE_ID);
      expect(page.title).toBe('Handbook');
      expect(page.parentId).toBeNull();

      const versions = [...h.versions.values()].filter((v) => v.pageId === page.id);
      expect(versions).toHaveLength(1);
      expect(versions[0]).toMatchObject({ versionNumber: 1, title: 'Handbook' });
    });

    it('emits to the WORKSPACE room (emitToWorkspace), never the project room', async () => {
      const h = new Harness();
      h.setRole(MEMBER, Role.MEMBER);
      const service = makeService(h);

      const page = await service.createWorkspacePage(MEMBER, WORKSPACE_ID, { title: 'Handbook' });

      expect(realtimeMock.emitToWorkspace).toHaveBeenCalledWith(
        WORKSPACE_ID,
        'page.updated',
        { workspaceId: WORKSPACE_ID, pageId: page.id },
      );
      expect(realtimeMock.emitToProject).not.toHaveBeenCalled();
    });

    it('rejects a workspace VIEWER (ForbiddenException — write requires MEMBER+)', async () => {
      const h = new Harness();
      h.setRole(VIEWER, Role.VIEWER);
      const service = makeService(h);
      await expect(
        service.createWorkspacePage(VIEWER, WORKSPACE_ID, { title: 'x' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects a non-member of the workspace (ForbiddenException)', async () => {
      const h = new Harness();
      const service = makeService(h);
      await expect(
        service.createWorkspacePage(FOREIGN, WORKSPACE_ID, { title: 'x' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects a parentId that belongs to a PROJECT page (cross-scope reject, 400)', async () => {
      const h = new Harness();
      h.setRole(MEMBER, Role.MEMBER);
      const projectPage = h.addPage({ title: 'Project page' }); // projectId: PROJECT_ID
      const service = makeService(h);
      await expect(
        service.createWorkspacePage(MEMBER, WORKSPACE_ID, { title: 'x', parentId: projectPage.id }),
      ).rejects.toThrow(BadRequestException);
    });

    it('nests correctly under an existing workspace-page parent', async () => {
      const h = new Harness();
      h.setRole(MEMBER, Role.MEMBER);
      const service = makeService(h);
      const parent = await service.createWorkspacePage(MEMBER, WORKSPACE_ID, { title: 'Parent doc' });

      const child = await service.createWorkspacePage(MEMBER, WORKSPACE_ID, {
        title: 'Child doc',
        parentId: parent.id,
      });

      expect(child.parentId).toBe(parent.id);
    });
  });

  describe('by-id routes (findOne/update/move/remove) on a workspace page', () => {
    it('findOne: a workspace VIEWER can read', async () => {
      const h = new Harness();
      h.setRole(VIEWER, Role.VIEWER);
      const page = h.addPage({ projectId: null, title: 'Handbook' });
      const service = makeService(h);

      const dto = await service.findOne(VIEWER, page.id);
      expect(dto.title).toBe('Handbook');
      expect(dto.projectId).toBeNull();
    });

    it('findOne: rejects a non-member of the workspace', async () => {
      const h = new Harness();
      const page = h.addPage({ projectId: null, title: 'Secret' });
      const service = makeService(h);
      await expect(service.findOne(FOREIGN, page.id)).rejects.toThrow(ForbiddenException);
    });

    it('update: a MEMBER can edit content and a new version is written; emits emitToWorkspace', async () => {
      const h = new Harness();
      h.setRole(MEMBER, Role.MEMBER);
      const page = h.addPage({ projectId: null, title: 'Handbook', content: 'v1' });
      h.addVersion({ pageId: page.id, versionNumber: 1, title: 'Handbook', content: 'v1' });
      const service = makeService(h);

      const updated = await service.update(MEMBER, page.id, { content: 'v2' });

      expect(updated.content).toBe('v2');
      expect(realtimeMock.emitToWorkspace).toHaveBeenCalledWith(
        WORKSPACE_ID,
        'page.updated',
        { workspaceId: WORKSPACE_ID, pageId: page.id },
      );
    });

    it('update: rejects a workspace VIEWER (ForbiddenException)', async () => {
      const h = new Harness();
      h.setRole(VIEWER, Role.VIEWER);
      const page = h.addPage({ projectId: null, title: 'Handbook' });
      const service = makeService(h);
      await expect(service.update(VIEWER, page.id, { title: 'y' })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('move: reorders a workspace page among its workspace-page siblings', async () => {
      const h = new Harness();
      h.setRole(MEMBER, Role.MEMBER);
      const [rankA, rankB, rankC] = initialRanks(3);
      const a = h.addPage({ projectId: null, title: 'A', rank: rankA });
      const b = h.addPage({ projectId: null, title: 'B', rank: rankB });
      const c = h.addPage({ projectId: null, title: 'C', rank: rankC });
      const service = makeService(h);

      const moved = await service.move(MEMBER, c.id, { beforeId: a.id, afterId: b.id });

      expect(moved.rank > a.rank).toBe(true);
      expect(moved.rank < b.rank).toBe(true);
    });

    it('move: rejects a beforeId sibling that is actually a PROJECT page', async () => {
      const h = new Harness();
      h.setRole(MEMBER, Role.MEMBER);
      const wsPage = h.addPage({ projectId: null, title: 'WS page' });
      const projectPage = h.addPage({ title: 'Project page' });
      const service = makeService(h);

      await expect(
        service.move(MEMBER, wsPage.id, { beforeId: projectPage.id }),
      ).rejects.toThrow(BadRequestException);
    });

    it('remove: deletes a childless workspace page and emits emitToWorkspace', async () => {
      const h = new Harness();
      h.setRole(MEMBER, Role.MEMBER);
      const page = h.addPage({ projectId: null, title: 'Leaf' });
      const service = makeService(h);

      const result = await service.remove(MEMBER, page.id);

      expect(result).toEqual({ id: page.id, orphanedBacklinks: 0 });
      expect(h.pages.has(page.id)).toBe(false);
      expect(realtimeMock.emitToWorkspace).toHaveBeenCalled();
    });
  });

  describe('[[wiki-link]] resolution is scoped to workspace-level pages only', () => {
    it('resolves a [[link]] to another workspace-level page', async () => {
      const h = new Harness();
      h.setRole(MEMBER, Role.MEMBER);
      const target = h.addPage({ projectId: null, title: 'Runbook' });
      const service = makeService(h);

      const page = await service.createWorkspacePage(MEMBER, WORKSPACE_ID, {
        title: 'Onboarding',
        content: 'See [[Runbook]].',
      });

      const links = [...h.links.values()];
      expect(links).toHaveLength(1);
      expect(links[0]).toMatchObject({ sourcePageId: page.id, targetPageId: target.id });
    });

    it('does NOT resolve a [[link]] to a PROJECT page with a matching title (cross-scope isolation)', async () => {
      const h = new Harness();
      h.setRole(MEMBER, Role.MEMBER);
      h.addPage({ title: 'Runbook' }); // a PROJECT page, same title
      const service = makeService(h);

      const page = await service.createWorkspacePage(MEMBER, WORKSPACE_ID, {
        title: 'Onboarding',
        content: 'See [[Runbook]].',
      });

      expect(h.links.size).toBe(0);
      expect(page).toBeDefined();
    });

    it('a PROJECT page does NOT resolve a [[link]] to a workspace-level page with a matching title', async () => {
      const h = new Harness();
      h.setRole(MEMBER, Role.MEMBER);
      h.addPage({ projectId: null, title: 'Runbook' }); // a WORKSPACE page, same title
      const service = makeService(h);

      const page = await service.create(MEMBER, PROJECT_ID, {
        title: 'Onboarding',
        content: 'See [[Runbook]].',
      });

      expect(h.links.size).toBe(0);
      expect(page).toBeDefined();
    });
  });

  describe('issue-key sync is SKIPPED for workspace pages (deliberate slice-2 behavior)', () => {
    it('creates no PageIssueLink rows even when content mentions a valid issue key', async () => {
      const h = new Harness();
      h.setRole(MEMBER, Role.MEMBER);
      h.addIssue({ number: 1, projectId: PROJECT_ID }); // NL-1 exists
      const service = makeService(h);

      const page = await service.createWorkspacePage(MEMBER, WORKSPACE_ID, {
        title: 'Notes',
        content: 'Related to NL-1.',
      });

      expect(h.issueLinks.size).toBe(0);
      const result = await service.pageIssues(MEMBER, page.id);
      expect(result.items).toEqual([]);
    });

    it('still syncs issue links normally for a PROJECT page (unchanged control case)', async () => {
      const h = new Harness();
      h.setRole(MEMBER, Role.MEMBER);
      const issue = h.addIssue({ number: 1, projectId: PROJECT_ID });
      const service = makeService(h);

      const page = await service.create(MEMBER, PROJECT_ID, {
        title: 'Notes',
        content: 'Related to NL-1.',
      });

      const links = [...h.issueLinks.values()];
      expect(links).toHaveLength(1);
      expect(links[0]).toMatchObject({ pageId: page.id, issueId: issue.id });
    });
  });

  describe('workspaceTree', () => {
    it('builds a tree of workspace-level pages only, excluding project pages', async () => {
      const h = new Harness();
      h.setRole(VIEWER, Role.VIEWER);
      const root = h.addPage({ projectId: null, title: 'WS Root', rank: 'a' });
      h.addPage({ projectId: null, title: 'WS Child', parentId: root.id, rank: 'a' });
      h.addPage({ title: 'Project Root' }); // a project page — must not appear
      const service = makeService(h);

      const tree = await service.workspaceTree(VIEWER, WORKSPACE_ID);

      expect(tree).toHaveLength(1);
      expect(tree[0].id).toBe(root.id);
      expect(tree[0].children).toHaveLength(1);
    });

    it('rejects a non-member of the workspace', async () => {
      const h = new Harness();
      const service = makeService(h);
      await expect(service.workspaceTree(FOREIGN, WORKSPACE_ID)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('workspaceGraph', () => {
    it('returns workspace-level pages as nodes and their PageLink edges, excluding project pages', async () => {
      const h = new Harness();
      h.setRole(VIEWER, Role.VIEWER);
      const a = h.addPage({ projectId: null, title: 'A' });
      const b = h.addPage({ projectId: null, title: 'B' });
      h.addPage({ title: 'Project page (excluded)' });
      h.links.set('l1', { id: 'l1', sourcePageId: a.id, targetPageId: b.id, createdAt: new Date() });
      const service = makeService(h);

      const graph = await service.workspaceGraph(VIEWER, WORKSPACE_ID);

      expect(graph.nodes).toHaveLength(2);
      expect(graph.nodes.map((n) => n.id).sort()).toEqual([a.id, b.id].sort());
      expect(graph.edges).toEqual([{ sourceId: a.id, targetId: b.id }]);
    });
  });
});
