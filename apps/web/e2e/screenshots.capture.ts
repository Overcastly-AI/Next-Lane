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

test.describe('desktop', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'desktop only');

  test('capture', async ({ page }) => {
    // Login screen first, while logged out.
    await page.goto('/login');
    await shot(page, 'login-desktop');

    await login(page);
    await shot(page, 'home-desktop');

    // Widen the Docs page tree before the Docs shots. At the 240px default the
    // seeded page titles truncate to "Architectur…", which is precisely the
    // problem the resize handle was added to solve — so shooting at the
    // default would document the papercut rather than the product. This is a
    // stored user preference, not a hack.
    await page.evaluate(() => localStorage.setItem('nl_pages_tree_width', '320'));

    const nova = await novaProject(page);

    await page.goto(`/projects/${nova.id}/board`);
    await shot(page, 'board-desktop');

    await page.goto(`/projects/${nova.id}/backlog`);
    await shot(page, 'backlog-desktop');

    // Docs — the two shots the README has had marked as "planned, not yet
    // captured" since the knowledge graph shipped.
    await page.goto(`/projects/${nova.id}/pages`);
    await shot(page, 'pages-desktop');
    await page.goto(`/projects/${nova.id}/pages/graph`);
    // The force layout settles asynchronously, so `settle` is not enough. Then
    // reset the camera: left to its own devices the simulation drifts and the
    // graph sprawls off the bottom of the frame, which photographs as a broken
    // layout rather than a knowledge graph.
    await page.waitForTimeout(3000);
    // Reset restores 100% zoom but does NOT fit the layout to the viewport, so
    // on a graph this size some nodes sit below the fold. Zooming out twice
    // frames the whole thing. (Filed as a UX gap in docs/UI-REVIEW.md — a
    // knowledge graph that opens with nodes off-screen is a real papercut, and
    // having to work around it here is the evidence.)
    await page.getByTestId('page-graph-zoom-reset').click();
    await page.getByTestId('page-graph-zoom-out').click();
    await page.getByTestId('page-graph-zoom-out').click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/pages-graph-desktop.png` });

    // A doc page with an embedded image — the newest Docs capability, and one
    // nothing in the shipped screenshot set showed.
    const pages = (await api(page, `/projects/${nova.id}/pages/tree`)) as {
      id: string;
      title: string;
    }[];
    const runbook = pages.find((p) => p.title === 'Deploy runbook');
    if (runbook) {
      const token = await page.evaluate(() => localStorage.getItem('nl_token'));
      await page.request.post(`${API_URL}/api/pages/${runbook.id}/images`, {
        headers: { Authorization: `Bearer ${token}` },
        multipart: {
          file: {
            name: 'ingestion-lag.png',
            mimeType: 'image/png',
            buffer: sampleChart(),
          },
        },
      });
      const imgs = (await api(page, `/pages/${runbook.id}/images`)) as { id: string }[];
      if (imgs[0]) {
        await page.request.patch(`${API_URL}/api/pages/${runbook.id}`, {
          headers: { Authorization: `Bearer ${token}` },
          data: {
            content:
              '# Deploy runbook\n\n1. Drain the ingestion node.\n2. Roll the pipeline.\n3. Watch the error rate for ten minutes.\n\n' +
              `![Ingestion lag during the last roll](nl-image:${imgs[0].id})\n\n` +
              'Escalation path: [[Incident response]].\n',
          },
        });
      }
      await page.goto(`/projects/${nova.id}/pages/${runbook.id}`);
      // The image resolves through an authorized fetch, so wait for the blob
      // rather than for the markup.
      await expect(
        page.getByTestId('page-content').locator('img[data-nl-image]'),
      ).toHaveAttribute('src', /^blob:/, { timeout: 15_000 });
      await shot(page, 'pages-image-desktop');
    }

    // Dark mode, on the board — the docs site's default theme.
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(`/projects/${nova.id}/board`);
    await shot(page, 'board-dark-desktop');
    await page.emulateMedia({ colorScheme: 'light' });
  });
});

test.describe('mobile', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) >= 1000, 'mobile only');

  test('capture', async ({ page }) => {
    await page.goto('/login');
    await shot(page, 'login-mobile');

    await login(page);
    await shot(page, 'home-mobile');

    const nova = await novaProject(page);
    await page.goto(`/projects/${nova.id}/board`);
    await shot(page, 'board-mobile');

    await page.goto(`/projects/${nova.id}/pages`);
    await shot(page, 'pages-mobile');

    await page.goto(`/projects/${nova.id}/pages/graph`);
    await page.waitForTimeout(3000);
    await page.getByTestId('page-graph-zoom-reset').click();
    await page.getByTestId('page-graph-zoom-out').click();
    await page.getByTestId('page-graph-zoom-out').click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/pages-graph-mobile.png` });

    // Mobile nav drawer open — the shot the README indexes as sidebar-mobile.
    await page.goto(`/projects/${nova.id}/board`);
    await settle(page);
    const navToggle = page.getByRole('button', { name: /open (main )?navigation|menu/i }).first();
    if (await navToggle.isVisible().catch(() => false)) {
      await navToggle.click();
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT}/sidebar-mobile.png` });
    }
  });
});
