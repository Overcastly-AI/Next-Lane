import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Logger,
  Param,
  Put,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { GitlabService } from './gitlab.service';
import { UpsertGitlabIntegrationDto } from './dto/upsert-gitlab-integration.dto';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequireScope } from '../auth/require-scope.decorator';
import { Public } from '../auth/public.decorator';

function extractIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress ?? null;
}

@ApiTags('gitlab')
@Controller()
export class GitlabController {
  private readonly logger = new Logger(GitlabController.name);

  constructor(private readonly gitlab: GitlabService) {}

  @ApiBearerAuth()
  @Get('projects/:projectId/gitlab')
  @RequireScope('gitlab:read')
  get(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Req() req: Request,
  ) {
    return this.gitlab.get(user.id, projectId, req);
  }

  @ApiBearerAuth()
  @Put('projects/:projectId/gitlab')
  @RequireScope('gitlab:write')
  upsert(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: UpsertGitlabIntegrationDto,
    @Req() req: Request,
  ) {
    return this.gitlab.upsert(user.id, projectId, dto, req, extractIp(req));
  }

  @ApiBearerAuth()
  @Delete('projects/:projectId/gitlab')
  @RequireScope('gitlab:write')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Req() req: Request,
  ) {
    return this.gitlab.remove(user.id, projectId, extractIp(req));
  }

  @ApiBearerAuth()
  @Get('issues/:issueId/gitlab-links')
  @RequireScope('gitlab:read')
  listIssueLinks(
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
  ) {
    return this.gitlab.listIssueLinks(user.id, issueId);
  }

  /**
   * Inbound GitLab webhook receiver — public (no JWT/PAT auth; GitLab itself
   * calls this endpoint). Authenticity is instead established per-request via
   * the literal `X-Gitlab-Token` header value, compared in constant time
   * against the project's stored `webhookSecret` (GitLab does not sign the
   * payload — see `gitlab-token-verify.util.ts`). Any failure to verify —
   * missing integration, missing header, or a mismatched token — returns 401
   * and the payload is never processed.
   */
  @Public()
  @Post('gitlab/webhook/:projectId')
  @HttpCode(200)
  async webhook(
    @Param('projectId') projectId: string,
    @Headers('x-gitlab-token') token: string | undefined,
    @Headers('x-gitlab-event') eventType: string | undefined,
    @Req() req: Request,
  ) {
    const verification = await this.gitlab.verifyToken(projectId, token);
    if (!verification.ok) {
      // Distinguish "not configured" from "bad token" only in the log
      // (never in the response — no oracle for probing which projects have
      // GitLab configured).
      this.logger.warn(
        `Rejected GitLab webhook for project ${projectId}: token verification failed`,
      );
      throw new UnauthorizedException('Invalid webhook token');
    }

    if (eventType === 'Push Hook') {
      const result = await this.gitlab.handlePushEvent(projectId, req.body);
      return { ok: true, event: eventType, ...result };
    }
    if (eventType === 'Merge Request Hook') {
      const result = await this.gitlab.handleMergeRequestEvent(projectId, req.body);
      return { ok: true, event: eventType, ...result };
    }

    // Any other event type (Tag Push Hook, Note Hook, etc.) — acknowledge
    // without acting.
    return { ok: true, event: eventType ?? 'unknown', linksUpserted: 0 };
  }
}
