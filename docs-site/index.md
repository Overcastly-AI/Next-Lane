---
layout: home

hero:
  name: "Next Lane"
  text: "Issue tracking without the bill."
  tagline: >
    Open-source, self-hosted, MIT licensed. Boards, sprints, backlog, automation,
    real-time collaboration — running on your own hardware. Zero seats to buy.
    No data leaves your infrastructure.
  image:
    src: /screenshots/home-desktop.png
    alt: Next Lane board view showing issues in Kanban columns
  actions:
    - theme: brand
      text: Get Started
      link: /guide/quick-start
    - theme: alt
      text: View on GitHub
      link: https://github.com/Overcastly-AI/Next-Lane

features:
  - icon: "🆓"
    title: Free and unlimited
    details: >
      No per-seat pricing. Unlimited users, projects, automation runs, and (on the
      roadmap) AI — because it runs on your hardware, the marginal cost is zero.
      Comparable trackers charge per seat per month; Next Lane charges nothing.

  - icon: "🔒"
    title: Your data, your compute
    details: >
      Fully self-hosted. No egress. Direct SQL access to your own database. Private
      AI inference on the roadmap. The one thing regulated teams cannot buy from any
      cloud at any price.

  - icon: "📖"
    title: Open and extensible
    details: >
      MIT licensed. No marketplace tax. Code-level extensibility. Works with
      self-hosted forges (Gitea, GitLab) as well as the major platforms.
      Fork it. Extend it. Own it.

  - icon: "🤖"
    title: AI-native and agent-native
    details: >
      Built for the agent era. MCP-native (roadmap) so AI coding agents can read
      and write issues directly from the IDE. Dogfooded by a team of AI agents
      that build this very product.
---

> Built by [Overcastly AI](https://overcastly.com) — open-source, MIT licensed, yours to self-host.

## One command to run it

```bash
git clone https://github.com/Overcastly-AI/Next-Lane.git
cd Next-Lane
cp .env.example .env
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env
docker compose up -d --build
```

Open **http://localhost:3000** — a demo workspace with sample issues is ready to explore.

Log in: `demo@nextlane.dev` / `nextlane`

---

## What's included

| Feature | Status |
|---------|--------|
| Kanban & Scrum boards with drag-and-drop | Live |
| NLQL structured query language | Live |
| Automation engine with Glass Box run log | Live |
| Real-time collaboration (Socket.io) | Live |
| Planning poker | Live |
| Async standups | Live |
| Reports: burndown, velocity, CFD, timeline | Live |
| Full-text search + command palette | Live |
| Webhooks (HMAC-signed, BullMQ-queued) | Live |
| Personal boards | Live |
| Bulk edit, CSV export | Live |
| Workspace branding (color, logo) | Live |
| MCP agent integration | Roadmap |
| Private AI inference | Roadmap |

See the full [Features](./guide/features) guide for details.

---

## Screenshots

![Next Lane board view](./public/screenshots/board-desktop.png)

*Kanban board — drag cards between columns, see live presence avatars, apply conditional card colors.*

![Issue detail drawer](./public/screenshots/drawer-desktop.png)

*Issue detail drawer — Markdown description, comments, activity log, custom fields, all in-panel.*

![Backlog view](./public/screenshots/backlog-desktop.png)

*Backlog — bulk-select issues, filter with NLQL, plan sprints.*
