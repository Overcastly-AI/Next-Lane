# Next Lane — Architecture

This document describes how Next Lane is structured and the key technical decisions. For the underlying research and trade-offs, see [`RESEARCH.md`](./RESEARCH.md).

## High-level

Next Lane is a self-hosted issue tracker designed to run on a single machine via Docker Compose. It is a TypeScript monorepo with three deployable concerns plus shared contracts.

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

## Monorepo layout

| Path | Purpose |
|------|---------|
| `apps/api` | NestJS backend — REST API, WebSocket gateway, Prisma data access |
| `apps/web` | React + Vite single-page app |
| `packages/shared` | Shared TypeScript types, enums, and API contracts used by both sides |
| `docs` | Architecture, roadmap, research |
| `.claude` | Claude Code skills, agents, and workflows for AI-assisted development |

Managed with **pnpm workspaces**.

## Backend (`apps/api`)

- **NestJS** with the standard module/controller/service/dto pattern. Each domain (auth, users, projects, issues, boards, sprints, comments, labels) is a module.
- **Prisma** as the ORM and migration tool. The schema is the single source of truth for the data model.
- **PostgreSQL** for persistence. JSONB is used for custom fields (later phase).
- **Auth**: JWT access tokens + refresh tokens, password hashing with argon2/bcrypt, route guards for RBAC.
- **Realtime**: a Socket.io gateway broadcasts board/issue changes; Redis adapter enables horizontal scaling later.
- **Validation**: `class-validator` DTOs at the controller boundary.
- **API docs**: Swagger/OpenAPI served at `/api`.

### Card ordering — fractional indexing

Issues on a board (and in a sprint/backlog) are ordered by a `rank` **string** column. To move a card, we compute a new rank lexicographically *between* its target neighbors and update **only that one row**. This avoids the mass-renumbering of integer `position` columns and the precision exhaustion of float midpoints. A periodic rebalance job (later) normalizes keys if gaps shrink.

## Frontend (`apps/web`)

- **React + Vite + TypeScript**, SPA.
- **TanStack Query** for all server state (caching, optimistic updates on drag).
- **Tailwind CSS + shadcn/ui** for styling and components.
- **dnd-kit** for accessible drag-and-drop on the board.
- **Socket.io client** subscribes to realtime board updates.
- Talks to the API at `VITE_API_URL`.

## Data model (essentials)

Core entities and relationships:

- `User` —< `Membership` >— `Workspace`  (a user belongs to workspaces with a role)
- `Workspace` —< `Project` (`key`, lead)
- `Project` —< `Issue`, `Status`, `Sprint`, `Board`, `Label`
- `Issue`: `key`, `type` (TASK/BUG/STORY/EPIC/SUBTASK), `title`, `description`, `statusId`, `assigneeId`, `reporterId`, `priority`, `storyPoints`, `parentId` (self-FK for hierarchy), `sprintId`, `rank`
- `Issue` —< `Comment`, `Attachment`, `ActivityLog`, `Watcher`
- `Issue` >—< `Label` (join table)
- `Status`: per-project, with a `category` (TODO / IN_PROGRESS / DONE)
- `Sprint`: goal, start/end dates, state (PLANNED/ACTIVE/COMPLETED)

See `apps/api/prisma/schema.prisma` for the authoritative definition.

## Deployment (Docker Compose)

Services:

- **db** — Postgres 16, named volume for data, healthcheck.
- **redis** — Redis 7, healthcheck.
- **api** — built from `apps/api`; runs `prisma migrate deploy` on boot, then starts. Depends on db/redis being healthy.
- **web** — built from `apps/web`; static build served by nginx (prod) or Vite dev server (dev override).

A `docker-compose.dev.yml` override mounts source and enables hot reload. Attachments use a named `uploads` volume in the MVP (swappable for S3/MinIO later).

## Conventions

- Strict TypeScript across the monorepo.
- Database changes only via Prisma migrations.
- Shared types in `packages/shared`; never duplicate domain enums.
- Errors surface as proper HTTP status codes with a consistent error shape.
