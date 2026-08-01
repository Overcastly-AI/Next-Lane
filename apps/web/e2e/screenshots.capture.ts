import { test, expect, type Page } from '@playwright/test';
import * as zlib from 'node:zlib';
import { API_URL } from './helpers';

/**
 * Product screenshot capture — NOT part of the test suite.
 *
 * Named `.capture.ts` rather than `.spec.ts` so `testMatch` never picks it up:
 * it asserts almost nothing, takes a minute, and depends on a dressed dataset.
 * It exists because reshooting used to be a manual afternoon, which is exactly
 * why `docs/screenshots/` drifted two design passes behind the product.
 *
 * Usage (see `docs/screenshots/README.md`):
 *   DATABASE_URL=... npx tsx apps/api/prisma/seed-screenshots.ts
 *   cd apps/web && PW_NO_WEBSERVER=1 npx playwright test \
 *     --config=playwright.screenshots.config.ts
 *
 * Everything is captured at 1440x900 @2x (desktop) or 393x852 @2x (mobile) to
 * match the existing set; the config supplies the viewport and DPR.
 */

const OUT = process.env.SHOT_DIR ?? '/tmp/nl-shots';

/**
 * A small, legible PNG standing in for a dashboard screenshot inside a doc
 * page. Generated rather than committed so the repo carries no binary fixture
 * whose provenance nobody remembers.
 */
function sampleChart(): Buffer {
  const W = 760;
  const H = 260;
  const raw = Buffer.alloc((W * 3 + 1) * H);
  let o = 0;
  for (let y = 0; y < H; y++) {
    raw[o++] = 0;
    for (let x = 0; x < W; x++) {
      const t = x / W;
      const u = y / H;
      const band = y > H * 0.62 && y < H * 0.66 ? 45 : 0;
      raw[o++] = Math.round(16 + t * 22 + band);
      raw[o++] = Math.round(104 + t * 62 - u * 38 + band);
      raw[o++] = Math.round(116 + t * 72 - u * 18 + band);
    }
  }
  let table: number[] | null = null;
  const crc32 = (buf: Buffer): number => {
    if (!table) {
      table = [];
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
      }
    }
    let c = 0xffffffff;
    for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const LOGIN = { email: 'maya@nova.dev', password: 'nextlane' };

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(LOGIN.email);
  await page.getByLabel(/password/i).fill(LOGIN.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
}

async function api(page: Page, path: string): Promise<unknown> {
  const token = await page.evaluate(() => localStorage.getItem('nl_token'));
  const res = await page.request.get(`${API_URL}/api${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

/**
 * Screenshots must not catch a skeleton or a half-run animation. Waiting on
 * `networkidle` alone is not enough — it is a no-op on an already-loaded
 * document (see `trackApiWrites` in helpers.ts for the full explanation) — so
 * settle on the absence of loading affordances plus a paint tick.
 */
async function settle(page: Page): Promise<void> {
  await expect(page.locator('[data-loading], .animate-pulse')).toHaveCount(0, {
    timeout: 15_000,
  });
  await page.waitForTimeout(400);
}

async function shot(page: Page, name: string): Promise<void> {
  await settle(page);
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

/**
 * The dressed project, looked up by key so ids aren't hard-coded.
 *
 * `GET /projects` is workspace-scoped and 500s without `workspaceId`, so the
 * workspace has to be resolved first.
 */
async function novaProject(page: Page): Promise<{ id: string }> {
  const workspaces = (await api(page, '/workspaces')) as { id: string; slug: string }[];
  const ws = (Array.isArray(workspaces) ? workspaces : []).find((w) => w.slug === 'nova');
  if (!ws) throw new Error('Nova workspace not found — run seed-screenshots.ts first');
  const projects = (await api(page, `/projects?workspaceId=${ws.id}`)) as {
    id: string;
    key: string;
  }[];
  const nova = (Array.isArray(projects) ? projects : []).find((p) => p.key === 'NOVA');
  if (!nova) throw new Error('NOVA project not found — run seed-screenshots.ts first');
  return nova;
}

/**
 * Theme suffix. Light shots keep their historical filenames so every existing
 * doc reference keeps resolving; dark ones get `-dark`. The one exception is
 * `board-dark-desktop.png`, which predates this script and is referenced by
 * name from the README and the docs-site hero — it is emitted under that name
 * rather than renamed, because breaking a published og:image to tidy a
 * filename is a bad trade.
 */
function name(base: string, dark: boolean): string {
  if (!dark) return base;
  if (base === 'board-desktop') return 'board-dark-desktop';
  return `${base}-dark`;
}

/**
 * Force the app's theme rather than only the media query. The theme toggle
 * writes an explicit preference, and an explicit preference beats
 * `prefers-color-scheme` — so emulating the media alone leaves a previously
 * toggled session on the wrong theme.
 */
async function setTheme(page: Page, dark: boolean): Promise<void> {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  // `nl.theme` + a `.dark` class on <html> — see `src/lib/theme.ts`. Set both:
  // the class makes the CURRENT page correct without a reload, the stored
  // preference makes every subsequent navigation correct.
  await page.evaluate((d) => {
    localStorage.setItem('nl.theme', d ? 'dark' : 'light');
    document.documentElement.classList.toggle('dark', d);
  }, dark);
}

/**
 * The knowledge graph needs its own routine only because the force layout
 * settles asynchronously — `settle` is not enough, so wait for it.
 *
 * This used to also click zoom-out three times, because the graph opened with
 * nodes outside the frame and "reset" restored 100% zoom without reframing.
 * That workaround was the evidence for the gap; the graph now fits itself to
 * the content on settle, so a plain wait is all that's left.
 */
async function captureGraph(page: Page, url: string, file: string): Promise<void> {
  await page.goto(url);
  await page.waitForTimeout(4000);
  await page.getByTestId('page-graph-zoom-reset').click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/${file}.png` });
}

