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
- ✅ Markdown rendering in descriptions/comments — `marked` + `DOMPurify` (XSS-safe); view/edit toggle in IssueDetailDrawer; sanitized `MarkdownRenderer` component; `@mention` tokens survive; links open `target=_blank rel=noopener`; admin-delete UX for attachments fixed (ADMIN sees delete button on any attachment, matching API rule); 20 e2e tests (desktop + mobile) all green (2026-06-27)
- ⬜ Remaining: custom workflow *transitions*

## Phase 3 — Power features 🚧 (in progress)
- ✅ Roadmap / timeline (epics + sprints as bars, progress, today marker)
- ✅ Webhooks (HMAC-signed outbound on issue/sprint events + delivery log + Settings UI + SSRF guard + BullMQ queue)
- ✅ Command palette (Cmd-K) + cross-project search
- ✅ "My Work" personal dashboard
- ✅ CI pipeline (GitHub Actions) + API unit-test suite
- ✅ Cursor pagination for large lists (keyset on `createdAt,id`; `GET /issues` → `{ items, nextCursor }`)
- ✅ Security hardening pass (P1+P2): webhook SSRF guard (DNS pre-flight + redirect:manual + socket drain + fan-out cap), composite pagination index `@@index([projectId,createdAt,id])` + migration, `helmet()` security headers, global throttler (100 req/min) + stricter auth throttle (10 req/min), `WEBHOOK_ALLOW_PRIVATE` opt-out for self-hosters
- ✅ Security hardening Pass 5 (P1+P2): password-reset token no longer logged in production; SVG upload XSS vector removed (image/svg+xml removed from allowlist; legacy SVGs served as octet-stream); magic-byte MIME validation via file-type@16; null-file guard; PAT expiresAt past-date rejected; webhook HMAC secret removed from Redis job body (worker re-fetches from DB); 6 new unit tests; `file-type@16` dep added (2026-06-27)
- ✅ `assertNoParentCycle` replaced with atomic recursive CTE (`WITH RECURSIVE` via `$queryRaw` inside `$transaction`; TOCTOU-safe; O(1) round-trips; 100-hop depth cap; 6 new unit tests)
- ✅ UI design elevation — "Slate + Teal-Shift" design system (2026-06-27): deliberate token system replacing generic AI-default indigo; Plus Jakarta Sans Variable (UI) + IBM Plex Mono (issue keys/data, signature element); stone/amber/emerald status-progression arc; refined shadows/radii/animations; `prefers-reduced-motion` respected; all primitives + board + drawer elevated; 24 e2e tests green.
- ✅ Password reset (POST /auth/forgot-password + time-limited token + dev-log delivery + frontend forgot/reset pages)
- ✅ Keyboard triage mode (`/projects/:id/triage`): j/k navigate, s/p/a/l inline pickers, Enter drawer, f filter, ? help overlay, VIEWER read-only, mobile open button, command palette entry
- ✅ Label rename / edit — `PATCH /labels/:id` (name + color, MEMBER+; VIEWER rejected; cross-project rejected); `useUpdateLabel` hook; inline edit affordance in Settings Labels section and LabelPicker popover; cache invalidation propagates to board cards + drawer chips; 6 unit tests + 12 e2e tests (desktop + mobile)
- ✅ File attachments — `Attachment` model; `POST /issues/:id/attachments` (multer diskStorage, 10 MB cap, MIME allowlist); auth-gated streaming download; VIEWER-gated upload/delete; drag-drop AttachmentsPanel in IssueDetailDrawer (2026-06-27)
- ✅ Cumulative-flow diagram (CFD) — stacked-area chart; 14/30/90-day window; historical ActivityLog replay; `GET /projects/:id/reports/cfd`; 5 unit tests + 6 e2e tests (desktop + mobile) (2026-06-27)
- ✅ Security hardening sprint (Pass 5) — shipped: plaintext token log guarded, SVG-XSS removed from ALLOWED_MIME_TYPES (+ octet-stream download), unbounded CFD/burndown rewritten to `generate_series` DB aggregation, null-file 500→400, webhook secret out of Redis job body, PAT expiresAt past-date rejected, nginx CSP header, Helm Postgres fail-fast guard (2026-06-27)
- ✅ SMTP email delivery for password reset — `MailModule`/`MailService` (nodemailer); real SMTP when `SMTP_HOST` set; dev-log fallback when absent; production-safe (no token logged); 8 `mail.service.spec` unit tests + updated `password-reset.service.spec` (255 tests total); shipped 2026-06-27
- ✅ WATCHED_UPDATED notification emission — `IssuesService.update` fans out to watchers (minus actor) on meaningful field changes (status/assignee/priority/title/dueDate) via batched `createMany` + realtime; human-readable message; 11 unit tests (2026-06-27)
- ✅ Full-text search — Postgres `tsvector` generated column on Issue (title+description) + GIN index (migration `20260627230000_issue_full_text_search`); `websearch_to_tsquery` + `ts_rank` in search.service + `findAll` (q≥2 chars; ILIKE fallback for short/key queries); parameterized; 15 unit + 10 e2e (2026-06-27)
- ✅ Live board presence indicators — in-memory per-project presence in `RealtimeGateway` (`presence.update` on subscribe/unsubscribe/disconnect); `PresenceAvatars` stacked group + `usePresence` hook; 7 unit + 6 e2e (single-node; multi-replica needs Redis pub/sub) (2026-06-27)
- ✅ Batch `notifyComment` (createMany) + `rebalanceAndPlace` (single `$executeRaw` bulk CASE UPDATE) — eliminated two O(N) serial-DB loops; MENTIONED/COMMENTED fan-out now 2 round-trips regardless of watcher count; rebalance now 1 SQL statement instead of N sequential UPDATEs inside the transaction; 5 new unit tests (3 notification + 2 rebalance) + all 324 existing tests green (2026-06-27)
- ✅ Due date on issues — `dueDate DateTime?` on Issue model (migration `20260627220000_add_issue_due_date` + `@@index([dueDate])`); create/update DTOs + nullable/clearable; `IssueDto.dueDate` + `MyWorkIssueDto.dueDate` in shared types; drawer date picker with clear button + overdue amber styling; card chip (amber when overdue, neutral when future); My Work overdue sort + badge; 5 new unit tests + 8 e2e tests (desktop + mobile) — 2026-06-27
- ✅ Multiple boards per project (backend) — `Board` model; `GET/POST /projects/:id/boards`, `GET/PATCH/DELETE /boards/:id`; KANBAN/SCRUM issue scoping; lazy-create default board fallback; colorRules round-trip; 27 unit tests (2026-06-27)
- ✅ Multiple boards per project (frontend slice 1) — `useBoards`/`useBoardView`/`useCreateBoard`/`useUpdateBoard`/`useDeleteBoard` hooks in `apps/web/src/api/boards.ts`; `BoardSwitcher` dropdown with type badges (Kanban/Scrum), create-board modal, per-board settings (rename/type/delete, default-board guard); `BoardPage` boardId-driven with localStorage persistence per project; all optimistic-update mutations (`useMoveIssue`, `useCreateIssue`, `useDeleteIssue`, `useCreateStatus`, `useUpdateStatus`, `useDeleteStatus`, `useUpdateLabel`, `useDeleteLabel`, `useToggleIssueLabel`) extended with `boardId` to keep drag-and-drop keyed to `qk.boardView(boardId)`; `useBoardRealtime` extended with `boardId`; 8 Playwright e2e tests (desktop + mobile); build + typecheck green (2026-06-27)
- ⬜ Query DSL / saved views (filter builder → text query)
- ⬜ Custom fields (typed, JSONB-backed)
- ⬜ Workflow automation rules (trigger → action)
- ⬜ Time tracking / worklogs
- ⬜ Email (SMTP) notifications + email-to-issue
- ✅ "Team pulse" home dashboard (sprint snapshot, assigned issues, recent activity, projects grid — first-run onboarding preserved; 20 e2e tests desktop+mobile)
- ✅ REST API tokens (PATs: `nlp_` prefix, SHA-256 hash stored, create/list/revoke endpoints, JWT guard extension, profile settings UI, 14 e2e + 22 unit tests)
- ✅ PAT authentication at WebSocket handshake — `nlp_` PATs accepted in `RealtimeGateway.handleConnection` via `ApiTokensService.validateRawToken()`; revoked/expired PATs disconnected; JWT path unchanged; `ApiTokensModule` imported into `RealtimeModule`; 11 new unit tests (252 total) (2026-06-27)
- ✅ Live board presence indicators — per-project in-memory presence map in `RealtimeGateway`; `presence.update` event emitted on subscribe/unsubscribe/disconnect; stacked `PresenceAvatars` component (up to 4 visible + overflow badge, aria-label, tooltip); `usePresence` hook with self-exclusion + cleanup unsubscribe; 7 new unit tests; 6 e2e tests (desktop + mobile, socket-level + UI) — all green (2026-06-27)
- ✅ Audit log (workspace-scoped, ADMIN-only, cursor-paginated; AuditEvent model + migration; AuditService.record() best-effort fire-and-forget; events on membership add/remove/role-change, project create/archive, webhook CRUD, API-token create/revoke; GET /workspaces/:id/audit-log; WorkspaceAuditLogPage with paginated table + load-more; 11 unit tests + shared AuditEventDto/PaginatedAuditEventsDto types — 2026-06-27)
- ✅ Workspace member management UI — `WorkspaceMembersPage` at `/workspaces/:id/members`; `useRemoveMember` mutation (DELETE /workspaces/:id/members/:membershipId, invalidates members query); ADMIN-only Remove button (hidden for self; hidden entirely for MEMBER/VIEWER); ConfirmDialog guard; server error → toast; workspace sub-nav (Members / Audit log tabs); Members nav button on dashboard (ADMIN-only); 11 desktop + 11 mobile e2e — 2026-06-27
- ✅ Audit log e2e — `audit-log.spec.ts`: ADMIN performs audited actions (API token create, member add, member remove via UI) and confirms events appear in table; non-admin (VIEWER + MEMBER) nav buttons hidden; direct-navigate to audit-log shows access-denied; member management UI guards (Remove visible for ADMIN-on-others, hidden for self + non-ADMIN); 11 desktop + 11 mobile tests — 2026-06-27
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
- ✅ **Observability hooks** (Phase 4, P3 — 2026-06-27): request correlation id (`X-Request-Id` header + `requestId` pino field; genReqId reuses incoming header or generates UUID v4; `CorrelationIdInterceptor` echoes it on all API responses; `CorrelationIdMiddleware` wired in AppModule); enriched `/health` readiness probe (`{ status, uptime, version, db }` — `SELECT 1` ping with 3-second timeout, HTTP 503 + `db:"down"` on failure) and `/health/live` liveness probe (no DB dep, always 200); OTLP trace seam documented in `.env.example` and `DEPLOY-KUBERNETES.md` (stub — deps not installed; activation instructions + skeleton code included); 10 new unit tests (health.controller.spec.ts); 349 unit tests total. Both health endpoints excluded from access-log noise and global `/api` prefix.
- ✅ **E2E suite wired into CI** (hardening; `.github/workflows/e2e.yml`): Postgres 16 + Redis 7 service containers, build shared/api/web, `prisma migrate deploy` + seed, start API (`RATE_LIMIT_DISABLED=true WEBHOOK_ALLOW_PRIVATE=true`) + `vite preview`, install the Playwright chromium browser, run `pnpm --filter @next-lane/web exec playwright test` (desktop + mobile projects). Mirrors the local harness env (`PW_BASE_URL`/`PW_API_URL`/`PW_NO_WEBSERVER`) and uploads the HTML report on failure. (2026-06-27 — authored + statically validated: YAML parses + `actionlint` clean; **not yet executed on GitHub** — first real run is the maintainer gate.)
- ✅ **Kustomize base + overlays** as a Helm alternative (`deploy/kustomize/base` + `overlays/dev`, `overlays/prod`): same workloads as plain manifests, with replica/host/TLS/HPA/PDB patches per overlay. (2026-06-27 — all manifests parse; `kubectl`/`kustomize` not installed in sandbox so not built against a live cluster.)
- ✅ **Docs:** `docs/DEPLOY-KUBERNETES.md` — `helm install` quickstart, full values reference table, secret-management guidance, single-replica vs HA (`REDIS_URL`) section, HA topology overview, upgrade/migration runbook, Kustomize guide, troubleshooting.

