import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { test, expect } from '@playwright/test';
import { API_URL, registerNewUser, createWorkspace, createProject } from './helpers';

// API-level verification of the webhook backend slice. We spin up a tiny local
// HTTP receiver (explicitly permitted by the build process to verify delivery
// end-to-end without an external server), register a subscription pointed at it,
// trigger a domain event, and assert a signed delivery was recorded.

interface Received {
  signature: string | undefined;
  event: string | undefined;
  body: string;
}

function startReceiver(): Promise<{ server: Server; url: string; received: Received[] }> {
  const received: Received[] = [];
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push({
          signature: req.headers['x-nextlane-signature'] as string | undefined,
          event: req.headers['x-nextlane-event'] as string | undefined,
          body,
        });
        res.writeHead(200).end('ok');
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, url: `http://127.0.0.1:${port}/hook`, received });
    });
  });
}

test.describe('webhook backend slice', () => {
  // ENV DEPENDENCY: this test requires Redis to be running. When REDIS_URL is
  // set in the API's environment but Redis is unreachable, BullMQ cannot enqueue
  // delivery jobs and the webhook is never sent. In CI (e2e.yml) a Redis service
  // container is present, so this test passes there. In this local harness
  // (no Redis), it will fail — that is expected and not a product bug.
  test('an issue event delivers a signed webhook and records a delivery row', async ({
    request,
  }) => {
    const { server, url, received } = await startReceiver();
    const secret = 'e2e-webhook-secret-value';
    try {
      const admin = await registerNewUser(request, 'wh-admin');
      const workspaceId = await createWorkspace(request, admin.token);
      const project = await createProject(request, admin.token, workspaceId, {
        name: 'Webhook QA',
      });
      const auth = { Authorization: `Bearer ${admin.token}` };

      // Register a subscription for all events pointed at the local receiver.
      const createRes = await request.post(
        `${API_URL}/api/projects/${project.id}/webhooks`,
        { headers: auth, data: { url, secret, events: [] } },
      );
      expect(createRes.ok(), `create webhook: ${createRes.status()}`).toBeTruthy();
      const sub = (await createRes.json()) as { id: string; url: string };
      expect(sub.url).toBe(url);
      // Secret must never be returned by the API.
      expect(sub).not.toHaveProperty('secret');

      // Trigger an issue.created event.
      const issueRes = await request.post(`${API_URL}/api/issues`, {
        headers: auth,
        data: { projectId: project.id, title: 'Webhook trigger issue' },
      });
      expect(issueRes.ok(), `create issue: ${issueRes.status()}`).toBeTruthy();

      // Wait for the fire-and-forget delivery to reach the receiver.
      await expect
        .poll(() => received.length, { timeout: 15_000 })
        .toBeGreaterThan(0);

      const hit = received[0];
      expect(hit.event).toBe('issue.created');
      const expectedSig =
        'sha256=' + createHmac('sha256', secret).update(hit.body).digest('hex');
      expect(hit.signature).toBe(expectedSig);

      // A delivery row should be logged and visible via the deliveries endpoint.
      await expect
        .poll(
          async () => {
            const res = await request.get(
              `${API_URL}/api/projects/${project.id}/webhooks/${sub.id}/deliveries`,
              { headers: auth },
            );
            if (!res.ok()) return 0;
            const rows = (await res.json()) as Array<{ status: string }>;
            return rows.filter((r) => r.status === 'success').length;
          },
          { timeout: 15_000 },
        )
        .toBeGreaterThan(0);
    } finally {
      server.close();
    }
  });

  test('non-admin members cannot manage webhooks', async ({ request }) => {
    const admin = await registerNewUser(request, 'wh-owner');
    const workspaceId = await createWorkspace(request, admin.token);
    const project = await createProject(request, admin.token, workspaceId);

    // Add a second user to the workspace as a MEMBER (non-admin).
    const member = await registerNewUser(request, 'wh-member');
    const addRes = await request.post(
      `${API_URL}/api/workspaces/${workspaceId}/members`,
      {
        headers: { Authorization: `Bearer ${admin.token}` },
        data: { email: member.email, role: 'MEMBER' },
      },
    );
    expect(addRes.ok(), `add member: ${addRes.status()}`).toBeTruthy();

    const res = await request.post(
      `${API_URL}/api/projects/${project.id}/webhooks`,
      {
        headers: { Authorization: `Bearer ${member.token}` },
        data: { url: 'https://example.test/hook', events: [] },
      },
    );
    expect(res.status()).toBe(403);
  });
});
