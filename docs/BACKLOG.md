# Next Lane — Dev Board (Backlog)

Single prioritized board maintained by the **backlog-groomer**, fed by the two independent auditors (`docs/AUDIT-PRODUCT.md`, `docs/AUDIT-ENGINEERING.md`), the front-end QA review (`docs/UI-REVIEW.md`), and the roadmap (`docs/ROADMAP.md`). The autonomous build loop pulls from **Ready (top of queue)**.

Format: `- [ ] (P1, M) title — description [src]` · P0 critical / P1 now / P2 next / P3 later · size S/M/L. Checked `[x]` = done.

> Grooming note (2026-06-27, Pass 5): Pass 5 closes the rapid-shipping wave (attachments,
> PATs, CFD, triage mode, audit log, pino, BullMQ/Redis adapter, Helm/Kustomize, GHCR CI).
> The product has crossed the threshold from "impressive OSS project" to "credible daily-driver
> tracker." Engineering auditor Pass 5 identifies a fresh security hardening cluster — plaintext
> token log, SVG-XSS, and unbounded CFD/burndown — all being fixed in the current batch.
> Product auditor Pass 5 pivots remaining gaps to the "polish, convenience, and trust" tier:
> SMTP wiring (the password reset fallback is a dev-log stub, not acceptable for production),
> due dates (most-requested primitive, not yet in schema), and WATCHED_UPDATED emission (watcher
> model is inert for notifications). Two known deferrals captured: audit-log has no e2e spec yet;
> `removeMember` REST endpoint exists but the member-management UI does not surface it.
>
> Priority tension — Pass 5: Engineering auditor rates plaintext token log and SVG-XSS as P1
> (security, affects all self-hosters); product auditor rates SMTP wiring and due dates as P1
> (trust and daily-driver usability). Resolution: security items first (they are S-sized, ship
> fast), then product P1s in the order SMTP → WATCHED_UPDATED → due dates → full-text search.
> Public share link and presence indicators are P2 — high value but not blocking the trust story.

---

## Ready (top of queue)

_Security fixes — ✅ all shipped 2026-06-27 (Pass 5 security/perf/infra batch):_

- [x] (P1, S) Guard password reset token log with `NODE_ENV !== 'production'` — raw reset URL (including 32-byte token) is emitted via `logger.log()` with no NODE_ENV guard; pino-http redact rules do not cover explicit logger calls; any log aggregator captures the token in plaintext; add `if (process.env.NODE_ENV !== 'production')` guard; skip log entirely when SMTP_HOST is set [engineering-auditor Pass 5] ✅ shipped 2026-06-27 (Pass 5 security/perf/infra batch)
- [x] (P1, S) Remove `image/svg+xml` from ALLOWED_MIME_TYPES (or serve as `application/octet-stream`) — SVG files with embedded `<script>` tags accepted and served with `image/svg+xml` Content-Type; direct-navigate to the download URL executes script in browser context; `nosniff` partially mitigates but does not close the direct-navigate vector; simplest fix is to remove SVG from the allowlist [engineering-auditor Pass 5] ✅ shipped 2026-06-27 (Pass 5 security/perf/infra batch)
- [x] (P1, M) Rewrite CFD and burndown as DB-level `generate_series` aggregation — `reports.service.ts` fetches all project issues and all activity logs into memory with no `take` limit; for any active project (5k+ issues × 5 status changes each = 25k+ rows) the in-memory O(issues × days) loop will OOM or timeout the API process; replace with a Postgres `generate_series` window-function query bounded by `windowDays × 3` rows regardless of project size [engineering-auditor Pass 5] ✅ shipped 2026-06-27 (Pass 5 security/perf/infra batch)

_Remaining P2 security hardening from Pass 5 (small, high-signal):_

