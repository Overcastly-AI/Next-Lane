import type { PageTreeNode } from '@next-lane/shared';
import type { MovePageVars } from './pages';

/**
 * Best-effort client-side reorder of the page-tree cache for instant feedback
 * while the server move settles. Pure (no network/DOM) so it lives in its own
 * module and can be unit-tested in isolation — see pages.reorder.test.ts.
 *
 * Handles BOTH shapes the UI can produce:
 *   - a same-level reorder (the up/down affordance), and
 *   - a RE-PARENT (`parentId` supplied), which drag-to-nest produces.
 *
 * Re-parenting is not optional polish here. `useMovePage`'s `onSettled`
 * deliberately does not refetch the tree on success — a refetch landing
 * between two rapid clicks swapped the rows underneath the user and swallowed
 * moves (see the comment there). That makes this function the ONLY thing that
 * updates the tree after a successful move: a case it fails to handle is a
 * move that succeeds on the server and never appears in the UI at all. That
 * is exactly what drag-to-nest did before this handled `parentId`.
 */
export function optimisticallyReorderTree(
  tree: PageTreeNode[],
  vars: MovePageVars,
): PageTreeNode[] {
  const { id, parentId, beforeId, afterId } = vars;

  // `parentId === undefined` means "keep the current parent" (MovePageVars),
  // so only treat this as a re-parent when the key was actually supplied.
  if (parentId !== undefined) {
    const moved = findNode(tree, id);
    if (!moved) return tree;
    if (parentId !== null && subtreeContains(moved, parentId)) {
      // Would detach the subtree from the tree. The UI blocks this and the
      // API rejects it; refusing here too means a bug in either can never
      // produce an unreachable branch in the cache.
      return tree;
    }
    const without = removeNode(tree, id);
    return insertInto(without, parentId, moved, beforeId, afterId);
  }

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

/** Depth-first node lookup. */
function findNode(nodes: PageTreeNode[], id: string): PageTreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = findNode(n.children, id);
    if (hit) return hit;
  }
  return null;
}

/** True when `id` is `node` itself or one of its descendants. */
function subtreeContains(node: PageTreeNode, id: string): boolean {
  if (node.id === id) return true;
  return node.children.some((c) => subtreeContains(c, id));
}

/** The tree with `id` (and its subtree) detached. */
function removeNode(nodes: PageTreeNode[], id: string): PageTreeNode[] {
  return nodes
    .filter((n) => n.id !== id)
    .map((n) => (n.children.length ? { ...n, children: removeNode(n.children, id) } : n));
}

/**
 * Insert `moved` into `parentId`'s children (or the root list when null),
 * positioned by the same `beforeId`/`afterId` convention as a same-level
 * reorder. An unknown neighbour appends, matching the server, which ranks
 * against whatever neighbours it can actually resolve.
 */
function insertInto(
  nodes: PageTreeNode[],
  parentId: string | null,
  moved: PageTreeNode,
  beforeId?: string,
  afterId?: string,
): PageTreeNode[] {
  const place = (siblings: PageTreeNode[]): PageTreeNode[] => {
    const next = siblings.slice();
    if (afterId) {
      const i = next.findIndex((n) => n.id === afterId);
      next.splice(i === -1 ? next.length : i, 0, moved);
    } else if (beforeId) {
      const i = next.findIndex((n) => n.id === beforeId);
      next.splice(i === -1 ? next.length : i + 1, 0, moved);
    } else {
      next.push(moved);
    }
    return next;
  };

  if (parentId === null) return place(nodes);

  return nodes.map((n) => {
    if (n.id === parentId) return { ...n, children: place(n.children) };
    return n.children.length ? { ...n, children: insertInto(n.children, parentId, moved, beforeId, afterId) } : n;
  });
}
