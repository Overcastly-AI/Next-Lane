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
    src: /screenshots/board-dark-desktop.png
    alt: Next Lane Kanban board in dark mode showing issues in To Do, In Progress, and Done columns
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
      Built for the agent era. MCP-native today — 105 tools let AI coding agents
      read and write issues, workflows, and dashboards directly from the IDE,
      with persistent per-project agent memory. Dogfooded by a team of AI agents
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
| Kanban & Scrum boards — drag-and-drop, swimlanes, WIP limits, conditional card colors | Live |
| NLQL structured query language — query bar, saved & shared filters, autocomplete | Live |
| Configurable workflows — visual graph builder, transition gates, per-board assignment | Live |
| Automation engine with Glass Box run log | Live |
| Dashboards — NLQL-powered STAT / TABLE / BREAKDOWN / BURNDOWN gadgets | Live |
| Checklists, time tracking, components, versions/releases, issue templates | Live |
| Real-time collaboration (Socket.io) + live presence | Live |
| Planning poker & async standups | Live |
| Reports: burndown, velocity, CFD, roadmap timeline + personal/team analytics | Live |
| Full-text search + command palette | Live |
| Bulk edit, CSV import/export, Jira / GitHub / Linear importers | Live |
| Notifications center + email delivery | Live |
| GitHub, GitLab & Gitea integrations (two-way issue ↔ PR/MR links) | Live |
| Webhooks (HMAC-signed, BullMQ-queued) + public REST API with PATs | Live |
| SSO/OIDC login (env or in-app admin config) | Live |
| Per-project role overrides, workspace audit log, public share links (boards + dashboards) | Live |
| Personal boards, dark mode, workspace branding | Live |
| **MCP agent integration — 105 tools + per-project agent memory** | **Live** |
| Private AI inference | Roadmap |

See the full [Features](./guide/features) guide and the
[AI Agents & MCP](./guide/agents-mcp) chapter for details.

---

## Screenshots

![NLQL autocomplete](/screenshots/nlql-autocomplete-desktop.png)

*NLQL query bar mid-autocomplete — one query language for search, saved filters, automations, and dashboards, live-filtering the board as you type.*

![Dashboards](/screenshots/dashboard-desktop.png)

*Dashboards — STAT, TABLE, BREAKDOWN, and BURNDOWN gadgets, each backed by an NLQL query, on real sprint data.*

![Roadmap / Gantt timeline](/screenshots/roadmap-desktop.png)

*Roadmap — epic timelines with date-range bars, % complete, sprint bars, and a today line.*

![Workflow graph builder](/screenshots/workflow-graph-desktop.png)

*Visual workflow graph builder — statuses as nodes, transitions as edges, enforced per board.*

![Agent context panel](/screenshots/agent-context-desktop.png)

*Persistent per-project agent-context handoff document, with a staleness signal so the next agent session knows when to re-verify.*

![Issue detail drawer](/screenshots/drawer-desktop.png)

*Issue detail drawer — Markdown description, comments, activity log, custom fields, all in-panel.*

![Backlog view](/screenshots/backlog-desktop.png)

*Backlog — bulk-select issues, filter with NLQL, plan sprints.*
