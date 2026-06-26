# Contributing to Next Lane

Thanks for your interest in making Next Lane better! This project is fully open source and community contributions are welcome.

## Getting set up

```bash
pnpm install
docker compose up -d db redis
pnpm db:migrate && pnpm db:seed
pnpm dev
```

## Ground rules

- **Branch** off `main` (or the active development branch). Use descriptive names: `feat/sprint-board`, `fix/rank-collision`.
- **Conventional commits** are encouraged: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
- **TypeScript everywhere**, strict mode. No `any` without a comment explaining why.
- **Format & lint** before pushing: `pnpm format && pnpm lint`.
- **Tests**: add/extend tests for new behavior. Run `pnpm test`.
- Keep PRs focused. One feature or fix per PR.

## Architecture & conventions

Read [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) first. Key conventions:

- Backend follows NestJS module structure: `module / controller / service / dto`.
- Shared types live in `packages/shared` and are imported by both API and web.
- Board card ordering uses **fractional indexing** — never renumber rows; compute a rank between neighbors.
- Database changes go through **Prisma migrations** (`pnpm db:migrate`), never manual SQL.

## Working with Claude Code

This repo ships with Claude Code skills, agents, and workflows under [`.claude/`](./.claude). If you use Claude Code, see [`.claude/README.md`](./.claude/README.md) for the available tooling.

## Reporting issues

Open a GitHub issue with steps to reproduce, expected vs actual behavior, and your environment (OS, Docker version).
