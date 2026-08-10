import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateProjectDto {
  @IsString()
  workspaceId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(10)
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
