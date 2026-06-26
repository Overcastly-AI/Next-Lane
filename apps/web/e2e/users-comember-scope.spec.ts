import { test, expect, type APIRequestContext } from '@playwright/test';
import { DEMO } from './helpers';

/**
 * Security regression coverage for the GET /users cross-tenant leak. Before this
 * fix, `UsersService.findAll` returned EVERY user (names + emails) platform-wide
 * to any authenticated caller. It is now scoped to users who share at least one
 * workspace with the caller (the caller is always included), since it only
 * powers the assignee picker. The API lives on :4000.
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

interface UserRow {
  id: string;
  email: string;
}

test.describe('GET /users co-member scoping', () => {
  test('returns only co-members and excludes an unrelated tenant user', async ({
    request,
  }) => {
    // Register an outsider in a separate workspace, foreign to the demo user.
    const outsiderEmail = `outsider-${Date.now()}-${Math.floor(
      Math.random() * 1e6,
    )}@example.com`;
    const regRes = await request.post(`${API_URL}/api/auth/register`, {
      data: {
        email: outsiderEmail,
        name: 'Unrelated Outsider',
        password: 'outsider-pass',
      },
    });
    expect(regRes.ok(), `register failed: ${regRes.status()}`).toBeTruthy();

    // The demo user fetches the user list.
    const token = await loginToken(request);
    const headers = { Authorization: `Bearer ${token}` };

    const meRes = await request.get(`${API_URL}/api/auth/me`, { headers });
    const demoUserId = ((await meRes.json()) as { id: string }).id;

    const usersRes = await request.get(`${API_URL}/api/users`, { headers });
    expect(usersRes.ok(), `users failed: ${usersRes.status()}`).toBeTruthy();
    const users = (await usersRes.json()) as UserRow[];

    // The caller is always present.
    expect(
      users.some((u) => u.id === demoUserId),
      'caller (demo user) must be included',
    ).toBeTruthy();

    // The unrelated outsider must NOT be leaked.
    expect(
      users.some((u) => u.email === outsiderEmail),
      'unrelated tenant user must be excluded from /users',
    ).toBeFalsy();
  });

  test('includes a genuine co-member added to the caller workspace', async ({
    request,
  }) => {
    const token = await loginToken(request);
    const headers = { Authorization: `Bearer ${token}` };

    const wsRes = await request.get(`${API_URL}/api/workspaces`, { headers });
    const workspaces = (await wsRes.json()) as Array<{ id: string }>;
    const workspaceId = workspaces[0].id;

    // Register a fresh user, then add them as a member of the demo workspace.
    const mateEmail = `mate-${Date.now()}-${Math.floor(
      Math.random() * 1e6,
    )}@example.com`;
    const regRes = await request.post(`${API_URL}/api/auth/register`, {
      data: { email: mateEmail, name: 'Real Co Member', password: 'mate-pass' },
    });
    expect(regRes.ok(), `register failed: ${regRes.status()}`).toBeTruthy();

    const addRes = await request.post(
      `${API_URL}/api/workspaces/${workspaceId}/members`,
      { headers, data: { email: mateEmail, role: 'MEMBER' } },
    );
    expect(
      addRes.ok(),
      `add member failed: ${addRes.status()}`,
    ).toBeTruthy();

    const usersRes = await request.get(`${API_URL}/api/users`, { headers });
    const users = (await usersRes.json()) as UserRow[];
    expect(
      users.some((u) => u.email === mateEmail),
      'genuine co-member must be included in /users',
    ).toBeTruthy();
  });
});