- [x] (P2, S) Add null-file guard in `AttachmentsService.upload` (400 not 500) — POST with no `file` field dereferences `undefined` → TypeError → generic 500 via global filter; add `if (!file) throw new BadRequestException('No file uploaded')` [engineering-auditor Pass 5] ✅ shipped 2026-06-27 (Pass 5 security/perf/infra batch)
- [x] (P2, S) Enqueue only `subscriptionId` in BullMQ job body (not the HMAC secret) — webhook HMAC secrets stored as plaintext JSON in Redis; bundled Helm Redis has no auth by default; enqueue only `subscriptionId` and have the worker re-fetch the secret from DB at delivery time [engineering-auditor Pass 5] ✅ shipped 2026-06-27 (Pass 5 security/perf/infra batch)
- [x] (P2, S) Validate PAT `expiresAt` is a future date (`@MinDate`) — past dates accepted at creation; token immediately expires and is permanently unusable with no error; add `@MinDate` (or equivalent custom decorator) to `CreateApiTokenDto.expiresAt` [engineering-auditor Pass 5] ✅ shipped 2026-06-27 (Pass 5 security/perf/infra batch)
- [x] (P2, S) Add CSP `add_header` to nginx configmap (Kustomize + Helm) — SPA served from nginx without Content-Security-Policy; Helmet covers API responses but not the web container; add `Content-Security-Policy` directive to both `configmap-web-nginx.yaml` and Helm `configmap.yaml` [engineering-auditor Pass 5] ✅ shipped 2026-06-27 (Pass 5 security/perf/infra batch)
- [x] (P2, S) Add fail-fast Helm guard for Postgres default password `nextlane` — `values.yaml` has `password: nextlane` with a "CHANGE ME" comment but no enforcement (unlike JWT secret which has a template validation block); add a required validation that aborts the Helm release when the password is the default [engineering-auditor Pass 5] ✅ shipped 2026-06-27 (Pass 5 security/perf/infra batch)

_Product P1s — queue after security batch:_

- [x] (P1, S) Wire SMTP email delivery for password reset (nodemailer into existing stub seam) — `MailModule`/`MailService` added (`apps/api/src/mail/`); nodemailer transport when `SMTP_HOST` set; dev-log fallback when absent; production-safe (token never logged in prod without SMTP); all SMTP_* env vars documented in `.env.example`; `MailService.send()` injected into `PasswordResetService.deliverResetLink()`; 8 new `mail.service.spec.ts` tests + updated `password-reset.service.spec.ts`; 255 unit tests green; build clean; dev-log fallback verified on live instance ✅ shipped 2026-06-27 [product-auditor Pass 5]
- [x] (P1, S) Emit `WATCHED_UPDATED` notification on issue field changes — `IssuesService.update` now fans out to watchers (minus the actor) on meaningful field changes (status/assignee/priority/title/dueDate) via batched `createMany` + realtime, with a human-readable message; 11 unit tests — ✅ shipped 2026-06-27 [product-auditor Pass 5]
- [x] (P1, M) Due date on issues — add optional `dueDate DateTime?` to the `Issue` model (Prisma migration + DTO + drawer date-picker); show a due-date chip on the card when set; flag overdue issues in "My Work" with a warning color; add a due-date sort option to the backlog; the most commonly requested primitive in any issue tracker and the one missing from the schema [product-auditor Pass 4, Pass 5] ✅ shipped 2026-06-27 (migration `20260627220000_add_issue_due_date`; drawer date picker with clear + overdue amber; card chip; My Work sort + badge; 5 unit + 8 e2e)

---

## Next (P1 — high value, queue as Ready empties)

- [ ] (P1, L) Tenant-isolation test harness + declarative authz layer — reusable two-workspace matrix asserting every mutating endpoint + socket room rejects cross-tenant access; `@RequireRole`/`@ResourceScope` decorator so isolation is structural, not hand-rolled per service [engineering-auditor]
- [x] (P1, M) Full-text search — Postgres `tsvector` generated column (title+description) + GIN index (migration `20260627230000_issue_full_text_search`); `websearch_to_tsquery` + `ts_rank` in search.service + `findAll` (q≥2; ILIKE fallback for short/key queries); parameterized; 15 unit + 10 e2e — ✅ shipped 2026-06-27. (Structured filter-grammar + persisted SavedView remain tracked at P3 "Saved/shareable views + query DSL".) [engineering-auditor, product-auditor]

---

## Already Done (recent shipments — ticked for reference)

