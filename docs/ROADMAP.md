# Next Lane — Roadmap

Status legend: ✅ done · 🚧 in progress · ⬜ planned

## Phase 0 — Foundation
- ✅ Research & architecture decisions (`docs/RESEARCH.md`, `docs/ARCHITECTURE.md`)
- ✅ Monorepo scaffold (pnpm workspaces, docs, license)
- ✅ `.claude` skills / agents / workflows (incl. QA + Playwright)
- ✅ Docker Compose (postgres, redis, api, web)
- ✅ Prisma schema + initial migration + seed

## Phase 1 — MVP (single-team tracker)
- ✅ Auth: email/password, JWT, current-user endpoint
- ✅ Workspaces & memberships
- ✅ Projects (create/edit/archive, issue `key`)
- ✅ Issues: Task/Bug/Story CRUD; title, description, status, assignee, reporter, priority
- ✅ Statuses (To Do / In Progress / Done) per project
- ✅ Kanban board: columns from statuses, drag-and-drop with fractional rank
- ✅ Comments (flat) + activity log
- ✅ Search & filter (status / assignee / type / priority)
- ✅ Web UI: login, project list, board, issue detail drawer
- ✅ Seed demo data; API verified end-to-end + Playwright QA (desktop + mobile)
- 🚧 Verify full `docker compose up` on a host with Docker Hub access (built/validated; not runnable in the build sandbox)

> JWT refresh tokens are a Phase 2 hardening item (currently single access token).

## Phase 2 — Real agile ✅ (complete)
- ✅ Epics & sub-tasks (parent/child hierarchy in the issue drawer)
- ✅ Backlog view (`/projects/:id/backlog`)
- ✅ Sprints: create/start/complete, goal, dates (single-active enforced, txn-safe)
- ✅ Scrum board (board scopes to the active sprint + backlog)
- ✅ Custom statuses/columns per project (managed in Project Settings)
- ✅ Labels (M:N) — create/assign/filter
- ✅ Story points
- ✅ Roles & permissions (Admin/Member/Viewer) — enforced API + VIEWER-aware UI
- ✅ Realtime updates (Socket.io) + in-app notifications & @mentions
- ✅ Reports: burndown + velocity
- ⬜ Remaining: custom workflow *transitions*, attachments (uploads), cumulative-flow report

## Phase 3 — Power features 🚧 (in progress)
- ✅ Roadmap / timeline (epics + sprints as bars, progress, today marker)
- ✅ Webhooks (HMAC-signed outbound on issue/sprint events + delivery log) — *Settings UI wiring in flight*
- ✅ Command palette (Cmd-K) + cross-project search
- ✅ "My Work" personal dashboard
- ✅ CI pipeline (GitHub Actions) + API unit-test suite
- ✅ Cursor pagination for large lists (keyset on `createdAt,id`; `GET /issues` → `{ items, nextCursor }`)
- ✅ Security hardening pass (P1+P2): webhook SSRF guard (DNS pre-flight + redirect:manual + socket drain + fan-out cap), composite pagination index `@@index([projectId,createdAt,id])` + migration, `helmet()` security headers, global throttler (100 req/min) + stricter auth throttle (10 req/min), `WEBHOOK_ALLOW_PRIVATE` opt-out for self-hosters
- ⬜ Query DSL / saved views (filter builder → text query)
- ⬜ Custom fields (typed, JSONB-backed)
- ⬜ Workflow automation rules (trigger → action)
- ⬜ Time tracking / worklogs
- ⬜ Email (SMTP) notifications + email-to-issue
- ⬜ Configurable dashboards; cumulative-flow
- ⬜ REST API tokens, audit log
- ⬜ Bulk edit, CSV import (and importers for other trackers), SSO/OIDC

---

### Current focus
**Phase 3 power features + security/scale hardening.** Phases 0–2 are done; the product is a working agile
tracker (board, backlog, sprints, reports, roadmap, labels, story points, epics,
comments, search, command palette, My Work, roles, notifications, webhooks, realtime).
Security hardening pass is complete (SSRF guard, pagination index, helmet, rate limiting).
Remaining: query DSL/saved views, custom fields, automation rules, time tracking, email, dashboards, API tokens, audit log, bulk edit, importers, SSO.

## v1.0 release criteria — definition of "a good product"

We are done with v1 when ALL of these hold (drive here, then polish, then stop):

- [ ] **Runs first-try:** `git clone && cp .env.example .env && docker compose up -d --build` yields a working app with seeded demo + working login, no manual steps. (Validated against the real Docker artifact, not a proxy.)
- [ ] **Core flows are bug-free on desktop AND mobile**, verified with real-user QA (per-keystroke typing, real clicks/scroll): auth, create/edit/move issue, drag-and-drop, comments, labels, sprints, backlog, reports, roadmap, search, settings/columns, My Work, notifications.
- [x] **First-run experience isn't an empty void:** onboarding offers a sample project or clear "create your first project" guidance. (Welcome panel + feature highlights shown on empty project list; improved empty states on board, My Work, and notifications; e2e covered desktop + mobile.)
- [ ] **No known P0/P1 bugs.** CI (lint + typecheck + unit + e2e desktop/mobile) green on every push.
- [x] **Security/multi-tenant solid:** isolation, roles, secrets, CORS, input bounds, webhook SSRF — all closed. (SSRF guard + pagination index + helmet + rate limiting shipped 2026-06-27.)
- [ ] **Docs accurate:** README quickstart works verbatim; ROADMAP/BACKLOG reflect reality.
- [ ] **Performance sane at scale:** large boards/lists don't OOM or hang (pagination).
- [ ] **A short product demo passes:** a scripted "new user → create project → plan a sprint → work the board → see a report" walkthrough works without a hitch on desktop and mobile.

Everything beyond this (custom fields, automation rules, time tracking, SSO, email-to-issue, importers) is **post-v1** and should not block the release.
