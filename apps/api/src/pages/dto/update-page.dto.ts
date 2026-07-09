import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { IsMaxByteLength } from './is-max-byte-length.decorator';
import { PAGE_CONTENT_MAX_BYTES } from './create-page.dto';

/**
 * Body for `PATCH /pages/:id`.
 *
 * Changing `title` and/or `content` writes a new `PageVersion` snapshot (see
 * `PagesService.update`) — this is the "edit the document" path. `parentId`
 * changes are validated for same-project membership and rejected if they
 * would create a tree cycle; `rank` (when provided directly, e.g. by an
 * agent/API client that already computed a fractional-index value via
 * `packages/shared/src/rank.ts`) is stored verbatim. For the common
 * drag-and-drop "reorder relative to a sibling" UX, prefer
 * `POST /pages/:id/move` instead, which computes the rank from
 * `beforeId`/`afterId` server-side. Neither `parentId` nor `rank` changes
 * touch version history.
 */
export class UpdatePageDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  title?: string;

  @IsOptional()
  @IsString()
  @IsMaxByteLength(PAGE_CONTENT_MAX_BYTES, {
    message: `content must not exceed ${Math.floor(PAGE_CONTENT_MAX_BYTES / 1024)} KB (measured in UTF-8 bytes)`,
  })
  content?: string;

  /** Null = move to top-level. Validated against the same project + cycles. */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  parentId?: string | null;

  /**
   * Raw fractional-index rank string. Constrained to the fractional-indexing
   * base-62 alphabet (code-review should-fix on 3b03430): an unvalidated
   * value stored here doesn't fail at write time but makes a LATER,
   * unrelated `rankBetween`/`rankAfter` on a sibling throw — one member could
   * otherwise 500 another member's future move. Prefer `POST /pages/:id/move`
   * (server-computed) over setting this directly.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Matches(/^[0-9A-Za-z]+$/, {
    message: 'rank must be a fractional-index string (base-62 alphanumeric)',
  })
  rank?: string;

  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}
