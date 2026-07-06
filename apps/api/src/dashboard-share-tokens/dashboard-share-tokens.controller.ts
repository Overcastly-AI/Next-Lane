import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  HttpCode,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DashboardShareTokensService } from './dashboard-share-tokens.service';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequireScope } from '../auth/require-scope.decorator';

@ApiTags('dashboard-share-tokens')
@ApiBearerAuth()
@Controller('dashboards/:dashboardId/share-tokens')
export class DashboardShareTokensController {
  constructor(private readonly shareTokens: DashboardShareTokensService) {}

  /**
   * Mint a new public share link for this dashboard (ADMIN only).
   *
   * Returns the raw `nls_...` token exactly once — caller must copy it.
   * Only the SHA-256 hash is persisted.
   */
  @Post()
  @RequireScope('projects:write')
  create(
    @CurrentUser() user: AuthUser,
    @Param('dashboardId') dashboardId: string,
  ) {
    return this.shareTokens.create(user.id, dashboardId);
  }

  /**
   * List all share tokens for this dashboard (ADMIN only).
   *
   * Includes revoked tokens so the admin can see what links have been issued.
   */
  @Get()
  @RequireScope('projects:read')
  findAll(
    @CurrentUser() user: AuthUser,
    @Param('dashboardId') dashboardId: string,
  ) {
    return this.shareTokens.findAll(user.id, dashboardId);
  }

  /**
   * Revoke a share token by id (ADMIN only).
   *
   * Once revoked, the public dashboard link immediately becomes inaccessible.
   */
  @Delete(':tokenId')
  @HttpCode(200)
  @RequireScope('projects:write')
  revoke(
    @CurrentUser() user: AuthUser,
    @Param('dashboardId') dashboardId: string,
    @Param('tokenId') tokenId: string,
  ) {
    return this.shareTokens.revoke(user.id, dashboardId, tokenId);
  }
}
