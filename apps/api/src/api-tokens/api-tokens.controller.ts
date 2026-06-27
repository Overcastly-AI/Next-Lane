import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  HttpCode,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiTokensService } from './api-tokens.service';
import { CreateApiTokenDto } from './dto/api-token.dto';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';

@ApiTags('api-tokens')
@ApiBearerAuth()
@Controller('me/tokens')
export class ApiTokensController {
  constructor(private readonly apiTokens: ApiTokensService) {}

  /**
   * Create a new personal API token.
   *
   * Returns the raw `nlp_...` token exactly once in the response body.
   * The raw value is never stored — only a SHA-256 hash is persisted.
   * The caller must copy the token immediately; it cannot be retrieved again.
   */
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateApiTokenDto) {
    return this.apiTokens.create(user.id, dto);
  }

  /**
   * List all API tokens for the current user.
   *
   * Returns token metadata only — never the raw token or its hash.
   * Includes revoked and expired tokens so the user can manage their history.
   */
  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.apiTokens.findAll(user.id);
  }

  /**
   * Revoke a personal API token by id.
   *
   * Soft-delete: sets revokedAt so subsequent auth attempts with the token
   * are rejected. A user can only revoke their own tokens — attempting to
   * revoke another user's token returns 404.
   */
  @Delete(':id')
  @HttpCode(200)
  revoke(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.apiTokens.revoke(user.id, id);
  }
}
