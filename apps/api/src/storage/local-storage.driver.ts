import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import type { Readable } from 'stream';
import { moveUploadedFile } from '../common/move-file.util';
import { StorageObjectNotFound, type StorageDriver } from './storage.types';

/** Default upload directory; override with UPLOADS_DIR. */
export const DEFAULT_UPLOADS_DIR = './uploads';

export function getUploadsDir(): string {
  return process.env.UPLOADS_DIR ?? DEFAULT_UPLOADS_DIR;
}

/**
 * Files on a local directory — the zero-config default, and what every
 * existing install is already using. Unchanged behaviour: same `UPLOADS_DIR`,
 * same on-disk layout, same storage keys, so switching the code to go through
 * the driver interface is not a migration for anybody.
 */
@Injectable()
export class LocalStorageDriver implements StorageDriver {
  readonly name = 'local' as const;

  async put(key: string, srcPath: string, _contentType: string): Promise<void> {
    const dir = getUploadsDir();
    fs.mkdirSync(dir, { recursive: true });
    // moveUploadedFile, not fs.renameSync: multer's temp dir and UPLOADS_DIR
    // are on different filesystems in every container deployment, and a bare
    // rename throws EXDEV there. See common/move-file.util.ts.
    moveUploadedFile(srcPath, this.resolve(key));
  }

  async createReadStream(key: string): Promise<Readable> {
    const filePath = this.resolve(key);
    if (!fs.existsSync(filePath)) throw new StorageObjectNotFound(key);
    return fs.createReadStream(filePath);
  }

  async delete(key: string): Promise<void> {
    try {
      fs.unlinkSync(this.resolve(key));
    } catch {
      // Already gone, or never written. Not worth surfacing.
    }
  }

  /**
   * Absolute path for a key.
   *
   * `path.resolve` matters: `getUploadsDir()` defaults to the RELATIVE
   * `./uploads`, and serving a relative path depends on the process CWD.
   * `path.basename(key)` is belt-and-braces against a key containing a
   * traversal sequence — keys are server-generated UUIDs today, but this is
   * the one place where a bad key would become a filesystem path.
   */
  private resolve(key: string): string {
    return path.resolve(getUploadsDir(), path.basename(key));
  }
}
