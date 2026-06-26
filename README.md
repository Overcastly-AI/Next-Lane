<div align="center">

# 🛣️ Next Lane

**An open-source, self-hosted issue & project tracker that runs entirely on your own machine via Docker.**

Plan work, track issues, run sprints, and drag cards across kanban boards — without sending your data to anyone's cloud.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Self-hosted](https://img.shields.io/badge/self--hosted-docker-2496ED.svg)](#quickstart)

</div>

---

## Why Next Lane?

Most issue trackers are SaaS — your roadmap lives on someone else's server. Next Lane is built to **run locally on a single PC** with one command (`docker compose up`). It's fully open source and free for anyone to use, fork, and self-host.

## Features

> Next Lane is built incrementally. See [`docs/ROADMAP.md`](./docs/ROADMAP.md) for the full plan and current status.

**MVP (in progress)**
- 📋 Projects with issue keys (`NL-123`)
- 🎫 Issues — Task / Bug / Story with description, assignee, priority, status
- 🟦 Kanban board with drag-and-drop ordering
- 💬 Comments & activity history
- 🔍 Search and filtering
- 👤 Email/password auth (JWT)

**Planned**
- 🏃 Backlog, sprints & scrum boards
- 🧩 Epics & sub-tasks
- 🏷️ Labels, attachments, story points
- 📊 Burndown & velocity reports
- 🔔 Realtime updates & notifications
- 🔐 Roles & permissions

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | NestJS + Prisma |
| Database | PostgreSQL 16 |
| Realtime / queue | Redis 7 + Socket.io |
| Frontend | React + Vite + TypeScript |
| UI | Tailwind CSS + shadcn/ui |
| Server state | TanStack Query |
| Drag & drop | dnd-kit |
| Auth | JWT (access + refresh) |

See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) and [`docs/RESEARCH.md`](./docs/RESEARCH.md) for the rationale.

## Quickstart

> Requires [Docker](https://docs.docker.com/get-docker/) (with Compose v2).

```bash
git clone https://github.com/Overcastly-AI/Next-Lane.git
cd Next-Lane
cp .env.example .env
# Set a JWT secret (required — the API refuses to start without one):
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env
docker compose up -d --build
```

Then open:

- **Web app:** http://localhost:3000
- **API:** http://localhost:4000
- **API docs (Swagger):** http://localhost:4000/api

A demo workspace is seeded automatically. Log in with:

- **Email:** `demo@nextlane.dev`
- **Password:** `nextlane`

To stop: `docker compose down` (add `-v` to wipe the database volume).

## Local development (without Docker for app code)

```bash
pnpm install
docker compose up -d db redis      # just the datastores
pnpm db:migrate
pnpm db:seed
pnpm dev                            # runs api + web with hot reload
```

## Project layout

```
Next-Lane/
├── apps/
│   ├── api/        # NestJS backend (REST + WebSocket)
│   └── web/        # React + Vite frontend
├── packages/
│   └── shared/     # Shared TypeScript types / contracts
├── docs/           # Architecture, roadmap, research
├── .claude/        # Claude Code skills, agents & workflows
└── docker-compose.yml
```

## Contributing

Contributions are welcome! See [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## License

[MIT](./LICENSE) — free for anyone to use and self-host.

> **Note on licensing:** Self-hosted tools in this category are often released under **AGPL-3.0** to keep network-deployed modifications open. Next Lane currently ships under MIT for maximum adoption; this can be revisited early in the project's life. See [`docs/RESEARCH.md`](./docs/RESEARCH.md#6-licensing).

## Trademarks & disclaimer

Next Lane is an **independent, open-source project**. It is a general-purpose issue tracker and agile project-management tool. It is **not affiliated with, endorsed by, or sponsored by Atlassian Pty Ltd** or any other company, and it is not a drop-in replacement for, or "competitor" branding of, any specific commercial product.

All product names, logos, and brands mentioned anywhere in this repository are the property of their respective owners and are used for identification and technical-reference purposes only. Use of these names does not imply endorsement.
