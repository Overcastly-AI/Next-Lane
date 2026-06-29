import { describe, expect, it, vi } from 'vitest';
import { allTools } from './index.js';
import { NextLaneClient } from '../client.js';
import type { NextLaneConfig } from '../config.js';

const config: NextLaneConfig = {
  apiUrl: 'http://localhost:4000',
  token: 'nlp_secret',
};

function clientWith(status: number, body: unknown) {
  const fetchImpl = vi.fn(async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  return {
    client: new NextLaneClient(config, fetchImpl as unknown as typeof fetch),
    fetchImpl,
  };
}

function tool(name: string) {
  const t = allTools.find((x) => x.name === name);
  if (!t) throw new Error(`tool not found: ${name}`);
  return t;
}

describe('tool registry', () => {
  it('exposes the expected read + write tools with snake_case names', () => {
    const names = allTools.map((t) => t.name);
    const expected = [
      'list_projects',
      'list_workspaces',
      'list_boards',
      'list_statuses',
      'list_workflows',
      'get_workflow',
      'list_issues',
      'get_issue',
      'list_issue_links',
      'list_labels',
      'create_workflow',
      'create_workflow_from_template',
      'update_workflow',
      'delete_workflow',
      'add_workflow_transition',
      'update_workflow_transition',
      'delete_workflow_transition',
      'assign_board_workflow',
      'create_issue',
      'update_issue',
      'set_issue_parent',
      'move_issue',
      'link_issues',
      'unlink_issues',
      'create_label',
      'add_issue_label',
      'remove_issue_label',
    ];
    for (const name of expected) expect(names).toContain(name);
    // No duplicate names.
    expect(new Set(names).size).toBe(names.length);
    // Each tool has a non-empty description and an object input schema.
    for (const t of allTools) {
      expect(t.description.length).toBeGreaterThan(0);
      expect(typeof t.inputSchema).toBe('object');
    }
  });

  it('list_statuses builds the correct project-scoped URL', async () => {
    const { client, fetchImpl } = clientWith(200, [{ id: 's1' }]);
    const res = await tool('list_statuses').handler({ projectId: 'p1' }, client);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'http://localhost:4000/api/projects/p1/statuses',
    );
    expect(res.content[0].text).toContain('s1');
  });

  it('get_workflow targets /workflows/:id', async () => {
    const { client, fetchImpl } = clientWith(200, { id: 'wf1', transitions: [] });
    await tool('get_workflow').handler({ workflowId: 'wf1' }, client);
    expect(fetchImpl.mock.calls[0][0]).toBe('http://localhost:4000/api/workflows/wf1');
  });

  it('create_workflow_from_template POSTs template + name to the right path', async () => {
    const { client, fetchImpl } = clientWith(201, { id: 'wf2' });
    await tool('create_workflow_from_template').handler(
      { projectId: 'p1', template: 'scrum', name: 'Sprint Flow' },
      client,
    );
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/projects/p1/workflows/from-template');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      template: 'scrum',
      name: 'Sprint Flow',
    });
  });

  it('add_workflow_transition POSTs to /workflows/:id/transitions with the body', async () => {
    const { client, fetchImpl } = clientWith(201, { id: 't1' });
    await tool('add_workflow_transition').handler(
      { workflowId: 'wf1', fromStatusId: null, toStatusId: 's2', name: 'Start' },
      client,
    );
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/workflows/wf1/transitions');
    expect((init as RequestInit).method).toBe('POST');
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent).toMatchObject({ fromStatusId: null, toStatusId: 's2', name: 'Start' });
  });

  it('assign_board_workflow PATCHes the board with workflowId', async () => {
    const { client, fetchImpl } = clientWith(200, { id: 'b1', workflowId: 'wf1' });
    await tool('assign_board_workflow').handler(
      { boardId: 'b1', workflowId: 'wf1' },
      client,
    );
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/boards/b1');
    expect((init as RequestInit).method).toBe('PATCH');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      workflowId: 'wf1',
    });
  });

  it('move_issue POSTs to /issues/:id/move', async () => {
    const { client, fetchImpl } = clientWith(200, { id: 'i1' });
    await tool('move_issue').handler(
      { issueId: 'i1', statusId: 's3', boardId: 'b1' },
      client,
    );
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/issues/i1/move');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      statusId: 's3',
      boardId: 'b1',
    });
  });

  it('update_issue PATCHes only the provided fields (parentId set), dropping undefined', async () => {
    const { client, fetchImpl } = clientWith(200, { id: 'i1' });
    await tool('update_issue').handler(
      { issueId: 'i1', parentId: 'epic-9', title: 'Renamed' },
      client,
    );
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/issues/i1');
    expect((init as RequestInit).method).toBe('PATCH');
    // undefined fields are dropped by JSON.stringify; null/explicit values kept.
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      parentId: 'epic-9',
      title: 'Renamed',
    });
  });

  it('set_issue_parent PATCHes parentId:null to detach', async () => {
    const { client, fetchImpl } = clientWith(200, { id: 'i1', parentId: null });
    await tool('set_issue_parent').handler({ issueId: 'i1', parentId: null }, client);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/issues/i1');
    expect((init as RequestInit).method).toBe('PATCH');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ parentId: null });
  });

  it('link_issues POSTs target + type to /issues/:id/links', async () => {
    const { client, fetchImpl } = clientWith(201, { id: 'lk1' });
    await tool('link_issues').handler(
      { issueId: 'i1', target: 'NL-5', type: 'BLOCKS' },
      client,
    );
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/issues/i1/links');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      target: 'NL-5',
      type: 'BLOCKS',
    });
  });

  it('list_issue_links GETs /issues/:id/links', async () => {
    const { client, fetchImpl } = clientWith(200, [{ id: 'lk1', type: 'BLOCKED_BY' }]);
    const res = await tool('list_issue_links').handler({ issueId: 'i1' }, client);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'http://localhost:4000/api/issues/i1/links',
    );
    expect(res.content[0].text).toContain('BLOCKED_BY');
  });

  it('unlink_issues DELETEs /issue-links/:linkId', async () => {
    const { client, fetchImpl } = clientWith(200, null);
    await tool('unlink_issues').handler({ linkId: 'lk1' }, client);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/issue-links/lk1');
    expect((init as RequestInit).method).toBe('DELETE');
  });

  it('add_issue_label POSTs labelId to /issues/:id/labels', async () => {
    const { client, fetchImpl } = clientWith(201, { id: 'lbl1' });
    await tool('add_issue_label').handler({ issueId: 'i1', labelId: 'lbl1' }, client);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/issues/i1/labels');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ labelId: 'lbl1' });
  });

  it('remove_issue_label DELETEs /issues/:id/labels/:labelId', async () => {
    const { client, fetchImpl } = clientWith(200, null);
    await tool('remove_issue_label').handler({ issueId: 'i1', labelId: 'lbl1' }, client);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/issues/i1/labels/lbl1');
    expect((init as RequestInit).method).toBe('DELETE');
  });

  it('create_label POSTs name + color to /projects/:id/labels', async () => {
    const { client, fetchImpl } = clientWith(201, { id: 'lbl2' });
    await tool('create_label').handler(
      { projectId: 'p1', name: 'bug', color: '#ef4444' },
      client,
    );
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/projects/p1/labels');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      name: 'bug',
      color: '#ef4444',
    });
  });

  it('handlers propagate API errors so the server wrapper can mark isError', async () => {
    const { client } = clientWith(403, { message: 'forbidden' });
    await expect(
      tool('delete_workflow').handler({ id: 'wf1' }, client),
    ).rejects.toThrow(/forbidden \[HTTP 403\]/);
  });
});
