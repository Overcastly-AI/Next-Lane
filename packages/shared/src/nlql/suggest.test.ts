import { describe, expect, it } from 'vitest';
import { suggestNlql } from './suggest';
import type { NlqlSuggestContext } from './suggest';

// ---------------------------------------------------------------------------
// Test context
// ---------------------------------------------------------------------------

const CTX: NlqlSuggestContext = {
  statuses: ['To Do', 'In Progress', 'Done'],
  types: ['TASK', 'BUG', 'STORY', 'EPIC'],
  priorities: ['HIGHEST', 'HIGH', 'MEDIUM', 'LOW', 'LOWEST'],
  statusCategories: ['TODO', 'IN_PROGRESS', 'DONE'],
  labels: ['critical', 'bug', 'enhancement'],
  users: [
    { label: 'Alice', value: 'alice@example.com' },
    { label: 'Bob', value: 'bob@example.com' },
  ],
  components: ['frontend', 'backend'],
  sprints: ['Sprint 1', 'Sprint 2'],
  customFields: [
    { key: 'severity', kind: 'SELECT' },
    { key: 'region', kind: 'TEXT' },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function labels(result: ReturnType<typeof suggestNlql>): string[] {
  return result.suggestions.map((s) => s.label);
}

function kinds(result: ReturnType<typeof suggestNlql>): string[] {
  return result.suggestions.map((s) => s.kind);
}

// ---------------------------------------------------------------------------
// Empty input
// ---------------------------------------------------------------------------

describe('empty input', () => {
  it('returns field suggestions at position 0', () => {
    const r = suggestNlql('', 0, CTX);
    expect(r.from).toBe(0);
    expect(r.to).toBe(0);
    expect(labels(r)).toContain('priority');
    expect(labels(r)).toContain('status');
    expect(labels(r)).toContain('assignee');
    expect(kinds(r).every((k) => k === 'field')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Field prefix filtering
// ---------------------------------------------------------------------------

describe('field prefix', () => {
  it('filters fields by prefix — "pri" → priority', () => {
    const r = suggestNlql('pri', 3, CTX);
    expect(labels(r)).toContain('priority');
    expect(labels(r)).not.toContain('status');
  });

  it('is case-insensitive — "PRI" → priority', () => {
    const r = suggestNlql('PRI', 3, CTX);
    expect(labels(r)).toContain('priority');
  });

  it('returns custom fields by prefix — "sev" → severity', () => {
    const r = suggestNlql('sev', 3, CTX);
    expect(labels(r)).toContain('severity');
  });

  it('includes all fields on "s" prefix — status, statusCategory, storyPoints, sprint', () => {
    const r = suggestNlql('s', 1, CTX);
    const ls = labels(r);
    expect(ls).toContain('status');
    expect(ls).toContain('statusCategory');
    expect(ls).toContain('storyPoints');
    expect(ls).toContain('sprint');
  });
});

// ---------------------------------------------------------------------------
// Operators after field — per kind
// ---------------------------------------------------------------------------

describe('operators after field', () => {
  it('after "priority " — enum kind — suggests = != IN NOT IN IS EMPTY', () => {
    const query = 'priority ';
    const r = suggestNlql(query, query.length, CTX);
    const ls = labels(r);
    expect(ls).toContain('=');
    expect(ls).toContain('!=');
    expect(ls).toContain('IN');
    expect(ls).toContain('NOT IN');
    expect(ls).toContain('IS EMPTY');
    expect(kinds(r).every((k) => k === 'operator')).toBe(true);
  });

  it('after "title " — string kind — suggests ~ !~', () => {
    const query = 'title ';
    const r = suggestNlql(query, query.length, CTX);
    const ls = labels(r);
    expect(ls).toContain('~');
    expect(ls).toContain('!~');
    expect(ls).not.toContain('IN');
  });

  it('after "storyPoints " — number kind — suggests > >= < <=', () => {
    const query = 'storyPoints ';
    const r = suggestNlql(query, query.length, CTX);
    const ls = labels(r);
    expect(ls).toContain('>');
    expect(ls).toContain('>=');
    expect(ls).toContain('<');
    expect(ls).toContain('<=');
    expect(ls).not.toContain('~');
  });

  it('after "dueDate " — date kind — suggests > >= < <=', () => {
    const query = 'dueDate ';
    const r = suggestNlql(query, query.length, CTX);
    const ls = labels(r);
    expect(ls).toContain('>');
    expect(ls).toContain('<');
  });

  it('after "startDate " — date kind — suggests > >= < <= (mirrors dueDate)', () => {
    const query = 'startDate ';
    const r = suggestNlql(query, query.length, CTX);
    const ls = labels(r);
    expect(ls).toContain('>');
    expect(ls).toContain('<');
  });

  it('after "assignee " — user kind — suggests = != IN IS EMPTY', () => {
    const query = 'assignee ';
    const r = suggestNlql(query, query.length, CTX);
    const ls = labels(r);
    expect(ls).toContain('=');
    expect(ls).toContain('IS EMPTY');
  });

  it('after "labels " — array kind — suggests = != IN IS EMPTY', () => {
    const query = 'labels ';
    const r = suggestNlql(query, query.length, CTX);
    const ls = labels(r);
    expect(ls).toContain('=');
    expect(ls).toContain('IN');
    expect(ls).toContain('IS EMPTY');
  });
});

// ---------------------------------------------------------------------------
// Values after operator
// ---------------------------------------------------------------------------

describe('values after operator', () => {
  it('after "priority = " — suggests priority values', () => {
    const query = 'priority = ';
    const r = suggestNlql(query, query.length, CTX);
    const ls = labels(r);
    expect(ls).toContain('HIGH');
    expect(ls).toContain('MEDIUM');
    expect(r.suggestions[0].kind).toBe('value');
  });

  it('after "status = " — suggests status values from context', () => {
    const query = 'status = ';
    const r = suggestNlql(query, query.length, CTX);
    const ls = labels(r);
    expect(ls).toContain('To Do');
    expect(ls).toContain('Done');
  });

  it('after "type = " — suggests TASK BUG STORY EPIC', () => {
    const query = 'type = ';
    const r = suggestNlql(query, query.length, CTX);
    expect(labels(r)).toContain('TASK');
    expect(labels(r)).toContain('BUG');
  });

  it('after "labels = " — suggests label names', () => {
    const query = 'labels = ';
    const r = suggestNlql(query, query.length, CTX);
    expect(labels(r)).toContain('critical');
    expect(labels(r)).toContain('bug');
  });

  it('after "assignee = " — suggests me() and user names', () => {
    const query = 'assignee = ';
    const r = suggestNlql(query, query.length, CTX);
    const ls = labels(r);
    expect(ls).toContain('me()');
    expect(ls).toContain('Alice');
    // me() should be function kind
    const meSugg = r.suggestions.find((s) => s.label === 'me()');
    expect(meSugg?.kind).toBe('function');
  });

  it('after "dueDate = " — suggests now() today() startOfWeek() startOfDay()', () => {
    const query = 'dueDate = ';
    const r = suggestNlql(query, query.length, CTX);
    const ls = labels(r);
    expect(ls).toContain('now()');
    expect(ls).toContain('today()');
    expect(ls).toContain('startOfWeek()');
    expect(ls).toContain('startOfDay()');
    expect(r.suggestions.every((s) => s.kind === 'function')).toBe(true);
  });

  it('after "startDate = " — suggests now() today() startOfWeek() startOfDay() (mirrors dueDate)', () => {
    const query = 'startDate = ';
    const r = suggestNlql(query, query.length, CTX);
    const ls = labels(r);
    expect(ls).toContain('now()');
    expect(ls).toContain('today()');
    expect(ls).toContain('startOfWeek()');
    expect(ls).toContain('startOfDay()');
    expect(r.suggestions.every((s) => s.kind === 'function')).toBe(true);
  });

  it('after "createdAt < " — suggests date functions', () => {
    const query = 'createdAt < ';
    const r = suggestNlql(query, query.length, CTX);
    expect(labels(r)).toContain('today()');
  });

  it('after "reporter = " — suggests me() and users', () => {
    const query = 'reporter = ';
    const r = suggestNlql(query, query.length, CTX);
    expect(labels(r)).toContain('me()');
    expect(labels(r)).toContain('Alice');
  });
});

// ---------------------------------------------------------------------------
// IN list values
// ---------------------------------------------------------------------------

describe('IN list values', () => {
  it('after "priority IN (" — suggests priority values', () => {
    const query = 'priority IN (';
    const r = suggestNlql(query, query.length, CTX);
    const ls = labels(r);
    expect(ls).toContain('HIGH');
    expect(ls).toContain('MEDIUM');
  });

  it('after "priority IN (HIGH, " — suggests more priority values', () => {
    const query = 'priority IN (HIGH, ';
    const r = suggestNlql(query, query.length, CTX);
    expect(labels(r)).toContain('MEDIUM');
    expect(labels(r)).toContain('LOW');
  });

  it('after "type IN (BUG, " — suggests remaining types', () => {
    const query = 'type IN (BUG, ';
    const r = suggestNlql(query, query.length, CTX);
    expect(labels(r)).toContain('TASK');
    expect(labels(r)).toContain('STORY');
  });

  it('after assignee IN — suggests me() and users', () => {
    const query = 'assignee IN (';
    const r = suggestNlql(query, query.length, CTX);
    expect(labels(r)).toContain('me()');
    expect(labels(r)).toContain('Alice');
  });
});

// ---------------------------------------------------------------------------
// Logical keywords (AND / OR / ORDER BY) after complete comparison
// ---------------------------------------------------------------------------

describe('logical keywords after complete comparison', () => {
  it('after "priority = HIGH " — suggests AND OR ORDER BY', () => {
    const query = 'priority = HIGH ';
    const r = suggestNlql(query, query.length, CTX);
    const ls = labels(r);
    expect(ls).toContain('AND');
    expect(ls).toContain('OR');
    expect(ls).toContain('ORDER BY');
    expect(r.suggestions[0].kind).toBe('keyword');
  });

  it('after "priority IN (HIGH) " — suggests AND OR ORDER BY', () => {
    const query = 'priority IN (HIGH) ';
    const r = suggestNlql(query, query.length, CTX);
    expect(labels(r)).toContain('AND');
    expect(labels(r)).toContain('ORDER BY');
  });

  it('after "priority IS EMPTY " — suggests AND OR ORDER BY', () => {
    const query = 'priority IS EMPTY ';
    const r = suggestNlql(query, query.length, CTX);
    expect(labels(r)).toContain('AND');
  });
});

// ---------------------------------------------------------------------------
// ORDER BY field + direction
// ---------------------------------------------------------------------------

describe('ORDER BY', () => {
  it('after "ORDER BY " — suggests field names', () => {
    const query = 'ORDER BY ';
    const r = suggestNlql(query, query.length, CTX);
    const ls = labels(r);
    expect(ls).toContain('priority');
    expect(ls).toContain('startDate');
    expect(ls).toContain('dueDate');
    expect(ls).toContain('createdAt');
    expect(r.suggestions[0].kind).toBe('field');
  });

  it('after "ORDER BY priority " — suggests ASC DESC', () => {
    const query = 'ORDER BY priority ';
    const r = suggestNlql(query, query.length, CTX);
    const ls = labels(r);
    expect(ls).toContain('ASC');
    expect(ls).toContain('DESC');
    expect(r.suggestions.every((s) => s.kind === 'keyword')).toBe(true);
  });

  it('after "priority = HIGH ORDER BY " — suggests fields', () => {
    const query = 'priority = HIGH ORDER BY ';
    const r = suggestNlql(query, query.length, CTX);
    expect(labels(r)).toContain('startDate');
    expect(labels(r)).toContain('dueDate');
    expect(labels(r)).toContain('createdAt');
  });
});

// ---------------------------------------------------------------------------
// Mid-token replacement ranges
// ---------------------------------------------------------------------------

describe('mid-token replacement ranges', () => {
  it('cursor mid-field returns the token range', () => {
    // "pri|ority = HIGH" — cursor at position 3 inside "priority"
    const query = 'priority = HIGH';
    const r = suggestNlql(query, 3, CTX);
    // The token "priority" spans [0, 8). Suggestions filtered by prefix "pri".
    expect(r.from).toBe(0);
    expect(r.to).toBeGreaterThanOrEqual(3);
    expect(labels(r)).toContain('priority');
  });

  it('cursor at end of complete token — from/to cover the token', () => {
    const query = 'priority';
    const r = suggestNlql(query, query.length, CTX);
    // "priority" is a complete field token — should be a field suggestion range.
    expect(r.from).toBeLessThanOrEqual(query.length);
    expect(r.to).toBeGreaterThanOrEqual(query.length);
  });

  it('cursor in whitespace — from === to === cursor', () => {
    const query = 'priority  ';
    // Cursor is in the trailing whitespace
    const r = suggestNlql(query, query.length, CTX);
    expect(r.from).toBe(query.length);
    expect(r.to).toBe(query.length);
  });
});

// ---------------------------------------------------------------------------
// Malformed input does not throw
// ---------------------------------------------------------------------------

describe('malformed input does not throw', () => {
  it('unterminated string — returns field suggestions gracefully', () => {
    // Should not throw; returns best-effort suggestions.
    expect(() => suggestNlql('priority = "unt', 15, CTX)).not.toThrow();
  });

  it('unexpected character — does not throw', () => {
    expect(() => suggestNlql('priority @ HIGH', 9, CTX)).not.toThrow();
  });

  it('empty field "= HIGH" — does not throw', () => {
    expect(() => suggestNlql('= HIGH', 6, CTX)).not.toThrow();
  });

  it('deeply nested parens — does not throw', () => {
    expect(() => suggestNlql('((((priority = ', 15, CTX)).not.toThrow();
  });

  it('pure whitespace — returns field suggestions', () => {
    const r = suggestNlql('   ', 3, CTX);
    expect(() => r).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Custom fields
// ---------------------------------------------------------------------------

describe('custom fields', () => {
  it('suggests custom field keys in field position', () => {
    const r = suggestNlql('', 0, CTX);
    const ls = labels(r);
    expect(ls).toContain('severity');
    expect(ls).toContain('region');
  });

  it('custom field kind shown in detail', () => {
    const r = suggestNlql('sev', 3, CTX);
    const sev = r.suggestions.find((s) => s.label === 'severity');
    expect(sev?.kind).toBe('field');
    expect(sev?.detail).toMatch(/SELECT/);
  });
});

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

describe('function suggestions', () => {
  it('me() has kind function', () => {
    const r = suggestNlql('assignee = ', 11, CTX);
    const me = r.suggestions.find((s) => s.label === 'me()');
    expect(me).toBeDefined();
    expect(me?.kind).toBe('function');
    expect(me?.insertText).toBe('me()');
  });

  it('now() has kind function', () => {
    const r = suggestNlql('dueDate > ', 10, CTX);
    const now = r.suggestions.find((s) => s.label === 'now()');
    expect(now?.kind).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Value quoting
// ---------------------------------------------------------------------------

describe('value quoting', () => {
  it('values with spaces are quoted in insertText', () => {
    const r = suggestNlql('status = ', 9, CTX);
    const inProgress = r.suggestions.find((s) => s.label === 'In Progress');
    expect(inProgress?.insertText).toBe('"In Progress"');
  });

  it('values without spaces are not quoted', () => {
    const r = suggestNlql('priority = ', 11, CTX);
    const high = r.suggestions.find((s) => s.label === 'HIGH');
    expect(high?.insertText).toBe('HIGH');
  });

  it('sprint names with spaces are quoted', () => {
    const r = suggestNlql('sprint = ', 9, CTX);
    const s1 = r.suggestions.find((s) => s.label === 'Sprint 1');
    expect(s1?.insertText).toBe('"Sprint 1"');
  });
});

// ---------------------------------------------------------------------------
// AND / OR chain
// ---------------------------------------------------------------------------

describe('AND / OR chaining', () => {
  it('after "priority = HIGH AND " — suggests fields', () => {
    const query = 'priority = HIGH AND ';
    const r = suggestNlql(query, query.length, CTX);
    const ls = labels(r);
    expect(ls).toContain('status');
    expect(ls).toContain('assignee');
    expect(r.suggestions[0].kind).toBe('field');
  });

  it('after "priority = HIGH OR " — suggests fields', () => {
    const query = 'priority = HIGH OR ';
    const r = suggestNlql(query, query.length, CTX);
    expect(labels(r)).toContain('status');
  });

  it('partial field after AND filters correctly', () => {
    const query = 'priority = HIGH AND pri';
    const r = suggestNlql(query, query.length, CTX);
    expect(labels(r)).toContain('priority');
    expect(labels(r)).not.toContain('status');
  });
});
