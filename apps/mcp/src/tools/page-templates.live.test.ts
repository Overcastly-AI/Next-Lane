/**
 * Live round-trip for the doc-template tools against a REAL running API.
 *
 * Every other test in this package asserts the tool's method, URL and body in
 * isolation — which cannot tell you whether the API on the other end accepts
 * that request. This one does, and it earned its place: writing it caught two
 * assumptions I had wrong about the template contract (an explicit `title`
 * REPLACES `titleTemplate` rather than feeding `{{title}}` into it, and an
 * update to `content` replaces the body rather than merging), both of which
 * had gone into the tool descriptions the model reads.
 *
 * SKIPPED unless `NL_LIVE_API` names a running instance, because it needs an
 * API and a seeded demo login:
 *
 *   NL_LIVE_API=http://localhost:4000 pnpm --filter @next-lane/mcp test
 */
import { it, expect } from 'vitest';
import { allTools } from './index.js';
import { NextLaneClient } from '../client.js';

const API = process.env.NL_LIVE_API ?? '';
const liveIt = API ? it : it.skip;
function tool(name: string) {
  const t = allTools.find((x) => x.name === name);
  if (!t) throw new Error(`missing ${name}`);
  return t;
}
function text(res: unknown): string {
  return (res as { content: { text: string }[] }).content[0].text;
}

liveIt('doc-template tools work end to end against the real API', async () => {
  const login = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@nextlane.dev', password: 'nextlane' }),
  });
  const { accessToken } = (await login.json()) as { accessToken: string };
  const client = new NextLaneClient({ apiUrl: API, token: accessToken });

  const ws = JSON.parse(text(await tool('list_workspaces').handler({}, client)));
  const workspaceId = (ws.items ?? ws)[0].id;

  const created = JSON.parse(
    text(
      await tool('create_page_template').handler(
        {
          workspaceId,
          name: `Agent ADR ${Date.now()}`,
          description: 'Written by an agent over MCP',
          titleTemplate: 'ADR {{date}}',
          content: '# {{title}}\n\nDate: {{date}}\nAuthor: {{author}}\n\n## Decision\n',
        },
        client,
      ),
    ),
  );
  expect(created.id).toBeTruthy();
  expect(created.projectId).toBeNull();

  // Round-trip: the body comes back in full, which list deliberately omits.
  const got = JSON.parse(text(await tool('get_page_template').handler({ id: created.id }, client)));
  expect(got.content).toContain('## Decision');

  const listed = JSON.parse(
    text(await tool('list_page_templates').handler({ workspaceId }, client)),
  );
  expect(listed.items.some((t: { id: string }) => t.id === created.id)).toBe(true);

  await tool('update_page_template').handler(
    { id: created.id, content: '# {{title}}\n\n## Context\n\n## Decision\n' },
    client,
  );
  const afterUpdate = JSON.parse(
    text(await tool('get_page_template').handler({ id: created.id }, client)),
  );
  expect(afterUpdate.content).toContain('## Context');
  // REPLACES, does not merge — the `Date:` line from the original body is
  // gone. This is why the tool description tells agents to get_page_template
  // before editing content.
  expect(afterUpdate.content).not.toContain('Date:');
  // A field NOT passed to the update is untouched.
  expect(afterUpdate.titleTemplate).toBe('ADR {{date}}');

  // The whole point: stamp a page out of the template an agent just authored,
  // and confirm the tokens actually resolved rather than shipping as literals.
  //
  // Two paths, because they differ: with no `title` the template's own
  // `titleTemplate` supplies it, and an explicit `title` REPLACES that
  // outright (it is not merged into the template).
  const defaultTitled = JSON.parse(
    text(await tool('create_page_from_template').handler({ templateId: created.id }, client)),
  );
  expect(defaultTitled.title).toMatch(/^ADR \d{4}-\d{2}-\d{2}$/);

  const page = JSON.parse(
    text(
      await tool('create_page_from_template').handler(
        { templateId: created.id, title: 'Use Postgres' },
        client,
      ),
    ),
  );
  expect(page.title).toBe('Use Postgres');
  expect(page.content).toContain('# Use Postgres');
  expect(page.content).not.toContain('{{');

  await tool('delete_page_template').handler({ id: created.id }, client);
  await expect(
    tool('get_page_template').handler({ id: created.id }, client),
  ).rejects.toThrow();

  // Deleting the template leaves the page it produced alone.
  const survivor = JSON.parse(text(await tool('get_page').handler({ id: page.id }, client)));
  expect(survivor.title).toBe('Use Postgres');
}, 60_000);
