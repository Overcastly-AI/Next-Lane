import { Injectable, Logger } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import * as fs from 'fs';
import type { Readable } from 'stream';
import { StorageObjectNotFound, type StorageDriver } from './storage.types';

export interface S3StorageConfig {
  bucket: string;
  region: string;
  /** Custom endpoint for Ceph RGW / MinIO. Omitted = real AWS S3. */
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /**
   * Path-style addressing (`https://host/bucket/key`) instead of virtual-host
   * style (`https://bucket.host/key`).
   */
  forcePathStyle: boolean;
  /** Optional key prefix, so one bucket can host several installs. */
  prefix: string;
}

/**
 * Any S3-compatible object store: **Ceph RADOS Gateway**, MinIO, AWS S3,
 * Cloudflare R2, Wasabi.
 *
 * PATH-STYLE ADDRESSING defaults to ON whenever a custom `endpoint` is set,
 * and that default is load-bearing rather than cosmetic. Virtual-host style
 * needs `bucket.host` to resolve in DNS; a self-hosted Ceph RGW or MinIO is
 * typically reached by a bare hostname or an IP, where `mybucket.10.0.0.5`
 * resolves to nothing and every request fails with a DNS error that looks
 * nothing like a storage misconfiguration. AWS itself still accepts
 * path-style, so defaulting this way is safe for the hosted case too, and it
 * can be turned off explicitly.
 *
 * Credentials are OPTIONAL on purpose: leaving them unset lets the SDK use its
 * normal provider chain, which is how IRSA / IAM roles for service accounts /
 * instance profiles work. Requiring them would force a Kubernetes operator to
 * put long-lived static keys in a Secret when their cluster already has a
 * better mechanism.
 */
@Injectable()
export class S3StorageDriver implements StorageDriver {
  readonly name = 's3' as const;
  private readonly logger = new Logger(S3StorageDriver.name);
  private readonly client: S3Client;

  constructor(private readonly config: S3StorageConfig) {
    this.client = new S3Client({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      forcePathStyle: config.forcePathStyle,
      // WHEN_REQUIRED, not the SDK's WHEN_SUPPORTED default. Left at the
      // default, the SDK sends streaming uploads as `Content-Encoding:
      // aws-chunked` with an `x-amz-checksum-*` trailer. Real AWS parses that;
      // many S3-COMPATIBLE stores (MinIO, several Ceph RGW versions) do not —
      // they store the chunk framing AS THE FILE CONTENT, so every upload is
      // silently corrupted and only shows up when someone opens an attachment.
      //
      // Caught by the s3rver integration test in this directory, which stored
      // literally "8\nprefixed\n0\nx-amz-checksum-crc32:slcoPQ==" instead of
      // "prefixed". Integrity is not lost: TLS covers the wire, and
      // WHEN_REQUIRED still sends checksums for operations that mandate them.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      // Only pass explicit credentials when BOTH halves are present; a partial
      // pair would otherwise shadow the provider chain and fail confusingly.
      ...(config.accessKeyId && config.secretAccessKey
        ? {
            credentials: {
              accessKeyId: config.accessKeyId,
              secretAccessKey: config.secretAccessKey,
            },
          }
        : {}),
    });
    this.logger.log(
      `Object storage: s3 bucket=${config.bucket}` +
        `${config.endpoint ? ` endpoint=${config.endpoint}` : ''}` +
        ` pathStyle=${config.forcePathStyle}`,
    );
  }

  async put(key: string, srcPath: string, contentType: string): Promise<void> {
    // ContentLength is passed explicitly because the body is a stream: without
    // a known length the SDK buffers the whole object in memory to compute one,
    // which for a large attachment is exactly what streaming was avoiding.
    const { size } = fs.statSync(srcPath);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: this.objectKey(key),
        Body: fs.createReadStream(srcPath),
        ContentType: contentType,
        ContentLength: size,
      }),
    );
    try {
      fs.unlinkSync(srcPath);
    } catch {
      // Upload already succeeded; an orphaned temp file is not worth an error.
    }
  }

  async createReadStream(key: string): Promise<Readable> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: this.objectKey(key),
        }),
      );
      if (!res.Body) throw new StorageObjectNotFound(key);
      return res.Body as Readable;
    } catch (err) {
      if (isNotFound(err)) throw new StorageObjectNotFound(key);
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.config.bucket,
          Key: this.objectKey(key),
        }),
      );
    } catch (err) {
      // Mirrors the local driver: cleanup failures never fail the request.
      this.logger.warn(`Could not delete ${key}: ${(err as Error)?.message}`);
    }
  }

  private objectKey(key: string): string {
    return this.config.prefix ? `${this.config.prefix}/${key}` : key;
  }
}

/**
 * S3 signals a missing object as `NoSuchKey`, but a HEAD-style miss and some
 * gateways surface a bare 404 instead, so both are checked.
 */
function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
}
