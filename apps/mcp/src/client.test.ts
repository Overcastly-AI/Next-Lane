import { describe, expect, it, vi } from 'vitest';
import { ApiError, NextLaneClient } from './client.js';
import type { NextLaneConfig } from './config.js';

const config: NextLaneConfig = {
  apiUrl: 'http://localhost:4000',
  token: 'nlp_secret',
};

/** Build a fetch mock returning the given status + JSON body. */
function mockFetch(status: number, body: unknown) {
  return vi.fn(async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('NextLaneClient', () => {
  it('prepends the /api prefix, sets the bearer header, and parses JSON on GET', async () => {
    const fetchImpl = mockFetch(200, [{ id: 'p1' }]);
    const client = new NextLaneClient(config, fetchImpl as unknown as typeof fetch);

    const result = await client.get('/projects', { workspaceId: 'w1' });

    expect(result).toEqual([{ id: 'p1' }]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/projects?workspaceId=w1');
    expect((init as RequestInit).method).toBe('GET');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer nlp_secret');
    // GET has no body.
    expect((init as RequestInit).body).toBeUndefined();
  });

  it('skips undefined query params', async () => {
    const fetchImpl = mockFetch(200, []);
    const client = new NextLaneClient(config, fetchImpl as unknown as typeof fetch);
    await client.get('/issues', { projectId: 'p1', sprintId: undefined });
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'http://localhost:4000/api/issues?projectId=p1',
    );
  });

  it('sends method + JSON body + Content-Type on POST', async () => {
    const fetchImpl = mockFetch(201, { id: 'wf1' });
    const client = new NextLaneClient(config, fetchImpl as unknown as typeof fetch);

    const body = { name: 'My Workflow', enforced: true };
    const result = await client.post('/projects/p1/workflows', body);

    expect(result).toEqual({ id: 'wf1' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/projects/p1/workflows');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).body).toBe(JSON.stringify(body));
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('returns null for an empty 204 response (DELETE)', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const client = new NextLaneClient(config, fetchImpl as unknown as typeof fetch);
    const result = await client.delete('/workflows/wf1');
    expect(result).toBeNull();
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: 'DELETE' });
  });

  it('surfaces the API error message and status on a non-2xx response', async () => {
    const fetchImpl = mockFetch(403, {
      message: 'Only project admins can edit workflows',
      statusCode: 403,
    });
    const client = new NextLaneClient(config, fetchImpl as unknown as typeof fetch);

    await expect(client.get('/workflows/wf1')).rejects.toThrowError(ApiError);
    await expect(client.get('/workflows/wf1')).rejects.toThrow(
      /Only project admins can edit workflows \[HTTP 403\]/,
    );
  });

  it('joins array validation messages from NestJS', async () => {
    const fetchImpl = mockFetch(400, {
      message: ['title should not be empty', 'projectId must be a string'],
    });
    const client = new NextLaneClient(config, fetchImpl as unknown as typeof fetch);
    await expect(client.post('/issues', {})).rejects.toThrow(
      /title should not be empty; projectId must be a string \[HTTP 400\]/,
    );
  });
});
