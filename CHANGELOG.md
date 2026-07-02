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

### Added — Boards & project tracking

- **Multiple boards per project** with Kanban and Scrum board types.
- **Drag-and-drop card ordering** using fractional indexing (no full-column
  renumber on every move).
- **Custom statuses / columns** per project.
- **Live presence indicators** (Socket.io; who else is looking at this board
  right now).
- **Backlog view** with keyboard triage mode (j/k/s/p/a/l shortcuts).
- **Sprints** — create, start, complete; sprint goals and date ranges.

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
