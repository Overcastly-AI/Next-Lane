import { describe, expect, it } from 'vitest';
import type { PageTreeNode } from '@next-lane/shared';
import { optimisticallyReorderTree } from './pages.reorder';

/** Build a flat sibling list of leaf nodes with the given ids. */
function nodes(...ids: string[]): PageTreeNode[] {
  return ids.map((id) => ({
    id,
    title: id,
    archived: false,
    rank: id,
    children: [],
  }));
}

const ids = (tree: PageTreeNode[]): string[] => tree.map((n) => n.id);

/**
 * The tree cache reorder mirrors the server's rankBetween(beforeRank,
 * afterRank): `afterId` is the sibling that should end up immediately AFTER
 * the moved node, `beforeId` the one immediately BEFORE it. These are exactly
 * the args PagesPage.handleMove produces for the up/down affordance — the
 * cases that previously rendered no change or an overshoot.
 */
describe('optimisticallyReorderTree', () => {
  it('moves a node up between two neighbors (beforeId=prevPrev, afterId=prev)', () => {
    // [A,B,C,D] move C up → C swaps with B → [A,C,B,D]
    const result = optimisticallyReorderTree(nodes('A', 'B', 'C', 'D'), {
      id: 'C',
      beforeId: 'A',
      afterId: 'B',
    });
    expect(ids(result)).toEqual(['A', 'C', 'B', 'D']);
  });

  it('moves a node up to the top (no prevPrev, afterId only)', () => {
    // [A,B,C] move B up → [B,A,C]
    const result = optimisticallyReorderTree(nodes('A', 'B', 'C'), {
      id: 'B',
      beforeId: undefined,
      afterId: 'A',
    });
    expect(ids(result)).toEqual(['B', 'A', 'C']);
  });

  it('moves a node down between two neighbors (beforeId=next, afterId=nextNext)', () => {
    // [A,B,C,D] move B down → [A,C,B,D]
    const result = optimisticallyReorderTree(nodes('A', 'B', 'C', 'D'), {
      id: 'B',
      beforeId: 'C',
      afterId: 'D',
    });
    expect(ids(result)).toEqual(['A', 'C', 'B', 'D']);
  });

  it('moves a node down to the last position (no nextNext, beforeId only)', () => {
    // [A,B,C] move B down → [A,C,B]
    const result = optimisticallyReorderTree(nodes('A', 'B', 'C'), {
      id: 'B',
      beforeId: 'C',
      afterId: undefined,
    });
    expect(ids(result)).toEqual(['A', 'C', 'B']);
  });

  it('reorders nested children, leaving other branches untouched', () => {
    const tree: PageTreeNode[] = [
      { id: 'root', title: 'root', archived: false, rank: 'a', children: nodes('X', 'Y', 'Z') },
      { id: 'other', title: 'other', archived: false, rank: 'b', children: nodes('P', 'Q') },
    ];
    // Move Y up within root's children → [Y,X,Z]
    const result = optimisticallyReorderTree(tree, { id: 'Y', beforeId: undefined, afterId: 'X' });
    expect(ids(result[0].children)).toEqual(['Y', 'X', 'Z']);
    expect(ids(result[1].children)).toEqual(['P', 'Q']);
  });

  it('leaves the tree unchanged when the moved id is not found', () => {
    const result = optimisticallyReorderTree(nodes('A', 'B'), {
      id: 'missing',
      beforeId: 'A',
      afterId: 'B',
    });
    expect(ids(result)).toEqual(['A', 'B']);
  });
});

// ---------------------------------------------------------------------------
// Re-parenting (drag-to-nest). These matter more than they look: `useMovePage`
// deliberately does not refetch the tree after a successful move, so this
// function is the ONLY thing that updates the UI. A case it mishandles is a
// move that persists on the server and never appears on screen — which is
// exactly how drag-to-nest first shipped broken.
// ---------------------------------------------------------------------------

describe('optimisticallyReorderTree — re-parenting', () => {
  const flat = (): PageTreeNode[] => [
    nodes('a')[0],
    nodes('b')[0],
    nodes('c')[0],
  ];

  it('moves a node into another node as its last child', () => {
    const out = optimisticallyReorderTree(flat(), { id: 'b', parentId: 'a' });
    expect(out.map((n) => n.id)).toEqual(['a', 'c']);
    expect(out[0].children.map((n) => n.id)).toEqual(['b']);
  });

  it('positions the moved node among existing children via afterId', () => {
    const tree: PageTreeNode[] = [
      { ...nodes('a')[0], children: [nodes('x')[0], nodes('y')[0]] },
      nodes('b')[0],
    ];
    const out = optimisticallyReorderTree(tree, { id: 'b', parentId: 'a', afterId: 'y' });
    expect(out[0].children.map((n) => n.id)).toEqual(['x', 'b', 'y']);
  });

  it('promotes a nested node back to top level with parentId null', () => {
    const tree: PageTreeNode[] = [
      { ...nodes('a')[0], children: [nodes('b')[0]] },
      nodes('c')[0],
    ];
    const out = optimisticallyReorderTree(tree, { id: 'b', parentId: null, afterId: 'c' });
    expect(out.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    expect(out[0].children).toEqual([]);
  });

  it('carries the moved node’s own children with it', () => {
    const tree: PageTreeNode[] = [
      nodes('a')[0],
      { ...nodes('b')[0], children: [nodes('b1')[0]] },
    ];
    const out = optimisticallyReorderTree(tree, { id: 'b', parentId: 'a' });
    expect(out[0].children[0].children.map((n) => n.id)).toEqual(['b1']);
  });

  it('refuses to move a node into its own subtree', () => {
    const tree: PageTreeNode[] = [
      { ...nodes('a')[0], children: [nodes('b')[0]] },
    ];
    // Would detach the whole branch from the tree. Returning it unchanged
    // keeps the cache consistent with the API, which rejects this too.
    const out = optimisticallyReorderTree(tree, { id: 'a', parentId: 'b' });
    expect(out).toEqual(tree);
  });

  it('leaves the tree alone when the node does not exist', () => {
    const tree = flat();
    expect(optimisticallyReorderTree(tree, { id: 'nope', parentId: 'a' })).toEqual(tree);
  });

  it('still treats an omitted parentId as a same-level reorder', () => {
    // `parentId: undefined` means "keep the current parent" — it must NOT be
    // read as "move to root", which would flatten the tree on every up/down.
    const tree: PageTreeNode[] = [
      { ...nodes('a')[0], children: [nodes('x')[0], nodes('y')[0]] },
    ];
    const out = optimisticallyReorderTree(tree, { id: 'y', afterId: 'x' });
    expect(out[0].children.map((n) => n.id)).toEqual(['y', 'x']);
  });
});
