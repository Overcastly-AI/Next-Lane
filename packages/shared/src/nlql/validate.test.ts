import { describe, expect, it } from 'vitest';
import { CustomFieldType } from '../enums';
import { filterIssues, type NlqlSprint, type NlqlUser } from './evaluator';
import {
  NLQL_MAX_LENGTH,
  getReferencedFieldKinds,
  resolveQueryNames,
  validateQuery,
} from './validate';
import type { IssueDto } from '../types';
import { IssueType, Priority, StatusCategory } from '../enums';

const CUSTOM = [
  { id: 'cf1', key: 'severity', name: 'Severity', type: CustomFieldType.SELECT },
];

describe('validateQuery', () => {
  it('accepts a valid standard-field query', () => {
    expect(validateQuery('status = Done AND priority > LOW')).toEqual({ ok: true });
  });

  it('accepts an empty query', () => {
    expect(validateQuery('')).toEqual({ ok: true });
  });

  it('accepts a registered custom field by key and name', () => {
    expect(validateQuery('severity = high', { customFieldDefs: CUSTOM })).toEqual({
      ok: true,
    });
    expect(validateQuery('"Severity" = high', { customFieldDefs: CUSTOM })).toEqual({
      ok: true,
    });
  });

  it('rejects an unknown field with a position', () => {
    const r = validateQuery('bogus = 1');
    expect(r.ok).toBe(false);
    expect(r.error?.message).toMatch(/Unknown field 'bogus'/);
    expect(r.error?.position).toBe(0);
  });

  it('rejects an unregistered custom field', () => {
    const r = validateQuery('"Not Registered" = x');
    expect(r.ok).toBe(false);
    expect(r.error?.message).toMatch(/Unknown field/);
  });

  it('returns a structured error on a parse failure (does not throw)', () => {
    const r = validateQuery('status =');
    expect(r.ok).toBe(false);
    expect(r.error?.message).toMatch(/Expected a value/);
    expect(typeof r.error?.position).toBe('number');
  });

  it('enforces the length cap', () => {
    const long = 'status = ' + 'a'.repeat(NLQL_MAX_LENGTH);
    const r = validateQuery(long);
    expect(r.ok).toBe(false);
    expect(r.error?.message).toMatch(/too long/);
  });

  it('validates ORDER BY fields too', () => {
    expect(validateQuery('ORDER BY bogus').ok).toBe(false);
    expect(validateQuery('ORDER BY priority DESC').ok).toBe(true);
  });

  it('accepts startDate as a standard field (bare and via the "start" alias)', () => {
    expect(validateQuery('startDate < "2026-07-01"')).toEqual({ ok: true });
    expect(validateQuery('start > "2026-01-01"')).toEqual({ ok: true });
    expect(validateQuery('ORDER BY startDate DESC')).toEqual({ ok: true });
  });
});

describe('getReferencedFieldKinds', () => {
  it('reports "user" for assignee/reporter references', () => {
    expect(getReferencedFieldKinds('assignee = me()')).toEqual(new Set(['user']));
    expect(getReferencedFieldKinds('reporter = "Alex Rivera"')).toEqual(new Set(['user']));
    expect(getReferencedFieldKinds('assignee = me() AND reporter = me()')).toEqual(
      new Set(['user']),
    );
  });

  it('reports "sprint" for sprint references', () => {
    expect(getReferencedFieldKinds('sprint = "July-B"')).toEqual(new Set(['sprint']));
  });

  it('reports every distinct kind across a compound query', () => {
    const kinds = getReferencedFieldKinds(
      'assignee = me() AND sprint = "July-B" AND priority > LOW',
    );
    expect(kinds).toEqual(new Set(['user', 'sprint', 'enum']));
  });

  it('does not report kinds for quoted (custom-field) tokens', () => {
    expect(getReferencedFieldKinds('"Severity" = high')).toEqual(new Set());
  });

  it('includes ORDER BY field kinds', () => {
    expect(getReferencedFieldKinds('status = Done ORDER BY sprint')).toEqual(
      new Set(['enum', 'sprint']),
    );
  });

  it('returns an empty set on a parse error rather than throwing', () => {
    expect(getReferencedFieldKinds('status =')).toEqual(new Set());
  });

  it('returns an empty set for an empty query', () => {
    expect(getReferencedFieldKinds('')).toEqual(new Set());
  });
});

