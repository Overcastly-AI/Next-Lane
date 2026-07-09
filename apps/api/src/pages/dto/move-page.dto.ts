import { IsOptional, IsString, ValidateIf } from 'class-validator';

/**
 * Body for `POST /pages/:id/move` — the drag-and-drop-friendly "reorder
 * relative to a sibling" move, mirroring `MoveIssueDto`'s
 * `beforeId`/`afterId` shape for the board. The server computes the new
 * fractional-index `rank` via `rankBetween` (falling back to a one-time
 * sibling rebalance if the neighbors leave no room), so the caller never
 * needs to know the rank encoding.
 *
 * - `parentId` omitted = keep the page's current parent (pure reorder).
 * - `parentId: null` = move to top-level.
 * - `parentId: <id>` = reparent into that page's children.
 * - `beforeId`/`afterId` omitted = append to the end of the destination
 *   sibling list.
 *
 * Rejected (400) if the resulting move would make the page its own ancestor
 * (a cycle) — see `PagesService.assertNoCycle`.
 */
export class MovePageDto {
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  parentId?: string | null;

  @IsOptional()
  @IsString()
  beforeId?: string;

  @IsOptional()
  @IsString()
  afterId?: string;
}
