# Next Lane — Research Brief

Open-source, self-hosted issue & project tracker running locally via Docker. This brief grounds the architecture and roadmap. Decision-oriented; bullets over prose.

---

## 1. Core feature set for an issue tracker (MVP → V1 → Later)

Phased so an AI agent can build incrementally. Each phase should be shippable and usable on its own.

### MVP — "A usable single-team tracker"
- **Projects**: create/edit/archive; project key (e.g. `NL`) used for issue numbering (`NL-123`).
- **Issues/tickets**: types **Task**, **Bug**, **Story** (epic/subtask deferred). Fields: title, description (rich text/markdown), type, status, assignee, reporter, priority, created/updated.
- **Statuses**: fixed set **To Do / In Progress / Done** (custom workflows later).
- **Kanban board**: columns = statuses; **drag-and-drop** cards between columns and reorder within a column.
- **Assignees**: single assignee per issue.
- **Priorities**: enum (Lowest/Low/Medium/High/Highest).
- **Comments**: flat list per issue.
- **Activity log**: append-only field-change + comment history per issue.
- **Search**: basic full-text + filter by status/assignee/type/priority.
- **Users & auth**: self-hosted email+password, JWT sessions; single workspace.
- **Card ordering**: fractional-index `rank` field (see §4).

### V1 — "Real agile, multi-team"
- **Issue types**: add **Epic** (parent of stories) and **Sub-task** (child of any issue). Epic link / parent-child hierarchy.
- **Backlog** view: ordered list of issues not in an active sprint.
- **Sprints**: create, start, complete; move issues backlog ↔ sprint; sprint goal & dates.
- **Scrum board**: sprint-scoped board alongside kanban.
- **Custom workflows/statuses**: per-project status definitions + allowed transitions; column-to-status mapping.
- **Labels** (many-to-many) and **components/tags**.
- **Attachments**: file upload per issue (local volume or S3-compatible).
- **Reports/dashboards**: **burndown** (sprint), **velocity** (completed points per sprint), cumulative flow.
- **Story points / estimates** field.
- **Users/teams/roles/permissions**: roles (Admin/Member/Viewer); project-level membership; basic permission checks.
- **Notifications**: in-app notification center + assignment/mention/comment events (realtime via WebSocket).
- **Saved filters** and shareable filter URLs.
- **Watchers** on issues.

### Later — "Power features & extensibility"
- **JQL-equivalent query language**: parser → SQL/query builder (`status = "In Progress" AND assignee = me ORDER BY priority DESC`). Ship a structured filter builder first; add the text DSL later.
- **Custom fields**: typed (text/number/select/multiselect/date/user); per-project; rendered dynamically (EAV or JSONB — see §4).
- **Advanced workflows**: transition conditions, validators, post-functions, automation rules.
- **Time tracking**: original estimate / time spent / remaining; worklogs; reports.
- **Email notifications** (SMTP) + digest; email-to-issue.
- **Advanced dashboards**: configurable widget grid, gadgets, multi-project reporting.
- **Roadmap / timeline (Gantt)** view across epics.
- **Webhooks + REST API + API tokens** for integrations.
- **Audit log**, bulk edit, import/export (CSV; importers for other trackers), SSO/OIDC, mobile-responsive polish.

---

## 2. Recommended Tech Stack

Constraint: fully OSS, runs locally in Docker, buildable incrementally by an AI agent. Favor **mainstream, well-documented, conventional** choices (large training-data footprint = fewer agent mistakes).

### Backend — **NestJS + Prisma** (recommended) over Fastify+Prisma
- **NestJS**: opinionated module/controller/service structure, DI, validation pipes, guards (auth/RBAC), built-in WebSocket gateway, OpenAPI generation. The structure is highly regular → ideal for an AI agent generating consistent CRUD per entity. Runs on Fastify adapter under the hood for performance.
- **Fastify+Prisma** is lighter/faster but unopinionated; the agent must invent structure each time → more drift. Prefer Nest for consistency.
- **Prisma** ORM either way: typed schema-first model, migrations, great DX, strong AI familiarity.
- Trade-off: Nest has more boilerplate/startup overhead — acceptable for a self-hosted app.

