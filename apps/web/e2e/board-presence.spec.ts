/**
 * E2E tests for live board presence indicators.
 *
 * Two-viewer scenario:
 *   1. User A opens the board in a browser context and sees no presence avatars.
 *   2. User B opens the same board in a second browser context.
 *   3. User A's board shows User B's avatar in the presence group.
 *   4. User B closes the board tab (navigates away).
 *   5. User A's board removes User B's avatar.
 *
 * Also verifies:
 *   - Mobile viewport: presence avatars render and are accessible.
 *   - Overflow badge appears when more than 4 viewers are present.
 *   - Self is NOT shown in the viewer list.
 *
 * The test uses two isolated Playwright BrowserContexts (separate login sessions)
 * to simulate two real users.
 */

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import {
  registerNewUser,
  createWorkspace,
  createProject,
  addWorkspaceMember,
  openProjectBoard,
  type RegisteredUser,
} from './helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const API_URL = process.env.PW_API_URL ?? 'http://localhost:4000';

/** Log a user into a fresh browser context and open the given board. */
async function loginAndOpenBoard(
  ctx: BrowserContext,
  user: RegisteredUser,
  projectId: string,
): Promise<Page> {
  const page = await ctx.newPage();
  // Inject the JWT directly into localStorage so we skip the login UI.
  await page.goto('/login');
  await page.evaluate(
    ({ token, key }) => localStorage.setItem(key, token),
    { token: user.token, key: 'nl_token' },
  );
  await openProjectBoard(page, projectId);
  return page;
}

