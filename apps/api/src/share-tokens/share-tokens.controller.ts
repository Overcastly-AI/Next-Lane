import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  HttpCode,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ShareTokensService } from './share-tokens.service';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';

@ApiTags('share-tokens')
@ApiBearerAuth()
@Controller('projects/:projectId/share-tokens')
export class ShareTokensController {
  constructor(private readonly shareTokens: ShareTokensService) {}

  /**
   * Mint a new public share link for this project (ADMIN only).
   *
   * Returns the raw `nls_...` token exactly once — caller must copy it.
   * Only the SHA-256 hash is persisted.
   */
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
  ) {
    return this.shareTokens.create(user.id, projectId);
  }

  /**
   * List all share tokens for this project (ADMIN only).
   *
   * Includes revoked tokens so the admin can see what links have been issued.
   */
  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
  ) {
    return this.shareTokens.findAll(user.id, projectId);
  }

  /**
   * Revoke a share token by id (ADMIN only).
   *
   * Once revoked, the public board link immediately becomes inaccessible.
   */
  @Delete(':tokenId')
  @HttpCode(200)
  revoke(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('tokenId') tokenId: string,
  ) {
    return this.shareTokens.revoke(user.id, projectId, tokenId);
  }
}
