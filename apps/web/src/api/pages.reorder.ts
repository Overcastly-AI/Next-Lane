import type { PageTreeNode } from '@next-lane/shared';
import type { MovePageVars } from './pages';

/**
 * Best-effort client-side reorder of the page-tree cache for instant feedback
 * while the server move settles. Pure (no network/DOM) so it lives in its own
 * module and can be unit-tested in isolation — see pages.reorder.test.ts.
 *
 * Only handles the common case: a same-level swap with an adjacent sibling
 * (what the up/down affordance produces). Reparenting or cross-branch drops
 * fall through unchanged until the server settles (still correct, just a
 * one-frame delay instead of instant).
 */
export function optimisticallyReorderTree(
  tree: PageTreeNode[],
  { id, beforeId, afterId }: MovePageVars,
): PageTreeNode[] {
  function reorderSiblings(nodes: PageTreeNode[]): PageTreeNode[] {
    const idx = nodes.findIndex((n) => n.id === id);
    if (idx === -1) {
      return nodes.map((n) =>
        n.children.length ? { ...n, children: reorderSiblings(n.children) } : n,
      );
    }
    const next = nodes.slice();
    const [moved] = next.splice(idx, 1);
    // `afterId` = the sibling that should end up immediately AFTER the moved
    // node, so insert moved just BEFORE it (at its index). `beforeId` = the
    // sibling that should end up immediately BEFORE the moved node, so insert
    // moved just AFTER it (at its index + 1). These mirror the server's
    // rankBetween(beforeRank, afterRank). When a neighbor isn't found (e.g. a
    // cross-branch edge), append — the server settle will correct it.
    if (afterId) {
      const afterIdx = next.findIndex((n) => n.id === afterId);
      next.splice(afterIdx === -1 ? next.length : afterIdx, 0, moved);
    } else if (beforeId) {
      const beforeIdx = next.findIndex((n) => n.id === beforeId);
      next.splice(beforeIdx === -1 ? next.length : beforeIdx + 1, 0, moved);
    } else {
      next.push(moved);
    }
    return next;
  }
  return reorderSiblings(tree);
}