> Sequencing: the **Socket.io Redis adapter** + **BullMQ webhook queue** (already
> P2 on the backlog) are the gating prerequisites for true multi-replica HA, so
> they should land before/with the Helm chart. Single-replica Helm can ship first.

## Phase 5 — Core PM parity 🚧 (in progress)

Close the table-stakes gaps that define a credible daily-driver tracker (see the
parity scorecard in `docs/AUDIT-PRODUCT.md`). This is the current build epic,
delivered as QA'd vertical slices.

- ✅ **Multiple boards per project + board types (Kanban / Scrum)** — `Board` model + switcher (create / rename / change type / delete), board-id-driven view, KANBAN (continuous flow) vs SCRUM (active-sprint) scoping; default board guaranteed per project. (2026-06-28)
- ⬜ **Custom fields** (project-level, type-targetable): text / number / select / multi-select / date / checkbox / url; rendered on the card detail + create form; usable in filters and color rules.
- ⬜ **NLQL — a real query language** (`assignee = me() AND priority in (High, Highest) AND "Severity" = S1`): tokenizer + parser + evaluator in `packages/shared`; inline query bar on the board; **saved filters** (personal + shareable). Field-name allowlist + length cap to prevent injection/ReDoS.
- ⬜ **Conditional card colors** — per-board ordered rule list (NLQL condition → color, first match wins) with a legend.
- ⬜ **Parity-gap backlog** (from the Pass-6 audit): issue links / dependencies, "watch" toggle, quick-filter presets, swimlanes, bulk edit, workflow transitions + validators, components, versions/releases, import/export, per-assignee workload report, configurable dashboards, project-level role overrides.

