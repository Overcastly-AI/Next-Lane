# Changelog

All notable changes to Next Lane are documented here.

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
- **Swimlanes** and sprint/backlog filtering on the board view.

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
- Components and Versions (Releases) for project-level organisation.

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
- Shared board link (public read-only snapshot of a personal board).

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

### Added — Developer experience

- pnpm monorepo: `apps/api` (NestJS), `apps/web` (React + Vite), `packages/shared`.
- Prisma schema as single source of truth; all changes via migrations.
- Shared TypeScript types in `packages/shared` — no duplication.
- Playwright e2e suite (desktop + mobile); CI workflow (typecheck + build + unit
  tests) + E2e workflow with Postgres/Redis service containers.
- Claude Code agents, skills, and workflows (`.claude/`) for AI-assisted
  development.

---

[Unreleased]: https://github.com/Overcastly-AI/Next-Lane/compare/HEAD...HEAD
