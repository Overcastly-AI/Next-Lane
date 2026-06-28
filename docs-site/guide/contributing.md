# Contributing

Thanks for helping make Next Lane better. This page covers how to get a
development environment running, how to run tests, and how the project is
organized.

The main contribution guidelines (conventions, PR workflow, code standards)
live in
[`CONTRIBUTING.md`](https://github.com/Overcastly-AI/Next-Lane/blob/main/CONTRIBUTING.md)
in the repo root — read that first.

---

## Development setup

Next Lane is a pnpm monorepo. You need:

- **Node 22** (use `nvm` or similar)
- **pnpm 9** (`npm install -g pnpm@9`)
- **Docker with Compose v2** — for the datastores

### Start the dev stack

```bash
git clone https://github.com/Overcastly-AI/Next-Lane.git
cd Next-Lane

# Install all workspace dependencies
pnpm install

# Start Postgres and Redis in Docker (no app code in containers during dev)
docker compose up -d db redis

# Copy the example env file and set JWT_SECRET
cp .env.example .env
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env

# Apply database migrations and seed demo data
pnpm db:migrate
pnpm db:seed

# Start the API and web with hot reload
pnpm dev
```

The API runs at http://localhost:4000 and the web app at http://localhost:3000.
Changes to TypeScript source reload automatically.

### Useful scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | API + web with hot reload |
| `pnpm build` | Build all packages |
| `pnpm lint` | Run ESLint across all packages |
| `pnpm test` | Run unit tests across all packages |
| `pnpm format` | Prettier (formats `.ts`, `.tsx`, `.json`, `.md`) |
| `pnpm db:migrate` | Run `prisma migrate dev` (apply pending migrations) |
| `pnpm db:seed` | Seed the database with demo data |

---

## Database changes

All database changes go through **Prisma migrations** — never manual SQL.

```bash
# After editing apps/api/prisma/schema.prisma:
pnpm db:migrate
# Give the migration a descriptive name when prompted.
```

The migration file is committed alongside the schema change. Never modify a
migration file that has already been applied.

Shared types and enums live in `packages/shared` — never duplicate domain types
between `api` and `web`.

---

## Running tests

### Unit tests

```bash
pnpm test
# Or for a specific package:
pnpm --filter @next-lane/api test
pnpm --filter @next-lane/web test
```

Unit tests use Jest. The API tests mock PrismaService — no database needed.

### End-to-end tests (Playwright)

The e2e suite runs against the real built artifacts and real Postgres/Redis.

```bash
# Start the datastores
docker compose up -d db redis

# Apply migrations and seed
pnpm db:migrate && pnpm db:seed

# Build and start the API
pnpm --filter @next-lane/api build
node apps/api/dist/main.js &

# Build and start the web preview
VITE_API_URL=http://localhost:4000 pnpm --filter @next-lane/web build
pnpm --filter @next-lane/web exec vite preview --port 3000 &

# Install Playwright browser (first time)
pnpm --filter @next-lane/web exec playwright install --with-deps chromium

# Run the suite (desktop + mobile projects)
pnpm --filter @next-lane/web exec playwright test
```

The CI E2e workflow (`e2e.yml`) mirrors these steps with Postgres and Redis as
GitHub Actions service containers.

---

## Code conventions

- **Strict TypeScript** everywhere. No `any` without a comment explaining why.
- **NestJS module pattern** for every new API domain:
  `module / controller / service / dto`.
- **`class-validator` DTOs** at every controller boundary.
- **Conventional commits** encouraged: `feat:`, `fix:`, `docs:`, `refactor:`,
  `test:`, `chore:`.
- PRs should be **focused** — one feature or bug fix per PR.
- Format before pushing: `pnpm format && pnpm lint`.

---

## Project structure

```
apps/api/src/
  <domain>/            # NestJS module per domain
    <domain>.module.ts
    <domain>.controller.ts
    <domain>.service.ts
    dto/

apps/web/src/
  api/                 # API client functions (TanStack Query hooks)
  components/          # React components
  pages/               # Route-level page components
  contexts/            # React context providers

packages/shared/src/   # Shared TypeScript types, enums, API contracts
```

---

## AI agent workflow

This repo uses a team of Claude Code agents defined in `.claude/agents/`. If
you use Claude Code, see
[`.claude/README.md`](https://github.com/Overcastly-AI/Next-Lane/blob/main/.claude/README.md)
for the available agents, skills, and workflows.

The standard development loop:
**plan → implement (specialist agent) → review (`code-reviewer`) → functional QA (`qa-tester`, desktop + mobile) → UI/UX QA (`frontend-qa`) → update `docs/ROADMAP.md` + `docs/BACKLOG.md` → commit.**

---

## Reporting bugs and requesting features

- [Open a bug report](https://github.com/Overcastly-AI/Next-Lane/issues/new?template=bug_report.yml)
- [Request a feature](https://github.com/Overcastly-AI/Next-Lane/issues/new?template=feature_request.yml)
- [Start a discussion](https://github.com/Overcastly-AI/Next-Lane/discussions)
- [Report a vulnerability privately](./security)