## Phase 6 — Autopilot: a self-hosted AI teammate 🔭 (vision)

The unfair advantage of a free, self-hosted, MIT tracker: **AI that is private,
unlimited, and $0** because it runs on *your* hardware. Points at a local LLM
(Ollama) or a bring-your-own key — no data egress, no per-seat AI metering. This
is the headline differentiator the cloud-first incumbents structurally can't match.

- ⬜ **Natural language → NLQL.** "overdue bugs assigned to me in the mobile component" compiles to a safe NLQL query (Phase 5 gives the execution target; the model only translates).
- ⬜ **Auto-triage on create** — suggested type / priority / component / assignee / labels, with **semantic duplicate detection** (add `pgvector` embeddings on top of the existing Postgres FTS/GIN index).
- ⬜ **Sprint risk radar + summaries** — "this sprint will miss by ~6 pts; blocker is NL-142"; auto standups and release notes generated from closed issues.
- ⬜ **MCP-native** — ship Next Lane as an **MCP server** so AI coding agents (Claude Code, etc.) read & write issues directly from the IDE (file bugs, move cards, close tickets as they code). Dogfooded by this project's own agent build loop. No paid tracker is MCP-native today.
- ⬜ **Privacy posture** — all inference local by default; a hard "no external calls" switch for regulated installs; per-workspace model/endpoint config.

