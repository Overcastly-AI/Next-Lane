# Changelog

All notable changes to Next Lane are documented here.
Next Lane is built and maintained by [Overcastly AI](https://overcastly.com).

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Next Lane uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

This section summarizes the major capabilities delivered in the pre-1.0
development phase. A versioned release will be tagged once the v1 criteria in
[`docs/ROADMAP.md`](./docs/ROADMAP.md) are complete.

### Added — 2026-07-02

**Configurable dashboards (Phase 1):**
- **NLQL-native dashboards** — per-project dashboards where every gadget is an
  NLQL query plus a visualization (STAT, TABLE, BREAKDOWN, or BURNDOWN). Gadgets
  render with per-visualization configuration (grid layout, field grouping, column
  selection, row limits). Invalid/unresolvable queries return per-gadget errors
  instead of 500s.
- **Dashboard UI** — new `/projects/:id/dashboards` page with gadget grid, create
  modal, edit modal, and drag-and-drop gadget reordering. Sidebar/ProjectNav
  navigation entries added (MEMBER+ to view, VIEWER read-only).
- **MCP tooling** — 9 new dashboard and gadget CRUD tools (list/get/create/update
  /delete dashboards and gadgets, plus get_dashboard_data for server-side
  evaluation). MCP server now 85 tools (36 read, 49 write).
- **Backend** — `apps/api/src/dashboards/` module with controller, service, DTOs,
  and gadget evaluator (reuses shared validateQuery/filterIssues). 40+ new unit
  tests. Schema: additive `Dashboard` and `DashboardGadget` models
  (migration 20260702010000_add_dashboards).
- **E2E tests** — 10 new desktop/mobile tests for dashboard create, STAT gadget
  display, BREAKDOWN visualization, VIEWER read-only, per-gadget error handling,
  and 393px no-overflow.

### Fixed — 2026-07-02

**Settings robustness sweep:**
- **Admin lockout guard** (P1) — workspace Members invite form no longer silently
  self-demotes a solo admin. Inviting an already-member email returns a friendly
  409; role changes moved to new `PATCH /workspaces/:id/members/:membershipId`
  endpoint, which enforces a last-admin invariant (workspace never locked out of
  admin access).
- **Branding color validation** (P2) — hex input now normalizes 3-digit CSS
  shorthand to 6-digit before submit instead of server 400.
- **Status & label uniqueness** (P2) — statuses and labels now reject case-insensitive
  duplicate names per project with friendly 409 errors.

**Workflow robustness sweep:**
- **Unified status-change enforcement** (P1) — Triage's "s" picker, issue drawer
  status dropdown, and bulk edit no longer silently bypass board-assigned named
  workflows or project-level workflow enforcement. All surfaces now route through
  a single `IssuesService#enforceStatusChange()` that resolves and checks both
  named and legacy workflow gates before allowing a transition.
- **REQUIRE_FIELD gate resolution** (P2) — custom-field gates now resolve field
  names/keys case-insensitively to definition IDs; field input in the gate editor
  is a curated `<select>` instead of freeform text.
- **Gate validation** (P2) — REQUIRE_FIELD and REQUIRE_LINK gates reject blank
  field keys with 400; gate editor disables Save until field is chosen; already-stored
  blank-key gates render a "misconfigured" warning.
- **Workflow rename UI** (P2) — named workflows now have an inline rename affordance
  (pencil icon → per-keystroke edit → Enter/blur saves, Escape cancels).
- **Settings disambiguation** (P3) — legacy WorkflowSection and new WorkflowsManager
  now have distinct headings, explanations, and uniquely labeled "+ Add transition"
  buttons.

**CSP & realtime updates (Pass-12 engineering batch):**
- **CSP artifact hardening** (P1) — dark-mode bootstrap moved from a CSP-blocked
  inline `<script>` to a self-hosted `public/theme-init.js` loaded as a static
  asset via `<script src>`, satisfying strict `script-src 'self'` outright.
- **Dashboards realtime coverage** (P1) — dashboards had zero real-time Socket.io
  coverage. Added `SocketEvents.DashboardUpdated`, emitted from every
  `DashboardsService` CRUD mutation; dashboard gadgets refresh automatically when
  any project issue changes (no page reload needed).
- **BulkUpdate N+1 query fix** (P2) — `resolveEnforcedWorkflowId` in bulk-edit
  was issuing one board/sprint query per issue. Fixed via
  `buildBulkWorkflowResolution()` (O(1) queries per batch, not O(issues)).

**Mobile board toolbar regressions (Pass-12 product batch):**
- **Invisible dropdowns** (P1) — board toolbar menus (Group by, Labels, Type, Priority,
  saved filters, NLQL help) were plain `position: absolute` boxes that painted zero
  pixels on a real 393px phone. Fixed with a new portalled, viewport-clamped
  `<DropdownPanel>` component (positions `fixed` instead, flipping above the trigger
  when there's no room below).
- **Filter chip row scrolling** — quick-filter chip row now scrolls properly
  (`overflow-x: auto` + `shrink-0` chips + `.nl-scroll` thin-scrollbar treatment);
  was silently clipping "Recently updated" off-canvas.
- **Sidebar auto-collapse at 1024px** — sidebar now collapses to icon rail by default
  at the 1024-1279px "small laptop" breakpoint (unless user has an explicit preference
  saved); fixes cramped 3-column board at 1024x768 resolution.

**Docs-site mobile menu:**
- Fixed dead mobile navigation menu on the docs site. The hamburger now opens a
  full-height menu (backdrop-filter containing-block fix).

### Added — Navigation & UI

**Persistent left sidebar (Navigation & IA Phase 1):**
- **Desktop** (lg+) gains a fixed persistent sidebar: workspace switcher (shared state
  with header), active workspace's projects, personal section (My Work / My Board /
  Insights / Notifications), and workspace settings utility area. Collapsible to an
  icon rail with state persisted across reloads (no flash).
- **Mobile** (below lg) uses an overlay drawer opened from the header hamburger button;
  header slims to remove duplicate nav links on desktop.
- Full keyboard accessibility (aria-current focus rings, Escape closes drawer),
  prefers-reduced-motion respected, mounted via `SidebarContext` above per-page
  remount boundaries.

**Navigation & IA Phase 2 — sidebar elevation:**
- **Per-project views in sidebar** — Board, Backlog, Roadmap, Reports now expand
  directly under the active project in the sidebar; the Gantt-style Roadmap,
  previously two clicks deep in ProjectNav's "More" dropdown, is one click away.
- **Branding as first-class link** — admin-gated workspace Branding settings now sit
  beside Workspace settings in the sidebar utility area (no longer buried in Project Settings).
- **Board default filter affordance** — the board toolbar's default-filter chip is now
  clickable, opening BoardSettingsModal's filter field with a "+ Default filter" empty-state
  prompt when none is set. Closes founder-reported discoverability gap for filter
  persistence.

**Light / dark mode — full token-layer theming:**
- **Dark palette** — Dispatch design system color scales (ink/slate/red/amber/emerald/
  green/blue/gray/orange/signal/brand) are now CSS custom-property-backed with contrast-verified
  dark values; canvas/surface/shadow semantic tokens re-derived for each mode; ink-scale
  shade roles fixed across light and dark.
- **Theme preferences** — ThemeContext stores user preference (light/dark/system) in
  localStorage (`nl.theme`); System preference auto-applies on first visit.
- **No-flash bootstrap** — synchronous inline script in `index.html` applies `.dark`
  class before first paint, preventing UI flash on theme toggle or reload.
- **Dark-aware workspace branding** — custom workspace brand colors compose correctly
  in dark mode; `applyBrandColor()` handles contrast and token composition.
- **ThemeToggle** rendered in sidebar utility area and header user menu. ~190 hardcoded
  bg-white/ring-white/border-white utilities migrated to surface tokens; modal/drawer
  backdrops pinned to mode-invariant scrim token.

### Added — Agent-native / MCP

**MCP coverage parity sweep:**
- **21 new tools** closing the founder-flagged gap between shipped features and MCP
  exposure. New tools: GitHub issue links (read-only, PAT scope aware), quick links
  (personal shortcuts), personal boards (list + create/move cards via /me identity),
  issue templates (list + create-issue-from-template), time-tracking original estimate
  field, CSV export (get_project_csv, raw text), bulk update (bulk_update_issues),
  project/personal analytics + velocity/burndown/CFD reports, notifications (list +
  mark read). 
- **Total: 76 tools** (33 read, 43 write), up from 55. Every new tool live-tested
  against the running API with a fresh demo-user PAT before commit; 33 new unit tests
  added (53 total, green).

### Added — Boards & project tracking

- **Multiple boards per project** with Kanban and Scrum board types.
- **Drag-and-drop card ordering** using fractional indexing (no full-column
  renumber on every move).
- **Custom statuses / columns** per project.
- **Live presence indicators** (Socket.io; who else is looking at this board
  right now).
- **Backlog view** with keyboard triage mode (j/k/s/p/a/l shortcuts).
- **Sprints** — create, start, complete; sprint goals and date ranges.
- **Kanban sections by field — Swimlanes v2** — group board issues by Assignee,
  Priority, Issue type, Epic, Component, Sprint, Labels, or custom SELECT fields.
  Each board has an optional `defaultGroupBy` setting; URL parameter `?group=`
  overrides. Labels surfaces each issue in every one of its label lanes. Custom
  SELECT fields render one lane per option (field order) plus a "None" lane for
  unset values.

### Added — Issues

- Issue types: Task, Bug, Story, Epic, Sub-task.
- **Epics and sub-tasks** (parent/child hierarchy).
- Labels, story points, due dates, assignee, reporter, priority.
- **Custom fields** — project-scoped typed field definitions (Text, Number,
  Select, …); values stored in JSONB.
- Markdown descriptions and threaded comments.
- File attachments (uploaded to the API; named Docker volume or PVC on k8s).
- **Issue links** — directed relationships: BLOCKS, RELATES_TO, DUPLICATES, and
  more.
- **Watchers** — watch any issue and receive in-app notifications on changes.

### Added — NLQL query language + saved filters

- **NLQL** (Next Lane Query Language) — a real structured query language for
  filtering issues: `assignee = me() AND priority in (High, Highest)`.
- **Saved filters** — persist, name, and share queries; boards can be pinned
  to a saved filter.
- **Conditional card colors** — rule-based color highlighting on board cards
  (driven by NLQL conditions).

### Added — Agile rituals

- **Planning poker** — real-time estimation sessions via Socket.io; facilitator
  controls reveal; per-session history.
- **Async standups** — team standups with per-member responses and a team
  digest; personal and team views.

### Added — Reports & analytics

- Burndown, velocity, and cumulative-flow diagram (CFD) charts.
- **Timeline / roadmap view** (Gantt-style, per-project).
- **Personal analytics** — individual velocity and throughput.
- **Team analytics** — team pulse and aggregate metrics.
- **Project analytics** tab per project.

### Added — Search & navigation

- **Full-text search** (Postgres `tsvector` with GIN index) across all issues.
- Cross-project search.
- **Command palette** (Cmd/Ctrl + K).
- Filtering by assignee, status, priority, labels, sprint, and custom fields.

### Added — Collaboration & notifications

- In-app notifications and @mention support in comments.
- Activity log per issue.
- **"My Work"** dashboard — issues assigned to the current user across projects.
- **Team Pulse** dashboard — team-wide activity feed.

### Added — Personal boards

- **Personal board** — a private Kanban for todos and personal tasks, separate
  from project boards.
- "Promote to issue" — convert a personal card into a real project issue with
  one click; the card shows a promoted badge with the new issue key.
- **Public read-only project share link** — mint a `ShareToken` for a project
  board and share a read-only view with anyone (no login required).

### Added — Bulk edit & export

- **Bulk edit** — multi-select issues in Backlog and Triage; bulk update
  assignee, status, priority, labels, sprint.
- **CSV export** — download all project issues as a CSV file from the board or
  backlog.

### Added — Automation engine (Glass Box)

- **Trigger → Condition → Action** rule engine; conditions reuse NLQL syntax.
- Actions: change status, assignee, priority, labels; post a comment.
- **Glass Box run log** — every automation execution is recorded with trigger
  data, evaluated conditions, and action outcomes; full audit trail.
- Unlimited automation runs (runs on your hardware — no per-run billing).

### Added — Workspace branding

- **Workspace branding** — custom workspace name, accent color (CSS variable
  token system applied at runtime), and logo upload (served directly by the
  API).

### Added — Auth & security

- Email/password authentication with JWT access tokens.
- **SSO/OIDC** — generic, provider-agnostic OIDC login (Okta, Auth0, Keycloak, Authentik, Google, etc.) with PKCE/CSRF protection and JIT user provisioning.
- **Personal API tokens (PATs)** for programmatic and agent access.
- Password reset via SMTP email (link logged to console when SMTP is not
  configured — safe for development).
- Role-based access control: Admin, Member, Viewer.
- **Workspace audit log** — member actions recorded and viewable by admins.
- **HMAC-signed outbound webhooks** with configurable SSRF guard.
- Rate limiting (per client IP; configurable; off switch for dev/NAT).

### Added — Deployment & ops

- **One-command Docker Compose** (`docker compose up -d --build`); auto-runs
  `prisma migrate deploy` + optional demo seed on first boot.
- **Helm chart** (`deploy/helm/next-lane`) — migration pre-install Job, HPA,
  PodDisruptionBudget, cert-manager TLS, bundled or external PostgreSQL/Redis.
- **Kustomize overlays** (`deploy/kustomize`) — dev and prod overlays.
- Multi-arch GHCR image builds (linux/amd64, linux/arm64) via GitHub Actions.
- SPDX SBOM attestation and Trivy image scan on every image publish.
- Structured JSON logs (pino) with request correlation IDs (`X-Request-Id`).
- Health and liveness probes (`GET /health`, `GET /health/live`).
- Redis-backed Socket.io adapter for horizontal API scaling.
- BullMQ webhook delivery queue for durable, retried webhook fan-out.

### Added — Workflow automation (SDLC)

- **Configurable per-project workflows** — define issue types, statuses, and transitions for your project's SDLC.
- **Per-board workflow assignment** — assign different workflows to different boards within the same project.
- **Workflow visual graph editor** — design your SDLC with a drag-and-drop graph interface (nodes for statuses, edges for transitions).
- **Workflow templates** — seed from built-in templates (simple, kanban, scrum, bug-triage).
- **Transition gates** — require assignee, description, custom fields, issue links, or no open blockers before allowing a move.
- **Issue templates** — create reusable issue templates (with default values for fields, description boilerplate, etc.); create issues from templates.

### Added — Issues & estimation

- **Checklists** — sub-task-like items within issues; track progress and completion.
- **Time tracking / work logs** — log time spent on issues; track original estimate vs. actual hours; per-issue and per-sprint rollup.
- **Components** — project-scoped issue groupings (e.g., "API", "UI", "Docs") with optional default assignee.
- **Versions / Releases** — project-scoped release tracking (UNRELEASED / RELEASED / ARCHIVED states); M:N relationship with issues.
- **WIP limits** — per-status column limits with visual warnings.
- **Custom field values pinned as chips on cards** — show selected custom field values directly on board cards.
- **Blocked badge** — visual indicator on cards with unresolved blocking issue links.

### Added — Board & views

- **Board swimlanes / grouping** — group issues by assignee, custom field, component, or version; URL-persisted.
- **Per-board default filter** — auto-apply an NLQL filter when viewing a board.
- **Filter state URL persistence** — board filters (including swimlane grouping) persist in the URL; shareable filtered views.

### Added — Personal & quick links

- **Personal board enhancements** — drag-to-reorder columns · card colors (user-selected) · due dates on personal cards · click-to-open detail drawer · column colors.
- **Quick links** — personal shortcuts in the header with accent colors and collapsible groups.
- **Workspace quick links** — per-user quick link bar for fast navigation.

### Added — NLQL & markdown

- **NLQL autocomplete** — intelligent suggestions for NLQL queries; reused in automation conditions and custom field filters.
- **Mermaid diagram support** — render Mermaid diagrams in markdown descriptions and comments; lightbox zoom (click to view full-screen).

### Added — Import & export

- **CSV import** — import issues from Jira, GitHub, or Linear CSV exports with dry-run preview.
- **Tracker importers** — dedicated importers for Jira, GitHub, and Linear; map fields and preserve issue relationships.
- **CSV export completeness** — export all issue fields and metadata to CSV.

### Added — Notifications

- **Notifications center page** (`/notifications`) — unified inbox for all in-app notifications.
- **Email notification delivery** — receive email digests for issue assignments, mentions, watchers, status changes, and automation actions.
- **Notification preferences** — per-user granular control over email delivery.

### Added — Workspace & collaboration

- **Workspace settings page** — unified workspace management UI.
- **Workspace member management** — invite, remove, and manage member roles.
- **Workspace search & recents in header** — quick workspace switcher with search and recent workspace list.

### Added — MCP (Model Context Protocol)

- **MCP server** (`@next-lane/mcp`, 55 tools) — AI agents (Claude Desktop, Claude Code, any MCP host) can read and write workspace state via the same REST API.
- **Tools for workflows/SDLC** — list, create, update, delete workflows · manage transitions and gates · assign workflows to boards.
- **Tools for issues & tracking** — create, update, move, link issues · manage checklists, worklogs, and issue links.
- **Tools for board management** — list/create/update boards · assign workflows · manage board-level filters and settings.
- **Tools for org entities** — manage sprints, statuses, labels, components, versions, automations, saved filters, custom fields.
- **Tool for user lists** — list workspace members (for @mention and assignee suggestions in agents).

### Added — GitHub integration (Phase 9 — Developer Graph v1)

- **Per-project GitHub repo linking** — two-way connection with GitHub repositories; PRs, commits, and branches referencing an issue key (e.g. `NL-123`) automatically appear in the issue's Development section.
- **Webhook receiver** — HMAC-verified inbound GitHub webhooks (Push and Pull Request events) with project-scoped issue-key extraction.
- **Encrypted PAT storage** — GitHub Personal Access Tokens stored at rest with AES-256-GCM encryption; tokens never returned by any API response after saving.
- **Settings UI** — project admins configure the repo and PAT from **Project Settings → GitHub**; webhook URL and secret auto-generated and displayed for GitHub repo setup.
- **Development section on issues** — PR and commit links show in the issue drawer with title, state, author, and GitHub URL.

### Added — Developer experience

- pnpm monorepo: `apps/api` (NestJS), `apps/web` (React + Vite), `apps/mcp` (MCP server), `packages/shared`.
- Prisma schema as single source of truth; all changes via migrations.
- Shared TypeScript types in `packages/shared` — no duplication.
- Playwright e2e suite (desktop + mobile); CI workflow (typecheck + build + unit
  tests) + E2e workflow with Postgres/Redis service containers.
- Claude Code agents, skills, and workflows (`.claude/`) for AI-assisted
  development.
- **Cross-page state-coherence QA gates** — ensure workspace/board changes propagate correctly across all surfaces (navigation, deep-link, reload).

---

[Unreleased]: https://github.com/Overcastly-AI/Next-Lane/compare/HEAD...HEAD
