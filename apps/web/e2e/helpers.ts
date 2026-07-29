import { Page, Locator, expect, type APIRequestContext } from '@playwright/test';

export const DEMO = { email: 'demo@nextlane.dev', password: 'nextlane' };

/** API origin for direct setup calls (the NestJS backend, not the web preview). */
export const API_URL = process.env.PW_API_URL ?? 'http://localhost:4000';

/** Log in through the UI and land on the dashboard. */
export async function login(page: Page, creds = DEMO): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(creds.email);
  await page.getByLabel(/password/i).fill(creds.password);
  await page.getByRole('button', { name: /(log ?in|sign ?in)/i }).click();
  // Dashboard shows projects; wait for navigation away from /login.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
}

/**
 * Navigate to a primary section (My Work / My Board / Insights / …) via
 * whichever nav surface currently renders it.
 *
 * The same link text can legitimately exist in more than one DOM location at
 * once — the header nav (visible only at md–lg widths), the persistent
 * left sidebar (visible at lg+), and the mobile drawer (only while open) —
 * with all but one hidden via CSS at any given viewport. This is
 * viewport-generic on purpose: it does not special-case "desktop" vs
 * "mobile", it just clicks whichever matching link is actually visible, so
 * it keeps working regardless of which surface owns the link at a given
 * breakpoint. Falls back to the user-menu dropdown (true mobile, <768px)
 * where the primary links are duplicated as buttons instead of links.
 */
export async function gotoSection(
  page: Page,
  name: RegExp | string,
): Promise<void> {
  // Poll rather than a single snapshot: right after login/registration the
  // sidebar's workspace-dependent sections mount asynchronously (workspace
  // list fetch, first-run default-workspace creation), so the visible
  // candidate can appear a beat after the header nav's own (hidden) copy
  // is already in the DOM. `expect.poll` retries until one is visible or
  // the timeout elapses, instead of taking one point-in-time snapshot.
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const candidates = await page.getByRole('link', { name }).all();
    for (const link of candidates) {
      if (await link.isVisible().catch(() => false)) {
        await link.click();
        return;
      }
    }
    await page.waitForTimeout(150);
  }
  // Mobile: the links live inside the user menu as buttons.
  await page.getByTestId('user-menu-button').click();
  await page.getByRole('button', { name }).first().click();
}

/** Open the seeded "Next Lane" (NL) project board.
 *
 * READ-ONLY callers only: this lands on the SHARED demo project. Any spec that
 * CREATES / EDITS / DELETES data must use `setupIsolatedProject` instead so it
 * never pollutes the live demo or collides with parallel specs. */
export async function openDemoBoard(page: Page): Promise<void> {
  await login(page);
  // The project card is a <button> containing the project name; click it
  // (distinct from the brand logo, which is not a button).
  const projectCard = page.getByRole('button', { name: /next lane/i }).first();
  await projectCard.click();
  await expect(page).toHaveURL(/\/board/, { timeout: 15_000 });
  // Columns from seeded statuses
  await expect(page.getByText(/to do/i).first()).toBeVisible();
}

// ---------------------------------------------------------------------------
// Isolated-tenant fixtures
//
// Every mutating spec gets its OWN freshly-registered user + workspace +
// project so writes never touch the seeded demo (NL) project. Setup happens via
// the API (fast, deterministic), then the UI is driven against that project's
// board at /projects/:id/board.
// ---------------------------------------------------------------------------

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/** Globally-unique suffix for emails / project keys across parallel workers. */
function uniqueSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

/** Log in via the API and return the bearer token. */
export async function loginToken(
  request: APIRequestContext,
  creds = DEMO,
): Promise<string> {
  const res = await request.post(`${API_URL}/api/auth/login`, {
    data: { email: creds.email, password: creds.password },
  });
  expect(res.ok(), `login failed: ${res.status()}`).toBeTruthy();
  return ((await res.json()) as { accessToken: string }).accessToken;
}

export interface RegisteredUser {
  email: string;
  password: string;
  name: string;
  token: string;
  userId: string;
}

