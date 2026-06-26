import { Page, expect, type APIRequestContext } from '@playwright/test';

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