- [x] (P0, M) Authenticate realtime gateway + membership-check subscribe [engineering-auditor]
- [x] (P0, M) Validate tenant ownership of statusId/sprintId/parentId/beforeId/afterId [engineering-auditor]
- [x] (P0, M) Enforce roles (VIEWER read-only; ADMIN-only member mgmt & deletes) [engineering-auditor, product-auditor]
- [x] (P0, S) Fail fast on missing JWT_SECRET + remove bypass paths [engineering-auditor]
- [x] (P1, S) CORS origin allowlist from env [engineering-auditor]
- [x] (P1, S) Fix label-chip contrast in issue drawer [ui-review]
- [x] (P1, S) Drawer as first-class overlay — scroll-lock, focus trap + restore [ui-review]
- [x] (P1, M) Replace native window.prompt/window.confirm with themed modals [ui-review]
- [x] (P1, M) Add a lightweight toast system; surface drawer-patch + mutation errors [ui-review, product-auditor]
- [x] (P0, S) Validate assigneeId is a workspace member on issue create/update [engineering-auditor]
- [x] (P0, S) Scope GET /users to the caller's co-members [engineering-auditor]
- [x] (P1, M) API unit tests for membership.util + assertSameProject + GitHub Actions CI [engineering-auditor]
- [x] (P1, S) Comment edit-in-place + delete in CommentsPanel [product-auditor]
- [x] (P1, S) Activity log: resolve status/user IDs to human names [product-auditor]
- [x] (P1, L) Backlog + sprint planning view [product-auditor, roadmap]
- [x] (P1, M) Labels assign/unassign + filter UI [product-auditor, roadmap]
- [x] (P1, M) Story points field + parent/child picker in issue drawer [product-auditor, roadmap]
- [x] (P1, S) Sprint TOCTOU race: move assertNoOtherActiveSprint inside $transaction + add partial unique index [engineering-auditor]
- [x] (P1, S) Sprint lifecycle: emit sprint.updated realtime event on start/complete [engineering-auditor]
- [x] (P1, M) Global exception filter: map Prisma errors to structured HTTP responses [engineering-auditor]
- [x] (P1, S) Input bounds: @MaxLength on description, @Min/@Max on storyPoints, hex validation on label color [engineering-auditor]
- [x] (P1, S) VIEWER-aware UI: hide/disable edit affordances based on role [product-auditor, engineering-auditor]
- [x] (P1, M) Manage board columns (statuses) from the board UI [user-reported]
- [x] (P1, M) Project Settings page [user-reported]
- [x] (P1, S) Webhook SSRF guard (DNS pre-flight + redirect:manual + socket drain + p-limit fan-out cap) [engineering-auditor, security]
- [x] (P1, S) Composite index for cursor pagination — `@@index([projectId, createdAt, id])` [engineering-auditor]
- [x] (P1, S) helmet() + @nestjs/throttler (100/min global, 10/min auth) [engineering-auditor]
- [x] (P3, S) First-run onboarding + optional sample project + 4-step tour [product-auditor]
- [x] (P1, S) Board type + priority filters [product-auditor Pass 4]
- [x] (P1, M) @mention autocomplete in comment composer [product-auditor Pass 4]
- [x] (P1, M) Password reset (POST /auth/forgot-password + time-limited token + SMTP/dev-log delivery) [product-auditor Pass 4]
- [x] (P3, M) File attachments (uploads) [roadmap Phase 2/3]

---

## Next (P2)

