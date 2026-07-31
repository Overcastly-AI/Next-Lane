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
import * as crypto from 'crypto';
import * as os from 'os';
import { Response } from 'express';
import { PAGE_IMAGE_MAX_BYTES, PageImagesService } from './page-images.service';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequireScope } from '../auth/require-scope.decorator';

/**
 * Multer writes to the OS temp dir under a UUID name; the storage driver moves
 * the bytes out once validation passes. Same shape as attachments — the temp
 * hop is what lets the magic-byte check run before anything is persisted.
 */
const multerOptions = {
  storage: diskStorage({
    destination: os.tmpdir(),
    filename: (_req, _file, cb) => {
      cb(null, `nl-page-image-${crypto.randomUUID()}`);
    },
  }),
  limits: { fileSize: PAGE_IMAGE_MAX_BYTES },
};

@ApiTags('page-images')
@ApiBearerAuth()
@Controller()
export class PageImagesController {
  constructor(private readonly images: PageImagesService) {}

  /** POST /pages/:id/images — upload an image into a page's body. */
  @Post('pages/:id/images')
  @RequireScope('pages:write')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', multerOptions))
  upload(
    @CurrentUser() user: AuthUser,
    @Param('id') pageId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.images.upload(user.id, pageId, file);
  }

  /** GET /pages/:id/images — metadata for every image on a page. */
  @Get('pages/:id/images')
  @RequireScope('pages:read')
  list(@CurrentUser() user: AuthUser, @Param('id') pageId: string) {
    return this.images.list(user.id, pageId);
  }

  /**
   * GET /page-images/:id — stream the bytes.
   *
   * Authenticated like every other read: the renderer fetches this WITH the
   * caller's bearer token and swaps the result in as a `blob:` URL, which is
   * why an embedded image is exactly as private as the page holding it.
   */
  @Get('page-images/:id')
  @RequireScope('pages:read')
  async download(
    @CurrentUser() user: AuthUser,
    @Param('id') imageId: string,
    @Res() res: Response,
  ) {
    const { stream, image } = await this.images.resolveForDownload(
      user.id,
      imageId,
    );

    const safeName = image.filename.replace(/[^\x20-\x7E]/g, '_');
    // The upload allowlist is raster-only (no SVG), and the magic-byte check
    // proves the bytes match the declared type, so inline is safe here without
    // the attachments controller's SVG special-case.
    res.setHeader('Content-Type', image.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
    res.setHeader('Content-Length', String(image.sizeBytes));
    // Images are immutable once uploaded — a new upload gets a new id — so
    // this can be cached hard. `private` because the bytes are authorized.
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    // Belt and braces: a stored image is never an active document, but a
    // sniffed Content-Type could make one out of a crafted file.
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // A stream that dies after headers are flushed can no longer become an
    // error response, so destroy the socket rather than hang the client.
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }

  /** DELETE /page-images/:id — remove an image and its stored bytes. */
  @Delete('page-images/:id')
  @RequireScope('pages:write')
  remove(@CurrentUser() user: AuthUser, @Param('id') imageId: string) {
    return this.images.remove(user.id, imageId);
  }
}
