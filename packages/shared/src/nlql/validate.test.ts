import { describe, expect, it } from 'vitest';
import { CustomFieldType } from '../enums';
import { filterIssues, type NlqlComponent, type NlqlSprint, type NlqlUser } from './evaluator';
import {
  NLQL_MAX_LENGTH,
  getReferencedFieldKinds,
  getReferencedStandardFields,
  queryReferencesMe,
  resolveQueryNames,
  validateQuery,
  type NlqlLabelRef,
  type NlqlStatusRef,
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

  it('reports "component" (not "id") for component/componentId references', () => {
    expect(getReferencedFieldKinds('component = "API"')).toEqual(new Set(['component']));
    expect(getReferencedFieldKinds('componentId = "c1"')).toEqual(new Set(['component']));
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

  it('never flags a cuid/UUID-shaped operand, even when unresolved (may be a legitimate stale id)', () => {
    const staleCuid = 'cljk3n9d80000ab12rem0ved'; // realistic Prisma cuid() shape
    expect(resolveQueryNames(`assignee = "${staleCuid}"`, { users: [ALICE] })).toEqual({
      ok: true,
    });
    const staleUuid = '6f1e0a4c-9b2d-4e3f-8a51-0c9d7e6b5a41';
    expect(resolveQueryNames(`assignee = "${staleUuid}"`, { users: [ALICE] })).toEqual({
      ok: true,
    });
  });

  it('DOES flag a long single-token unresolved name that is not cuid/UUID-shaped (review follow-up on 169f7c1)', () => {
    // ≥20 chars, no whitespace — the original "length ≥ 20, no whitespace"
    // heuristic silently passed this, resurrecting the zero-results bug for
    // long handles/hyphenated names.
    const result = resolveQueryNames('assignee = "workflow-migration-bot-2024"', {
      users: [ALICE],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('unknown user "workflow-migration-bot-2024"');
    }
  });

  it('resolves a long id-SHAPED display name when it exists (name resolution runs before id-shape leniency)', () => {
    const bot = { id: 'u-bot', name: 'c0000000000000000000bot', email: 'bot@x.dev' };
    expect(resolveQueryNames(`assignee = "${bot.name}"`, { users: [bot] })).toEqual({
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

  it('ignores fields with no "does this exist" check at all (title/key/dates/numbers)', () => {
    expect(resolveQueryNames('title = "Anything at all"')).toEqual({ ok: true });
    expect(resolveQueryNames('key = "NL-999999"')).toEqual({ ok: true });
    expect(resolveQueryNames('storyPoints = 999')).toEqual({ ok: true });
    expect(resolveQueryNames('dueDate < "2099-01-01"')).toEqual({ ok: true });
  });

  it('a genuinely valid fixed-enum value (priority = HIGH) is accepted with no context', () => {
    // Unlike status/label/component, type/priority/statusCategory need no
    // ctx at all — they are closed, global enums.
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

// MCP-QA pass 4 (token-efficiency pass), finding E1: the fail-loud guard
// above only ever reached assignee/reporter/sprint. `status`, `type`,
// `priority`, `label`/`labels`, and `component`/`componentId` returned a
// plausible, wrong `{items:[],total:0}` on a typo instead of an error —
// exactly the class of bug the guard exists to kill, just left unfinished.
describe('resolveQueryNames — status/type/priority/label/component (MCP-QA pass 4, finding E1)', () => {
  const STATUS_TODO: NlqlStatusRef = { id: 'status-cljk3n9d80000todo01', name: 'To Do' };
  const STATUS_IN_PROGRESS: NlqlStatusRef = {
    id: 'status-cljk3n9d80000inprog2',
    name: 'In Progress',
  };
  const LABEL_BACKEND: NlqlLabelRef = { id: 'label-cljk3n9d80000back01', name: 'backend' };
  const COMPONENT_API: NlqlComponent = { id: 'comp-cljk3n9d80000api001', name: 'API' };

  // ── status (dynamic, per-project, matched by name) ──────────────────────

  it('accepts a resolved status by name (case-insensitive) and by id', () => {
    const ctx = { statuses: [STATUS_TODO, STATUS_IN_PROGRESS] };
    expect(resolveQueryNames('status = "In Progress"', ctx)).toEqual({ ok: true });
    expect(resolveQueryNames('status = "in progress"', ctx)).toEqual({ ok: true });
    expect(resolveQueryNames(`status = "${STATUS_TODO.id}"`, ctx)).toEqual({ ok: true });
  });

  it('rejects a typo\'d status name with a 400-shaped, actionable message', () => {
    // The exact repro from the audit: "In Progres" (missing an "s").
    const r = resolveQueryNames('status = "In Progres"', { statuses: [STATUS_IN_PROGRESS] });
    expect(r.ok).toBe(false);
    expect(r.error?.message).toBe(
      'unknown status "In Progres" — use an exact status name; see list_statuses',
    );
  });

  it('rejects a status that genuinely does not exist in this project', () => {
    const r = resolveQueryNames('status = "Blocked"', { statuses: [STATUS_TODO] });
    expect(r.ok).toBe(false);
    expect(r.error?.message).toMatch(/unknown status "Blocked"/);
  });

  it('rejects a status name when ctx.statuses is empty/absent (was the silent-zero bug)', () => {
    expect(resolveQueryNames('status = "In Progress"').ok).toBe(false);
    expect(resolveQueryNames('status = "In Progress"', { statuses: [] }).ok).toBe(false);
  });

  it('does NOT grant id-shape leniency for an unresolved status (name-only field — see family 2)', () => {
    // A cuid-shaped literal that is not one of this project's real status ids
    // would never match at evaluation time either (status compares by NAME),
    // so it must still be flagged — unlike assignee/sprint/component.
    const staleShapedId = 'cljk3n9d80000ab12notreal';
    const r = resolveQueryNames(`status = "${staleShapedId}"`, { statuses: [STATUS_TODO] });
    expect(r.ok).toBe(false);
  });

  // ── label / labels (dynamic, per-project, matched by name) ──────────────

  it('accepts a resolved label by name (case-insensitive) and by id, in = and IN', () => {
    const ctx = { labels: [LABEL_BACKEND] };
    expect(resolveQueryNames('label = "backend"', ctx)).toEqual({ ok: true });
    expect(resolveQueryNames('labels = "Backend"', ctx)).toEqual({ ok: true }); // case-insensitive
    expect(resolveQueryNames(`label = "${LABEL_BACKEND.id}"`, ctx)).toEqual({ ok: true });
    expect(resolveQueryNames('labels IN ("backend")', ctx)).toEqual({ ok: true });
  });

  it('rejects a typo\'d label name with a 400-shaped, actionable message', () => {
    // The exact repro from the audit: "backendd" (extra "d").
    const r = resolveQueryNames('label = "backendd"', { labels: [LABEL_BACKEND] });
    expect(r.ok).toBe(false);
    expect(r.error?.message).toBe(
      'unknown label "backendd" — use an exact label name; see list_labels',
    );
  });

  it('rejects a label name when ctx.labels is empty/absent', () => {
    expect(resolveQueryNames('label = "backend"').ok).toBe(false);
  });

  // ── component / componentId (dynamic, per-project, matched by name or id) ──

  it('accepts a resolved component by name (case-insensitive) and by id', () => {
    const ctx = { components: [COMPONENT_API] };
    expect(resolveQueryNames('component = "API"', ctx)).toEqual({ ok: true });
    expect(resolveQueryNames('component = "api"', ctx)).toEqual({ ok: true });
    expect(resolveQueryNames(`component = "${COMPONENT_API.id}"`, ctx)).toEqual({ ok: true });
  });

  it('rejects an unresolved component name with a 400-shaped, actionable message', () => {
    // The exact repro from the audit: "nope".
    const r = resolveQueryNames('component = "nope"', { components: [COMPONENT_API] });
    expect(r.ok).toBe(false);
    expect(r.error?.message).toBe(
      'unknown component "nope" — use an exact component name or an id; see list_components',
    );
  });

  it('grants id-shape leniency for component, matching assignee/sprint (component IS raw-id-compared)', () => {
    const staleCuid = 'cljk3n9d80000ab12removed';
    expect(
      resolveQueryNames(`component = "${staleCuid}"`, { components: [COMPONENT_API] }),
    ).toEqual({ ok: true });
  });

  // ── type (fixed, global enum) ────────────────────────────────────────────

  it('accepts every valid IssueType value, case-insensitively, with no context', () => {
    for (const t of ['TASK', 'BUG', 'STORY', 'EPIC', 'SUBTASK', 'bug']) {
      expect(resolveQueryNames(`type = ${t}`)).toEqual({ ok: true });
    }
  });

  it('rejects an invalid type with the valid list in the message', () => {
    // The exact repro from the audit: "TSK" (typo for TASK).
    const r = resolveQueryNames('type = TSK');
    expect(r.ok).toBe(false);
    expect(r.error?.message).toBe(
      'unknown type "TSK" — valid types: TASK, BUG, STORY, EPIC, SUBTASK',
    );
  });

  // ── priority (fixed, global enum) ────────────────────────────────────────

  it('accepts every valid Priority value, case-insensitively, with no context', () => {
    for (const p of ['LOWEST', 'LOW', 'MEDIUM', 'HIGH', 'HIGHEST', 'high']) {
      expect(resolveQueryNames(`priority = ${p}`)).toEqual({ ok: true });
    }
  });

  it('rejects an invalid priority (bareword that is NOT a real enum member) with the valid list', () => {
    // The exact repro from the audit: URGENT is not a priority this system
    // has — it must be rejected, not silently matched to zero.
    const r = resolveQueryNames('priority = URGENT');
    expect(r.ok).toBe(false);
    expect(r.error?.message).toBe(
      'unknown priority "URGENT" — valid priorities: LOWEST, LOW, MEDIUM, HIGH, HIGHEST',
    );
  });

  // ── statusCategory (fixed, global enum — same mechanism, proactively closed too) ──

  it('accepts every valid StatusCategory value, case-insensitively, with no context', () => {
    for (const c of ['TODO', 'IN_PROGRESS', 'DONE', 'todo']) {
      expect(resolveQueryNames(`statusCategory = ${c}`)).toEqual({ ok: true });
    }
  });

  it('rejects an invalid statusCategory with the valid list', () => {
    const r = resolveQueryNames('statusCategory = INPROGRESS'); // missing underscore
    expect(r.ok).toBe(false);
    expect(r.error?.message).toBe(
      'unknown statusCategory "INPROGRESS" — valid categories: TODO, IN_PROGRESS, DONE',
    );
  });

  // ── cross-cutting ────────────────────────────────────────────────────────

  it('checks every candidate in an IN list for a fixed enum, not just the first', () => {
    const r = resolveQueryNames('type IN (BUG, TSK)');
    expect(r.ok).toBe(false);
    expect(r.error?.message).toMatch(/unknown type "TSK"/);
  });

  it('is unaffected by IS EMPTY / IS NOT EMPTY on these fields (no operand to resolve)', () => {
    expect(resolveQueryNames('labels IS EMPTY')).toEqual({ ok: true });
    expect(resolveQueryNames('component IS NOT EMPTY')).toEqual({ ok: true });
  });

  it('combining a valid fixed-enum clause with an unresolved dynamic one still fails loud', () => {
    const r = resolveQueryNames('type = BUG AND status = "Blocked"', { statuses: [] });
    expect(r.ok).toBe(false);
    expect(r.error?.message).toMatch(/unknown status "Blocked"/);
  });
});

describe('getReferencedStandardFields', () => {
  it('distinguishes status from type/priority/statusCategory despite sharing the "enum" kind', () => {
    expect(getReferencedStandardFields('status = "Done"')).toEqual(new Set(['status']));
    expect(getReferencedStandardFields('type = BUG')).toEqual(new Set(['type']));
    expect(getReferencedStandardFields('priority = HIGH')).toEqual(new Set(['priority']));
    expect(getReferencedStandardFields('statusCategory = DONE')).toEqual(
      new Set(['statusCategory']),
    );
  });

  it('reports every distinct field across a compound query', () => {
    expect(
      getReferencedStandardFields('status = "Done" AND priority = HIGH AND type = BUG'),
    ).toEqual(new Set(['status', 'priority', 'type']));
  });

  it('includes ORDER BY fields', () => {
    expect(getReferencedStandardFields('type = BUG ORDER BY status')).toEqual(
      new Set(['type', 'status']),
    );
  });

  it('does not report fields for quoted (custom-field) tokens', () => {
    expect(getReferencedStandardFields('"Severity" = high')).toEqual(new Set());
  });

  it('returns an empty set on a parse error rather than throwing', () => {
    expect(getReferencedStandardFields('status =')).toEqual(new Set());
  });

  it('returns an empty set for an empty query', () => {
    expect(getReferencedStandardFields('')).toEqual(new Set());
  });
});

describe('queryReferencesMe', () => {
  it('detects a direct comparison', () => {
    expect(queryReferencesMe('assignee = me()')).toBe(true);
    expect(queryReferencesMe('reporter != me()')).toBe(true);
  });

  it('detects me() inside IN(...)', () => {
    expect(queryReferencesMe('assignee IN (me(), "Bob")')).toBe(true);
  });

  it('detects me() combined with AND/OR/NOT', () => {
    expect(queryReferencesMe('priority = HIGH AND assignee = me()')).toBe(true);
    expect(queryReferencesMe('assignee = me() OR reporter = "Bob"')).toBe(true);
    expect(queryReferencesMe('NOT assignee = me()')).toBe(true);
  });

  it('returns false when the query has no me() call', () => {
    expect(queryReferencesMe('assignee = "Bob"')).toBe(false);
    expect(queryReferencesMe('status = Done')).toBe(false);
    expect(queryReferencesMe('')).toBe(false);
  });

  it('does not false-positive on a string literal that merely contains the text "me()"', () => {
    expect(queryReferencesMe('"Assignee Text" = "me()"')).toBe(false);
  });

  it('ignores other zero-arg functions (now/today/startOfWeek/startOfDay)', () => {
    expect(queryReferencesMe('createdAt > today()')).toBe(false);
    expect(queryReferencesMe('createdAt > now()')).toBe(false);
  });

  it('returns false on a parse error (never throws)', () => {
    expect(queryReferencesMe('assignee =')).toBe(false);
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
