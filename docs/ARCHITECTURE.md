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
| `apps/mcp` | MCP (Model Context Protocol) server — 55 tools for AI agents to read/write workspace state |
| `packages/shared` | Shared TypeScript types, enums, and API contracts used by both sides |
| `docs` | Architecture, roadmap, research |
| `.claude` | Claude Code skills, agents, and workflows for AI-assisted development |

Managed with **pnpm workspaces**.

## Backend (`apps/api`)

- **NestJS** with the standard module/controller/service/dto pattern. Modules by domain: `auth`, `users`, `workspaces`, `projects`, `boards`, `sprints`, `issues`, `custom-fields`, `components`, `versions`, `labels`, `comments`, `issue-links`, `issue-templates`, `checklist`, `work-logs`, `workflows`, `statuses`, `personal-boards`, `saved-filters`, `sprints`, `standups`, `poker`, `automations`, `notifications`, `webhooks`, `share-tokens`, `api-tokens`, `analytics`, `reports`, `roadmap`, `attachments`, `audit`, `search`, `realtime`, `mail`, `redis`, `github`, and `prisma`. Auth includes an optional `oidc` sub-module (SSO/OIDC with generic provider discovery).
- **Prisma** as the ORM and migration tool. The schema is the single source of truth for the data model.
- **PostgreSQL** for persistence. JSONB is used for custom fields and color rules.
- **Auth**: JWT access tokens + refresh tokens, password hashing with argon2/bcrypt, route guards for RBAC; optional OIDC/SSO with JIT user provisioning.
- **Realtime**: a Socket.io gateway broadcasts board/issue/workspace changes; Redis adapter enables horizontal scaling.
- **Validation**: `class-validator` DTOs at the controller boundary.
- **API docs**: Swagger/OpenAPI served at `/api`.

### Card ordering — fractional indexing

Issues on a board (and in a sprint/backlog) are ordered by a `rank` **string** column. To move a card, we compute a new rank lexicographically *between* its target neighbors and update **only that one row**. This avoids the mass-renumbering of integer `position` columns and the precision exhaustion of float midpoints. A periodic rebalance job (later) normalizes keys if gaps shrink.

## Frontend (`apps/web`)

- **React + Vite + TypeScript**, SPA.
- **TanStack Query** for all server state (caching, optimistic updates on drag).
- **Tailwind CSS + shadcn/ui** for styling and components.
- **dnd-kit** for accessible drag-and-drop on the board and personal board.
- **Socket.io client** subscribes to realtime board/issue/workspace updates.
- Talks to the API at `VITE_API_URL`.
- **Mermaid.js** for rendering diagrams in markdown descriptions and comments.

## MCP Server (`apps/mcp`)

- **Model Context Protocol** server (stdio transport) with **55 tools** (21 read, 34 write).
- Speaks MCP over stdio; makes authenticated HTTP calls to the Next Lane REST API using Personal Access Tokens (PATs).
- Tools expose: projects, boards, workflows, statuses, issues, sprints, comments, worklogs, checklists, labels, components, versions, saved filters, automations, and more.
- Allows AI agents (Claude Desktop, Claude Code, any MCP host) to **read and write** workspace state, including the workflow/SDLC graph itself.
- See `apps/mcp/README.md` for the full tool reference and configuration.

## Data model (essentials)

Baseline v2 (applied 2026-06-28). Single migration: `20260628004947_baseline_v2`. See `docs/DATA-MODEL-REVIEW.md` for the full audit and deferred items.

Core entities and relationships:

- `User` —< `Membership` >— `Workspace` (a user belongs to workspaces with a role)
- `Workspace` —< `Project` (`key`, `leadId` FK → User with `onDelete: SetNull`)
- `Workspace` —< `Team` —< `TeamMember` >— `User` (sub-workspace groups for standups / poker / analytics)
- `Project` —< `Issue`, `Status`, `Sprint`, `Board`, `Label`, `Component`, `Version`, `CustomFieldDefinition`, `SavedFilter`
- `Issue`: `number` (per-project seq), `type` (TASK/BUG/STORY/EPIC/SUBTASK), `title`, `description`, `statusId`, `assigneeId`, `reporterId`, `priority`, `storyPoints`, `parentId` (self-FK, `onDelete: SetNull`), `sprintId`, `dueDate`, `rank` (fractional index), `customFields` (JSONB with GIN index), `componentId`, `searchVector` (generated tsvector, GIN indexed)
- `Issue` —< `Comment` (authorId nullable, `onDelete: SetNull`), `Attachment` (uploaderId nullable, `onDelete: SetNull`), `ActivityLog` (actorId nullable, `onDelete: SetNull`), `Watcher`, `Notification`, `IssueGithubLink` (two-way links to PRs/commits/branches, `onDelete: Cascade`)
- `Issue` >—< `Label` (via `IssueLabel`), `Version` (via `IssueVersion`), `IssueLink` (directed links: BLOCKS, RELATES_TO, DUPLICATES, etc.)
- `Status`: per-project, `category` (TODO / IN_PROGRESS / DONE), `createdAt` / `updatedAt`
- `Sprint`: goal, start/end dates, `completedAt`, state (PLANNED/ACTIVE/COMPLETED), `updatedAt`
- `Board`: KANBAN or SCRUM, `filterQuery` (NLQL), `colorRules` (JSON), optional `savedFilterId` FK → `SavedFilter`
- `SavedFilter`: NLQL query owned by a user, optionally shared to a project; boards can reference it
- `CustomFieldDefinition`: project-scoped typed field definitions (TEXT/NUMBER/SELECT/…); values stored as JSONB on `Issue.customFields`
- `Component`: project-scoped sub-areas with optional `defaultAssigneeId`
- `Version` (aka Release): project-scoped, `VersionState` (UNRELEASED/RELEASED/ARCHIVED), M:N with Issue via `IssueVersion`
- `Notification.projectId` now has a proper FK (`onDelete: Cascade`)
- `GithubIntegration`: per-project webhook config (repo fullname, HMAC secret, AES-256-GCM encrypted PAT); `onDelete: Cascade` when project is deleted.

**GitHub integration (Phase 9):** a webhook receiver processes inbound GitHub events (push, pull_request). Commit messages, PR titles, and branch names referencing an issue key (e.g. `NL-123`) trigger upsert of `IssueGithubLink` rows, visible in the issue's Development section. Every webhook is HMAC-verified against the secret before processing; PATs are encrypted at rest and never returned by the API.

**Cascade / delete policy:** user deletion sets actor/author/uploader fields to null (`onDelete: SetNull`) rather than deleting history. Project deletion cascades to all project-scoped children. Workspace deletion cascades to projects (and thus everything). See `docs/DATA-MODEL-REVIEW.md` §3.3 for the full policy table.

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
