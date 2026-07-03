import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Body for `PUT /projects/:projectId/gitlab`. */
export class UpsertGitlabIntegrationDto {
  /**
   * GitLab "namespace/project" path — may include nested subgroups
   * (e.g. "group/subgroup/project"), unlike GitHub's flat "owner/repo".
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  @Matches(/^[\w.-]+(\/[\w.-]+)+$/, {
    message:
      'Project path must be in "namespace/project" format, e.g. acme/widgets or acme/team/widgets',
  })
  projectPath!: string;

  /**
   * The GitLab instance origin. Optional — defaults to `https://gitlab.com`
   * server-side so SaaS users don't have to type anything; self-hosted
   * GitLab users set their instance's URL here.
   */
  @IsOptional()
  @IsString()
  @IsUrl({ require_tld: false, require_protocol: true }, { message: 'GitLab URL must be a valid http(s) URL' })
  @MaxLength(300)
  gitlabBaseUrl?: string;

  /** The raw GitLab PAT. Write-only — never echoed back. */
  @IsString()
  @IsNotEmpty()
  @MinLength(4)
  @MaxLength(500)
  token!: string;
}
