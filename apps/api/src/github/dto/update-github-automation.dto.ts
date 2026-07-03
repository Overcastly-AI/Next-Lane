import { IsBoolean, IsOptional, IsString, ValidateIf } from 'class-validator';

/**
 * Body for `PATCH /projects/:projectId/github/automation`.
 *
 * Deliberately a separate, token-free endpoint from `PUT /projects/:projectId/github`
 * (`UpsertGithubIntegrationDto`) — that route requires re-pasting the PAT on
 * every save (write-only, never echoed back); this toggle is a config-only
 * change and shouldn't force an admin to re-enter the token just to flip a
 * boolean.
 */
export class UpdateGithubAutomationDto {
  @IsBoolean()
  enabled!: boolean;

  /**
   * Target status id. `undefined` = leave the currently-stored value
   * untouched; `null` = explicitly clear it (service layer rejects
   * `enabled: true` with a null/absent-and-unset statusId).
   */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  statusId?: string | null;
}
