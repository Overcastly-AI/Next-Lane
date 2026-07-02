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
      'list_users',
      'search_issues',
      'list_sprints',
      'list_components',
      'list_versions',
      'list_custom_fields',
      'list_comments',
      'list_worklogs',
      'list_checklist',
      'list_saved_filters',
      'list_automations',
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
      'add_comment',
      'delete_issue',
      'create_sprint',
      'update_sprint',
      'create_component',
      'create_version',
      'set_issue_versions',
      'add_worklog',
      'add_checklist_item',
      'update_checklist_item',
      'create_status',
      'update_status',
      'create_board',
      'update_board',
      'create_saved_filter',
      'create_custom_field',
      'create_automation',
      // MCP coverage parity sweep (2026-07-02)
      'list_issue_github_links',
      'list_quick_links',
      'get_personal_board',
      'list_issue_templates',
      'get_project_analytics',
      'get_my_analytics',
      'get_velocity_report',
      'get_burndown_report',
      'get_cfd_report',
      'list_notifications',
      'get_unread_notification_count',
      'get_project_csv',
      'create_quick_link',
      'update_quick_link',
      'delete_quick_link',
      'create_personal_card',
      'update_personal_card',
      'create_issue_from_template',
      'bulk_update_issues',
      'mark_notification_read',
      'mark_all_notifications_read',
      // Configurable dashboards — Phase 1 (2026-07-02)
      'list_dashboards',
      'get_dashboard',
      'get_dashboard_data',
      'create_dashboard',
      'update_dashboard',
      'delete_dashboard',
      'create_dashboard_gadget',
      'update_dashboard_gadget',
      'delete_dashboard_gadget',
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

  it('add_comment POSTs body to /issues/:id/comments', async () => {
    const { client, fetchImpl } = clientWith(201, { id: 'c1' });
    await tool('add_comment').handler({ issueId: 'i1', body: 'looks good' }, client);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/issues/i1/comments');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ body: 'looks good' });
  });

  it('create_sprint POSTs to /projects/:id/sprints', async () => {
    const { client, fetchImpl } = clientWith(201, { id: 's1' });
    await tool('create_sprint').handler(
      { projectId: 'p1', name: 'Sprint 1', goal: 'ship' },
      client,
    );
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/projects/p1/sprints');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      name: 'Sprint 1',
      goal: 'ship',
    });
  });

  it('set_issue_versions PUTs versionIds to /issues/:id/versions', async () => {
    const { client, fetchImpl } = clientWith(200, { id: 'i1' });
    await tool('set_issue_versions').handler(
      { issueId: 'i1', versionIds: ['v1', 'v2'] },
      client,
    );
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/issues/i1/versions');
    expect((init as RequestInit).method).toBe('PUT');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      versionIds: ['v1', 'v2'],
    });
  });

  it('search_issues GETs /search with q + projectId query', async () => {
    const { client, fetchImpl } = clientWith(200, []);
    await tool('search_issues').handler({ q: 'login bug', projectId: 'p1' }, client);
    const url = fetchImpl.mock.calls[0][0] as string;
    expect(url).toContain('http://localhost:4000/api/search?');
    expect(url).toContain('q=login+bug');
    expect(url).toContain('projectId=p1');
  });

  it('add_worklog POSTs minutes to /issues/:id/worklogs', async () => {
    const { client, fetchImpl } = clientWith(201, { id: 'wl1' });
    await tool('add_worklog').handler({ issueId: 'i1', minutes: 30, note: 'fix' }, client);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/issues/i1/worklogs');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ minutes: 30, note: 'fix' });
  });

  it('list_issue_github_links GETs /issues/:id/github-links', async () => {
    const { client, fetchImpl } = clientWith(200, [{ id: 'gl1', kind: 'PR' }]);
    const res = await tool('list_issue_github_links').handler({ issueId: 'i1' }, client);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'http://localhost:4000/api/issues/i1/github-links',
    );
    expect(res.content[0].text).toContain('gl1');
  });

  it('list_quick_links GETs /me/quick-links', async () => {
    const { client, fetchImpl } = clientWith(200, [{ id: 'ql1' }]);
    await tool('list_quick_links').handler({}, client);
    expect(fetchImpl.mock.calls[0][0]).toBe('http://localhost:4000/api/me/quick-links');
  });

  it('get_personal_board GETs /me/personal-board', async () => {
    const { client, fetchImpl } = clientWith(200, { columns: [] });
    await tool('get_personal_board').handler({}, client);
    expect(fetchImpl.mock.calls[0][0]).toBe('http://localhost:4000/api/me/personal-board');
  });

  it('list_issue_templates GETs /projects/:id/issue-templates', async () => {
    const { client, fetchImpl } = clientWith(200, [{ id: 'tpl1' }]);
    await tool('list_issue_templates').handler({ projectId: 'p1' }, client);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'http://localhost:4000/api/projects/p1/issue-templates',
    );
  });

  it('get_project_analytics GETs /projects/:id/analytics with days query', async () => {
    const { client, fetchImpl } = clientWith(200, { throughput: 5 });
    await tool('get_project_analytics').handler({ projectId: 'p1', days: 14 }, client);
    const url = fetchImpl.mock.calls[0][0] as string;
    expect(url).toBe('http://localhost:4000/api/projects/p1/analytics?days=14');
  });

  it('get_my_analytics GETs /me/analytics', async () => {
    const { client, fetchImpl } = clientWith(200, { throughput: 2 });
    await tool('get_my_analytics').handler({}, client);
    expect(fetchImpl.mock.calls[0][0]).toBe('http://localhost:4000/api/me/analytics');
  });

  it('get_velocity_report GETs /projects/:id/reports/velocity', async () => {
    const { client, fetchImpl } = clientWith(200, []);
    await tool('get_velocity_report').handler({ projectId: 'p1' }, client);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'http://localhost:4000/api/projects/p1/reports/velocity',
    );
  });

  it('get_burndown_report GETs /projects/:id/sprints/:id/burndown', async () => {
    const { client, fetchImpl } = clientWith(200, {});
    await tool('get_burndown_report').handler({ projectId: 'p1', sprintId: 's1' }, client);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'http://localhost:4000/api/projects/p1/sprints/s1/burndown',
    );
  });

  it('get_cfd_report GETs /projects/:id/reports/cfd with days query', async () => {
    const { client, fetchImpl } = clientWith(200, []);
    await tool('get_cfd_report').handler({ projectId: 'p1', days: 7 }, client);
    const url = fetchImpl.mock.calls[0][0] as string;
    expect(url).toBe('http://localhost:4000/api/projects/p1/reports/cfd?days=7');
  });

  it('list_notifications GETs /notifications', async () => {
    const { client, fetchImpl } = clientWith(200, []);
    await tool('list_notifications').handler({}, client);
    expect(fetchImpl.mock.calls[0][0]).toBe('http://localhost:4000/api/notifications');
  });

  it('get_unread_notification_count GETs /notifications/unread-count', async () => {
    const { client, fetchImpl } = clientWith(200, { count: 3 });
    await tool('get_unread_notification_count').handler({}, client);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'http://localhost:4000/api/notifications/unread-count',
    );
  });

  it('get_project_csv GETs the .csv route and returns raw text (not JSON-wrapped)', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('key,title\nNL-1,Fix bug\n', {
        status: 200,
        headers: { 'Content-Type': 'text/csv; charset=utf-8' },
      }),
    );
    const client = new NextLaneClient(config, fetchImpl as unknown as typeof fetch);
    const res = await tool('get_project_csv').handler({ projectId: 'p1', q: 'status = Done' }, client);
    const url = fetchImpl.mock.calls[0][0] as string;
    expect(url).toContain('http://localhost:4000/api/projects/p1/issues.csv?');
    expect(url).toContain('q=status');
    expect(res.content[0].text).toBe('key,title\nNL-1,Fix bug\n');
  });

  it('create_quick_link POSTs to /me/quick-links', async () => {
    const { client, fetchImpl } = clientWith(201, { id: 'ql1' });
    await tool('create_quick_link').handler({ label: 'Runbook', url: 'https://ex.com' }, client);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/me/quick-links');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      label: 'Runbook',
      url: 'https://ex.com',
    });
  });

  it('update_quick_link PATCHes /me/quick-links/:id', async () => {
    const { client, fetchImpl } = clientWith(200, { id: 'ql1' });
    await tool('update_quick_link').handler({ id: 'ql1', order: 2 }, client);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/me/quick-links/ql1');
    expect((init as RequestInit).method).toBe('PATCH');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ order: 2 });
  });

  it('delete_quick_link DELETEs /me/quick-links/:id', async () => {
    const { client, fetchImpl } = clientWith(200, null);
    await tool('delete_quick_link').handler({ id: 'ql1' }, client);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/me/quick-links/ql1');
    expect((init as RequestInit).method).toBe('DELETE');
  });

  it('create_personal_card POSTs to /me/personal-cards', async () => {
    const { client, fetchImpl } = clientWith(201, { id: 'pc1' });
    await tool('create_personal_card').handler({ columnId: 'col1', title: 'Read RFC' }, client);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/me/personal-cards');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      columnId: 'col1',
      title: 'Read RFC',
    });
  });

  it('update_personal_card PATCHes /me/personal-cards/:id with move fields', async () => {
    const { client, fetchImpl } = clientWith(200, { id: 'pc1' });
    await tool('update_personal_card').handler(
      { id: 'pc1', columnId: 'col2', afterId: 'pc0' },
      client,
    );
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/me/personal-cards/pc1');
    expect((init as RequestInit).method).toBe('PATCH');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      columnId: 'col2',
      afterId: 'pc0',
    });
  });

  it('create_issue_from_template POSTs to /issue-templates/:id/create-issue', async () => {
    const { client, fetchImpl } = clientWith(201, { id: 'i9' });
    await tool('create_issue_from_template').handler(
      { templateId: 'tpl1', title: 'Override title' },
      client,
    );
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/issue-templates/tpl1/create-issue');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      title: 'Override title',
    });
  });

  it('bulk_update_issues POSTs ids + changes to /issues/bulk', async () => {
    const { client, fetchImpl } = clientWith(200, { updated: 2, failed: [] });
    await tool('bulk_update_issues').handler(
      { ids: ['i1', 'i2'], statusId: 's1', assigneeId: null },
      client,
    );
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/issues/bulk');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      ids: ['i1', 'i2'],
      changes: { statusId: 's1', assigneeId: null },
    });
  });

  it('mark_notification_read POSTs to /notifications/:id/read', async () => {
    const { client, fetchImpl } = clientWith(200, { id: 'n1', read: true });
    await tool('mark_notification_read').handler({ id: 'n1' }, client);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/notifications/n1/read');
    expect((init as RequestInit).method).toBe('POST');
  });

  it('mark_all_notifications_read POSTs to /notifications/read-all', async () => {
    const { client, fetchImpl } = clientWith(200, { updated: 4 });
    await tool('mark_all_notifications_read').handler({}, client);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/notifications/read-all');
    expect((init as RequestInit).method).toBe('POST');
  });

  it('update_issue PATCHes originalEstimateMinutes (including null-to-clear)', async () => {
    const { client, fetchImpl } = clientWith(200, { id: 'i1' });
    await tool('update_issue').handler(
      { issueId: 'i1', originalEstimateMinutes: null },
      client,
    );
    const [, init] = fetchImpl.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      originalEstimateMinutes: null,
    });
  });

  it('handlers propagate API errors so the server wrapper can mark isError', async () => {
    const { client } = clientWith(403, { message: 'forbidden' });
    await expect(
      tool('delete_workflow').handler({ id: 'wf1' }, client),
    ).rejects.toThrow(/forbidden \[HTTP 403\]/);
  });

  it('list_dashboards builds the correct project-scoped URL', async () => {
    const { client, fetchImpl } = clientWith(200, [{ id: 'd1' }]);
    await tool('list_dashboards').handler({ projectId: 'p1' }, client);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'http://localhost:4000/api/projects/p1/dashboards',
    );
  });

  it('get_dashboard_data GETs /dashboards/:id/data', async () => {
    const { client, fetchImpl } = clientWith(200, { dashboardId: 'd1', gadgets: [] });
    await tool('get_dashboard_data').handler({ dashboardId: 'd1' }, client);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'http://localhost:4000/api/dashboards/d1/data',
    );
  });

  it('create_dashboard POSTs name to /projects/:id/dashboards', async () => {
    const { client, fetchImpl } = clientWith(200, { id: 'd1' });
    await tool('create_dashboard').handler({ projectId: 'p1', name: 'Team overview' }, client);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/projects/p1/dashboards');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      name: 'Team overview',
    });
  });

  it('create_dashboard_gadget POSTs query + visualization + config to /dashboards/:id/gadgets', async () => {
    const { client, fetchImpl } = clientWith(200, { id: 'g1' });
    await tool('create_dashboard_gadget').handler(
      {
        dashboardId: 'd1',
        title: 'By status',
        query: 'status != Done',
        visualization: 'BREAKDOWN',
        config: { field: 'status' },
      },
      client,
    );
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/dashboards/d1/gadgets');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      title: 'By status',
      query: 'status != Done',
      visualization: 'BREAKDOWN',
      config: { field: 'status' },
    });
  });

  it('update_dashboard_gadget PATCHes /gadgets/:id', async () => {
    const { client, fetchImpl } = clientWith(200, { id: 'g1' });
    await tool('update_dashboard_gadget').handler({ id: 'g1', title: 'Renamed' }, client);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/gadgets/g1');
    expect((init as RequestInit).method).toBe('PATCH');
  });

  it('delete_dashboard_gadget DELETEs /gadgets/:id', async () => {
    const { client, fetchImpl } = clientWith(200, null);
    await tool('delete_dashboard_gadget').handler({ id: 'g1' }, client);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/gadgets/g1');
    expect((init as RequestInit).method).toBe('DELETE');
  });
});
