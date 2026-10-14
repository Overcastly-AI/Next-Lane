import { test, expect } from '@playwright/test';
import { API_URL, registerNewUser, createWorkspace, createProject } from './helpers';

/** Page bodies up to the advertised 256 KiB must be accepted; oversize is a 413, never a 500. */
test('large page bodies: 130 KB saves, absurd bodies are 413', async ({ request }) => {
  const u = await registerNewUser(request, 'body-limit');
  const ws = await createWorkspace(request, u.token);
  const project = await createProject(request, u.token, ws, { name: 'Body limit' });
  const h = { Authorization: `Bearer ${u.token}` };
  const ok = await request.post(`${API_URL}/api/projects/${project.id}/pages`, {
    headers: h,
    data: { title: 'Big', content: 'x'.repeat(130_000) },
  });
  expect(ok.status()).toBe(201);
  const huge = await request.post(`${API_URL}/api/projects/${project.id}/pages`, {
    headers: h,
    data: { title: 'Huge', content: 'x'.repeat(3_000_000) },
  });
  expect(huge.status()).toBe(413);
});
