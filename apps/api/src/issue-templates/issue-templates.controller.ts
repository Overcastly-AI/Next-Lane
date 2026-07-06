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
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IssueTemplatesService } from './issue-templates.service';
import {
  CreateIssueTemplateDto,
  UpdateIssueTemplateDto,
  CreateIssueFromTemplateDto,
} from './dto/issue-template.dto';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequireScope } from '../auth/require-scope.decorator';

@ApiTags('issue-templates')
@ApiBearerAuth()
@Controller()
export class IssueTemplatesController {
  constructor(private readonly service: IssueTemplatesService) {}

  @Get('projects/:projectId/issue-templates')
  @RequireScope('projects:read')
  findAll(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
  ) {
    return this.service.findAll(user.id, projectId);
  }

  @Post('projects/:projectId/issue-templates')
  @RequireScope('projects:write')
  create(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: CreateIssueTemplateDto,
  ) {
    return this.service.create(user.id, projectId, dto);
  }

  @Patch('issue-templates/:id')
  @RequireScope('projects:write')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateIssueTemplateDto,
  ) {
    return this.service.update(user.id, id, dto);
  }

  @Delete('issue-templates/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireScope('projects:write')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.id, id);
  }

  @Post('issue-templates/:id/create-issue')
  @RequireScope('issues:write')
  createFromTemplate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateIssueFromTemplateDto,
  ) {
    return this.service.createFromTemplate(user.id, id, dto);
  }
}
