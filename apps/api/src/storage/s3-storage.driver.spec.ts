import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const S3rver = require('s3rver');
import { S3StorageDriver } from './s3-storage.driver';
import { StorageObjectNotFound } from './storage.types';

/**
 * Exercises the S3 driver against a REAL S3-compatible server speaking the
 * real wire protocol (s3rver, in-process — no Docker required, so this runs in
 * CI as well as locally).
 *
 * Mocking the AWS SDK here would test almost nothing worth testing: the parts
 * that actually break in a self-hosted deployment are protocol-level —
 * path-style addressing, how a missing key is reported, whether a streamed
 * body needs an explicit ContentLength. A mock asserts only that we called the
 * functions we chose to call. This is the same lesson as the upload EXDEV bug
 * and the Kustomize namespace: the artifact that ships has to be the artifact
 * that was tested.
 *
 * s3rver only supports PATH-STYLE addressing, which is also the default this
 * driver picks for any custom endpoint — so the configuration under test is
 * the one a Ceph RGW / MinIO user actually gets.
 */
describe('S3StorageDriver (real S3 protocol via s3rver)', () => {
  const BUCKET = 'next-lane-test';
  let server: { close: (cb: () => void) => void };
  let port: number;
  let dataDir: string;
  let tmpDir: string;
  let driver: S3StorageDriver;

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-s3rver-'));
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-s3src-'));
    await new Promise<void>((resolve, reject) => {
      const s = new S3rver({
        port: 0,
        address: '127.0.0.1',
        silent: true,
        directory: dataDir,
        configureBuckets: [{ name: BUCKET, configs: [] }],
      });
      s.run((err: Error | null, addr: { port: number }) => {
        if (err) return reject(err);
        server = s;
        port = addr.port;
        resolve();
      });
    });

    driver = new S3StorageDriver({
      bucket: BUCKET,
      region: 'us-east-1',
      endpoint: `http://127.0.0.1:${port}`,
      accessKeyId: 'S3RVER',
      secretAccessKey: 'S3RVER',
      forcePathStyle: true,
      prefix: '',
    });
  }, 30_000);

  afterAll(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()));
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function srcFile(name: string, content: string): string {
    const p = path.join(tmpDir, name);
    fs.writeFileSync(p, content);
    return p;
  }

  async function read(stream: NodeJS.ReadableStream): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.from(c as Buffer));
    return Buffer.concat(chunks).toString();
  }

  it('round-trips an object: put then read back the same bytes', async () => {
    const src = srcFile('a.txt', 'hello object storage');
    await driver.put('key-a.txt', src, 'text/plain');
    expect(await read(await driver.createReadStream('key-a.txt'))).toBe(
      'hello object storage',
    );
  });

  it('removes the temp source file after a successful put', async () => {
    // The temp file is multer's; leaving it behind would slowly fill the
    // container's tmp volume across every upload.
    const src = srcFile('b.txt', 'x');
    await driver.put('key-b.txt', src, 'text/plain');
    expect(fs.existsSync(src)).toBe(false);
  });

  it('stores binary content byte-identically', async () => {
    // A 1x1 PNG — the exact shape of a workspace logo, and the case where a
    // text-mode assumption anywhere in the chain would corrupt the bytes.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const src = path.join(tmpDir, 'logo.png');
    fs.writeFileSync(src, png);

    await driver.put('key-logo.png', src, 'image/png');
    const chunks: Buffer[] = [];
    for await (const c of await driver.createReadStream('key-logo.png')) {
      chunks.push(Buffer.from(c as Buffer));
    }
    expect(Buffer.concat(chunks).equals(png)).toBe(true);
  });

  it('maps a missing key to StorageObjectNotFound, not a raw SDK error', async () => {
    // Callers turn this into a 404; anything else becomes a 500.
    await expect(driver.createReadStream('does-not-exist')).rejects.toBeInstanceOf(
      StorageObjectNotFound,
    );
  });

  it('deletes an object', async () => {
    const src = srcFile('c.txt', 'bye');
    await driver.put('key-c.txt', src, 'text/plain');
    await driver.delete('key-c.txt');
    await expect(driver.createReadStream('key-c.txt')).rejects.toBeInstanceOf(
      StorageObjectNotFound,
    );
  });

  it('never throws when deleting something that is already gone', async () => {
    // Every delete call site is cleaning up after an already-committed DB
    // write, so a failure here must not surface to the user.
    await expect(driver.delete('never-existed')).resolves.toBeUndefined();
  });

  it('applies the key prefix so one bucket can host several installs', async () => {
    const prefixed = new S3StorageDriver({
      bucket: BUCKET,
      region: 'us-east-1',
      endpoint: `http://127.0.0.1:${port}`,
      accessKeyId: 'S3RVER',
      secretAccessKey: 'S3RVER',
      forcePathStyle: true,
      prefix: 'inst1',
    });
    await prefixed.put('shared.txt', srcFile('d.txt', 'prefixed'), 'text/plain');

    // Readable through the prefixed driver...
    expect(await read(await prefixed.createReadStream('shared.txt'))).toBe('prefixed');
    // ...and invisible to an unprefixed one, which is the isolation guarantee.
    await expect(driver.createReadStream('shared.txt')).rejects.toBeInstanceOf(
      StorageObjectNotFound,
    );
  });
});
