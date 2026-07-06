import {
  IsNotEmpty,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Body for `PUT /projects/:projectId/gitea`. */
export class UpsertGiteaIntegrationDto {
  /**
   * The self-hosted Gitea instance origin. REQUIRED (unlike
   * `UpsertGitlabIntegrationDto.gitlabBaseUrl`, which defaults to
   * gitlab.com — Gitea has no canonical single-tenant SaaS home, so there is
   * no sensible default to fall back to).
   */
  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_tld: false, require_protocol: true }, { message: 'Gitea URL must be a valid http(s) URL' })
  @MaxLength(300)
  giteaBaseUrl!: string;

  /** "owner/repo" — flat path, mirrors GitHub's format. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @Matches(/^[\w.-]+\/[\w.-]+$/, {
    message:
      'Repository must be in "owner/repo" format, e.g. acme/widgets',
  })
  repoFullName!: string;

  /** The raw Gitea access token. Write-only — never echoed back. */
  @IsString()
  @IsNotEmpty()
  @MinLength(4)
  @MaxLength(500)
  token!: string;
}
