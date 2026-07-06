import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { VersionsService } from './versions.service';
import {
  CreateVersionDto,
  UpdateVersionDto,
  SetIssueVersionsDto,
} from './dto/version.dto';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequireScope } from '../auth/require-scope.decorator';

@ApiTags('versions')
@ApiBearerAuth()
@Controller()
export class VersionsController {
  constructor(private readonly versions: VersionsService) {}

  @Get('projects/:projectId/versions')
  @RequireScope('projects:read')
  findAll(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
  ) {
    return this.versions.findAll(user.id, projectId);
  }

  @Post('projects/:projectId/versions')
  @RequireScope('projects:write')
  create(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: CreateVersionDto,
  ) {
    return this.versions.create(user.id, projectId, dto);
  }

  @Patch('versions/:id')
  @RequireScope('projects:write')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateVersionDto,
  ) {
    return this.versions.update(user.id, id, dto);
  }

  @Delete('versions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireScope('projects:write')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.versions.remove(user.id, id);
  }

  /**
   * PUT /issues/:issueId/versions
   *
   * Replace the full set of versions targeting an issue (M:N). Send an empty
   * array to remove all version assignments. All version IDs must belong to
   * the issue's project; any cross-project ID produces a 400.
   *
   * Returns the updated list of version summaries for the issue.
   */
  @Put('issues/:issueId/versions')
  @RequireScope('issues:write')
  setIssueVersions(
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Body() dto: SetIssueVersionsDto,
  ) {
    return this.versions.setIssueVersions(user.id, issueId, dto.versionIds);
  }
}
