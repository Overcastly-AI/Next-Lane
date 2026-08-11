import { test, expect } from '@playwright/test';
import { registerNewUser, API_URL } from './helpers';

/**
 * What the page RESOLVED, read off the page itself.
 *
 * Not re-derived from the test's environment: the app walks a priority chain
 * (runtime config.js → build-time env → default) that only it has walked, and
 * a test guessing at the answer asserts the wrong branch and passes anyway —
 * which is exactly what happened before this helper existed.
 */
async function resolved(page: any): Promise<{ origin: string; embedded: boolean }> {
  const el = page.getByTestId('api-docs-page');
  await expect(el).toBeVisible({ timeout: 15_000 });
  return {
    origin: (await el.getAttribute('data-api-origin')) ?? '',
    embedded: (await el.getAttribute('data-embedded')) === 'true',
  };
}

/**
 * The API reference as a page in the product.
 *
 * Founder: "I feel like there should be a place to view the swagger docs for
 * the users." It previously existed only as a URL you had to already know, on
 * a port you may have had to forward.
 *
 * The embed is conditional and these tests say so explicitly rather than
 * asserting whichever branch this environment happens to take: the API serves
 * `frame-ancestors 'self'`, so it can only be framed when it is on this exact
 * origin. In the reverse-proxied deployment (the default) that is true and the
 * reference renders inline; when the app is pointed at a separate API origin
 * the iframe would be a blank white box, so the page shows a link and explains
 * why. Both branches are covered, keyed off the same fact the component uses.
 */
