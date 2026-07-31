# @next-lane/mcp — Next Lane MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets
external AI agents — **Claude Desktop**, **Claude Code**, and any other MCP host
— **read and write** a Next Lane instance end-to-end: **130 tools** covering
workspaces/projects, workflows / SDLC, issues (incl. links, labels, comments
with author-or-admin edit/delete, checklists, worklogs), boards, statuses,
sprints, components, versions, custom fields, saved NLQL filters, automation
rules, dashboards, per-project role overrides, per-project agent-context
memory, a unified project activity feed, GitHub/GitLab/Gitea SCM links (incl.
live PR/MR status and the auto-transition-on-merge automation toggle for
GitHub/GitLab — Gitea v1 is links-only, see below), a one-call epic
rollup, and the **Pages knowledge base** — CRUD, version history, and
graph/backlink traversal (see below).

This is Next Lane's **agent-native wedge** (`docs/VISION.md`): an agent can list
a project's statuses, design a workflow from a template, add/edit/delete
transitions and gates, attach a workflow to a board, and create, move, link, and
triage issues — all through your running Next Lane instance's REST API. MCP
exposure is a standing part of every new feature's definition of done, so this
surface grows in lockstep with the product.

It is a **thin, additive** package: it makes authenticated HTTP calls to the
Next Lane API. It requires no schema or backend changes and stores nothing.

### Token efficiency (agent-context-friendly by default)

Every `list_*` / `search_*` tool returns a **compact, hand-picked field
set** by default (e.g. `list_issues` → `{key, title, status, assignee,
priority, type}`) instead of the full API object, wrapped in a uniform
envelope: `{ items, total?, limit, offset?, hasMore, ... }`. Pass
`verbose: true` on any of them to get the full object per item when you
actually need it. `limit`/`offset` default to a page size of 50 (max 200) so a
single call can never silently return an unbounded response — a real
MCP-agent field report measured **150 KB for one `list_issues` call on 44
tickets** before this existed; the same call is now on the order of a few KB
by default (see `apps/mcp/src/tools/index.test.ts` for byte-for-byte
before/after coverage).

`list_issues` also accepts a `query` param — a full NLQL expression (the same
language as the board search bar, saved filters, and `get_project_csv`),
evaluated server-side so you never have to pull every issue in a project to
find the ones you care about. An invalid query fails with the API's own
parser message (e.g. `Invalid NLQL query: unexpected token "AND" at position
7`), not a generic error — including an unresolvable `assignee`/`reporter`/
`sprint` value (a misspelled or nonexistent name 400s naming the value
instead of silently returning zero issues, so a `0` result for those fields
always means the name resolved and genuinely has nothing matching).

## How it works

The server speaks MCP over **stdio** and forwards each tool call to the Next
Lane REST API using a **Personal Access Token (PAT)** as a bearer token. Next
Lane's auth guard accepts PATs (tokens prefixed `nlp_`) on the standard
`Authorization: Bearer <token>` header.

## Configuration (environment variables)

| Variable            | Required | Default                 | Description                                                                 |
| ------------------- | -------- | ----------------------- | --------------------------------------------------------------------------- |
| `NEXT_LANE_TOKEN`   | **Yes**  | —                       | A Next Lane Personal Access Token (`nlp_...`). The server fails fast if unset. |
| `NEXT_LANE_API_URL` | No       | `http://localhost:4000` | Next Lane API host root. Do **not** include `/api` — it is added automatically. |
| `NEXT_LANE_MCP_STRICT_PROJECT_KEY` | No | unset | `1`/`true` to make `expectedProjectKey` a hard requirement on `create_issue` — omitting it fails the call instead of just being a strong recommendation. |

## Getting a Personal Access Token

1. Log in to your Next Lane instance.
2. Go to **Profile Settings** (`/me/settings`) → **API Tokens**.
3. Create a token, give it a name, and **copy the `nlp_...` value immediately** —
   it is shown only once and cannot be retrieved again.
4. Use that value as `NEXT_LANE_TOKEN`.

> The token inherits your account's permissions. Workflow-editing tools require
> **project ADMIN**; reads require project **VIEWER+**.

### PAT scopes

An **unscoped** token (no boxes checked when creating it) has full owner
permissions across every tool below. A **scope-restricted** token only works
for tools whose underlying REST route requires a scope it was granted — a
403 response with `does not have the required scope: <scope>` means either
add that scope to the token or switch to an unscoped one. The canonical
vocabulary lives in `PAT_SCOPES` (`packages/shared/src/types.ts`); by area:

