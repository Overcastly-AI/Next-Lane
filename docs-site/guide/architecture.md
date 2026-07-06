# Architecture

This page summarizes how Next Lane is structured. The full authoritative
document is
[`docs/ARCHITECTURE.md`](https://github.com/Overcastly-AI/Next-Lane/blob/main/docs/ARCHITECTURE.md).

---

## High-level overview

Next Lane is a TypeScript monorepo with three deployable concerns:

```
┌─────────────┐     HTTP/WS      ┌──────────────┐     SQL      ┌────────────┐
│   web       │ ───────────────► │     api      │ ───────────► │ postgres   │
│ React+Vite  │ ◄─────────────── │   NestJS     │ ◄─────────── │            │
└─────────────┘   REST + Socket  └──────┬───────┘              └────────────┘
                                         │ pub/sub, queue
                                         ▼
                                   ┌──────────┐
                                   │  redis   │
                                   └──────────┘
```

---

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | NestJS + Prisma (REST + Socket.io) |
| Database | PostgreSQL 16 |
| Realtime / queue | Redis 7 + `@socket.io/redis-adapter` + BullMQ |
| Frontend | React + Vite + TypeScript |
| UI | Tailwind CSS + shadcn/ui + TanStack Query + dnd-kit |
| Auth | JWT access tokens + personal API tokens (PATs) |
| Infra | Docker Compose + Helm chart / Kustomize for Kubernetes |

---

## Monorepo layout

| Path | Purpose |
|------|---------|
| `apps/api` | NestJS backend — REST API, WebSocket gateway, Prisma data access |
| `apps/web` | React + Vite single-page application |
| `apps/mcp` | MCP server (`@next-lane/mcp`) — 105 tools for AI agents over stdio ([guide](./agents-mcp)) |
| `packages/shared` | Shared TypeScript types, enums, NLQL parser/evaluator, API contracts |
| `skills/project-context` | Distributable Agent Skill for the per-project agent-context workflow |
| `deploy/helm/next-lane` | Helm chart for Kubernetes |
| `deploy/kustomize` | Kustomize base + dev/prod overlays |
| `docs/` | Architecture, vision, roadmap, research |
| `.claude/` | Claude Code skills, agents, and workflows |

Managed with **pnpm workspaces** (pnpm 9.x, Node 22).

---

## Backend (`apps/api`)

- **NestJS** with the standard module/controller/service/DTO pattern. Each
  domain is a module: `auth`, `users`, `workspaces`, `projects`, `issues`,
  `boards`, `sprints`, `statuses`, `comments`, `labels`, `custom-fields`,
  `saved-filters`, `automations`, `workflows`, `dashboards`, `analytics`,
  `reports`, `roadmap`, `poker`, `standups`, `personal-boards`, `webhooks`,
  `audit`, `search`, `notifications`, `attachments`, `checklist`,
  `work-logs`, `components`, `versions`, `issue-templates`, `issue-links`,
  `github`, `gitlab`, `share-tokens`, `project-memberships`,
  `agent-context`, `admin-settings`, `realtime`, and more.
- **Prisma** as the ORM and migration tool. The schema is the single source
  of truth. All DB changes go through `prisma migrate`.
- **PostgreSQL** for persistence. Full-text search via generated `tsvector`
  columns with GIN indexes. JSONB for custom field values.
- **Auth:** JWT access tokens + refresh tokens, bcrypt/argon2 password
  hashing, RBAC route guards (Admin / Member / Viewer per workspace).
- **Realtime:** a Socket.io gateway broadcasts board/issue changes. When
  `REDIS_URL` is set, `@socket.io/redis-adapter` enables multi-replica
  fan-out.
- **BullMQ:** webhook deliveries are queued in Redis for durable, retried
  fan-out. Falls back to in-process delivery when Redis is not configured.
- **Validation:** `class-validator` DTOs at every controller boundary.
- **API docs:** Swagger/OpenAPI at `/api`.

---

## Frontend (`apps/web`)

- **React + Vite + TypeScript** SPA.
- **TanStack Query** for all server state — caching, background refetch,
  optimistic updates on drag-and-drop.
- **dnd-kit** for accessible, keyboard-friendly drag-and-drop on boards.
- **Socket.io client** subscribes to realtime updates (board/issue events).
- **Command palette** (Cmd/Ctrl + K) for fast navigation.
- API URL resolved at runtime via `window.__NL_CONFIG__.apiUrl` →
  `VITE_API_URL` → `http://localhost:4000` (priority order).

---

## Data model highlights

The full schema is at `apps/api/prisma/schema.prisma`.

Key entities and relationships:

- `User` —< `Membership` >— `Workspace` (role per membership)
- `Workspace` —< `Project` —< `Issue`, `Status`, `Sprint`, `Board`, `Label`,
  `Component`, `Version`, `CustomFieldDefinition`, `SavedFilter`,
  `AutomationRule`
- `Issue`: `number` (per-project sequence), `type` (TASK/BUG/STORY/EPIC/SUBTASK),
  `rank` (fractional index string), `customFields` (JSONB + GIN index),
  `searchVector` (generated `tsvector` + GIN index), `parentId` (self-FK for
  sub-tasks), `sprintId`, and all standard fields.
- `Issue` —< `Comment`, `Attachment`, `ActivityLog`, `Watcher`, `Notification`
- `Issue` >—< `Label`, `Version` (M:N), `IssueLink` (directed: BLOCKS /
  RELATES_TO / DUPLICATES / …)
- `Board`: KANBAN or SCRUM, `filterQuery` (NLQL string), `colorRules` (JSON),
  optional `savedFilterId` FK
- `SavedFilter`: NLQL query, user-owned, optionally shared to a project
- `AutomationRule`: trigger type, NLQL condition, actions array, enabled flag
- `AutomationRun`: execution record per rule firing (trigger snapshot,
  conditions evaluated, actions taken — the Glass Box audit trail)
- `PokerSession` and `PokerVote` for planning poker
- `StandupRecord` for async standups
- `PersonalBoard` and `PersonalBoardCard` (private, per-user)

**Card ordering** uses **fractional indexing** — each card has a `rank` string
column. Moving a card computes a new lexicographic rank between its neighbors
and updates only that one row. No full-column renumber.

**Delete policy:** user deletion sets actor/author/uploader FKs to null
(`onDelete: SetNull`) rather than deleting history. Project deletion cascades to
all project-scoped children.

---

## Realtime architecture

```
Browser                 API pod(s)              Redis
  │                        │                      │
  │  WebSocket connect      │                      │
  │ ─────────────────────► │                      │
  │                        │── socket.io adapter ►│
  │                        │                      │── pub/sub channel
  │                        │◄── broadcast event ──│
  │◄── event push ─────────│                      │
```

Events (board updates, issue changes, presence) are published to Redis and
broadcast to all subscribers across any number of API replicas. Single-node
installs work without Redis using the in-memory adapter.

---

## CI / CD

- **CI workflow** (`ci.yml`): typecheck, build, and unit tests on every push
  and PR. No database required (Prisma is mocked).
- **E2e workflow** (`e2e.yml`): Playwright suite (desktop + mobile) with real
  Postgres and Redis service containers.
- **Images workflow** (`images.yml`): multi-arch (amd64 + arm64) GHCR publish
  on `main` pushes and version tags. Includes SBOM attestation and Trivy
  vulnerability scan.

---

## Further reading

- [`docs/ARCHITECTURE.md`](https://github.com/Overcastly-AI/Next-Lane/blob/main/docs/ARCHITECTURE.md) — authoritative architecture doc
- [`docs/RESEARCH.md`](https://github.com/Overcastly-AI/Next-Lane/blob/main/docs/RESEARCH.md) — trade-off analysis and design decisions
- [`docs/DEPLOY-KUBERNETES.md`](https://github.com/Overcastly-AI/Next-Lane/blob/main/docs/DEPLOY-KUBERNETES.md) — full Kubernetes reference
