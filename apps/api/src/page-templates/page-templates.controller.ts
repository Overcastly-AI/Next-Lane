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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PageTemplatesService } from './page-templates.service';
import {
  CreatePageFromTemplateDto,
  CreatePageTemplateDto,
  UpdatePageTemplateDto,
} from './dto/page-template.dto';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequireScope } from '../auth/require-scope.decorator';

/**
 * Doc templates.
 *
 * PAT SCOPES are `pages:*`, not `projects:*`. A template is page content — it
 * only ever reads and writes pages — so an agent granted `pages:write` can use
 * templates without also being handed project administration. (`IssueTemplate`
 * uses `projects:*` because its payload spans assignees, components and
 * labels; the analogy stops at the name.) `create-page` needs `pages:write`
 * because it does exactly that: writes a page.
 */
@ApiTags('page-templates')
@ApiBearerAuth()
@Controller()
export class PageTemplatesController {
  constructor(private readonly service: PageTemplatesService) {}

  @Get('workspaces/:workspaceId/page-templates')
  @RequireScope('pages:read')
  findAllForWorkspace(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
  ) {
    return this.service.findAllForWorkspace(user.id, workspaceId);
  }

  @Get('projects/:projectId/page-templates')
  @RequireScope('pages:read')
  findAllForProject(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Query('includeInherited') includeInherited?: string,
  ) {
    // Query strings are text: only the literal 'false' opts out, so a missing
    // or malformed value keeps the useful default (merged list) rather than
    // silently hiding the workspace templates.
    return this.service.findAllForProject(
      user.id,
      projectId,
      includeInherited !== 'false',
    );
  }

  @Get('page-templates/:id')
  @RequireScope('pages:read')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findOne(user.id, id);
  }

  @Post('workspaces/:workspaceId/page-templates')
  @RequireScope('pages:write')
  createForWorkspace(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
    @Body() dto: CreatePageTemplateDto,
  ) {
    return this.service.createForWorkspace(user.id, workspaceId, dto);
  }

  @Post('projects/:projectId/page-templates')
  @RequireScope('pages:write')
  createForProject(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: CreatePageTemplateDto,
  ) {
    return this.service.createForProject(user.id, projectId, dto);
  }

  @Patch('page-templates/:id')
  @RequireScope('pages:write')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdatePageTemplateDto,
  ) {
    return this.service.update(user.id, id, dto);
  }

  @Delete('page-templates/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireScope('pages:write')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.id, id);
  }

  @Post('page-templates/:id/create-page')
  @RequireScope('pages:write')
  createPageFromTemplate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreatePageFromTemplateDto,
  ) {
    return this.service.createPageFromTemplate(user.id, id, dto);
  }
}