| Scope | Covers |
|---|---|
| `issues:read` / `issues:write` | Issue CRUD/move/watch, checklist items, work logs, attachments, notifications, search. |
| `projects:read` / `projects:write` | Project CRUD plus every project-scoped structure/config tool: boards, statuses, labels, sprints, custom fields, components, versions, workflows, dashboards, automations, planning poker, standups, saved filters, share tokens, roadmap, reports (`get_velocity_report` etc.), project analytics. |
| `comments:read` / `comments:write` | Issue comments. |
| `webhooks:read` / `webhooks:write` | Webhook subscriptions + delivery logs. |
| `github:read` / `github:write` | GitHub integration config, linked PRs, live PR/CI status, auto-transition config. |
| `gitlab:read` / `gitlab:write` | GitLab integration config, linked MRs, live MR/pipeline status, auto-transition config. |
| `gitea:read` / `gitea:write` | Gitea integration config, linked PRs. No live-status/auto-transition scope — v1 has neither. |
| `workspaces:read` / `workspaces:write` | Workspace CRUD/membership and `list_users` (the co-member directory). |
| `pages:read` / `pages:write` | Knowledge-base pages: CRUD, tree/list, version history, backlinks, and the project link graph. |
| `tokens:read` / `tokens:write` | Managing your own PATs — not exposed over MCP (see below). |
| `admin:read` / `admin:write` | Instance SSO/OIDC config — not exposed over MCP (see below). |

**Hardening note:** prior to this rollout only `issues:*`, `webhooks:*`,
`comments:*`, `github:*`, and `gitlab:*` were actually enforced end-to-end —
a token scoped to any one of them could still call `list_workspaces`,
`list_projects`, `list_users`, every report tool, and most other MCP tools
regardless of scope. That gap is closed: if you already minted a narrowly
scoped token for an agent, it may now need `projects:read` and/or
`workspaces:read` added to keep working against those tools.

## Install & build

From the monorepo root:

```bash
pnpm install
pnpm --filter @next-lane/mcp build
```

This compiles to `apps/mcp/dist/index.js` with an executable
`#!/usr/bin/env node` shebang (exposed as the `next-lane-mcp` bin). You can run
it directly:

```bash
NEXT_LANE_TOKEN=nlp_xxx NEXT_LANE_API_URL=http://localhost:4000 node /absolute/path/to/Next-Lane/apps/mcp/dist/index.js
```

### Run without cloning (from v0.1.0)

