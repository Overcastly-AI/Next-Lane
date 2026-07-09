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
