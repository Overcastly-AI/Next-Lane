import { test, expect, type APIRequestContext } from '@playwright/test';
import { API_URL, setupIsolatedProject } from './helpers';

/**
 * The documented response shapes are checked against REAL payloads.
 *
 * Request bodies were fixed first (the `@nestjs/swagger` plugin synthesises
 * those from the DTO classes). Responses could not follow the same route: the
 * handlers return shapes declared in `packages/shared/src/types.ts` as
 * TypeScript *interfaces*, which are erased at compile time, so 199 of 253
 * operations documented their response as a bare `{"type": "object"}` — the
 * reference said what to send and nothing about what came back.
 *
 * `apps/api/src/common/dto/api-responses.dto.ts` fixes that with classes, and
 * two compiler mechanisms stop those classes drifting from the shared
 * interfaces (`implements`, plus an `AssertDocumented` type that also catches
 * a missed OPTIONAL field).
 *
 * But the compiler can only prove the classes match the INTERFACES. Nothing in
 * TypeScript proves the interfaces match what the server actually serialises —
 * a service that spreads an extra column into its return value satisfies the
 * type and ships an undocumented field. That is the gap this closes, and it is
 * the gap that matters, because a response schema which is confidently wrong
 * is worse than none: a generated client fails at runtime instead of at
 * generation.
 *
 * So: drive the real endpoints, then assert every key in the real JSON is a
 * key the document describes.
 */
function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** Follow a local `#/components/schemas/X` reference. */
function deref(spec: any, schema: any): any {
  let s = schema;
  // `allOf: [{$ref}]` is how the plugin wraps a $ref that also carries a
  // description — unwrap it or every described object looks undocumented.
  if (s?.allOf?.length === 1 && Object.keys(s).every((k) => k === 'allOf' || k === 'description')) {
    s = s.allOf[0];
  }
  if (!s?.$ref) return s;
  const name = String(s.$ref).replace('#/components/schemas/', '');
  return spec.components.schemas[name];
}

/**
 * Every key present in `payload` that `schema` does not describe, walked
 * recursively so a nested `status` or `author` object is checked too.
 *
 * Only reports EXTRA keys. A documented field that this particular payload
 * omits is legitimate — plenty are optional by endpoint — and asserting the
 * other direction would fail on correct data.
 */
function undocumentedKeys(
  spec: any,
  schema: any,
  payload: unknown,
  path = '',
): string[] {
  const s = deref(spec, schema);
  if (!s || payload === null || payload === undefined) return [];

  if (Array.isArray(payload)) {
    const item = s.items;
    if (!item) return [];
    return payload.flatMap((el, i) =>
      undocumentedKeys(spec, item, el, `${path}[${i}]`),
    );
  }

  if (typeof payload !== 'object') return [];

  // A free-form map (customFields) documents no properties on purpose.
  const props = s.properties;
  if (!props) return [];

  const out: string[] = [];
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (!(key in props)) {
      out.push(path ? `${path}.${key}` : key);
      continue;
    }
    out.push(...undocumentedKeys(spec, props[key], value, path ? `${path}.${key}` : key));
  }
  return out;
}

/** The documented 2xx JSON schema for one operation, or null if undocumented. */
function responseSchema(spec: any, method: string, apiPath: string): any {
  const op = spec.paths?.[apiPath]?.[method];
  if (!op) throw new Error(`no such operation in the document: ${method.toUpperCase()} ${apiPath}`);
  for (const code of ['200', '201']) {
    const sch = op.responses?.[code]?.content?.['application/json']?.schema;
    if (sch) return sch;
  }
  return null;
}

async function getJson(
  request: APIRequestContext,
  token: string,
  url: string,
): Promise<any> {
  const res = await request.get(url, { headers: auth(token) });
  expect(res.ok(), `${url} -> ${res.status()}`).toBeTruthy();
  return res.json();
}