/** Register a brand-new user (own workspace on signup) with a unique email. */
export async function registerNewUser(
  request: APIRequestContext,
  label = 'qa',
): Promise<RegisteredUser> {
  const email = `${label}-${uniqueSuffix()}@nextlane.dev`;
  const password = 'nextlane';
  const name = `QA ${label}`;
  const res = await request.post(`${API_URL}/api/auth/register`, {
    data: { email, name, password },
  });
  expect(res.ok(), `register failed: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as {
    accessToken: string;
    user?: { id: string };
  };
  let userId = body.user?.id ?? '';
  if (!userId) {
    const me = await request.get(`${API_URL}/api/auth/me`, {
      headers: authHeaders(body.accessToken),
    });
    userId = ((await me.json()) as { id: string }).id;
  }
  return { email, password, name, token: body.accessToken, userId };
}

/** Create a workspace owned by the token holder; returns its id. */
export async function createWorkspace(
  request: APIRequestContext,
  token: string,
  name = `QA WS ${uniqueSuffix()}`,
): Promise<string> {
  const res = await request.post(`${API_URL}/api/workspaces`, {
    headers: authHeaders(token),
    data: { name },
  });
  expect(res.ok(), `create workspace failed: ${res.status()}`).toBeTruthy();
  return ((await res.json()) as { id: string }).id;
}

export interface CreatedProject {
  id: string;
  key: string;
  name: string;
}

/** Create a project (auto-seeds To Do / In Progress / Done statuses). */
export async function createProject(
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  opts: { name?: string; key?: string } = {},
): Promise<CreatedProject> {
  const key =
    opts.key ?? `Q${Math.floor(Math.random() * 9_000_000 + 1_000_000)}`;
  const name = opts.name ?? 'QA Project';
  const res = await request.post(`${API_URL}/api/projects`, {
    headers: authHeaders(token),
    data: { workspaceId, key, name },
  });
  expect(res.ok(), `create project failed: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { id: string; key: string; name: string };
  return { id: body.id, key: body.key ?? key, name: body.name ?? name };
}

/** Add an existing user (by email) to a workspace as a co-member. */
export async function addWorkspaceMember(
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  email: string,
  role = 'MEMBER',
): Promise<void> {
  const res = await request.post(
    `${API_URL}/api/workspaces/${workspaceId}/members`,
    { headers: authHeaders(token), data: { email, role } },
  );
  expect(res.ok(), `add member failed: ${res.status()}`).toBeTruthy();
}

/** Create an issue via the API; returns id + key. Optionally assign it. */
export async function createIssue(
  request: APIRequestContext,
  token: string,
  projectId: string,
  opts: { title?: string; assigneeId?: string } = {},
): Promise<{ id: string; key: string }> {
  const res = await request.post(`${API_URL}/api/issues`, {
    headers: authHeaders(token),
    data: {
      projectId,
      title: opts.title ?? 'QA issue',
      assigneeId: opts.assigneeId,
    },
  });
  expect(res.ok(), `create issue failed: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { id: string; key: string };
  return { id: body.id, key: body.key };
}

/** Create a label in a project; returns its id. */
export async function createLabel(
  request: APIRequestContext,
  token: string,
  projectId: string,
  name: string,
  color = '#3b82f6',
): Promise<string> {
  const res = await request.post(
    `${API_URL}/api/projects/${projectId}/labels`,
    { headers: authHeaders(token), data: { name, color } },
  );
  expect(res.ok(), `create label failed: ${res.status()}`).toBeTruthy();
  return ((await res.json()) as { id: string }).id;
}

/**
 * Paint-level visibility check for absolutely-positioned / portalled
 * overlays near a viewport edge.
 *
 * Motivation (docs/AUDIT-PRODUCT.md Pass 12): a menu can be DOM-present,
 * `opacity: 1`, correctly `z-index`-ed, have a non-zero `boundingBox()`, and
 * report `isVisible(): true` — and STILL paint zero real pixels to a real
 * user's screen if a clipping ancestor (e.g. `overflow-x-clip`) suppresses
 * the compositor's paint of the whole absolutely-positioned box once part
 * of it extends past the viewport edge. `isVisible()`/`boundingBox()` alone
 * do not catch this class of bug — only an actual rendered-pixel check does.
 *
 * This takes a real Playwright screenshot clipped to the locator's bounding
 * box, decodes it via the browser's own `<canvas>` (no extra npm deps), and
 * samples pixel colors to assert the region isn't a single flat color (which
 * a fully-suppressed/blank paint would be). Returns the sampled distinct
 * color count for the caller to assert on.
 */
export async function paintedDistinctColorCount(
  page: Page,
  locator: Locator,
): Promise<number> {
  const box = await locator.boundingBox();
  if (!box || box.width <= 0 || box.height <= 0) return 0;

  const buffer = await page.screenshot({
    clip: {
      x: Math.max(0, box.x),
      y: Math.max(0, box.y),
      width: Math.max(1, Math.min(box.width, page.viewportSize()!.width - Math.max(0, box.x))),
      height: Math.max(1, Math.min(box.height, page.viewportSize()!.height - Math.max(0, box.y))),
    },
  });

  const base64 = buffer.toString('base64');
  const { distinctColors } = await page.evaluate(async (b64) => {
    const img = new Image();
    const loaded = new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('image decode failed'));
    });
    img.src = `data:image/png;base64,${b64}`;
    await loaded;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const colors = new Set<string>();
    // Sample every 4th pixel (16 bytes) for speed; enough to detect a
    // uniform blank region vs. real bordered/text content.
    for (let i = 0; i < data.length; i += 16) {
      colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    }
    return { distinctColors: colors.size };
  }, base64);

  return distinctColors;
}

// ---------------------------------------------------------------------------
// Waiting for the page's OWN writes before reloading
// ---------------------------------------------------------------------------

/** One completed non-GET call from the browser to the API. */
export interface ApiWrite {
  method: string;
  /** Pathname only, e.g. `/api/pages/abc/move`. */
  path: string;
  status: number;
}

export interface ApiWriteTracker {
  /** Completed writes, in the order their responses arrived. */
  readonly completed: readonly ApiWrite[];
  /** Number of writes issued but not yet answered. */
  readonly inFlight: number;
  /**
   * Resolve once the browser has no write in flight — and, when `atLeast` is
   * given, once at least that many *matching* writes have been answered.
   * Then assert none of them failed.
   */
  settle(opts?: {
    /** Restrict `atLeast` / the status check to writes matching this. */
    match?: (w: ApiWrite) => boolean;
    /** Minimum number of matching writes that must have been answered. */
    atLeast?: number;
    timeout?: number;
  }): Promise<void>;
}

/**
 * Record every non-GET request the page makes to the API so a spec can wait
 * for its OWN mutations to be acknowledged by the server before doing
 * something that would abort them — in practice, `page.reload()`.
 *
 * WHY THIS EXISTS (and why `page.waitForLoadState('networkidle')` is not it):
 * Playwright's lifecycle events are sticky per document. In
 * `playwright-core/lib/server/frames.js`, `_startNetworkIdleTimer()` returns
 * immediately when `_firedLifecycleEvents` already contains `networkidle`,
 * and that entry is only ever *removed* by `_recalculateNetworkIdle()` — which
 * only runs from the idle timer itself, never when a new XHR starts.
 * `waitForLoadState()` in turn returns straight away if the state has already
 * fired. So on a page that has been open for a while (every one of these
 * specs), `await page.waitForLoadState('networkidle')` waits for exactly
 * nothing while reading like a wait. That no-op is what let three specs race
 * their own writes on CI's slower I/O.
 *
 * This does NOT weaken the "it persisted" claim: waiting for the server to
 * answer, then reloading, then re-reading from the server is a strictly
 * stronger test than reloading mid-flight and hoping. `atLeast` makes it
 * stronger still — a swallowed click now fails as "5 of 6 writes acked"
 * instead of an opaque ordering diff.
 *
 * Install it before the mutations you care about (right after page setup).
 */
export function trackApiWrites(page: Page): ApiWriteTracker {
  const apiOrigin = new URL(API_URL).origin;
  const completed: ApiWrite[] = [];
  const inFlight = new Set<unknown>();

  const isApiWrite = (url: string, method: string): boolean => {
    if (method === 'GET') return false;
    try {
      const u = new URL(url);
      // REST calls only. Socket.io's HTTP long-polling transport also POSTs
      // (to /socket.io/) and a poll can sit open indefinitely, which would
      // make "no write in flight" unreachable.
      return u.origin === apiOrigin && u.pathname.startsWith('/api/');
    } catch {
      return false;
    }
  };

  page.on('request', (req) => {
    if (isApiWrite(req.url(), req.method())) inFlight.add(req);
  });
  page.on('requestfailed', (req) => inFlight.delete(req));
  page.on('requestfinished', (req) => inFlight.delete(req));
  page.on('response', (res) => {
    const req = res.request();
    if (!isApiWrite(req.url(), req.method())) return;
    inFlight.delete(req);
    completed.push({
      method: req.method(),
      path: new URL(res.url()).pathname,
      status: res.status(),
    });
  });

  return {
    get completed() {
      return completed;
    },
    get inFlight() {
      return inFlight.size;
    },
    async settle(opts = {}) {
      const { match, atLeast = 0, timeout = 15_000 } = opts;
      const matching = () => (match ? completed.filter(match) : completed);
      await expect
        .poll(
          () =>
            inFlight.size === 0 && matching().length >= atLeast
              ? 'settled'
              : `in-flight=${inFlight.size} acked=${matching().length}/${atLeast}`,
          {
            timeout,
            message:
              'the page never finished the API writes it had started; ' +
              `observed: ${JSON.stringify(completed)}`,
          },
        )
        .toBe('settled');

      const failed = matching().filter((w) => w.status >= 400);
      expect(failed, `API write(s) rejected: ${JSON.stringify(failed)}`).toEqual(
        [],
      );
    },
  };
}

/** Navigate to a project board and wait for its columns to render. */
export async function openProjectBoard(
  page: Page,
  projectId: string,
): Promise<void> {
  await page.goto(`/projects/${projectId}/board`);
  await expect(page.getByText(/to do/i).first()).toBeVisible({
    timeout: 15_000,
  });
}

export interface IsolatedContext {
  /** Freshly registered owner of the workspace/project (UI is logged in as them). */
  user: RegisteredUser;
  token: string;
  workspaceId: string;
  project: CreatedProject;
  request: APIRequestContext;
}

/**
 * One-call isolation: register a fresh user, create their own workspace +
 * project (with default statuses), optionally seed labels, log that user into
 * the UI, and (by default) land on the new project's board.
 *
 * Use this for ANY spec that mutates data so it never touches the seeded demo.
 */
export async function setupIsolatedProject(
  page: Page,
  request: APIRequestContext,
  opts: {
    label?: string;
    projectName?: string;
    /** Label names to seed in the project (e.g. ['bug', 'feature']). */
    labels?: string[];
    /** Skip navigating to the board (caller will navigate). */
    openBoard?: boolean;
  } = {},
): Promise<IsolatedContext> {
  const user = await registerNewUser(request, opts.label ?? 'iso');
  const workspaceId = await createWorkspace(request, user.token);
  const project = await createProject(request, user.token, workspaceId, {
    name: opts.projectName ?? 'QA Isolated Project',
  });

  if (opts.labels?.length) {
    for (const name of opts.labels) {
      const color = name === 'bug' ? '#ef4444' : '#3b82f6';
      await createLabel(request, user.token, project.id, name, color);
    }
  }

  await login(page, { email: user.email, password: user.password });
  if (opts.openBoard !== false) {
    await openProjectBoard(page, project.id);
  }

  return { user, token: user.token, workspaceId, project, request };
}