## Phase 7 — Glass Box: unlimited automation + data ownership 🔭 (vision)

Everything the incumbents meter or lock away, given freely because it's self-hosted.

- ⬜ **Automation engine** — a trigger → condition → action rule builder (when status/label/assignee/field changes, due date passes, etc. → assign, transition, comment, notify, call webhook, run an Autopilot action). **Unlimited runs** (vs per-seat metering) with a full audit of every execution.
- ⬜ **Rule library + templates** — common automations one-click installable; rules are versioned and inspectable.
- ⬜ **True data ownership** — read-only SQL access / warehouse export of your own tracker data, plus shippable Grafana dashboards (pairs with the Phase 4 `/metrics` + observability work). Your data, your queries, no export tax.

---

### Current focus
**Phase 5 — Core PM parity (2026-06-28).** Building the table-stakes capabilities a credible tracker needs, as QA'd vertical slices: multiple boards + Kanban/Scrum types ✅ shipped; custom fields → NLQL query language + saved filters → conditional card colors next, then the parity-gap backlog. Phases 6 (Autopilot: private/unlimited self-hosted AI + MCP-native) and 7 (Glass Box: unlimited automation + data ownership) are the "better-than-the-incumbent, free forever" moonshots queued after parity.

**UI design elevation (2026-06-27): "Slate + Teal-Shift" design system foundation shipped.** Full token-system overhaul: deep teal accent replacing generic indigo; stone/amber/emerald status-progression arc (Todo→In Progress→Done); Plus Jakarta Sans Variable for UI copy + IBM Plex Mono for issue keys / story points (the signature element — teal `.nl-issue-key` class applied to every issue key); refined shadow/radius/spacing/animation scales; all UI primitives (Button, Input, Select, Textarea, Field, Badge, Avatar, Modal, Toast) and highest-traffic surfaces (AppHeader, BoardColumn, IssueCard, CardStatusPicker, IssueDetailDrawer, AuthShell) updated. Self-hosted via @fontsource (no CDN). Drawer and modal entrance animations; `prefers-reduced-motion` respected. WCAG-AA contrast maintained. All test hooks (`data-testid`, ARIA roles, accessible names) preserved; 24/24 representative e2e tests pass. The component redesign loop continues (see docs/UI-REVIEW.md tracker).

