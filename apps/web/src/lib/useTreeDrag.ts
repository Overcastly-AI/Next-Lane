/**
 * Drag-to-reorder / drag-to-nest for the page tree.
 *
 * Uses native HTML5 drag-and-drop rather than dnd-kit (which the board uses)
 * for one reason: the board reorders a flat list, but this has to express
 * THREE outcomes per row — drop above, drop below, or drop INSIDE as a child.
 * With dnd-kit that means hand-rolling nesting collision detection on top of a
 * sortable context; with native DnD the row's own geometry gives it directly,
 * from the pointer's vertical position within the row.
 *
 * The drop zones are deliberately asymmetric: the top and bottom quarters
 * reorder, the middle half nests. Nesting gets the larger target because it is
 * the harder gesture to land and the one with no keyboard equivalent — the
 * up/down buttons already cover reordering, so a missed nest is a real failure
 * while a missed reorder has a fallback.
 *
 * NOT a replacement for those buttons. They stay, and remain the only path
 * that works without a pointer; this is an addition for people who reach for
 * drag first. See `PageTree`'s header comment.
 */
import { useCallback, useRef, useState } from 'react';
import type { PageTreeNode } from '@next-lane/shared';

export type DropPosition = 'before' | 'after' | 'inside';

export interface DropTarget {
  id: string;
  position: DropPosition;
}

/** Every descendant id of `nodeId`, inclusive — the set a node may not move into. */
export function subtreeIds(tree: PageTreeNode[], nodeId: string): Set<string> {
  const out = new Set<string>();
  const collect = (n: PageTreeNode) => {
    out.add(n.id);
    n.children.forEach(collect);
  };
  const find = (nodes: PageTreeNode[]): PageTreeNode | null => {
    for (const n of nodes) {
      if (n.id === nodeId) return n;
      const hit = find(n.children);
      if (hit) return hit;
    }
    return null;
  };
  const node = find(tree);
  if (node) collect(node);
  return out;
}

/** Which third of the row the pointer is in. */
function positionWithin(rect: DOMRect, clientY: number): DropPosition {
  const offset = (clientY - rect.top) / rect.height;
  if (offset < 0.25) return 'before';
  if (offset > 0.75) return 'after';
  return 'inside';
}

export interface TreeDrag {
  draggingId: string | null;
  dropTarget: DropTarget | null;
  /** Props to spread onto each row. */
  rowProps: (nodeId: string) => {
    draggable: boolean;
    onDragStart: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
    onDragEnd: () => void;
  };
}

export function useTreeDrag(
  tree: PageTreeNode[],
  enabled: boolean,
  onMove: (dragId: string, targetId: string, position: DropPosition) => void,
): TreeDrag {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  // The handlers read the dragged id from a REF, not from state.
  // `dragstart` -> `dragover` can happen within a single tick, and React state
  // set in the former is not yet readable in the latter — so a state-gated
  // `onDragOver` skips its `preventDefault()`, and without that the browser
  // refuses the drop entirely and the gesture does nothing. State is kept
  // alongside purely so the row can render as dragging.
  const draggingRef = useRef<string | null>(null);
  // Same reasoning for the resolved drop target: `drop` fires immediately
  // after the last `dragover`, so reading it from state can lose the final
  // position and land the node in the wrong place.
  const dropRef = useRef<DropTarget | null>(null);
  // The ids the dragged node may NOT land on: itself and its descendants.
  // Computed once at drag start rather than per dragover — this runs on every
  // pointer move, and re-walking the tree there was measurable on a deep one.
  const forbidden = useRef<Set<string>>(new Set());

  const reset = useCallback(() => {
    draggingRef.current = null;
    dropRef.current = null;
    setDraggingId(null);
    setDropTarget(null);
    forbidden.current = new Set();
  }, []);

  const rowProps = useCallback(
    (nodeId: string) => ({
      draggable: enabled,
      onDragStart: (e: React.DragEvent) => {
        if (!enabled) return;
        e.stopPropagation();
        draggingRef.current = nodeId;
        setDraggingId(nodeId);
        forbidden.current = subtreeIds(tree, nodeId);
        // Required for Firefox to start a drag at all, and it makes the page
        // title the drag payload for anything else listening.
        e.dataTransfer.effectAllowed = 'move';
        try {
          e.dataTransfer.setData('text/plain', nodeId);
        } catch {
          // Some browsers throw on setData outside a real user gesture.
        }
      },
      onDragOver: (e: React.DragEvent) => {
        if (!enabled || !draggingRef.current) return;
        // Dropping a node into its own subtree would detach that subtree from
        // the tree entirely — the API rejects it, but showing an indicator for
        // a move that cannot happen is a worse answer than showing none.
        if (forbidden.current.has(nodeId)) {
          dropRef.current = null;
          setDropTarget(null);
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const position = positionWithin(rect, e.clientY);
        dropRef.current = { id: nodeId, position };
        setDropTarget((prev) =>
          prev?.id === nodeId && prev.position === position ? prev : { id: nodeId, position },
        );
      },
      onDragLeave: (e: React.DragEvent) => {
        // Only clear when leaving the row itself; moving between a row's own
        // children fires dragleave too and would flicker the indicator off.
        if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) return;
        if (dropRef.current?.id === nodeId) dropRef.current = null;
        setDropTarget((prev) => (prev?.id === nodeId ? null : prev));
      },
      onDrop: (e: React.DragEvent) => {
        if (!enabled || !draggingRef.current) return;
        e.preventDefault();
        e.stopPropagation();
        const target = dropRef.current;
        const dragged = draggingRef.current;
        reset();
        if (!target || target.id === dragged) return;
        onMove(dragged, target.id, target.position);
      },
      onDragEnd: reset,
    }),
    // Deliberately does NOT depend on `draggingId`/`dropTarget`: the handlers
    // read the refs, so re-creating them on every dragover would churn props
    // on every row for no behavioural gain.
    [enabled, tree, onMove, reset],
  );

  return { draggingId, dropTarget, rowProps };
}
