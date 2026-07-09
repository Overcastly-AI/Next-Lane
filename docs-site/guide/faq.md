# FAQ

---

## General

**Is Next Lane really free?**

Yes. Next Lane is MIT licensed. There is no hosted version, no usage metering,
and no per-seat fee. You pay for the compute you already own.

**Can I use Next Lane for a commercial project or a client?**

Yes. The MIT license allows use, modification, and distribution for any purpose,
including commercial use.

**Is there a hosted/cloud version?**

Not currently. Next Lane is designed to be self-hosted. Running it takes one
command (`docker compose up -d --build`) on any machine with Docker.

**What are the system requirements?**

Any machine (or VM) that can run Docker Compose. A small team (up to ~20 people)
runs comfortably on 2 CPU cores and 2 GB RAM. For larger teams, adding Redis
and running multiple API replicas scales horizontally.

**Does Next Lane support multiple workspaces?**

Yes. You can create multiple workspaces in one instance. Each workspace has its
own projects, boards, members, and settings.

**Does Next Lane support multiple teams within a workspace?**

Yes. All workspace members can participate in standups, planning poker, and
analytics per project. Dedicated sub-team grouping is on the roadmap.

---

## Setup and deployment

**The `docker compose up` command fails — what should I check first?**

1. Make sure Docker Compose v2 is installed (`docker compose version` should
   print `v2.x.x`).
2. Confirm `JWT_SECRET` is set in `.env` — the API refuses to start without it.
3. Check that ports 3000 and 4000 are not already in use on your host.
4. Run `docker compose logs api` and `docker compose logs db` to see error
   details.

**How do I change the port the web app listens on?**

Set `WEB_PORT=8080` (or any available port) in `.env`, then restart the stack.

**How do I change the API port?**

Set `API_PORT=4001` in `.env`. Also update `VITE_API_URL=http://localhost:4001`
so the browser can reach the API.

**Can I run Next Lane without Redis?**

Yes. Redis is optional for single-node deployments. Without it, Socket.io uses
an in-memory adapter (realtime works correctly for one API pod) and webhook
delivery runs in-process. Only set up Redis if you need multiple API replicas
or durable webhook queuing.

**Can I use an external (managed) PostgreSQL database?**

Yes. Set `DATABASE_URL` to your managed database connection string. Remove the
`db` service from `docker-compose.yml` or override it with your external host.

**I updated the code with `git pull`. How do I apply the new version?**

```bash
git pull
docker compose up -d --build
```

The API runs `prisma migrate deploy` on boot, so schema migrations apply
automatically.

---

## Auth and accounts

**I forgot the admin password — how do I reset it?**

If SMTP is configured, use the Forgot Password link on the login page.

Without SMTP: the reset link is printed to the API log in development mode.
Run `docker compose logs api | grep "password reset"` and copy the link.

Alternatively, reset it directly in the database:

```bash
# Generate a new bcrypt hash (replace YOUR_NEW_PASSWORD)
docker compose exec api node -e "
  const bcrypt = require('bcryptjs');
  bcrypt.hash('YOUR_NEW_PASSWORD', 10).then(h => console.log(h));
"
# Then update the user record
docker compose exec db psql -U nextlane nextlane -c \
  "UPDATE \"User\" SET password = '<hash>' WHERE email = 'demo@nextlane.dev';"
```

**How do I delete the demo account?**

Log in as the demo user, go to Profile Settings and delete the account; or
directly in the database:

```bash
docker compose exec db psql -U nextlane nextlane -c \
  "DELETE FROM \"User\" WHERE email = 'demo@nextlane.dev';"
```

**Can I disable user registration so only admins can add members?**

Open registration is the current default. Admin-only invitation is on the
roadmap. For now, restrict network access to prevent unauthorized registration.

---

## Features

**What is NLQL?**

NLQL (Next Lane Query Language) is a structured filter language for issues.
Examples: `assignee = me()`, `priority in (High, Highest) AND status != Done`.
It powers board filtering, saved filters, and the automation engine's conditions.
See the [Features](./features) page for the full syntax reference.

**How many automation runs are included?**

Unlimited — automation rules execute on your own hardware with no per-run
billing or quota.

**Does Next Lane have an API?**

Yes. The NestJS REST API is documented at `http://localhost:4000/api` (Swagger
UI). You can also generate long-lived **Personal API Tokens** (PATs) in Profile
Settings for programmatic access, optionally restricted to scopes.

**Can AI agents use Next Lane?**

Yes — this is a flagship capability. The official MCP server
(`@next-lane/mcp`, 117 tools) lets Claude Code, Claude Desktop, and any MCP
host read and write issues, boards, workflows, pages, dashboards, and more,
with persistent per-project agent memory. See [AI Agents & MCP](./agents-mcp).

**Can I import issues from Jira, GitHub, or Linear?**

Yes. Use *Import CSV* on the board or backlog view — the importer understands
Jira, GitHub issues, and Linear CSV exports directly (plus a generic CSV
format) and shows a dry-run preview before writing anything.

**Does Next Lane support Markdown in issue descriptions?**

Yes. Issue descriptions and comments support Markdown, rendered in the UI.

---

## Data and privacy

**Where is my data stored?**

In the PostgreSQL database in the named Docker volume `postgres-data` on your
host. File attachments are stored in the `uploads` named volume. Nothing is sent
to external servers.

**Can I export my data?**

- **CSV export:** download all project issues from the board or backlog.
- **Direct SQL:** connect to the Postgres container and query your data directly.
- **Database dump:** `docker compose exec db pg_dump -U nextlane nextlane`.

**Does Next Lane send telemetry or analytics to a remote server?**

No. Next Lane does not call home. The only outbound network calls are webhooks
you explicitly configure and SMTP email delivery.
