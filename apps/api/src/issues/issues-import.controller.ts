/**
 * IssuesImportController
 *
 * POST /projects/:projectId/issues/import
 *
 * Accepts a CSV file as multipart/form-data (field name: "file") OR
 * a JSON body with `{ csv: string, dryRun?: boolean, source?: ImportSource }`.
 *
 * Multipart: mirrors the attachment upload convention already in the codebase
 *   (FileInterceptor from @nestjs/platform-express). The field name is "file".
 *
 * JSON body: set Content-Type: application/json and pass { csv: "<raw csv>" }.
 *   The csv field is read directly from the request body via @Body().
 *
 * Query params:
 *   ?dryRun=true   — validates rows and returns the would-be result without
 *                    writing to the database. Overrides the body flag.
 *   ?source=<src>  — source preset: 'generic' (default), 'jira', 'github',
 *                    or 'linear'. Normalises the tracker's export columns and
 *                    enum values before the generic import pipeline runs.
 *                    Overrides the body field when present.
 *
 * Response: ImportIssuesResultDto
 *   { created: number, skipped: number, errors: { row, message }[], dryRun }
 *
 * Authorization: project MEMBER+ (same as issue create / bulk create).
 * Size limit: 2 MB for the multipart file; 2 MB JSON body (via NestJS global
 * body-size limits). Row cap enforced in the service (2000 rows).
 */

import {
  BadRequestException,
  Body,
  Controller,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { IssuesImportService } from './issues-import.service';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequireScope } from '../auth/require-scope.decorator';
import type { ImportIssuesResultDto } from '@next-lane/shared';
import { isImportSource } from './issues-import.sources';
import type { ImportSource } from './issues-import.sources';

/** 2 MB hard cap on uploaded CSV files. */
const MAX_CSV_BYTES = 2 * 1024 * 1024;

/** Multer options: buffer in memory (CSV is text; no need for disk). */
const multerOptions = {
  storage: memoryStorage(),
  limits: { fileSize: MAX_CSV_BYTES },
};

@ApiTags('issues')
@ApiBearerAuth()
@Controller()
export class IssuesImportController {
  constructor(private readonly importSvc: IssuesImportService) {}

  /**
   * Import issues into a project from a CSV.
   *
   * The endpoint accepts two content types:
   *
   * 1. **multipart/form-data** (preferred):
   *    - Field `file`: the .csv file.
   *    - Optional form field or query param `dryRun=true`.
   *
   * 2. **application/json**:
   *    - Body: `{ csv: string, dryRun?: boolean }`.
   *    - The `file` field is absent; the UploadedFile decorator returns undefined.
   *
   * `?dryRun=true` in the query string overrides the body flag.
   */
  @Post('projects/:projectId/issues/import')
  @RequireScope('issues:write')
  @ApiConsumes('multipart/form-data', 'application/json')
  @UseInterceptors(FileInterceptor('file', multerOptions))
  async importCsv(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Query('dryRun') dryRunQuery: string | undefined,
    @Query('source') sourceQuery: string | undefined,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: { csv?: string; dryRun?: boolean | string; source?: string },
  ): Promise<ImportIssuesResultDto> {
    // Resolve dryRun: query param > body flag.
    const dryRun =
      dryRunQuery === 'true' ||
      body?.dryRun === true ||
      body?.dryRun === 'true';

    // Resolve source: query param > body field > default 'generic'.
    // Validate against the known values; reject unknown ones early.
    const rawSource = sourceQuery ?? body?.source;
    let source: ImportSource = 'generic';
    if (rawSource !== undefined) {
      if (!isImportSource(rawSource)) {
        throw new BadRequestException(
          `Unknown import source: "${rawSource}". Valid values: generic, jira, github, linear`,
        );
      }
      source = rawSource;
    }

    // Resolve the CSV/JSON text: multipart file buffer > json body.
    let csvText: string;
    if (file?.buffer && file.buffer.length > 0) {
      csvText = file.buffer.toString('utf8');
    } else if (typeof body?.csv === 'string' && body.csv.length > 0) {
      // Guard byte size on JSON path (multer handles multipart).
      const byteLen = Buffer.byteLength(body.csv, 'utf8');
      if (byteLen > MAX_CSV_BYTES) {
        throw new BadRequestException(
          `CSV body exceeds the 2 MB size limit (${byteLen} bytes)`,
        );
      }
      csvText = body.csv;
    } else {
      throw new BadRequestException(
        'Provide a CSV file as multipart field "file" or a JSON body with { csv: string }',
      );
    }

    return this.importSvc.importCsv(user.id, projectId, csvText, {
      dryRun,
      source,
    });
  }
}
