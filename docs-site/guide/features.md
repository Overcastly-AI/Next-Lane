# Features

This page is the user manual for everything live in the current build — what
each feature is, where to find it, and any configuration it needs. For phase
status see
[`docs/ROADMAP.md`](https://github.com/Overcastly-AI/Next-Lane/blob/main/docs/ROADMAP.md);
for the AI-agent surface see [AI Agents & MCP](./agents-mcp).

---

## Boards

Multiple boards per project, each independently configured.

- **Board types:** **Kanban** (continuous flow) and **Scrum** (scopes to the
  active sprint). Switch boards with the top-left board picker.
- **Drag and drop** with fractional-index ordering — moving a card updates one
  row, never renumbers the column.
- **WIP limits** — set an optional per-column limit when creating or editing a
  column; the column header shows a warning chip when the card count exceeds
  it.
- **Swimlanes (group by)** — group the board into lanes by **Assignee,
  Priority, Issue type, Epic, Component, Sprint, Labels, or any custom SELECT
  field** via the toolbar's *Group by* menu. Labels grouping shows an issue in
  every one of its label lanes; SELECT-field grouping renders one lane per
  option plus a "None" lane. Each board can save a **default grouping**, and
  the `?group=` URL parameter overrides it — so grouped views are shareable
  links.
- **Per-board default filter** — pin an NLQL filter to a board (Board settings
  → Default filter); it auto-applies every time the board opens. The active
  filter shows as a chip in the toolbar.
- **Conditional card colors** — rule-based highlighting driven by NLQL
  conditions (Board settings → Colors). Example: paint every card matching
  `priority = HIGHEST AND status != Done` red.
- **Query bar** — filter the board live with an NLQL expression (with
  autocomplete and inline validation); filter state persists in the URL.
- **Live presence** — avatars show who else is viewing the board right now
  (Socket.io, real time).
- **Card chips** — selected custom-field values can be pinned as chips
  directly on cards, and cards with unresolved blocking links show a
  **Blocked** badge.

![Board view](/screenshots/board-desktop.png)

![Board grouped into swimlanes](/screenshots/board-swimlanes-desktop.png)

*Swimlanes — the same board grouped by issue type, with a per-lane count.*

---

## Issues

Issues are the core unit of work. Every issue has:

- **Type:** Task, Bug, Story, Epic, Sub-task — with **parent/child hierarchy**
  (epics contain stories, stories contain sub-tasks).
- **Title and description** — Markdown rendered, including **Mermaid
  diagrams** in descriptions and comments (click to zoom in a lightbox).
- **Status, priority, assignee, reporter, labels, story points, start date,
  due date, component, fix versions.**
- **Checklists** — lightweight to-do items inside an issue with a progress
  bar.
- **Time tracking** — set an original estimate and log work (minutes, note,
  date); the drawer shows logged-vs-estimate progress.
- **Custom fields** — project-defined typed fields: Text, Number, Select,
  Multi-select, Date, Checkbox, URL (Project Settings → Custom fields).
- **Comments** with **@mentions** (autocomplete; mentioned users are
  notified), plus a full **activity log** of every field change.
- **File attachments** — drag-and-drop upload (10 MB default cap,
  configurable via `MAX_FILE_BYTES`).
- **Issue links** — directed relationships: BLOCKS, BLOCKED_BY, RELATES_TO,
  DUPLICATES, DUPLICATED_BY, CLONES.
- **Watchers** — watch any issue to get notified on changes.

The issue detail drawer opens in-panel without leaving the board.

![Issue detail drawer](/screenshots/drawer-desktop.png)

![Issue drawer scrolled to checklist and time tracking](/screenshots/drawer-worklogs-desktop.png)

*Checklist progress and time tracking (logged vs. estimate) inside the same drawer.*

### Issue templates

Define reusable templates per project (Project Settings → Templates) with a
default issue type, field values, and description boilerplate, then create
issues from a template in one step.

### Components

Project-scoped groupings (e.g. "API", "UI", "Docs") with an optional
**default assignee** (Project Settings → Components). Filterable in NLQL via
`component`.

### Versions / Releases

Track releases per project with UNRELEASED / RELEASED / ARCHIVED states
(Project Settings → Versions). Issues carry a many-to-many **fix versions**
relationship.

---

## NLQL query language

NLQL (Next Lane Query Language) is the structured filter language used by the
board query bar, saved filters, dashboards, automation conditions, the CSV
export, and the MCP server.

**Example queries:**

```
assignee = me()
priority IN (HIGH, HIGHEST) AND status != Done
labels IN (frontend, urgent) AND sprint = "Sprint 12"
due < today() AND assignee IS NOT EMPTY
type = BUG AND created > "2026-06-01" ORDER BY priority DESC
title ~ "checkout" OR text ~ "payment"
```

- **Operators:** `=`, `!=`, `<`, `>`, `<=`, `>=`, `~` (contains), `!~`,
  `IN (...)`, `NOT IN (...)`, `IS EMPTY`, `IS NOT EMPTY`
- **Logic:** `AND`, `OR`, `NOT`, parentheses
- **Sorting:** optional trailing `ORDER BY <field> [ASC|DESC]`
- **Functions:** `me()` (current user), `now()`, `today()`, `startOfDay()`,
  `startOfWeek()`
- **Fields** (with aliases): `status`, `statusCategory` (`category`),
  `assignee`, `reporter`, `type`, `priority`, `label`/`labels`, `sprint` (by
  name or id), `start`/`startDate`, `due`/`dueDate`, `created`, `updated`,
  `title`/`summary`, `text` (title + description), `points`/`storyPoints`,
  `key`, `parent`, `component`, and any custom field by its quoted name
  (e.g. `"Severity" = high`).

**Autocomplete** suggests fields, operators, values, and functions as you
type — in the board query bar, saved-filter editor, and automation condition
editor alike. Invalid queries report the exact parse position.

![NLQL autocomplete in the board query bar](/screenshots/nlql-autocomplete-desktop.png)

### Fail-loud on unknown names

Comparing `assignee` or `sprint` against a name resolves it against your
project's real members and sprints. If the name doesn't match anyone —
typically a typo, e.g. `assignee = "Alex Rivers"` — the query now returns an
actionable error instead of silently matching zero issues:

```
Invalid NLQL query: unknown user "Alex Rivers" — use an exact display name,
an id, or me(); see list_users
```

This applies everywhere a query is evaluated server-side: the CSV export, a
dashboard gadget (only that gadget shows the error; the rest of the
dashboard still renders), and automation conditions (the run is marked
`FAILED` rather than a silent `SKIPPED`). The board query bar surfaces the
same message inline as you type. A literal that looks like a raw id (a
Prisma `cuid()` or UUID) is never flagged this way even if it matches
nobody — only names are, so historical filters referencing a deleted
member's id don't start erroring.

### Saved filters

Save any NLQL query with a name (star icon next to the query bar). Filters are
personal by default and can be **shared to the project**; shared filters
appear in everyone's filter picker and can be pinned to boards as the default
filter.

---

## Workflows

Define how issues are allowed to move through statuses — per project, and even
per board (Project Settings → Workflows).

- **Named workflows** — a project can have several workflows; assign a
  different one to each board. An *enforced* workflow rejects moves that don't
  follow a defined transition.
- **Visual graph builder** — design the workflow on a drag-and-drop graph:
  statuses as nodes, transitions as edges.
- **Templates** — seed a workflow from `simple`, `kanban`, `scrum`, or
  `bug-triage` instead of starting blank.
- **Transition gates** — require conditions before a move is allowed:
  assignee set, description present, a specific (custom) field filled, a link
  of a given type, or **no open blockers**.
- Enforcement is consistent everywhere: board drag-and-drop, the drawer's
  status dropdown, triage, bulk edit, and the MCP `move_issue` tool all pass
  through the same check.

![Visual workflow graph builder](/screenshots/workflow-graph-desktop.png)

*A named "Engineering Flow" workflow — statuses as nodes, transitions as edges, enforced.*

---

## Automation engine (Glass Box)

**Trigger → condition → action** rules per project (`/projects/:id/automations`).

- **Triggers:** issue created, issue updated, issue changes status, comment
  added.
- **Condition** (optional): any NLQL expression, e.g.
  `priority IN (HIGH, HIGHEST) AND labels = "customer-reported"`.
- **Actions:** assign to, set priority, move to status, add label, add
  comment, set custom field.
- **Glass Box run log:** every execution is recorded — the trigger event,
  whether the condition passed (SUCCESS / SKIPPED / FAILED), and what each
  action did. Nothing runs silently.

Automation runs are unlimited — they execute on your own hardware.

---

## Dashboards

Configurable per-project dashboards (`/projects/:id/dashboards`) where **every
gadget is an NLQL query plus a visualization**:

- **STAT** — a single number (e.g. `status != Done AND priority = HIGHEST`).
- **TABLE** — matching issues with selectable columns and row limits.
- **BREAKDOWN** — counts grouped by a field.
- **BURNDOWN** — sprint burndown.

Gadgets live on a grid, can be reordered by drag-and-drop, refresh in real
time when project issues change, and report per-gadget errors on a bad query
instead of failing the whole dashboard.

![Dashboards with STAT, BREAKDOWN, BURNDOWN, and TABLE gadgets](/screenshots/dashboard-desktop.png)

### Public share links

Admins can mint a **share link** for a dashboard (Share button on the
Dashboards page toolbar) that publishes it read-only, no login required, at
`/share/dashboard/<token>` — the same pattern as board share links, on its
own token so a dashboard link can never double as a board link. A gadget
whose query calls `me()` has no signed-in identity to resolve on a public
link, so it shows an explicit **"needs a signed-in user"** error instead of
silently rendering as if unassigned. Links are revocable at any time from
the same Share panel.

---

## Backlog, triage, and bulk edit

- **Backlog view** (`/projects/:id/backlog`) — plan sprints, rank issues, and
  filter with NLQL.
- **Triage view** (`/projects/:id/triage`) — keyboard-first inbox processing:
  `j`/`k` to move, `s` status, `p` priority, `a` assign, `l` label.
- **Bulk edit** — multi-select issues with checkboxes in Backlog or Triage,
  then update status, assignee, priority, sprint, type, or labels for all of
  them from the sticky action bar.

![Backlog view](/screenshots/backlog-desktop.png)

---

## Sprints and agile rituals

- **Sprints** — create, start, and complete sprints with goals and date
  ranges; one active sprint per project, enforced transactionally.
- **Planning poker** (`/projects/:id/poker`) — real-time estimation sessions:
  participants vote privately from a Fibonacci deck
  (0–89, `?`, ☕), the facilitator reveals all votes at once, and the agreed
  estimate is written back to the issue. Votes sync live via Socket.io.
- **Async standups** (`/projects/:id/standups`) — yesterday / today / blockers
  per member, per day. Blockers link to real issues; "Prefill from my
  activity" seeds the form from your recent activity log and in-progress
  assignments; the team digest shows everyone's entry for any date.

---

## Reports and analytics

- **Per-project reports** (`/projects/:id/reports`): **burndown**,
  **velocity**, and **cumulative flow diagram** (14/30/90-day windows).
- **Roadmap / timeline** (`/projects/:id/roadmap`) — Gantt-style epic
  timeline; an epic's own start/due dates take priority, falling back to its
  children's sprint dates.
- **Project analytics** (`/projects/:id/analytics`) — flow, cycle-time
  distribution, and per-assignee workload.
- **Personal analytics** (`/me/analytics`) — your own throughput, cycle time,
  and breakdowns.

![Roadmap / Gantt timeline](/screenshots/roadmap-desktop.png)

---

## Search and navigation

- **Full-text search** across issue titles, descriptions, and comments
  (Postgres `tsvector` + GIN indexes), cross-project.
- **Command palette** — Cmd/Ctrl + K to jump to any issue, project, or board.
- **Persistent sidebar** — workspace switcher, projects with per-project
  views (Board / Backlog / Roadmap / Reports), and your personal section
  (My Work / My Board / Insights / Notifications). Collapsible to an icon
  rail; a drawer on mobile.
- **My Work** (`/my-work`) — everything assigned to you across projects.
- **Quick links** — personal shortcut links with colors and collapsible
  groups.

---

## Import and export

- **CSV export** — download a project's issues (optionally narrowed by an
  NLQL query) from the board or backlog. Columns cover every standard field —
  key, title, type, status, priority, assignee, reporter, story points,
  sprint, labels, start/due dates, description, component, fix versions,
  parent, original estimate, created/updated — plus one column per custom
  field.