- [x] (P2, S) GET /users/:id authorization — scope to co-members [engineering-auditor]
- [x] (P2, M) Replace assertNoParentCycle sequential waterfall with single recursive CTE [engineering-auditor Pass 3, Pass 4]
- [x] (P2, M) Cursor pagination for issue list [engineering-auditor]
- [x] (P2, M) Transactional move + rank-collision rebalance [engineering-auditor]
- [x] (P2, S) Fix Dockerfile --no-frozen-lockfile → --frozen-lockfile [engineering-auditor]
- [x] (P2, M) Command palette (Cmd-K) navigation & actions [product-auditor]
- [x] (P2, S) Inline issue creation in backlog (ghost row, type-and-Enter) [product-auditor]
- [x] (P2, M) Plugin/webhook event system (HMAC-signed outbound POST on issue.* + sprint.* events) [engineering-auditor, product-auditor]
- [x] (P2, M) Observability baseline (pino structured logs, requestId, /health enrichment, OTel Prisma traces) — nestjs-pino shipped; requestId + OTel remain [engineering-auditor Pass 4]
- [x] (P2, M) Redis-backed webhook delivery queue with retries / BullMQ [engineering-auditor Pass 4]
- [x] (P2, S) Wire Socket.io Redis adapter [engineering-auditor Pass 4]
- [x] (P2, S) Add take cap to board and roadmap endpoints (take: 500 + hasMore flag) [engineering-auditor Pass 4]
- [x] (P2, S) useProjectIssues pagination waterfall — partial fix (limit=200) [engineering-auditor Pass 4]
- [x] (P2, S) Fix remaining e2e specs using DEMO user for mutating flows [qa-review Pass 4]
- [x] (P2, M) Password reset back-end [product-auditor, engineering-auditor]
- [x] (P2, L) Roadmap / timeline view (epics + sprints as bars) [product-auditor]
- [x] (P2, M) Wire the Playwright e2e suite into CI [hardening, roadmap]
- [ ] (P2, M) Magic-byte MIME validation using `file-type` package on upload — client Content-Type is fully controllable; malicious files stored with mismatched MIME; read first 16 bytes after multer writes to tmpdir and compare against known magic signatures using `file-type` npm package [engineering-auditor Pass 5]
- [x] (P2, S) PAT authentication in WebSocket gateway handshake — `nlp_` tokens rejected at socket handshake; automation scripts using PATs cannot subscribe to project realtime events; check for `nlp_` prefix in `handleConnection` and validate via `ApiTokensService.validateRawToken` [engineering-auditor Pass 5] ✅ shipped 2026-06-27
- [ ] (P2, M) PAT token scope model + `@RequireScope` decorator — PATs currently carry full user permissions; extend PAT model with optional `scopes` string array enforced at route level; enables minimal-privilege CI tokens [engineering-auditor Pass 5]
- [x] (P2, M) Public read-only project share link — `ShareToken` model (SHA-256 hashed `nls_` token) + `GET /public/board/:token` (unauthenticated, rate-limited) + ADMIN mint/list/revoke at `/projects/:id/share-tokens` + `/share/:token` standalone read-only board view (no DnD, no create, no drawer; read-only banner); 17 unit tests + 14 e2e (desktop + mobile) — ✅ shipped 2026-06-27 (migration `20260627235000_add_share_token`) [product-auditor]
- [ ] (P2, S) Fix stale socket token after re-auth — getSocket() captures the token once at init; when refresh tokens land the socket will carry a stale credential until page reload [engineering-auditor]
- [ ] (P2, S) Inline card status transition (right-click / keyboard shortcut) — tiny context menu on the card showing 2–4 statuses; eliminates drawer round-trip for status changes [product-auditor]
- [x] (P2, M) Live board presence indicators (per-project viewer avatars via WebSocket) — `RealtimeGateway` maintains in-memory presence map; `presence.update` event emitted on subscribe/unsubscribe/disconnect; `PresenceAvatars` component (stacked avatars, +N overflow, aria-label, tooltip); `usePresence` hook (self-exclusion, cleanup unsubscribe); 7 unit tests + 6 e2e (desktop + mobile) — ✅ shipped 2026-06-27 [engineering-auditor, product-auditor Pass 5]
- [ ] (P2, S) Board-overview prefetch endpoint + stale-while-revalidate caching — collapses 4 sequential requests into 1 on first load [engineering-auditor]
- [ ] (P2, M) Slim planning-view endpoint (or virtual scroll) to avoid all-pages waterfall — full elimination: add `GET /projects/:id/issues/planning` with slim projection (id, title, type, priority, statusId, sprintId, rank — no description, no labels, no comment count) [engineering-auditor Pass 4, Pass 5]
- [ ] (P2, M) Batch notifyComment inserts (createMany) + rebalanceAndPlace (executeRaw batch UPDATE) — serial N inserts per watcher; serial N updates in rebalance tx [engineering-auditor Pass 4, Pass 5]
- [x] (P2, M) Markdown rendering in issue descriptions and comments (marked/remark preview pane) — plain textarea signals immaturity to developers; no schema change; purely UI enhancement [product-auditor Pass 5] — ✅ shipped 2026-06-27: `marked` + `DOMPurify`; `MarkdownRenderer` component; description view/edit toggle; comment body rendered; XSS sanitized; @mention tokens survive; 10 e2e (desktop+mobile)
- [ ] (P2, S) Theme tokens for issueMeta hardcoded hex; create-issue modal single-column on mobile (grid-cols-1 sm:grid-cols-2) [ui-review]
- [ ] (P2, S) Extract shared InlineError/FormError (4 duplicated banners) + drawer title aria-label + min 40px touch tap targets [ui-review]
- [x] (P2, S) Attachment admin-delete UX — `AttachmentsPanel` shows the delete button to all editors but a project ADMIN who tries to delete another user's file gets a 403 toast; pass current user's role to `AttachmentRow` and set `canDelete` to `true` when `editable && (isUploader || isAdmin)` [product-auditor Pass 5] — ✅ shipped 2026-06-27: `viewerRole` prop propagated page→drawer→panel; ADMIN sees delete on any attachment; VIEWER/non-uploader MEMBER does not; 4 e2e (desktop+mobile)
- [ ] (P2, S) Webhook signing key rotation endpoint — no rotation path without deleting and recreating subscription; add `POST /projects/:id/webhooks/:wid/rotate-secret` [engineering-auditor Pass 5]
- [ ] (P2, M) DB-level time-series reports: throughput, cycle time, age distribution — once generate_series aggregation is in place, additional report types are marginal cost; high value for team health visibility [engineering-auditor Pass 5]
- [x] (P2, S) Add `removeMember` UI in workspace member management — `useRemoveMember` hook (invalidates members query); `WorkspaceMembersPage` at `/workspaces/:id/members` with sorted member list, ADMIN-only Remove button (hidden for self + non-ADMINs), ConfirmDialog guard, server-error toast; Members nav button on dashboard (ADMIN-only); workspace sub-nav (Members / Audit log); 11 desktop + 11 mobile e2e — ✅ shipped 2026-06-27 [product-auditor]
- [x] (P2, S) Add e2e spec for audit log — `audit-log.spec.ts`: ADMIN performs audited action (API token create + member add/remove), confirms events appear in table; non-admin VIEWER/MEMBER: nav button hidden + direct-route shows access-denied; member management UI tests (Remove button visibility, remove flow, role guard); 11 desktop + 11 mobile tests — ✅ shipped 2026-06-27 [test-infra]

