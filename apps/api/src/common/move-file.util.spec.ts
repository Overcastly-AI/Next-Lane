import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { moveUploadedFile } from './move-file.util';

/**
 * `/dev/shm` is a tmpfs — a genuinely DIFFERENT filesystem from `os.tmpdir()`
 * on Linux. That makes it a real cross-device move, which is the whole point:
 * a mocked `fs` would happily "prove" a fix that still fails on a real volume,
 * which is precisely how this bug survived into production images.
 *
 * Skipped where /dev/shm isn't a distinct device (macOS, some CI sandboxes) so
 * the suite stays portable; the same-device cases below still run everywhere.
 */
const SHM = '/dev/shm';
function shmIsSeparateDevice(): boolean {
  try {
    if (!fs.existsSync(SHM)) return false;
    return fs.statSync(SHM).dev !== fs.statSync(os.tmpdir()).dev;
  } catch {
    return false;
  }
}

describe('moveUploadedFile', () => {
  const made: string[] = [];

  function tmpFile(dir: string, name: string, content = 'PNGDATA'): string {
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, name);
    fs.writeFileSync(p, content);
    made.push(p);
    return p;
  }

  afterEach(() => {
    for (const p of made.splice(0)) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* already gone */
      }
    }
  });

  it('moves within the same filesystem', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-move-'));
    const src = tmpFile(dir, 'src');
    const dest = path.join(dir, 'dest');
    made.push(dest);

    moveUploadedFile(src, dest);

    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.readFileSync(dest, 'utf8')).toBe('PNGDATA');
    expect(fs.existsSync(src)).toBe(false);
  });

  const maybe = shmIsSeparateDevice() ? it : it.skip;

  maybe('moves ACROSS filesystems — the case that 500s in Docker and K8s', () => {
    // Reproduces the real deployment topology: multer's temp dir on one device,
    // UPLOADS_DIR (a named volume / PVC) on another. A bare fs.renameSync here
    // throws EXDEV, which used to surface as an unhandled 500 on every logo and
    // attachment upload in any containerised deployment.
    const destDir = fs.mkdtempSync(path.join(SHM, 'nl-move-'));
    const src = tmpFile(os.tmpdir(), `nl-move-src-${process.pid}`);
    const dest = path.join(destDir, 'dest');
    made.push(dest);

    // Guard: assert the premise, so this test can never silently degrade into
    // a same-device move that proves nothing.
    expect(fs.statSync(path.dirname(src)).dev).not.toBe(fs.statSync(destDir).dev);
    expect(() => fs.renameSync(src, dest)).toThrow(/EXDEV/);

    moveUploadedFile(src, dest);

    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.readFileSync(dest, 'utf8')).toBe('PNGDATA');
    expect(fs.existsSync(src)).toBe(false);
    fs.rmSync(destDir, { recursive: true, force: true });
  });

  it('propagates non-EXDEV errors instead of masking them', () => {
    // A missing source is a real failure and must not be silently "handled" by
    // the copy fallback.
    expect(() =>
      moveUploadedFile(
        path.join(os.tmpdir(), 'nl-move-does-not-exist'),
        path.join(os.tmpdir(), 'nl-move-never-written'),
      ),
    ).toThrow(/ENOENT/);
  });
});