### Database — **PostgreSQL** (recommended, no contest)
- Relational integrity for issues/sprints/projects; `JSONB` for custom fields; full-text search built in (`tsvector`) before any external search engine; mature, single-container.

### Frontend — **React + Vite + TypeScript** stack (all recommended)
- **React + Vite + TS**: fast HMR, conventional, huge ecosystem. (Note: Plane itself migrated Next.js → React Router + Vite.)
- **Tailwind CSS + shadcn/ui**: copy-in components (you own the code), accessible primitives (Radix), consistent design system the agent can extend.
- **TanStack Query**: server-state caching, mutations, optimistic updates (essential for snappy drag-drop). Pair with a thin client (axios/fetch).
- **dnd-kit**: modern, accessible, performant drag-and-drop for board columns/cards. Recommended over react-beautiful-dnd (deprecated/maintenance mode).
- **Zustand** for local UI state (optional; keep server state in TanStack Query).
- Routing: **React Router** (or TanStack Router).

### Realtime — **Socket.io** (recommended) via NestJS WebSocket gateway
- Board/issue live updates, notifications, presence. Socket.io gives reconnection/rooms/fallbacks out of the box; rooms scoped per project/board. Use **Redis adapter** if scaling to multiple API instances (single-instance self-host can skip it initially). Raw WS is leaner but you rebuild reconnection/rooms yourself.

### Auth — **self-hosted JWT** (recommended)
- Email+password → short-lived access JWT + refresh token (httpOnly cookie). Nest `@nestjs/passport` + `passport-jwt` + `bcrypt`/`argon2`. RBAC via Nest guards. Add OIDC/SSO in "Later".

### Cache/Queue — **Redis**
- TanStack-side caching is client; server-side use Redis for: Socket.io adapter, session/refresh-token denylist, background jobs (BullMQ — notifications, email, report aggregation).

### Recommended stack summary

| Layer | Choice |
|---|---|
| Backend | NestJS (Fastify adapter) + Prisma |
| DB | PostgreSQL 16 |
| Cache/Queue/Pub-sub | Redis 7 + BullMQ |
| Frontend | React + Vite + TypeScript |
| UI | Tailwind CSS + shadcn/ui |
| Server state | TanStack Query |
| Drag & drop | dnd-kit |
| Realtime | Socket.io (Redis adapter) |
| Auth | JWT (access + refresh), argon2/bcrypt |

---

## 3. How Similar OSS Tools Are Architected

| Tool | Backend | Frontend | DB / Infra | Notable patterns |
|---|---|---|---|---|
| **Plane** | Django (Python) + DRF; microservices (Gateway proxy, Pilot for integrations) | TypeScript; **migrated Next.js → React Router + Vite** | PostgreSQL + Redis (Celery background tasks); MinIO/S3 for files | Issue = central "block" entity (Notion-like); REST API + OAuth2 + HMAC webhooks + typed SDKs (Node/Python). Good reference for issue-as-core-entity + clean API surface. |
| **Taiga** | Django (Python) | **Angular** (taiga-front) | PostgreSQL + Redis; RabbitMQ + Celery for async/events | Split front/back repos; mature agile model (epics/userstories/tasks/issues as distinct types); events via async backend. |
| **Focalboard** | **Go** | React | SQLite/PostgreSQL/MySQL; single-binary, single-tenant | Lightweight, embeddable, block-based data model (Notion/Trello style). Great example of a minimal self-hosted board server. |
| **OpenProject** | **Ruby on Rails** | Angular + Rails views | PostgreSQL; Memcached | Heavyweight, enterprise; classic + agile + Gantt; deep permission/role model worth studying for RBAC design. |
| **Huly** | Node/TypeScript; multi-service (account, front, transactor, queues) | TypeScript (Svelte) | **MongoDB + Elasticsearch** (heavier dep set) | Real-time transactor/event-sourcing model; all-in-one (PM + chat + docs). Heavy infra — a cautionary reference for scope creep. |
| **Tracecat** | FastAPI + Pydantic (Python) | Next.js + TS | PostgreSQL + Temporal (durable workflows) + S3 | Not PM, but good pattern for durable workflow orchestration if you add automation rules later. |

