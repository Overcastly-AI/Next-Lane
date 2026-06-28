import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IssueLinksService } from './issue-links.service';
import { CreateIssueLinkDto } from './dto/create-issue-link.dto';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequireScope } from '../auth/require-scope.decorator';

@ApiTags('issue-links')
@ApiBearerAuth()
@Controller()
export class IssueLinksController {
  constructor(private readonly issueLinks: IssueLinksService) {}

  /**
   * POST /issues/:id/links
   * Create a typed link from issue :id to a target issue.
   * Caller must be MEMBER+ on the project.
   */
  @Post('issues/:id/links')
  @RequireScope('issues:write')
  create(
    @CurrentUser() user: AuthUser,
    @Param('id') issueId: string,
    @Body() dto: CreateIssueLinkDto,
  ) {
    return this.issueLinks.create(user.id, issueId, dto);
  }

  /**
   * GET /issues/:id/links
   * List all links for issue :id, resolved from its perspective.
   * Caller must be VIEWER+ on the project.
   */
  @Get('issues/:id/links')
  @RequireScope('issues:read')
  findAll(
    @CurrentUser() user: AuthUser,
    @Param('id') issueId: string,
  ) {
    return this.issueLinks.findAll(user.id, issueId);
  }

  /**
   * DELETE /issue-links/:linkId
   * Delete a specific link by id.
   * Caller must be MEMBER+ on the project that owns the link.
   */
  @Delete('issue-links/:linkId')
  @RequireScope('issues:write')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('linkId') linkId: string,
  ) {
    return this.issueLinks.remove(user.id, linkId);
  }
}