**Phase 3 security hardening sprint (Pass 5) + Phase 4 observability hooks now complete. Tenant isolation harness shipped (2026-06-27): 42-endpoint cross-tenant matrix + WebSocket gateway isolation, all BLOCKED.** Phases 0–2 are fully done (CFD shipped 2026-06-27, closing the last Phase 2 item). Phase 4 Kubernetes packaging is substantially complete (Helm, Kustomize, GHCR CI, Redis adapter, BullMQ queue, observability hooks — all shipped 2026-06-27). Phase 4 is now functionally complete; the only remaining gate is the real `docker compose up -d --build` first-run validation on a host with registry access.

Engineering-auditor Pass 5 (2026-06-27) identified a fresh security hardening cluster now being fixed: password reset token logged in plaintext to production logs (P1, S); SVG attachment served as `image/svg+xml` allowing direct-navigate XSS (P1, S); CFD/burndown unbounded queries that will OOM for any active project (P1, M — rewriting as Postgres `generate_series` aggregation); null-file upload returning 500 instead of 400 (P2, S); webhook HMAC secret stored in plaintext BullMQ job body (P2, S); PAT `expiresAt` accepting past dates (P2, S); nginx container missing Content-Security-Policy header (P2, S); Helm bundled-Postgres default password lacking a fail-fast guard (P2, S). All being addressed in the current build batch.

Product-auditor Pass 5 (2026-06-27) confirms the product has crossed the "credible daily-driver" threshold. Two product P1s remain: SMTP email delivery for password reset (current fallback is dev-log only — unacceptable for production self-hosters), and `WATCHED_UPDATED` notification emission (watcher model inert for notifications despite enum being defined). Due date on issues is now shipped (2026-06-27).

SMTP email delivery for password reset shipped 2026-06-27: `MailModule`/`MailService` (nodemailer); real SMTP when `SMTP_HOST` set; dev-log fallback when absent; production-safe.
Due dates shipped 2026-06-27: `dueDate DateTime?` on Issue model (migration `20260627220000_add_issue_due_date`); create/update DTOs; `IssueDto.dueDate` + `MyWorkIssueDto.dueDate`; drawer date picker with clear button + overdue amber styling; card chip; My Work overdue badge + sort; 5 unit tests + 8 e2e (desktop + mobile).
PAT auth at the WebSocket handshake shipped 2026-06-27: `nlp_` tokens authenticate the socket via `ApiTokensService.validateRawToken()`; JWT path unchanged; 11 gateway unit tests.

Markdown rendering + attachment admin-delete shipped 2026-06-27: `marked` + `DOMPurify` for sanitized markdown in issue descriptions (view/edit toggle) and comments; `MarkdownRenderer` component; `@mention` tokens preserved; links open `target=_blank rel=noopener noreferrer`; `AttachmentsPanel` now respects `viewerRole` — ADMIN sees delete button on any attachment (matching API rule); `IssueDetailDrawer`/`BoardPage`/`BacklogPage`/`TriagePage` all pass `viewerRole`; 20 new e2e tests (10 desktop + 10 mobile) all green.

