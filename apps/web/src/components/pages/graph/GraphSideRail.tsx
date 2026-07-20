/**
 * GraphSideRail — the "focus / orbit" companion panel: selecting a node
 * (click, Enter-traversal, or a search pick) opens this over the canvas
 * with the node's title, its backlinks and outgoing links (reusing the
 * exact same `BacklinksPanel`/`OutgoingLinksPanel` the Document view uses,
 * so scope badges and empty states stay consistent app-wide), and an
 * explicit "Open page" action.
 *
 * Clicking a backlink/outlink here that's ALSO part of the currently loaded
 * graph re-centers the canvas on that node instead of leaving the graph
 * (`onSelectNode`) — clicking one that isn't (e.g. truncated out of a huge
 * graph) falls back to a real navigation (`onOpenPage`), same as the
 * Document view's panels.
 */
import type { PageGraphNode } from '@next-lane/shared';
import type { PagesScope } from '@/api/keys';
import { pageScopeBadgeLabel, type PageScopeRef } from '@/lib/pageRoute';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { BacklinksPanel } from '../BacklinksPanel';
import { OutgoingLinksPanel } from '../OutgoingLinksPanel';
import { isStalePage } from './graphColors';

export interface GraphSideRailProps {
  node: PageGraphNode;
  scope: PagesScope;
  /** Ids present in the currently loaded graph — decides select-in-place vs navigate-away. */
  graphNodeIds: Set<string>;
  onOpenPage: (ref: PageScopeRef) => void;
  onSelectNode: (nodeId: string) => void;
  onClose: () => void;
}

function formatUpdatedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

export function GraphSideRail({ node, scope, graphNodeIds, onOpenPage, onSelectNode, onClose }: GraphSideRailProps) {
  const stale = isStalePage(node.updatedAt);

  function relayOpen(ref: PageScopeRef) {
    if (graphNodeIds.has(ref.id)) onSelectNode(ref.id);
    else onOpenPage(ref);
  }

  return (
    <div
      data-testid="page-graph-rail"
      role="complementary"
      aria-label={`Page details: ${node.title}`}
      className="nl-drawer-animate absolute inset-y-0 right-0 z-20 flex w-full flex-col border-l border-ink-200 bg-surface shadow-modal sm:max-w-[22rem]"
    >
      <div className="flex shrink-0 items-start justify-between gap-2 border-b border-ink-100 px-4 py-3.5">
        <div className="min-w-0">
          <h2 data-testid="page-graph-rail-title" className="truncate text-sm font-semibold text-ink-900">
            {node.title}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge>{pageScopeBadgeLabel({ projectId: node.projectId, projectKey: node.projectKey })}</Badge>
            <span
              data-testid="page-graph-rail-updated"
              className={stale ? 'text-[11px] font-medium text-amber-600' : 'text-[11px] text-ink-400'}
              title={stale ? 'Not edited in over 30 days' : undefined}
            >
              Updated {formatUpdatedAt(node.updatedAt)}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close page details"
          data-testid="page-graph-rail-close"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-400 hover:bg-ink-100 hover:text-ink-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path strokeLinecap="round" d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>

      <div className="shrink-0 px-4 py-3">
        <Button
          size="sm"
          className="w-full"
          data-testid="page-graph-rail-open"
          onClick={() => onOpenPage({ id: node.id, projectId: node.projectId, workspaceId: scope.kind === 'workspace' ? scope.id : '' })}
        >
          Open page
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 6l6 6-6 6" />
          </svg>
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto nl-scroll">
        <BacklinksPanel pageId={node.id} scope={scope} onOpenPage={relayOpen} />
        <OutgoingLinksPanel pageId={node.id} scope={scope} onOpenPage={relayOpen} />
      </div>
    </div>
  );
}
