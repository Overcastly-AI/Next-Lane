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
import { GiteaService } from './gitea.service';
import { UpsertGiteaIntegrationDto } from './dto/upsert-gitea-integration.dto';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequireScope } from '../auth/require-scope.decorator';
import { Public } from '../auth/public.decorator';

function extractIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress ?? null;
}

@ApiTags('gitea')
@Controller()
export class GiteaController {
  private readonly logger = new Logger(GiteaController.name);

  constructor(private readonly gitea: GiteaService) {}

  @ApiBearerAuth()
  @Get('projects/:projectId/gitea')
  @RequireScope('gitea:read')
  get(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Req() req: Request,
  ) {
    return this.gitea.get(user.id, projectId, req);
  }

  @ApiBearerAuth()
  @Put('projects/:projectId/gitea')
  @RequireScope('gitea:write')
  upsert(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: UpsertGiteaIntegrationDto,
    @Req() req: Request,
  ) {
    return this.gitea.upsert(user.id, projectId, dto, req, extractIp(req));
  }

  @ApiBearerAuth()
  @Delete('projects/:projectId/gitea')
  @RequireScope('gitea:write')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Req() req: Request,
  ) {
    return this.gitea.remove(user.id, projectId, extractIp(req));
  }

  @ApiBearerAuth()
  @Get('issues/:issueId/gitea-links')
  @RequireScope('gitea:read')
  listIssueLinks(
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
  ) {
    return this.gitea.listIssueLinks(user.id, issueId);
  }

  /**
   * Inbound Gitea webhook receiver — public (no JWT/PAT auth; Gitea itself
   * calls this endpoint). Authenticity is instead established per-request via
   * the `X-Gitea-Signature` HMAC-SHA256 header (hex-encoded, no "sha256="
   * prefix — see `gitea-signature.util.ts`), verified against the project's
   * stored `webhookSecret` using the RAW request body bytes (see main.ts
   * `rawBody: true`, already enabled globally). Any failure to verify —
   * missing integration, missing header, or a mismatched signature — returns
   * 401 and the payload is never processed.
   */
  @Public()
  @Post('gitea/webhook/:projectId')
  @HttpCode(200)
  async webhook(
    @Param('projectId') projectId: string,
    @Headers('x-gitea-signature') signature: string | undefined,
    @Headers('x-gitea-event') eventType: string | undefined,
    @Req() req: Request & { rawBody?: Buffer },
  ) {
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    const verification = await this.gitea.verifySignature(projectId, rawBody, signature);
    if (!verification.ok) {
      // Distinguish "not configured" from "bad signature" only in the log
      // (never in the response — no oracle for probing which projects have
      // Gitea configured).
      this.logger.warn(
        `Rejected Gitea webhook for project ${projectId}: signature verification failed`,
      );
      throw new UnauthorizedException('Invalid webhook signature');
    }

    if (eventType === 'push') {
      const result = await this.gitea.handlePushEvent(projectId, req.body);
      return { ok: true, event: eventType, ...result };
    }
    if (eventType === 'pull_request') {
      const result = await this.gitea.handlePullRequestEvent(projectId, req.body);
      return { ok: true, event: eventType, ...result };
    }

    // Any other event type (repository, issues, etc.) — acknowledge without acting.
    return { ok: true, event: eventType ?? 'unknown', linksUpserted: 0 };
  }
}
