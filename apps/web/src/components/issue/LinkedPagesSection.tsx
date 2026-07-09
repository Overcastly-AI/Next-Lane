/**
 * LinkedPagesSection ("Linked pages")
 *
 * Rendered in the IssueDetailDrawer main column beside the Development
 * (GitHub/GitLab/Gitea) sections. Lists the knowledge-base pages whose body
 * references this issue's key (e.g. "NL-123") — the reverse of a page's issue
 * cross-links, populated server-side on every page save. Entirely hidden
 * while loading and once loaded when empty (the `GET /issues/:id/pages`
 * endpoint returns `{ items: [] }` when nothing references the issue), so a
 * single "any links?" check covers the common no-links case with no flash.
 *
 * Clicking a page navigates to it (`/projects/:projectId/pages/:pageId`);
 * that route change leaves the board and unmounts the drawer, so no explicit
 * close is needed (and calling the board's `closeIssue` would clobber the
 * navigation by rewriting the board's search params).
 */
import { useNavigate } from 'react-router-dom';
import { useIssuePages } from '@/api/pages';

function PageIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M2 1.75C2 .784 2.784 0 3.75 0h5.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237V14.25A1.75 1.75 0 0 1 12.25 16h-8.5A1.75 1.75 0 0 1 2 14.25V1.75Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 8 4.25V1.5H3.75ZM9.5 1.5v2.75c0 .138.112.25.25.25h2.75L9.5 1.5Z" />
    </svg>
  );
}

export function LinkedPagesSection({
  issueId,
  projectId,
}: {
  issueId: string;
  projectId: string;
}) {
  const navigate = useNavigate();
  const query = useIssuePages(issueId);
  const items = query.data?.items ?? [];

  if (query.isLoading || items.length === 0) return null;

  function openPage(pageId: string) {
    navigate(`/projects/${projectId}/pages/${pageId}`);
  }

  return (
    <section data-testid="linked-pages-section" aria-label="Linked pages">
      <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.08em] text-ink-500">
        Linked pages
      </p>
      <ul className="divide-y divide-ink-100">
        {items.map((page) => (
          <li key={page.id} data-testid="linked-page-row" className="py-1.5">
            <button
              type="button"
              onClick={() => openPage(page.id)}
              className="flex w-full items-center gap-2 rounded text-left text-sm text-ink-700 transition-colors duration-[120ms] hover:text-signal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-300"
            >
              <span className="shrink-0 text-ink-400">
                <PageIcon />
              </span>
              <span className="min-w-0 flex-1 truncate hover:underline">{page.title}</span>
            </button>
          </li>
        ))}
        {query.data?.truncated && (
          <li className="py-1.5 text-xs text-ink-400">Showing the first {items.length} linked pages.</li>
        )}
      </ul>
    </section>
  );
}
