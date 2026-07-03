import { GitlabClient } from './gitlab-client.service';

// GitlabClient is the single seam through which the API ever calls a live
// GitLab instance. These tests mock global fetch AND node:dns — no live
// network is ever hit. DNS mocking matters MORE here than for GithubClient:
// `baseUrl` is admin-supplied (self-hosted GitLab), so the SSRF pre-flight
// (`resolveAndCheckBlocked`, shared with webhooks.service.ts) is the primary
// risk this client carries, not defense-in-depth.

describe('GitlabClient', () => {
  let client: GitlabClient;
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    client = new GitlabClient();
    fetchSpy = jest.spyOn(global, 'fetch');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dnsModule = require('node:dns') as typeof import('node:dns');
    jest
      .spyOn(dnsModule.promises, 'lookup')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as any);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('calls the GitLab REST API with the correct URL (encoded project path) and auth header', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          path_with_namespace: 'acme/widgets',
          visibility: 'private',
          default_branch: 'main',
        }),
        { status: 200 },
      ),
    );

    const result = await client.getProject('https://gitlab.com', 'acme/widgets', 'glpat-token123');

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://gitlab.com/api/v4/projects/acme%2Fwidgets',
      expect.objectContaining({
        headers: expect.objectContaining({
          'PRIVATE-TOKEN': 'glpat-token123',
        }),
      }),
    );
    expect(result).toEqual({
      pathWithNamespace: 'acme/widgets',
      visibility: 'private',
      defaultBranch: 'main',
    });
  });

  it('URL-encodes a nested subgroup project path and strips a trailing slash from a self-hosted base URL', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          path_with_namespace: 'acme/team/widgets',
          visibility: 'internal',
          default_branch: 'main',
        }),
        { status: 200 },
      ),
    );

    await client.getProject('https://gitlab.example.com/', 'acme/team/widgets', 'glpat-token123');

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://gitlab.example.com/api/v4/projects/acme%2Fteam%2Fwidgets',
      expect.anything(),
    );
  });

  it('returns null on a non-2xx response (never throws)', async () => {
    fetchSpy.mockResolvedValue(new Response('not found', { status: 404 }));
    const result = await client.getProject('https://gitlab.com', 'acme/missing', 'glpat-token123');
    expect(result).toBeNull();
  });

  it('returns null on a network failure (never throws)', async () => {
    fetchSpy.mockRejectedValue(new Error('network down'));
    const result = await client.getProject('https://gitlab.com', 'acme/widgets', 'glpat-token123');
    expect(result).toBeNull();
  });

  it('is SSRF-guarded against a self-hosted baseUrl resolving to a blocked IP', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dnsModule = require('node:dns') as typeof import('node:dns');
    jest
      .spyOn(dnsModule.promises, 'lookup')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue([{ address: '169.254.169.254', family: 4 }] as any); // AWS metadata endpoint

    const result = await client.getProject(
      'http://internal-gitlab.corp',
      'acme/widgets',
      'glpat-token123',
    );
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // ---- getMergeRequestStatus() — the first REAL outbound call -------------

  describe('getMergeRequestStatus', () => {
    it('fetches the MR with its embedded pipeline status, real request shape', async () => {
      fetchSpy.mockResolvedValue(
        new Response(
          JSON.stringify({
            iid: 101,
            state: 'opened',
            merged_at: null,
            web_url: 'https://gitlab.com/acme/widgets/-/merge_requests/101',
            pipeline: { status: 'success' },
          }),
          { status: 200 },
        ),
      );

      const result = await client.getMergeRequestStatus(
        'https://gitlab.com',
        'acme/widgets',
        'glpat-token123',
        101,
      );

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://gitlab.com/api/v4/projects/acme%2Fwidgets/merge_requests/101',
        expect.objectContaining({
          headers: expect.objectContaining({ 'PRIVATE-TOKEN': 'glpat-token123' }),
          redirect: 'manual',
        }),
      );
      expect(result).toEqual({
        iid: 101,
        state: 'open',
        merged: false,
        mergedAt: null,
        checksState: 'success',
        url: 'https://gitlab.com/acme/widgets/-/merge_requests/101',
      });
    });

    it('reports merged: true and normalizes state for a merged MR', async () => {
      fetchSpy.mockResolvedValue(
        new Response(
          JSON.stringify({
            iid: 102,
            state: 'merged',
            merged_at: '2026-07-03T12:00:00Z',
            web_url: 'https://gitlab.com/acme/widgets/-/merge_requests/102',
            pipeline: { status: 'failed' },
          }),
          { status: 200 },
        ),
      );

      const result = await client.getMergeRequestStatus(
        'https://gitlab.com',
        'acme/widgets',
        'glpat-token123',
        102,
      );
      expect(result?.merged).toBe(true);
      expect(result?.state).toBe('merged');
      expect(result?.checksState).toBe('failure');
    });

    it('falls back to head_pipeline when pipeline is absent', async () => {
      fetchSpy.mockResolvedValue(
        new Response(
          JSON.stringify({
            iid: 103,
            state: 'opened',
            merged_at: null,
            web_url: 'https://gitlab.com/acme/widgets/-/merge_requests/103',
            head_pipeline: { status: 'running' },
          }),
          { status: 200 },
        ),
      );

      const result = await client.getMergeRequestStatus(
        'https://gitlab.com',
        'acme/widgets',
        'glpat-token123',
        103,
      );
      expect(result?.checksState).toBe('pending');
    });

    it('returns checksState "unknown" when there is no pipeline at all', async () => {
      fetchSpy.mockResolvedValue(
        new Response(
          JSON.stringify({
            iid: 104,
            state: 'opened',
            merged_at: null,
            web_url: 'https://gitlab.com/acme/widgets/-/merge_requests/104',
          }),
          { status: 200 },
        ),
      );

      const result = await client.getMergeRequestStatus(
        'https://gitlab.com',
        'acme/widgets',
        'glpat-token123',
        104,
      );
      expect(result?.checksState).toBe('unknown');
    });

    it('returns null on a 404 (deleted/renumbered MR)', async () => {
      fetchSpy.mockResolvedValue(new Response('not found', { status: 404 }));
      const result = await client.getMergeRequestStatus(
        'https://gitlab.com',
        'acme/widgets',
        'glpat-token123',
        999,
      );
      expect(result).toBeNull();
    });

    it('returns null on a network failure (never throws)', async () => {
      fetchSpy.mockRejectedValue(new Error('network down'));
      const result = await client.getMergeRequestStatus(
        'https://gitlab.com',
        'acme/widgets',
        'glpat-token123',
        101,
      );
      expect(result).toBeNull();
    });

    it('is SSRF-guarded against a self-hosted baseUrl resolving to a blocked IP', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const dnsModule = require('node:dns') as typeof import('node:dns');
      jest
        .spyOn(dnsModule.promises, 'lookup')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as any);

      const result = await client.getMergeRequestStatus(
        'http://internal-gitlab.corp',
        'acme/widgets',
        'glpat-token123',
        101,
      );
      expect(result).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
