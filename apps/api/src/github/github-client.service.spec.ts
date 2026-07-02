import { GithubClient } from './github-client.service';

// GithubClient is the single seam through which the API ever calls
// github.com. These tests mock global fetch — no live network is ever hit,
// consistent with the network-isolated build/test environment.

describe('GithubClient', () => {
  let client: GithubClient;
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    client = new GithubClient();
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
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
});