- **CSV import** — import issues from the board or backlog (*Import CSV*)
  with a **dry-run preview** before anything is written.
- **Tracker importers** — the importer understands **Jira**, **GitHub
  issues**, and **Linear** CSV exports directly (pick the source in the import
  dialog), mapping their column conventions onto Next Lane fields.

---

## Notifications

- **In-app notifications** for assignments, @mentions, and watched-issue
  events (status changes, new comments), with an unread badge in the header
  and a full **notifications center** at `/notifications`.
- **Email delivery** — when [SMTP is configured](./configuration#smtp--email),
  notifications are also emailed. Each user controls this with the "Email me
  about my issues" toggle in Profile Settings.

---

## Personal boards

Every user has a private Kanban at `/my-board` — columns, card colors, due
dates, and notes, visible only to you. **Promote to issue** converts a
personal card into a real project issue in one click; the card keeps a badge
linking to the new issue key.

---

## Share links (public read-only boards)

Project admins can mint a **share link** (Project Settings → Share) that gives
anyone with the URL a read-only view of the project board at
`/share/<token>` — no login required. Tokens are revocable at any time.

---

## Dark mode and workspace branding

- **Dark / light / system theme** — toggle in the sidebar or user menu;
  preference is remembered per browser and applied before first paint (no
  flash).
- **Workspace branding** (`/workspaces/:id/branding`, admin) — custom
  workspace name, accent color (applied at runtime as CSS tokens, dark-mode
  aware), and logo upload.

---

## Workspace administration

- **Roles per workspace:** Admin, Member, Viewer.
- **Per-project role overrides** (Project Settings → Members) — elevate a
  workspace member to project ADMIN or restrict them to project VIEWER for
  one project only. Workspace admins always retain access, and the last-admin
  invariant prevents lockouts.
- **Member management** (`/workspaces/:id/members`) — invite, remove, and
  change roles.
- **Audit log** (`/workspaces/:id/audit-log`, admin) — a record of member
  actions across the workspace.
- **Multiple workspaces** per instance, each with its own projects, members,
  and settings.

---

## Authentication and API access

- **Email/password** login with JWT sessions; password reset via SMTP email
  (in dev, the reset link is printed to the API log instead).
- **SSO / OIDC + SAML** — a "Continue with …" button per configured
  provider, backed by any standards-compliant OIDC provider (Okta, Auth0,
  Keycloak, Authentik, Google Workspace, …) with PKCE, CSRF protection, and
  just-in-time user provisioning, **plus SAML 2.0** and any number of
  **additional simultaneously-configured providers** (each with its own
  optional default workspace/role for a brand-new identity's first login).
  Configure the primary provider via
  [environment variables](./configuration#sso--oidc-login) or in-app at
  **`/admin/sso`** (instance-admin only; env vars take precedence); every
  additional provider (OIDC or SAML) is configured entirely in-app.
- **Personal API tokens (PATs)** — long-lived `nlp_...` tokens for scripts and
  agents (Profile Settings → API Tokens), optionally restricted to scopes
  (`issues:read`, `projects:write`, `gitlab:read`, …). Used by the
  [MCP server](./agents-mcp) and the REST API alike.
- **REST API** — the full NestJS API is documented via Swagger at
  `http://localhost:4000/api`.

---

## Integrations

### GitHub

Per-project two-way link (Project Settings → GitHub, admin): PRs, commits, and
branches that mention an issue key (e.g. `NL-123`) appear in the issue's
**Development** section via an HMAC-verified webhook. Setup steps and optional
env vars in [Configuration](./configuration#github-integration-phase-9--developer-graph-v1).

### GitLab

The same two-way link for GitLab (Project Settings → GitLab, admin) —
gitlab.com **or self-managed** (set the instance base URL). Merge requests,
commits, and branches referencing an issue key show on the issue; inbound
webhooks are verified via GitLab's Secret Token header. See
[Configuration](./configuration#gitlab-integration).

### Gitea

The third self-hosted forge alongside GitHub and GitLab (Project Settings →
Gitea, admin): pull requests, commits, and branches referencing an issue key
show up in the issue drawer's **Development** section next to any
GitHub/GitLab links. Gitea has no shared SaaS host, so the instance URL is
required (e.g. `https://git.example.com`). Inbound webhooks are verified via
HMAC-SHA256 (`X-Gitea-Signature`). v1 is deliberately **links-only** — no
live PR/CI status and no auto-transition-on-merge yet (unlike the GitHub/GitLab
follow-up work). See
[Configuration](./configuration#gitea-integration).

### Webhooks

Outbound webhooks deliver issue events to any system: HMAC-signed payloads,
SSRF guard on by default (`WEBHOOK_ALLOW_PRIVATE` opt-out), durable BullMQ
delivery with retries when Redis is configured.

### Pages — project knowledge base

A project-scoped wiki that blends a Confluence-style page tree with
Obsidian-style linking and a visual knowledge graph — and, unlike either of
those, one an AI agent can traverse programmatically. Reach it from a
project's **Pages** tab (`/projects/:id/pages`).

**Navigation.** A collapsible tree sidebar lists every page, nested
arbitrarily deep, with a **Document** / **Graph** view switcher in the header
and a project breadcrumb above it. "New page" creates a root page; a
per-row hover action creates a child under any existing page. The tree is a
full WAI-ARIA `tree` widget — arrow keys move between rows, Left/Right
collapse/expand or jump to parent/first child, Enter opens — and rows have
their own up/down move and delete actions. On mobile the tree becomes a
slide-over drawer opened from the document header. Opening a page
auto-expands the tree down to it, so you're never looking at a page with its
own location collapsed out of view.

**The markdown editor.** Click **Edit** to switch a page into an editable
title + body. The body is a plain-markdown textarea (mermaid diagrams render
too, same pipeline as issue descriptions) with one addition: typing `[[`
opens a per-keystroke autocomplete dropdown of matching page titles —
arrow keys to move, Enter/Tab to accept, Escape to dismiss, exactly like the
`@mention` composer elsewhere in the app. `[[Existing Page]]` resolves to a
real link; `[[Some New Idea]]` that doesn't match anything yet is still valid
syntax — it renders as a dashed **"create it"** link that spins up a new page
pre-filled with that title on click. `[[Title|custom display text]]` aliases
the link text. A live counter next to Save/Cancel shows how many links in the
draft are currently unresolved. Because `[`, `]`, and `|` are reserved for
this link grammar, page **titles** can't contain them — the "New page" modal
validates this inline before you can hit a round-trip 400.

**Version history.** Every save snapshots a full, immutable `PageVersion` —
**append-only**, nothing is ever overwritten. The History drawer (clock icon,
top-right of a page) lists every version newest-first with author and
relative timestamp, expands inline to preview that version's rendered
content, and offers **Restore**. Restoring doesn't roll back destructively —
it writes a *new* version with the old content, so the version you restored
*from* stays in history too. You can never lose a revision.

**Backlinks — "what links here."** Below every page, a panel lists every
*other* page in the project whose body links to it via `[[wiki-link]]`,
letting you navigate a wiki by its actual reference graph instead of only
the tree. Version previews reuse the same wiki-link-aware renderer, so a
restored version's links are just as navigable as the live one.

**Knowledge graph view.** Switch to **Graph** for an Obsidian-style
force-directed visualization of the whole project: every page is a node,
every resolved `[[wiki-link]]` a directed edge. It's hand-rolled on plain SVG
(no external graph library or CDN — keeps the self-hosted, script-src-`self`
CSP posture) and supports drag-to-pan, mouse-wheel/pinch-to-zoom plus
keyboard-reachable +/−/reset controls, and hovering (or focusing) a node dims
everything except it and its direct neighbors so a dense graph's local
structure stays readable. Click a node to open that page. It works on
mobile (touch pan/pinch, a canvas sized to the actual viewport rather than a
shrunk "world"), respects dark mode, and honors `prefers-reduced-motion` by
skipping the settle-in animation while still converging to the same final
layout.

<!-- SCREENSHOT PLACEHOLDER: pages-graph-desktop.png / pages-graph-mobile.png
     not yet captured. Once shot per docs/screenshots/README.md, replace this
     comment with:
     ![Pages knowledge graph — force-directed page/link view](/screenshots/pages-graph-desktop.png)
-->

**The standout: an agent can walk this graph too.** Next Lane's MCP server
exposes `get_page_graph` (the full node/edge set for a project),
`get_page_backlinks`, and `get_page_links` (a page's own outgoing links,
split into resolved vs. unresolved) alongside full page CRUD and version
tools — letting an AI agent traverse and author the knowledge base
programmatically, not just read a rendered page. Neither a closed,
cloud-only wiki (no graph/agent API) nor a local-only graph note-taking tool
(no server, no agent surface) offers that combination. Full tool reference in
[AI Agents & MCP](./agents-mcp#the-117-tool-surface-at-a-glance).

Issue ↔ page cross-linking (a "Linked pages" section on the issue drawer) is
on the roadmap, not shipped yet — today, pages link to each other, not to
issues.

### AI agents (MCP)

The flagship integration — 117 tools over the Model Context Protocol, with
per-project agent memory. See the dedicated
[AI Agents & MCP](./agents-mcp) chapter.
