import { describe, expect, it } from 'vitest';
import { CustomFieldType, IssueType, Priority, StatusCategory } from '../enums';
import type { IssueDto } from '../types';
import { parse } from './parser';
import {
  evaluate,
  filterIssues,
  NlqlEvalError,
  type EvalContext,
  type NlqlCustomFieldDef,
  type NlqlSprint,
  type NlqlUser,
} from './evaluator';

const USER_ALICE: NlqlUser = { id: 'u-alice', name: 'Alice', email: 'alice@x.io' };
const USER_BOB: NlqlUser = { id: 'u-bob', name: 'Bob', email: 'bob@x.io' };
const SPRINT_ONE: NlqlSprint = { id: 'sp-1', name: 'Sprint 1 - Checkout Foundations' };
const SPRINT_JULY_B: NlqlSprint = { id: 'sp-2', name: 'July-B' };

function makeIssue(overrides: Partial<IssueDto> = {}): IssueDto {
  const base: IssueDto = {
    id: 'i1',
    key: 'NL-1',
    number: 1,
    projectId: 'p1',
    type: IssueType.TASK,
    title: 'Fix the login bug',
    description: 'A description with KEYWORD inside',
    statusId: 's-todo',
    status: { id: 's-todo', name: 'To Do', category: StatusCategory.TODO, order: 0, projectId: 'p1' },
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
    updatedAt: '2026-01-02T00:00:00.000Z',
  };
  return { ...base, ...overrides };
}

function evalQuery(query: string, issue: IssueDto, ctx: EvalContext = {}): boolean {
  return evaluate(parse(query), issue, ctx);
}

describe('evaluator — operators', () => {
  const issue = makeIssue({ storyPoints: 5, title: 'Fix the login bug' });

  it('= (string, case-insensitive)', () => {
    expect(evalQuery('title = "fix the LOGIN bug"', issue)).toBe(true);
    expect(evalQuery('title = "nope"', issue)).toBe(false);
  });

  it('!=', () => {
    expect(evalQuery('title != "nope"', issue)).toBe(true);
  });

  it('~ contains (substring)', () => {
    expect(evalQuery('title ~ login', issue)).toBe(true);
    expect(evalQuery('title ~ zzz', issue)).toBe(false);
  });

  it('!~ not-contains', () => {
    expect(evalQuery('title !~ zzz', issue)).toBe(true);
  });

  it('numeric > >= < <=', () => {
    expect(evalQuery('points > 3', issue)).toBe(true);
    expect(evalQuery('points >= 5', issue)).toBe(true);
    expect(evalQuery('points < 5', issue)).toBe(false);
    expect(evalQuery('points <= 5', issue)).toBe(true);
  });

  it('IN / NOT IN', () => {
    expect(evalQuery('type IN (BUG, TASK)', issue)).toBe(true);
    expect(evalQuery('type NOT IN (BUG, STORY)', issue)).toBe(true);
    expect(evalQuery('type IN (BUG, STORY)', issue)).toBe(false);
  });

  it('IS EMPTY / IS NOT EMPTY', () => {
    expect(evalQuery('assignee IS EMPTY', issue)).toBe(true);
    expect(evalQuery('assignee IS NOT EMPTY', issue)).toBe(false);
    const assigned = makeIssue({ assigneeId: 'u-bob' });
    expect(evalQuery('assignee IS NOT EMPTY', assigned)).toBe(true);
  });
});

