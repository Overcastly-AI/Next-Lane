import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { diskStorage } from 'multer';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { Response } from 'express';
import { AttachmentsService, DEFAULT_MAX_BYTES } from './attachments.service';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequireScope } from '../auth/require-scope.decorator';

/** Multer configuration: write to OS temp dir under a UUID name.
 * The service moves the file to UPLOADS_DIR once validations pass. */
const multerOptions = {
  storage: diskStorage({
    destination: os.tmpdir(),
    filename: (_req, _file, cb) => {
      cb(null, `nl-upload-${crypto.randomUUID()}`);
    },
  }),
  // Rough size cap at multer level (10 MB default); the service re-validates
  // to apply the env-configurable MAX_FILE_BYTES precisely.
  limits: { fileSize: DEFAULT_MAX_BYTES },
};

@ApiTags('attachments')
@ApiBearerAuth()
@Controller()
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  /** POST /issues/:id/attachments — upload a file to an issue. */
  @Post('issues/:id/attachments')
  @RequireScope('issues:write')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', multerOptions))
  upload(
    @CurrentUser() user: AuthUser,
    @Param('id') issueId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.attachments.upload(user.id, issueId, file);
  }

  /** GET /issues/:id/attachments — list attachment metadata for an issue. */
  @Get('issues/:id/attachments')
  @RequireScope('issues:read')
  list(
    @CurrentUser() user: AuthUser,
    @Param('id') issueId: string,
  ) {
    return this.attachments.list(user.id, issueId);
  }

  /** GET /attachments/:id — stream the file to the client. */
  @Get('attachments/:id')
  @RequireScope('issues:read')
  async download(
    @CurrentUser() user: AuthUser,
    @Param('id') attachmentId: string,
    @Res() res: Response,
  ) {
    const { filePath, attachment } =
      await this.attachments.resolveForDownload(user.id, attachmentId);

    // Sanitize filename for Content-Disposition header: strip control chars
    // and limit to US-ASCII safe characters.
    const safeName = attachment.filename.replace(/[^\x20-\x7E]/g, '_');
    const ext = path.extname(safeName).toLowerCase();
    // For inline-viewable raster images and PDF use inline disposition;
    // everything else (including any legacy SVG that somehow exists in the
    // store) forces a download with a safe Content-Type so the browser can
    // never render it as an active document.
    //
    // SVG is intentionally absent from inlineTypes: if an SVG slipped in
    // before the upload allowlist was tightened, we serve it as
    // application/octet-stream to prevent in-browser script execution.
    const inlineTypes = new Set([
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
    ]);

    // Any SVG (legacy or otherwise) is served as a binary download to prevent
    // in-browser rendering.  All other non-inline types already get
    // Content-Disposition: attachment below.
    const isSvg = attachment.mimeType === 'image/svg+xml';
    const effectiveContentType = isSvg
      ? 'application/octet-stream'
      : attachment.mimeType;

    const disposition = inlineTypes.has(attachment.mimeType) && !isSvg
      ? `inline; filename="${safeName}"`
      : `attachment; filename="${safeName}"`;

    res.setHeader('Content-Type', effectiveContentType);
    res.setHeader('Content-Disposition', disposition);
    res.setHeader('Content-Length', String(attachment.sizeBytes));
    // Allow browsers to cache for a short window; ETag would require hashing
    res.setHeader('Cache-Control', 'private, max-age=300');
    void ext; // suppress unused var
    res.sendFile(filePath, { root: '/' });
  }

  /** DELETE /attachments/:id — remove an attachment (uploader or project admin). */
  @Delete('attachments/:id')
  @RequireScope('issues:write')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id') attachmentId: string,
  ) {
    return this.attachments.remove(user.id, attachmentId);
  }
}
