# CLAUDE.md — Next Lane

Guidance for Claude Code (and other AI agents) working in this repository.

## What this is

Next Lane is an **open-source, self-hosted Jira alternative** that runs locally via Docker. Fully MIT-licensed, intended for the public to use and self-host. It is a TypeScript monorepo.

## Stack (do not change without updating docs/ARCHITECTURE.md)

- **Backend:** NestJS + Prisma + PostgreSQL, REST + Socket.io
- **Frontend:** React + Vite + TypeScript, Tailwind + shadcn/ui, TanStack Query, dnd-kit
- **Infra:** Docker Compose (db, redis, api, web); Redis 7; Postgres 16
- **Monorepo:** pnpm workspaces — `apps/api`, `apps/web`, `packages/shared`

## Layout

```
apps/api        NestJS backend (module/controller/service/dto per domain)
apps/web        React + Vite SPA
packages/shared Shared TS types & contracts (import in both api and web)
docs/           ARCHITECTURE.md, ROADMAP.md, RESEARCH.md
.claude/        skills, agents, workflows
```

## Commands

```bash
pnpm install
pnpm dev                 # api + web with hot reload
pnpm build               # build all packages
pnpm lint && pnpm test
pnpm db:migrate          # prisma migrate dev
pnpm db:seed             # seed demo data
docker compose up -d --build   # full stack
```

## Conventions (important)

- **Strict TypeScript.** No `any` without justification.
- **Data model = Prisma schema.** All DB changes via `prisma migrate`, never raw SQL.
- **Shared domain enums/types live in `packages/shared`.** Never duplicate them.
- **Board/sprint ordering uses fractional indexing** (rank string between neighbors). Never renumber all rows.
- **NestJS module pattern** for every domain. DTOs validated with `class-validator`.
- Keep changes scoped; update `docs/ROADMAP.md` status as features land.

## Working style for autonomous build

- Track work via the task list / ROADMAP. Commit in logical, working increments.
- Prefer getting a thin vertical slice working end-to-end over broad-but-broken.
- After significant changes, ensure the project still builds and `docker compose` config is valid.
- Default branch for active development: `claude/jira-competitor-docker-local-9b7dll`.

## Known environment constraints (this build session)

- Outbound network is restricted to package registries (npm/pypi/etc.) and Anthropic. General GitHub and arbitrary web are **blocked** by egress policy. Use npm packages, not git clones, for dependencies.
