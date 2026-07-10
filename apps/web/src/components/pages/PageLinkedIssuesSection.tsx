/**
 * PageLinkedIssuesSection ("Linked issues")
 *
 * Rendered in the page reading view (Document tab, hidden while editing —
 * same lifecycle as `BacklinksPanel`, which it sits beside/below). Lists the
 * issues this page's body currently mentions (e.g. "NL-123"), read from
 * `GET /pages/:id/issues` — the reverse of the issue drawer's "Linked pages"
 * section (`LinkedPagesSection.tsx`), which already ships. That endpoint and
 * the underlying reference-sync were already fully built server-side (and
 * exposed over MCP as `get_page_issues`); this is purely the missing
 * frontend consumer.
 *
 * Visual language: the section chrome (border-t, icon + label + count badge)
 * matches `BacklinksPanel` so the two "what does this page connect to" panels
 * read as one family; each row's content (status dot + key + title + status
 * chip) matches `LinkedIssuesSection`'s issue-reference rows so an issue
 * looks the same wherever it's referenced across the app.
 */
import { useNavigate } from 'react-router-dom';
import type { IssueRefDto } from '@next-lane/shared';
import { usePageIssues } from '@/api/pages';
import { ErrorState, LoadingState } from '@/components/ui/States';

export interface PageLinkedIssuesSectionProps {
  pageId: string;
  projectId: string;
}

export function PageLinkedIssuesSection({ pageId, projectId }: PageLinkedIssuesSectionProps) {
  const navigate = useNavigate();
  const query = usePageIssues(pageId);
  const items = query.data?.items ?? [];

  function openIssue(issueId: string) {
    // Deep-links into the board with the issue drawer open — the same
    // pattern used app-wide (My Work, notifications, roadmap, command
    // palette) for "open this issue from outside the board".
    navigate(`/projects/${projectId}/board?issue=${issueId}`);
  }

  return (
    <section
      aria-label="Linked issues"
      data-testid="page-linked-issues-panel"
      className="border-t border-ink-100 px-4 py-4 sm:px-6"
    >
      <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-ink-500">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
        Linked issues
        {items.length > 0 && (
          <span className="rounded-full bg-ink-100 px-1.5 py-0.5 text-[10px] font-semibold text-ink-500">
            {items.length}
          </span>
        )}
      </h2>

      {query.isLoading ? (
        <LoadingState label="Loading linked issues…" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : items.length === 0 ? (
        <p data-testid="page-linked-issues-empty" className="text-xs text-ink-400">
          No issues reference this page yet — mention an issue key (e.g. “NL-12”) in the body to link one.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((issue) => (
            <li key={issue.id}>
              <button
                type="button"
                onClick={() => openIssue(issue.id)}
                data-testid={`page-linked-issue-${issue.id}`}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink-700 transition-colors duration-[120ms] hover:bg-ink-50 hover:text-signal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400"
              >
                <IssueStatusDot issue={issue} />
                <span className="shrink-0 font-mono text-[11px] font-semibold text-signal-600">
                  {issue.key}
                </span>
                <span className="min-w-0 flex-1 truncate">{issue.title}</span>
                {issue.status && (
                  <span className="shrink-0 rounded-full bg-ink-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-ink-500">
                    {issue.status.name}
                  </span>
                )}
              </button>
            </li>
          ))}
          {query.data?.truncated && (
            <li className="px-2 py-1 text-xs text-ink-400">
              Showing the first {items.length} linked issues.
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

/** Small colored dot conveying the linked issue's status category — mirrors `LinkedIssuesSection`'s dot. */
function IssueStatusDot({ issue }: { issue: IssueRefDto }) {
  const category = issue.status?.category;
  const colorClass =
    category === 'DONE'
      ? 'bg-emerald-400'
      : category === 'IN_PROGRESS'
        ? 'bg-signal-500'
        : 'bg-ink-300';
  return <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${colorClass}`} />;
}
