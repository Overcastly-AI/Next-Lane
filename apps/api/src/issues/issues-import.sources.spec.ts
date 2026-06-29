/**
 * Unit tests for issues-import.sources.ts
 *
 * Covers:
 *  - Jira: header aliasing, type mapping, priority mapping, label merge,
 *          display-name assignee note, unknown enum passthrough
 *  - GitHub: header aliasing, state→status mapping (open/closed), JSON array
 *            path, login-assignee note, label array / comma-string handling
 *  - Linear: header aliasing, priority mapping, assignee email extraction
 *  - Generic: passthrough (regression)
 *  - isImportSource guard
 *  - looksLikeJson detection
 */

import {
  isImportSource,
  looksLikeJson,
  normaliseRowForSource,
  normaliseJiraRow,
  normaliseGithubRow,
  normaliseLinearRow,
  githubJsonToRows,
  JIRA_TYPE_MAP,
  JIRA_PRIORITY_MAP,
  LINEAR_PRIORITY_MAP,
  GITHUB_STATE_STATUS_MAP,
} from './issues-import.sources';
import { IssueType, Priority } from '@next-lane/shared';

// ─────────────────────────────────────────────────────────────────────────────
// isImportSource guard
// ─────────────────────────────────────────────────────────────────────────────

describe('isImportSource', () => {
  it.each(['generic', 'jira', 'github', 'linear'])(
    'returns true for valid source "%s"',
    (s) => expect(isImportSource(s)).toBe(true),
  );

  it.each(['gitlab', 'asana', '', 42, null, undefined])(
    'returns false for invalid source %s',
    (s) => expect(isImportSource(s)).toBe(false),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// looksLikeJson
// ─────────────────────────────────────────────────────────────────────────────

describe('looksLikeJson', () => {
  it('returns true for a JSON array', () =>
    expect(looksLikeJson('[{"title":"Foo"}]')).toBe(true));
  it('returns true for a JSON object', () =>
    expect(looksLikeJson('{"items":[]}')).toBe(true));
  it('returns true for whitespace-prefixed JSON', () =>
    expect(looksLikeJson('  \n[{"title":"Bar"}]')).toBe(true));
  it('returns false for a CSV string', () =>
    expect(looksLikeJson('title,body\nFoo,Bar')).toBe(false));
  it('returns false for an empty string', () =>
    expect(looksLikeJson('')).toBe(false));
});

// ─────────────────────────────────────────────────────────────────────────────
// Generic source (regression — passthrough)
// ─────────────────────────────────────────────────────────────────────────────

describe('normaliseRowForSource — generic passthrough', () => {
  it('returns the row unchanged', () => {
    const row = { Title: 'Fix bug', Type: 'BUG', Priority: 'HIGH' };
    const { row: out, notes } = normaliseRowForSource('generic', row);
    expect(out).toBe(row); // same reference — no copy needed
    expect(notes).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Jira
// ─────────────────────────────────────────────────────────────────────────────

describe('normaliseJiraRow — header aliases', () => {
  it('maps Summary → title', () => {
    const { row } = normaliseJiraRow({ Summary: 'Login page crashes' });
    expect(row['title']).toBe('Login page crashes');
  });

  it('maps Description → description', () => {
    const { row } = normaliseJiraRow({ Description: 'Steps to reproduce...' });
    expect(row['description']).toBe('Steps to reproduce...');
  });

  it('maps "Issue Type" → type (after enum mapping)', () => {
    const { row } = normaliseJiraRow({ 'Issue Type': 'Bug' });
    expect(row['type']).toBe(IssueType.BUG);
  });

  it('maps Priority → priority (after enum mapping)', () => {
    const { row } = normaliseJiraRow({ Priority: 'High' });
    expect(row['priority']).toBe(Priority.HIGH);
  });

  it('maps Assignee → assignee', () => {
    const { row } = normaliseJiraRow({ Assignee: 'alice@example.com' });
    expect(row['assignee']).toBe('alice@example.com');
  });

  it('maps Labels → labels', () => {
    const { row } = normaliseJiraRow({ Labels: 'frontend,backend' });
    expect(row['labels']).toBe('frontend,backend');
  });

  it('maps "Story Points" → story points', () => {
    const { row } = normaliseJiraRow({ 'Story Points': '8' });
    expect(row['story points']).toBe('8');
  });

  it('maps "Story point estimate" → story points', () => {
    const { row } = normaliseJiraRow({ 'Story point estimate': '5' });
    expect(row['story points']).toBe('5');
  });

  it('maps "Due Date" → due date', () => {
    const { row } = normaliseJiraRow({ 'Due Date': '2026-12-31' });
    expect(row['due date']).toBe('2026-12-31');
  });

  it('drops Resolution (maps to empty string)', () => {
    const { row } = normaliseJiraRow({ Resolution: 'Fixed' });
    expect(row['resolution']).toBeUndefined();
    expect(row['']).toBeUndefined();
  });
});

describe('normaliseJiraRow — issue type mapping', () => {
  const cases: Array<[string, IssueType]> = [
    ['Bug', IssueType.BUG],
    ['Story', IssueType.STORY],
    ['Task', IssueType.TASK],
    ['Epic', IssueType.EPIC],
    ['Sub-task', IssueType.SUBTASK],
    ['Subtask', IssueType.SUBTASK],
    ['New Feature', IssueType.STORY],
    ['Improvement', IssueType.STORY],
    ['Technical Task', IssueType.TASK],
  ];

  it.each(cases)('Jira type "%s" → %s', (jiraType, expected) => {
    const { row } = normaliseJiraRow({ 'Issue Type': jiraType });
    expect(row['type']).toBe(expected);
  });

  it('leaves an unknown Issue Type value as-is (generic pipeline will error)', () => {
    const { row } = normaliseJiraRow({ 'Issue Type': 'UnknownType' });
    expect(row['type']).toBe('UnknownType');
  });
});

describe('normaliseJiraRow — priority mapping', () => {
  const cases: Array<[string, Priority]> = [
    ['Highest', Priority.HIGHEST],
    ['High', Priority.HIGH],
    ['Medium', Priority.MEDIUM],
    ['Low', Priority.LOW],
    ['Lowest', Priority.LOWEST],
    ['Blocker', Priority.HIGHEST],
    ['Critical', Priority.HIGHEST],
    ['Major', Priority.HIGH],
    ['Minor', Priority.LOW],
    ['Trivial', Priority.LOWEST],
  ];

  it.each(cases)('Jira priority "%s" → %s', (jiraPriority, expected) => {
    const { row } = normaliseJiraRow({ Priority: jiraPriority });
    expect(row['priority']).toBe(expected);
  });

  it('leaves an unknown priority value as-is (generic pipeline will error)', () => {
    const { row } = normaliseJiraRow({ Priority: 'SuperCritical' });
    expect(row['priority']).toBe('SuperCritical');
  });
});

describe('normaliseJiraRow — duplicate Labels columns', () => {
  it('merges a second Labels column value into the first', () => {
    // Simulates csv-parse keeping the last value for duplicate headers by
    // using non-identical key names (e.g. as produced by our test setup).
    // In practice our normaliser also checks for Labels_2 / Labels.1 patterns.
    const { row } = normaliseJiraRow({
      Summary: 'Test',
      Labels: 'frontend',
      Labels_2: 'backend',
    });
    expect(row['labels']).toContain('frontend');
    expect(row['labels']).toContain('backend');
  });

  it('handles a single Labels column without modification', () => {
    const { row } = normaliseJiraRow({ Summary: 'Test', Labels: 'bug' });
    expect(row['labels']).toBe('bug');
  });
});

describe('normaliseJiraRow — display-name assignee note', () => {
  it('adds a note when the assignee is a display name (no @)', () => {
    const { notes } = normaliseJiraRow({ Assignee: 'Alice Smith' });
    expect(notes.length).toBeGreaterThan(0);
    expect(notes[0]).toMatch(/display name/i);
  });

  it('does NOT add a note when the assignee is an email address', () => {
    const { notes } = normaliseJiraRow({ Assignee: 'alice@example.com' });
    expect(notes).toHaveLength(0);
  });

  it('does NOT add a note when Assignee is absent', () => {
    const { notes } = normaliseJiraRow({ Summary: 'Test' });
    expect(notes).toHaveLength(0);
  });
});

describe('normaliseJiraRow — full representative snippet', () => {
  it('normalises a representative Jira CSV row end-to-end', () => {
    const input = {
      'Issue key': 'PROJ-1',
      Summary: 'Fix login crash',
      Description: 'Reproduce by clicking X',
      'Issue Type': 'Bug',
      Status: 'In Progress',
      Priority: 'High',
      Assignee: 'bob@acme.com',
      Labels: 'security',
      'Story Points': '3',
      'Due Date': '2026-09-30',
      Reporter: 'alice@acme.com',
      Resolution: 'Unresolved',
    };

    const { row } = normaliseJiraRow(input);

    expect(row['title']).toBe('Fix login crash');
    expect(row['description']).toBe('Reproduce by clicking X');
    expect(row['type']).toBe(IssueType.BUG);
    expect(row['status']).toBe('In Progress');
    expect(row['priority']).toBe(Priority.HIGH);
    expect(row['assignee']).toBe('bob@acme.com');
    expect(row['labels']).toBe('security');
    expect(row['story points']).toBe('3');
    expect(row['due date']).toBe('2026-09-30');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GitHub
// ─────────────────────────────────────────────────────────────────────────────

describe('normaliseGithubRow — header aliases', () => {
  it('maps title → title', () => {
    const { row } = normaliseGithubRow({ title: 'Create login page' });
    expect(row['title']).toBe('Create login page');
  });

  it('maps body → description', () => {
    const { row } = normaliseGithubRow({ body: 'Details here' });
    expect(row['description']).toBe('Details here');
  });

  it('maps labels → labels', () => {
    const { row } = normaliseGithubRow({ labels: 'bug,enhancement' });
    expect(row['labels']).toBe('bug,enhancement');
  });

  it('maps state → status (via STATE map)', () => {
    const { row: openRow } = normaliseGithubRow({ state: 'open' });
    expect(openRow['status']).toBe(''); // open → blank (use default TODO status)

    const { row: closedRow } = normaliseGithubRow({ state: 'closed' });
    expect(closedRow['status']).toBe('Done');
  });

  it('maps assignees → assignee', () => {
    const { row } = normaliseGithubRow({ assignees: 'bob@example.com' });
    expect(row['assignee']).toBe('bob@example.com');
  });

  it('drops ignored columns (url, comments, reactions, milestone)', () => {
    const { row } = normaliseGithubRow({
      url: 'https://github.com/...',
      comments: '3',
      reactions: '{}',
      milestone: 'v1.0',
    });
    expect(row['url']).toBeUndefined();
    expect(row['comments']).toBeUndefined();
    expect(row['reactions']).toBeUndefined();
    expect(row['milestone']).toBeUndefined();
  });
});

describe('normaliseGithubRow — state=closed → Done mapping', () => {
  it('maps "closed" → "Done"', () => {
    const { row } = normaliseGithubRow({ state: 'closed' });
    expect(row['status']).toBe('Done');
  });

  it('maps "open" → empty string (pipeline defaults to TODO)', () => {
    const { row } = normaliseGithubRow({ state: 'open' });
    expect(row['status']).toBe('');
  });

  it('leaves unknown state values as-is', () => {
    const { row } = normaliseGithubRow({ state: 'draft' });
    expect(row['status']).toBe('draft');
  });
});

describe('normaliseGithubRow — login-assignee note', () => {
  it('adds a note when the assignee has no @ (GitHub login)', () => {
    const { notes } = normaliseGithubRow({ assignees: 'octocat' });
    expect(notes.length).toBeGreaterThan(0);
    expect(notes[0]).toMatch(/login handle/i);
  });

  it('does NOT add a note when the assignee is an email', () => {
    const { notes } = normaliseGithubRow({ assignees: 'user@example.com' });
    expect(notes).toHaveLength(0);
  });

  it('does NOT add a note when assignees is blank', () => {
    const { notes } = normaliseGithubRow({ assignees: '' });
    expect(notes).toHaveLength(0);
  });
});

describe('githubJsonToRows — JSON array path', () => {
  it('converts a GitHub JSON array to normalised rows', () => {
    const json = [
      {
        title: 'Fix bug',
        body: 'Details',
        state: 'open',
        assignee: { login: 'octocat', email: '' },
        assignees: [{ login: 'octocat' }],
        labels: [{ name: 'bug' }, { name: 'P1' }],
      },
    ];
    const rows = githubJsonToRows(json);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Fix bug');
    expect(rows[0].body).toBe('Details');
    expect(rows[0].state).toBe('open');
    expect(rows[0].labels).toBe('bug,P1');
  });

  it('uses assignee.email when available', () => {
    const json = [
      {
        title: 'Test',
        body: '',
        state: 'open',
        assignee: { login: 'octocat', email: 'octocat@github.com' },
        assignees: [{ login: 'octocat', email: 'octocat@github.com' }],
        labels: [],
      },
    ];
    const rows = githubJsonToRows(json);
    expect(rows[0].assignees).toBe('octocat@github.com');
  });

  it('falls back to login when email is absent', () => {
    const json = [
      {
        title: 'Test',
        body: '',
        state: 'closed',
        assignees: [{ login: 'monalisa' }],
        labels: [],
      },
    ];
    const rows = githubJsonToRows(json);
    expect(rows[0].assignees).toBe('monalisa');
  });

  it('handles an empty JSON array', () => {
    expect(githubJsonToRows([])).toHaveLength(0);
  });

  it('handles a GitHub REST envelope { items: [...] }', () => {
    const json = { items: [{ title: 'Issue A', body: '', state: 'open', labels: [] }] };
    const rows = githubJsonToRows(json);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Issue A');
  });

  it('handles string labels in the JSON array', () => {
    const json = [{ title: 'T', body: '', state: 'open', labels: ['alpha', 'beta'] }];
    const rows = githubJsonToRows(json);
    expect(rows[0].labels).toBe('alpha,beta');
  });

  it('returns an empty array for non-array, non-envelope JSON', () => {
    expect(githubJsonToRows({ foo: 'bar' })).toHaveLength(0);
  });
});

describe('normaliseRowForSource github — full pipeline through normaliser', () => {
  it('normalises a GitHub JSON-derived row end-to-end (closed → Done)', () => {
    const rawRow = {
      title: 'Ship feature X',
      body: 'We need to ship feature X',
      state: 'closed',
      assignees: 'dev@example.com',
      labels: 'enhancement,P1',
    };
    const { row } = normaliseRowForSource('github', rawRow);
    expect(row['title']).toBe('Ship feature X');
    expect(row['description']).toBe('We need to ship feature X');
    expect(row['status']).toBe('Done');
    expect(row['assignee']).toBe('dev@example.com');
    expect(row['labels']).toBe('enhancement,P1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Linear
// ─────────────────────────────────────────────────────────────────────────────

describe('normaliseLinearRow — header aliases', () => {
  it('maps Title → title', () => {
    const { row } = normaliseLinearRow({ Title: 'Add dark mode' });
    expect(row['title']).toBe('Add dark mode');
  });

  it('maps Description → description', () => {
    const { row } = normaliseLinearRow({ Description: 'Design spec attached' });
    expect(row['description']).toBe('Design spec attached');
  });

  it('maps Status → status', () => {
    const { row } = normaliseLinearRow({ Status: 'In Progress' });
    expect(row['status']).toBe('In Progress');
  });

  it('maps Priority → priority (after enum mapping)', () => {
    const { row } = normaliseLinearRow({ Priority: 'Urgent' });
    expect(row['priority']).toBe(Priority.HIGHEST);
  });

  it('maps Estimate → story points', () => {
    const { row } = normaliseLinearRow({ Estimate: '5' });
    expect(row['story points']).toBe('5');
  });

  it('maps Labels → labels', () => {
    const { row } = normaliseLinearRow({ Labels: 'design,ux' });
    expect(row['labels']).toBe('design,ux');
  });

  it('maps "Due Date" → due date', () => {
    const { row } = normaliseLinearRow({ 'Due Date': '2026-11-01' });
    expect(row['due date']).toBe('2026-11-01');
  });

  it('drops Cycle (sprint equivalent; not imported)', () => {
    const { row } = normaliseLinearRow({ Cycle: 'Sprint 5' });
    expect(row['cycle']).toBeUndefined();
  });

  it('drops Team column', () => {
    const { row } = normaliseLinearRow({ Team: 'Engineering' });
    expect(row['team']).toBeUndefined();
  });
});

describe('normaliseLinearRow — priority mapping', () => {
  const cases: Array<[string, Priority]> = [
    ['Urgent', Priority.HIGHEST],
    ['High', Priority.HIGH],
    ['Medium', Priority.MEDIUM],
    ['Low', Priority.LOW],
    ['No priority', Priority.LOWEST],
    ['None', Priority.LOWEST],
    // case-insensitive:
    ['urgent', Priority.HIGHEST],
    ['HIGH', Priority.HIGH],
  ];

  it.each(cases)('Linear priority "%s" → %s', (linearPriority, expected) => {
    const { row } = normaliseLinearRow({ Priority: linearPriority });
    expect(row['priority']).toBe(expected);
  });

  it('leaves an unknown priority value as-is (generic pipeline will error)', () => {
    const { row } = normaliseLinearRow({ Priority: 'Critical' });
    expect(row['priority']).toBe('Critical');
  });
});

describe('normaliseLinearRow — assignee email extraction', () => {
  it('extracts email from "First Last <email>" format', () => {
    const { row } = normaliseLinearRow({ Assignee: 'Alice Smith <alice@company.com>' });
    expect(row['assignee']).toBe('alice@company.com');
  });

  it('keeps a bare email as-is', () => {
    const { row } = normaliseLinearRow({ Assignee: 'alice@company.com' });
    expect(row['assignee']).toBe('alice@company.com');
  });

  it('adds a note when assignee has no email', () => {
    const { notes } = normaliseLinearRow({ Assignee: 'Alice Smith' });
    expect(notes.length).toBeGreaterThan(0);
    expect(notes[0]).toMatch(/email/i);
  });

  it('does NOT add a note when Assignee is blank', () => {
    const { notes } = normaliseLinearRow({ Assignee: '' });
    expect(notes).toHaveLength(0);
  });
});

describe('normaliseLinearRow — full representative snippet', () => {
  it('normalises a representative Linear CSV row end-to-end', () => {
    const input = {
      ID: 'LIN-42',
      Title: 'Migrate to Postgres 16',
      Description: 'Upgrade the DB instance',
      Status: 'In Progress',
      Priority: 'High',
      Assignee: 'Bob Jones <bob@company.com>',
      Labels: 'infra,backend',
      Estimate: '8',
      'Due Date': '2026-10-01',
      Team: 'Engineering',
      Cycle: 'Sprint 7',
    };

    const { row, notes } = normaliseLinearRow(input);

    expect(row['title']).toBe('Migrate to Postgres 16');
    expect(row['description']).toBe('Upgrade the DB instance');
    expect(row['status']).toBe('In Progress');
    expect(row['priority']).toBe(Priority.HIGH);
    expect(row['assignee']).toBe('bob@company.com');
    expect(row['labels']).toBe('infra,backend');
    expect(row['story points']).toBe('8');
    expect(row['due date']).toBe('2026-10-01');
    // Dropped columns must not appear.
    expect(row['team']).toBeUndefined();
    expect(row['cycle']).toBeUndefined();
    expect(notes).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unknown enum → passthrough (generic pipeline emits row error)
// ─────────────────────────────────────────────────────────────────────────────

describe('unknown enum values — passthrough to generic pipeline', () => {
  it('Jira unknown Issue Type is passed through unchanged', () => {
    const { row } = normaliseJiraRow({ 'Issue Type': 'Spike' });
    expect(row['type']).toBe('Spike');
    // The generic pipeline will see "Spike", fail parseIssueType, and emit
    // a row error — which is the desired behaviour.
  });

  it('Jira unknown Priority is passed through unchanged', () => {
    const { row } = normaliseJiraRow({ Priority: 'P0' });
    expect(row['priority']).toBe('P0');
  });

  it('Linear unknown Priority is passed through unchanged', () => {
    const { row } = normaliseLinearRow({ Priority: 'Critical' });
    expect(row['priority']).toBe('Critical');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Map constants sanity-checks
// ─────────────────────────────────────────────────────────────────────────────

describe('JIRA_TYPE_MAP — all values are valid IssueType', () => {
  const validTypes = new Set(Object.values(IssueType));
  for (const [key, val] of Object.entries(JIRA_TYPE_MAP)) {
    it(`JIRA_TYPE_MAP["${key}"] = "${val}" is a valid IssueType`, () => {
      expect(validTypes.has(val)).toBe(true);
    });
  }
});

describe('JIRA_PRIORITY_MAP — all values are valid Priority', () => {
  const validPriorities = new Set(Object.values(Priority));
  for (const [key, val] of Object.entries(JIRA_PRIORITY_MAP)) {
    it(`JIRA_PRIORITY_MAP["${key}"] = "${val}" is a valid Priority`, () => {
      expect(validPriorities.has(val)).toBe(true);
    });
  }
});

describe('LINEAR_PRIORITY_MAP — all values are valid Priority', () => {
  const validPriorities = new Set(Object.values(Priority));
  for (const [key, val] of Object.entries(LINEAR_PRIORITY_MAP)) {
    it(`LINEAR_PRIORITY_MAP["${key}"] = "${val}" is a valid Priority`, () => {
      expect(validPriorities.has(val)).toBe(true);
    });
  }
});

describe('GITHUB_STATE_STATUS_MAP — well-formed', () => {
  it('maps "open" to an empty string (use default status)', () => {
    expect(GITHUB_STATE_STATUS_MAP['open']).toBe('');
  });
  it('maps "closed" to "Done"', () => {
    expect(GITHUB_STATE_STATUS_MAP['closed']).toBe('Done');
  });
});
