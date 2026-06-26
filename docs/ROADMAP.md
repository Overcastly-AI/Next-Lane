# Next Lane — Roadmap

Status legend: ✅ done · 🚧 in progress · ⬜ planned

## Phase 0 — Foundation
- ✅ Research & architecture decisions (`docs/RESEARCH.md`, `docs/ARCHITECTURE.md`)
- 🚧 Monorepo scaffold (pnpm workspaces, docs, license)
- 🚧 `.claude` skills / agents / workflows
- 🚧 Docker Compose (postgres, redis, api, web)
- ⬜ Prisma schema + initial migration + seed

## Phase 1 — MVP (single-team tracker)
- ⬜ Auth: email/password, JWT access + refresh, current-user endpoint
- ⬜ Workspaces & memberships
- ⬜ Projects (create/edit/archive, issue `key`)
- ⬜ Issues: Task/Bug/Story CRUD; title, description, status, assignee, reporter, priority
- ⬜ Statuses (To Do / In Progress / Done) per project
- ⬜ Kanban board: columns from statuses, drag-and-drop with fractional rank
- ⬜ Comments (flat) + activity log
- ⬜ Search & filter (status / assignee / type / priority)
- ⬜ Web UI: login, project list, board, issue detail modal
- ⬜ Seed demo data; end-to-end `docker compose up` works

## Phase 2 — Real agile
- ⬜ Epics & sub-tasks (parent/child hierarchy)
- ⬜ Backlog view
- ⬜ Sprints: create/start/complete, goal, dates
- ⬜ Scrum board
- ⬜ Custom workflows/statuses + transitions per project
- ⬜ Labels (M:N), attachments (uploads volume)
- ⬜ Story points
- ⬜ Roles & permissions (Admin/Member/Viewer)
- ⬜ Realtime updates (Socket.io) + in-app notifications
- ⬜ Reports: burndown, velocity, cumulative flow

## Phase 3 — Power features
- ⬜ Query DSL (filter builder → JQL-like text)
- ⬜ Custom fields (typed, JSONB-backed)
- ⬜ Workflow automation rules
- ⬜ Time tracking / worklogs
- ⬜ Email (SMTP) notifications + email-to-issue
- ⬜ Configurable dashboards
- ⬜ Roadmap / Gantt
- ⬜ Webhooks, REST API tokens, audit log
- ⬜ Bulk edit, CSV / Jira import, SSO/OIDC

---

### Current focus
Building Phase 0 → Phase 1 MVP end-to-end so `docker compose up` yields a working board.