### Patterns worth borrowing
- **Issue as the central entity** (Plane/Focalboard) — everything links to issues; keep the core model small and extend via fields/relations.
- **PostgreSQL + Redis** is the converged default (Plane, Taiga) — validates the §2 stack. Avoid Huly's Mongo+Elasticsearch heaviness for a "runs on a PC" goal.
- **Lexicographic/fractional rank string per item** for ordering (LexoRank-style) — single-column, single-row-update reorders (see §4).
- **Async events/queue** (Celery in Plane/Taiga; BullMQ for us) for notifications/reports rather than blocking requests.
- **Split or modular front/back** with a typed REST API + webhooks for extensibility (Plane's SDK approach).
- Keep search **in-database first** (Postgres FTS) — don't pull in Elasticsearch until genuinely needed.

---

## 4. Data Model Essentials

### Core entities & relationships
- **Workspace** (1) → **User** (M:N via **Membership** with role) — single workspace for MVP.
- **Project** (belongs to Workspace): `key`, name, lead. Owns issues, statuses, board(s), sprints.
- **User**: auth + profile. **Membership**(user, project/workspace, role).
- **Issue** (core): `id`, `projectId`, `key` (`NL-123`, per-project sequence), `type` (epic/story/task/bug/subtask), `title`, `description`, `statusId`, `assigneeId`, `reporterId`, `priority`, `storyPoints`, `parentId` (self-FK → epic/subtask hierarchy), `sprintId` (nullable), `rank` (ordering string), timestamps.
- **Status** (per project): name, category (todo/in-progress/done), order. (Workflow transitions table in V1.)
- **Sprint** (belongs to Project): name, goal, startDate, endDate, state (future/active/completed).
- **Board** (belongs to Project): type (kanban/scrum), column→status mapping.
- **Comment** (belongs to Issue, author).
- **Attachment** (belongs to Issue): filename, path/url, size, uploader.
- **Label** (per project) ↔ **Issue** (M:N via IssueLabel).
- **ActivityLog / IssueHistory** (belongs to Issue): actor, field, oldValue, newValue, timestamp (also stores comment events).
- **Watcher** (issue ↔ user, M:N).
- **Notification** (recipient, type, payload, read).
- **CustomFieldDefinition** (per project: key, type, options) + values stored in **`Issue.customFields JSONB`** (recommended) — avoids EAV join explosion; index with `jsonb_path_ops` / GIN. Use a typed EAV table only if you need heavy per-field querying/reporting.

Key relationships: Project 1→M Issue; Issue M→1 Status; Issue M→1 Sprint (nullable); Issue self-referential (parent/children for epic↔story↔subtask); Issue M↔N Label; Issue 1→M Comment/Attachment/History.

### Card ordering — **recommendation: fractional indexing (LexoRank-style rank string)**
- Store a single `rank` string column on Issue; sort by `ORDER BY rank`.
- On reorder, compute a key **between** the two neighbors (`rankBefore`, `rankAfter`) → update **one row only**. No mass re-numbering.
- Use a library: **`fractional-indexing`** (npm, by the Figma author) or implement a LexoRank-style base-36 string with bucket prefix.
- Scope rank per ordering context (e.g. per board-column or per sprint) — store the relevant `rank` keyed by that context (a separate `rank` per board column if a card can appear in multiple views).
- **Caveat**: keys grow on repeated insertions in the same gap; add an occasional **rebalance/normalization** job (LexoRank uses buckets for this). For a local single-team tool this is rarely hit, but build the rebalance routine in "Later".
- Why not integer `position`: every reorder rewrites many rows. Why not pure float midpoints: float precision exhausts quickly. The string-key fractional approach is the proven Figma-style fractional-index pattern.

---

## 5. Docker Compose Layout

Single `docker-compose.yml` at repo root; `runs on a PC` is the design center. Services: **postgres, redis, api, web** (+ optional reverse proxy).

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: nextlane
      POSTGRES_PASSWORD: ${DB_PASSWORD:-nextlane}
      POSTGRES_DB: nextlane
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U nextlane"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  api:
    build: ./api          # NestJS + Prisma
    environment:
      DATABASE_URL: postgresql://nextlane:${DB_PASSWORD:-nextlane}@postgres:5432/nextlane
      REDIS_URL: redis://redis:6379
      JWT_SECRET: ${JWT_SECRET}
      JWT_REFRESH_SECRET: ${JWT_REFRESH_SECRET}
    depends_on:
      postgres: { condition: service_healthy }
      redis:    { condition: service_healthy }
    ports:
      - "4000:4000"
    volumes:
      - uploads:/app/uploads   # local attachment storage
    # run `prisma migrate deploy` on startup (entrypoint)

  web:
    build: ./web           # React + Vite (served via nginx in prod build)
    environment:
      VITE_API_URL: http://localhost:4000
    depends_on:
      - api
    ports:
      - "3000:3000"

volumes:
  pgdata:
  redisdata:
  uploads:
```

Notes:
- **Healthchecks + `depends_on: condition: service_healthy`** so api waits for DB/Redis.
- API entrypoint runs `prisma migrate deploy` before boot (idempotent migrations).
- Attachments on a named **`uploads` volume** for MVP; swap to MinIO/S3 service in "Later".
- Add an optional **`proxy` (Caddy/Traefik/nginx)** service later for single-port TLS in front of web+api.
- Provide a `docker-compose.dev.yml` override (bind-mounts + hot reload) for development; keep the base file production-lean.
- Ship a `.env.example`; generate secrets on first run.

---

## 6. Licensing Recommendation

**Recommendation: AGPL-3.0** (with a CLA so you retain the option of a commercial/dual license later). For a self-hosted product whose closest analogues are hosted SaaS products, AGPL-3.0 is the strongest defensive choice: it closes the "SaaS loophole" by requiring anyone who runs a modified version as a network service to release their source, preventing a cloud vendor from taking Next Lane, hosting it, and offering a closed competing service — this is exactly why Plane, Taiga, Mattermost/Focalboard-adjacent, and many self-hosted tools choose copyleft. The trade-off is reduced adoption by companies whose policies forbid AGPL dependencies and inability to embed in proprietary products; if maximizing permissive adoption and contributions matters more than monetization defense, choose **Apache-2.0** (permissive plus an explicit patent grant, the safer permissive pick over **MIT**). Net: pick **AGPL-3.0 + CLA** to keep the project and any future commercial offering protected; fall back to **Apache-2.0** only if frictionless corporate adoption is the priority.

---

## Sources
- [Plane — built with Next.js + Django (DEV)](https://dev.to/vihar/we-built-plane-open-source-project-management-tool-nextjs-django-3hke)
- [Plane releases / React Router + Vite migration](https://github.com/makeplane/plane/releases)
- [Plane.so](https://plane.so/)
- [Huly platform (GitHub)](https://github.com/hcengineering/platform)
- [Tracecat overview](https://www.blog.brightcoding.dev/2025/08/16/tracecat-the-open-source-security-automation-platform-that-puts-no-code-workflows-and-case-management-in-your-hands)
- [LexoRank explained (Medium)](https://medium.com/whisperarts/lexorank-what-are-they-and-how-to-use-them-for-efficient-list-sorting-a48fc4e7849f)
- LexoRank-style fractional indexing (lexicographic rank keys) — see the `fractional-indexing` npm package and Figma's "fractional indexing" write-up.
- [How to efficiently reorder items in a database (fractional indexing)](https://yasoob.me/posts/how-to-efficiently-reorder-or-rerank-items-in-database/)
- [Taiga self-hosting (Postgres + Redis) runbook](https://www.serverspan.com/en/blog/how-to-self-host-taiga-project-management-on-your-linux-vps-in-2026-full-docker-nginx-runbook-for-teams)
- [OSS PM tool comparison (OpenProject/Taiga/Focalboard/others)](https://forum.cloudron.io/topic/8466/project-management-software-comparison-openproject-vs-taiga-vs-redmine-vs-gitlab-vs-wekan-vs-nextcloud-deck-vs-vikunja-vs-espocrm)
