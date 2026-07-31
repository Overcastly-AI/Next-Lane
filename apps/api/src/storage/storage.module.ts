import { Global, Module, Logger } from '@nestjs/common';
import { LocalStorageDriver } from './local-storage.driver';
import { S3StorageDriver, type S3StorageConfig } from './s3-storage.driver';
import { STORAGE_DRIVER, type StorageDriver } from './storage.types';

/** `true` for the usual affirmative spellings; everything else false. */
function envBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

/**
 * Build the configured driver from the environment.
 *
 * Misconfiguration THROWS AT BOOT rather than degrading to local disk. A
 * silent fallback is the worst option available here: an operator who set
 * `STORAGE_DRIVER=s3` and fat-fingered the bucket would get a working-looking
 * app that quietly writes uploads to a container-local directory, and only
 * discovers the data was never in the bucket when the pod is replaced and the
 * files are gone. Failing to start is loud, immediate, and recoverable.
 */
export function createStorageDriver(env: NodeJS.ProcessEnv = process.env): StorageDriver {
  const kind = (env.STORAGE_DRIVER ?? 'local').toLowerCase();

  if (kind === 'local') return new LocalStorageDriver();

  if (kind !== 's3') {
    throw new Error(
      `Unknown STORAGE_DRIVER "${env.STORAGE_DRIVER}". Supported values: "local" (default) or "s3".`,
    );
  }

  const bucket = env.S3_BUCKET?.trim();
  if (!bucket) {
    throw new Error('STORAGE_DRIVER=s3 requires S3_BUCKET to be set.');
  }

  const endpoint = env.S3_ENDPOINT?.trim() || undefined;
  const config: S3StorageConfig = {
    bucket,
    // Ceph RGW and MinIO ignore the region but the SDK insists on one, so a
    // default keeps single-host setups from needing a meaningless variable.
    region: env.S3_REGION?.trim() || 'us-east-1',
    endpoint,
    accessKeyId: env.S3_ACCESS_KEY_ID?.trim() || undefined,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY?.trim() || undefined,
    // Default ON when a custom endpoint is set — see the driver's doc comment
    // for why virtual-host style breaks against a bare host or IP.
    forcePathStyle: envBool(env.S3_FORCE_PATH_STYLE, Boolean(endpoint)),
    prefix: (env.S3_PREFIX ?? '').replace(/^\/+|\/+$/g, ''),
  };

  // One credential without the other is always a mistake: it shadows the SDK
  // provider chain (IRSA / instance profile) and then fails on the first
  // request with an auth error that points nowhere near the real cause.
  if (Boolean(config.accessKeyId) !== Boolean(config.secretAccessKey)) {
    throw new Error(
      'S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be set together (or both omitted to use the AWS provider chain, e.g. IRSA).',
    );
  }

  return new S3StorageDriver(config);
}

/**
 * Global so every uploader (attachments, workspace logos, and page images
 * next) resolves the same driver without each module re-importing it.
 */
@Global()
@Module({
  providers: [
    {
      provide: STORAGE_DRIVER,
      useFactory: (): StorageDriver => {
        const driver = createStorageDriver();
        if (driver.name === 'local') {
          new Logger('StorageModule').log('Object storage: local filesystem');
        }
        return driver;
      },
    },
  ],
  exports: [STORAGE_DRIVER],
})
export class StorageModule {}
