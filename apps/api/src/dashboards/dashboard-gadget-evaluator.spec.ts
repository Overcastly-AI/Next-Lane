import {
  CustomFieldType,
  IssueType,
  Priority,
  StatusCategory,
  type IssueDto,
  type StatusDto,
  type UserDto,
} from '@next-lane/shared';
import {
  BREAKDOWN_BUCKET_CAP,
  TABLE_GADGET_ROW_CAP,
  evaluateBreakdown,
  evaluateStat,
  evaluateTable,
  resolveBurndownSprintId,
} from './dashboard-gadget-evaluator';

function makeUser(id: string, name: string): UserDto {
  return {
    id,
    name,
    email: `${id}@example.com`,
    avatarColor: '#4f46e5',
    createdAt: '2026-01-01T00:00:00.000Z',
    emailNotifications: true,
  };
}

function makeStatus(id: string, name: string, category: StatusCategory = StatusCategory.TODO): StatusDto {
  return { id, name, category, order: 0, projectId: 'proj-1', wipLimit: null };
}

function makeIssue(overrides: Partial<IssueDto> & { id: string }): IssueDto {
  const base: IssueDto = {
    id: overrides.id,
    key: `NL-${overrides.id}`,
    number: 1,
    projectId: 'proj-1',
    type: IssueType.TASK,
    title: `Issue ${overrides.id}`,
    description: null,
    statusId: 'status-1',
    assigneeId: null,
    reporterId: null,
    priority: Priority.MEDIUM,
    storyPoints: null,
    parentId: null,
    sprintId: null,
    startDate: null,
    dueDate: null,
    rank: 'a1',
    componentId: null,
    originalEstimateMinutes: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  return { ...base, ...overrides };
}

describe('evaluateStat', () => {
  it('returns the count of issues', () => {
    const issues = [makeIssue({ id: '1' }), makeIssue({ id: '2' })];
    expect(evaluateStat(issues)).toEqual({ kind: 'STAT', count: 2 });
  });

  it('returns 0 for an empty issue set', () => {
    expect(evaluateStat([])).toEqual({ kind: 'STAT', count: 0 });
  });
});

describe('evaluateTable', () => {
  it('defaults to all columns and TABLE_GADGET_DEFAULT_LIMIT rows', () => {
    const issues = Array.from({ length: 15 }, (_, i) =>
      makeIssue({ id: String(i), title: `Row ${i}` }),
    );
    const result = evaluateTable(issues, {});
    expect(result.columns).toEqual(['key', 'title', 'status', 'assignee', 'points']);
    expect(result.rows).toHaveLength(10);
    expect(result.truncated).toBe(true);
  });

  it('respects config.limit up to TABLE_GADGET_ROW_CAP', () => {
    const issues = Array.from({ length: TABLE_GADGET_ROW_CAP + 10 }, (_, i) =>
      makeIssue({ id: String(i) }),
    );
    const result = evaluateTable(issues, { limit: 200 });
    expect(result.rows).toHaveLength(TABLE_GADGET_ROW_CAP);
    expect(result.truncated).toBe(true);
  });

  it('filters to only requested valid columns', () => {
    const issues = [makeIssue({ id: '1' })];
    const result = evaluateTable(issues, { columns: ['key', 'bogus', 'points'] });
    expect(result.columns).toEqual(['key', 'points']);
  });

  it('maps assignee name and story points onto each row', () => {
    const issues = [
      makeIssue({
        id: '1',
        assignee: makeUser('u1', 'Ada'),
        storyPoints: 5,
        status: makeStatus('s1', 'In Progress', StatusCategory.IN_PROGRESS),
      }),
    ];
    const result = evaluateTable(issues, {});
    expect(result.rows[0]).toMatchObject({
      key: 'NL-1',
      assignee: 'Ada',
      points: 5,
      status: 'In Progress',
    });
  });

  it('is not truncated when issues fit within the limit', () => {
    const issues = [makeIssue({ id: '1' }), makeIssue({ id: '2' })];
    const result = evaluateTable(issues, { limit: 10 });
    expect(result.truncated).toBe(false);
  });
});

describe('evaluateBreakdown', () => {
  it('errors when config.field is missing', () => {
    const result = evaluateBreakdown([], {}, []);
    expect(result.data).toBeUndefined();
    expect(result.error).toMatch(/need a field/i);
  });

  it('groups by status, defaulting missing status to Unknown', () => {
    const issues = [
      makeIssue({ id: '1', status: makeStatus('s1', 'To Do') }),
      makeIssue({ id: '2', status: makeStatus('s1', 'To Do') }),
      makeIssue({ id: '3' }),
    ];
    const result = evaluateBreakdown(issues, { field: 'status' }, []);
    expect(result.data?.buckets).toEqual(
      expect.arrayContaining([
        { key: 'To Do', count: 2 },
        { key: 'Unknown', count: 1 },
      ]),
    );
  });

  it('groups by priority (case-insensitive field name)', () => {
    const issues = [
      makeIssue({ id: '1', priority: Priority.HIGH }),
      makeIssue({ id: '2', priority: Priority.HIGH }),
      makeIssue({ id: '3', priority: Priority.LOW }),
    ];
    const result = evaluateBreakdown(issues, { field: 'PRIORITY' }, []);
    expect(result.data?.buckets).toEqual([
      { key: 'HIGH', count: 2 },
      { key: 'LOW', count: 1 },
    ]);
  });

  it('counts an issue once per label, and once as "No label" when unlabeled', () => {
    const issues = [
      makeIssue({
        id: '1',
        labels: [
          { id: 'l1', name: 'bug', color: '#f00', projectId: 'proj-1' },
          { id: 'l2', name: 'urgent', color: '#f00', projectId: 'proj-1' },
        ],
      }),
      makeIssue({ id: '2', labels: [] }),
    ];
    const result = evaluateBreakdown(issues, { field: 'label' }, []);
    expect(result.data?.buckets).toEqual(
      expect.arrayContaining([
        { key: 'bug', count: 1 },
        { key: 'urgent', count: 1 },
        { key: 'No label', count: 1 },
      ]),
    );
  });

  it('groups by a custom SELECT field, matched by key', () => {
    const issues = [
      makeIssue({ id: '1', customFields: { cf1: 'Critical' } }),
      makeIssue({ id: '2', customFields: { cf1: 'Critical' } }),
      makeIssue({ id: '3', customFields: {} }),
    ];
    const result = evaluateBreakdown(
      issues,
      { field: 'severity' },
      [{ id: 'cf1', key: 'severity', name: 'Severity', type: CustomFieldType.SELECT }],
    );
    expect(result.data?.buckets).toEqual(
      expect.arrayContaining([
        { key: 'Critical', count: 2 },
        { key: 'Unset', count: 1 },
      ]),
    );
  });

  it('errors on an unknown field', () => {
    const result = evaluateBreakdown([makeIssue({ id: '1' })], { field: 'bogus' }, []);
    expect(result.data).toBeUndefined();
    expect(result.error).toMatch(/unknown breakdown field/i);
  });

  it('errors when the custom field is not SELECT/MULTI_SELECT', () => {
    const result = evaluateBreakdown(
      [makeIssue({ id: '1' })],
      { field: 'notes' },
      [{ id: 'cf1', key: 'notes', name: 'Notes', type: CustomFieldType.TEXT }],
    );
    expect(result.error).toMatch(/unknown breakdown field/i);
  });

  it('caps the number of buckets returned', () => {
    const issues = Array.from({ length: BREAKDOWN_BUCKET_CAP + 10 }, (_, i) =>
      makeIssue({ id: String(i), priority: Priority.MEDIUM, assignee: makeUser(`u${i}`, `User ${i}`) }),
    );
    const result = evaluateBreakdown(issues, { field: 'assignee' }, []);
    expect(result.data?.buckets.length).toBeLessThanOrEqual(BREAKDOWN_BUCKET_CAP);
  });
});

describe('resolveBurndownSprintId', () => {
  it('errors when no issue belongs to a sprint', () => {
    const result = resolveBurndownSprintId([makeIssue({ id: '1', sprintId: null })]);
    expect(result.sprintId).toBeUndefined();
    expect(result.error).toMatch(/no issues matched/i);
  });

  it('errors when issues span multiple sprints', () => {
    const issues = [
      makeIssue({ id: '1', sprintId: 'sprint-a' }),
      makeIssue({ id: '2', sprintId: 'sprint-b' }),
    ];
    const result = resolveBurndownSprintId(issues);
    expect(result.sprintId).toBeUndefined();
    expect(result.error).toMatch(/multiple sprints/i);
  });

  it('resolves the single sprint when all issues share one', () => {
    const issues = [
      makeIssue({ id: '1', sprintId: 'sprint-a' }),
      makeIssue({ id: '2', sprintId: 'sprint-a' }),
    ];
    const result = resolveBurndownSprintId(issues);
    expect(result.sprintId).toBe('sprint-a');
    expect(result.error).toBeUndefined();
  });
});