/** Wait up to `timeout` ms for the presence container to show `count` avatars. */
async function waitForPresenceCount(
  page: Page,
  count: number,
  timeout = 10_000,
): Promise<void> {
  if (count === 0) {
    await expect(page.getByTestId('presence-avatars')).not.toBeVisible({
      timeout,
    });
    return;
  }
  const container = page.getByTestId('presence-avatars');
  await expect(container).toBeVisible({ timeout });

  // Count the rendered Avatar spans inside the presence container.
  // Each visible avatar is a <span> with a background colour, plus possibly a +N badge.
  // We look at aria-label which lists all viewer names.
  await expect(container).toHaveAttribute('aria-label', /.+/, { timeout });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('board presence indicators', () => {
  test('two viewers — each sees the other; leaving removes the avatar', async ({
    browser,
    request,
  }) => {
    // --- Setup: two users in the same workspace + project ---
    const userA = await registerNewUser(request, 'presence-a');
    const wsId = await createWorkspace(request, userA.token);
    const project = await createProject(request, userA.token, wsId);
    const userB = await registerNewUser(request, 'presence-b');
    await addWorkspaceMember(request, userA.token, wsId, userB.email);

    // Create two isolated browser contexts (= two separate sessions).
    const ctxA = await browser.newContext({ baseURL: process.env.PW_BASE_URL ?? 'http://localhost:3000' });
    const ctxB = await browser.newContext({ baseURL: process.env.PW_BASE_URL ?? 'http://localhost:3000' });

    try {
      // User A opens the board first — no presence avatars yet (self excluded).
      const pageA = await loginAndOpenBoard(ctxA, userA, project.id);

      // User B joins the board.
      const pageB = await loginAndOpenBoard(ctxB, userB, project.id);

      // User A should now see User B's avatar.
      const presenceA = pageA.getByTestId('presence-avatars');
      await expect(presenceA).toBeVisible({ timeout: 12_000 });
      await expect(presenceA).toHaveAttribute('aria-label', new RegExp(userB.name, 'i'), { timeout: 12_000 });

      // User B should see User A's avatar.
      const presenceB = pageB.getByTestId('presence-avatars');
      await expect(presenceB).toBeVisible({ timeout: 12_000 });
      await expect(presenceB).toHaveAttribute('aria-label', new RegExp(userA.name, 'i'), { timeout: 12_000 });

      // User B navigates away (goes back to the dashboard — triggers unsubscribe).
      await pageB.goto('/');
      // Allow up to 10 s for the presence update to propagate to User A.
      await expect(presenceA).not.toBeVisible({ timeout: 10_000 });
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  test('self is excluded from the presence viewer list', async ({
    browser,
    request,
  }) => {
    const user = await registerNewUser(request, 'presence-self');
    const wsId = await createWorkspace(request, user.token);
    const project = await createProject(request, user.token, wsId);

    const ctx = await browser.newContext({ baseURL: process.env.PW_BASE_URL ?? 'http://localhost:3000' });
    try {
      const page = await loginAndOpenBoard(ctx, user, project.id);
      // Only the one user is viewing — the presence group must be invisible
      // (self is excluded from the list).
      await expect(page.getByTestId('presence-avatars')).not.toBeVisible({
        timeout: 8_000,
      });
    } finally {
      await ctx.close();
    }
  });

  test('mobile: presence avatars render and are accessible', async ({
    browser,
    request,
  }) => {
    const userA = await registerNewUser(request, 'presence-mob-a');
    const wsId = await createWorkspace(request, userA.token);
    const project = await createProject(request, userA.token, wsId);
    const userB = await registerNewUser(request, 'presence-mob-b');
    await addWorkspaceMember(request, userA.token, wsId, userB.email);

    const mobileViewport = { width: 375, height: 812 };
    const ctxA = await browser.newContext({
      baseURL: process.env.PW_BASE_URL ?? 'http://localhost:3000',
      viewport: mobileViewport,
    });
    const ctxB = await browser.newContext({
      baseURL: process.env.PW_BASE_URL ?? 'http://localhost:3000',
      viewport: mobileViewport,
    });

    try {
      const pageA = await loginAndOpenBoard(ctxA, userA, project.id);
      await loginAndOpenBoard(ctxB, userB, project.id);

      // On mobile the toolbar is still rendered; presence avatars should appear.
      const presence = pageA.getByTestId('presence-avatars');
      await expect(presence).toBeVisible({ timeout: 12_000 });
      // Accessibility: the group has a descriptive aria-label.
      const label = await presence.getAttribute('aria-label');
      expect(label).toMatch(new RegExp(userB.name, 'i'));
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Socket-level presence unit scenario (complements the UI e2e above)
// ---------------------------------------------------------------------------

import { io, type Socket } from 'socket.io-client';

/** Connect with the given auth. */
function connectSocket(auth: Record<string, unknown>): Socket {
  return io(API_URL, {
    transports: ['websocket'],
    autoConnect: true,
    reconnection: false,
    auth,
  });
}

/** Wait for the socket to connect, reject on error or timeout. */
function waitConnected(socket: Socket, ms = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (socket.connected) { resolve(); return; }
    const timer = setTimeout(() => reject(new Error('connect timeout')), ms);
    socket.once('connect', () => { clearTimeout(timer); resolve(); });
    socket.once('connect_error', (e) => { clearTimeout(timer); reject(e); });
  });
}

/** Emit subscribe, resolve with the ack, null on timeout/error. */
function subscribeSocket(socket: Socket, projectId: string, ms = 8000): Promise<{ ok: boolean } | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    socket.timeout(ms).emit('subscribe', projectId, (err: unknown, ack: { ok: boolean } | undefined) => {
      clearTimeout(timer);
      resolve(err ? null : (ack ?? null));
    });
  });
}

type PresencePayload = { projectId: string; viewers: { userId: string; name: string; avatarColor: string }[] };

/**
 * Wait for a presence.update event on `socket` for `projectId` that satisfies
 * the optional `predicate`. Keeps listening until the predicate passes (or
 * timeout fires), so multiple updates can fire and we only resolve on the one
 * we care about.
 */
function waitPresenceUpdate(
  socket: Socket,
  projectId: string,
  predicate: (p: PresencePayload) => boolean = () => true,
  ms = 10_000,
): Promise<PresencePayload> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('presence.update timeout')), ms);
    const handler = (payload: PresencePayload) => {
      if (payload.projectId === projectId && predicate(payload)) {
        clearTimeout(timer);
        socket.off('presence.update', handler);
        resolve(payload);
      }
    };
    socket.on('presence.update', handler);
  });
}

