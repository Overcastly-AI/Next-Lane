import { test, expect, type APIRequestContext } from '@playwright/test';
import { io, type Socket } from 'socket.io-client';
import { DEMO } from './helpers';

/**
 * Security regression coverage for the realtime gateway. Before this fix, the
 * `subscribe` handler called `client.join(projectId)` for ANY projectId with no
 * JWT and no membership check, so any client could join another workspace's
 * project room and receive all issue/comment events (a cross-tenant leak).
 *
 * These tests assert the gateway now (1) rejects sockets with no/invalid JWT at
 * handshake, and (2) refuses to subscribe a valid user to a project they are
 * not a member of, while still allowing a real member to subscribe.
 *
 * The gateway lives on the API origin (:4000), not the web preview, so we talk
 * to it directly with socket.io-client. The spec still runs under both the
 * desktop and mobile Playwright projects.
 */

const API_URL = process.env.PW_API_URL ?? 'http://localhost:4000';

async function loginToken(
  request: APIRequestContext,
  creds = DEMO,
): Promise<string> {
  const res = await request.post(`${API_URL}/api/auth/login`, {
    data: { email: creds.email, password: creds.password },
  });
  expect(res.ok(), `login failed: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { accessToken: string };
  expect(body.accessToken).toBeTruthy();
  return body.accessToken;
}

async function getDemoProjectId(
  request: APIRequestContext,
  token: string,
): Promise<string> {
  const headers = { Authorization: `Bearer ${token}` };
  const wsRes = await request.get(`${API_URL}/api/workspaces`, { headers });
  expect(wsRes.ok(), `workspaces failed: ${wsRes.status()}`).toBeTruthy();
  const workspaces = (await wsRes.json()) as Array<{ id: string }>;
  expect(workspaces[0], 'no workspace found').toBeTruthy();

  const res = await request.get(
    `${API_URL}/api/projects?workspaceId=${workspaces[0].id}`,
    { headers },
  );
  expect(res.ok(), `projects failed: ${res.status()}`).toBeTruthy();
  const projects = (await res.json()) as Array<{ id: string; key: string }>;
  const nl = projects.find((p) => p.key === 'NL') ?? projects[0];
  expect(nl, 'no seeded project found').toBeTruthy();
  return nl.id;
}

/** Connect with the given auth, returning the socket once connected (or rejecting). */
function connect(auth: Record<string, unknown>): Socket {
  return io(API_URL, {
    transports: ['websocket'],
    autoConnect: true,
    reconnection: false,
    auth,
  });
}

/** Resolve true if the socket is forcibly disconnected by the server. */
function waitForDisconnect(socket: Socket, ms = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    const done = (ok: boolean) => {
      clearTimeout(timer);
      resolve(ok);
    };
    socket.on('disconnect', () => done(true));
    socket.on('connect_error', () => done(true));
  });
}

/** Emit subscribe and resolve with the ack, or null if it errors/times out. */
function subscribe(
  socket: Socket,
  projectId: string,
  ms = 8000,
): Promise<{ ok: boolean } | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    socket
      .timeout(ms)
      .emit(
        'subscribe',
        projectId,
        (err: unknown, ack: { ok: boolean } | undefined) => {
          clearTimeout(timer);
          resolve(err ? null : (ack ?? null));
        },
      );
  });
}

test.describe('realtime gateway auth + membership', () => {
  test('rejects a socket with no JWT at handshake', async () => {
    const socket = connect({});
    const disconnected = await waitForDisconnect(socket);
    socket.disconnect();
    expect(disconnected, 'unauthenticated socket should be disconnected').toBe(
      true,
    );
  });

  test('rejects a socket with an invalid JWT at handshake', async () => {
    const socket = connect({ token: 'not-a-real-jwt' });
    const disconnected = await waitForDisconnect(socket);
    socket.disconnect();
    expect(disconnected, 'invalid-token socket should be disconnected').toBe(
      true,
    );
  });

  test('allows a member to subscribe to their project', async ({ request }) => {
    const token = await loginToken(request);
    const projectId = await getDemoProjectId(request, token);
    const socket = connect({ token });
    await new Promise<void>((resolve, reject) => {
      socket.on('connect', () => resolve());
      socket.on('connect_error', (e) => reject(e));
      setTimeout(() => reject(new Error('connect timeout')), 8000);
    });
    const ack = await subscribe(socket, projectId);
    socket.disconnect();
    expect(ack, 'member subscribe should be acked').toEqual({ ok: true });
  });

  test('denies a member subscribing to a project they are not in', async ({
    request,
  }) => {
    const token = await loginToken(request);
    const socket = connect({ token });
    await new Promise<void>((resolve, reject) => {
      socket.on('connect', () => resolve());
      socket.on('connect_error', (e) => reject(e));
      setTimeout(() => reject(new Error('connect timeout')), 8000);
    });
    // A well-formed but foreign/nonexistent project id: membership check fails.
    const ack = await subscribe(socket, '00000000-0000-0000-0000-000000000000');
    socket.disconnect();
    expect(ack, 'non-member subscribe must not be acked ok').not.toEqual({
      ok: true,
    });
  });
});
