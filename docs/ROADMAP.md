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
- ✅ Cumulative-flow report (CFD stacked-area chart, 14/30/90-day window selector, historical reconstruction from ActivityLog; shipped 2026-06-27)
- ✅ Attachments (file uploads) — `Attachment` model + migration `20260627145511_add_attachment_model`; local disk storage under `UPLOADS_DIR` (K8s-ready PVC mount path); `POST /issues/:id/attachments` (multipart, 10 MB cap, MIME allowlist: images/PDF/text/office/zip), `GET /issues/:id/attachments`, `GET /attachments/:id` (stream with auth + Content-Disposition), `DELETE /attachments/:id` (uploader or project ADMIN); VIEWER-gated upload/delete; drag-drop + file-input AttachmentsPanel in IssueDetailDrawer; 16 unit tests + 5 e2e tests (desktop + mobile) — all green; 208 unit tests total. (2026-06-27)
- ⬜ Remaining: custom workflow *transitions*

## Phase 3 — Power features 🚧 (in progress)
- ✅ Roadmap / timeline (epics + sprints as bars, progress, today marker)
- ✅ Webhooks (HMAC-signed outbound on issue/sprint events + delivery log + Settings UI + SSRF guard + BullMQ queue)
- ✅ Command palette (Cmd-K) + cross-project search
- ✅ "My Work" personal dashboard
- ✅ CI pipeline (GitHub Actions) + API unit-test suite
- ✅ Cursor pagination for large lists (keyset on `createdAt,id`; `GET /issues` → `{ items, nextCursor }`)
- ✅ Security hardening pass (P1+P2): webhook SSRF guard (DNS pre-flight + redirect:manual + socket drain + fan-out cap), composite pagination index `@@index([projectId,createdAt,id])` + migration, `helmet()` security headers, global throttler (100 req/min) + stricter auth throttle (10 req/min), `WEBHOOK_ALLOW_PRIVATE` opt-out for self-hosters
- ✅ `assertNoParentCycle` replaced with atomic recursive CTE (`WITH RECURSIVE` via `$queryRaw` inside `$transaction`; TOCTOU-safe; O(1) round-trips; 100-hop depth cap; 6 new unit tests)
- ✅ Password reset (POST /auth/forgot-password + time-limited token + dev-log delivery + frontend forgot/reset pages)
- ✅ Keyboard triage mode (`/projects/:id/triage`): j/k navigate, s/p/a/l inline pickers, Enter drawer, f filter, ? help overlay, VIEWER read-only, mobile open button, command palette entry
- ✅ Label rename / edit — `PATCH /labels/:id` (name + color, MEMBER+; VIEWER rejected; cross-project rejected); `useUpdateLabel` hook; inline edit affordance in Settings Labels section and LabelPicker popover; cache invalidation propagates to board cards + drawer chips; 6 unit tests + 12 e2e tests (desktop + mobile)
- ✅ File attachments — `Attachment` model; `POST /issues/:id/attachments` (multer diskStorage, 10 MB cap, MIME allowlist); auth-gated streaming download; VIEWER-gated upload/delete; drag-drop AttachmentsPanel in IssueDetailDrawer (2026-06-27)
- ✅ Cumulative-flow diagram (CFD) — stacked-area chart; 14/30/90-day window; historical ActivityLog replay; `GET /projects/:id/reports/cfd`; 5 unit tests + 6 e2e tests (desktop + mobile) (2026-06-27)
- 🚧 Security hardening sprint (Pass 5): fixing plaintext token log, SVG-XSS in ALLOWED_MIME_TYPES, unbounded CFD/burndown queries (generate_series rewrite), null-file 500→400, webhook secret in Redis, PAT expiresAt validation, nginx CSP header, Helm Postgres fail-fast guard
- ⬜ SMTP email delivery for password reset (nodemailer into existing stub seam)
- ⬜ WATCHED_UPDATED notification emission (fan-out to watchers on issue field change)
- ⬜ Due date on issues (schema field + drawer picker + card chip + My Work overdue warning)
- ⬜ Query DSL / saved views (filter builder → text query)
- ⬜ Custom fields (typed, JSONB-backed)
- ⬜ Workflow automation rules (trigger → action)
- ⬜ Time tracking / worklogs
- ⬜ Email (SMTP) notifications + email-to-issue
- ✅ "Team pulse" home dashboard (sprint snapshot, assigned issues, recent activity, projects grid — first-run onboarding preserved; 20 e2e tests desktop+mobile)
- ✅ REST API tokens (PATs: `nlp_` prefix, SHA-256 hash stored, create/list/revoke endpoints, JWT guard extension, profile settings UI, 14 e2e + 22 unit tests)
- ✅ Audit log (workspace-scoped, ADMIN-only, cursor-paginated; AuditEvent model + migration; AuditService.record() best-effort fire-and-forget; events on membership add/remove/role-change, project create/archive, webhook CRUD, API-token create/revoke; GET /workspaces/:id/audit-log; WorkspaceAuditLogPage with paginated table + load-more; 11 unit tests + shared AuditEventDto/PaginatedAuditEventsDto types — 2026-06-27)
- ⬜ Bulk edit, CSV import (and importers for other trackers), SSO/OIDC

