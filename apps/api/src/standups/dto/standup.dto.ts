import {
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
} from 'class-validator';

/**
 * Body for POST /projects/:projectId/standups.
 * Upserts the caller's standup entry for (userId, projectId, date).
 * All fields except blockerIssueIds are optional text.
 */
export class UpsertStandupDto {
  /**
   * Calendar day for the standup in YYYY-MM-DD format.
   * Defaults to server-local today when omitted.
   */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date must be a valid date string in YYYY-MM-DD format',
  })
  date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  yesterday?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  today?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  blockers?: string;

  /**
   * Issue IDs to link as blocker references.
   * Each ID must belong to the same project (validated in the service).
   * Replaces all existing blocker links for this entry.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  blockerIssueIds?: string[];
}

/**
 * Query params for GET /projects/:projectId/standups and
 * GET /projects/:projectId/standups/me.
 * `date` must be YYYY-MM-DD; defaults to server-local today when absent.
 */
export class StandupDateQueryDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date must be a valid date string in YYYY-MM-DD format',
  })
  date?: string;
}
