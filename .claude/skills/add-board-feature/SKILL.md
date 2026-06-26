---
name: add-board-feature
description: Implement or modify the Next Lane kanban/scrum board — columns, drag-and-drop, and fractional-rank ordering across the API and React frontend. Use for any board, drag-drop, card-move, or ordering work.
---

# Board & ordering feature work

Use this for anything touching the board: columns, drag-and-drop, card reordering, or rank math.

## Fractional indexing (the core rule)

Cards are ordered by a `rank` **string**, not an integer position.

- To move a card between neighbors A and B, compute `rank = between(A.rank, B.rank)` and update **only that card's row**.
- Dropping at the start: `between(null, first.rank)`. At the end: `between(last.rank, null)`.
- Use the `fractional-indexing` npm package (`generateKeyBetween`) or the shared rank helper in `packages/shared`. Never renumber all rows.
- Rank is scoped to a context: per (board column) for kanban, per (sprint) or backlog for scrum.

## API side
- A move endpoint accepts `{ issueId, statusId/columnId, beforeId?, afterId? }`, resolves neighbor ranks, computes the new rank, persists, and (later) emits a Socket.io event.
- Validate that neighbors belong to the same board/column.

## Frontend side (dnd-kit)
- Use `DndContext` + `SortableContext` per column.
- On drag end: optimistically update the TanStack Query cache (move the card, set provisional rank), then call the move API. Roll back on error.
- Keep the board responsive; never block the UI on the network round-trip.
- Subscribe to Socket.io board events and reconcile remote moves into the cache.

## Verify
- Move within a column, across columns, to the top, and to the bottom.
- Two quick consecutive moves shouldn't collide (ranks stay strictly ordered).
- `pnpm build` passes for both api and web.
