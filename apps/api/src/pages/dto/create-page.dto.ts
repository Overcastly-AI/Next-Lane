import { IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { IsMaxByteLength } from './is-max-byte-length.decorator';

/**
 * Hard cap on `Page.content` size, enforced at the DTO layer. ~256 KiB — the
 * target `schema-architect` flagged for a longer-form knowledge-base document
 * (4x the 64 KiB `ProjectAgentContext` handoff-note cap).
 */
export const PAGE_CONTENT_MAX_BYTES = 256 * 1024;

/** Body for `POST /projects/:projectId/pages`. */
export class CreatePageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
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
