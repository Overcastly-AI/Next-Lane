/**
 * DB-free unit tests for IssuesImportService.importCsv().
 *
 * All Prisma calls and IssuesService.create() are mocked;
 * no database required.
 */

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { IssuesImportService, IMPORT_MAX_ROWS } from './issues-import.service';
import type { IssuesService } from './issues.service';
import type { PrismaService } from '../prisma/prisma.service';
import { IssueType, Priority, StatusCategory } from '@next-lane/shared';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const PROJECT_ID = 'proj-1';
const WORKSPACE_ID = 'ws-1';
const USER_ID = 'user-1';

const TODO_STATUS = {
  id: 'status-todo',
  name: 'To Do',
  category: StatusCategory.TODO,
  order: 0,
  projectId: PROJECT_ID,
};

const IN_PROGRESS_STATUS = {
  id: 'status-inprogress',
  name: 'In Progress',
  category: StatusCategory.IN_PROGRESS,
  order: 1,
  projectId: PROJECT_ID,
};

const ALICE = { id: 'user-alice', email: 'alice@example.com' };

function makeProject() {
  return {
    id: PROJECT_ID,
    workspaceId: WORKSPACE_ID,
    workspace: { id: WORKSPACE_ID },
    key: 'NL',
  };
}

function makeIssueDto(overrides: { id?: string; title?: string } = {}) {
  return {
    id: overrides.id ?? 'issue-1',
    key: 'NL-1',
    number: 1,
    projectId: PROJECT_ID,
    type: IssueType.TASK,
    title: overrides.title ?? 'Test Issue',
    description: null,
    statusId: 'status-todo',
    assigneeId: null,
    reporterId: USER_ID,
    priority: Priority.MEDIUM,
    storyPoints: null,
    parentId: null,
    sprintId: null,
    startDate: null,
    dueDate: null,
    rank: 'a0',
    originalEstimateMinutes: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: build a Prisma mock
// The mocks are exposed separately so tests can assert on them.
// ─────────────────────────────────────────────────────────────────────────────

interface PrismaMockOpts {
  isMember?: boolean;
  statuses?: typeof TODO_STATUS[];
  members?: { id: string; email: string }[];
  labels?: { id: string; name: string; color: string; projectId: string }[];
  /** Pre-existing components in the TARGET project (matched by name). */
  components?: { id: string; name: string; projectId: string }[];
  /** Pre-existing fix versions in the TARGET project (matched by name). */
  versions?: { id: string; name: string; projectId: string }[];
  /** Custom-field definitions in the TARGET project (matched by name). */
  customFieldDefs?: { id: string; name: string; type: string; projectId: string }[];
}

interface Mocks {
  prisma: PrismaService;
  labelCreate: jest.Mock;
  issueLabelUpsert: jest.Mock;
  componentCreate: jest.Mock;
  versionCreate: jest.Mock;
  issueVersionUpsert: jest.Mock;
}

function buildMocks(opts: PrismaMockOpts = {}): Mocks {
  const isMember = opts.isMember ?? true;
  const statuses = opts.statuses ?? [TODO_STATUS];
  const members = opts.members ?? [ALICE];
  const labels = opts.labels ?? [];
  const components = opts.components ?? [];
  const versions = opts.versions ?? [];
  const customFieldDefs = opts.customFieldDefs ?? [];

  const labelCreate = jest.fn().mockImplementation(
    async (args: { data: { name: string; color: string; projectId: string } }) => ({
      id: `label-${args.data.name}`,
      name: args.data.name,
      color: args.data.color,
      projectId: args.data.projectId,
    }),
  );

  const issueLabelUpsert = jest.fn().mockResolvedValue({});

  const componentCreate = jest.fn().mockImplementation(
    async (args: { data: { name: string; projectId: string } }) => ({
      id: `component-${args.data.name}`,
      name: args.data.name,
      projectId: args.data.projectId,
    }),
  );
  const versionCreate = jest.fn().mockImplementation(
    async (args: { data: { name: string; projectId: string } }) => ({
      id: `version-${args.data.name}`,
      name: args.data.name,
      projectId: args.data.projectId,
    }),
  );
  const issueVersionUpsert = jest.fn().mockResolvedValue({});

  const prisma = {
    project: {
      findUnique: jest.fn().mockResolvedValue(makeProject()),
    },
    membership: {
      findUnique: jest.fn().mockResolvedValue(
        isMember
          ? { id: 'mem-1', role: 'MEMBER', userId: USER_ID, workspaceId: WORKSPACE_ID }
          : null,
      ),
      findMany: jest.fn().mockResolvedValue(
        members.map((m) => ({ user: { id: m.id, email: m.email }, workspaceId: WORKSPACE_ID })),
      ),
    },
    projectMembership: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    status: {
      findMany: jest.fn().mockResolvedValue(statuses),
    },
    label: {
      findMany: jest.fn().mockResolvedValue(labels),
      create: labelCreate,
    },
    issueLabel: {
      upsert: issueLabelUpsert,
    },
    component: {
      findMany: jest.fn().mockResolvedValue(components),
      create: componentCreate,
    },
    version: {
      findMany: jest.fn().mockResolvedValue(versions),
      create: versionCreate,
    },
    customFieldDefinition: {
      findMany: jest.fn().mockResolvedValue(customFieldDefs),
    },
    issueVersion: {
      upsert: issueVersionUpsert,
    },
  } as unknown as PrismaService;

  return {
    prisma,
    labelCreate,
    issueLabelUpsert,
    componentCreate,
    versionCreate,
    issueVersionUpsert,
  };
}

/** Build IssuesImportService with given deps. */
function makeService(
  prisma: PrismaService,
  issueCreateFn?: jest.Mock,
  issueUpdateFn?: jest.Mock,
): IssuesImportService {
  const issuesService = {
    create: issueCreateFn ?? jest.fn().mockResolvedValue(makeIssueDto()),
    // The parent pass re-enters IssuesService.update so the cycle guard and
    // activity log apply to an imported parent exactly as to a hand-set one.
    update: issueUpdateFn ?? jest.fn().mockResolvedValue(makeIssueDto()),
  } as unknown as IssuesService;

  return new IssuesImportService(prisma, issuesService);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: CSV fixtures
// ─────────────────────────────────────────────────────────────────────────────

const HEADER =
  'Key,Title,Type,Status,Priority,Assignee,Reporter,Story Points,Sprint,Labels,Due Date,Created,Updated\r\n';

function makeRow(
  overrides: {
    title?: string;
    type?: string;
    status?: string;
    priority?: string;
    assignee?: string;
    storyPoints?: string;
    labels?: string;
    dueDate?: string;
  } = {},
): string {
  return (
    [
      '',                           // Key (ignored)
      overrides.title ?? 'Test issue',
      overrides.type ?? 'TASK',
      overrides.status ?? 'To Do',
      overrides.priority ?? 'MEDIUM',
      overrides.assignee ?? '',
      '',                           // Reporter (ignored)
      overrides.storyPoints ?? '',
      '',                           // Sprint (ignored)
      overrides.labels ?? '',
      overrides.dueDate ?? '',
      '',                           // Created (ignored)
      '',                           // Updated (ignored)
    ].join(',') + '\r\n'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Happy path
// ─────────────────────────────────────────────────────────────────────────────

describe('IssuesImportService.importCsv — happy path', () => {
  it('creates one issue for one valid data row', async () => {
    const { prisma } = buildMocks();
    const service = makeService(prisma);

    const result = await service.importCsv(USER_ID, PROJECT_ID, HEADER + makeRow({ title: 'First issue' }));

    expect(result.created).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(result.dryRun).toBe(false);
  });

  it('creates N issues for N valid data rows', async () => {
    const { prisma } = buildMocks();
    let counter = 0;
    const createFn = jest.fn().mockImplementation(async () =>
      makeIssueDto({ id: `issue-${++counter}` }),
    );
    const service = makeService(prisma, createFn);

    const csv =
      HEADER +
      makeRow({ title: 'Issue 1' }) +
      makeRow({ title: 'Issue 2' }) +
      makeRow({ title: 'Issue 3' });

    const result = await service.importCsv(USER_ID, PROJECT_ID, csv);

    expect(result.created).toBe(3);
    expect(result.errors).toHaveLength(0);
    expect(createFn).toHaveBeenCalledTimes(3);
  });

  it('passes correct mapped fields to IssuesService.create', async () => {
    const { prisma } = buildMocks({
      members: [{ id: 'user-alice', email: 'alice@example.com' }],
    });
    const createFn = jest.fn().mockResolvedValue(makeIssueDto());
    const service = makeService(prisma, createFn);

    const csv =
      HEADER +
      makeRow({
        title: 'My Story',
        type: 'STORY',
        status: 'To Do',
        priority: 'HIGH',
        assignee: 'alice@example.com',
        storyPoints: '5',
        dueDate: '2026-12-31T00:00:00.000Z',
      });

    await service.importCsv(USER_ID, PROJECT_ID, csv);

    expect(createFn).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({
        title: 'My Story',
        type: IssueType.STORY,
        priority: Priority.HIGH,
        assigneeId: 'user-alice',
        storyPoints: 5,
        dueDate: '2026-12-31T00:00:00.000Z',
        statusId: 'status-todo',
        projectId: PROJECT_ID,
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Header mapping (case-insensitive)
// ─────────────────────────────────────────────────────────────────────────────

describe('IssuesImportService.importCsv — header mapping', () => {
  it('resolves columns with mixed-case headers', async () => {
    const { prisma } = buildMocks();
    const createFn = jest.fn().mockResolvedValue(makeIssueDto());
    const service = makeService(prisma, createFn);

    const csv =
      'Key,TITLE,type,STATUS,PRIORITY,Assignee,Reporter,Story Points,Sprint,Labels,Due Date,Created,Updated\r\n' +
      ',My Bug,bug,To Do,high,,,,,,,,\r\n';

    const result = await service.importCsv(USER_ID, PROJECT_ID, csv);

    expect(result.created).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(createFn).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({
        title: 'My Bug',
        type: IssueType.BUG,
        priority: Priority.HIGH,
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Quoted fields
// ─────────────────────────────────────────────────────────────────────────────

describe('IssuesImportService.importCsv — quoted fields', () => {
  it('handles a title with a comma inside quotes', async () => {
    const { prisma } = buildMocks();
    const createFn = jest.fn().mockResolvedValue(makeIssueDto());
    const service = makeService(prisma, createFn);

    const csv =
      HEADER + ',"Fix foo, bar, baz",TASK,To Do,MEDIUM,,,,,,,,\r\n';

    const result = await service.importCsv(USER_ID, PROJECT_ID, csv);

    expect(result.created).toBe(1);
    expect(createFn).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ title: 'Fix foo, bar, baz' }),
    );
  });

  it('handles a title with a LF newline inside quotes', async () => {
    const { prisma } = buildMocks();
    const createFn = jest.fn().mockResolvedValue(makeIssueDto());
    const service = makeService(prisma, createFn);

    const csv =
      HEADER + '"","Line one\nLine two",TASK,To Do,MEDIUM,,,,,,,,\r\n';

    const result = await service.importCsv(USER_ID, PROJECT_ID, csv);

    expect(result.created).toBe(1);
    expect(createFn).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ title: 'Line one\nLine two' }),
    );
  });

  it('handles doubled double-quotes inside a quoted field', async () => {
    const { prisma } = buildMocks();
    const createFn = jest.fn().mockResolvedValue(makeIssueDto());
    const service = makeService(prisma, createFn);

    const csv =
      HEADER + ',"She said ""hello""",TASK,To Do,MEDIUM,,,,,,,,\r\n';

    const result = await service.importCsv(USER_ID, PROJECT_ID, csv);

    expect(result.created).toBe(1);
    expect(createFn).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ title: 'She said "hello"' }),
    );
  });

  it('handles CRLF inside a quoted field', async () => {
    const { prisma } = buildMocks();
    const createFn = jest.fn().mockResolvedValue(makeIssueDto());
    const service = makeService(prisma, createFn);

    const csv =
      HEADER + '"","Line one\r\nLine two",TASK,To Do,MEDIUM,,,,,,,,\r\n';

    const result = await service.importCsv(USER_ID, PROJECT_ID, csv);

    expect(result.created).toBe(1);
    expect(createFn).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ title: 'Line one\r\nLine two' }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Unknown assignee
// ─────────────────────────────────────────────────────────────────────────────

describe('IssuesImportService.importCsv — unknown assignee', () => {
  it('records a row error for unknown assignee; does not abort other rows', async () => {
    const { prisma } = buildMocks({ members: [] }); // no members
    const createFn = jest.fn().mockResolvedValue(makeIssueDto());
    const service = makeService(prisma, createFn);

    const csv =
      HEADER +
      makeRow({ title: 'Bad assignee row', assignee: 'unknown@example.com' }) +
      makeRow({ title: 'Good row' });

    const result = await service.importCsv(USER_ID, PROJECT_ID, csv);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].row).toBe(1);
    expect(result.errors[0].message).toMatch(/unknown@example\.com/);
    expect(result.created).toBe(1); // the second row still imported
    expect(createFn).toHaveBeenCalledTimes(1);
  });

  it('resolves an email address directly from the Assignee cell', async () => {
    const { prisma } = buildMocks({
      members: [{ id: 'u-1', email: 'bob@example.com' }],
    });
    const createFn = jest.fn().mockResolvedValue(makeIssueDto());
    const service = makeService(prisma, createFn);

    const csv = HEADER + makeRow({ title: 'Assigned issue', assignee: 'bob@example.com' });
    const result = await service.importCsv(USER_ID, PROJECT_ID, csv);

    expect(result.created).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(createFn).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ assigneeId: 'u-1' }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Missing title
// ─────────────────────────────────────────────────────────────────────────────

describe('IssuesImportService.importCsv — missing title', () => {
  it('records a row error when Title is empty', async () => {
    const { prisma } = buildMocks();
    const createFn = jest.fn();
    const service = makeService(prisma, createFn);

    const result = await service.importCsv(USER_ID, PROJECT_ID, HEADER + makeRow({ title: '' }));

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].row).toBe(1);
    expect(result.errors[0].message).toMatch(/title.*required/i);
    expect(createFn).not.toHaveBeenCalled();
  });

  it('records a row error when Title exceeds 300 characters', async () => {
    const { prisma } = buildMocks();
    const createFn = jest.fn();
    const service = makeService(prisma, createFn);

    const result = await service.importCsv(
      USER_ID,
      PROJECT_ID,
      HEADER + makeRow({ title: 'A'.repeat(301) }),
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toMatch(/300/);
    expect(createFn).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Bad enum values
// ─────────────────────────────────────────────────────────────────────────────

describe('IssuesImportService.importCsv — bad enum values', () => {
  it('records a row error for an unknown Type value', async () => {
    const { prisma } = buildMocks();
    const createFn = jest.fn();
    const service = makeService(prisma, createFn);

    const result = await service.importCsv(
      USER_ID,
      PROJECT_ID,
      HEADER + makeRow({ type: 'FEATURE' }),
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toMatch(/type/i);
    expect(result.errors[0].message).toMatch(/FEATURE/);
    expect(createFn).not.toHaveBeenCalled();
  });

  it('records a row error for an unknown Priority value', async () => {
    const { prisma } = buildMocks();
    const createFn = jest.fn();
    const service = makeService(prisma, createFn);

    const result = await service.importCsv(
      USER_ID,
      PROJECT_ID,
      HEADER + makeRow({ priority: 'CRITICAL' }),
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toMatch(/priority/i);
    expect(createFn).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. dryRun
// ─────────────────────────────────────────────────────────────────────────────

describe('IssuesImportService.importCsv — dryRun', () => {
  it('does not call IssuesService.create when dryRun=true', async () => {
    const { prisma } = buildMocks();
    const createFn = jest.fn();
    const service = makeService(prisma, createFn);

    const result = await service.importCsv(
      USER_ID,
      PROJECT_ID,
      HEADER + makeRow({ title: 'Would be issue' }),
      { dryRun: true },
    );

    expect(createFn).not.toHaveBeenCalled();
    expect(result.created).toBe(1); // would-be created count
    expect(result.dryRun).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('reports validation errors even in dryRun mode', async () => {
    const { prisma } = buildMocks();
    const createFn = jest.fn();
    const service = makeService(prisma, createFn);

    const csv =
      HEADER +
      makeRow({ title: '' }) +          // invalid: no title
      makeRow({ title: 'Valid issue' });

    const result = await service.importCsv(USER_ID, PROJECT_ID, csv, { dryRun: true });

    expect(result.errors).toHaveLength(1);
    expect(result.created).toBe(1); // one valid row
    expect(createFn).not.toHaveBeenCalled();
  });

  it('does not create labels when dryRun=true', async () => {
    const { prisma, labelCreate } = buildMocks({ labels: [] });
    const createFn = jest.fn();
    const service = makeService(prisma, createFn);

    await service.importCsv(
      USER_ID,
      PROJECT_ID,
      HEADER + makeRow({ title: 'Labelled', labels: 'new-label' }),
      { dryRun: true },
    );

    expect(labelCreate).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Row limit
// ─────────────────────────────────────────────────────────────────────────────

describe('IssuesImportService.importCsv — row limit', () => {
  it('throws 400 when row count exceeds IMPORT_MAX_ROWS', async () => {
    const { prisma } = buildMocks();
    const service = makeService(prisma);

    const rows = Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) =>
      makeRow({ title: `Issue ${i + 1}` }),
    );
    const csv = HEADER + rows.join('');

    await expect(
      service.importCsv(USER_ID, PROJECT_ID, csv),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not throw when row count exactly equals IMPORT_MAX_ROWS', async () => {
    const { prisma } = buildMocks();
    let counter = 0;
    const createFn = jest.fn().mockImplementation(async () =>
      makeIssueDto({ id: `i-${++counter}` }),
    );
    const service = makeService(prisma, createFn);

    const rows = Array.from({ length: IMPORT_MAX_ROWS }, (_, i) =>
      makeRow({ title: `Issue ${i + 1}` }),
    );
    const csv = HEADER + rows.join('');

    const result = await service.importCsv(USER_ID, PROJECT_ID, csv);
    expect(result.created).toBe(IMPORT_MAX_ROWS);
  }, 30000);
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Labels
// ─────────────────────────────────────────────────────────────────────────────

describe('IssuesImportService.importCsv — labels', () => {
  it('reuses existing labels (case-insensitive name match)', async () => {
    const { prisma, labelCreate, issueLabelUpsert } = buildMocks({
      labels: [{ id: 'label-bug', name: 'bug', color: '#f00', projectId: PROJECT_ID }],
    });
    const createFn = jest.fn().mockResolvedValue(makeIssueDto({ id: 'issue-1' }));
    const service = makeService(prisma, createFn);

    const result = await service.importCsv(
      USER_ID,
      PROJECT_ID,
      HEADER + makeRow({ title: 'Issue with label', labels: 'Bug' }), // "Bug" matches "bug"
    );

    expect(result.created).toBe(1);
    expect(labelCreate).not.toHaveBeenCalled(); // already exists
    expect(issueLabelUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ labelId: 'label-bug' }),
      }),
    );
  });

  it('auto-creates an unknown label and reuses it for subsequent rows', async () => {
    const { prisma, labelCreate } = buildMocks({ labels: [] });
    let counter = 0;
    const createFn = jest.fn().mockImplementation(async () =>
      makeIssueDto({ id: `issue-${++counter}` }),
    );
    const service = makeService(prisma, createFn);

    const csv =
      HEADER +
      makeRow({ title: 'Row 1', labels: 'new-tag' }) +
      makeRow({ title: 'Row 2', labels: 'new-tag' });

    const result = await service.importCsv(USER_ID, PROJECT_ID, csv);

    expect(result.created).toBe(2);
    expect(labelCreate).toHaveBeenCalledTimes(1); // created once, reused the second time
  });

  it('splits labels by semicolons', async () => {
    const { prisma, labelCreate } = buildMocks({ labels: [] });
    const createFn = jest.fn().mockResolvedValue(makeIssueDto({ id: 'issue-1' }));
    const service = makeService(prisma, createFn);

    const result = await service.importCsv(
      USER_ID,
      PROJECT_ID,
      HEADER + makeRow({ title: 'Multi-label', labels: 'bug; critical' }),
    );

    expect(result.created).toBe(1);
    expect(labelCreate).toHaveBeenCalledTimes(2); // "bug" and "critical" each created
  });

  it('splits labels by commas (in a quoted cell)', async () => {
    const { prisma, labelCreate } = buildMocks({ labels: [] });
    const createFn = jest.fn().mockResolvedValue(makeIssueDto({ id: 'issue-1' }));
    const service = makeService(prisma, createFn);

    // Labels with commas must be quoted in the CSV (standard RFC-4180).
    // The cell value is "alpha,beta" — csv-parse will strip the quotes.
    // Column order: Key,Title,Type,Status,Priority,Assignee,Reporter,Story Points,Sprint,Labels,Due Date,Created,Updated
    const csv =
      HEADER +
      ',Multi-label,TASK,To Do,MEDIUM,,,,,"alpha,beta",,,\r\n';

    const result = await service.importCsv(USER_ID, PROJECT_ID, csv);

    expect(result.created).toBe(1);
    expect(labelCreate).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Tenant isolation / role gating
// ─────────────────────────────────────────────────────────────────────────────

describe('IssuesImportService.importCsv — authorization', () => {
  it('throws ForbiddenException when the user is not a project member', async () => {
    const { prisma } = buildMocks({ isMember: false });
    const service = makeService(prisma);

    await expect(
      service.importCsv('stranger', PROJECT_ID, HEADER + makeRow()),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a MEMBER to import', async () => {
    const { prisma } = buildMocks({ isMember: true });
    const service = makeService(prisma);

    await expect(
      service.importCsv(USER_ID, PROJECT_ID, HEADER + makeRow()),
    ).resolves.toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Story points validation
// ─────────────────────────────────────────────────────────────────────────────

describe('IssuesImportService.importCsv — story points', () => {
  it('records a row error for a non-numeric story points value', async () => {
    const { prisma } = buildMocks();
    const createFn = jest.fn();
    const service = makeService(prisma, createFn);

    const result = await service.importCsv(
      USER_ID,
      PROJECT_ID,
      HEADER + makeRow({ storyPoints: 'lots' }),
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toMatch(/story points/i);
    expect(createFn).not.toHaveBeenCalled();
  });

  it('records a row error for story points > 999', async () => {
    const { prisma } = buildMocks();
    const createFn = jest.fn();
    const service = makeService(prisma, createFn);

    const result = await service.importCsv(
      USER_ID,
      PROJECT_ID,
      HEADER + makeRow({ storyPoints: '1000' }),
    );

    expect(result.errors).toHaveLength(1);
    expect(createFn).not.toHaveBeenCalled();
  });

  it('records a row error for negative story points', async () => {
    const { prisma } = buildMocks();
    const createFn = jest.fn();
    const service = makeService(prisma, createFn);

    const result = await service.importCsv(
      USER_ID,
      PROJECT_ID,
      HEADER + makeRow({ storyPoints: '-1' }),
    );

    expect(result.errors).toHaveLength(1);
    expect(createFn).not.toHaveBeenCalled();
  });

  it('passes valid story points (0–999) through to create', async () => {
    const { prisma } = buildMocks();
    const createFn = jest.fn().mockResolvedValue(makeIssueDto());
    const service = makeService(prisma, createFn);

    const result = await service.importCsv(
      USER_ID,
      PROJECT_ID,
      HEADER + makeRow({ storyPoints: '13' }),
    );

    expect(result.errors).toHaveLength(0);
    expect(createFn).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ storyPoints: 13 }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. Due date validation
// ─────────────────────────────────────────────────────────────────────────────

describe('IssuesImportService.importCsv — due date', () => {
  it('records a row error for an invalid due date string', async () => {
    const { prisma } = buildMocks();
    const createFn = jest.fn();
    const service = makeService(prisma, createFn);

    const result = await service.importCsv(
      USER_ID,
      PROJECT_ID,
      HEADER + makeRow({ dueDate: 'not-a-date' }),
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toMatch(/due date/i);
    expect(createFn).not.toHaveBeenCalled();
  });

  it('accepts a valid ISO 8601 due date and passes it through', async () => {
    const { prisma } = buildMocks();
    const createFn = jest.fn().mockResolvedValue(makeIssueDto());
    const service = makeService(prisma, createFn);

    const result = await service.importCsv(
      USER_ID,
      PROJECT_ID,
      HEADER + makeRow({ dueDate: '2026-09-30T00:00:00.000Z' }),
    );

    expect(result.errors).toHaveLength(0);
    expect(createFn).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ dueDate: '2026-09-30T00:00:00.000Z' }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12b. Start date validation
// ─────────────────────────────────────────────────────────────────────────────

// Mirrors the production export column order: Key,Title,Type,Status,Priority,
// Assignee,Reporter,Story Points,Sprint,Labels,Start Date,Due Date,Created,Updated
const HEADER_WITH_START_DATE =
  'Key,Title,Type,Status,Priority,Assignee,Reporter,Story Points,Sprint,Labels,Start Date,Due Date,Created,Updated\r\n';

function makeRowWithStartDate(overrides: {
  title?: string;
  startDate?: string;
  dueDate?: string;
} = {}): string {
  return (
    [
      '',                              // Key (ignored)
      overrides.title ?? 'Test issue',
      'TASK',
      'To Do',
      'MEDIUM',
      '',                              // Assignee
      '',                              // Reporter
      '',                              // Story Points
      '',                              // Sprint
      '',                              // Labels
      overrides.startDate ?? '',
      overrides.dueDate ?? '',
      '',                              // Created
      '',                              // Updated
    ].join(',') + '\r\n'
  );
}

describe('IssuesImportService.importCsv — start date', () => {
  it('records a row error for an invalid start date string', async () => {
    const { prisma } = buildMocks();
    const createFn = jest.fn();
    const service = makeService(prisma, createFn);

    const result = await service.importCsv(
      USER_ID,
      PROJECT_ID,
      HEADER_WITH_START_DATE + makeRowWithStartDate({ startDate: 'not-a-date' }),
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toMatch(/start date/i);
    expect(createFn).not.toHaveBeenCalled();
  });

  it('accepts a valid ISO 8601 start date and passes it through beside due date', async () => {
    const { prisma } = buildMocks();
    const createFn = jest.fn().mockResolvedValue(makeIssueDto());
    const service = makeService(prisma, createFn);

    const result = await service.importCsv(
      USER_ID,
      PROJECT_ID,
      HEADER_WITH_START_DATE +
        makeRowWithStartDate({
          startDate: '2026-09-01T00:00:00.000Z',
          dueDate: '2026-09-30T00:00:00.000Z',
        }),
    );

    expect(result.errors).toHaveLength(0);
    expect(createFn).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({
        startDate: '2026-09-01T00:00:00.000Z',
        dueDate: '2026-09-30T00:00:00.000Z',
      }),
    );
  });

  it('surfaces the service-layer startDate > dueDate rejection as a row error', async () => {
    const { prisma } = buildMocks();
    const createFn = jest
      .fn()
      .mockRejectedValue(new BadRequestException('startDate must be on or before dueDate'));
    const service = makeService(prisma, createFn);

    const result = await service.importCsv(
      USER_ID,
      PROJECT_ID,
      HEADER_WITH_START_DATE +
        makeRowWithStartDate({
          startDate: '2026-10-01T00:00:00.000Z',
          dueDate: '2026-09-01T00:00:00.000Z',
        }),
    );

    expect(result.created).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toMatch(/startDate must be on or before dueDate/);
  });

  it('omits startDate when the column is absent (backward-compatible with pre-existing exports)', async () => {
    const { prisma } = buildMocks();
    const createFn = jest.fn().mockResolvedValue(makeIssueDto());
    const service = makeService(prisma, createFn);

    // Legacy header (no Start Date column) — still valid.
    const result = await service.importCsv(
      USER_ID,
      PROJECT_ID,
      HEADER + makeRow({ dueDate: '2026-09-30T00:00:00.000Z' }),
    );

    expect(result.errors).toHaveLength(0);
    expect(createFn).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ startDate: undefined, dueDate: '2026-09-30T00:00:00.000Z' }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. Empty / header-only CSV
// ─────────────────────────────────────────────────────────────────────────────

describe('IssuesImportService.importCsv — empty / header-only', () => {
  it('returns 0 created for a header-only CSV (no data rows)', async () => {
    const { prisma } = buildMocks();
    const createFn = jest.fn();
    const service = makeService(prisma, createFn);

    const result = await service.importCsv(USER_ID, PROJECT_ID, HEADER);

    expect(result.created).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(createFn).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. Status name resolution
// ─────────────────────────────────────────────────────────────────────────────

describe('IssuesImportService.importCsv — status resolution', () => {
  it('resolves a status name to its id (case-insensitive)', async () => {
    const { prisma } = buildMocks({ statuses: [TODO_STATUS, IN_PROGRESS_STATUS] });
    const createFn = jest.fn().mockResolvedValue(makeIssueDto());
    const service = makeService(prisma, createFn);

    const result = await service.importCsv(
      USER_ID,
      PROJECT_ID,
      HEADER + makeRow({ title: 'In-progress issue', status: 'in progress' }),
    );

    expect(result.errors).toHaveLength(0);
    expect(createFn).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ statusId: 'status-inprogress' }),
    );
  });

  it('uses the default TODO-category status when Status column is empty', async () => {
    const { prisma } = buildMocks({ statuses: [TODO_STATUS, IN_PROGRESS_STATUS] });
    const createFn = jest.fn().mockResolvedValue(makeIssueDto());
    const service = makeService(prisma, createFn);

    // Status cell is blank
    const csv =
      HEADER +
      ',No-status issue,TASK,,MEDIUM,,,,,,,,\r\n';

    const result = await service.importCsv(USER_ID, PROJECT_ID, csv);

    expect(result.errors).toHaveLength(0);
    expect(createFn).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ statusId: TODO_STATUS.id }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. Unknown status
// ─────────────────────────────────────────────────────────────────────────────

describe('IssuesImportService.importCsv — unknown status', () => {
  it('records a row error for a status name not in the project', async () => {
    const { prisma } = buildMocks({ statuses: [TODO_STATUS] });
    const createFn = jest.fn();
    const service = makeService(prisma, createFn);

    const result = await service.importCsv(
      USER_ID,
      PROJECT_ID,
      HEADER + makeRow({ status: 'Nonexistent Status' }),
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toMatch(/status/i);
    expect(createFn).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bonus: formula-injection guard stripping on import
// ─────────────────────────────────────────────────────────────────────────────

describe('IssuesImportService.importCsv — formula-injection guard stripping', () => {
  it('strips the apostrophe export prefix from a formula-guarded cell', async () => {
    const { prisma } = buildMocks();
    const createFn = jest.fn().mockResolvedValue(makeIssueDto());
    const service = makeService(prisma, createFn);

    // The export would produce "'=SUM(A1)" for a cell starting with "="
    const csv =
      HEADER + ",'=SUM(A1),TASK,To Do,MEDIUM,,,,,,,,\r\n";

    const result = await service.importCsv(USER_ID, PROJECT_ID, csv);

    expect(result.created).toBe(1);
    expect(createFn).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ title: '=SUM(A1)' }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Round-trip fidelity: the columns the exporter writes must either be applied
// or named. Founder report: a project exported from one instance and imported
// into another arrived with its parents, components, versions, estimates and
// custom fields missing, and the import reported plain success.
// The end-to-end proof lives in `csv-roundtrip.integration.spec.ts`; these pin
// the mapping decisions without needing a database.
// ─────────────────────────────────────────────────────────────────────────────

/** The full export header, as `IssuesService.exportCsv` writes it. */
const EXPORT_HEADER =
  'Key,Title,Type,Status,Priority,Assignee,Reporter,Story Points,Sprint,Labels,' +
  'Start Date,Due Date,Description,Component,Fix Versions,Parent,' +
  'Original Estimate (minutes),CF: Severity,Created,Updated\r\n';

/** One row in that shape. Order matters — it mirrors the exporter exactly. */
function exportRow(o: {
  key?: string;
  title: string;
  type?: string;
  component?: string;
  fixVersions?: string;
  parent?: string;
  estimate?: string;
  severity?: string;
}): string {
  return (
    [
      o.key ?? '',
      o.title,
      o.type ?? 'TASK',
      'To Do',
      'MEDIUM',
      '', // Assignee
      'Someone Else', // Reporter
      '', // Story Points
      'Sprint 7', // Sprint
      '', // Labels
      '', // Start Date
      '', // Due Date
      '', // Description
      o.component ?? '',
      o.fixVersions ?? '',
      o.parent ?? '',
      o.estimate ?? '',
      o.severity ?? '',
      '2026-01-01T00:00:00.000Z', // Created
      '2026-01-02T00:00:00.000Z', // Updated
    ].join(',') + '\r\n'
  );
}

describe('IssuesImportService.importCsv — export round trip', () => {
  it('names every column it does not apply, with a reason for each', async () => {
    const { prisma } = buildMocks();
    const service = makeService(prisma);

    const result = await service.importCsv(
      USER_ID,
      PROJECT_ID,
      EXPORT_HEADER + exportRow({ title: 'Anything' }),
    );

    const named = result.unimportedColumns.map((c) => c.column);
    expect(named).toEqual(
      expect.arrayContaining(['Key', 'Reporter', 'Sprint', 'Created', 'Updated']),
    );
    for (const entry of result.unimportedColumns) {
      expect(entry.reason).toBeTruthy();
    }
  });

  it('does not list the columns it now applies', async () => {
    const { prisma } = buildMocks({
      customFieldDefs: [
        { id: 'cf-1', name: 'Severity', type: 'TEXT', projectId: PROJECT_ID },
      ],
    });
    const service = makeService(prisma);

    const result = await service.importCsv(
      USER_ID,
      PROJECT_ID,
      EXPORT_HEADER + exportRow({ title: 'Anything' }),
    );

    const named = result.unimportedColumns.map((c) => c.column);
    for (const applied of [
      'Parent',
      'Component',
      'Fix Versions',
      'Original Estimate (minutes)',
      'CF: Severity',
    ]) {
      expect(named).not.toContain(applied);
    }
  });

  it('reports a CF: column with no matching definition instead of dropping it', async () => {
    const { prisma } = buildMocks({ customFieldDefs: [] });
    const service = makeService(prisma);

    const result = await service.importCsv(
      USER_ID,
      PROJECT_ID,
      EXPORT_HEADER + exportRow({ title: 'Anything', severity: 'High' }),
    );

    const severity = result.unimportedColumns.find(
      (c) => c.column === 'CF: Severity',
    );
    expect(severity).toBeDefined();
    expect(severity!.reason).toContain('no custom field of that name');
  });

  it('creates a component that does not exist yet and assigns it', async () => {
    const { prisma, componentCreate } = buildMocks();
    const createFn = jest.fn().mockResolvedValue(makeIssueDto());
    const service = makeService(prisma, createFn);

    await service.importCsv(
      USER_ID,
      PROJECT_ID,
      EXPORT_HEADER + exportRow({ title: 'Anything', component: 'Billing' }),
    );

    expect(componentCreate).toHaveBeenCalledWith({
      data: { projectId: PROJECT_ID, name: 'Billing' },
    });
    expect(createFn.mock.calls[0][1]).toMatchObject({
      componentId: 'component-Billing',
    });
  });

  it('matches an existing component by name rather than creating a duplicate', async () => {
    const { prisma, componentCreate } = buildMocks({
      components: [{ id: 'comp-existing', name: 'Billing', projectId: PROJECT_ID }],
    });
    const createFn = jest.fn().mockResolvedValue(makeIssueDto());
    const service = makeService(prisma, createFn);

    await service.importCsv(
      USER_ID,
      PROJECT_ID,
      EXPORT_HEADER + exportRow({ title: 'Anything', component: 'billing' }),
    );

    expect(componentCreate).not.toHaveBeenCalled();
    expect(createFn.mock.calls[0][1]).toMatchObject({ componentId: 'comp-existing' });
  });

  it('attaches every fix version in the cell', async () => {
    const { prisma, issueVersionUpsert } = buildMocks();
    const service = makeService(prisma);

    await service.importCsv(
      USER_ID,
      PROJECT_ID,
      EXPORT_HEADER +
        exportRow({ title: 'Anything', fixVersions: '2.1.0; 2.2.0' }),
    );

    expect(issueVersionUpsert).toHaveBeenCalledTimes(2);
  });

  it('carries the original estimate through to create', async () => {
    const { prisma } = buildMocks();
    const createFn = jest.fn().mockResolvedValue(makeIssueDto());
    const service = makeService(prisma, createFn);

    await service.importCsv(
      USER_ID,
      PROJECT_ID,
      EXPORT_HEADER + exportRow({ title: 'Anything', estimate: '240' }),
    );

    expect(createFn.mock.calls[0][1]).toMatchObject({
      originalEstimateMinutes: 240,
    });
  });

  it('coerces a custom-field cell to the definition’s type', async () => {
    const { prisma } = buildMocks({
      customFieldDefs: [
        { id: 'cf-1', name: 'Severity', type: 'NUMBER', projectId: PROJECT_ID },
      ],
    });
    const createFn = jest.fn().mockResolvedValue(makeIssueDto());
    const service = makeService(prisma, createFn);

    await service.importCsv(
      USER_ID,
      PROJECT_ID,
      EXPORT_HEADER + exportRow({ title: 'Anything', severity: '3' }),
    );

    // A string "3" would be rejected by validateAndNormalize — the number must
    // arrive as a number.
    expect(createFn.mock.calls[0][1]).toMatchObject({
      customFields: { 'cf-1': 3 },
    });
  });

  it('warns about an uncoercible custom-field cell instead of failing the row', async () => {
    const { prisma } = buildMocks({
      customFieldDefs: [
        { id: 'cf-1', name: 'Severity', type: 'NUMBER', projectId: PROJECT_ID },
      ],
    });
    const service = makeService(prisma);

    const result = await service.importCsv(
      USER_ID,
      PROJECT_ID,
      EXPORT_HEADER + exportRow({ title: 'Anything', severity: 'very bad' }),
    );

    expect(result.created).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings[0].message).toContain('Severity');
  });

  it('links a child to a parent that appears LATER in the file', async () => {
    const { prisma } = buildMocks();
    let n = 0;
    const createFn = jest
      .fn()
      .mockImplementation(async () => makeIssueDto({ id: `issue-${++n}` }));
    const updateFn = jest.fn().mockResolvedValue(makeIssueDto());
    const service = makeService(prisma, createFn, updateFn);

    // Child first, epic second — a two-pass link is the only thing that works.
    const csv =
      EXPORT_HEADER +
      exportRow({ key: 'NL-2', title: 'Child', parent: 'NL-1' }) +
      exportRow({ key: 'NL-1', title: 'Epic', type: 'EPIC' });

    const result = await service.importCsv(USER_ID, PROJECT_ID, csv);

    expect(result.warnings).toHaveLength(0);
    expect(updateFn).toHaveBeenCalledWith(USER_ID, 'issue-1', {
      parentId: 'issue-2',
    });
  });

  it('warns when the parent key is not a row in the file', async () => {
    const { prisma } = buildMocks();
    const createFn = jest.fn().mockResolvedValue(makeIssueDto({ id: 'issue-1' }));
    const updateFn = jest.fn();
    const service = makeService(prisma, createFn, updateFn);

    const result = await service.importCsv(
      USER_ID,
      PROJECT_ID,
      EXPORT_HEADER + exportRow({ key: 'NL-2', title: 'Orphan', parent: 'NL-99' }),
    );

    expect(result.created).toBe(1);
    expect(updateFn).not.toHaveBeenCalled();
    expect(result.warnings[0].message).toContain('NL-99');
  });

  it('reports unimported columns on a dry run too, before anything is written', async () => {
    const { prisma } = buildMocks();
    const service = makeService(prisma);

    const result = await service.importCsv(
      USER_ID,
      PROJECT_ID,
      EXPORT_HEADER + exportRow({ title: 'Anything' }),
      { dryRun: true },
    );

    expect(result.dryRun).toBe(true);
    expect(result.unimportedColumns.length).toBeGreaterThan(0);
  });
});