describe('resolveQueryNames (MCP-QA pass 1, finding 1 residual)', () => {
  const ALICE: NlqlUser = { id: 'usr-cljk3n9d80000ab12cxyz01', name: 'Alice', email: 'alice@x.io' };
  const BOB: NlqlUser = { id: 'usr-cljk3n9d80000ab12cxyz02', name: 'Bob', email: 'bob@x.io' };
  const SPRINT_JULY_B: NlqlSprint = {
    id: 'sprint-cljk3n9d80000ab12cxyz03',
    name: 'July-B',
  };

  it('accepts an empty query', () => {
    expect(resolveQueryNames('')).toEqual({ ok: true });
  });

  it('accepts a resolved user by name, email, and id', () => {
    const ctx = { users: [ALICE, BOB] };
    expect(resolveQueryNames('assignee = "Bob"', ctx)).toEqual({ ok: true });
    expect(resolveQueryNames('assignee = "bob@x.io"', ctx)).toEqual({ ok: true });
    expect(resolveQueryNames(`assignee = "${BOB.id}"`, ctx)).toEqual({ ok: true });
    expect(resolveQueryNames('reporter = "Alice"', ctx)).toEqual({ ok: true });
  });

  it('rejects an unresolved user name with a 400-shaped, actionable message', () => {
    const r = resolveQueryNames('assignee = "Alex Rivera"', { users: [ALICE, BOB] });
    expect(r.ok).toBe(false);
    expect(r.error?.message).toBe(
      'unknown user "Alex Rivera" — use an exact display name, an id, or me(); see list_users',
    );
    expect(typeof r.error?.position).toBe('number');
  });

  it('rejects an unresolved user name when ctx.users is empty/absent', () => {
    expect(resolveQueryNames('assignee = "Alex Rivera"').ok).toBe(false);
    expect(resolveQueryNames('assignee = "Alex Rivera"', { users: [] }).ok).toBe(false);
  });

  it('never flags me()', () => {
    expect(resolveQueryNames('assignee = me()', { users: [] })).toEqual({ ok: true });
    expect(resolveQueryNames('reporter = me()')).toEqual({ ok: true });
  });

  it('never flags an opaque-id-shaped operand, even when unresolved (may be a legitimate stale id)', () => {
    const staleId = 'usr-cljk3n9d80000ab12removedmember';
    expect(resolveQueryNames(`assignee = "${staleId}"`, { users: [ALICE] })).toEqual({
      ok: true,
    });
  });

  it('accepts a resolved sprint by name and id', () => {
    const ctx = { sprints: [SPRINT_JULY_B] };
    expect(resolveQueryNames('sprint = "July-B"', ctx)).toEqual({ ok: true });
    expect(resolveQueryNames('sprint = "july-b"', ctx)).toEqual({ ok: true }); // case-insensitive
    expect(resolveQueryNames(`sprint = "${SPRINT_JULY_B.id}"`, ctx)).toEqual({ ok: true });
  });

  it('rejects an unresolved sprint name with a 400-shaped, actionable message', () => {
    const r = resolveQueryNames('sprint = "Nonexistent Sprint"', { sprints: [SPRINT_JULY_B] });
    expect(r.ok).toBe(false);
    expect(r.error?.message).toBe(
      'unknown sprint "Nonexistent Sprint" — use an exact sprint name or an id; see list_sprints',
    );
  });

  it('rejects an unresolved sprint name when the project has zero sprints', () => {
    expect(resolveQueryNames('sprint = "July-B"', { sprints: [] }).ok).toBe(false);
  });

  it('checks every candidate in an IN list, not just the first', () => {
    const ctx = { users: [ALICE, BOB] };
    expect(resolveQueryNames('assignee IN ("Alice", "Bob")', ctx)).toEqual({ ok: true });
    const r = resolveQueryNames('assignee IN ("Alice", "Ghost Person")', ctx);
    expect(r.ok).toBe(false);
    expect(r.error?.message).toMatch(/unknown user "Ghost Person"/);
  });

  it('checks a NOT IN list the same as IN', () => {
    const r = resolveQueryNames('assignee NOT IN ("Ghost Person")', { users: [ALICE] });
    expect(r.ok).toBe(false);
  });

  it('is unaffected by IS EMPTY / IS NOT EMPTY (no operand to resolve)', () => {
    expect(resolveQueryNames('assignee IS EMPTY', { users: [] })).toEqual({ ok: true });
    expect(resolveQueryNames('sprint IS NOT EMPTY', { sprints: [] })).toEqual({ ok: true });
  });

  it('ignores fields other than user/sprint kind entirely', () => {
    expect(resolveQueryNames('status = "Nonexistent Status"')).toEqual({ ok: true });
    expect(resolveQueryNames('priority = HIGH')).toEqual({ ok: true });
  });

  it('ignores quoted (custom-field) tokens — never user/sprint kind', () => {
    expect(resolveQueryNames('"Assignee Text" = "Nonexistent Person"')).toEqual({ ok: true });
  });

  it('combines resolved and unresolved across AND/OR — the first unresolved reference wins', () => {
    const r = resolveQueryNames('priority = HIGH AND assignee = "Ghost"', { users: [] });
    expect(r.ok).toBe(false);
    expect(r.error?.message).toMatch(/unknown user "Ghost"/);
  });

  it('returns a structured error on a parse failure (does not throw)', () => {
    const r = resolveQueryNames('assignee =');
    expect(r.ok).toBe(false);
    expect(r.error?.message).toMatch(/Expected a value/);
  });
});

