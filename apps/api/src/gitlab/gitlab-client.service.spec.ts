import { GitlabClient } from './gitlab-client.service';

// GitlabClient is the single seam through which the API ever calls a live
// GitLab instance. These tests mock global fetch — no live network is ever
// hit, consistent with the network-isolated build/test environment.

describe('GitlabClient', () => {
  let client: GitlabClient;
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    client = new GitlabClient();
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
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
});
