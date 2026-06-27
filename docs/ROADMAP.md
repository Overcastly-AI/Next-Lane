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
- ✅ Search & filter (status / assignee / type / priority) — board toolbar: title search, assignee select, label multi-select, type multi-select, priority multi-select (shipped 2026-06-27)
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
- ✅ @mention autocomplete in comment composer (MentionComposer + 16 e2e tests desktop+mobile; inserts `@email` matching backend mention parser)
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
- ✅ `assertNoParentCycle` replaced with atomic recursive CTE (`WITH RECURSIVE` via `$queryRaw` inside `$transaction`; TOCTOU-safe; O(1) round-trips; 100-hop depth cap; 6 new unit tests)
- ✅ Password reset (POST /auth/forgot-password + time-limited token + dev-log delivery + frontend forgot/reset pages)
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
Board type/priority filters, @mention autocomplete (MentionComposer picker matching the backend fan-out parser), and password reset (token model + forgot/reset endpoints + frontend pages, dev-log delivery seam) all shipped.
`assertNoParentCycle` replaced with a single atomic `WITH RECURSIVE` CTE inside the update transaction (TOCTOU closed, O(1) DB round-trips).
UX/a11y polish pass (2026-06-27): MentionComposer no-results state; password min-length aligned to 8 (ResetPasswordPage + ResetPasswordDto); auto-redirect removed from reset success; board toolbar mobile overflow-x-auto strip; aria-haspopup corrected; picker shadow + position improved; MyWorkPage EmptyState unified; autoFocus on all auth forms.
Perf + polish pass #2 (2026-06-27): useProjectIssues passes `limit=200` (API cap) — reduces planning-view round-trips 5x; BoardColumn empty-button contrast raised to `text-sm text-gray-500` (WCAG-AA); OnboardingPanel emoji icons replaced with consistent inline SVGs; MyWork per-section EmptyState now has "Go to board" action. 16 e2e green (onboarding + my-work, desktop + mobile).
**v1 is feature-complete and green** (all release criteria met except the real `docker compose up` first-run check, which requires a host with registry access — see below). Remaining work is **post-v1**: query DSL/saved views, custom fields, automation rules, time tracking, email, dashboards, API tokens, audit log, bulk edit, importers, SSO — plus hardening (wire e2e into CI, Redis-backed webhook delivery queue, JWT→httpOnly cookie, structured logging).

## v1.0 release criteria — definition of "a good product"

We are done with v1 when ALL of these hold (drive here, then polish, then stop):

- [ ] **Runs first-try:** `git clone && cp .env.example .env && docker compose up -d --build` yields a working app with seeded demo + working login, no manual steps. (Validated against the real Docker artifact, not a proxy.)
- [x] **Core flows are bug-free on desktop AND mobile**, verified with real-user QA (per-keystroke typing, real clicks/scroll): auth, create/edit/move issue, drag-and-drop, comments, labels, sprints, backlog, reports, roadmap, search, settings/columns, My Work, notifications. (qa-tester ACCEPT + 215 Playwright tests green across desktop + mobile, incl. reload-persist DnD verified.)
- [x] **First-run experience isn't an empty void:** onboarding offers a sample project or clear "create your first project" guidance. (Welcome panel + feature highlights shown on empty project list; improved empty states on board, My Work, and notifications; e2e covered desktop + mobile.)
- [~] **No known P0/P1 bugs.** No P0/P1 open; CI (lint + typecheck + unit + build) green on every push. *Caveat: the Playwright e2e suite is run locally (215 green) but intentionally not yet wired into CI — adding it is a remaining hardening item.*
- [x] **Security/multi-tenant solid:** isolation, roles, secrets, CORS, input bounds, webhook SSRF — all closed. (SSRF guard + pagination index + helmet + rate limiting shipped 2026-06-27.)
- [x] **Docs accurate:** README reflects shipped features; ROADMAP/BACKLOG reconciled against git history each cycle. (Quickstart commands valid; full `docker compose up` verification is the open item below.)
- [x] **Performance sane at scale:** large boards/lists don't OOM or hang (pagination). Board and roadmap endpoints now capped at 500 issues/epics with `issuesTruncated`/`epicsTruncated` flags.
- [x] **A short product demo passes:** the scripted "new user → create project → plan a sprint → work the board → see a report" walkthrough runs end-to-end on desktop and mobile (covered by the e2e acceptance suite + qa-tester sweep).

**v1 status (2026-06-27):** feature-complete and green. The single remaining gate is
the **real `docker compose up -d --build` first-run validation on a host with
container-registry access** — it can't run in this build sandbox (Docker Hub egress
blocked), so it needs a maintainer to run the README quickstart verbatim and confirm.
Everything else above is met.

Everything beyond this (custom fields, automation rules, time tracking, SSO, email-to-issue, importers) is **post-v1** and should not block the release.
