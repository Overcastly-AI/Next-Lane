import { IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** Body for `PUT /projects/:projectId/github`. */
export class UpsertGithubIntegrationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @Matches(/^[\w.-]+\/[\w.-]+$/, {
    message: 'repoFullName must be in "owner/repo" format',
  })
  repoFullName!: string;

  /** The raw GitHub PAT (or fine-grained token). Write-only — never echoed back. */
  @IsString()
  @IsNotEmpty()
  @MinLength(4)
  @MaxLength(500)
  token!: string;
}