test.describe('documented response schemas match the real payloads', () => {
  test('the core read surface is documented, field for field', async ({
    page,
    request,
  }) => {
    const { token, project, workspaceId } = await setupIsolatedProject(
      page,
      request,
      { label: 'respsch', projectName: 'Response Schemas QA', openBoard: false },
    );

    // Seed something with as many populated relations as possible, so the
    // comparison has real nested objects to walk rather than a bare skeleton.
    const created = await request.post(`${API_URL}/api/issues`, {
      headers: auth(token),
      data: {
        projectId: project.id,
        type: 'STORY',
        title: 'Schema probe',
        description: 'Body for the probe',
        priority: 'HIGH',
        storyPoints: 3,
      },
    });
    expect(created.ok(), `create issue -> ${created.status()}`).toBeTruthy();
    const issue = await created.json();

    const commented = await request.post(
      `${API_URL}/api/issues/${issue.id}/comments`,
      { headers: auth(token), data: { body: 'A comment, so the list is not empty.' } },
    );
    expect(commented.ok(), `comment -> ${commented.status()}`).toBeTruthy();

    const spec = await getJson(request, token, `${API_URL}/api-json`);

    const probes: { method: string; docPath: string; url: string }[] = [
      { method: 'get', docPath: '/api/issues', url: `${API_URL}/api/issues?projectId=${project.id}` },
      { method: 'get', docPath: '/api/issues/{id}', url: `${API_URL}/api/issues/${issue.id}` },
      { method: 'get', docPath: '/api/projects', url: `${API_URL}/api/projects?workspaceId=${workspaceId}` },
      { method: 'get', docPath: '/api/projects/{id}', url: `${API_URL}/api/projects/${project.id}` },
      { method: 'get', docPath: '/api/workspaces', url: `${API_URL}/api/workspaces` },
      { method: 'get', docPath: '/api/workspaces/{id}', url: `${API_URL}/api/workspaces/${workspaceId}` },
      { method: 'get', docPath: '/api/projects/{projectId}/sprints', url: `${API_URL}/api/projects/${project.id}/sprints` },
      { method: 'get', docPath: '/api/issues/{issueId}/comments', url: `${API_URL}/api/issues/${issue.id}/comments` },
    ];

    for (const probe of probes) {
      const schema = responseSchema(spec, probe.method, probe.docPath);
      expect(
        schema,
        `${probe.method.toUpperCase()} ${probe.docPath} documents no JSON response at all — add an @ApiOkResponse({ type: … })`,
      ).toBeTruthy();

      // A bare `{"type":"object"}` with no properties is the pre-fix state.
      // It technically "has a schema", so assert it actually describes fields.
      const resolved = deref(spec, schema);
      const describesFields =
        !!resolved?.properties || !!deref(spec, resolved?.items)?.properties;
      expect(
        describesFields,
        `${probe.method.toUpperCase()} ${probe.docPath} has a response schema that documents no fields — that is the empty-object state this work exists to remove`,
      ).toBeTruthy();

      const payload = await getJson(request, token, probe.url);
      const extra = undocumentedKeys(spec, schema, payload);
      expect(
        extra,
        `${probe.method.toUpperCase()} ${probe.docPath} returned fields the OpenAPI document does not describe. Add them to apps/api/src/common/dto/api-responses.dto.ts (and to the shared interface if it is missing there too).`,
      ).toEqual([]);
    }
  });

  test('the paginated list really is {items, nextCursor}, as documented', async ({
    page,
    request,
  }) => {
    const { token, project } = await setupIsolatedProject(page, request, {
      label: 'respsch-pag',
      projectName: 'Pagination QA',
      openBoard: false,
    });
    for (const n of [1, 2, 3]) {
      const r = await request.post(`${API_URL}/api/issues`, {
        headers: auth(token),
        data: { projectId: project.id, type: 'TASK', title: `Paged ${n}` },
      });
      expect(r.ok()).toBeTruthy();
    }

    /*
     * This shape is the reason the published Python and Node examples on
     * /developers were broken: both iterated the response directly, so one
     * looped the two string keys and the other called `.map` on an object.
     * The document now says so, and this holds the document to it.
     */
    const page1 = await getJson(
      request,
      token,
      `${API_URL}/api/issues?projectId=${project.id}&limit=2`,
    );
    expect(Array.isArray(page1)).toBe(false);
    expect(Object.keys(page1).sort()).toEqual(['items', 'nextCursor']);
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).toBeTruthy();

    // …and the cursor the document tells you to send actually works.
    const page2 = await getJson(
      request,
      token,
      `${API_URL}/api/issues?projectId=${project.id}&limit=2&cursor=${encodeURIComponent(page1.nextCursor)}`,
    );
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();

    const seen = [...page1.items, ...page2.items].map((i: any) => i.title).sort();
    expect(seen).toEqual(['Paged 1', 'Paged 2', 'Paged 3']);
  });
});