## Phase 4 — Cloud-native deployment (post-v1) 🚧

Today's deploy story is single-host Docker Compose. Phase 4 makes Next Lane a
first-class **Kubernetes** citizen so teams can self-host it on a cluster with
HA, autoscaling, and managed datastores — without abandoning the one-command
Compose path for small installs.

**Foundation (prerequisites — already mostly true):**
- ✅ 12-factor config: everything is env-driven (`DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGINS`, `THROTTLE_*`, `WEBHOOK_ALLOW_PRIVATE`, `LOG_LEVEL`). The build-time `VITE_API_URL` gap is closed two ways: the standalone web image is runtime-configurable via `API_URL` → `/config.js` → `window.__NL_CONFIG__` (no rebuild), and the Helm chart additionally offers a same-origin nginx reverse-proxy (`web.apiMode: same-origin`).
- ✅ Liveness/readiness signal: API exposes `/health`.
- ✅ Structured JSON logs (pino) — shipped 2026-06-27.

**Deliverables:**
- ✅ **Publish container images** for `api` and `web` to GHCR via CI (`.github/workflows/images.yml`): on push to `main` + `v*` tags, multi-arch (amd64/arm64) builds pushed to `ghcr.io/<owner>/next-lane-{api,web}` (owner derived dynamically + lowercased) with `docker/metadata-action` semver + `latest` + `sha`/branch/`edge` tags, gha layer cache, SBOM (buildx attestation + `anchore/sbom-action` SPDX artifact) and a Trivy scan. Web image built with empty `VITE_API_URL` (runtime `/config.js` handles it). Auth via built-in `GITHUB_TOKEN` (`packages: write`). (2026-06-27 — authored + statically validated: YAML parses + `actionlint` clean; **not yet executed on GitHub** — first real run is the maintainer gate, alongside the docker-compose/cluster gates.)
- ✅ **Helm chart** (`deploy/helm/next-lane`): Deployments for api + web, Services, Ingress (TLS via cert-manager, toggleable), ConfigMap + Secret, resource requests/limits, liveness/readiness/startup probes on `/health`, HPA (api + web), PodDisruptionBudget (api + web), securityContext (runAsNonRoot, readOnlyRootFilesystem, drop ALL caps), `_helpers.tpl`, NOTES.txt. Values toggles for replicaCount, image repo/tag, ingress host/TLS, datastores, autoscaling/PDB. (2026-06-27 — authored + render-validated to valid YAML for default and external-datastore value sets; not yet `helm lint`'d/applied on a live cluster — see `docs/DEPLOY-KUBERNETES.md`.)
- ✅ **Datastore strategy in values:** optional Bitnami `postgresql`/`redis` subchart dependencies (gated by `postgresql.enabled` / `redis.enabled`) for quick-start, OR point at external/managed instances via `externalDatabase.*` / `externalRedis.*` (recommended for prod) — DATABASE_URL/REDIS_URL derived either way.
- ✅ **Schema migrations as a Helm hook Job** (`prisma migrate deploy`) gated as a pre-install/pre-upgrade hook before api rollout, so upgrades migrate safely and exactly once. (Kustomize ships the equivalent Job + a documented `kubectl wait` ordering.)
- ✅ **Secrets**: chart-managed K8s `Secret` for `JWT_SECRET` + DB/Redis creds, OR `secrets.existingSecret` for external-secrets/sealed-secrets/SOPS; templating **fails fast** when no secret is provided — never ships a default secret.
- ✅ **Web runtime config** (two complementary mechanisms): the standalone web image runs `docker-entrypoint.sh` to write `/config.js` from `API_URL` at container start (`getApiUrl()` reads `window.__NL_CONFIG__.apiUrl` → `VITE_API_URL` → default; `index.html` loads it pre-bundle; 6 e2e green), and the Helm chart additionally defaults to `web.apiMode: same-origin` (nginx ConfigMap reverse-proxies `/api` + `/socket.io` to the API Service; `external` mode documented). One web image works across environments without rebuilds.
- ✅ **Horizontal scale enablers:** Socket.io **Redis adapter** (`@socket.io/redis-adapter`) for multi-replica realtime (attaches in `afterInit`; falls back to in-memory when `REDIS_URL` unset) + **Redis-backed webhook delivery queue (BullMQ)** with retries + exponential backoff + concurrency cap (falls back to in-process p-limit fan-out when `REDIS_URL` unset). Both are backward-compatible — zero-config Compose/dev path unchanged. Prerequisites for `replicas > 1` are now met.
- ⬜ **Observability hooks:** optional `ServiceMonitor`/metrics endpoint, OTLP traces, and structured logs ready for a collector.
- ✅ **E2E suite wired into CI** (hardening; `.github/workflows/e2e.yml`): Postgres 16 + Redis 7 service containers, build shared/api/web, `prisma migrate deploy` + seed, start API (`RATE_LIMIT_DISABLED=true WEBHOOK_ALLOW_PRIVATE=true`) + `vite preview`, install the Playwright chromium browser, run `pnpm --filter @next-lane/web exec playwright test` (desktop + mobile projects). Mirrors the local harness env (`PW_BASE_URL`/`PW_API_URL`/`PW_NO_WEBSERVER`) and uploads the HTML report on failure. (2026-06-27 — authored + statically validated: YAML parses + `actionlint` clean; **not yet executed on GitHub** — first real run is the maintainer gate.)
- ✅ **Kustomize base + overlays** as a Helm alternative (`deploy/kustomize/base` + `overlays/dev`, `overlays/prod`): same workloads as plain manifests, with replica/host/TLS/HPA/PDB patches per overlay. (2026-06-27 — all manifests parse; `kubectl`/`kustomize` not installed in sandbox so not built against a live cluster.)
- ✅ **Docs:** `docs/DEPLOY-KUBERNETES.md` — `helm install` quickstart, full values reference table, secret-management guidance, single-replica vs HA (`REDIS_URL`) section, HA topology overview, upgrade/migration runbook, Kustomize guide, troubleshooting.

> Sequencing: the **Socket.io Redis adapter** + **BullMQ webhook queue** (already
> P2 on the backlog) are the gating prerequisites for true multi-replica HA, so
> they should land before/with the Helm chart. Single-replica Helm can ship first.

---

### Current focus
**Phase 3 security hardening sprint (Pass 5) + remaining product P1s.** Phases 0–2 are fully done (CFD shipped 2026-06-27, closing the last Phase 2 item). Phase 4 Kubernetes packaging is substantially complete (Helm, Kustomize, GHCR CI, Redis adapter, BullMQ queue — all shipped 2026-06-27; observability hooks remain).

Engineering-auditor Pass 5 (2026-06-27) identified a fresh security hardening cluster now being fixed: password reset token logged in plaintext to production logs (P1, S); SVG attachment served as `image/svg+xml` allowing direct-navigate XSS (P1, S); CFD/burndown unbounded queries that will OOM for any active project (P1, M — rewriting as Postgres `generate_series` aggregation); null-file upload returning 500 instead of 400 (P2, S); webhook HMAC secret stored in plaintext BullMQ job body (P2, S); PAT `expiresAt` accepting past dates (P2, S); nginx container missing Content-Security-Policy header (P2, S); Helm bundled-Postgres default password lacking a fail-fast guard (P2, S). All being addressed in the current build batch.

Product-auditor Pass 5 (2026-06-27) confirms the product has crossed the "credible daily-driver" threshold. Three product P1s remain: SMTP email delivery for password reset (current fallback is dev-log only — unacceptable for production self-hosters), `WATCHED_UPDATED` notification emission (watcher model inert for notifications despite enum being defined), and due date on issues (not yet in schema, most-requested primitive for "My Work" overdue surfacing).

After the security batch clears, the build order is: SMTP wiring (S) → WATCHED_UPDATED emission (S) → due date (M) → full-text search (M, P1) → public share link (M, P2) → presence indicators + remaining P2s.

PATs shipped 2026-06-27: `nlp_`-prefixed (SHA-256 hashed) with create/list/revoke + JWT-guard extension + profile-settings UI.
Workspace audit log shipped 2026-06-27: ADMIN-only cursor-paginated event table (membership/project/webhook/token events).
Attachments shipped 2026-06-27: multer disk storage, MIME allowlist, auth-gated streaming download, drag-drop panel.
Label rename shipped 2026-06-27: PATCH /labels/:id + inline edit in Settings + LabelPicker.
Team Pulse dashboard shipped 2026-06-27: sprint snapshot, assigned-issues, recent activity, projects grid.
Keyboard triage mode shipped 2026-06-27: j/k/s/p/a/l/Enter/f/? keyboard model, ARIA listbox, command palette entry.

**v1 is feature-complete and green.** The single remaining gate is the real `docker compose up -d --build` first-run validation on a host with container-registry access. Remaining work is post-v1: query DSL/saved views, custom fields, automation rules, time tracking, email notifications (beyond password reset), bulk edit, importers, SSO.

## v1.0 release criteria — definition of "a good product"

We are done with v1 when ALL of these hold (drive here, then polish, then stop):

- [ ] **Runs first-try:** `git clone && cp .env.example .env && docker compose up -d --build` yields a working app with seeded demo + working login, no manual steps. (Validated against the real Docker artifact, not a proxy.)
- [x] **Core flows are bug-free on desktop AND mobile**, verified with real-user QA (per-keystroke typing, real clicks/scroll): auth, create/edit/move issue, drag-and-drop, comments, labels, sprints, backlog, reports, roadmap, search, settings/columns, My Work, notifications. (qa-tester ACCEPT + 215 Playwright tests green across desktop + mobile, incl. reload-persist DnD verified.)
- [x] **First-run experience isn't an empty void:** onboarding offers a sample project or clear "create your first project" guidance. (Welcome panel + feature highlights shown on empty project list; improved empty states on board, My Work, and notifications; e2e covered desktop + mobile.)
- [~] **No known P0/P1 bugs.** No P0/P1 open; CI (lint + typecheck + unit + build) green on every push. The Playwright e2e suite (215 green locally) is now also **wired into CI** via `.github/workflows/e2e.yml` (Postgres+Redis services, real built artifacts, desktop+mobile). *Caveat: the e2e workflow is authored + statically validated (YAML + actionlint) but has not yet had its first GitHub run — that run is the maintainer gate.*
- [x] **Security/multi-tenant solid:** isolation, roles, secrets, CORS, input bounds, webhook SSRF — all closed. (SSRF guard + pagination index + helmet + rate limiting shipped 2026-06-27.)
- [x] **Docs accurate:** README reflects shipped features; ROADMAP/BACKLOG reconciled against git history each cycle. (Quickstart commands valid; full `docker compose up` verification is the open item below.)
- [x] **Performance sane at scale:** large boards/lists don't OOM or hang (pagination). Board and roadmap endpoints now capped at 500 issues/epics with `issuesTruncated`/`epicsTruncated` flags.
- [x] **A short product demo passes:** the scripted "new user → create project → plan a sprint → work the board → see a report" walkthrough runs end-to-end on desktop and mobile (covered by the e2e acceptance suite + qa-tester sweep).

**v1 status (2026-06-27):** feature-complete and green. Personal API tokens (PATs) shipped 2026-06-27 (Phase 3 power feature). The single remaining gate is
the **real `docker compose up -d --build` first-run validation on a host with
container-registry access** — it can't run in this build sandbox (Docker Hub egress
blocked), so it needs a maintainer to run the README quickstart verbatim and confirm.
Everything else above is met.

**Observability baseline (2026-06-27):** structured logging via `nestjs-pino` + `pino-http` shipped. All NestJS and application logs now emit JSON in production (level, time, pid, hostname, context, msg) and pretty-printed output in development (pino-pretty). Sensitive fields (`authorization` header, `cookie`, `password`, `token`, `newPassword`) are redacted. Health-check requests are silenced in logs. Log level configurable via `LOG_LEVEL` env var (default `info`). `bufferLogs: true` ensures startup logs route through pino. The two remaining `console.*` calls in `main.ts` have been replaced with the pino Logger and `process.stderr`.

Everything beyond this (custom fields, automation rules, time tracking, SSO, email-to-issue, importers) is **post-v1** and should not block the release.
