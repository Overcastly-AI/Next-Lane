/**
 * BacklinksPanel — Obsidian's signature "Linked references / what links
 * here" panel: every OTHER page whose body links to this one via
 * `[[wiki-link]]`. Read from `GET /pages/:id/backlinks`.
 *
 * Workspace-wide resolution (org-level-docs epic, BACKLOG #12b — `c1b51b8`)
 * means a source page can now live in a DIFFERENT project than the page
 * being viewed, or in the workspace-docs space — `PageBacklinkDto` carries
 * that source page's own scope (`sourceProjectId`/`sourceProjectKey`/
 * `sourceWorkspaceId`) so this panel can both route there correctly
 * (`onOpenPage`, via `pageRefPath`) and label it with a quiet
 * `PageScopeBadge` when — and only when — that scope differs from `scope`
 * (the page currently being viewed).
 */
import { usePageBacklinks } from '@/api/pages';
import type { PagesScope } from '@/api/keys';
import { isDifferentPageScope, type PageScopeRef } from '@/lib/pageRoute';
import { ErrorState, LoadingState } from '@/components/ui/States';
import { PageScopeBadge } from './PageScopeBadge';

export interface BacklinksPanelProps {
  pageId: string;
  /** The scope of the page currently being viewed — see `isDifferentPageScope`. */
  scope: PagesScope;
  onOpenPage: (ref: PageScopeRef) => void;
}

export function BacklinksPanel({ pageId, scope, onOpenPage }: BacklinksPanelProps) {
  const query = usePageBacklinks(pageId);

  return (
    <section
      aria-label="What links here"
      data-testid="page-backlinks-panel"
      className="border-t border-ink-100 px-4 py-4 sm:px-6"
    >
      <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-ink-500">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.5A2.5 2.5 0 0 0 3 8.5v0A2.5 2.5 0 0 0 5.5 11H8m2.5 7h8a2.5 2.5 0 0 0 2.5-2.5v0a2.5 2.5 0 0 0-2.5-2.5H16" />
          <path strokeLinecap="round" strokeLinejoin="round" d="m8 4 3 3-3 3M16 14l-3 3 3 3" />
        </svg>
        What links here
        {query.data && query.data.length > 0 && (
          <span className="rounded-full bg-ink-100 px-1.5 py-0.5 text-[10px] font-semibold text-ink-500">
            {query.data.length}
          </span>
        )}
      </h2>

      {query.isLoading ? (
        <LoadingState label="Loading backlinks…" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : !query.data || query.data.length === 0 ? (
        <p data-testid="page-backlinks-empty" className="text-xs text-ink-400">
          No other pages link here yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {query.data.map((link) => {
            const ref: PageScopeRef = {
              id: link.sourcePageId,
              projectId: link.sourceProjectId,
              workspaceId: link.sourceWorkspaceId,
            };
            const crossScope = isDifferentPageScope(scope, ref);
            return (
              <li key={link.id}>
                <button
                  type="button"
                  onClick={() => onOpenPage(ref)}
                  data-testid={`page-backlink-${link.sourcePageId}`}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink-700 transition-colors duration-[120ms] hover:bg-ink-50 hover:text-signal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-ink-400" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14 3v4a1 1 0 0 0 1 1h4M6 3h6l6 6v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
                  </svg>
                  <span className="min-w-0 flex-1 truncate">{link.sourcePageTitle}</span>
                  {crossScope && (
                    <PageScopeBadge projectId={link.sourceProjectId} projectKey={link.sourceProjectKey} />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
