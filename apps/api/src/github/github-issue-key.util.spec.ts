import { extractIssueNumbers } from './github-issue-key.util';

describe('extractIssueNumbers', () => {
  it('extracts a single issue key', () => {
    expect(extractIssueNumbers('Fix NL-42 crash on load', 'NL')).toEqual([42]);
  });

  it('extracts multiple distinct keys from one commit message', () => {
    expect(extractIssueNumbers('Fixes NL-1 and NL-2, related to NL-3', 'NL')).toEqual([
      1, 2, 3,
    ]);
  });

  it('de-duplicates repeated mentions of the same key', () => {
    expect(extractIssueNumbers('NL-9 NL-9 NL-9', 'NL')).toEqual([9]);
  });

  it('is case-insensitive on the key prefix', () => {
    expect(extractIssueNumbers('fixes nl-15', 'NL')).toEqual([15]);
  });

  it('ignores keys belonging to a different project prefix', () => {
    expect(extractIssueNumbers('OTHER-123 unrelated change', 'NL')).toEqual([]);
  });

  it('ignores a key that is a substring of a longer token', () => {
    // "XNL-5" should not match project key "NL" (word boundary).
    expect(extractIssueNumbers('XNL-5 should not match', 'NL')).toEqual([]);
  });

  it('matches inside a branch name', () => {
    expect(extractIssueNumbers('feature/NL-77-fix-login', 'NL')).toEqual([77]);
  });

  it('matches inside a PR title with mixed content', () => {
    expect(
      extractIssueNumbers('[NL-8] Add dark mode toggle', 'NL'),
    ).toEqual([8]);
  });

  it('returns an empty array for text with no matches', () => {
    expect(extractIssueNumbers('Refactor internal helpers', 'NL')).toEqual([]);
  });

  it('returns an empty array for empty text or empty project key', () => {
    expect(extractIssueNumbers('', 'NL')).toEqual([]);
    expect(extractIssueNumbers('NL-1', '')).toEqual([]);
  });

  it('escapes regex-special characters in the project key safely', () => {
    // Defensive: project keys are alnum in practice, but the regex-escape
    // path must not throw or misbehave if a key ever contains special chars.
    expect(() => extractIssueNumbers('A.B-5 test', 'A.B')).not.toThrow();
    expect(extractIssueNumbers('A.B-5 test', 'A.B')).toEqual([5]);
  });
});