---

## Later (P3)

- [x] (P3, M) REST API tokens (PATs) — shipped 2026-06-27 [roadmap]
- [x] (P3, M) Workspace audit log — shipped 2026-06-27 [roadmap]
- [x] (P3, S) Label rename / edit — shipped 2026-06-27 [product-auditor]
- [x] (P3, S) VITE_API_URL is baked at build-time — shipped 2026-06-27 [qa-review Pass 4, roadmap]
- [x] (P3, M) "Team pulse" home dashboard — shipped 2026-06-27 [product-auditor Pass 4]
- [x] (P3, L) Keyboard triage mode — shipped 2026-06-27 [product-auditor Pass 4]
- [x] (P3, M) Structured request logging (pino/nestjs-pino) + enriched /health + optional OTel export — nestjs-pino shipped 2026-06-27; enriched /health + OTel remain as follow-ups [engineering-auditor Pass 4]
- [x] (P3, S) Scrub trademarked category phrase from seed data [ui-review]
- [ ] (P3, M) Per-project "Definition of Done" checklist — ADMIN configures a per-project checklist (JSON array on Project model) surfaced as a blocking prompt when an issue is moved to a DONE-category status [product-auditor Pass 4]
- [ ] (P3, L) Automation rules engine (trigger → action: status/assignment/label) — flagship differentiator for self-hosted; depends on webhook system; ActivityLog is natural event source [product-auditor, roadmap]
- [ ] (P3, L) Saved/shareable views + query DSL (JQL-like filter grammar) — the saved-filter pattern teams live in; depends on full-text search + structured filters (P2) [product-auditor, engineering-auditor, roadmap]
- [ ] (P3, M) Custom fields (typed, JSONB-backed) [roadmap]
- [ ] (P3, M) SMTP email notification delivery for all notifications (opt-in per user; sendgrid/SMTP env config) — in-app only today; async notifications for users not logged in; password reset SMTP is the first slice [product-auditor Pass 4, Pass 5]
- [ ] (P3, L) JWT migration to httpOnly cookie + POST /auth/refresh (short-lived access tokens) — token in localStorage is XSS-extractable; cookie migration + short-lived access tokens is the durable fix; helmet CSP mitigates the XSS vector adequately for now; revisit when a rich-text editor lands [engineering-auditor Pass 4]
- [ ] (P3, M) Sprint retrospective panel (What went well / improve / actions — JSONB on Sprint, retro badge on velocity chart) — keeps sprint story in one place; natural extension of sprint lifecycle [product-auditor Pass 5]
- [ ] (P3, M) Issue templates per project (JSONB on Project; template picker in create-issue modal) — reduces create-issue friction; improves data quality [product-auditor Pass 5]
- [ ] (P3, L) Time tracking / worklogs; CSV import + tracker importers; SSO/OIDC [roadmap]
- [ ] (P3, S) Optional metrics endpoint + `ServiceMonitor` + OTLP traces (builds on pino structured logging) for operator-grade observability in-cluster [engineering-auditor]