async function signIn(page: Parameters<typeof registerNewUser>[0] extends never ? never : any, request: any, label: string) {
  const user = await registerNewUser(request, label);
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(user.email);
  await page.getByLabel(/password/i).fill(user.password);
  await page.getByRole('button', { name: /(log ?in|sign ?in)/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
  return user;
}

test.describe('API reference page', () => {
  test('is reachable from the user menu and explains how to start', async ({
    page,
    request,
  }) => {
    await signIn(page, request, 'apidocpage');

    await page.goto('/developers');
    await expect(page.getByTestId('api-docs-page')).toBeVisible({
      timeout: 15_000,
    });

    // The base URL is computed for THIS install, not hardcoded.
    const { origin } = await resolved(page);
    expect(origin).toBeTruthy();
    await expect(page.getByTestId('api-docs-base-url')).toContainText(origin);

    // The route to a token is on the page, because that is step one.
    await expect(page.getByTestId('api-docs-token-link')).toHaveAttribute(
      'href',
      '/me/settings',
    );

    // The OpenAPI document is offered, and really serves.
    await expect(page.getByTestId('api-docs-spec-link')).toHaveAttribute(
      'href',
      /\/api-json$/,
    );
    // …and it really serves. Driven through the test's own API handle, which
    // reaches the API regardless of how the app is wired.
    const spec = await request.get(`${API_URL}/api-json`);
    expect(spec.status()).toBe(200);
  });

  /**
   * The document must DESCRIBE the API, not just list it.
   *
   * Founder: "None of the DTOs are showing in swagger. Also I don't know how
   * to format the body." The reference had been serving 89 schemas that were
   * every one of them `{"type": "object", "properties": {}}` — the DTO names
   * were there, none of their fields were, so `POST /api/issues` documented a
   * body you could not write. The cause was a missing `@nestjs/swagger` CLI
   * plugin in `apps/api/nest-cli.json`; the symptom was a 200 from /api-json
   * and a reference that looked fine at a glance, which is why "the spec
   * serves" was not enough of a test.
   *
   * This asserts the property-level content, so removing the plugin (or
   * setting tsconfig's `removeComments` back to true, which silently drops the
   * descriptions) fails here rather than in someone's editor at 2am.
   */
  test('documents request bodies field by field, not just DTO names', async ({
    request,
  }) => {
    const res = await request.get(`${API_URL}/api-json`);
    expect(res.status()).toBe(200);
    const spec = await res.json();

    const schemas: Record<string, any> = spec.components?.schemas ?? {};
    const names = Object.keys(schemas);
    expect(names.length).toBeGreaterThan(50);

    // Not one schema may be an empty shell. This is the exact defect.
    const empty = names.filter(
      (n) => Object.keys(schemas[n].properties ?? {}).length === 0,
    );
    expect(
      empty,
      `these schemas document no fields at all — is the @nestjs/swagger plugin still enabled in apps/api/nest-cli.json?`,
    ).toEqual([]);

    // Spot-check the one the founder hit, down to the details a body author
    // needs: which fields exist, their types, which are mandatory, and what an
    // enum will actually accept.
    const create = schemas.CreateIssueDto;
    expect(create).toBeTruthy();
    expect(Object.keys(create.properties)).toEqual(
      expect.arrayContaining(['projectId', 'title', 'type', 'priority']),
    );
    expect(create.required).toEqual(
      expect.arrayContaining(['projectId', 'title']),
    );
    expect(create.properties.title.type).toBe('string');
    expect(create.properties.type.enum).toEqual(
      expect.arrayContaining(['TASK', 'BUG', 'STORY', 'EPIC']),
    );
    // class-validator limits carried through, so the doc says what will 400.
    expect(create.properties.title.maxLength).toBeGreaterThan(0);
    // A JSDoc'd property keeps its prose — the `removeComments` half of the fix.
    expect(create.properties.idempotencyKey.description).toBeTruthy();

    // And the route points at it.
    const body =
      spec.paths['/api/issues'].post.requestBody.content['application/json'];
    expect(body.schema.$ref).toBe('#/components/schemas/CreateIssueDto');

    // Auth is described in terms a script author can act on: this API is
    // driven with a PAT, not the JWT the default scheme claimed.
    const bearer = spec.components.securitySchemes.bearer;
    expect(bearer.scheme).toBe('bearer');
    expect(`${bearer.bearerFormat} ${bearer.description}`).toContain('nlp_');
  });

  /**
   * Every path the document publishes must be REACHABLE where the reference
   * calls it.
   *
   * Founder: "when running the API from swagger I get html as the response
   * body. Example /health calls url/health." Swagger's "Try it out" issues its
   * requests against the app's own origin, and `main.ts` excludes `health` and
   * `health/live` from the `/api` global prefix so probes can reach them at
   * the root — which made them the only documented paths NOT covered by the
   * `/api/` proxy rule every deployment has. All three proxies got it wrong in
   * the same way: the dev server did not forward `/health` at all, and both
   * nginx configs used `location = /health`, an exact match that cannot match
   * `/health/live`. None of them 404'd — the SPA fallback answered with
   * index.html and a 200, so the reference reported `text/html` for a route
   * that returns JSON.
   *
   * Derived from the live document rather than a hardcoded list: a new route
   * added outside the prefix is covered here the day it appears.
   */
  test('every documented path outside /api is routed on the app origin', async ({
    request,
    baseURL,
  }) => {
    const spec = await (await request.get(`${API_URL}/api-json`)).json();
    const outside = Object.keys(spec.paths).filter((p) => !p.startsWith('/api'));

    // The document is supposed to publish some of these; if it stops, this
    // test has quietly become a no-op and should be revisited, not deleted.
    expect(
      outside,
      'no paths outside the /api prefix — has setGlobalPrefix stopped excluding /health?',
    ).not.toEqual([]);

    /*
     * Gate on whether this origin proxies the API AT ALL, probed directly —
     * not on whether the app is *configured* to call the API here.
     *
     * The first version of this test gated on the /developers page's
     * `data-embedded` flag and skipped in every local run, because the dev
     * setup points the app at an absolute API origin while Vite still proxies
     * the same-origin paths. Those are two different facts, and keying off the
     * wrong one is how a routing test quietly stops testing routing.
     */
    const probe = await request.get(new URL('/api-json', baseURL!).toString());
    const proxied = (probe.headers()['content-type'] ?? '').includes('json');
    test.skip(
      !proxied,
      'this origin does not reverse-proxy the API (no API_PROXY_UPSTREAM / dev proxy), so these paths are not expected to resolve here',
    );

    for (const path of outside) {
      const res = await request.get(new URL(path, baseURL!).toString());
      const type = res.headers()['content-type'] ?? '';
      expect(
        type,
        `GET ${path} on the app origin returned "${type}". HTML means it fell through to the SPA fallback instead of reaching the API — check the proxies in vite.config.ts, docker-entrypoint.sh and the Helm ConfigMap, and note that an exact 'location = /health' cannot match a subpath.`,
      ).toContain('application/json');
      expect(res.status()).toBeLessThan(400);
    }
  });

  test('offers runnable snippets and switches language', async ({
    page,
    request,
  }) => {
    await signIn(page, request, 'apidocsnip');
    await page.goto('/developers');

    const snippet = page.getByTestId('api-docs-snippet');
    await expect(snippet).toContainText('curl');
    await expect(snippet).toContainText('Authorization: Bearer');

    await page.getByTestId('api-docs-lang-python').click();
    await expect(snippet).toContainText('import os, requests');
    // The snippet names this install's base URL — a copied example that points
    // at the wrong host is worse than none.
    const { origin } = await resolved(page);
    await expect(snippet).toContainText(origin);

    await page.getByTestId('api-docs-lang-node').click();
    await expect(snippet).toContainText('fetch(');
  });

  test('embeds the reference when the API is same-origin, links out when not', async ({
    page,
    request,
  }) => {
    await signIn(page, request, 'apidocframe');
    await page.goto('/developers');
    await expect(page.getByTestId('api-docs-page')).toBeVisible({
      timeout: 15_000,
    });

    const { embedded } = await resolved(page);

    if (embedded) {
      // Framed — and the frame must actually render Swagger, not a blank box.
      const frame = page.getByTestId('api-docs-frame');
      await expect(frame).toBeVisible();
      const swagger = page.frameLocator('[data-testid="api-docs-frame"]');
      await expect(swagger.locator('.swagger-ui').first()).toBeVisible({
        timeout: 20_000,
      });
      // Not just a shell: the operations really rendered inside the frame.
      await expect(swagger.locator('.opblock').first()).toBeVisible({
        timeout: 20_000,
      });
    } else {
      // Not framed, and the page says why rather than showing an empty pane.
      await expect(page.getByTestId('api-docs-cross-origin-note')).toBeVisible();
      await expect(page.getByTestId('api-docs-frame')).toHaveCount(0);
    }

    // Either way there is an escape hatch to the real thing.
    await expect(page.getByTestId('api-docs-open-new-tab')).toBeVisible();
  });
});
