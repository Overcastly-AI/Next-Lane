/**
 * csp-artifact.spec.ts — CSP/Docker-artifact fidelity check for the theme
 * bootstrap (P1-1, Pass 12 engineering audit).
 *
 * Every other spec in this suite runs against `vite preview` (see
 * playwright.config.ts), which serves NO Content-Security-Policy header at
 * all — so a regression where the theme-init bootstrap goes back to being an
 * inline <script> (silently blocked by the real nginx.conf's strict
 * `script-src 'self'`, no `unsafe-inline`/nonce/hash) would pass every other
 * e2e test while being broken in every real self-hosted deployment.
 *
 * This spec closes that gap cheaply, without needing a full Docker/nginx
 * boot: it serves the ACTUAL built `dist/` bundle via a tiny Node static
 * server that sets the SAME Content-Security-Policy header nginx.conf does,
 * then asserts (a) no `script-src` CSP violation fires and (b) the dark
 * theme is applied. `scripts/smoke-web-csp.sh` (mode 3) is the companion
 * static/artifact-level guard that runs against the real Docker image.
 *
 * Requires `pnpm build` to have run first (skips gracefully if `dist/` is
 * absent, e.g. in a fast local iteration loop that hasn't built yet).
 */
import { test, expect } from '@playwright/test';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '..', 'dist');

// Mirrors apps/web/nginx.conf's CSP exactly (same-origin mode: connect-src
// 'self'). script-src is the directive under test — deliberately strict,
// with no 'unsafe-inline'/nonce/hash, matching production.
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'";

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function startStaticServer(): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
      let filePath = path.join(DIST_DIR, urlPath);
      // Basic path-traversal guard — this server only ever serves DIST_DIR.
      if (!filePath.startsWith(DIST_DIR)) {
        res.writeHead(403);
        res.end();
        return;
      }
      if (urlPath === '/' || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        // SPA fallback, mirrors nginx.conf's `try_files $uri $uri/ /index.html`.
        filePath = path.join(DIST_DIR, 'index.html');
      }
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('not found');
          return;
        }
        res.setHeader('Content-Security-Policy', CSP);
        res.setHeader('Content-Type', MIME_TYPES[path.extname(filePath)] ?? 'application/octet-stream');
        res.writeHead(200);
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') resolve({ server, port: addr.port });
      else reject(new Error('static server failed to bind'));
    });
  });
}

test.describe('CSP artifact fidelity — theme bootstrap under real nginx-equivalent headers', () => {
  test.skip(!fs.existsSync(DIST_DIR), 'apps/web/dist not built — run `pnpm build` first');

  test('theme-init.js applies dark mode with zero script-src CSP violations', async ({ browser }) => {
    const { server, port } = await startStaticServer();
    try {
      const context = await browser.newContext();
      // Runs before ANY of the page's own scripts (including theme-init.js),
      // so it reliably captures a violation if the bootstrap regresses back
      // to an inline <script> blocked by the strict script-src above.
      await context.addInitScript(() => {
        (window as unknown as { __cspViolations: unknown[] }).__cspViolations = [];
        document.addEventListener('securitypolicyviolation', (e) => {
          (window as unknown as { __cspViolations: unknown[] }).__cspViolations.push({
            directive: e.violatedDirective,
            blockedURI: e.blockedURI,
          });
        });
        localStorage.setItem('nl.theme', 'dark');
      });

      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });

      const violations = await page.evaluate(
        () => (window as unknown as { __cspViolations: Array<{ directive: string }> }).__cspViolations,
      );
      const scriptSrcViolations = violations.filter((v) => v.directive.includes('script-src'));
      expect(
        scriptSrcViolations,
        `unexpected script-src CSP violation(s) — the theme bootstrap was blocked: ${JSON.stringify(scriptSrcViolations)}`,
      ).toEqual([]);

      const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
      expect(isDark).toBe(true);

      await context.close();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
