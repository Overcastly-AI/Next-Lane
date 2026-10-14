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
import { API_URL, createIssue, createProject, createWorkspace, registerNewUser } from './helpers';
import { editorMarkdown, editorSurface, typeInEditor } from './editor';

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

/**
 * `proxyApi` mirrors nginx's same-origin mode (apps/web/docker-entrypoint.sh):
 * `/api/*` is forwarded to the API so the built SPA is fully usable under the
 * strict `connect-src 'self'` above.
 */
function startStaticServer(proxyApi = false): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
      if (proxyApi && urlPath === '/config.js') {
        // What docker-entrypoint.sh writes in same-origin mode: API on this origin.
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        res.writeHead(200);
        res.end('window.__NL_CONFIG__ = { apiUrl: "" };');
        return;
      }
      if (proxyApi && (urlPath.startsWith('/api/') || urlPath === '/health')) {
        const target = new URL(API_URL);
        // The test origin is a random port the API's CORS allow-list has never
        // heard of; nginx would forward a same-origin request untouched, so drop
        // the browser's Origin here instead of widening the API's allow-list.
        const { origin: _origin, referer: _referer, ...forwarded } = req.headers;
        void _origin;
        void _referer;
        const upstream = http.request(
          {
            host: target.hostname,
            port: target.port,
            method: req.method,
            path: req.url,
            headers: { ...forwarded, host: target.host },
          },
          (up) => {
            res.writeHead(up.statusCode ?? 502, up.headers);
            up.pipe(res);
          },
        );
        upstream.on('error', () => {
          res.writeHead(502);
          res.end('bad gateway');
        });
        req.pipe(upstream);
        return;
      }
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

  test('the rich editor works under the production CSP (lazy chunk, no inline <style>, no violations)', async ({
    browser,
    request,
  }) => {
    const { server, port } = await startStaticServer(true);
    try {
      const user = await registerNewUser(request, 'csp-editor');
      const ws = await createWorkspace(request, user.token);
      const project = await createProject(request, user.token, ws, { name: 'CSP editor' });
      const issue = await createIssue(request, user.token, project.id, { title: 'CSP editor issue' });

      const context = await browser.newContext();
      await context.addInitScript(() => {
        (window as unknown as { __cspViolations: unknown[] }).__cspViolations = [];
        document.addEventListener('securitypolicyviolation', (e) => {
          (window as unknown as { __cspViolations: unknown[] }).__cspViolations.push({
            directive: e.violatedDirective,
            blockedURI: e.blockedURI,
          });
        });
      });
      const page = await context.newPage();
      const origin = `http://127.0.0.1:${port}`;
      await page.goto(`${origin}/login`, { waitUntil: 'load' });
      await page.getByLabel(/email/i).fill(user.email);
      await page.getByLabel(/password/i).fill(user.password);
      await page.getByRole('button', { name: /(log ?in|sign ?in)/i }).click();
      await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

      await page.goto(`${origin}/projects/${project.id}/board?issue=${issue.id}`);
      await expect(page.getByTestId('comment-composer')).toBeVisible({ timeout: 20_000 });
      await typeInEditor(page, 'comment-composer', '**bold** `code` [[Page]] ');
      await expect(editorSurface(page, 'comment-composer').locator('strong')).toHaveText('bold');
      await expect(editorSurface(page, 'comment-composer').locator('code')).toHaveText('code');
      expect(await editorMarkdown(page, 'comment-composer')).toBe('**bold** `code` [[Page]]');

      // The editor's CSS comes from the bundle: nothing is injected at runtime.
      expect(await page.locator('style[data-tiptap-style]').count()).toBe(0);

      const violations = await page.evaluate(
        () => (window as unknown as { __cspViolations: Array<{ directive: string; blockedURI: string }> }).__cspViolations,
      );
      expect(violations, `CSP violations while using the editor: ${JSON.stringify(violations)}`).toEqual([]);
      await context.close();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
