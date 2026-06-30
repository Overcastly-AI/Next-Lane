import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { diskStorage } from 'multer';
import * as os from 'os';
import * as crypto from 'crypto';
import type { Request, Response } from 'express';
import { WorkspacesService, LOGO_MAX_BYTES } from './workspaces.service';
import { CreateWorkspaceDto, AddMemberDto, UpdateWorkspaceDto } from './dto/workspace.dto';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';

/** Extract the caller's IP for audit logging (proxy-safe: prefer X-Forwarded-For). */
function extractIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress ?? null;
}

/** Multer config for logo uploads: temp dir + UUID filename. */
const logoMulterOptions = {
  storage: diskStorage({
    destination: os.tmpdir(),
    filename: (_req: Express.Request, _file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
      cb(null, `nl-logo-${crypto.randomUUID()}`);
    },
  }),
  limits: { fileSize: LOGO_MAX_BYTES },
};

@ApiTags('workspaces')
@ApiBearerAuth()
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.workspaces.findAll(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateWorkspaceDto) {
    return this.workspaces.create(user.id, dto);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.workspaces.findOne(user.id, id);
  }

  /** PATCH /workspaces/:id — update name and/or brandColor. Admin-only. */
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateWorkspaceDto,
  ) {
    return this.workspaces.update(user.id, id, dto);
  }

  /** DELETE /workspaces/:id — permanently delete a workspace. Admin-only. */
  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.workspaces.remove(user.id, id);
  }

  @Get(':id/members')
  members(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.workspaces.members(user.id, id);
  }

  @Post(':id/members')
  addMember(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AddMemberDto,
    @Req() req: Request,
  ) {
    return this.workspaces.addMember(user.id, id, dto, extractIp(req));
  }

  @Delete(':id/members/:membershipId')
  removeMember(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Param('membershipId') membershipId: string,
    @Req() req: Request,
  ) {
    return this.workspaces.removeMember(user.id, workspaceId, membershipId, extractIp(req));
  }

  // ── Logo endpoints ──────────────────────────────────────────────────────────

  /**
   * POST /workspaces/:id/logo — upload a workspace logo image. Admin-only.
   * Accepts multipart/form-data with a `file` field (png/jpeg/webp, max 2 MB).
   */
  @Post(':id/logo')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', logoMulterOptions))
  uploadLogo(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.workspaces.uploadLogo(user.id, id, file);
  }

  /**
   * DELETE /workspaces/:id/logo — remove the workspace logo. Admin-only.
   */
  @Delete(':id/logo')
  deleteLogo(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.workspaces.deleteLogo(user.id, id);
  }

  /**
   * GET /workspaces/:id/logo — stream the logo image. PUBLIC (no JWT required).
   *
   * This endpoint is unauthenticated so that a plain <img src> tag in the
   * browser can load the workspace logo without needing a bearer token. Logo
   * images are low-sensitivity branding assets — they contain no user data.
   *
   * The @Public() decorator causes the global JwtAuthGuard to skip auth for
   * this route. Note: @CurrentUser() is NOT used here because the guard does
   * not populate req.user for public routes.
   */
  @Public()
  @Get(':id/logo')
  async serveLogo(@Param('id') id: string, @Res() res: Response) {
    const { filePath, mimeType } = await this.workspaces.resolveLogo(id);

    res.setHeader('Content-Type', mimeType);
    // Public branding asset: allow shared caches (CDN/proxy) to cache for 5
    // minutes; allow clients to cache for 1 hour.
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=300');
    res.sendFile(filePath, { root: '/' });
  }
}
