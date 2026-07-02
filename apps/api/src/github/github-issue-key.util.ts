/**
 * Extract issue numbers referenced by a project's issue-key prefix
 * (e.g. "NL-123", "NL-45") out of free text (a commit message, PR title, or
 * branch name).
 *
 * Scoping: the regex is built from the CALLER-SUPPLIED `projectKey`, so a key
 * belonging to a different project (e.g. "OTHER-123" when this project's key
 * is "NL") never matches — this is what keeps webhook-driven linking scoped
 * to the project the webhook is configured for, per the acceptance criteria.
 *
 * Multiple distinct keys in the same text (e.g. "Fixes NL-1 and NL-2") all
 * match; duplicates collapse via the Set. Case-insensitive (commit authors
 * don't always type the key in the project's canonical case).
 */
export function extractIssueNumbers(text: string, projectKey: string): number[] {
  if (!text || !projectKey) return [];
  const escapedKey = projectKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\b${escapedKey}-(\\d+)\\b`, 'gi');
  const numbers = new Set<number>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    numbers.add(Number(match[1]));
  }
  return [...numbers];
}
