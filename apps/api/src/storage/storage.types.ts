import type { Readable } from 'stream';

/**
 * Where uploaded blobs (issue attachments, workspace logos) actually live.
 *
 * Two implementations ship: `local` (the default — a directory on disk, the
 * historical behaviour) and `s3` (any S3-compatible endpoint). Deliberately
 * S3-COMPATIBLE rather than vendor-specific, because that one driver covers
 * Ceph RADOS Gateway, MinIO, AWS S3, Cloudflare R2 and Wasabi. Targeting
 * Ceph's native API instead would have bought tighter Ceph integration at the
 * cost of excluding all of those — and would have forced a single-host
 * `docker compose` user to run a Ceph cluster, which contradicts the
 * runs-first-try promise.
 *
 * The interface is intentionally small and blob-shaped: a storage key in, bytes
 * out. No listing, no directories, no metadata beyond content type — anything
 * richer would leak filesystem semantics that S3 doesn't share, and Next Lane
 * keeps all real metadata in Postgres anyway.
 */
export interface StorageDriver {
  /** Human-readable driver name, for logs and the health/config surface. */
  readonly name: 'local' | 's3';

  /**
   * Persist a file that currently exists at `srcPath` (a multer temp file)
   * under `key`, then remove the temp file.
   *
   * Takes a PATH rather than a buffer or stream because every caller already
   * has multer's temp file on disk, and streaming from disk keeps a large
   * attachment from being held in memory.
   */
  put(key: string, srcPath: string, contentType: string): Promise<void>;

  /**
   * Open a read stream for `key`. Throws `StorageObjectNotFound` when the
   * object is missing, so callers can map it to a 404 rather than a 500.
   */
  createReadStream(key: string): Promise<Readable>;

  /**
   * Best-effort delete. Never throws for a missing object: every caller is
   * cleaning up after an already-successful DB write, and failing that path
   * would turn a harmless orphan into a user-visible error.
   */
  delete(key: string): Promise<void>;
}

/** Thrown by `createReadStream` when the key has no object behind it. */
export class StorageObjectNotFound extends Error {
  constructor(key: string) {
    super(`Storage object not found: ${key}`);
    this.name = 'StorageObjectNotFound';
  }
}

/** DI token for the configured driver. */
export const STORAGE_DRIVER = Symbol('STORAGE_DRIVER');
