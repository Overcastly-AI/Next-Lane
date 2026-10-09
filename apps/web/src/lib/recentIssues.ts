/**
 * "Recently viewed" issues for the command palette — per workspace, kept in
 * localStorage. Every storage access is guarded: private mode / quota / a
 * corrupt value must never break the app, it just means no recents.
 */
export interface RecentIssue {
  id: string;
  key: string;
  title: string;
  projectId: string;
  type: string;
  at: number;
}

export const MAX_RECENT_ISSUES = 8;
export const RECENT_ISSUES_EVENT = 'nl:recent-issues';

const storageKey = (workspaceId: string) => `nl:recent-issues:${workspaceId}`;

function isRecent(v: unknown): v is RecentIssue {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.key === 'string' &&
    typeof r.title === 'string' &&
    typeof r.projectId === 'string'
  );
}

export function getRecentIssues(workspaceId: string | null | undefined): RecentIssue[] {
  if (!workspaceId) return [];
  try {
    const raw = localStorage.getItem(storageKey(workspaceId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecent).slice(0, MAX_RECENT_ISSUES);
  } catch {
    return [];
  }
}

/** Move/insert an issue to the front, capped at {@link MAX_RECENT_ISSUES}. */
export function recordRecentIssue(
  workspaceId: string | null | undefined,
  issue: Omit<RecentIssue, 'at'>,
  now: number = Date.now(),
): RecentIssue[] {
  if (!workspaceId) return [];
  const next = [
    { ...issue, at: now },
    ...getRecentIssues(workspaceId).filter((r) => r.id !== issue.id),
  ].slice(0, MAX_RECENT_ISSUES);
  try {
    localStorage.setItem(storageKey(workspaceId), JSON.stringify(next));
    window.dispatchEvent(new Event(RECENT_ISSUES_EVENT));
  } catch {
    /* storage unavailable — recents are best-effort */
  }
  return next;
}
