import { createStorageDriver } from './storage.module';
import { LocalStorageDriver } from './local-storage.driver';
import { S3StorageDriver } from './s3-storage.driver';

describe('createStorageDriver', () => {
  it('defaults to local when STORAGE_DRIVER is unset', () => {
    expect(createStorageDriver({})).toBeInstanceOf(LocalStorageDriver);
  });

  it('accepts an explicit local driver, case-insensitively', () => {
    expect(createStorageDriver({ STORAGE_DRIVER: 'LOCAL' })).toBeInstanceOf(
      LocalStorageDriver,
    );
  });

  it('THROWS on an unknown driver rather than silently using local disk', () => {
    // A silent fallback would give an operator a working-looking app that
    // writes uploads to a container-local dir they believe is object storage —
    // discovered only when the pod is replaced and the files are gone.
    expect(() => createStorageDriver({ STORAGE_DRIVER: 'ceph' })).toThrow(
      /Unknown STORAGE_DRIVER "ceph".*"local".*"s3"/s,
    );
  });

  it('requires a bucket for s3', () => {
    expect(() => createStorageDriver({ STORAGE_DRIVER: 's3' })).toThrow(/S3_BUCKET/);
    expect(() =>
      createStorageDriver({ STORAGE_DRIVER: 's3', S3_BUCKET: '   ' }),
    ).toThrow(/S3_BUCKET/);
  });

  it('builds an s3 driver with a bucket alone (AWS provider chain)', () => {
    expect(
      createStorageDriver({ STORAGE_DRIVER: 's3', S3_BUCKET: 'b' }),
    ).toBeInstanceOf(S3StorageDriver);
  });

  it('rejects half a credential pair', () => {
    // Shadows the provider chain and fails later with an auth error that points
    // nowhere near the real cause, so it's rejected up front.
    expect(() =>
      createStorageDriver({
        STORAGE_DRIVER: 's3',
        S3_BUCKET: 'b',
        S3_ACCESS_KEY_ID: 'only-the-id',
      }),
    ).toThrow(/must be set together/);
    expect(() =>
      createStorageDriver({
        STORAGE_DRIVER: 's3',
        S3_BUCKET: 'b',
        S3_SECRET_ACCESS_KEY: 'only-the-secret',
      }),
    ).toThrow(/must be set together/);
  });

  it('accepts a complete credential pair', () => {
    expect(
      createStorageDriver({
        STORAGE_DRIVER: 's3',
        S3_BUCKET: 'b',
        S3_ACCESS_KEY_ID: 'id',
        S3_SECRET_ACCESS_KEY: 'secret',
      }),
    ).toBeInstanceOf(S3StorageDriver);
  });
});

describe('createStorageDriver — path-style addressing', () => {
  // Reaches into the driver's config to assert the resolved value; this
  // default is the difference between "works against Ceph RGW / MinIO" and
  // "every request fails with a DNS error", so it is worth pinning.
  const resolved = (env: NodeJS.ProcessEnv) =>
    (createStorageDriver(env) as unknown as { config: { forcePathStyle: boolean; prefix: string } })
      .config;

  it('defaults ON when a custom endpoint is set (Ceph RGW / MinIO)', () => {
    expect(
      resolved({
        STORAGE_DRIVER: 's3',
        S3_BUCKET: 'b',
        S3_ENDPOINT: 'http://10.0.0.5:7480',
      }).forcePathStyle,
    ).toBe(true);
  });

  it('defaults OFF for real AWS (no endpoint)', () => {
    expect(resolved({ STORAGE_DRIVER: 's3', S3_BUCKET: 'b' }).forcePathStyle).toBe(false);
  });

  it('can be forced off even with an endpoint', () => {
    expect(
      resolved({
        STORAGE_DRIVER: 's3',
        S3_BUCKET: 'b',
        S3_ENDPOINT: 'https://s3.example.com',
        S3_FORCE_PATH_STYLE: 'false',
      }).forcePathStyle,
    ).toBe(false);
  });

  it('normalises a prefix by stripping surrounding slashes', () => {
    // `//team//` would otherwise produce keys like `//team///uuid`, which S3
    // treats as a distinct (and very confusing) key.
    expect(
      resolved({ STORAGE_DRIVER: 's3', S3_BUCKET: 'b', S3_PREFIX: '/team/' }).prefix,
    ).toBe('team');
  });
});
