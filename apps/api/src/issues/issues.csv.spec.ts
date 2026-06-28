/**
 * DB-free unit tests for:
 *  1. csvCell() — RFC-4180 escaping + formula-injection guard
 *  2. IssuesService.exportCsv() — header row, data rows, NLQL filter, auth
 *
 * All Prisma calls are mocked; no database required.
 */

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { csvCell, csvRow } from './csv.util';
import { IssuesService } from './issues.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RealtimeService } from '../realtime/realtime.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { WebhooksService } from '../webhooks/webhooks.service';
import type { CustomFieldsService } from '../custom-fields/custom-fields.service';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { Priority, IssueType, StatusCategory } from '@next-lane/shared';

// ─────────────────────────────────────────────────────────────────────────────
// Section 1 — csvCell() unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe('csvCell()', () => {
  // ── Basic passthrough ──────────────────────────────────────────────────────

  it('returns empty string for null', () => {
    expect(csvCell(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(csvCell(undefined)).toBe('');
  });

  it('returns plain strings unchanged', () => {
    expect(csvCell('hello')).toBe('hello');
  });

  it('coerces numbers to strings', () => {
    expect(csvCell(42)).toBe('42');
  });

  it('coerces booleans to strings', () => {
    expect(csvCell(true)).toBe('true');
    expect(csvCell(false)).toBe('false');
  });

  // ── RFC-4180 quoting ────────────────────────────────────────────────────────

  it('wraps a field containing a comma in double-quotes', () => {
    expect(csvCell('foo,bar')).toBe('"foo,bar"');
  });

  it('wraps a field containing a double-quote and doubles the quote', () => {
    expect(csvCell('say "hello"')).toBe('"say ""hello"""');
  });

  it('wraps a field containing a LF newline', () => {
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('wraps a field containing a CR newline', () => {
    expect(csvCell('line1\rline2')).toBe('"line1\rline2"');
  });

  it('wraps a field containing CRLF', () => {
    expect(csvCell('line1\r\nline2')).toBe('"line1\r\nline2"');
  });

  it('handles a field that is only a double-quote', () => {
    expect(csvCell('"')).toBe('""""');
  });

  it('handles multiple commas and quotes combined', () => {
    // "a","b" → should quote and double each internal quote
    expect(csvCell('"a","b"')).toBe('"""a"",""b"""');
  });

  // ── Formula-injection guard ─────────────────────────────────────────────────

  it('prefixes a leading = with an apostrophe', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
  });

  it('prefixes a leading + with an apostrophe', () => {
    expect(csvCell('+1')).toBe("'+1");
  });

  it('prefixes a leading - with an apostrophe', () => {
    expect(csvCell('-1')).toBe("'-1");
  });

  it('prefixes a leading @ with an apostrophe', () => {
    expect(csvCell('@foo')).toBe("'@foo");
  });

  it('does NOT prefix a middle = that is not at position 0', () => {
    expect(csvCell('foo=bar')).toBe('foo=bar');
  });

  it('formula prefix + comma quoting: =SUM(A1,B1) needs both guards', () => {
    // First the formula guard adds ', then the comma triggers quoting.
    expect(csvCell('=SUM(A1,B1)')).toBe("\"'=SUM(A1,B1)\"");
  });

  it('formula prefix + quote inside: =HYPERLINK("url") needs both guards', () => {
    const input = '=HYPERLINK("url")';
    // After formula guard: '=HYPERLINK("url")
    // After RFC-4180 quoting (contains "): wrap in quotes, double internals
    expect(csvCell(input)).toBe(`"'=HYPERLINK(""url"")"`);
  });

  // ── Edge cases ──────────────────────────────────────────────────────────────

  it('handles an empty string', () => {
    expect(csvCell('')).toBe('');
  });

  it('handles a string with only spaces', () => {
    expect(csvCell('   ')).toBe('   ');
  });

  it('leaves normal issue keys (NL-123) unchanged', () => {
    expect(csvCell('NL-123')).toBe('NL-123');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 2 — IssuesService.exportCsv() unit tests
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal stubs for IssuesService constructor dependencies. */
const noOpEventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;
const noOpCustomFields = {
  validateAndNormalize: jest.fn().mockResolvedValue({}),
} as unknown as CustomFieldsService;
const noOpWebhooks = { dispatch: jest.fn() } as unknown as WebhooksService;
const noOpRealtime = {} as RealtimeService;
const noOpNotifications = {} as NotificationsService;

/** Build a minimal issue row (as Prisma returns) for test fixtures. */
function makeIssueRow(overrides: {
  id?: string;
  number?: number;
  title?: string;
  type?: string;
  priority?: string;
  storyPoints?: number | null;
  assignee?: { id: string; email: string; name: string; avatarColor: string; createdAt: Date } | null;
  reporter?: { id: string; email: string; name: string; avatarColor: string; createdAt: Date } | null;
  status?: { id: string; name: string; category: string; order: number; projectId: string } | null;
  sprint?: { name: string } | null;
  labels?: Array<{ label: { id: string; name: string; color: string; projectId: string } }>;
  dueDate?: Date | null;
} = {}) {
  const now = new Date('2026-06-28T10:00:00.000Z');
  return {
    id: overrides.id ?? 'issue-1',
    number: overrides.number ?? 1,
    projectId: 'proj-1',
    type: overrides.type ?? IssueType.TASK,
    title: overrides.title ?? 'Test issue',
    description: null,
    statusId: 'status-1',
    assigneeId: overrides.assignee?.id ?? null,
    reporterId: overrides.reporter?.id ?? null,
    priority: overrides.priority ?? Priority.MEDIUM,
    storyPoints: overrides.storyPoints ?? null,
    parentId: null,
    sprintId: overrides.sprint ? 'sprint-1' : null,
    dueDate: overrides.dueDate ?? null,
    rank: 'a0',
    customFields: null,
    createdAt: now,
    updatedAt: now,
    project: { key: 'NL' },
    status: overrides.status ?? { id: 'status-1', name: 'To Do', category: StatusCategory.TODO, order: 0, projectId: 'proj-1' },
    assignee: overrides.assignee ?? null,
    reporter: overrides.reporter ?? null,
    labels: overrides.labels ?? [],
    sprint: overrides.sprint ?? null,
    _count: { comments: 0 },
  };
}

/** Build a minimal Prisma mock that satisfies exportCsv's DB calls. */
function makePrisma(opts: {
  isMember?: boolean;
  projectKey?: string;
  issues?: ReturnType<typeof makeIssueRow>[];
  customFieldDefs?: unknown[];
} = {}) {
  const isMember = opts.isMember ?? true;
  const projectKey = opts.projectKey ?? 'NL';
  const issues = opts.issues ?? [makeIssueRow()];
  const customFieldDefs = opts.customFieldDefs ?? [];

  return {
    project: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'proj-1',
        key: projectKey,
        workspaceId: 'ws-1',
        workspace: { id: 'ws-1' },
      }),
    },
    membership: {
      findUnique: jest.fn().mockResolvedValue(
        isMember ? { id: 'mem-1', role: 'MEMBER', userId: 'user-1', workspaceId: 'ws-1' } : null,
      ),
    },
    issue: {
      findMany: jest.fn().mockResolvedValue(issues),
    },
    customFieldDefinition: {
      findMany: jest.fn().mockResolvedValue(customFieldDefs),
    },
  } as unknown as PrismaService;
}

/** Instantiate IssuesService with a given Prisma mock. */
function makeService(prisma: PrismaService): IssuesService {
  return new IssuesService(
    prisma,
    noOpRealtime,
    noOpNotifications,
    noOpWebhooks,
    noOpCustomFields,
    noOpEventEmitter,
  );
}

// ── Header row ────────────────────────────────────────────────────────────────

describe('IssuesService.exportCsv — header row', () => {
  it('produces the correct header as the first CSV line', async () => {
    const prisma = makePrisma({ issues: [] });
    const service = makeService(prisma);

    const { csv } = await service.exportCsv('user-1', 'proj-1');
    const lines = csv.split('\r\n').filter(Boolean);

    expect(lines[0]).toBe(
      'Key,Title,Type,Status,Priority,Assignee,Reporter,Story Points,Sprint,Labels,Due Date,Created,Updated',
    );
  });

  it('returns only the header when the project has no issues', async () => {
    const prisma = makePrisma({ issues: [] });
    const service = makeService(prisma);

    const { csv } = await service.exportCsv('user-1', 'proj-1');
    const lines = csv.split('\r\n').filter(Boolean);

    expect(lines).toHaveLength(1);
  });
});

// ── Data rows ─────────────────────────────────────────────────────────────────

describe('IssuesService.exportCsv — data rows', () => {
  it('renders a minimal issue with empty optional fields correctly', async () => {
    const issue = makeIssueRow({
      id: 'issue-1',
      number: 7,
      title: 'Simple task',
      type: IssueType.TASK,
      priority: Priority.MEDIUM,
    });
    const prisma = makePrisma({ issues: [issue] });
    const service = makeService(prisma);

    const { csv } = await service.exportCsv('user-1', 'proj-1');
    const lines = csv.split('\r\n').filter(Boolean);

    // Second line (after header) should be the issue row.
    const row = lines[1];
    // Key = NL-7
    expect(row).toContain('NL-7');
    expect(row).toContain('Simple task');
    expect(row).toContain('TASK');
    expect(row).toContain('To Do');
    expect(row).toContain('MEDIUM');
  });

  it('renders assignee name, reporter name, sprint name, and labels', async () => {
    const issue = makeIssueRow({
      id: 'issue-2',
      number: 2,
      title: 'Full issue',
      assignee: {
        id: 'u-1',
        email: 'alice@example.com',
        name: 'Alice Smith',
        avatarColor: '#fff',
        createdAt: new Date(),
      },
      reporter: {
        id: 'u-2',
        email: 'bob@example.com',
        name: 'Bob Jones',
        avatarColor: '#000',
        createdAt: new Date(),
      },
      sprint: { name: 'Sprint 1' },
      labels: [
        { label: { id: 'l-1', name: 'bug', color: '#f00', projectId: 'proj-1' } },
        { label: { id: 'l-2', name: 'critical', color: '#f00', projectId: 'proj-1' } },
      ],
      storyPoints: 5,
    });
    const prisma = makePrisma({ issues: [issue] });
    const service = makeService(prisma);

    const { csv } = await service.exportCsv('user-1', 'proj-1');
    const lines = csv.split('\r\n').filter(Boolean);
    const row = lines[1];

    expect(row).toContain('Alice Smith');
    expect(row).toContain('Bob Jones');
    expect(row).toContain('Sprint 1');
    // Labels joined by "; " — no comma so no extra quoting needed.
    expect(row).toContain('bug; critical');
    expect(row).toContain('5');
  });

  it('renders a due date as ISO 8601', async () => {
    const dueDate = new Date('2026-09-30T00:00:00.000Z');
    const issue = makeIssueRow({ dueDate });
    const prisma = makePrisma({ issues: [issue] });
    const service = makeService(prisma);

    const { csv } = await service.exportCsv('user-1', 'proj-1');
    const lines = csv.split('\r\n').filter(Boolean);
    expect(lines[1]).toContain('2026-09-30T00:00:00.000Z');
  });

  it('leaves story points empty when null', async () => {
    const issue = makeIssueRow({ storyPoints: null });
    const prisma = makePrisma({ issues: [issue] });
    const service = makeService(prisma);

    const { csv } = await service.exportCsv('user-1', 'proj-1');
    const lines = csv.split('\r\n').filter(Boolean);

    // Parse the 8th column (Story Points, 0-indexed = col 7).
    // The row has no quoting on empty fields so split by commas is fine here.
    const cols = lines[1].split(',');
    expect(cols[7]).toBe(''); // Story Points column
  });

  it('orders rows by issue number ascending', async () => {
    const i3 = makeIssueRow({ id: 'issue-3', number: 3, title: 'Third' });
    const i1 = makeIssueRow({ id: 'issue-1', number: 1, title: 'First' });
    const i2 = makeIssueRow({ id: 'issue-2', number: 2, title: 'Second' });
    // Prisma mock returns them in the order we provide; the service relies on
    // the DB ORDER BY number ASC — so we supply them in order to simulate that.
    const prisma = makePrisma({ issues: [i1, i2, i3] });
    const service = makeService(prisma);

    const { csv } = await service.exportCsv('user-1', 'proj-1');
    const lines = csv.split('\r\n').filter(Boolean);

    expect(lines[1]).toContain('NL-1');
    expect(lines[2]).toContain('NL-2');
    expect(lines[3]).toContain('NL-3');
  });

  it('uses email as fallback when assignee name is empty', async () => {
    const issue = makeIssueRow({
      assignee: {
        id: 'u-3',
        email: 'charlie@example.com',
        name: '', // empty name
        avatarColor: '#aaa',
        createdAt: new Date(),
      },
    });
    const prisma = makePrisma({ issues: [issue] });
    const service = makeService(prisma);

    const { csv } = await service.exportCsv('user-1', 'proj-1');
    expect(csv).toContain('charlie@example.com');
  });

  it('returns the project key in the result', async () => {
    const prisma = makePrisma({ issues: [], projectKey: 'MYPROJ' });
    const service = makeService(prisma);

    const { projectKey } = await service.exportCsv('user-1', 'proj-1');
    expect(projectKey).toBe('MYPROJ');
  });
});

// ── CSV escaping in data cells ────────────────────────────────────────────────

describe('IssuesService.exportCsv — RFC-4180 escaping in issue data', () => {
  it('quotes a title that contains a comma', async () => {
    const issue = makeIssueRow({ title: 'Fix foo, bar, baz' });
    const prisma = makePrisma({ issues: [issue] });
    const service = makeService(prisma);

    const { csv } = await service.exportCsv('user-1', 'proj-1');
    expect(csv).toContain('"Fix foo, bar, baz"');
  });

  it('doubles quotes inside a title', async () => {
    const issue = makeIssueRow({ title: 'She said "hello"' });
    const prisma = makePrisma({ issues: [issue] });
    const service = makeService(prisma);

    const { csv } = await service.exportCsv('user-1', 'proj-1');
    expect(csv).toContain('"She said ""hello"""');
  });

  it('wraps a multi-line title in quotes', async () => {
    const issue = makeIssueRow({ title: 'line1\nline2' });
    const prisma = makePrisma({ issues: [issue] });
    const service = makeService(prisma);

    const { csv } = await service.exportCsv('user-1', 'proj-1');
    expect(csv).toContain('"line1\nline2"');
  });
});

// ── NLQL filter ───────────────────────────────────────────────────────────────

describe('IssuesService.exportCsv — NLQL filter', () => {
  it('returns all issues when no q is provided', async () => {
    const issues = [
      makeIssueRow({ id: 'i-1', number: 1 }),
      makeIssueRow({ id: 'i-2', number: 2 }),
    ];
    const prisma = makePrisma({ issues });
    const service = makeService(prisma);

    const { csv } = await service.exportCsv('user-1', 'proj-1');
    const lines = csv.split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(3); // header + 2 data rows
  });

  it('filters issues by priority with a valid NLQL query', async () => {
    const highIssue = makeIssueRow({
      id: 'i-1',
      number: 1,
      title: 'High one',
      priority: Priority.HIGH,
    });
    const mediumIssue = makeIssueRow({
      id: 'i-2',
      number: 2,
      title: 'Medium one',
      priority: Priority.MEDIUM,
    });
    const prisma = makePrisma({ issues: [highIssue, mediumIssue] });
    const service = makeService(prisma);

    const { csv } = await service.exportCsv('user-1', 'proj-1', 'priority = HIGH');
    const lines = csv.split('\r\n').filter(Boolean);

    // Only the High-priority issue should remain.
    expect(lines).toHaveLength(2); // header + 1 data row
    expect(lines[1]).toContain('High one');
    expect(lines[1]).not.toContain('Medium one');
  });

  it('returns 400 on an invalid NLQL query', async () => {
    const prisma = makePrisma({ issues: [] });
    const service = makeService(prisma);

    await expect(
      service.exportCsv('user-1', 'proj-1', 'priority ==== !!!invalid'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ── Authorization ─────────────────────────────────────────────────────────────

describe('IssuesService.exportCsv — authorization', () => {
  it('throws ForbiddenException when the user is not a project member', async () => {
    const prisma = makePrisma({ isMember: false });
    const service = makeService(prisma);

    await expect(
      service.exportCsv('non-member', 'proj-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a project member to export (VIEWER-equivalent)', async () => {
    const prisma = makePrisma({ issues: [], isMember: true });
    const service = makeService(prisma);

    await expect(service.exportCsv('user-1', 'proj-1')).resolves.toBeDefined();
  });
});