## Cloud-native / Kubernetes (post-v1 epic — ROADMAP Phase 4)

Make Next Lane deployable on Kubernetes with HA + autoscaling, keeping the
single-host Compose path for small installs. Sequenced so single-replica Helm
can ship first; multi-replica HA depends on the Redis items below.

- [x] (P3, S) Web runtime config for `VITE_API_URL` (+ public config) — shipped 2026-06-27 [roadmap, qa]
- [x] (P3, M) Socket.io Redis adapter — shipped 2026-06-27 [engineering-auditor]
- [x] (P3, M) Redis-backed webhook delivery queue (BullMQ) — shipped 2026-06-27 [engineering-auditor Pass 4]
- [x] (P3, M) Schema migrations as a Helm pre-upgrade Job — shipped 2026-06-27 [roadmap]
- [x] (P3, L) Helm chart `deploy/helm/next-lane` — shipped 2026-06-27 [roadmap]
- [x] (P3, S) K8s Secret strategy — shipped 2026-06-27 [roadmap]
- [x] (P3, M) Kustomize base + overlays as a Helm alternative — shipped 2026-06-27 [roadmap]
- [x] (P3, S) `docs/DEPLOY-KUBERNETES.md` — shipped 2026-06-27 [roadmap]
- [x] (P3, M) Publish `api` + `web` container images to GHCR via CI — shipped 2026-06-27 [roadmap]
- [x] (P2, M) Wire the Playwright e2e suite into CI — shipped 2026-06-27 [hardening, roadmap]
- [ ] (P3, S) Optional metrics endpoint + `ServiceMonitor` + OTLP traces for operator-grade observability in-cluster [engineering-auditor]

---

