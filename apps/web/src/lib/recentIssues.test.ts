// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_RECENT_ISSUES,
  getRecentIssues,
  recordRecentIssue,
} from './recentIssues';

const mk = (n: number) => ({
  id: `i${n}`,
  key: `NL-${n}`,
  title: `Issue ${n}`,
  projectId: 'p1',
  type: 'TASK',
});

describe('recentIssues', () => {
  beforeEach(() => localStorage.clear());

  it('returns [] with no workspace or no data', () => {
    expect(getRecentIssues(null)).toEqual([]);
    expect(getRecentIssues('w1')).toEqual([]);
  });

  it('records most-recent-first and de-duplicates', () => {
    recordRecentIssue('w1', mk(1));
    recordRecentIssue('w1', mk(2));
    recordRecentIssue('w1', mk(1));
    expect(getRecentIssues('w1').map((r) => r.id)).toEqual(['i1', 'i2']);
  });

  it('caps the list', () => {
    for (let i = 0; i < MAX_RECENT_ISSUES + 4; i++) recordRecentIssue('w1', mk(i));
    const list = getRecentIssues('w1');
    expect(list).toHaveLength(MAX_RECENT_ISSUES);
    expect(list[0].id).toBe(`i${MAX_RECENT_ISSUES + 3}`);
  });

  it('is scoped per workspace', () => {
    recordRecentIssue('w1', mk(1));
    expect(getRecentIssues('w2')).toEqual([]);
  });

  it('survives corrupt storage', () => {
    localStorage.setItem('nl:recent-issues:w1', '{not json');
    expect(getRecentIssues('w1')).toEqual([]);
    localStorage.setItem('nl:recent-issues:w1', JSON.stringify([{ nope: 1 }, mk(3)]));
    expect(getRecentIssues('w1').map((r) => r.id)).toEqual(['i3']);
  });
});
