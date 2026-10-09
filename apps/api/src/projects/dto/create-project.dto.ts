import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateProjectDto {
  @IsString()
  workspaceId!: string;

  @IsString()
  @MinLength(2, { message: 'Project key must be 2-10 characters long' })
  @MaxLength(10, { message: 'Project key must be 2-10 characters long' })
  @Matches(/^[A-Za-z][A-Za-z0-9]*$/, {
    message:
      'Project key must start with a letter and contain only letters and numbers (e.g. "NL" or "WEB2")',
  })
  key!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  /**
   * Lock the project to read-only for API tokens (the MCP server and any other
   * agent). Changing it requires ADMIN — see `ProjectsService.update`.
   */
  @IsOptional()
  @IsBoolean()
  agentReadOnly?: boolean;
}
