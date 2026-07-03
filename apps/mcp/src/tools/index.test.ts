import { afterEach, describe, expect, it, vi } from 'vitest';
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
      // GitLab integration v1 (2026-07-03)
      'list_issue_gitlab_links',
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
      // Per-project role override — schema + backend (2026-07-02)
      'list_project_role_overrides',
      'set_project_role_override',
      'remove_project_role_override',
      // Agent Experience (AX) batch, Phase B — MCP ergonomics sweep (2026-07-03)
      'get_epic_overview',
      // Per-project agent context memory (founder directive, 2026-07-03)
      'get_project_context',
      'update_project_context',
      // Agent Experience Round 2 (founder-relayed field report #2, 2026-07-03)
      'create_workspace',
      'create_project',
      'update_comment',
      'delete_comment',
      'list_project_activity',
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
    const { client, fetchImpl } = clientWith(200, { issues: [], projects: [] });
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

  it('list_issue_gitlab_links GETs /issues/:id/gitlab-links', async () => {
    const { client, fetchImpl } = clientWith(200, [{ id: 'gll1', kind: 'MR' }]);
    const res = await tool('list_issue_gitlab_links').handler({ issueId: 'i1' }, client);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'http://localhost:4000/api/issues/i1/gitlab-links',
    );
    expect(res.content[0].text).toContain('gll1');
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
    const { client, fetchImpl } = clientWith(200, { items: [], unreadCount: 0 });
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

  it('bulk_update_issues passes parentId, atomic, and dryRun through to the body (criteria 3 & 4)', async () => {
    const { client, fetchImpl } = clientWith(200, {
      updated: 0,
      failed: [],
      atomic: true,
      dryRun: true,
      wouldUpdate: ['i1', 'i2', 'i3'],
    });
    const res = await tool('bulk_update_issues').handler(
      { ids: ['i1', 'i2', 'i3'], parentId: 'epic-1', atomic: true, dryRun: true },
      client,
    );
    const [, init] = fetchImpl.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      ids: ['i1', 'i2', 'i3'],
      changes: { parentId: 'epic-1' },
      atomic: true,
      dryRun: true,
    });
    const body = JSON.parse(res.content[0].text);
    expect(body.wouldUpdate).toEqual(['i1', 'i2', 'i3']);
  });

  it('bulk_update_issues supports null parentId (detach)', async () => {
    const { client, fetchImpl } = clientWith(200, { updated: 1, failed: [] });
    await tool('bulk_update_issues').handler({ ids: ['i1'], parentId: null }, client);
    const [, init] = fetchImpl.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      ids: ['i1'],
      changes: { parentId: null },
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

  it('list_project_role_overrides GETs /projects/:id/members', async () => {
    const { client, fetchImpl } = clientWith(200, [
      { userId: 'u1', workspaceRole: 'MEMBER', effectiveRole: 'ADMIN', isOverride: true },
    ]);
    const res = await tool('list_project_role_overrides').handler({ projectId: 'p1' }, client);
    expect(fetchImpl.mock.calls[0][0]).toBe('http://localhost:4000/api/projects/p1/members');
    expect(res.content[0].text).toContain('isOverride');
  });

  it('set_project_role_override PUTs role to /projects/:id/members/:userId/role', async () => {
    const { client, fetchImpl } = clientWith(200, {
      userId: 'u1',
      effectiveRole: 'ADMIN',
      isOverride: true,
    });
    await tool('set_project_role_override').handler(
      { projectId: 'p1', userId: 'u1', role: 'ADMIN' },
      client,
    );
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/projects/p1/members/u1/role');
    expect((init as RequestInit).method).toBe('PUT');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ role: 'ADMIN' });
  });

  it('remove_project_role_override DELETEs /projects/:id/members/:userId/role', async () => {
    const { client, fetchImpl } = clientWith(200, {
      userId: 'u1',
      effectiveRole: 'MEMBER',
      isOverride: false,
    });
    await tool('remove_project_role_override').handler({ projectId: 'p1', userId: 'u1' }, client);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/projects/p1/members/u1/role');
    expect((init as RequestInit).method).toBe('DELETE');
  });

  // ── Agent Experience (AX) batch, Phase B — MCP ergonomics sweep ───────────

  /** A fetch stub that returns a different canned response per successive call. */
  function sequencedClient(
    responses: { status: number; body: unknown; contentType?: string }[],
  ) {
    let i = 0;
    const fetchImpl = vi.fn(async () => {
      const r = responses[Math.min(i, responses.length - 1)];
      i++;
      return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), {
        status: r.status,
        headers: { 'Content-Type': r.contentType ?? 'application/json' },
      });
    });
    return { client: new NextLaneClient(config, fetchImpl as unknown as typeof fetch), fetchImpl };
  }

  const fullIssue = (overrides: Record<string, unknown> = {}) => ({
    id: 'i-full-1',
    key: 'NL-1',
    title: 'Fix the login bug',
    description: 'Long description text that would bloat a compact listing...',
    type: 'BUG',
    priority: 'HIGH',
    statusId: 's-inprog',
    status: { id: 's-inprog', name: 'In Progress', category: 'IN_PROGRESS' },
    assigneeId: 'u1',
    assignee: { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' },
    labels: [{ id: 'l1', name: 'urgent', color: '#ef4444' }],
    customFields: { cf1: 'x' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  });

  it('list_issues (default mode) returns compact fields by default, full DTO with verbose:true', async () => {
    const { client, fetchImpl } = clientWith(200, {
      items: [fullIssue()],
      nextCursor: null,
    });

    const compact = await tool('list_issues').handler({ projectId: 'p1' }, client);
    const compactBody = JSON.parse(compact.content[0].text);
    expect(compactBody.items).toEqual([
      { key: 'NL-1', title: 'Fix the login bug', status: 'In Progress', assignee: 'Ada Lovelace', priority: 'HIGH', type: 'BUG' },
    ]);
    expect(compactBody.hasMore).toBe(false);
    // Compact output must not leak the bulky fields the field report complained about.
    expect(compact.content[0].text).not.toContain('description');
    expect(compact.content[0].text).not.toContain('customFields');

    const verbose = await tool('list_issues').handler({ projectId: 'p1', verbose: true }, client);
    const verboseBody = JSON.parse(verbose.content[0].text);
    expect(verboseBody.items[0]).toMatchObject({ id: 'i-full-1', description: expect.any(String) });

    expect(fetchImpl.mock.calls[0][0]).toContain('/api/issues?projectId=p1');
  });

  it('list_issues (default mode) forwards limit/cursor to GET /issues', async () => {
    const { client, fetchImpl } = clientWith(200, { items: [], nextCursor: 'cur2' });
    const res = await tool('list_issues').handler(
      { projectId: 'p1', limit: 10, cursor: 'cur1' },
      client,
    );
    const url = fetchImpl.mock.calls[0][0] as string;
    expect(url).toContain('limit=10');
    expect(url).toContain('cursor=cur1');
    const body = JSON.parse(res.content[0].text);
    expect(body.hasMore).toBe(true);
    expect(body.nextCursor).toBe('cur2');
  });

  it('list_issues query mode: passes NLQL to the CSV endpoint, hydrates full issues, and returns compact results', async () => {
    const csv =
      'Key,Title,Type,Status,Priority,Assignee,Reporter,Story Points,Sprint,Labels,Start Date,Due Date,Description,Component,Fix Versions,Parent,Original Estimate (minutes),Created,Updated\r\n' +
      'NL-1,Fix the login bug,BUG,In Progress,HIGH,Ada Lovelace,,,,,,,,,,,,,\r\n';
    const { client, fetchImpl } = sequencedClient([
      { status: 200, body: csv, contentType: 'text/csv; charset=utf-8' },
      { status: 200, body: { items: [fullIssue(), fullIssue({ id: 'i-full-2', key: 'NL-2' })], nextCursor: null } },
    ]);

    const res = await tool('list_issues').handler(
      { projectId: 'p1', query: 'status = "In Progress" AND assignee = me()' },
      client,
    );
    const body = JSON.parse(res.content[0].text);
    expect(body.items).toEqual([
      { key: 'NL-1', title: 'Fix the login bug', status: 'In Progress', assignee: 'Ada Lovelace', priority: 'HIGH', type: 'BUG' },
    ]);
    expect(body.total).toBe(1);
    expect(body.hasMore).toBe(false);

    // First call is the CSV NLQL oracle, with the query passed as `q`.
    const csvUrl = fetchImpl.mock.calls[0][0] as string;
    expect(csvUrl).toContain('/api/projects/p1/issues.csv?');
    expect(csvUrl).toContain('q=status');
  });

  it('list_issues query mode requires projectId', async () => {
    const { client } = clientWith(200, {});
    await expect(
      tool('list_issues').handler({ query: 'status = Done' }, client),
    ).rejects.toThrow(/projectId is required/);
  });

  it('list_issues query mode surfaces the API\'s precise NLQL parser error, not a generic failure', async () => {
    const { client } = clientWith(400, {
      statusCode: 400,
      message: 'Invalid NLQL query: unexpected token "AND" at position 7',
      error: 'Bad Request',
    });
    await expect(
      tool('list_issues').handler({ projectId: 'p1', query: 'status AND AND' }, client),
    ).rejects.toThrow(/Invalid NLQL query: unexpected token "AND" at position 7/);
  });

  it('list_issues query mode supports verbose + limit/offset over the hydrated set', async () => {
    const csv =
      'Key,Title,Type,Status,Priority,Assignee\r\n' +
      'NL-1,One,BUG,In Progress,HIGH,\r\n' +
      'NL-2,Two,TASK,In Progress,LOW,\r\n';
    const { client } = sequencedClient([
      { status: 200, body: csv, contentType: 'text/csv' },
      {
        status: 200,
        body: {
          items: [fullIssue({ id: 'id-1', key: 'NL-1' }), fullIssue({ id: 'id-2', key: 'NL-2' })],
          nextCursor: null,
        },
      },
    ]);
    const res = await tool('list_issues').handler(
      { projectId: 'p1', query: 'type != EPIC', verbose: true, limit: 1, offset: 1 },
      client,
    );
    const body = JSON.parse(res.content[0].text);
    expect(body.total).toBe(2);
    expect(body.limit).toBe(1);
    expect(body.offset).toBe(1);
    expect(body.hasMore).toBe(false);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ id: 'id-2', key: 'NL-2' });
  });

  it('list_boards / list_users / list_sprints default to compact fields, verbose:true returns the full object', async () => {
    const boards = clientWith(200, [
      { id: 'b1', name: 'Main board', type: 'KANBAN', isDefault: true, filterQuery: null, colorRules: [] },
    ]);
    const compactBoards = await tool('list_boards').handler({ projectId: 'p1' }, boards.client);
    expect(JSON.parse(compactBoards.content[0].text).items).toEqual([
      { id: 'b1', name: 'Main board', type: 'KANBAN', isDefault: true },
    ]);
    const verboseBoards = await tool('list_boards').handler(
      { projectId: 'p1', verbose: true },
      boards.client,
    );
    expect(JSON.parse(verboseBoards.content[0].text).items[0]).toMatchObject({ colorRules: [] });

    const users = clientWith(200, [
      { id: 'u1', name: 'Ada', email: 'ada@example.com', avatarColor: '#000', createdAt: 'x' },
    ]);
    const compactUsers = await tool('list_users').handler({}, users.client);
    expect(JSON.parse(compactUsers.content[0].text).items).toEqual([
      { id: 'u1', name: 'Ada', email: 'ada@example.com' },
    ]);
  });

  it('list_* tools apply limit/offset and report total/hasMore', async () => {
    const { client } = clientWith(200, [
      { id: 'l1', name: 'a', color: '#111' },
      { id: 'l2', name: 'b', color: '#222' },
      { id: 'l3', name: 'c', color: '#333' },
    ]);
    const res = await tool('list_labels').handler({ projectId: 'p1', limit: 1, offset: 1 }, client);
    const body = JSON.parse(res.content[0].text);
    expect(body.items).toEqual([{ id: 'l2', name: 'b', color: '#222' }]);
    expect(body.total).toBe(3);
    expect(body.limit).toBe(1);
    expect(body.offset).toBe(1);
    expect(body.hasMore).toBe(true);
  });

  it('search_issues paginates the issues array and leaves projects untouched', async () => {
    const { client } = clientWith(200, {
      issues: [{ id: 's1', key: 'NL-1' }, { id: 's2', key: 'NL-2' }],
      projects: [{ id: 'p1', key: 'NL' }],
    });
    const res = await tool('search_issues').handler({ q: 'bug', limit: 1 }, client);
    const body = JSON.parse(res.content[0].text);
    expect(body.issues).toEqual([{ id: 's1', key: 'NL-1' }]);
    expect(body.projects).toEqual([{ id: 'p1', key: 'NL' }]);
    expect(body.total).toBe(2);
    expect(body.hasMore).toBe(true);
  });

  it('list_notifications compacts fields and keeps unreadCount at the top level', async () => {
    const { client } = clientWith(200, {
      items: [
        { id: 'n1', type: 'ISSUE_ASSIGNED', issueKey: 'NL-1', message: 'Assigned to you', read: false, actor: { id: 'u1' } },
      ],
      unreadCount: 1,
    });
    const res = await tool('list_notifications').handler({}, client);
    const body = JSON.parse(res.content[0].text);
    expect(body.unreadCount).toBe(1);
    expect(body.items).toEqual([
      { id: 'n1', type: 'ISSUE_ASSIGNED', issueKey: 'NL-1', message: 'Assigned to you', read: false },
    ]);
  });

  it('create_issue POSTs startDate through to the API', async () => {
    const { client, fetchImpl } = sequencedClient([
      { status: 200, body: { id: 'p1', key: 'NL', name: 'Next Lane' } },
      { status: 201, body: { id: 'i1', key: 'NL-1', startDate: '2026-08-01' } },
    ]);
    await tool('create_issue').handler(
      { projectId: 'p1', title: 'With a start date', startDate: '2026-08-01' },
      client,
    );
    const [, init] = fetchImpl.mock.calls[1];
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      startDate: '2026-08-01',
    });
  });

  it('update_issue PATCHes startDate (including null-to-clear)', async () => {
    const { client, fetchImpl } = clientWith(200, { id: 'i1' });
    await tool('update_issue').handler({ issueId: 'i1', startDate: null }, client);
    const [, init] = fetchImpl.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ startDate: null });
  });

  it('list_issues verbose output includes startDate; compact output surfaces it too when present', async () => {
    const { client } = clientWith(200, {
      items: [fullIssue({ startDate: '2026-08-01' })],
      nextCursor: null,
    });
    const res = await tool('list_issues').handler({ projectId: 'p1' }, client);
    const body = JSON.parse(res.content[0].text);
    expect(body.items[0].startDate).toBe('2026-08-01');
  });

  it('create_issue echoes the resolved project key + name', async () => {
    const { client, fetchImpl } = sequencedClient([
      { status: 200, body: { id: 'p1', key: 'NL', name: 'Next Lane' } },
      { status: 201, body: { id: 'i1', key: 'NL-42', title: 'New issue' } },
    ]);
    const res = await tool('create_issue').handler({ projectId: 'p1', title: 'New issue' }, client);
    const body = JSON.parse(res.content[0].text);
    expect(body).toMatchObject({
      id: 'i1',
      key: 'NL-42',
      project: { id: 'p1', key: 'NL', name: 'Next Lane' },
    });
    expect(fetchImpl.mock.calls[0][0]).toBe('http://localhost:4000/api/projects/p1');
    expect(fetchImpl.mock.calls[1][0]).toBe('http://localhost:4000/api/issues');
  });

  it('create_issue expectedProjectKey mismatch fails BEFORE creating the issue', async () => {
    const { client, fetchImpl } = sequencedClient([
      { status: 200, body: { id: 'p1', key: 'NL', name: 'Next Lane' } },
      { status: 201, body: { id: 'i1', key: 'OTHER-1' } },
    ]);
    await expect(
      tool('create_issue').handler(
        { projectId: 'p1', title: 'Oops wrong project', expectedProjectKey: 'OTHER' },
        client,
      ),
    ).rejects.toThrow(/expectedProjectKey "OTHER" does not match the target project "NL"/);
    // Only the project lookup happened — no POST /issues was made.
    expect(fetchImpl.mock.calls).toHaveLength(1);
  });

  it('create_issue expectedProjectKey match (case-insensitive) proceeds normally', async () => {
    const { client, fetchImpl } = sequencedClient([
      { status: 200, body: { id: 'p1', key: 'NL', name: 'Next Lane' } },
      { status: 201, body: { id: 'i1', key: 'NL-43' } },
    ]);
    const res = await tool('create_issue').handler(
      { projectId: 'p1', title: 'Correct project', expectedProjectKey: 'nl' },
      client,
    );
    expect(fetchImpl.mock.calls).toHaveLength(2);
    expect(JSON.parse(res.content[0].text)).toMatchObject({ key: 'NL-43' });
  });

  it('create_issue passes idempotencyKey through to POST /issues (criterion 2)', async () => {
    const { client, fetchImpl } = sequencedClient([
      { status: 200, body: { id: 'p1', key: 'NL', name: 'Next Lane' } },
      { status: 201, body: { id: 'i1', key: 'NL-44' } },
    ]);
    await tool('create_issue').handler(
      { projectId: 'p1', title: 'Retried issue', idempotencyKey: 'retry-key-1' },
      client,
    );
    const [, init] = fetchImpl.mock.calls[1];
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      idempotencyKey: 'retry-key-1',
    });
  });

  describe('create_issue strict-mode expectedProjectKey (criterion 7)', () => {
    const originalEnv = process.env.NEXT_LANE_MCP_STRICT_PROJECT_KEY;
    afterEach(() => {
      if (originalEnv === undefined) delete process.env.NEXT_LANE_MCP_STRICT_PROJECT_KEY;
      else process.env.NEXT_LANE_MCP_STRICT_PROJECT_KEY = originalEnv;
    });

    it('rejects a create_issue call with no expectedProjectKey when strict mode is enabled', async () => {
      process.env.NEXT_LANE_MCP_STRICT_PROJECT_KEY = 'true';
      const { client, fetchImpl } = sequencedClient([
        { status: 200, body: { id: 'p1', key: 'NL', name: 'Next Lane' } },
      ]);
      await expect(
        tool('create_issue').handler({ projectId: 'p1', title: 'No key passed' }, client),
      ).rejects.toThrow(/requires expectedProjectKey/);
      // No POST /issues was made — the project GET alone doesn't count as a write.
      expect(fetchImpl.mock.calls).toHaveLength(1);
    });

    it('allows a create_issue call with expectedProjectKey when strict mode is enabled', async () => {
      process.env.NEXT_LANE_MCP_STRICT_PROJECT_KEY = '1';
      const { client, fetchImpl } = sequencedClient([
        { status: 200, body: { id: 'p1', key: 'NL', name: 'Next Lane' } },
        { status: 201, body: { id: 'i1', key: 'NL-45' } },
      ]);
      await tool('create_issue').handler(
        { projectId: 'p1', title: 'Has key', expectedProjectKey: 'NL' },
        client,
      );
      expect(fetchImpl.mock.calls).toHaveLength(2);
    });

    it('does not require expectedProjectKey when strict mode is unset', async () => {
      delete process.env.NEXT_LANE_MCP_STRICT_PROJECT_KEY;
      const { client, fetchImpl } = sequencedClient([
        { status: 200, body: { id: 'p1', key: 'NL', name: 'Next Lane' } },
        { status: 201, body: { id: 'i1', key: 'NL-46' } },
      ]);
      await tool('create_issue').handler({ projectId: 'p1', title: 'No key, no strict' }, client);
      expect(fetchImpl.mock.calls).toHaveLength(2);
    });
  });

  it('add_comment passes idempotencyKey through to POST comments (criterion 2)', async () => {
    const { client, fetchImpl } = clientWith(201, { id: 'c1', body: 'hi' });
    await tool('add_comment').handler(
      { issueId: 'i1', body: 'hi', idempotencyKey: 'retry-comment-1' },
      client,
    );
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/issues/i1/comments');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      body: 'hi',
      idempotencyKey: 'retry-comment-1',
    });
  });

  it('update_comment PATCHes /comments/:id with the new body (criterion 5)', async () => {
    const { client, fetchImpl } = clientWith(200, { id: 'c1', body: 'Edited' });
    await tool('update_comment').handler({ commentId: 'c1', body: 'Edited' }, client);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/comments/c1');
    expect((init as RequestInit).method).toBe('PATCH');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ body: 'Edited' });
  });

  it('delete_comment DELETEs /comments/:id (criterion 5)', async () => {
    const { client, fetchImpl } = clientWith(200, { id: 'c1' });
    await tool('delete_comment').handler({ commentId: 'c1' }, client);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/comments/c1');
    expect((init as RequestInit).method).toBe('DELETE');
  });

  it('list_project_activity GETs /projects/:id/activity with since/cursor/limit', async () => {
    const { client, fetchImpl } = clientWith(200, {
      items: [{ id: 'a1', kind: 'COMMENT', issueId: 'i1', issueKey: 'NL-1', summary: 'commented' }],
      nextCursor: 'opaque-cursor',
    });
    const res = await tool('list_project_activity').handler(
      { projectId: 'p1', since: '2026-01-01T00:00:00.000Z', limit: 10 },
      client,
    );
    const [url] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      'http://localhost:4000/api/projects/p1/activity?since=2026-01-01T00%3A00%3A00.000Z&limit=10',
    );
    const body = JSON.parse(res.content[0].text);
    expect(body.items).toHaveLength(1);
    expect(body.hasMore).toBe(true);
    expect(body.nextCursor).toBe('opaque-cursor');
  });

  it('list_users passes q through as a query param', async () => {
    const { client, fetchImpl } = clientWith(200, [
      { id: 'u1', name: 'Dana', email: 'dana@example.com', avatarColor: '#000', createdAt: 'x' },
    ]);
    const res = await tool('list_users').handler({ q: 'dana' }, client);
    const [url] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/users?q=dana');
    expect(JSON.parse(res.content[0].text).items).toEqual([
      { id: 'u1', name: 'Dana', email: 'dana@example.com' },
    ]);
  });

  it('create_workspace POSTs to /workspaces and echoes id/slug prominently', async () => {
    const { client, fetchImpl } = clientWith(201, {
      id: 'ws1',
      slug: 'acme',
      name: 'Acme',
    });
    const res = await tool('create_workspace').handler({ name: 'Acme' }, client);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/workspaces');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ name: 'Acme' });
    const body = JSON.parse(res.content[0].text);
    expect(body.id).toBe('ws1');
    expect(body.slug).toBe('acme');
    // id/slug/name appear FIRST in the serialized JSON (prominent echo).
    expect(Object.keys(body).slice(0, 3)).toEqual(['id', 'slug', 'name']);
  });

  it('create_project POSTs to /projects and echoes id/key prominently', async () => {
    const { client, fetchImpl } = clientWith(201, {
      id: 'p1',
      key: 'NL',
      name: 'Next Lane',
      workspaceId: 'ws1',
    });
    const res = await tool('create_project').handler(
      { workspaceId: 'ws1', key: 'nl', name: 'Next Lane' },
      client,
    );
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/projects');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      workspaceId: 'ws1',
      key: 'nl',
      name: 'Next Lane',
    });
    const body = JSON.parse(res.content[0].text);
    expect(body.id).toBe('p1');
    expect(body.key).toBe('NL');
    expect(Object.keys(body).slice(0, 2)).toEqual(['id', 'key']);
  });

  it('get_epic_overview composes children + status rollup + progress from a single GET /issues/:id call', async () => {
    const { client, fetchImpl } = clientWith(200, {
      id: 'epic1',
      key: 'NL-100',
      title: 'Q3 Launch',
      type: 'EPIC',
      statusId: 's-inprog',
      status: { id: 's-inprog', name: 'In Progress', category: 'IN_PROGRESS' },
      children: [
        { id: 'c1', key: 'NL-101', title: 'Task A', type: 'TASK', statusId: 's-done', status: { id: 's-done', name: 'Done', category: 'DONE' } },
        { id: 'c2', key: 'NL-102', title: 'Task B', type: 'TASK', statusId: 's-todo', status: { id: 's-todo', name: 'To Do', category: 'TODO' } },
        { id: 'c3', key: 'NL-103', title: 'Task C', type: 'TASK', statusId: 's-done', status: { id: 's-done', name: 'Done', category: 'DONE' } },
      ],
    });

    const res = await tool('get_epic_overview').handler({ epicId: 'epic1' }, client);
    const body = JSON.parse(res.content[0].text);

    expect(body.epic).toEqual({ id: 'epic1', key: 'NL-100', title: 'Q3 Launch', type: 'EPIC', status: 'In Progress' });
    expect(body.progress).toEqual({ done: 2, total: 3, fraction: 2 / 3 });
    expect(body.statusBreakdown).toEqual(
      expect.arrayContaining([
        { status: 'Done', category: 'DONE', count: 2 },
        { status: 'To Do', category: 'TODO', count: 1 },
      ]),
    );
    expect(body.children).toEqual([
      { id: 'c1', key: 'NL-101', title: 'Task A', type: 'TASK', status: 'Done' },
      { id: 'c2', key: 'NL-102', title: 'Task B', type: 'TASK', status: 'To Do' },
      { id: 'c3', key: 'NL-103', title: 'Task C', type: 'TASK', status: 'Done' },
    ]);
    expect(body.childrenTotal).toBe(3);

    // The whole rollup came from exactly one REST call.
    expect(fetchImpl.mock.calls).toHaveLength(1);
    expect(fetchImpl.mock.calls[0][0]).toBe('http://localhost:4000/api/issues/epic1');
  });

  it('get_epic_overview handles an epic with no children', async () => {
    const { client } = clientWith(200, {
      id: 'epic2',
      key: 'NL-200',
      title: 'Empty epic',
      type: 'EPIC',
      statusId: 's-todo',
      status: { id: 's-todo', name: 'To Do', category: 'TODO' },
      children: [],
    });
    const res = await tool('get_epic_overview').handler({ epicId: 'epic2' }, client);
    const body = JSON.parse(res.content[0].text);
    expect(body.progress).toEqual({ done: 0, total: 0, fraction: 0 });
    expect(body.children).toEqual([]);
    expect(body.statusBreakdown).toEqual([]);
  });
});

