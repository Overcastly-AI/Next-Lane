import * as fs from 'fs';

/**
 * Move an uploaded temp file to its final location, across filesystems.
 *
 * `fs.renameSync` is a single `rename(2)` syscall, which CANNOT cross a
 * filesystem boundary — it fails with `EXDEV: cross-device link not permitted`.
 * Every upload in this app crosses one in real deployments:
 *
 *   - multer writes to `os.tmpdir()` → `/tmp`
 *   - `UPLOADS_DIR` is `/app/uploads`, a named volume in docker-compose and a
 *     separate `emptyDir`/PVC in the Helm chart
 *
 * On a dev host both paths live on the same disk, so `rename` succeeds and the
 * bug is invisible. In Docker and Kubernetes it throws on EVERY upload, and the
 * throw was unhandled — a blunt 500 with no indication of the cause. That is
 * exactly how workspace-logo and issue-attachment uploads came to be broken in
 * every containerised deployment while passing locally and in CI.
 *
 * Fix: try the cheap atomic rename first, and fall back to copy + unlink when
 * (and only when) the kernel says the paths are on different devices.
 *
 * The fallback is deliberately `copyFileSync` + `unlinkSync` rather than a
 * stream pipe: these are small, size-capped uploads (4 MB logos, and the
 * attachment cap), the surrounding call sites are already synchronous, and
 * `copyFileSync` uses `copy_file_range`/`sendfile` where available. If the
 * unlink fails the move still SUCCEEDED — the destination is written — so it is
 * swallowed rather than turned into a user-visible error; the worst case is one
 * orphaned temp file that the OS reaps.
 */
export function moveUploadedFile(src: string, dest: string): void {
  try {
    fs.renameSync(src, dest);
    return;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'EXDEV') throw err;
  }

  // Cross-device: copy then remove the source.
  fs.copyFileSync(src, dest);
  try {
    fs.unlinkSync(src);
  } catch {
    // Destination is already written, so the move succeeded. A leftover temp
    // file is not worth failing a user's upload over.
  }
}
