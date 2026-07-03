import { IsBoolean, IsOptional, IsString, ValidateIf } from 'class-validator';

/**
 * Body for `PATCH /projects/:projectId/gitlab/automation`. Mirrors
 * `github/dto/update-github-automation.dto.ts` exactly — see that file's
 * header comment for the rationale.
 */
export class UpdateGitlabAutomationDto {
  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  statusId?: string | null;
}