Next build order: public read-only share link (M, P2) → inline card status transition (S, P2) → PAT scopes (M, P2) → remaining perf (batch inserts, slim planning endpoint, board-overview prefetch) + P3 ideas (sprint retros, issue templates).

PATs shipped 2026-06-27: `nlp_`-prefixed (SHA-256 hashed) with create/list/revoke + JWT-guard extension + profile-settings UI.
PAT-at-WS-handshake shipped 2026-06-27: `RealtimeGateway.handleConnection` now detects `nlp_` prefix and validates via `ApiTokensService.validateRawToken()`; revoked/expired/unknown PATs disconnect the socket immediately; JWT path unchanged; 11 new unit tests.
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
- [x] **Security/multi-tenant solid:** isolation, roles, secrets, CORS, input bounds, webhook SSRF — all closed. (SSRF guard + pagination index + helmet + rate limiting shipped 2026-06-27. Tenant isolation provably enforced via 42-endpoint integration harness — all BLOCKED 2026-06-27.)
- [x] **Docs accurate:** README reflects shipped features; ROADMAP/BACKLOG reconciled against git history each cycle. (Quickstart commands valid; full `docker compose up` verification is the open item below.)
- [x] **Performance sane at scale:** large boards/lists don't OOM or hang (pagination). Board and roadmap endpoints now capped at 500 issues/epics with `issuesTruncated`/`epicsTruncated` flags. CFD and burndown reports now use DB-level aggregation via `$queryRaw` + `generate_series` (O(windowDays × categories) output; no longer O(issues × days) in Node).
- [x] **A short product demo passes:** the scripted "new user → create project → plan a sprint → work the board → see a report" walkthrough runs end-to-end on desktop and mobile (covered by the e2e acceptance suite + qa-tester sweep).

**v1 status (2026-06-27):** feature-complete and green. Personal API tokens (PATs) shipped 2026-06-27 (Phase 3 power feature). The single remaining gate is
the **real `docker compose up -d --build` first-run validation on a host with
container-registry access** — it can't run in this build sandbox (Docker Hub egress
blocked), so it needs a maintainer to run the README quickstart verbatim and confirm.
Everything else above is met.

**Observability baseline (2026-06-27):** structured logging via `nestjs-pino` + `pino-http` shipped. All NestJS and application logs now emit JSON in production (level, time, pid, hostname, context, msg) and pretty-printed output in development (pino-pretty). Sensitive fields (`authorization` header, `cookie`, `password`, `token`, `newPassword`) are redacted. Health-check requests are silenced in logs. Log level configurable via `LOG_LEVEL` env var (default `info`). `bufferLogs: true` ensures startup logs route through pino.

**Observability hooks (Phase 4, P3 — shipped 2026-06-27):** request correlation id — every request gets a UUID v4 (or reuses the incoming `X-Request-Id` header) bound to `req.id` by pino-http's `genReqId` hook, exposed as the `requestId` field on every pino log line, and echoed back to callers via `X-Request-Id` response header (via `CorrelationIdInterceptor` + `CorrelationIdMiddleware` in `AppModule`); enriched `/health` readiness probe returning `{ status, uptime, version, db }` with `SELECT 1` DB ping (503 + `db:"down"` on failure, 3-second timeout) and `/health/live` liveness probe (no DB dependency, always 200); both health paths excluded from access-log noise and global `/api` prefix; OTLP trace seam documented as a stub in `.env.example` and `DEPLOY-KUBERNETES.md` (not installed; activation skeleton + env vars documented); 10 new unit tests (health.controller.spec.ts); 349 total tests green.

**Reports perf hardening (2026-06-27, Pass 5):** CFD and burndown reports rewritten to use DB-level aggregation via `$queryRaw`. CFD uses a single Postgres `generate_series` query with a LATERAL subquery to reconstruct per-day status-at-end-of-day from ActivityLog, grouped by category — output bounded at `windowDays × 3` rows regardless of project size. Burndown completion-date lookup uses a single parameterized GROUP BY query instead of per-issue fetches. No API response shape change; same semantics. 227 unit tests green (12 reports tests including new bounded-query assertion); 6 Playwright reports e2e tests green (desktop + mobile).

Everything beyond this (custom fields, automation rules, time tracking, SSO, email-to-issue, importers) is **post-v1** and should not block the release.
