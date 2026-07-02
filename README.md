<div align="center">

# Next Lane

### The open-source, self-hosted, **MCP-native** issue &amp; project tracker — free and unlimited where the incumbent charges per seat.

Plan work, run sprints, and drag cards across boards on **your** hardware, with **your**
data, under an MIT license. Point Claude (or any MCP client) straight at it — it's the
one tracker your coding agent can *read and write*, not just talk about.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![CI](https://github.com/Overcastly-AI/Next-Lane/actions/workflows/ci.yml/badge.svg)](https://github.com/Overcastly-AI/Next-Lane/actions/workflows/ci.yml)
[![E2E](https://github.com/Overcastly-AI/Next-Lane/actions/workflows/e2e.yml/badge.svg)](https://github.com/Overcastly-AI/Next-Lane/actions/workflows/e2e.yml)
[![MCP server](https://img.shields.io/badge/MCP-55%20tools-8A2BE2.svg)](./apps/mcp/README.md)
[![Unit tests](https://img.shields.io/badge/unit%20tests-1375%2B-brightgreen.svg)](./docs/ROADMAP.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/Docker-compose%20up-2496ED.svg?logo=docker&logoColor=white)](#-quickstart)
[![Self-hosted](https://img.shields.io/badge/self--hosted-your%20data-success.svg)](#why-next-lane)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

Built by [Overcastly AI](https://overcastly.com)

[Quick Start](#-quickstart) · [Why Next Lane](#why-next-lane) · [MCP / agents](#-mcp-native-your-coding-agent-can-run-the-tracker) · [Features](#-whats-shipped) · [Architecture](#-architecture-at-a-glance) · [Roadmap](#-on-the-roadmap) · [Contributing](#-contributing) · [Docs](https://overcastly-ai.github.io/Next-Lane/) · [Changelog](./CHANGELOG.md)

</div>

---

## Table of Contents

- [Why Next Lane](#why-next-lane)
- [Screenshots](#-screenshots)
- [MCP-native: your coding agent can run the tracker](#-mcp-native-your-coding-agent-can-run-the-tracker)
- [Built by AI, dogfooding itself](#-built-by-ai-dogfooding-itself)
- [What's shipped](#-whats-shipped)
- [Quick Start](#-quickstart)
- [Local development](#-local-development-hot-reload-no-docker-for-app-code)
- [Architecture at a glance](#-architecture-at-a-glance)
- [On the roadmap](#-on-the-roadmap)
- [Contributing](#-contributing)
- [License](#-license)

---

## Screenshots

<div align="center">
  <img src="docs/screenshots/home-desktop.png" alt="Next Lane home / dashboard (desktop)" width="100%" />
</div>

<br/>

<div align="center">
  <img src="docs/screenshots/board-desktop.png" alt="Kanban board (desktop)" width="49%" />
  <img src="docs/screenshots/board-mobile.png" alt="Kanban board (mobile)" width="24%" />
  <img src="docs/screenshots/home-mobile.png" alt="Dashboard (mobile)" width="24%" />
</div>

<br/>

<div align="center">
  <img src="docs/screenshots/drawer-desktop.png" alt="Issue detail drawer (desktop)" width="49%" />
  <img src="docs/screenshots/backlog-desktop.png" alt="Backlog view (desktop)" width="49%" />
</div>

<br/>

<div align="center">
  <img src="docs/screenshots/login-desktop.png" alt="Login (desktop)" width="49%" />
  <img src="docs/screenshots/login-mobile.png" alt="Login (mobile)" width="24%" />
</div>

## Why Next Lane

Most trackers are cloud SaaS billed **per user, per month** — your roadmap lives on
someone else's server and the price grows with your team. Next Lane flips that. It
runs entirely on your own machine via Docker, and because the marginal cost of a
seat on *your* hardware is zero, it's free and unlimited by design.

We don't try to out-checklist a 20-year-old incumbent. We win on four **structural
advantages** a cloud-first, per-seat, closed product can't match (full thesis in
[`docs/VISION.md`](./docs/VISION.md)):

|  | Advantage | What it means for you |
|---|---|---|
| 💸 | **Free & unlimited** | No per-seat pricing. Unlimited users, projects, automation runs, and (on the roadmap) AI — because it's your hardware. |
| 🔒 | **Your data, your compute** | Fully self-hosted. No egress, direct SQL access to your own data, private by default — the one thing regulated teams can't buy from any cloud. |
| 🧩 | **Open & extensible** | MIT licensed. No marketplace tax, code-level extensibility, and a path to self-hosted forges (Gitea/GitLab), not just the big clouds. |
| 🤖 | **AI-native & agent-native** | An MCP server ships in the box, and the product itself is built and dogfooded by a team of AI agents — see below. |

## 🔌 MCP-native: your coding agent can run the tracker

Next Lane ships **`@next-lane/mcp`** — a first-party [Model Context
Protocol](https://modelcontextprotocol.io) server with **55 tools** (21 read, 34
write) that let Claude Desktop, Claude Code, or any MCP client **read *and write*
your workspace**: issues, sprints, comments, worklogs, checklists, labels,
components, versions, saved NLQL filters, automations — and the workflow/SDLC graph
itself (statuses, transitions, gates, board assignment). No other open tracker
exposes its own SDLC as an agent-editable surface.

Full tool reference: [`apps/mcp/README.md`](./apps/mcp/README.md). Connect it to Claude Code in one command once you have a personal access token (log in → `Profile Settings → API Tokens`):

```bash
pnpm --filter @next-lane/mcp build

claude mcp add next-lane \
  -e NEXT_LANE_API_URL=http://localhost:4000 \
  -e NEXT_LANE_TOKEN=nlp_your_token_here \
  -- node /absolute/path/to/Next-Lane/apps/mcp/dist/index.js
```

Or drop this into `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "next-lane": {
      "command": "node",
      "args": ["/absolute/path/to/Next-Lane/apps/mcp/dist/index.js"],
      "env": {
        "NEXT_LANE_API_URL": "http://localhost:4000",
        "NEXT_LANE_TOKEN": "nlp_your_token_here"
      }
    }
  }
}
```

Now your agent can triage the backlog, move an issue across a gated workflow, file a
bug from a stack trace, or redesign a board's SDLC — all from the terminal it's
already in.

## 🤖 Built by AI, dogfooding itself

This isn't a marketing line — check the log. Every one of Next Lane's 300+ commits
is authored by an autonomous Claude Code agent team (`.claude/agents/`: schema,
backend, frontend, code-review, QA, and audit specialists) working off the tracker's
own `docs/ROADMAP.md` and `docs/BACKLOG.md` — the same artifacts the MCP server
exposes to any agent. The team that builds Next Lane runs Next Lane.

## ✨ What's shipped

A credible daily-driver tracker today — not a toy. Everything below is **live in the
current build** (see [`docs/ROADMAP.md`](./docs/ROADMAP.md) for status and what's next).

| Area | Capabilities |
|------|-------------|
| **Boards** | Multiple boards per project · Kanban **and** Scrum board types · drag-and-drop with fractional ranking · custom statuses/columns · live presence indicators · conditional card colors |
| **Issues** | Task / Bug / Story / Epic / Sub-task · parent/child hierarchy · labels · story points · due dates · **custom fields** (typed) · markdown descriptions & comments · file attachments · **issue links** (BLOCKS, RELATES_TO, DUPLICATES…) · watchers |
| **Agile** | Backlog view · sprints (create / start / complete, goals, dates) · keyboard **triage mode** (j/k/s/p/a/l) |
| **NLQL** | **NLQL query language** — `assignee = me() AND priority in (High, Highest)` — with **autocomplete** · saved filters shared across a project · boards pinned to a saved filter |
| **Reports** | Burndown · velocity · cumulative-flow diagram (CFD) · roadmap / timeline view · personal analytics · team pulse analytics |
| **Find** | **Full-text search** (Postgres `tsvector`) · ⌘K command palette · cross-project search · multi-field filtering |
| **Collaboration** | Comments & activity history · realtime updates (Socket.io) · in-app notifications & @mentions · "My Work" + Team Pulse dashboards |
| **Auth & SSO** | Email/password (JWT) · **SSO/OIDC** (env-configured, PKCE + CSRF-guarded, JIT provisioning — works with Okta/Auth0/Keycloak/Authentik/Google) · personal API tokens (PATs) |
| **Workflows (SDLC)** | **Configurable workflows** — per-project enforcement **and reusable named workflows assigned per board** · transition graph with **visual node/edge editor** · gates (require assignee/description/field/link/no-open-blockers) · seed from templates (simple / kanban / scrum / bug-triage) |
| **Agent-native (MCP)** | **MCP server** (`apps/mcp`) — 55 read/write tools over PAT auth. See [above](#-mcp-native-your-coding-agent-can-run-the-tracker) |
| **Estimation & tracking** | Story points · **original estimate + work logs** (time spent vs estimate rollup) · **checklists** (sub-items + progress) · **WIP limits** per column |
| **Automation** | **Glass Box engine** — trigger → condition → action rules · NLQL-based conditions · unlimited runs · full **run log** (audit trail per execution) |
| **Rituals** | **Planning poker** (real-time estimation via Socket.io) · **async standups** (per-member responses + team digest) |
| **Organize** | **Components** (with default assignee) · **versions / releases** (M:N, lifecycle) · **issue templates** (create-from-template) |
| **Personal** | **Personal boards** (private Kanban) · personal analytics · shared board links |
| **Bulk & import/export** | **Bulk edit** (multi-select in Backlog + Triage) · **CSV export** · **CSV import** from Jira, GitHub, or Linear exports (dry-run preview) |
| **Workspace** | **Branding** — custom name, accent color, logo · workspace audit log |
| **Admin & security** | Roles & permissions (Admin / Member / Viewer) · password reset over SMTP · HMAC-signed outbound webhooks (with SSRF guard) · tenant-isolation regression matrix |
| **Ops & deploy** | One-command Docker Compose · **Helm chart + Kustomize** for Kubernetes · GHCR multi-arch image builds · structured JSON logs · health/readiness probes · CI (typecheck + build + **1375+ unit tests**) + full Playwright **e2e suite, desktop and mobile** |

## 🚀 Quickstart

> **Prerequisites:** [Docker](https://docs.docker.com/get-docker/) with Compose v2. That's it.

```bash
git clone https://github.com/Overcastly-AI/Next-Lane.git
cd Next-Lane
cp .env.example .env

# JWT_SECRET is REQUIRED — the API refuses to start without one:
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env

docker compose up -d --build
```

Then open:

| Service | URL |
|---------|-----|
| 🌐 **Web app** | http://localhost:3000 |
| ⚙️ **API** | http://localhost:4000 |
| 📚 **API docs (Swagger)** | http://localhost:4000/api |

A demo workspace, project, sprint, and issues are **seeded automatically**. Log in with:

- **Email:** `demo@nextlane.dev`
- **Password:** `nextlane`

Stop the stack with `docker compose down` (add `-v` to also wipe the database volume).

> Deploying to Kubernetes? See [`docs/DEPLOY-KUBERNETES.md`](./docs/DEPLOY-KUBERNETES.md)
> for the Helm chart, Kustomize overlays, and an HA topology guide.

## 🛠️ Local development (hot reload, no Docker for app code)

Next Lane is a pnpm monorepo. Run the datastores in Docker and the apps on your host:

```bash
pnpm install
docker compose up -d db redis      # just Postgres + Redis
pnpm db:migrate                    # apply Prisma migrations
pnpm db:seed                       # seed the demo workspace
pnpm dev                           # api + web with hot reload
```

Other useful scripts: `pnpm build`, `pnpm lint`, `pnpm test`, `pnpm format`.

## 🧱 Architecture at a glance

| Layer | Technology |
|-------|-----------|
| Backend | NestJS + Prisma (REST + Socket.io) |
| Database | PostgreSQL 16 |
| Realtime / queue | Redis 7 + Socket.io + BullMQ |
| Frontend | React + Vite + TypeScript |
| UI | Tailwind CSS + shadcn/ui · TanStack Query · dnd-kit |
| Auth | JWT access token · SSO/OIDC · personal API tokens (PATs) |
| Agents | MCP server (`apps/mcp`, stdio, 55 tools) over the same REST API |
| Infra | Docker Compose · Helm / Kustomize for Kubernetes |

```mermaid
flowchart LR
    U([Browser / Mobile]) -->|HTTPS| W["web<br/>React + Vite (nginx)"]
    AI(["AI agent<br/>Claude Desktop / Code"]) -->|MCP stdio| M["@next-lane/mcp"]
    W -->|REST + WebSocket| A["api<br/>NestJS"]
    M -->|REST + PAT| A
    A -->|Prisma| P[("PostgreSQL 16")]
    A -->|Socket.io adapter<br/>+ BullMQ queue| R[("Redis 7")]
```

Deeper dives: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) ·
[`docs/RESEARCH.md`](./docs/RESEARCH.md) ·
[`docs/DEPLOY-KUBERNETES.md`](./docs/DEPLOY-KUBERNETES.md).

```
Next-Lane/
├── apps/
│   ├── api/        # NestJS backend (REST + WebSocket)
│   ├── web/        # React + Vite frontend
│   └── mcp/        # MCP server (stdio, 55 tools) for AI agents
├── packages/
│   └── shared/     # Shared TypeScript types / contracts
├── deploy/         # Helm chart + Kustomize base & overlays
├── docs/           # Architecture, vision, roadmap, research
├── .claude/        # Claude Code skills, agents & workflows
└── docker-compose.yml
```

## 🔭 On the roadmap

Next Lane is built openly and incrementally. The shipped surface above is the
foundation; here's where the structural advantages get spent (full plan, with status
markers, in [`docs/ROADMAP.md`](./docs/ROADMAP.md) — driven by [`docs/VISION.md`](./docs/VISION.md)):

- **🤖 Autopilot** — a self-hosted AI teammate: private, unlimited, $0 AI (natural-language → NLQL, auto-triage, semantic dedupe, sprint risk radar) building further on the MCP-native foundation already shipped.
- **Data ownership (Glass Box Phase 2)** — SQL / warehouse export, Grafana dashboards, and OpenTelemetry traces.
- **📚 The Unbundle** — free what others sell separately: docs/wiki, whiteboard, a public roadmap + voting portal, and intake forms.
- **🔗 Developer Graph** — two-way **GitHub / GitLab / Gitea** links, live PR/CI status on cards, auto-transition on merge.
- **SAML & multi-provider SSO** — Phase 2 of the OIDC login work above, plus per-workspace/role JIT provisioning.

Full plan with phase status markers: [`docs/ROADMAP.md`](./docs/ROADMAP.md) · vision and thesis: [`docs/VISION.md`](./docs/VISION.md).

## 🤝 Contributing

Contributions are welcome and appreciated! Start with [`CONTRIBUTING.md`](./CONTRIBUTING.md)
for setup, conventions, and the PR workflow. Good first steps:

- Found a bug? [Open a bug report](https://github.com/Overcastly-AI/Next-Lane/issues/new?template=bug_report.yml).
- Have an idea? [Request a feature](https://github.com/Overcastly-AI/Next-Lane/issues/new?template=feature_request.yml).
- Have a question? Start a [Discussion](https://github.com/Overcastly-AI/Next-Lane/discussions).
- Found a vulnerability? Please follow our [Security Policy](./SECURITY.md) — don't open a public issue.

The [documentation site](https://overcastly-ai.github.io/Next-Lane/) has detailed guides for configuration, self-hosting, features, and troubleshooting.

This project follows the [Contributor Covenant Code of Conduct](./CODE_OF_CONDUCT.md).

## 📄 License

[MIT](./LICENSE) — free for anyone to use, fork, and self-host.

> **Note on licensing:** self-hosted tools in this category are often released under
> **AGPL-3.0** to keep network-deployed modifications open. Next Lane currently ships
> under MIT for maximum adoption; this may be revisited early in the project's life.
> See [`docs/RESEARCH.md`](./docs/RESEARCH.md#6-licensing).

## Built by Overcastly AI

Next Lane is designed and maintained by [Overcastly AI](https://overcastly.com).

## Trademarks & disclaimer

Next Lane is an **independent, open-source project** — a general-purpose issue
tracker and agile project-management tool. It is **not affiliated with, endorsed by,
or sponsored by** any commercial issue-tracking vendor, and it is not a drop-in
replacement for, or branded competitor of, any specific commercial product. All
product names, logos, and brands mentioned anywhere in this repository are the
property of their respective owners and are used for identification purposes only.
