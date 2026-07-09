import { IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { IsMaxByteLength } from './is-max-byte-length.decorator';

/**
 * Hard cap on `Page.content` size, enforced at the DTO layer. ~256 KiB — the
 * target `schema-architect` flagged for a longer-form knowledge-base document
 * (4x the 64 KiB `ProjectAgentContext` handoff-note cap).
 */
export const PAGE_CONTENT_MAX_BYTES = 256 * 1024;

/**
 * Characters forbidden in a page title. `[`, `]`, and `|` are the delimiters
 * of the `[[title|alias]]` wiki-link grammar (see `packages/shared/wikilink`)
 * — a title containing any of them can't be encoded as a link target, so a
 * `[[...]]` reference to it would silently fail to parse (no `PageLink` edge,
 * no rendered link). Forbidding them at write time keeps every title
 * linkable, the same constraint Obsidian enforces on note names.
 */
export const PAGE_TITLE_FORBIDDEN_RE = /^[^[\]|]+$/;
export const PAGE_TITLE_FORBIDDEN_MESSAGE =
  'title must not contain the characters [ ] | (they are reserved for [[wiki-links]])';

/** Body for `POST /projects/:projectId/pages`. */
export class CreatePageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  @Matches(PAGE_TITLE_FORBIDDEN_RE, { message: PAGE_TITLE_FORBIDDEN_MESSAGE })
  title!: string;

  /** Markdown body. Omitted defaults to `""`. */
  @IsOptional()
  @IsString()
  @IsMaxByteLength(PAGE_CONTENT_MAX_BYTES, {
    message: `content must not exceed ${Math.floor(PAGE_CONTENT_MAX_BYTES / 1024)} KB (measured in UTF-8 bytes)`,
  })
  content?: string;

  /** Null/omitted = create as a top-level page. */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  parentId?: string | null;
}
