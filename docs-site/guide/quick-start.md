# Quick Start

Get a fully running Next Lane instance in under five minutes using Docker Compose.

---

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with Compose v2 (`docker compose version`).  
  That is the only requirement — no Node, no pnpm, nothing else on your host.

---

## 1. Clone and configure

```bash
git clone https://github.com/Overcastly-AI/Next-Lane.git
cd Next-Lane
cp .env.example .env
```

Open `.env` and set a strong JWT secret. The API refuses to start without one:

```bash
# Add a generated secret to your .env:
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env
```

All other defaults in `.env.example` work out of the box for a local install.
See [Configuration](./configuration) for the full variable reference.

---

## 2. Start the stack

```bash
docker compose up -d --build
```

This builds the API and web images from source, starts PostgreSQL 16 and
Redis 7 as service dependencies, runs `prisma migrate deploy` to set up the
schema, and optionally seeds demo data.

First build takes 2–5 minutes depending on your machine and internet speed.
Subsequent starts (without `--build`) are much faster.

---

## 3. Open the app

| Service | URL |
|---------|-----|
| Web app | http://localhost:3000 |
| REST API | http://localhost:4000 |
| API docs (Swagger) | http://localhost:4000/api |

A demo workspace, project, sprint, and sample issues are seeded automatically.

Log in with the demo account:

| Field | Value |
|-------|-------|
| Email | `demo@nextlane.dev` |
| Password | `nextlane` |

---

## 4. First-run checklist

After logging in, verify the following work:

- [ ] The board loads with seeded cards and you can drag them between columns.
- [ ] Opening an issue card shows the detail drawer with description, comments,
  and custom fields.
- [ ] The command palette opens with Cmd/Ctrl + K.
- [ ] Realtime updates: open two browser tabs; move a card in one and see it
  update in the other without refreshing.
- [ ] The Reports tab shows burndown and velocity charts.

---

## 5. Create your own workspace

1. Click **Create workspace** (top-left switcher or `/register` to add a user).
2. Create a project inside the workspace.
3. Add statuses, boards, and labels under **Project Settings**.
4. Invite teammates via **Workspace Members**.

---

## Stop and reset

```bash
# Stop without deleting data
docker compose down

# Stop and wipe the database volume (full reset)
docker compose down -v
```

---

## What's next

- [Self-Hosting](./self-hosting) — production deployments, HTTPS, backups, upgrades
- [Configuration](./configuration) — SMTP, SSO, rate limiting, CORS, custom ports
- [Features](./features) — full guide to boards, NLQL, workflows, automation, and more
- [AI Agents & MCP](./agents-mcp) — connect Claude Code or Claude Desktop to your tracker
- [Contributing](./contributing) — run the dev stack with hot reload
