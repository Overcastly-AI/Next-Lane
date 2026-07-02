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
import { GithubService } from './github.service';
import { UpsertGithubIntegrationDto } from './dto/upsert-github-integration.dto';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequireScope } from '../auth/require-scope.decorator';
import { Public } from '../auth/public.decorator';

function extractIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress ?? null;
}

@ApiTags('github')
@Controller()
export class GithubController {
  private readonly logger = new Logger(GithubController.name);

  constructor(private readonly github: GithubService) {}

  @ApiBearerAuth()
  @Get('projects/:projectId/github')
  @RequireScope('github:read')
  get(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Req() req: Request,
  ) {
    return this.github.get(user.id, projectId, req);
  }

  @ApiBearerAuth()
  @Put('projects/:projectId/github')
  @RequireScope('github:write')
  upsert(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: UpsertGithubIntegrationDto,
    @Req() req: Request,
  ) {
    return this.github.upsert(user.id, projectId, dto, req, extractIp(req));
  }

  @ApiBearerAuth()
  @Delete('projects/:projectId/github')
  @RequireScope('github:write')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Req() req: Request,
  ) {
    return this.github.remove(user.id, projectId, extractIp(req));
  }

  @ApiBearerAuth()
  @Get('issues/:issueId/github-links')
  @RequireScope('github:read')
  listIssueLinks(
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
  ) {
    return this.github.listIssueLinks(user.id, issueId);
  }

  /**
   * Inbound GitHub webhook receiver — public (no JWT/PAT auth; GitHub itself
   * calls this endpoint). Authenticity is instead established per-request via
   * the `X-Hub-Signature-256` HMAC header, verified against the project's
   * stored `webhookSecret` using the RAW request body bytes (see main.ts
   * `rawBody: true`). Any failure to verify — missing integration, missing
   * header, or a mismatched signature — returns 401/404 and the payload is
   * never processed.
   */
  @Public()
  @Post('github/webhook/:projectId')
  @HttpCode(200)
  async webhook(
    @Param('projectId') projectId: string,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Headers('x-github-event') eventType: string | undefined,
    @Req() req: Request & { rawBody?: Buffer },
  ) {
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    const verification = await this.github.verifySignature(projectId, rawBody, signature);
    if (!verification.ok) {
      // Distinguish "not configured" from "bad signature" only in the log
      // (never in the response — no oracle for probing which projects have
      // GitHub configured).
      this.logger.warn(
        `Rejected GitHub webhook for project ${projectId}: signature verification failed`,
      );
      throw new UnauthorizedException('Invalid webhook signature');
    }

    if (eventType === 'push') {
      const result = await this.github.handlePushEvent(projectId, req.body);
      return { ok: true, event: eventType, ...result };
    }
    if (eventType === 'pull_request') {
      const result = await this.github.handlePullRequestEvent(projectId, req.body);
      return { ok: true, event: eventType, ...result };
    }

    // Any other event type (ping, issues, etc.) — acknowledge without acting.
    return { ok: true, event: eventType ?? 'unknown', linksUpserted: 0 };
  }
}