## Changelog
- 2026-06-27 — Live board presence indicators (P2, M): per-project in-memory presence map in gateway; `presence.update` socket event; `PresenceAvatars` component + `usePresence` hook; self-excluded from viewer list; 7 unit + 6 e2e (desktop + mobile) green; 276 unit tests total.
- 2026-06-27 — SMTP email delivery for password reset (P1, S): `MailModule`/`MailService` (nodemailer); real SMTP when `SMTP_HOST` set; dev-log fallback when absent; production-safe; SMTP_* env vars documented in `.env.example`; 255 unit tests green.
- 2026-06-27 (Pass 5 groom) — Security hardening cluster + product P1s + deferrals captured.
  - **In-flight (current build batch, mark done when confirmed):** plaintext token log guard (P1, S); SVG-XSS from ALLOWED_MIME_TYPES (P1, S); CFD/burndown unbounded queries rewrite to generate_series (P1, M); null-file upload guard (P2, S); webhook secret out of BullMQ job body (P2, S); PAT expiresAt past-date validation (P2, S); nginx CSP header (P2, S); Helm Postgres fail-fast guard (P2, S). All confirmed as in-flight by engineering-auditor Pass 5; keeping as open items until build agent ticks them.
  - **Added to Ready (product P1s):** SMTP email delivery wiring for password reset (P1, S); WATCHED_UPDATED notification emission (P1, S); due date on issues (P1, M). These are the three highest-trust product gaps per product-auditor Pass 5.
  - **Moved to Next (P2, genuinely open):** magic-byte MIME validation (P2, M); PAT at WS handshake (P2, S); PAT scopes + @RequireScope (P2, M); webhook signing key rotation (P2, S); DB-level time-series report types (P2, M); attachment admin-delete UX (P2, S — was P2 in Pass 5 ingest); markdown rendering (P2, M); batch notifyComment + rebalanceAndPlace (carry-forward); slim planning-view endpoint (carry-forward); public share link (carry-forward); live presence indicators (carry-forward).
  - **Captured known deferrals:** audit log e2e spec (P2, S); removeMember UI (P2, S). These are gaps confirmed as "exists at API, not yet surfaced in UI/test" — important to track, not yet blocking.
  - **Ticked done [x]:** attachments (P3, M — shipped 2026-06-27); label rename (P3, S — shipped 2026-06-27); Team Pulse (P3, M); keyboard triage (P3, L); PATs (P3, M); workspace audit log (P3, M); pino structured logging (P3, M — partial, enriched /health + OTel remain); GHCR image CI (P3, M); e2e in CI (P2, M); board/roadmap result caps (P2, S); assertNoParentCycle CTE (P2, M); Redis adapter + BullMQ queue (P2, M+S); Helm/Kustomize/DEPLOY-KUBERNETES.md (P3, L+M+S).
  - **Pruned:** removed stale "Attachments (uploads volume)" P3 placeholder — fully shipped. Removed "Password reset back-end P2 duplicate" — superseded by shipped P1 item.
  - **ROADMAP reconciliation:** Phase 2 fully done (CFD ticked); Phase 3 in progress; Phase 4 Kubernetes packaging 🚧 (Helm/Kustomize/GHCR CI all shipped; observability hooks remain). "Current focus" updated in ROADMAP to reflect the post-Pass-5 security hardening sprint.
- 2026-06-27 — CI/CD pipelines (P3, M + P2, M): GHCR image publish + Playwright e2e in CI.
- 2026-06-27 — Kubernetes packaging (P3, L+M+S×4): shipped the Phase 4 deploy story under `deploy/`.
- 2026-06-27 — Web runtime config (P3, S): `VITE_API_URL` no longer baked into the web bundle at build time.
- 2026-06-27 — Workspace audit log (P3, M).
- 2026-06-27 — Personal API tokens / PATs (P3, M).
- 2026-06-27 — Team Pulse dashboard (P3, M).
- 2026-06-27 — Keyboard triage mode (P3, L).
- 2026-06-27 — File attachments (P3, M).
- 2026-06-27 — Label rename/edit (P3, S).
- 2026-06-27 — CFD report (Phase 2 remaining).
- 2026-06-27 — BullMQ + Socket.io Redis adapter (P2, M+S).
- 2026-06-27 — nestjs-pino structured logging (P3, M — partial).
- 2026-06-27 — UX/a11y polish pass (P1, S — board toolbar overflow-x-auto, MentionComposer no-results, password min-length alignment, aria-haspopup, OnboardingPanel SVG icons, MyWorkPage EmptyState, autoFocus auth forms).
- 2026-06-27 — assertNoParentCycle recursive CTE (P2, M).
- 2026-06-27 — Board/roadmap result caps 500 (P2, S).
- 2026-06-27 — e2e test isolation hygiene (P2, S).
- 2026-06-27 — Board type + priority filters (P1, S).
- 2026-06-27 — @mention autocomplete / MentionComposer (P1, M).
- 2026-06-27 — Password reset end-to-end (P1, M).
- 2026-06-27 (Pass 4 groom) — Ingested Pass 4 audits; promoted board filters, @mention, password reset to P1 Ready; promoted Redis queue/adapter to P2.
- 2026-06-27 — Security + scale hardening: SSRF guard, pagination index, helmet(), throttler.
- 2026-06-27 — First-run onboarding (P3, S — v1.0 criterion ticked).
- 2026-06-26 (Pass 3 groom) — Ingested Pass 3 audits.
- 2026-06-26 (Pass 2 groom) — Ingested Pass 2 audits.
- 2026-06-26 (Pass 1 groom) — Initial seeding from Pass 1 audits + UI review.
- (initial) Seeded from UI review + roadmap.