// ── Security ──────────────────────────────────────────────────────────────────

describe('security', () => {
  function makeIssue(overrides: Partial<IssueDto> = {}): IssueDto {
    return {
      id: 'i1',
      key: 'NL-1',
      number: 1,
      projectId: 'p1',
      type: IssueType.TASK,
      title: 'hi',
      description: null,
      statusId: 's1',
      status: { id: 's1', name: 'To Do', category: StatusCategory.TODO, order: 0, projectId: 'p1' },
      assigneeId: null,
      reporterId: null,
      priority: Priority.MEDIUM,
      storyPoints: null,
      parentId: null,
      sprintId: null,
      startDate: null,
      dueDate: null,
      rank: 'a0',
      labels: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    };
  }

  it('rejects __proto__ as a field', () => {
    const r = validateQuery('__proto__ = x');
    expect(r.ok).toBe(false);
    expect(r.error?.message).toMatch(/Unknown field/);
  });

  it('rejects constructor as a field', () => {
    expect(validateQuery('constructor = y').ok).toBe(false);
  });

  it('rejects prototype / toString / hasOwnProperty as fields', () => {
    expect(validateQuery('prototype = z').ok).toBe(false);
    expect(validateQuery('toString = z').ok).toBe(false);
    expect(validateQuery('hasOwnProperty = z').ok).toBe(false);
  });

  it('rejects quoted prototype-pollution field names', () => {
    expect(validateQuery('"__proto__" = x').ok).toBe(false);
    expect(validateQuery('"constructor" = x', { customFieldDefs: CUSTOM }).ok).toBe(false);
  });

  it('does not pollute Object.prototype when evaluating a hostile query', () => {
    // Even though validateQuery rejects it, prove no prototype write occurs if a
    // hostile name somehow reaches evaluation: filterIssues must throw, not write.
    const issue = makeIssue();
    expect(() => filterIssues([issue], '__proto__ = polluted', {})).toThrow();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('treats ~ regex-special characters literally (no ReDoS, no regex semantics)', () => {
    const issue = makeIssue({ title: 'plain text' });
    // A classic catastrophic-backtracking pattern would hang if compiled to a
    // RegExp; here it is just a literal substring that is not present.
    const evil = '(a+)+$';
    expect(filterIssues([issue], `title ~ "${evil}"`, {})).toEqual([]);

    // And a literal match works because '.' is NOT a wildcard.
    const dotted = makeIssue({ title: 'a.b.c' });
    expect(filterIssues([dotted], 'title ~ "a.b"', {})).toHaveLength(1);
    expect(filterIssues([makeIssue({ title: 'axbxc' })], 'title ~ "a.b"', {})).toHaveLength(0);
  });
});
