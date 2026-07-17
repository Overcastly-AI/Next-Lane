/**
 * OutgoingLinksPanel ("Links out") — the outgoing companion to
 * `BacklinksPanel`: every `[[wiki-link]]` this page's body resolves to,
 * read from `GET /pages/:id/links`. Sits right below Backlinks so the two
 * "what does this page connect to" panels read as one family (same chrome:
 * icon + label + count badge, same row style — mirrors
 * `PageLinkedIssuesSection`'s pairing convention too).
 *
 * Workspace-wide resolution (org-level-docs epic, BACKLOG #12b — `c1b51b8`)
 * means an outgoing link can now resolve to a page in a DIFFERENT project
 * than the one being viewed, or the workspace-docs space —
 * `PageResolvedLinkDto` carries the target's own scope so this panel routes
 * there correctly and labels it with a quiet `PageScopeBadge` when (and
 * only when) that scope differs from the page currently open.
 *
 * A page whose body has zero `[[links]]` renders no empty state here — this
 * panel is entirely absent in that case (see `PagesSurface`), matching the
 * "no clutter on the common case" principle the badge itself follows;
 * `BacklinksPanel` always renders (even empty) because "nothing links here
 * yet" is itself useful information, but "this page links to nothing" is
 * the default state of most pages and isn't worth a permanent fixture.
 */
import { usePageOutgoingLinks } from '@/api/pages';
import type { PagesScope } from '@/api/keys';
import { isDifferentPageScope, type PageScopeRef } from '@/lib/pageRoute';
import { ErrorState, LoadingState } from '@/components/ui/States';
import { PageScopeBadge } from './PageScopeBadge';

export interface OutgoingLinksPanelProps {
  pageId: string;
  /** The scope of the page currently being viewed — see `isDifferentPageScope`. */
  scope: PagesScope;
  onOpenPage: (ref: PageScopeRef) => void;
}

export function OutgoingLinksPanel({ pageId, scope, onOpenPage }: OutgoingLinksPanelProps) {
  const query = usePageOutgoingLinks(pageId);
  const resolved = query.data?.resolved ?? [];

  // Nothing to show and nothing loading/erroring — render nothing at all
  // (see header doc comment for why this differs from BacklinksPanel).
  if (!query.isLoading && !query.isError && resolved.length === 0) return null;

  return (
    <section
      aria-label="Links out"
      data-testid="page-outgoing-links-panel"
      className="border-t border-ink-100 px-4 py-4 sm:px-6"
    >
      <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-ink-500">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6H18a2 2 0 0 1 2 2v7.5M13.5 18H6a2 2 0 0 1-2-2V8.5" />
          <path strokeLinecap="round" strokeLinejoin="round" d="m14 3 4 4-4 4M10 21l-4-4 4-4" />
        </svg>
        Links out
        {resolved.length > 0 && (
          <span className="rounded-full bg-ink-100 px-1.5 py-0.5 text-[10px] font-semibold text-ink-500">
            {resolved.length}
          </span>
        )}
      </h2>

      {query.isLoading ? (
        <LoadingState label="Loading links…" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <ul className="flex flex-col gap-1">
          {resolved.map((link) => {
            const ref: PageScopeRef = {
              id: link.targetPageId,
              projectId: link.targetProjectId,
              workspaceId: link.targetWorkspaceId,
            };
            const crossScope = isDifferentPageScope(scope, ref);
            return (
              <li key={link.targetPageId}>
                <button
                  type="button"
                  onClick={() => onOpenPage(ref)}
                  data-testid={`page-outgoing-link-${link.targetPageId}`}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink-700 transition-colors duration-[120ms] hover:bg-ink-50 hover:text-signal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-ink-400" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14 3v4a1 1 0 0 0 1 1h4M6 3h6l6 6v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
                  </svg>
                  <span className="min-w-0 flex-1 truncate">{link.targetPageTitle}</span>
                  {crossScope && (
                    <PageScopeBadge projectId={link.targetProjectId} projectKey={link.targetProjectKey} />
                  )}
                </button>
              </li>
            );
          })}
          {query.data?.truncated && (
            <li className="px-2 py-1 text-xs text-ink-400">
              Showing the first {resolved.length} links.
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