describe('evaluator — field types', () => {
  it('enum (type/status/priority) compares case-insensitively', () => {
    const issue = makeIssue({ type: IssueType.BUG });
    expect(evalQuery('type = bug', issue)).toBe(true);
    expect(evalQuery('status = "to do"', issue)).toBe(true);
    expect(evalQuery('statusCategory = TODO', issue)).toBe(true);
  });

  it('priority ordering by rank', () => {
    const high = makeIssue({ priority: Priority.HIGH });
    expect(evalQuery('priority > MEDIUM', high)).toBe(true);
    expect(evalQuery('priority >= HIGH', high)).toBe(true);
    expect(evalQuery('priority < HIGHEST', high)).toBe(true);
    expect(evalQuery('priority < LOW', high)).toBe(false);
  });

  it('date comparisons with ISO strings', () => {
    const issue = makeIssue({ dueDate: '2026-06-15T00:00:00.000Z' });
    expect(evalQuery('due < "2026-07-01"', issue)).toBe(true);
    expect(evalQuery('due > "2026-01-01"', issue)).toBe(true);
    expect(evalQuery('due < "2026-01-01"', issue)).toBe(false);
  });

  it('startDate comparisons with ISO strings (mirrors dueDate)', () => {
    const issue = makeIssue({ startDate: '2026-06-01T00:00:00.000Z' });
    expect(evalQuery('startDate < "2026-07-01"', issue)).toBe(true);
    expect(evalQuery('start > "2026-01-01"', issue)).toBe(true);
    expect(evalQuery('start < "2026-01-01"', issue)).toBe(false);
  });

  it('label / array membership via = and IN', () => {
    const issue = makeIssue({
      labels: [
        { id: 'l1', name: 'backend', color: '#000', projectId: 'p1' },
        { id: 'l2', name: 'urgent', color: '#f00', projectId: 'p1' },
      ],
    });
    expect(evalQuery('labels = backend', issue)).toBe(true);
    expect(evalQuery('labels = frontend', issue)).toBe(false);
    expect(evalQuery('labels IN (frontend, urgent)', issue)).toBe(true);
    expect(evalQuery('label ~ back', issue)).toBe(true);
    expect(evalQuery('labels IS EMPTY', issue)).toBe(false);
  });

  it('text field searches title + description', () => {
    const issue = makeIssue({ title: 'Title', description: 'hidden gem here' });
    expect(evalQuery('text ~ "hidden gem"', issue)).toBe(true);
    expect(evalQuery('text ~ Title', issue)).toBe(true);
  });
});