/**
 * Put a real image into the Deploy runbook page and return its id.
 *
 * Done through the API rather than in the seed because an image is not just a
 * row: the bytes have to go through the storage driver, which is the whole
 * point of the feature being documented.
 */
async function seedPageImage(page: Page, projectId: string): Promise<string | null> {
  const pages = (await api(page, `/projects/${projectId}/pages/tree`)) as {
    id: string;
    title: string;
    children?: { id: string; title: string }[];
  }[];
  const flat: { id: string; title: string }[] = [];
  const walk = (ns: { id: string; title: string; children?: never[] }[]) => {
    for (const n of ns) {
      flat.push({ id: n.id, title: n.title });
      if (Array.isArray(n.children)) walk(n.children);
    }
  };
  walk(pages as never);
  const runbook = flat.find((p) => p.title === 'Deploy runbook');
  if (!runbook) return null;

  const token = await page.evaluate(() => localStorage.getItem('nl_token'));
  const up = await page.request.post(`${API_URL}/api/pages/${runbook.id}/images`, {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      file: { name: 'ingestion-lag.png', mimeType: 'image/png', buffer: sampleChart() },
    },
  });
  if (!up.ok()) return null;
  const imgs = (await api(page, `/pages/${runbook.id}/images`)) as { id: string }[];
  if (!imgs[0]) return null;

  await page.request.patch(`${API_URL}/api/pages/${runbook.id}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      content:
        '# Deploy runbook\n\n1. Drain the ingestion node.\n2. Roll the pipeline.\n' +
        '3. Watch the error rate for ten minutes.\n\n' +
        `![Ingestion lag during the last roll](nl-image:${imgs[0].id})\n\n` +
        'See also: [[Runbooks]], [[Rollback procedure]].\n',
    },
  });
  return runbook.id;
}

test.describe('desktop', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'desktop only');

  test('capture', async ({ page }) => {
    await page.goto('/login');
    await login(page);

    // Widen the Docs page tree before the Docs shots. At the 240px default the
    // seeded page titles truncate to "Architectur…", which is precisely the
    // problem the resize handle was added to solve — so shooting at the
    // default would document the papercut rather than the product. This is a
    // stored user preference, not a hack.
    await page.evaluate(() => localStorage.setItem('nl_pages_tree_width', '320'));

    const nova = await novaProject(page);
    const runbookId = await seedPageImage(page, nova.id);

    for (const dark of [false, true]) {
      await setTheme(page, dark);

      await page.goto('/login-preview-noop', { waitUntil: 'commit' }).catch(() => {});
      await page.goto(`/projects/${nova.id}/board`);
      await shot(page, name('board-desktop', dark));

      await page.goto(`/projects/${nova.id}/backlog`);
      await shot(page, name('backlog-desktop', dark));

      await page.goto('/');
      await shot(page, name('home-desktop', dark));

      await page.goto(`/projects/${nova.id}/pages`);
      await shot(page, name('pages-desktop', dark));

      if (runbookId) {
        await page.goto(`/projects/${nova.id}/pages/${runbookId}`);
        await expect(
          page.getByTestId('page-content').locator('img[data-nl-image]'),
        ).toHaveAttribute('src', /^blob:/, { timeout: 15_000 });
        await shot(page, name('pages-image-desktop', dark));
      }

      await captureGraph(page, `/projects/${nova.id}/pages/graph`, name('pages-graph-desktop', dark));
    }

    // The login screen, both themes — captured last because it logs out.
    for (const dark of [false, true]) {
      await page.goto('/');
      await setTheme(page, dark);
      await page.evaluate(() => localStorage.removeItem('nl_token'));
      await page.goto('/login');
      await setTheme(page, dark);
      await shot(page, name('login-desktop', dark));
    }
  });
});

test.describe('mobile', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) >= 1000, 'mobile only');

  test('capture', async ({ page }) => {
    await page.goto('/login');
    await login(page);
    const nova = await novaProject(page);

    for (const dark of [false, true]) {
      await setTheme(page, dark);

      await page.goto('/');
      await shot(page, name('home-mobile', dark));

      await page.goto(`/projects/${nova.id}/board`);
      await shot(page, name('board-mobile', dark));

      await page.goto(`/projects/${nova.id}/pages`);
      await shot(page, name('pages-mobile', dark));

      await captureGraph(page, `/projects/${nova.id}/pages/graph`, name('pages-graph-mobile', dark));

      // Nav drawer open.
      await page.goto(`/projects/${nova.id}/board`);
      await settle(page);
      const navToggle = page
        .getByRole('button', { name: /open (main )?navigation|menu/i })
        .first();
      if (await navToggle.isVisible().catch(() => false)) {
        await navToggle.click();
        await page.waitForTimeout(600);
        await page.screenshot({ path: `${OUT}/${name('sidebar-mobile', dark)}.png` });
      }
    }

    for (const dark of [false, true]) {
      await page.goto('/');
      await setTheme(page, dark);
      await page.evaluate(() => localStorage.removeItem('nl_token'));
      await page.goto('/login');
      await setTheme(page, dark);
      await shot(page, name('login-mobile', dark));
    }
  });
});