describe('project agent context tools', () => {
  it('get_project_context GETs the agent-context endpoint and reports contentBytes', async () => {
    const { client, fetchImpl } = clientWith(200, {
      content: '## Current goal\nShip it.',
      updatedAt: '2026-07-03T00:00:00.000Z',
      updatedBy: { id: 'u1', name: 'Prior Agent' },
      staleness: { changesSinceUpdate: 3, lastProjectActivityAt: '2026-07-03T01:00:00.000Z' },
    });
    const res = await tool('get_project_context').handler({ projectId: 'p1' }, client);
    expect(fetchImpl.mock.calls[0][0]).toContain('/projects/p1/agent-context');
    const payload = JSON.parse(res.content[0].text);
    expect(payload.staleness.changesSinceUpdate).toBe(3);
    expect(payload.contentBytes).toBe(Buffer.byteLength('## Current goal\nShip it.', 'utf8'));
  });

  it('update_project_context PUTs the full replacement content', async () => {
    const { client, fetchImpl } = clientWith(200, {
      content: 'new handoff',
      updatedAt: '2026-07-03T02:00:00.000Z',
      updatedBy: { id: 'u1', name: 'Agent' },
      staleness: { changesSinceUpdate: 0, lastProjectActivityAt: null },
    });
    await tool('update_project_context').handler(
      { projectId: 'p1', content: 'new handoff' },
      client,
    );
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain('/projects/p1/agent-context');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(init?.body as string)).toEqual({ content: 'new handoff' });
  });

  it('both context tools carry the read-first / handoff-before-ending prompting language', () => {
    expect(tool('get_project_context').description).toMatch(/FIRST/);
    expect(tool('get_project_context').description).toMatch(/staleness/);
    expect(tool('update_project_context').description).toMatch(/before ending|end of/i);
    expect(tool('update_project_context').description).toMatch(/replace/i);
  });
});