The package is standalone-publishable (`publishConfig.access: public`, no
`workspace:*` runtime deps) and is published **automatically by the release
pipeline** — pushing a `vX.Y.Z` tag builds it, runs its tests, and publishes it
to npm with [provenance](https://docs.npmjs.com/generating-provenance-statements)
(see [`RELEASING.md`](../../RELEASING.md)). Nothing has been published yet: the
repo has no tags. Once `v0.1.0` is out, anyone can run it with **no clone or
build**:

```bash
NEXT_LANE_TOKEN=nlp_xxx NEXT_LANE_API_URL=https://your-next-lane.example.com npx -y @next-lane/mcp
```

…and the Claude Desktop / Claude Code configs below become `"command": "npx"`,
`"args": ["-y", "@next-lane/mcp"]`. Pin a version in production
(`@next-lane/mcp@0.1.0`) — the package version always matches the Next Lane
release it shipped with.

## Connect to Claude Desktop

Edit your Claude Desktop config file:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Add a `next-lane` entry under `mcpServers` (use the **absolute path** to the
built file):

```json
{
  "mcpServers": {
    "next-lane": {
      "command": "node",
      "args": ["/absolute/path/to/Next-Lane/apps/mcp/dist/index.js"],
      "env": {
        "NEXT_LANE_API_URL": "http://localhost:4000",
        "NEXT_LANE_TOKEN": "nlp_your_token_here"
      }
    }
  }
}
```

Restart Claude Desktop. The `next-lane` tools appear in the tools menu.

## Connect to Claude Code

Register the server with the `claude mcp add` command (the `--` separates the
launch command; `-e` sets env vars):

```bash
claude mcp add next-lane \
  -e NEXT_LANE_API_URL=http://localhost:4000 \
  -e NEXT_LANE_TOKEN=nlp_your_token_here \
  -- node /absolute/path/to/Next-Lane/apps/mcp/dist/index.js
```

Then run `claude mcp list` to confirm it is connected.

## Tools

### Read

Every row below marked **compact** returns `{key/id, name/title, ...}`-style
minimal fields by default and takes `limit`/`offset`/`verbose` (see [Token
efficiency](#token-efficiency-agent-context-friendly-by-default) above); rows
marked **paged** take `limit`/`offset` but the API's item shape is already
minimal, so there is no `verbose` mode.

| Tool                | Description                                                              |
| ------------------- | ---------------------------------------------------------------------- |
| `list_workspaces`   | List workspaces the token can access. **compact** `{id, name, slug}`.   |
| `list_projects`     | List projects in a workspace (`workspaceId`). **compact** `{id, key, name}`. |
| `list_boards`       | List a project's boards (`projectId`). **compact** `{id, name, type, isDefault}`. |
| `list_statuses`     | List a project's statuses/columns (`projectId`). **compact** `{id, name, category}`. |
| `list_workflows`    | List a project's named workflows with counts (`projectId`). **compact** `{id, name, enforced, transitionCount, boardCount}`. |
| `get_workflow`      | Get one workflow including its transitions (`workflowId`).              |
| `list_issues`       | List issues. Default mode: project/sprint/assignee/type/status/`q` filters + cursor paging. `query` mode: a full NLQL expression evaluated server-side (requires `projectId`), offset-paged. **compact** `{key, title, status, assignee, priority, type, startDate}`. |
| `get_issue`         | Get one issue by id (`issueId`).                                        |
| `list_issue_links`  | List an issue's typed links/dependencies (`issueId`); includes link ids. **paged**. |
| `list_labels`       | List a project's labels with ids + colors (`projectId`). **paged**.    |
| `list_users`        | List users (workspace members) — for assignee ids. Optional `q` filters server-side by case-insensitive name/email substring. **compact** `{id, name, email}`. |
| `search_issues`     | Full-text issue search (`q`, optional `projectId`). Each hit carries a **`snippet`** — a highlighted excerpt of the matching description — so relevance is judged without a follow-up `get_issue`. **Server-side paged** (`total`/`hasMore` describe `issues`; `projectsTotal` covers `projects`). |
| `search_comments`   | Full-text search over issue **comments** — where decisions get written down (`q`, optional `projectId`). Returns `{id, issueId, issueKey, issueTitle, projectId, projectKey, authorName, createdAt, snippet}`. **Server-side paged**. |
| `list_sprints`      | List a project's sprints (`projectId`). **compact** `{id, name, state}`. |
| `list_components`   | List a project's components (`projectId`). **compact** `{id, name, defaultAssignee}`. |
| `list_versions`     | List a project's versions/releases (`projectId`). **compact** `{id, name, state, releaseDate, issueCount}`. |
| `list_custom_fields`| List a project's custom field definitions (`projectId`). **compact** `{id, key, name, type, required}`. |
| `list_comments`     | List an issue's comments (`issueId`). **paged**.                       |
| `list_worklogs`     | List an issue's time-tracking logs (`issueId`). **paged**.             |
| `list_checklist`    | List an issue's checklist items (`issueId`). **paged**.                |
| `list_saved_filters`| List a project's saved NLQL filters (`projectId`). **compact** `{id, name, query, shared, projectId}`. |
| `list_automations`  | List a project's automation rules (`projectId`). **compact** `{id, name, trigger, enabled}`. |
| `list_issue_github_links` | List an issue's linked GitHub PRs/commits (`issueId`). Requires `github:read` scope when the token is scoped. **paged**. |
| `get_issue_github_live_status` | Live PR/CI status for an issue's linked GitHub PRs — a real GitHub API call (state, merged, combined checks), not the last webhook snapshot (`issueId`). `[]` when unconfigured/no links; per-link `error` on a failed lookup. Requires `github:read`. |
| `get_github_automation_config` | Read a project's auto-transition-on-merge config (`projectId`). Never returns the webhook secret/PAT — a narrower surface than the REST GET. `null` when GitHub isn't configured. Requires `github:read`. |
| `list_issue_gitlab_links` | List an issue's linked GitLab merge requests/commits/branches (`issueId`). Requires `gitlab:read` scope when the token is scoped. **paged**. |
| `get_issue_gitlab_live_status` | Live MR/pipeline status for an issue's linked GitLab MRs — a real GitLab API call. Mirrors `get_issue_github_live_status`. Requires `gitlab:read`. |
| `get_gitlab_automation_config` | Read a project's GitLab auto-transition-on-merge config (`projectId`). Mirrors `get_github_automation_config`. Requires `gitlab:read`. |
| `list_issue_gitea_links` | List an issue's linked Gitea pull requests/commits/branches (`issueId`). Requires `gitea:read` scope when the token is scoped. **paged**. No live-status/automation counterpart — Gitea integration v1 is links-only. |
| `list_quick_links`  | List the caller's personal sidebar shortcut links. **compact** `{id, label, url, group}`. |
| `get_personal_board`| Get the caller's personal (non-project) board: columns + cards.       |
| `list_issue_templates` | List a project's issue templates (`projectId`). **compact** `{id, name, issueType}`. |
| `list_page_templates` | List the doc (page) templates usable in a scope — pass exactly one of `projectId` (the project's own, then the workspace-wide ones it inherits) or `workspaceId`. Requires `pages:read` when the token is scoped. **compact** `{id, name, description, scope}`. |
| `get_page_template` | One doc template in full, INCLUDING its markdown body (which `list_page_templates` omits). Read this before `update_page_template` — the update is a partial patch, so you need the current `content` to edit rather than replace it. Requires `pages:read` when the token is scoped. |
| `get_project_analytics` | Team analytics for a project (`projectId`, `days?`).               |
| `get_my_analytics`  | Personal analytics for the caller (`days?`).                          |
| `get_velocity_report` | Velocity per completed/active sprint (`projectId`).                 |
| `get_velocity_trend_report` | Cross-sprint velocity trend: the same committed/completed points, bounded to the project's most recent N sprints (`projectId`, `sprints?` default 6, max 24). Also powers the dashboard VELOCITY_TREND gadget. |
| `get_burndown_report` | Daily ideal-vs-remaining points for one sprint (`projectId`, `sprintId`). |
| `get_cfd_report`    | Cumulative Flow Diagram series (`projectId`, `days?`).                |
| `list_notifications`| List the caller's notifications, newest first. **compact** `{id, type, issueKey, message, read}`; response always includes `unreadCount`. |
| `get_unread_notification_count` | Get the caller's unread notification count.               |
| `get_project_csv`   | Export a project's issues as **raw CSV text** (`projectId`, optional NLQL `q`). |
| `list_dashboards`   | List a project's configurable dashboards (`projectId`). **compact** `{id, name, order, gadgetCount}` (already minimal). |
| `get_dashboard`     | Get a dashboard with all its gadgets, ordered by grid position (`dashboardId`). |
| `get_dashboard_data` | Evaluate every gadget on a dashboard server-side; per-gadget `error` on a bad query/config instead of a 500 (`dashboardId`). |
| `list_project_role_overrides` | List a project's effective members (workspace role, effective role, `isOverride` flag) (`projectId`). **compact** `{userId, name, effectiveRole, isOverride}`. |
| `get_epic_overview` | One call for "what's in this epic and where does it stand": epic `{id, key, title, type, status}`, compact children `{id, key, title, type, status}`, a per-status `statusBreakdown`, and `progress: {done, total, fraction}` (`epicId`; works on any issue with children, not only EPIC-typed ones). |
| `get_project_context` | The project's persistent agent handoff document + `staleness` (`changesSinceUpdate`, `lastProjectActivityAt` — now also counts comments + work logs, not just field changes) + `contentBytes` (`projectId`). **Call this first when starting work on a project.** Never 404s — empty string before the first write. |
| `list_project_activity` | Unified "what changed" feed for a project: issue field changes, comments, and work logs, chronologically merged. `since` (ISO timestamp) or `cursor` (from a prior `nextCursor`) to page forward; omit both to start from the beginning. Cheaper than polling `list_issues`/`get_issue` blind. **compact**, ascending order. |
| `list_pages` | List a project's knowledge-base pages (`projectId`), flattened from the page tree into sidebar/rank order. **compact** `{id, title, parentId, archived}` (no `updatedAt` — the tree call doesn't carry it; `verbose: true` hydrates each page in the returned slice with its full object via one extra call per item). Requires `pages:read`. |
| `get_page` | Get one page by id: title, markdown content, hierarchy, author/editor, timestamps. Defaults to also including `links.outgoing` (this page's resolved/unresolved `[[wiki-links]]`) and `links.backlinkCount` in the same call — pass `includeLinks: false` to skip. Requires `pages:read`. |
| `list_page_versions` | A page's version history, newest first, cursor-paginated (`pageId`, `cursor?`, `limit?`). Compact summaries, no content. Requires `pages:read`. |
| `get_page_version` | Get one historical version's title + content (`pageId`, `versionNumber`). Requires `pages:read`. |
| `get_page_graph` | **Crown-jewel traversal:** the whole project's knowledge graph in one call — every page as a node (`{id, title, projectId, projectKey, updatedAt}`), every resolved `[[wiki-link]]` as a directed edge (`projectId`). Capped at 1000 nodes; `truncated: true` flags a cut-off graph. Requires `pages:read`. |
| `list_workspace_pages` | List the **workspace docs space** (`workspaceId`) — org-level pages that belong to no single project (handbook, runbooks, ADRs), flattened from the workspace page tree into rank order. Same compact refs and `verbose` hydration as `list_pages`. Requires `pages:read`. |
| `get_workspace_page_graph` | The whole **workspace's** knowledge graph in one call (`workspaceId`) — every page in every project **plus** the workspace docs space, as one node/edge set. The only view that shows cross-project `[[wiki-link]]` edges. Same payload/cap as `get_page_graph`; `projectId: null` marks a workspace-level page. Requires `pages:read`. |
| `get_page_backlinks` | "What links here" — pages that link TO this one (`pageId`), paginated. **paged**. Requires `pages:read`. |
| `get_page_links` | This page's own OUTGOING `[[wiki-links]]` (`pageId`), split into `resolved` (existing target pages) and `unresolvedTitles` (referenced but not yet written). Requires `pages:read`. |
| `get_page_issues` | The tracked issues a page links to (`pageId`) — auto-linked when the page body mentions a same-project issue key (`NL-123`). Compact issue refs + `truncated`. Requires `pages:read`. |
| `get_issue_pages` | Reverse of `get_page_issues`: the knowledge-base pages that reference an issue (`issueId`) — "what docs mention this work". Compact page refs + `truncated`. Requires `pages:read`. |
| `search_pages` | Full-text search over page titles AND body content (relevance-ranked Postgres FTS), optionally scoped to one project — the cheapest way to find the right doc. Each hit adds a **`snippet`** (highlighted body excerpt), so you rarely need to follow it into `get_page`. Compact page refs, **server-side paged**. Requires `pages:read`. |

### Write (SDLC)

| Tool                            | Description                                                         |
| ------------------------------- | ----------------------------------------------------------------- |
| `create_workspace`              | Create a new workspace (caller becomes first ADMIN). Response echoes `id`/`slug` first. Usually only needed for a genuinely new org — `create_project` is what most work needs. |
| `create_project`                | Create a project inside a workspace (`workspaceId`, `key`, `name`). Seeds the standard 3 statuses + a default Kanban board. `key` becomes the issue-key prefix and every `create_issue` call's `expectedProjectKey`. Response echoes `id`/`key` first. |
| `create_workflow`               | Create an empty named workflow (`projectId`, `name`, …).           |
| `create_workflow_from_template` | Create a workflow from `simple`/`kanban`/`scrum`/`bug-triage`.     |
| `update_workflow`               | Update a workflow's name/description/enforced flag.                |
| `delete_workflow`               | Delete a workflow (transitions cascade; boards detached).         |
| `add_workflow_transition`       | Add a transition (`fromStatusId` null = any → `toStatusId`, gates).|
| `update_workflow_transition`    | Update a transition's from/to/type/name/gates.                    |
| `delete_workflow_transition`    | Delete a transition.                                               |
| `assign_board_workflow`         | Attach a workflow to a board (`workflowId` null detaches).        |
| `create_issue`                  | Create an issue (`projectId`, `title`, …, `startDate`). **MUST pass `expectedProjectKey`** on every call (the project key you believe `projectId` resolves to) — it fails *before* creating anything on a mismatch, and there is no undo otherwise; response also always echoes the resolved `project: {id, key, name}` as a backstop. Pass `idempotencyKey` when retrying after a network error/timeout so the retry replays the original issue instead of duplicating it. |
| `update_issue`                  | Partial-update an issue: `parentId` (re-parent / null to detach), title, type, description, priority, assignee, sprint, component, story points, start date, due date. |
| `set_issue_parent`              | Shortcut to set/clear an issue's parent (`issueId`, `parentId` or null). |
| `move_issue`                    | Move an issue to a status (`boardId` applies enforced workflow).  |
| `link_issues`                   | Link two issues (`issueId`, `target`, `type` BLOCKS/BLOCKED_BY/RELATES_TO/DUPLICATES/DUPLICATED_BY/CLONES). |
| `unlink_issues`                 | Remove an issue link by id (`linkId`).                            |
| `create_label`                  | Create a project label (`projectId`, `name`, optional hex `color`). |
| `add_issue_label`               | Attach a label to an issue (`issueId`, `labelId`).                |
| `remove_issue_label`            | Remove a label from an issue (`issueId`, `labelId`).             |
| `add_comment`                   | Comment on an issue (`issueId`, `body` markdown). Pass `idempotencyKey` when retrying after a network error/timeout so the retry replays the original comment instead of duplicating it. |
| `update_comment` / `delete_comment` | Edit/delete a comment (`commentId`). Author-or-project-ADMIN gated. |
| `delete_issue`                  | Delete an issue (`issueId`). Irreversible.                       |
| `create_sprint` / `update_sprint` | Create a sprint; update name/dates/goal/state (start/complete). |
| `create_component`              | Create a project component.                                     |
| `create_version` / `set_issue_versions` | Create a release; set an issue's fix-versions.          |
| `add_worklog`                   | Log time on an issue (`minutes`, `note?`, `workedAt?`).         |
| `add_checklist_item` / `update_checklist_item` | Add / rename / toggle-done a checklist item.    |
| `create_status` / `update_status` | Create/update a workflow status (column) incl. WIP limit.     |
| `create_board` / `update_board` | Create a board; rename/retype/set default `filterQuery`.        |
| `create_saved_filter`           | Save a reusable NLQL filter (optionally shared).               |
| `create_custom_field`           | Define a project custom field.                                 |
| `create_automation`             | Create an automation rule (trigger → condition → actions).     |
| `create_quick_link` / `update_quick_link` / `delete_quick_link` | CRUD the caller's personal sidebar shortcut links. |
| `create_personal_card` / `update_personal_card` | Add / edit / move a card on the caller's personal board (move = `columnId` + `beforeId`/`afterId`). |
| `create_issue_from_template`    | Create an issue from an issue template, with per-field overrides. |
| `create_page_from_template`     | Create a page from a doc template; `{{date}}`/`{{title}}`/`{{author}}` are substituted server-side. A workspace template targets a project via `projectId` or the workspace-docs space when omitted; a project template always creates in its own project. Requires `pages:write` when the token is scoped. |
| `create_page_template`          | Create a doc template — a reusable markdown skeleton. Pass exactly one of `workspaceId` (usable anywhere in the workspace, including inside projects) or `projectId` (that project only; a same-named project template is a deliberate override and sorts first in the picker). `{{title}} {{date}} {{time}} {{datetime}} {{year}} {{month}} {{day}} {{author}}` are substituted when a page is created, not now; an UNKNOWN token is left verbatim rather than blanked, so a typo like `{{data}}` ships to readers as literal text. Names unique per scope. Requires workspace ADMIN and `pages:write`. |
| `update_page_template`          | Update a doc template. Partial, but any field passed REPLACES its value — `get_page_template` first when editing `content`. Never touches pages already created from it; a template is a stamp, not a live layout. Scope cannot be changed. Requires workspace ADMIN and `pages:write`. |
| `delete_page_template`          | Delete a doc template. Pages made from it are unaffected. Irreversible — including for the six built-in starters, which are NOT re-seeded on restart (seeding is keyed on a per-workspace marker, not on an empty template list). Requires workspace ADMIN and `pages:write`. |
| `bulk_update_issues`            | Apply the same status/assignee/priority/sprint/type/parentId/label change to up to 100 issues at once — one call parents 30 tickets under an epic. `atomic: true` makes the whole batch all-or-nothing (validates every issue first, writes only if all pass); `dryRun: true` previews per-item verdicts with zero writes (with or without atomic). Cross-project references (foreign `parentId`/`statusId`/`sprintId`) are rejected per-item with the same precise message as `update_issue`. |
| `mark_notification_read` / `mark_all_notifications_read` | Mark one or all of the caller's notifications read. |
| `create_dashboard` / `update_dashboard` / `delete_dashboard` | Create a project dashboard (a brand-new project's first dashboard is pre-populated with 3 starter gadgets); rename/reorder; delete (gadgets cascade). Capped at 20 dashboards/project. |
| `create_dashboard_gadget` / `update_dashboard_gadget` / `delete_dashboard_gadget` | Add / edit / remove a gadget — an NLQL `query` + `visualization` (STAT/TABLE/BREAKDOWN/BURNDOWN/VELOCITY_TREND) + `config`. Update merges `config` rather than replacing it. VELOCITY_TREND ignores `query` (project-wide); capped at 20 dashboards/project and 30 gadgets/dashboard — a 400 at the cap names the limit. |
| `set_project_role_override` / `remove_project_role_override` | Elevate/restrict (or revert) a workspace member's role scoped to one project. Requires effective project ADMIN; refuses to override a workspace admin. |
| `update_project_context` | Full-content replace of the project's agent handoff document (`projectId`, `content` markdown, 64 KB cap). **Call before ending every work session** — and at milestones — so the next run starts with your context. Requires project MEMBER+. |
| `create_page` | Create a knowledge-base page in a project (`projectId`, `title`, `content?`, `parentId?`). Reference other pages with `[[Page Title]]` in `content` — resolved into the link graph on save, **workspace-wide** (this project first, then any other project or the workspace docs space in the same workspace). Requires `pages:write`. |
| `create_workspace_page` | Create a page in the **workspace docs space** (`workspaceId`, `title`, `content?`, `parentId?`) — org-level knowledge with no owning project. Same `[[wiki-link]]` resolution; issue keys are not auto-linked (no project to resolve them against). Everything after creation uses the same by-id tools as project pages. Requires `pages:write`. |
| `move_page` | Drag-and-drop-style reorder/reparent (`id`, `parentId?`, `beforeId?`, `afterId?`) — computes the fractional-index rank server-side. Requires `pages:write`. |
| `update_page` | Partial-update a page: `title`/`content` (writes a new version + re-syncs links), `parentId` (re-parent; null = top-level), `archived`. Requires `pages:write`. |
| `delete_page` | Delete a page (`id`). Rejected with a 400 if it still has child pages — move or delete them first. Irreversible. Requires `pages:write`. |
| `restore_page_version` | Roll a page back to an earlier version's content (`pageId`, `versionNumber`) — writes a NEW version, never rewrites history. Requires `pages:write`. |
| `set_github_automation_config` / `set_gitlab_automation_config` | Turn a project's auto-transition-on-merge automation on/off and/or set its target status (`projectId`, `enabled`, `statusId?`) — a `merged` PR/MR webhook then moves every linked issue to that status via the existing workflow-transition automation-bypass path. Requires the integration to already be connected (repo/token setup stays web-UI-only); requires project ADMIN. |

`create_issue` / `update_issue` also accept `originalEstimateMinutes` (time-tracking estimate) and `customFields` (partial, keyed by field id).

### Not exposed over MCP (by design)

- **Configuring the GitHub, GitLab, or Gitea integration** (`upsert`/`remove`
  — sets/rotates the webhook secret, and `GET` returns the plaintext secret to
  project admins) is admin-only and secret-bearing for all three providers; it
  is deliberately **not** wired as an MCP tool for any of them. The read-only
  `list_issue_github_links` / `list_issue_gitlab_links` / `list_issue_gitea_links`
  / live-status / automation-config tools (none ever return the webhook secret
  or PAT) and the `set_*_automation_config` write tools (config-only, no
  secret; GitHub/GitLab only — Gitea v1 has no automation) ARE exposed. Manage
  the repo/token connection itself from project Settings in the web app.
- **Workspace/project deletion** and other irreversible, non-confirmable
  destructive actions are intentionally out of scope for the same reason.
- **Instance SSO/OIDC configuration** (`GET`/`PATCH /admin/oidc-config` — the
  in-app admin settings screen, `apps/web/src/pages/AdminSsoSettingsPage.tsx`)
  is instance-admin-only and secret-bearing (an OIDC client secret), the same
  shape of risk as the GitHub/GitLab integrations above; it is deliberately
  **not** wired as an MCP tool. Manage SSO from that settings page (or the
  `OIDC_ISSUER_URL`/`OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET` env vars, which take
  precedence when set) in the web app. **SSO/OIDC Phase 2** (`GET`/`POST/PATCH/
  DELETE /admin/sso-providers` — the N-simultaneous-providers list, SAML +
  additional OIDC rows) is the same risk shape one level up: every write
  carries an OIDC client secret or a SAML IdP signing certificate, and the
  runtime `/auth/sso/:slug/login`/`callback` routes are unauthenticated
  browser redirects with no agent-appropriate shape at all (an agent can't
  "click through" an IdP's own login form). None of it is wired as an MCP
  tool, for the same reason as Phase 1 — manage every provider (OIDC and
  SAML alike) from the `/admin/sso` settings page.
- **Dashboard sharing (public read-only embed)** — minting/listing/revoking a
  dashboard share link (`POST/GET /dashboards/:id/share-tokens`,
  `DELETE .../share-tokens/:tokenId`) and the public `GET /public/dashboard/:token`
  read itself are **not** wired as MCP tools: this is a public-web surface
  (a bookmarkable, no-login browser URL for a human stakeholder), not an
  agent action — there is no agent-appropriate shape for "open this link in
  a browser." Manage share links from the "Share" button on the project's
  Dashboards page in the web app; the board-sharing equivalent
  (`/projects/:id/share-tokens`) makes the same call.

## Ship your agent with memory

The durable memory is the **Pages knowledge graph** (next section) — pages,
`[[wiki-links]]`, versions, in both the project and workspace scopes. The
server's MCP `instructions` name it first for exactly that reason.

Alongside it, every project keeps a single shared **agent-context document**:
a short handoff note that survives between agent runs and carries across
agents (and humans: it's visible and editable in the project UI). It holds
current goal, in-flight work, next steps, gotchas, and pointers into the
pages — it is a full-content replace with a 64 KB cap and no merge, so it is
the sticky note on the door, not the memory behind it. Two tools manage it
(`get_project_context` / `update_project_context`), the server's MCP
`instructions` teach every connecting client the read-first / hand-off-last
practice automatically, and the distributable
[`project-context` skill](../../skills/project-context/SKILL.md) bakes the
full discipline into agents that support Agent Skills:

```bash
# Claude Code
cp -r skills/project-context ~/.claude/skills/
```

The read tool returns a `staleness` signal (`changesSinceUpdate` — project
activity newer than the handoff) so an agent knows when to re-verify a stale
handoff instead of trusting it blindly.

The same pattern covers the knowledge base: the server `instructions` teach
the find-docs-first / document-as-you-work workflow, and the distributable
[`knowledge-base` skill](../../skills/knowledge-base/SKILL.md) bakes in the
full discipline (search before building, link-first writing with
`[[wiki-links]]` + issue keys, check backlinks before deleting):

```bash
# Claude Code
cp -r skills/knowledge-base ~/.claude/skills/
```

## Read AND write the knowledge base — and traverse its graph

Neither Confluence (no graph/agent API) nor Obsidian (local-only, no API at
all) lets an agent do this: fifteen tools give full read/write access to the
**Pages** knowledge base in BOTH scopes — `list_pages`/`get_page`/
`create_page`/`move_page`/`update_page`/`delete_page` for project-page CRUD,
`list_workspace_pages`/`create_workspace_page` for the org-level docs space
(handbook, runbooks, ADRs), `list_page_versions`/`get_page_version`/
`restore_page_version` for history — plus four tools purpose-built for
**graph traversal**, the differentiated part:

- **`get_page_graph`** loads a project's entire wiki as `{nodes, edges}` in
  one call — every page, every resolved `[[wiki-link]]` — so an agent can spot
  hub pages, orphaned docs, and how the knowledge actually connects before
  reading a single page.
- **`get_workspace_page_graph`** does the same for a whole workspace: every
  project's pages **plus** the org docs space in one graph. `[[wiki-links]]`
  resolve workspace-wide, so cross-project edges only appear here — this is
  what answers "what's connected to this handbook page across every project?"
  in a single call.
- **`get_page_backlinks`** walks "what links here" for one page — the
  incoming edges — useful before editing/archiving a doc, or to find the most
  load-bearing page on a topic.
- **`get_page_links`** is the reverse: a page's own outgoing links, split
  into pages that exist (`resolved`) and titles referenced but not yet
  written (`unresolvedTitles` — a literal to-do list of missing docs).

`get_page` composes `get_page_graph`-equivalent orientation (outgoing links +
backlink count) into its own response by default, so the common case — open a
page, understand what it connects to — is one call, not four.

## Development

```bash
pnpm --filter @next-lane/mcp dev    # tsc --watch
pnpm --filter @next-lane/mcp test   # vitest (mocks fetch; no live server needed)
pnpm --filter @next-lane/mcp lint   # tsc --noEmit
```

## License

MIT — same as Next Lane.