describe('evaluator — functions & users', () => {
  const ctx: EvalContext = {
    currentUserId: 'u-alice',
    users: [USER_ALICE, USER_BOB],
    now: new Date('2026-06-28T12:00:00.000Z'),
  };

  it('me() resolves to ctx.currentUserId', () => {
    const mine = makeIssue({ assigneeId: 'u-alice' });
    const not = makeIssue({ assigneeId: 'u-bob' });
    expect(evalQuery('assignee = me()', mine, ctx)).toBe(true);
    expect(evalQuery('assignee = me()', not, ctx)).toBe(false);
  });

  it('assignee matches by name and email', () => {
    const issue = makeIssue({ assigneeId: 'u-bob' });
    expect(evalQuery('assignee = "Bob"', issue, ctx)).toBe(true);
    expect(evalQuery('assignee = "bob@x.io"', issue, ctx)).toBe(true);
    expect(evalQuery('assignee = "u-bob"', issue, ctx)).toBe(true);
  });

  it('assignee name/email match is case-insensitive', () => {
    const issue = makeIssue({ assigneeId: 'u-bob' });
    expect(evalQuery('assignee = "BOB"', issue, ctx)).toBe(true);
    expect(evalQuery('assignee = "BOB@X.IO"', issue, ctx)).toBe(true);
  });

  it('reporter resolves by name/email exactly like assignee', () => {
    const issue = makeIssue({ reporterId: 'u-alice' });
    expect(evalQuery('reporter = "Alice"', issue, ctx)).toBe(true);
    expect(evalQuery('reporter = "alice@x.io"', issue, ctx)).toBe(true);
  });

  it('a name that resolves to no known user silently matches nothing (no error)', () => {
    const issue = makeIssue({ assigneeId: 'u-bob' });
    // Locks in current semantics (see MCP-QA pass 1, finding 1): an unresolved
    // user reference is NOT an eval error — it falls back to a literal string
    // that will never equal a real user id, so the comparison is false. This
    // is a known "confidently wrong, no error" gap tracked separately; this
    // test exists to make any future behavior change here deliberate.
    expect(evalQuery('assignee = "Nobody By This Name"', issue, ctx)).toBe(false);
    expect(() => evalQuery('assignee = "Nobody By This Name"', issue, ctx)).not.toThrow();
  });

  it('now()/today() compare against dates', () => {
    const past = makeIssue({ dueDate: '2026-06-01T00:00:00.000Z' });
    const future = makeIssue({ dueDate: '2026-12-01T00:00:00.000Z' });
    expect(evalQuery('due < now()', past, ctx)).toBe(true);
    expect(evalQuery('due < now()', future, ctx)).toBe(false);
    expect(evalQuery('due < today()', past, ctx)).toBe(true);
  });

  it('now()/today() compare against startDate (mirrors dueDate)', () => {
    const past = makeIssue({ startDate: '2026-06-01T00:00:00.000Z' });
    const future = makeIssue({ startDate: '2026-12-01T00:00:00.000Z' });
    expect(evalQuery('startDate < now()', past, ctx)).toBe(true);
    expect(evalQuery('startDate < now()', future, ctx)).toBe(false);
    expect(evalQuery('startDate < today()', past, ctx)).toBe(true);
  });

  it('ORDER BY startDate sorts ascending/descending (nulls last on ASC, same as dueDate)', () => {
    const a = makeIssue({ id: 'a', startDate: '2026-01-01T00:00:00.000Z' });
    const b = makeIssue({ id: 'b', startDate: '2026-06-01T00:00:00.000Z' });
    const c = makeIssue({ id: 'c', startDate: null });
    const asc = filterIssues([c, b, a], 'ORDER BY startDate ASC');
    expect(asc.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    // DESC still reverses the dated pair's relative order (b before a); the
    // null's placement is a pre-existing sortComparator quirk shared by every
    // date field (dueDate included), not something new here.
    const desc = filterIssues([c, b, a], 'ORDER BY startDate DESC');
    expect(desc.filter((i) => i.id !== 'c').map((i) => i.id)).toEqual(['b', 'a']);
  });
});

describe('evaluator — sprints (MCP-QA pass 1, finding 1)', () => {
  const ctx: EvalContext = {
    sprints: [SPRINT_ONE, SPRINT_JULY_B],
  };

  it('sprint matches by exact id', () => {
    const issue = makeIssue({ sprintId: SPRINT_JULY_B.id });
    expect(evalQuery('sprint = "sp-2"', issue, ctx)).toBe(true);
    expect(evalQuery('sprint = "sp-1"', issue, ctx)).toBe(false);
  });

  it('sprint matches by exact name', () => {
    const issue = makeIssue({ sprintId: SPRINT_JULY_B.id });
    expect(evalQuery('sprint = "July-B"', issue, ctx)).toBe(true);
    expect(evalQuery('sprint = "Sprint 1 - Checkout Foundations"', issue, ctx)).toBe(false);
  });

  it('sprint name match is case-insensitive', () => {
    const issue = makeIssue({ sprintId: SPRINT_JULY_B.id });
    expect(evalQuery('sprint = "july-b"', issue, ctx)).toBe(true);
    expect(evalQuery('sprint = "JULY-B"', issue, ctx)).toBe(true);
  });

  it('!= negates the resolved match', () => {
    const issue = makeIssue({ sprintId: SPRINT_JULY_B.id });
    expect(evalQuery('sprint != "July-B"', issue, ctx)).toBe(false);
    expect(evalQuery('sprint != "Sprint 1 - Checkout Foundations"', issue, ctx)).toBe(true);
  });

  it('IN resolves each candidate by name', () => {
    const issue = makeIssue({ sprintId: SPRINT_ONE.id });
    expect(
      evalQuery('sprint IN ("July-B", "Sprint 1 - Checkout Foundations")', issue, ctx),
    ).toBe(true);
    expect(evalQuery('sprint IN ("July-B")', issue, ctx)).toBe(false);
  });

  it('IS EMPTY / IS NOT EMPTY unaffected by name resolution', () => {
    const noSprint = makeIssue({ sprintId: null });
    const inSprint = makeIssue({ sprintId: SPRINT_ONE.id });
    expect(evalQuery('sprint IS EMPTY', noSprint, ctx)).toBe(true);
    expect(evalQuery('sprint IS NOT EMPTY', inSprint, ctx)).toBe(true);
  });

  it('a name that resolves to no known sprint silently matches nothing (no error) — mirrors user semantics', () => {
    const issue = makeIssue({ sprintId: SPRINT_ONE.id });
    expect(evalQuery('sprint = "Nonexistent Sprint"', issue, ctx)).toBe(false);
    expect(() => evalQuery('sprint = "Nonexistent Sprint"', issue, ctx)).not.toThrow();
  });

  it('without ctx.sprints, name comparisons fall back to literal (still no throw)', () => {
    const issue = makeIssue({ sprintId: SPRINT_JULY_B.id });
    expect(evalQuery('sprint = "July-B"', issue, {})).toBe(false);
    expect(evalQuery('sprint = "sp-2"', issue, {})).toBe(true); // raw id still matches
  });
});

describe('evaluator — custom fields', () => {
  const defs: NlqlCustomFieldDef[] = [
    { id: 'cf-sev', key: 'severity', name: 'Severity', type: CustomFieldType.SELECT },
    { id: 'cf-num', key: 'estimate', name: 'Estimate', type: CustomFieldType.NUMBER },
    { id: 'cf-tags', key: 'tags', name: 'Tags', type: CustomFieldType.MULTI_SELECT },
  ];
  const ctx: EvalContext = { customFieldDefs: defs };

  it('custom field by key', () => {
    const issue = makeIssue({ customFields: { 'cf-sev': 'High' } });
    expect(evalQuery('severity = high', issue, ctx)).toBe(true);
  });

  it('custom field by display name (quoted)', () => {
    const issue = makeIssue({ customFields: { 'cf-sev': 'High' } });
    expect(evalQuery('"Severity" = high', issue, ctx)).toBe(true);
  });

  it('numeric custom field compares numerically', () => {
    const issue = makeIssue({ customFields: { 'cf-num': 8 } });
    expect(evalQuery('estimate > 5', issue, ctx)).toBe(true);
    expect(evalQuery('estimate < 5', issue, ctx)).toBe(false);
  });

  it('multi-select custom field uses membership', () => {
    const issue = makeIssue({ customFields: { 'cf-tags': ['red', 'blue'] } });
    expect(evalQuery('tags = red', issue, ctx)).toBe(true);
    expect(evalQuery('tags IN (green, blue)', issue, ctx)).toBe(true);
    expect(evalQuery('tags = green', issue, ctx)).toBe(false);
  });

  it('throws NlqlEvalError on an unknown field', () => {
    const issue = makeIssue();
    expect(() => evalQuery('nonsense = x', issue, ctx)).toThrow(NlqlEvalError);
  });
});

describe('evaluator — boolean composition', () => {
  it('AND / OR / NOT', () => {
    const issue = makeIssue({ type: IssueType.BUG, priority: Priority.HIGH });
    expect(evalQuery('type = BUG AND priority = HIGH', issue)).toBe(true);
    expect(evalQuery('type = STORY OR priority = HIGH', issue)).toBe(true);
    expect(evalQuery('NOT type = STORY', issue)).toBe(true);
    expect(evalQuery('type = BUG AND priority = LOW', issue)).toBe(false);
  });
});

describe('filterIssues + ORDER BY', () => {
  const issues = [
    makeIssue({ id: 'a', key: 'NL-1', priority: Priority.LOW, storyPoints: 1 }),
    makeIssue({ id: 'b', key: 'NL-2', priority: Priority.HIGHEST, storyPoints: 8 }),
    makeIssue({ id: 'c', key: 'NL-3', priority: Priority.MEDIUM, storyPoints: 3 }),
  ];

  it('filters and preserves order without ORDER BY', () => {
    const out = filterIssues(issues, 'points >= 3', {});
    expect(out.map((i) => i.id)).toEqual(['b', 'c']);
  });

  it('ORDER BY priority ASC (by rank)', () => {
    const out = filterIssues(issues, 'ORDER BY priority ASC', {});
    expect(out.map((i) => i.id)).toEqual(['a', 'c', 'b']);
  });

  it('ORDER BY priority DESC', () => {
    const out = filterIssues(issues, 'ORDER BY priority DESC', {});
    expect(out.map((i) => i.id)).toEqual(['b', 'c', 'a']);
  });

  it('ORDER BY numeric points ASC', () => {
    const out = filterIssues(issues, 'ORDER BY points ASC', {});
    expect(out.map((i) => i.storyPoints)).toEqual([1, 3, 8]);
  });

  it('does not mutate the input array', () => {
    const copy = [...issues];
    filterIssues(issues, 'ORDER BY points DESC', {});
    expect(issues).toEqual(copy);
  });
});
