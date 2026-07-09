# AI Agents & MCP

Next Lane is **agent-native**: AI agents are first-class users of the tracker,
not an afterthought. The official MCP server — **`@next-lane/mcp`** — exposes
**117 tools** over the [Model Context Protocol](https://modelcontextprotocol.io)
so Claude Code, Claude Desktop, and any other MCP host can read *and write*
your Next Lane instance end-to-end: file bugs, move cards, design workflows,
run NLQL queries, log time, build dashboards, and hand off context between
sessions.

Everything runs against your own self-hosted instance through the same REST
API the web app uses. No data leaves your infrastructure, and MCP exposure is
part of the definition-of-done for every new feature — the agent surface grows
in lockstep with the product.

---

## What "agent-native" means here

- **Full read/write coverage** — 117 tools spanning the whole product surface
  (issues, boards, sprints, workflows, dashboards, automations, analytics,
  notifications, pages, and more), not a read-only wrapper.
- **Token-efficient by design** — compact responses, pagination everywhere,
  and server-side NLQL evaluation so an agent never has to pull a whole
  project into context to answer a question.
- **Persistent memory** — every project carries an agent-context handoff
  document with a staleness signal, so the next agent session starts where the
  last one left off.
- **Guard rails** — a wrong-project guard on issue creation, admin-only
  secret-bearing operations deliberately kept off the MCP surface, and PAT
  scopes to restrict what a token can touch.

![Agent context panel in project settings](/screenshots/agent-context-desktop.png)

*The per-project agent-context document — a handoff each run reads first and
writes last, with a measured staleness signal.*

---

## Connecting

### 1. Create a Personal Access Token (PAT)

1. Log in to your Next Lane instance.
2. Go to **Profile Settings** (`/me/settings`) → **API Tokens**.
3. Create a token and **copy the `nlp_...` value immediately** — it is shown
   only once.

The token inherits your account's permissions. You can optionally restrict it
to specific scopes when creating it. An empty scopes list means unrestricted
(same as your browser session); a scoped token is enforced on **every** route
in the API, not just a subset:

| Scope | Covers |
|---|---|
| `issues:read` / `issues:write` | Issue CRUD/move/watch, checklist items, work logs, attachments, notifications, search. |
| `projects:read` / `projects:write` | Project CRUD plus every project-scoped structure/config tool: boards, statuses, labels, sprints, custom fields, components, versions, workflows, dashboards, automations, planning poker, standups, saved filters, share tokens, roadmap, reports, project analytics. |
| `comments:read` / `comments:write` | Issue comments. |
| `webhooks:read` / `webhooks:write` | Webhook subscriptions + delivery logs. |
| `github:read` / `github:write` | GitHub integration config, linked PRs, live PR/CI status, auto-transition config. |
| `gitlab:read` / `gitlab:write` | GitLab integration config, linked MRs, live MR/pipeline status, auto-transition config. |
| `gitea:read` / `gitea:write` | Gitea integration config, linked PRs/commits/branches. No live-status/auto-transition scope yet — v1 is links-only. |
| `workspaces:read` / `workspaces:write` | Workspace CRUD/membership and `list_users` (the co-member directory). |
| `tokens:read` / `tokens:write` | Managing your own PATs — not exposed over MCP. |
| `admin:read` / `admin:write` | Instance SSO/OIDC config — not exposed over MCP. |

If you scope a token, note that `list_issue_github_links` requires
`github:read`, `list_issue_gitlab_links` requires `gitlab:read`, and
`list_issue_gitea_links` requires `gitea:read`. A narrowly-scoped token also
needs `projects:read`/`workspaces:read` for tools like `list_projects`,
`list_workspaces`, and the report tools — scoping is enforced across every
route in the API, so a token minted before this hardening pass may need those
two scopes added to keep working.

### 2. Build the server

From a clone of the repo:

```bash
pnpm install
pnpm --filter @next-lane/mcp build
```

This produces `apps/mcp/dist/index.js` (bin name: `next-lane-mcp`).

### 3. Register it with your MCP host

**Claude Code:**

```bash
claude mcp add next-lane \
  -e NEXT_LANE_API_URL=http://localhost:4000 \
  -e NEXT_LANE_TOKEN=nlp_your_token_here \
  -- node /absolute/path/to/Next-Lane/apps/mcp/dist/index.js
```

Confirm with `claude mcp list`.

**Claude Desktop** — add to `claude_desktop_config.json`
(macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`):

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

Two environment variables configure the server:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NEXT_LANE_TOKEN` | **Yes** | — | A Next Lane PAT (`nlp_...`). The server fails fast if unset. |
| `NEXT_LANE_API_URL` | No | `http://localhost:4000` | API host root. Do **not** include `/api` — it is added automatically. |

---

## The 117-tool surface at a glance

Grouped by area (see the
[full tool table in `apps/mcp/README.md`](https://github.com/Overcastly-AI/Next-Lane/blob/main/apps/mcp/README.md)
for every tool and parameter):

| Area | What agents can do |
|------|--------------------|
| **Issues** | Create (with wrong-project guard), update, move, delete, link/unlink, re-parent, bulk-update up to 100 at once, create from templates, comment, label |
| **Issue detail** | Checklists (add/toggle items), time tracking (estimates + worklogs), fix-versions, custom field values, start/due dates |
| **Search & query** | `list_issues` with server-side NLQL, full-text `search_issues`, `get_project_csv` export |
| **Workflows / SDLC** | Create workflows (blank or from `simple`/`kanban`/`scrum`/`bug-triage` templates), add/edit/delete transitions and gates, attach a workflow to a board |
| **Boards & planning** | Boards, statuses (incl. WIP limits), sprints (create/start/complete), components, versions/releases, saved NLQL filters, automation rules |
| **Dashboards** | Full dashboard + gadget CRUD, plus `get_dashboard_data` for server-side evaluation of every gadget in one call |
| **Reports & analytics** | Velocity, burndown, CFD, project and personal analytics |
| **Epic rollups** | `get_epic_overview` — one call returns the epic, compact children, a per-status breakdown, and `progress: {done, total, fraction}` |
| **People & access** | List workspace members, per-project role overrides (set/remove) |
| **Personal** | Personal board cards, quick links, notifications (list / mark read) |
| **SCM links** | Read an issue's linked GitHub PRs/commits, GitLab MRs/commits/branches, and Gitea PRs/commits/branches |
| **Agent memory** | `get_project_context` / `update_project_context` — the persistent per-project handoff document |
| **Pages** | CRUD (create, list, get, update, delete), move in tree, version history (list/get/restore), backlinks ("what links here"), and **knowledge-graph traversal** (`get_page_graph` → full node/edge set, `get_page_links` → outgoing links, `get_page_backlinks` → inbound links) for Obsidian-style wiki navigation over the agent API |

**Deliberately not exposed:** configuring the GitHub/GitLab/Gitea
integrations and instance SSO settings (admin-only and secret-bearing),
workspace/project deletion (irreversible), and public dashboard/board share
links (a no-token browser surface, not an agent action). Manage those from
the web app.

---

## NLQL over MCP

`list_issues` accepts a `query` parameter — a full
[NLQL](./features#nlql-query-language) expression, evaluated **server-side**:

```
status != Done AND priority IN (HIGH, HIGHEST) ORDER BY due ASC
```

The agent gets back only the matching issues, already sorted, instead of
paging through the whole project and filtering in-context. Invalid queries
fail with the parser's own message (e.g.
`Invalid NLQL query: unexpected token "AND" at position 7`), so an agent can
self-correct. This also applies to an `assignee`/`sprint` comparison whose
name doesn't resolve to anyone — a typo'd `assignee = "Alex Rivers"` 400s with
`unknown user "Alex Rivers" — use an exact display name, an id, or me(); see
list_users` instead of silently returning zero issues, so an agent doesn't
mistake "no such user" for "this user has no issues". The same language
powers the board query bar, saved filters, dashboards, and automation
conditions.

---

## Token efficiency

Agent context windows are a scarce resource, so the server is compact by
default:

- **Compact field sets** — every `list_*` / `search_issues` tool returns a
  hand-picked minimal shape (e.g. `list_issues` →
  `{key, title, status, assignee, priority, type, startDate}`) wrapped in a
  uniform envelope: `{items, total?, limit, offset?, hasMore}`.
- **`verbose: true`** — opt into the full API object per item only when you
  need it.
- **Pagination everywhere** — `limit`/`offset` default to 50 items per page
  (max 200), so no call can silently return an unbounded response.

A real agent field report measured **150 KB for a single `list_issues` call on
44 tickets** before this design; the same call is now a few KB by default.

---

## Per-project agent context memory

Every project keeps **one persistent agent-context document** — a Markdown
handoff shared by all agents (and humans: it is visible and editable under
**Project Settings → Agent context** in the web app). It survives between
sessions and across different agents, closing the "every session starts from
zero" gap.

- **`get_project_context`** — returns the document plus a **staleness signal**:
  `changesSinceUpdate` (project activity newer than the handoff) and
  `lastProjectActivityAt`, so an agent knows whether to trust the handoff or
  re-verify it. Never 404s — it returns an empty string before the first
  write. *Call this first when starting work on a project.*
- **`update_project_context`** — full-content replace (64 KB cap, requires
  project MEMBER+). *Call before ending every work session* so the next run
  starts with your context.

The server's MCP `instructions` teach every connecting client this
read-first / hand-off-last discipline automatically at the protocol layer.

### The `project-context` skill

For agents that support Agent Skills, the distributable
[`skills/project-context`](https://github.com/Overcastly-AI/Next-Lane/blob/main/skills/project-context/SKILL.md)
skill bakes in the full discipline — read context on start, update at
milestones, always write a structured handoff before finishing — with a worked
example. Install into Claude Code with one command from the repo root:

```bash
cp -r skills/project-context ~/.claude/skills/
```

---

## Guard rails

- **Wrong-project guard** — `create_issue` accepts an optional
  `expectedProjectKey`. If the resolved project's key doesn't match, the
  create is rejected *before* anything is written — protecting against the
  classic agent failure of filing issues into the wrong project from a stale
  ID. Every create response also echoes the resolved
  `project: {id, key, name}` for verification.
- **Scoped PATs** — restrict a token to read-only or to specific resource
  families; non-empty scope lists are enforced on every call.
- **Permission inheritance** — the token can never do more than the user who
  minted it. Workflow-editing tools require project ADMIN; reads require
  VIEWER+.

---

## See also

- [`apps/mcp/README.md`](https://github.com/Overcastly-AI/Next-Lane/blob/main/apps/mcp/README.md) — full tool table and development docs
- [Features](./features) — the product surface these tools operate on
- [Configuration](./configuration) — instance environment variables