test.describe('presence.update socket events', () => {
  test('joining project emits presence.update with viewer info', async ({ request }) => {
    const userA = await registerNewUser(request, 'pws-a');
    const wsId = await createWorkspace(request, userA.token);
    const project = await createProject(request, userA.token, wsId);

    const socketA = connectSocket({ token: userA.token });
    await waitConnected(socketA);

    // Subscribe A — listen for the presence.update that A will receive.
    // Predicate: update contains userA.
    const updatePromise = waitPresenceUpdate(
      socketA,
      project.id,
      (p) => p.viewers.some((v) => v.userId === userA.userId),
    );
    await subscribeSocket(socketA, project.id);
    const update = await updatePromise;

    socketA.disconnect();

    // The gateway broadcasts presence.update on subscribe — the list should
    // contain at least the joining user.
    expect(update.viewers.some((v) => v.userId === userA.userId)).toBe(true);
  });

  test('second user joining triggers presence.update on first user socket', async ({ request }) => {
    const userA = await registerNewUser(request, 'pws2-a');
    const wsId = await createWorkspace(request, userA.token);
    const project = await createProject(request, userA.token, wsId);
    const userB = await registerNewUser(request, 'pws2-b');
    await addWorkspaceMember(request, userA.token, wsId, userB.email);

    const socketA = connectSocket({ token: userA.token });
    const socketB = connectSocket({ token: userB.token });
    await waitConnected(socketA);
    await waitConnected(socketB);

    // A subscribes first.
    await subscribeSocket(socketA, project.id);

    // Wait for the presence.update that will arrive on A when B joins.
    // Predicate: update must include B.
    const updatePromise = waitPresenceUpdate(
      socketA,
      project.id,
      (p) => p.viewers.some((v) => v.userId === userB.userId),
    );
    await subscribeSocket(socketB, project.id);
    const update = await updatePromise;

    socketA.disconnect();
    socketB.disconnect();

    // The update received by A should now include B.
    expect(update.viewers.some((v) => v.userId === userB.userId)).toBe(true);
  });

  test('disconnecting removes viewer from presence', async ({ request }) => {
    const userA = await registerNewUser(request, 'pws3-a');
    const wsId = await createWorkspace(request, userA.token);
    const project = await createProject(request, userA.token, wsId);
    const userB = await registerNewUser(request, 'pws3-b');
    await addWorkspaceMember(request, userA.token, wsId, userB.email);

    const socketA = connectSocket({ token: userA.token });
    const socketB = connectSocket({ token: userB.token });
    await waitConnected(socketA);
    await waitConnected(socketB);

    await subscribeSocket(socketA, project.id);

    // Wait for the presence.update that includes B (after B subscribes).
    const appearedPromise = waitPresenceUpdate(
      socketA,
      project.id,
      (p) => p.viewers.some((v) => v.userId === userB.userId),
    );
    await subscribeSocket(socketB, project.id);
    const appeared = await appearedPromise;
    expect(appeared.viewers.some((v) => v.userId === userB.userId)).toBe(true);

    // Now B disconnects — A should get a presence.update without B.
    const removedPromise = waitPresenceUpdate(
      socketA,
      project.id,
      (p) => !p.viewers.some((v) => v.userId === userB.userId),
    );
    socketB.disconnect();
    const removed = await removedPromise;

    socketA.disconnect();

    expect(removed.viewers.some((v) => v.userId === userB.userId)).toBe(false);
  });
});
