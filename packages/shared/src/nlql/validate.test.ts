import { describe, expect, it } from 'vitest';
import { CustomFieldType } from '../enums';
import { filterIssues } from './evaluator';
import { NLQL_MAX_LENGTH, validateQuery } from './validate';
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
