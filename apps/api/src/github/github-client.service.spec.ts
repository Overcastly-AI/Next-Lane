import { GithubClient } from './github-client.service';

// GithubClient is the single seam through which the API ever calls
// github.com. These tests mock global fetch AND node:dns — no live network
// is ever hit, consistent with the network-isolated build/test environment.
// DNS is mocked to a known-public IP so the shared SSRF pre-flight
// (`resolveAndCheckBlocked`, reused from webhooks.service.ts) passes without
// a real lookup.

describe('GithubClient', () => {
  let client: GithubClient;
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    client = new GithubClient();
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

  it('calls the GitHub REST API with the correct URL and auth header', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({ full_name: 'acme/widgets', private: false, default_branch: 'main' }),
        { status: 200 },
      ),
    );

    const result = await client.getRepository('acme/widgets', 'ghp_token123');

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.github.com/repos/acme/widgets',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer ghp_token123',
        }),
      }),
    );
    expect(result).toEqual({
      fullName: 'acme/widgets',
      private: false,
      defaultBranch: 'main',
    });
  });

  it('returns null on a non-2xx response (never throws)', async () => {
    fetchSpy.mockResolvedValue(new Response('not found', { status: 404 }));
    const result = await client.getRepository('acme/missing', 'ghp_token123');
    expect(result).toBeNull();
  });

  it('returns null on a network failure (never throws)', async () => {
    fetchSpy.mockRejectedValue(new Error('network down'));
    const result = await client.getRepository('acme/widgets', 'ghp_token123');
    expect(result).toBeNull();
  });

  // ---- getPullRequestStatus() — the first REAL outbound call --------------

  describe('getPullRequestStatus', () => {
    it('fetches the PR and its combined checks status, with real request shape', async () => {
      fetchSpy
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              number: 101,
              state: 'open',
              merged: false,
              merged_at: null,
              html_url: 'https://github.com/acme/widgets/pull/101',
              head: { sha: 'deadbeef' },
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ state: 'success' }), { status: 200 }),
        );

      const result = await client.getPullRequestStatus('acme/widgets', 'ghp_token', 101);

      expect(fetchSpy).toHaveBeenNthCalledWith(
        1,
        'https://api.github.com/repos/acme/widgets/pulls/101',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer ghp_token' }),
          redirect: 'manual',
        }),
      );
      expect(fetchSpy).toHaveBeenNthCalledWith(
        2,
        'https://api.github.com/repos/acme/widgets/commits/deadbeef/status',
        expect.anything(),
      );
      expect(result).toEqual({
        number: 101,
        state: 'open',
        merged: false,
        mergedAt: null,
        checksState: 'success',
        url: 'https://github.com/acme/widgets/pull/101',
      });
    });

    it('reports merged: true and state "closed" for a merged PR', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            number: 102,
            state: 'closed',
            merged: true,
            merged_at: '2026-07-03T12:00:00Z',
            html_url: 'https://github.com/acme/widgets/pull/102',
            head: { sha: null },
          }),
          { status: 200 },
        ),
      );

      const result = await client.getPullRequestStatus('acme/widgets', 'ghp_token', 102);
      expect(result?.merged).toBe(true);
      expect(result?.state).toBe('closed');
      expect(result?.mergedAt).toBe('2026-07-03T12:00:00Z');
      // No head sha → checks lookup skipped, only one fetch call.
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(result?.checksState).toBeNull();
    });

    it('never throws when the checks lookup fails — PR status still returned', async () => {
      fetchSpy
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              number: 103,
              state: 'open',
              merged: false,
              merged_at: null,
              html_url: 'https://github.com/acme/widgets/pull/103',
              head: { sha: 'abc' },
            }),
            { status: 200 },
          ),
        )
        .mockRejectedValueOnce(new Error('checks endpoint down'));

      const result = await client.getPullRequestStatus('acme/widgets', 'ghp_token', 103);
      expect(result?.checksState).toBeNull();
      expect(result?.state).toBe('open');
    });

    it('returns null on a 404 (deleted/renumbered PR)', async () => {
      fetchSpy.mockResolvedValue(new Response('not found', { status: 404 }));
      const result = await client.getPullRequestStatus('acme/widgets', 'ghp_token', 999);
      expect(result).toBeNull();
    });

    it('returns null on a network failure (never throws)', async () => {
      fetchSpy.mockRejectedValue(new Error('network down'));
      const result = await client.getPullRequestStatus('acme/widgets', 'ghp_token', 101);
      expect(result).toBeNull();
    });

    it('is SSRF-guarded: a blocked/unresolvable host short-circuits before fetch', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const dnsModule = require('node:dns') as typeof import('node:dns');
      jest.spyOn(dnsModule.promises, 'lookup').mockRejectedValue(new Error('ENOTFOUND'));

      const result = await client.getPullRequestStatus('acme/widgets', 'ghp_token', 101);
      expect(result).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
