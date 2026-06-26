import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SearchQueryDto {
  /** Free-text query. Matched (case-insensitive contains) against issue title,
   *  description, and key (e.g. "NL-12"), plus project name/key. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  /** Optional: restrict the search to a single project the caller can access. */
  @IsOptional()
  @IsString()
  projectId?: string;
}
