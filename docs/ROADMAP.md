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
- ✅ Notifications center page (`/notifications`) — full history route beyond the bell dropdown: lists up to 50 most-recent (server cap), client-side type filter pills with counts, bulk mark-all-read, per-row deep-link + mark-read; reachable from a "See all notifications" link in the bell; Dispatch tokens, accessible list/radio semantics, mobile-overflow clipped at root; 3 e2e green (2026-06-28)
- ✅ Configurable workflow transitions UI — `WorkflowSection` in Settings (enforcement toggle, transition graph grouped by from-status, add/edit/delete modal with gate editor, 409/422 toasts, 422 graceful surfacing in all move/status controls; shipped 2026-06-28)

## Phase 3 — Power features ✅ (complete)
- ✅ Roadmap / timeline (epics + sprints as bars, progress, today marker)
- ✅ Webhooks (HMAC-signed outbound on issue/sprint events + delivery log + Settings UI + SSRF guard + BullMQ queue)
- ✅ Command palette (Cmd-K) + cross-project search
- ✅ "My Work" personal dashboard
- ✅ CI pipeline (GitHub Actions) + API unit-test suite (`ci.yml`'s `docker-build` job now also runs a config-parity smoke test — `scripts/smoke-config-parity.sh` — before the image build; see Hardening Night entry below)
- ✅ Cursor pagination for large lists (keyset on `createdAt,id`; `GET /issues` → `{ items, nextCursor }`)
- ✅ Security hardening pass (P1+P2): webhook SSRF guard (DNS pre-flight + redirect:manual + socket drain + fan-out cap), composite pagination index `@@index([projectId,createdAt,id])` + migration, `helmet()` security headers, global throttler (100 req/min) + stricter auth throttle (10 req/min), `WEBHOOK_ALLOW_PRIVATE` opt-out for self-hosters
- ✅ Security hardening Pass 5 (P1+P2): password-reset token no longer logged in production; SVG upload XSS vector removed (image/svg+xml removed from allowlist; legacy SVGs served as octet-stream); magic-byte MIME validation via file-type@16; null-file guard; PAT expiresAt past-date rejected; webhook HMAC secret removed from Redis job body (worker re-fetches from DB); 6 new unit tests; `file-type@16` dep added (2026-06-27)
- ✅ `assertNoParentCycle` replaced with atomic recursive CTE (`WITH RECURSIVE` via `$queryRaw` inside `$transaction`; TOCTOU-safe; O(1) round-trips; 100-hop depth cap; 6 new unit tests)
- ✅ Engineering-audit Pass-7 hardening (2026-06-28): (P1) `personalAnalytics` scoped to workspaces user is a member of — cross-workspace issue leak closed (`project.workspace.memberships: { some: { userId } }` predicate added to all user-issue queries); (P2) `promoteCard` idempotency guard — double-call now throws `BadRequestException('Card already promoted')` before creating a second Issue; (P2 perf) `AutomationRun` serial inserts refactored to batch `createMany` — N round-trips → 1 per event evaluation, audit log semantics unchanged; (P2 perf) `projectAnalytics` split into two queries (workload keeps full scan; flow chart uses window-scoped `createdAt >= wStart` query) + composite index `ActivityLog(field, to, createdAt)` (migration `20260628080000_add_activitylog_status_index`) for the `completionMap` raw query. 4 new regression tests (tenant isolation × 2, double-promote × 1, batch-insert × 1); all 635 unit tests green.
- ✅ Engineering-audit Pass-8 hardening (2026-06-28): (P1) logo upload magic-byte validation — `workspaces.service.ts` `uploadLogo` now content-sniffs uploaded files via `file-type` library before accepting them; mismatch between declared and actual MIME type or non-allowlisted content type is rejected with 400 + file unlinked; 4 new unit tests. (P1) tenant-isolation matrix extended to >45 rows — `tenant-isolation.integration.spec.ts` now covers workflow REST (GET/PATCH/transitions), automations CRUD + runs, analytics, CSV export, and workspace logo DELETE. (P2) automation rule write operations (`create`/`update`/`delete`) elevated from `Role.MEMBER` to `Role.ADMIN` — aligned with webhooks; reads stay at MEMBER; 5 new tests. (P2) automation TRANSITION/ADD_LABEL cross-project parameter validation — `validateActionParamsDeep()` DB-lookup verifies `statusId`/`labelId` belong to the rule's project at save time; 6 new tests. (P2) analytics `days` query param validated via `AnalyticsQueryDto` (DTO: `@IsOptional @IsInt @Min(1) @Max(366)` with `@Type(()=>Number)` transform); replaces raw `Number(daysStr)`; 9 DTO unit tests. (P2) `bulkUpdate` workflow pre-load — one `isEnforcementEnabled` DB call per batch instead of per-issue; `MutationOpts.workflowEnforced` hint propagated to `enforceTransition`; 4 new tests. (P2 perf) `projectAnalytics` workload aggregation replaced with SQL `GROUP BY "assigneeId"` via `$queryRaw` — eliminates O(N) JS materialisation; 790 unit tests green; build clean.
- ✅ Engineering-audit Pass-9 hardening (2026-06-30): (P1) WebSocket CORS allowlist — `@WebSocketGateway({ cors: true })` replaced with a module-level `_wsCorsOption` variable that mirrors `main.ts` CORS_ORIGINS parsing: when `CORS_ORIGINS` is set, the gateway uses `{ origin: string[], credentials: true }`; when unset it falls back to `true` (wide-open, safe for local dev only). (P1) `WorkflowTransition` `toStatusId` index — `@@index([projectId, toStatusId])` added to schema.prisma (migration `20260630000000_workflow_transition_to_status_index`); supports "what transitions lead INTO a specific status for a project?" lookups. (P2) `exportCsv` hard row cap — `IssuesService.CSV_ROW_CAP = 10_000`; uses `take: CAP + 1` trick to detect truncation without a separate COUNT query; truncated responses set `X-Next-Lane-Truncated: true` header on the HTTP response (controller side); service returns `{ csv, projectKey, truncated }`. (P2) Password `@MinLength` consistency — `RegisterDto.password` raised from `@MinLength(6)` to `@MinLength(8)`, matching `ResetPasswordDto.newPassword` (DTO layer, no service change). (P2) WorkLogsService membership refactor — `update()` and `remove()` now call `assertProjectMember` (from `common/membership.util`) to fetch both the project membership and `workspaceId` in one step; the bespoke private `resolveWorkspaceId()` helper removed; semantics identical, code simpler. (P2) AUTO_SEED default flip — `docker-entrypoint.sh` default changed from `${AUTO_SEED:-true}` to `${AUTO_SEED:-false}`; `docker-compose.yml` explicitly sets `AUTO_SEED: "true"` so the local/demo stack is unaffected; production deployments that omit the variable no longer auto-seed. (P2) Tenant-isolation matrix extended to >65 rows — `tenant-isolation.integration.spec.ts` gains 19 new matrix rows covering work-logs (GET/POST/PATCH/DELETE), standups (GET/POST), issue-templates (GET/POST/PATCH/DELETE), personal-boards (PATCH/DELETE column), and planning poker (GET/POST sessions, GET/PATCH session by id); provisioning extended with `workLogId`, `pokerSessionId`, `personalColumnId`, `issueTemplateId`; sanity threshold raised to >65; 1306 unit tests green; build clean.
- ✅ **Hardening Night item 1: `@RequireScope` PAT-scope rollout completed** (2026-07-06) — closed the gap flagged in the 2026-07-02 role-override review (`projects.controller.ts`/`workspaces.controller.ts` fully ungated) and expanded the sweep to **every** controller in `apps/api/src/*`: 35 controllers inventoried; the ~30 previously-ungated ones (admin-settings, analytics, api-tokens, attachments, audit, automations, board, checklist, comments, components, custom-fields, dashboards, issue-templates, labels, notifications, personal-boards[promote route only], poker, projects, reports, roadmap, saved-filters, search, share-tokens, sprints, standups, statuses, users, versions, work-logs, workflows, workspaces) now carry `@RequireScope` on every non-exempt route, mirroring `issues.controller.ts`; 6 exempt controllers documented in-code with why (`auth`, `auth/oidc`, `health`, `public`, `me`, and the non-promote routes of `personal-boards` — either `@Public()`/no-`request.user` or purely-personal data with no shared-resource blast radius to restrict). Three new scope pairs added to `PAT_SCOPES` (`packages/shared/src/types.ts`, additive): `workspaces:read`/`workspaces:write` (workspace CRUD/membership + the `users` directory), `admin:read`/`admin:write` (instance SSO/OIDC settings), `tokens:read`/`tokens:write` (closes a self-escalation hole — a scoped-down PAT could previously mint itself a fresh *unrestricted* token via `POST /me/tokens`). `projects:read`/`projects:write` extended in practice (doc comment updated) to cover every project-scoped structural/config resource (boards, statuses, labels, sprints, custom fields, components, versions, workflows, dashboards, automations, poker, standups, saved filters, share tokens, roadmap, reports, project analytics); `issues:read`/`issues:write` extended to checklist/work-logs/attachments/notifications/search/issue-scoped label+version assignment. New data-driven integration suite `pat-scope-rollout.integration.spec.ts` (real HTTP, real `ScopeGuard`, no mocks) asserts, for all 143 newly-gated routes, both a DENY (wrong-scope PAT → 403 with the exact `ScopeGuard` message) and an ALLOW (correctly-scoped PAT never blocked by the guard) — 286 assertions, all green; `tenant-isolation.integration.spec.ts` unaffected (108/108 still BLOCKED); full API unit suite 1808 tests green; shared vitest 146 green; MCP 110 tests / 104 tools green; `tsc --noEmit` clean across api/web/mcp. `apps/web` PAT-creation UI (`ApiTokensSection.tsx`) and the `@next-lane/mcp` README scope table both updated for the 6 new scopes, with an explicit hardening note that some previously-any-scope-works MCP tools (`list_workspaces`, `list_projects`, `list_users`, every report tool) now enforce their matching scope. [founder directive — Hardening Night item 1; role-override review 2026-07-02]
- ✅ **Hardening Night wave 2, task #93 (2026-07-06)** — three audit pass-13 + QA-flagged fixes: (1) **DNS-rebinding TOCTOU closed** in the shared SSRF guard — new `apps/api/src/common/ssrf-safe-fetch.ts` resolves DNS exactly once and PINS the connection to that vetted address via a custom undici `Agent` `connect.lookup` (new direct `undici` dependency), across all three outbound-call families (webhook delivery, `GithubClient`, `GitlabClient`); 15 new tests including a real-socket rebind simulation proving the connection hits the first-vetted address even when a mocked `dns.promises.lookup` would answer a hypothetical second query with a private IP. (2) **`multer` DoS CVEs closed** — root `pnpm.overrides` forces `multer: "^2.2.0"` (closes `@nestjs/platform-express`'s bundled vulnerable transitive copy — the app's own direct dependency was already patched but that wasn't the code path every real upload endpoint runs) and `lodash: "^4.18.0"`; `pnpm audit --prod` 5 high → 0 high; live-verified with a real multipart `curl` round-trip (workspace logo + issue attachment, byte-identical upload/download) against a running API. (3) **Issue-create `$transaction` timeout hardened** — default-status resolution moved out of `IssuesService.createInner`'s transaction (pure read, no atomicity dependency) and explicit `{ timeout: 12_000, maxWait: 12_000 }` set, fixing a QA-observed 500 under 2-worker e2e parallelism ("Transaction already closed... timeout 5000 ms"). API unit 1823/1823 (+15), integration 293/293, shared 146/146, MCP 110/110, `tsc --noEmit` clean everywhere touched. [orchestrator — audit pass 13 Risks 3+4; qa-tester P3 2026-07-06]
- ✅ **Hardening Night frontend batch, task #93 (2026-07-06)** — closed all four `docs/UI-REVIEW.md` 2026-07-06-dated findings: (1) **mobile toast/modal overlap (P1)** — `ui/Toast.tsx`'s viewport bottom-anchors at every breakpoint now instead of pinning `top-0` below `sm:`, where it covered every `Modal`'s header/close button (17+ modal-hosting components affected) for the full 6s error-toast duration on any mutation failure at ≤640px; `ui/Modal.tsx`'s panel is also capped at `max-h-[calc(100dvh-4rem)]` with a sticky header/footer + scrollable body so a tall form's footer can't newly collide with the bottom-pinned toast. (2) **"Merged" PR/MR badge dark-mode break (P1)** — `purple` added to `tailwind.config.js`'s CSS-var-backed `varScale()` palette (matching `:root`/`.dark` values in `index.css`, derived via the same `applyBrandColor.ts` mix-toward-canvas/paper method as every other scale), fixing `IssueCard`/`GithubLinksSection`/`GitlabLinksSection`'s "Merged" badge and the identical-root-cause `WorkspaceAuditLogPage`/`WorkspaceMembersPage` badges with zero per-component changes; contrast verified ≥4.5:1 in both modes. (3) **Dashboard selection shadow state (engineering audit pass 13 Risk 7)** — `DashboardsPage`'s `selectedId` moved from local `useState` to the `?dashboard=<id>` URL search param (mirroring `BoardPage`'s URL-as-source-of-truth filter pattern), so reload/deep-link/share land on the same dashboard; the 6447e76 synchronous-append create fix (new dashboard stays selected) preserved. (4) **P2 quick wins** — `GadgetCard`'s drag handle grew a ~40px mobile touch target (was ~16px); the GitHub/GitLab Development sections' live-status polls now show a spinner while loading instead of nothing. 142 targeted e2e green desktop+mobile (dashboards/board/PR-badge/toast/personal-board/pulse-dashboard/webhooks/components/csv-import/templates/github+gitlab-integration/issue-detail/issue-links suites); `tsc --noEmit` + web build clean; every `data-testid`/`role`/`aria-label` hook preserved. [frontend-qa 2026-07-06 UI review]
- ✅ **Hardening Night item — config-parity CI smoke test (2026-07-06)** — closes the *class* behind the same-night compose env-passthrough fix above (audit pass 13 Risk 1): a future documented `.env.example` var that a deployer sets but that never reaches the `api` container (or a compose-forwarded var nobody documented) now fails CI, not just this one instance. New `scripts/smoke-config-parity.sh` (mirrors `scripts/smoke-web-csp.sh`; bash + docker + jq, no build/containers needed — `docker compose config` only parses + interpolates): parses `.env.example` for both active (`VAR=value`) and commented-optional (`# VAR=value`) declarations, anchored at line-start so prose mentions of a var name are never mistaken for a declaration; renders `docker compose config --format json` with a **distinct sentinel value per documented var** and asserts each round-trips into the rendered `api` service environment — proving real `${VAR}` passthrough, not just key presence — against a small, reviewed, one-reason-per-entry ignore-list (`DATABASE_URL`/`REDIS_URL`/`API_PORT` composed or hardcoded inline; `POSTGRES_*`/`REDIS_PORT`/`WEB_PORT` other services' port mappings; `VITE_API_URL` a web build ARG; `UPLOADS_DIR` intentionally container-internal; `RESET_BASE_URL` a dead fallback superseded by `WEB_BASE_URL`; `OTEL_*` a documented future/stub with no reading code yet). Reverse direction checked too — every `${VAR}` the api stanza reads must be documented — which caught 5 real, live gaps at HEAD (`AUTO_SEED`, `WEB_BASE_URL`, `GITLAB_TOKEN_ENCRYPTION_KEY`, `GITLAB_WEBHOOK_BASE_URL`, `OIDC_CONFIG_ENCRYPTION_KEY`), fixed in `.env.example` the same commit (also closing the standalone `GITLAB_TOKEN_ENCRYPTION_KEY` doc gap, Pass 13 Risk 5) so the check is green, not silenced. Wired as an early step in `ci.yml`'s existing `docker-build` job, before the slower image build. Both-ways-proven: green at HEAD; locally reverting `SMTP_HOST`'s passthrough line reproduced the exact original bug and the script correctly failed, then reverted. `shellcheck`-clean. [engineering-auditor Pass 13 Ideation #2]
- ✅ **Engineering-audit Pass-14 hardening (2026-07-10)** — closed the audit's P0 live-reproduced finding: the combined `GET /search` (gated `issues:read`) also returned knowledge-base **page** hits, leaking wiki content to a PAT scoped only `issues:read` even though `/pages/*` and `/search/pages` correctly 403 it. Fix: `SearchController` now computes `canReadPages(user)` (JWT sessions + unscoped PATs = full access; a scoped PAT must explicitly hold `pages:read`) and passes an `includePages` flag into `SearchService.search`, which suppresses the pages group (never even queries it) when false. **Live-reproduced closed** end-to-end against a real API+Postgres: an `issues:read`-only PAT now gets `pages:[]` from `/search` (was 1), a `pages:read` PAT still finds the doc via `/search/pages`, and a JWT session still sees pages in `/search` (no regression). **Root cause the audit flagged too:** the three DB-backed safety nets (`tenant-isolation`, `pat-scope-rollout`, `pat-scope-coverage`) never ran in any CI workflow — a correct guard that never executes catches nothing — and `pat-scope-coverage` was in fact red at HEAD (4 unrostered page routes: `/search/pages`, `/pages/:id/links`, `/pages/:id/issues`, `/issues/:id/pages`). Added those 4 rows to `pat-scope-matrix.fixture.ts` and wired a new `integration-test` job into `ci.yml` (Postgres 16 service + `prisma migrate deploy` + `pnpm --filter @next-lane/api test:isolation`) so all three specs now gate every push/PR. **Also (P2):** `syncWikiLinks`/`syncIssueLinks` capped their per-save title/issue-number resolution at `MAX_OUTGOING_LINKS`/`MAX_LINKED_ISSUES` (was unbounded from up to 256 KiB of page content — inconsistent with the file's own `MAX_*` read caps). +1 regression unit test (search suppresses pages when `includePages=false`); API unit 2051/2051, integration 431/431 (3 suites), `tsc --noEmit` clean. **Follow-up (2026-07-10, same audit): two P3s closed** — (Risk 4) page-delete's child-count guard + `orphanedBacklinks` count + delete now run in one `$transaction` (was a TOCTOU on the advisory count); (Risk 3) the stale `pages:read`/`pages:write` "reserved, no routes exist yet" doc comment in `packages/shared/src/types.ts` corrected to point at `pat-scope-matrix.fixture.ts` as the live route↔scope source of truth. [engineering-auditor Pass 14]
- ✅ **Pages P1 UX fixes (2026-07-10, product-auditor Pass 13)** — closed the three first-ten-minutes wiki blockers the hands-on product audit found. **(1) Silent draft loss:** editing a page then navigating away or reloading discarded the draft with no warning; new `unsavedChangesGuard.tsx` (app-wide provider wrapping the router) adds a native `beforeunload` guard for reload/tab-close plus a themed "Discard unsaved changes?" confirm on every in-app nav trigger adjacent to Pages (tree/backlink/graph clicks, `ProjectNav` tabs + More + Settings, the Cancel button), auto-clearing on save. **(2) Images silently stripped:** `MarkdownRenderer`'s DOMPurify config omitted `img`, so `![](url)` vanished on render — added `img` + `src`/`alt`/`width`/`height`/`referrerpolicy` to the allowlist, an `afterSanitizeAttributes` hook restricting `img[src]` to `http(s)`/`data:image/` and forcing `referrerpolicy=no-referrer`, and widened the prod CSP `img-src 'self' data: blob:` → `… https:` across `nginx.conf` + the Helm/Kustomize configmaps + the CSP artifact test (external wiki images are expected, Confluence/Notion-style; a future page-attachment-upload path could tighten this back). **(3) One-directional page↔issue linking:** nothing consumed the already-shipped `GET /pages/:id/issues`, so a page never showed which issues referenced it — added a "Linked issues" section (new `PageLinkedIssuesSection.tsx` + `usePageIssues` hook) mirroring the issue drawer's "Linked pages", each row deep-linking to the issue. Gates: web `tsc` + build clean; 5 new e2e (`pages-p1-fixes.spec.ts`) × desktop+mobile = 10/10 (independently re-run by the orchestrator against the fresh build), pages/adversarial/CSP regression suites green. Known follow-ups filed: real browser back/forward (`popstate`) not intercepted; a pre-existing `automation.spec.ts` "reach Automation tab" flake (More-menu close-on-navigate timing, present on baseline, unrelated). [product-auditor 2026-07-10 Pass 13]
- ✅ **Knowledge graph revamp — full-page "observatory" (2026-07-20, founder directive "revamp the graph… distinct full-page feel… better than Obsidian")** — replaced the boxed 420–560px graph panel with an immersive, edge-to-edge canvas (fills the viewport below the header) and made it genuinely navigable, the axis Obsidian's graph is weakest on. **Backend groundwork (078aa8e):** `PageGraphNode` enriched with `projectId`/`projectKey`/`updatedAt`. **Frontend (`apps/web/src/components/pages/graph/**`, design-skill-led):** an "observatory" identity — atmospheric token-derived canvas (theme-aware light/dark) + radial vignette + faint star-field, thin tapered filament edges; **signature moment**: hovering/focusing a node ignites its neighborhood (neighbors brighten to the signal accent, a pulse travels the filaments, everything else recedes; skipped under `prefers-reduced-motion`). **Meaning encoded in nodes:** color-by-project in the workspace graph (deterministic hue per project + a legend; single-accent per-project), size-by-authority (inbound-link count), stale pages (`updatedAt` > 30d) dimmed. **Navigable:** search-to-fly (`GraphSearch`), focus/orbit + a side rail of the node's backlinks/out-links with an explicit "Open page" (`GraphSideRail`, reuses Backlinks/OutgoingLinks panels), a corner minimap with click-to-jump (`GraphMinimap`, ≥8 nodes), and keyboard traversal (arrow keys → geometrically-closest neighbor, Enter opens). Node clicks now route off `PageGraphNode.projectId` directly — the old `fetchPageScope` round trip is gone. A render-time `clampCenter` guarantees a node box can't clip past the canvas edge. Gates: web tsc + build clean; new `knowledge-graph-observatory.spec.ts` (14×2) + graph regression (`pages`/`workspace-docs`/`pages-cross-project-links`/`pages-adversarial`/`pages-qa-extra`) = orchestrator-verified 32/32 on the run above (50/50 across all six graph specs per the builder), desktop+mobile. **Explicit founder checkpoint held, NOT built:** overlaying issues/people on the graph (the docs↔work layer) — the biggest, most opinionated leap, awaiting founder go-ahead. [founder directive 2026-07-20]
- ✅ **Docs UX polish — caret-anchored wiki-link picker + IA/naming consolidation (2026-07-20, founder feedback)** — two founder-reported knowledge-base papercuts. **(1) Wiki-link autocomplete followed the caret:** the `[[` page-picker was `absolute top-full` (pinned to the bottom of the whole textarea), so in the full-page editor it dropped far below the cursor and the user had to scroll to reach it; new `apps/web/src/lib/textareaCaretCoords.ts` (dependency-free mirror-div caret measurement, CSP-safe) positions the picker at the caret, clamped to the textarea's right edge and flipped to open ABOVE when the caret sits low in the viewport. **(2) Docs IA consolidated:** the knowledge base was reachable from five places under two names ("Pages" for project, "Docs" for workspace) with one entry buried in Workspace settings — unified the visible noun to **"Docs"** everywhere (ProjectNav tab, sidebar project view, command-palette group, project breadcrumb; route paths + `data-testid`s unchanged for deep-link/e2e stability) and **removed the redundant Docs tab from the Workspace settings strip** (docs aren't a setting; the sidebar workspace "Docs" row is now the single entry). Gates: web tsc + build clean; new `wikilink-picker-position.spec.ts` (caret-follow + flip-above) + the rename's e2e (`pages`/`workspace-docs`/`pages-search`/`nav-sidebar`/`pages-p1-fixes`) = 54/54 desktop+mobile, independently re-run by the orchestrator. Follow-ups filed (BACKLOG Later): PageTree's inner "Pages" heading, ApiTokens "Pages (wiki)" scope labels, and a pre-existing `command-palette.spec` aria-label regex mismatch. [founder feedback 2026-07-20; precursor to the graph revamp]
- ✅ UI design elevation — "Slate + Teal-Shift" design system (2026-06-27): deliberate token system replacing generic AI-default indigo; Plus Jakarta Sans Variable (UI) + IBM Plex Mono (issue keys/data, signature element); stone/amber/emerald status-progression arc; refined shadows/radii/animations; `prefers-reduced-motion` respected; all primitives + board + drawer elevated; 24 e2e tests green.
- ✅ UI token-cohesion fix pass (2026-06-28): analytics/reports surfaces fully migrated to Dispatch `ink-*` tokens — `slate-*` replaced in `PersonalAnalyticsPage`, `ProjectAnalyticsPage`, `ReportsPage`; breadcrumbs in `ProjectAnalyticsPage`/`ReportsPage` matched to `AutomationsPage` reference pattern; hand-rolled SVG charts (`FlowChart`, `ThroughputChart`, `VelocityChart`, `BurndownChart`, `CumulativeFlowChart`) migrated from raw hex + `gray-*` to `stroke-ink-*` / `fill-ink-*` class tokens; `CategoryBars` color constants refactored from hex to Tailwind class strings matching the existing `issueMeta` color vocabulary; P2 primitives: `AutomationsPage` rule list `shadow-sm`→`shadow-card`; `ActionParamsEditor` DATE type uses `ui/Input`, CHECKBOX gains `focus-visible:ring`; `AddCardComposer` raw input `focus:ring-*`→`focus-visible:ring-*`; `PromoteCardModal` raw `<select>` replaced with `ui/Select`; `ProjectNav` `<nav>` gains `aria-label="Project navigation"`. Build clean; no testid/role/text changes.
- ✅ ProjectNav mobile-UX redesign (2026-06-28): replaced 10-tab horizontal-scroll with a responsive layout: primary tabs Board/Backlog/Triage/Reports always visible; "More" dropdown (role=menu/menuitem, aria-haspopup, aria-expanded, Escape close, outside-click close, first-item auto-focus) collapses Analytics/Roadmap/Poker/Standup/Automation; Settings pinned right (gear icon + text label hidden on mobile); "More" button adopts cobalt-signal active treatment and shows "More · <Label>" when a collapsed route is live; `data-testid="nav-automation"` preserved on Automation link; all 10 `to` paths and exact labels preserved; `aria-label="Project navigation"` retained; `prefers-reduced-motion` respected via Tailwind motion-reduce utilities; build + tsc clean.
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
- ✅ Issue links / dependencies backend — `IssueLinksModule` (`apps/api/src/issue-links/`): `POST /issues/:id/links` (MEMBER+; inverse-type normalization: BLOCKED_BY→BLOCKS swapped, DUPLICATED_BY→DUPLICATES swapped; self-link 400; duplicate+inverse-duplicate 409; cross-project 404; target resolved by key or id within project); `GET /issues/:id/links` (VIEWER+; perspective-resolved type/label for both source and target sides); `DELETE /issue-links/:linkId` (MEMBER+); `toIssueLinkDto(link, viewerIssueId)` mapper; 32 unit tests (505 total) — links exposed via separate `GET /issues/:id/links` (not embedded in IssueDto to avoid modifying shared package); tsc clean (2026-06-28)
- ✅ Export CSV — `GET /projects/:id/issues.csv?q=<NLQL>` frontend affordance (2026-06-28): `useExportCsv` hook in `src/api/export.ts`; Bearer-auth blob fetch + synthetic anchor download (auth via localStorage JWT, not cookie); "Export CSV" secondary Button with download icon + spinner on BacklogPage toolbar and BoardPage toolbar (near filters); BoardPage passes current `nlqlQuery` as `?q=`; `data-testid="export-csv"` on both; error toast via `useToast`; Dispatch `secondary` Button token; build clean.
- ✅ Query DSL / saved views — shipped as NLQL + saved filters in Phase 5 (2026-06-28)
- ✅ Custom fields (typed, JSONB-backed) — shipped Phase 5 (2026-06-28)
- ✅ Workflow automation rules (trigger → action) — frontend UI shipped 2026-06-28; backend engine shipped 2026-06-28: AutomationEngineService (@OnEvent listeners, NLQL condition evaluation, loop guard, Glass Box AutomationRun logging), AutomationsService CRUD (7 REST endpoints), EventEmitter2 seams on IssuesService.create/update/move + CommentsService.create; 37 unit tests (668 total)
- ✅ Time tracking / worklogs backend (2026-06-29) — `WorkLogsModule` (`apps/api/src/work-logs/`): `GET /issues/:issueId/worklogs` (VIEWER+; ordered workedAt desc), `POST /issues/:issueId/worklogs` (MEMBER+; minutes ≥ 1, userId=current user, optional note+workedAt), `PATCH /worklogs/:id` (author OR project ADMIN; 403 otherwise), `DELETE /worklogs/:id` (author OR project ADMIN; 204); tenant isolation via worklog→issue→project membership chain; `toWorkLogDto` mapper with `toUserDto`; `CreateWorkLogDto`/`UpdateWorkLogDto` DTOs with `@IsInt @Min(1)` on minutes. Issue integration: `originalEstimateMinutes?: number` on `CreateIssueDto` (`@IsInt @Min(0)`); `originalEstimateMinutes?: number | null` on `UpdateIssueDto` (null clears; `ValidateIf` non-null); both persisted in `IssuesService.create`/`update`. Time-spent rollup: `workLogs: { select: { minutes: true } }` added to `listInclude` so mapper emits `timeSpentMinutes` on all list/findOne responses. `WorkLogsModule` wired into `AppModule`. 56 new unit tests (work-logs.service.spec × 28 + work-log.dto.spec × 18 + issues.service.spec estimate+rollup × 10); 1141 total green; `tsc --noEmit` clean.
- ✅ Time tracking frontend (2026-06-29) — `TimeTrackingSection` in `IssueDetailDrawer` main column (between ChecklistSection and CommentsPanel): original estimate inline edit field (accepts friendly duration strings "2h 30m", "90m", "1.5h"; `parseDuration`/`formatDuration` helpers in `src/lib/duration.ts`; saves via existing issue-update mutation `originalEstimateMinutes`; null-clear on empty); `role=progressbar` bar with `aria-valuenow/min/max` showing time-spent vs estimate (danger red token when over-estimate); log-work form (duration input + optional note; per-keystroke, Enter or button submits; inline error < 1 min); worklog list rows with author avatar/name, duration badge, note, relative time, delete button with `ConfirmDialog` guard (author or ADMIN); VIEWER-read-only (add/delete hidden); `apps/web/src/api/worklogs.ts` (`useWorkLogs`, `useAddWorkLog`, `useUpdateWorkLog`, `useDeleteWorkLog`; `qk.worklogs(issueId)` key); `UpdateIssueInput.patch.originalEstimateMinutes` added to issues API; 3 e2e tests (desktop add+estimate+progress+delete, seeded list, mobile no-overflow — all green); `tsc --noEmit` + build clean.
- ✅ Email (SMTP) notifications for all event types (beyond password reset) — `emailNotifications` opt-in field on User (migration `20260628110000_add_user_email_notifications`); `PATCH /auth/me` profile-update endpoint; `sendEmailToRecipients` fan-out in `NotificationsService` (ASSIGNED / MENTIONED / COMMENTED / WATCHED_UPDATED); issue deep-link URL in body; fire-and-forget (never blocks in-app flow); error-resilient (`catch` per send + outer try/catch); 38 new unit tests (UpdateProfileDto validation × 9, AuthService.updateProfile × 5, email opt-in/out/actor/deep-link/failure × 5, existing suite extended with MailService mock); 809 tests total green. Frontend: `NotificationPreferencesSection` opt-in toggle on `/me/settings` (role=switch, persists via `PATCH /auth/me`, optimistic display gated on server confirmation; ProfileSettingsPage elevated to Dispatch `ink-*` tokens); `useUpdateProfile` hook primes the `me` cache + localStorage so the change survives reload; 2 e2e (desktop toggle-persists-across-reload + mobile no-overflow). Live-smoked: assigning an issue emits the dev-mode mail log to the assignee. (2026-06-28)
- ✅ "Team pulse" home dashboard (sprint snapshot, assigned issues, recent activity, projects grid — first-run onboarding preserved; 20 e2e tests desktop+mobile)
- ✅ REST API tokens (PATs: `nlp_` prefix, SHA-256 hash stored, create/list/revoke endpoints, JWT guard extension, profile settings UI, 14 e2e + 22 unit tests)
- ✅ PAT authentication at WebSocket handshake — `nlp_` PATs accepted in `RealtimeGateway.handleConnection` via `ApiTokensService.validateRawToken()`; revoked/expired PATs disconnected; JWT path unchanged; `ApiTokensModule` imported into `RealtimeModule`; 11 new unit tests (252 total) (2026-06-27)
- ✅ Live board presence indicators — per-project in-memory presence map in `RealtimeGateway`; `presence.update` event emitted on subscribe/unsubscribe/disconnect; stacked `PresenceAvatars` component (up to 4 visible + overflow badge, aria-label, tooltip); `usePresence` hook with self-exclusion + cleanup unsubscribe; 7 new unit tests; 6 e2e tests (desktop + mobile, socket-level + UI) — all green (2026-06-27)
- ✅ Audit log (workspace-scoped, ADMIN-only, cursor-paginated; AuditEvent model + migration; AuditService.record() best-effort fire-and-forget; events on membership add/remove/role-change, project create/archive, webhook CRUD, API-token create/revoke; GET /workspaces/:id/audit-log; WorkspaceAuditLogPage with paginated table + load-more; 11 unit tests + shared AuditEventDto/PaginatedAuditEventsDto types — 2026-06-27)
- ✅ Workspace member management UI — `WorkspaceMembersPage` at `/workspaces/:id/members`; `useRemoveMember` mutation (DELETE /workspaces/:id/members/:membershipId, invalidates members query); ADMIN-only Remove button (hidden for self; hidden entirely for MEMBER/VIEWER); ConfirmDialog guard; server error → toast; workspace sub-nav (Members / Audit log tabs); Members nav button on dashboard (ADMIN-only); 11 desktop + 11 mobile e2e — 2026-06-27
- ✅ Audit log e2e — `audit-log.spec.ts`: ADMIN performs audited actions (API token create, member add, member remove via UI) and confirms events appear in table; non-admin (VIEWER + MEMBER) nav buttons hidden; direct-navigate to audit-log shows access-denied; member management UI guards (Remove visible for ADMIN-on-others, hidden for self + non-ADMIN); 11 desktop + 11 mobile tests — 2026-06-27
- ✅ Bulk edit backend — `POST /issues/bulk` (2026-06-28); CSV import + tracker importers shipped in Phase 5 (2026-06-29); SSO/OIDC Phase 1 shipped in Phase 5 (2026-07-02, see below)
- ✅ **VitePress documentation site** (2026-06-28) — `docs-site/` package (`@next-lane/docs`); base `/Next-Lane/`; Dispatch cobalt (`#2563EB`) theme via CSS custom properties; 9 content pages ported from `wiki/`; local search; GitHub Pages deploy workflow (`.github/workflows/docs.yml`); `wiki/` deleted (single source of truth). Site at `https://overcastly-ai.github.io/Next-Lane/`.
- ✅ **Docs site Overcastly v2 re-theme** (2026-06-28) — `docs-site/.vitepress/theme/custom.css` rewritten to Overcastly v2 token system: canvas `#15161a→#1c1d22→#25262c`, ink `#f4f4f1/#b8b9b6/#6f7075`, accent `#4F8BFF`/`#7AA8FF`, hairline borders `rgba(255,255,255,0.08/0.16)`, success `#7BD389`; dotted-grid body background (signature element); pill buttons (`border-radius:999px`); mono-uppercase eyebrows on sidebar group labels, table headers, code-block lang labels, and custom-block titles; accent `h2` bar; `appearance:'dark'` in `config.ts` (dark canonical, toggle still available); SVG logos + favicon updated to `#4F8BFF`; `theme-color` meta updated to `#4F8BFF`; build clean in 4.4s; WCAG-AA maintained (ink-on-charcoal passes; accent `#4F8BFF` on `#15161a` ≈ 4.6:1 AA).
- ✅ **Docs site QA bug-fix pass** (2026-06-28) — P1-A: `markdown-it-task-lists` (v2.1.1) added as devDep; `config.ts` wired `markdown.config` via `createRequire` ESM→CJS interop; Quick Start checklist now renders real `<input type="checkbox">` elements instead of literal `[ ]` text. P1-B: Hero image changed from `home-desktop.png` (login screen) to `board-desktop.png` (Kanban board); alt text corrected; `og:image` updated to match. P1-C: `.vp-doc table` CSS rule changed from `display:table` (no overflow containment) to `display:block; overflow-x:auto` — wide tables on configuration + self-hosting pages now scroll internally instead of pushing the page body wider than the viewport on mobile (390px). P2-C: Light-mode hero heading rule added (`:root:not(.dark) .VPHero .name` resets gradient/text-fill-color so the heading stays in `--vp-c-text-1` ink, not VitePress's default brand-blue). P2-E: Image paths in `index.md` and `guide/features.md` canonicalized from relative `./public/screenshots/` / `../public/screenshots/` to root-relative `/screenshots/` (idiomatic VitePress convention). P2-A: Long kubectl+python3 command in `troubleshooting.md` split to multi-line form to reduce horizontal scroll on mobile. Build clean in 4.34s.
- ✅ **Docs site spacing/rhythm polish pass** (2026-06-28) — Playwright-measured audit across all 5 pages (home, quick-start, configuration, features, faq) at 1320×900 and 390×844. Problems found and fixed in `custom.css`: (1) 8-point spacing scale tokens (`--sp-1`…`--sp-9`, 8–96px) introduced as the single source of truth for all spacing decisions; (2) hero → features gap was 0px — `VPFeatures` now has `padding-block: 64px` (tablet: 48px, mobile: 40px); (3) feature card box padding raised to `32px 24px 24px` (was flat 24px); (4) VitePress `margin: -8px / padding: 8px` negative-margin gutter pattern documented and respected — `gap` overrides on `.items` and `.actions` removed (they stacked on the negative margin and caused the 4th card to wrap onto a second row); (5) code block `<pre>` got explicit `24px` horizontal + vertical padding (was 0px left/right in some contexts); (6) code blocks gained `margin-block: 32px` (was 16px); (7) `div[class*='language-']` lang label repositioned to `top: 8px; right: 16px` to not overlap code; (8) table `margin-block` raised to 32px, `th` padding `16px 24px`, `td` padding `10px 24px` + `vertical-align: top`; (9) `vp-doc h2` `margin-top` raised to 80px (was 40px) + `padding-top` to 32px; (10) `VPDoc` `padding-bottom: 80px` (was 0px — content ran to footer); (11) footer `padding-block: 48px` (was 32px); (12) `.VPHomeContent` capped at `max-width: 768px` with `32px` side gutters (was uncontained); (13) home page `<hr>` dividers got `margin-block: 80px` (was 16px); (14) mobile: all pages verified zero horizontal overflow; code blocks contained within 24px gutters, tables capped to content width. Build clean in 4.22s.

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
- ✅ **E2E test suite repair** (2026-06-28): Root-caused and fixed 15 pre-existing Playwright spec failures introduced by the design-elevation redesign and feature additions. Real bugs fixed: (1) `LabelPicker` not threading `boardId` → `useToggleIssueLabel`, so label toggles from the drawer never invalidated the `boardView` cache (board cards didn't update); (2) description "Edit" button lacked `aria-label="Edit description"`, causing strict-mode violations in label specs (2 "Edit" buttons); (3) `IssueCard` missing `data-testid="issue-card"` after redesign changed `rounded-lg` → `rounded-md` (due-date specs were brittle to CSS class names); (4) `CumulativeFlowChart` legend `<span>` missing `data-testid="cfd-legend-item"` after redesign changed `text-gray-500` → `text-slate-500`; (5) ConfirmDialog specs using `role="dialog"` instead of `role="alertdialog"` (backlog-sprint, issue-detail, themed-dialogs); (6) attachments download spec used `waitForEvent('download')` which headless Chrome doesn't fire for blob: URLs — replaced with `page.route()` interception. CI fix: `PW_API_LOG` env var added to `e2e.yml` so password-reset tests can find the API log. Env-only failures documented with comments (password-reset needs `PW_API_LOG` path; webhooks-api/ui require Redis). 219/226 passing in the no-Redis harness; all 5 remaining failures are env-only (3 password-reset + 2 webhooks).
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
- ✅ **Custom fields** (project-level, type-targetable): backend persistence layer shipped 2026-06-28 — `CustomFieldsModule` (`GET/POST /projects/:projectId/custom-fields`, `PATCH/DELETE /custom-fields/:id`); key slug derivation + uniqueness (slug→_2→_3…); SELECT/MULTI_SELECT options validation; `validateAndNormalize` helper wired into issue create (store) and update (MERGE — only provided keys change, null clears, untouched keys preserved); `Issue.customFields` JSONB returned in single-issue + create/update responses; 43 new unit tests (414 total). Frontend slice also shipped 2026-06-28 — `useCustomFields`/`useCreateCustomField`/`useUpdateCustomField`/`useDeleteCustomField` hooks; Settings page "Custom fields" section (add/edit/delete modal with options editor + appliesToTypes multi-select + required toggle); `<CustomFieldInput>` reusable component (TEXT/URL→Input, NUMBER→number Input, DATE→date input, CHECKBOX→checkbox, SELECT→select, MULTI_SELECT→checkbox list + chips); `CustomFieldsDrawerSection` in IssueDetailDrawer (filtered by appliesToTypes); custom fields rendered + submitted in CreateIssueModal; 10 `data-testid` hooks; Playwright e2e (desktop + mobile) authored.
- ✅ **NLQL — a real query language** (`assignee = me() AND priority in (High, Highest) AND "Severity" = S1`): tokenizer + parser + evaluator in `packages/shared`; saved filters backend (`GET/POST /projects/:projectId/saved-filters`, `PATCH/DELETE /saved-filters/:id`); inline query bar on the board (data-testid="nlql-query-input") with live validation + inline error (data-testid="nlql-error"); composes AND with existing pill filters; saved filters UI (data-testid="saved-filter-select"/"saved-filter-save") with rename/delete (owner-only, ConfirmDialog) + shared badge; `apps/web/src/api/saved-filters.ts` hooks; `apps/web/e2e/nlql-filter.spec.ts` desktop+mobile; build green. (2026-06-28)
- ✅ **Per-board default filter** (2026-06-29) — a board can carry an always-applied NLQL scope (`Board.filterQuery`, already in schema/backend) so a dedicated board (e.g. "Epics", "Stories") only ever shows matching issues without re-applying filters on every switch. Frontend wired up the missing pieces: a "Default filter" NLQL field (live-validated, autocomplete) in Board settings → General (`board-default-filter`); `BoardPage` applies the board's `filterQuery` as the base scope before pill/NLQL/preset filters (broken stored filter falls back to showing all, never crashes); a toolbar indicator (`board-filter-indicator`) shows the active board filter so scoping is never a surprise. e2e: set `type = EPIC` → only the epic shows + indicator; clearing restores all (desktop + mobile). (2026-06-29)
- ✅ **Mermaid diagrams in markdown descriptions & comments** (2026-06-29) — fenced ```mermaid blocks in any markdown surface (issue description, comments) render as diagrams. `MarkdownRenderer` splits the source into markdown / mermaid segments (`splitMermaidSegments`); markdown stays on the existing marked→DOMPurify path, mermaid renders via a new `Mermaid` component that LAZY-imports mermaid (~605 KB, code-split into `mermaid.core-*.js` so the main bundle is unaffected), renders with `securityLevel:'strict'` (mermaid's own DOMPurify pass sanitizes the SVG; an extra pass would strip the `<foreignObject>` labels), and falls back to the raw source in a `<pre>` on parse error. CSP-safe (no eval; only d3-dsv's CSV parser uses `new Function`, off the render path). Clicking a diagram opens it in a zoomable lightbox (−/%/+/Reset) instead of triggering the description's click-to-edit (stops propagation, incl. portal-bubbled events from the lightbox); `useOverlay` now tracks an overlay stack so Escape/Tab only act on the topmost overlay (a lightbox over the issue drawer no longer closes the drawer too). e2e: render flowchart → SVG, invalid → fallback, XSS payload in a node label is neutralised, click → zoom (not edit) + zoom controls + Escape closes only the lightbox (desktop + mobile). (2026-06-29)
- ✅ **NlqlInput reused in automation condition + card-color query fields** (2026-06-29) — `NlqlConditionInput` now wraps `NlqlInput` (receives `projectId` prop, fetches labels/users/sprints/components/customFields internally, threads `statuses`); `CardColorsManager` adds `useStatuses(projectId)` and passes vocab to `RuleRowEditor` which uses `NlqlInput` for the query field. All `data-testid` hooks (`automation-condition-input`, `color-rule-query`) preserved on the underlying `<input>`. `tsc --noEmit` + build clean; `BoardPage.tsx` untouched.
- ✅ **NLQL query autocomplete** (2026-06-29) — context-aware autocomplete engine in `packages/shared/src/nlql/suggest.ts` (`suggestNlql` pure function + `NlqlSuggestion`/`NlqlSuggestContext`/`NlqlSuggestResult` types; exported via `packages/shared/src/nlql/index.ts`); state machine tokenizes the prefix up to the cursor, infers field/operator/value/logical-keyword/ORDER-BY/direction phase, returns ranked `NlqlSuggestion[]` with `[from, to)` replacement range; handles IN-list values, `me()`/`now()`/`today()` function suggestions, per-field-kind operator sets, quoting of values with spaces; 47 unit tests in `suggest.test.ts` (122 total shared tests pass); `NlqlInput` React component in `apps/web/src/components/board/NlqlInput.tsx` — combobox ARIA pattern (`role=combobox`/`aria-expanded`/`aria-controls`/`aria-activedescendant`; `role=listbox` dropdown; `role=option` items; `aria-label="NLQL suggestions"`); keyboard UX (ArrowDown/Up highlight, Enter/Tab accept, Escape close, focus kept throughout); `data-testid`: `nlql-query-input`/`nlql-suggestions`/`nlql-suggestion-N`; loads context from `useLabels`/`useUsers`/`useSprints`/`useComponents`/`useCustomFields`; Dispatch kind-color tags (field=signal, operator=ink, keyword=emerald, function=amber, value=ink); dropdown mobile-safe (`w-full min-w-[18rem] overflow-y-auto`); wired into `BoardPage.tsx` replacing plain `<Input>` in `NlqlQueryBar`, threads `statuses` + `customFieldDefs` props; `apps/web/e2e/nlql-autocomplete.spec.ts` (desktop + mobile: field suggestion, acceptance, full flow, ARIA roles, ORDER BY, no mobile overflow, Tab accept); build + `tsc --noEmit` clean.
- ✅ **Conditional card colors** — per-board ordered rule list (NLQL condition → color, first match wins) with a legend. Frontend: `CardColorsManager` (add/edit/delete/reorder rules, live NLQL validation, accessible preset + hex color picker, optional label); left-accent stripe on `IssueCard` (`data-color-rule-id`); compact `CardColorLegend` in toolbar; "Colors" button + Colors tab in `BoardSettingsModal`; `resolveCardColor` evaluator in `lib/cardColors.ts`; e2e `card-colors.spec.ts` (desktop + mobile). Build green. (2026-06-28)
- ✅ **Planning poker (scrum poker) — backend** — `PokerModule` (`apps/api/src/poker/`): `POST /projects/:projectId/poker-sessions` (create session + PokerItems, sets activeItemId to first item), `GET /projects/:projectId/poker-sessions` (list, most-recent first), `GET /poker-sessions/:id` (session with items + vote masking: other users' values hidden pre-reveal, own vote always visible, all values exposed post-reveal), `PATCH /poker-sessions/:id` (name/state/activeItemId with state-transition validation VOTING→REVEALED→CLOSED), `POST /poker-sessions/:id/items` (add item), `DELETE /poker-items/:itemId` (remove item), `POST /poker-items/:itemId/vote` (upsert vote; validates deck value + rejects on revealed/closed), `POST /poker-items/:itemId/reveal` (set revealed=true), `POST /poker-items/:itemId/commit` (set finalEstimate + write issue.storyPoints atomically). Socket.io events emitted to project room on all mutations: `poker.vote.cast` (userId only, value never leaked), `poker.item.revealed`, `poker.session.updated`, `poker.item.added`, `poker.item.removed`, `poker.estimate.committed`. 32 unit tests (473 total). Registered in AppModule. (2026-06-28)
- ✅ **Planning poker — frontend** — `apps/web/src/api/poker.ts` (8 hooks: `usePokerSessions`, `usePokerSession`, `usePokerRealtime`, `useCreatePokerSession`, `useUpdatePokerSession`, `useCastVote`, `useRevealItem`, `useCommitEstimate`, `useAddPokerItem`, `useRemovePokerItem`); `PokerStartPage` at `/projects/:projectId/poker` (sessions list + "New session" modal with sprint filter + issue multi-select); `PokerSessionPage` at `/projects/:projectId/poker/:sessionId` (active item card with full issue detail, POKER_DECK hand with cobalt-highlighted selected card, participant strip with face-down/revealed cards, distribution summary + average on reveal, commit input + auto-advance, prev/next item nav, facilitator controls, VIEWER read-only, session close); "Poker" tab in `ProjectNav`; "Estimate / Poker" link in `BacklogPage` header; realtime subscribed via `usePokerRealtime` (all `poker.*` events → invalidate session query); VIEWER-gated voting/controls; `prefers-reduced-motion` honoured; WCAG-AA contrast; data-testids on all interactive elements; `apps/web/e2e/poker.spec.ts` (desktop + mobile: create session, cast vote with card highlight, reveal, commit estimate, verify story points via API, backlog entry point); build green. (2026-06-28)
- ✅ **Issue links / dependencies (frontend)** — `LinkedIssuesSection` in IssueDetailDrawer sidebar: links grouped by label (blocks / is blocked by / relates to / duplicates / is duplicated by / clones); each row shows the related issue key (mono/cobalt) + title + status chip, clickable to open that issue; remove (x) button MEMBER+; "Add link" form with link-type select (6 types) and issue-key/id text input; `useIssueLinks`/`useAddIssueLink`/`useRemoveIssueLink` hooks in `apps/web/src/api/issue-links.ts`; `qk.issueLinks(issueId)` key; toast for 400/404/409 errors (self-link, not-found, duplicate); data-testids `issue-link-add/type/target/row/remove`; Playwright e2e desktop + mobile. Board card badge skipped (board payload doesn't include links; N+1 fetches avoided). (2026-06-28)
- ✅ **Quick-filter preset chips on the board toolbar** (2026-06-28) — "My issues" / "High priority" / "Unresolved" / "Recently updated" one-click chips that layer on top of the existing pill filters and NLQL bar; mutually composable; active state reflected as cobalt-filled chip + `aria-pressed`; client-side predicate logic (no backend change); `data-testid`: `quick-filter-my-issues`, `quick-filter-high-priority`, `quick-filter-unresolved`, `quick-filter-recent`; Playwright e2e `quick-filters.spec.ts` (desktop + mobile); build green.
- ✅ **Watch toggle in the issue drawer** (2026-06-28) — `useToggleWatch` hook (`POST/DELETE /issues/:id/watch`) with optimistic toggle + rollback; "Watch"/"Watching" button (eye icon, watcher count) in `IssueDetailDrawer` header; any role can watch; `data-testid="issue-watch-toggle"`; Playwright e2e `watch.spec.ts` (desktop + mobile); build green.
- ✅ **Personal & team analytics** (2026-06-28) — `GET /me/analytics?days=N` → `PersonalAnalyticsDto`; `GET /projects/:projectId/analytics?days=N` → `ProjectAnalyticsDto`; `apps/web/src/api/analytics.ts` (`usePersonalAnalytics`, `useProjectAnalytics`); `PersonalAnalyticsPage` at `/me/analytics` (14/30/90-day window selector, headline stat cards, hand-rolled SVG throughput chart, type/priority horizontal bar breakdowns, personal board mini-stats); `ProjectAnalyticsPage` at `/projects/:projectId/analytics` (window selector, headline stats, hand-rolled SVG flow chart, cycle-time distribution bars, workload bars by assignee); "Analytics" tab in `ProjectNav`; "Insights" link in `AppHeader`; `data-testid` hooks on all major surfaces; WCAG-AA, accessible charts with visually-hidden summaries; build green.
- ✅ **Bulk edit (backend)** — `POST /issues/bulk`; `BulkUpdateIssuesDto`/`BulkIssueChangesDto`/`BulkUpdateResultDto`; per-issue `update()` delegation preserving authz, ActivityLog, realtime, webhooks, automation events; `addLabelIds` label-attach per id; partial-success semantics (failed ids captured, batch continues); 11 unit tests; 646 total green. (2026-06-28)
- ✅ **Bulk edit (frontend)** (2026-06-28) — `useBulkUpdateIssues()` mutation hook (`POST /issues/bulk`, invalidates board/projectIssues/individual issues); per-row `BulkSelectCheckbox` (`data-testid="bulk-select-row"`, `data-issue-id`); per-section "select all" `BulkSelectAll` (`data-testid="bulk-select-all"`) with indeterminate state; sticky `BulkActionBar` portal (`data-testid="bulk-action-bar"`, `role="region"`, `aria-label="Bulk actions"`) with status/assignee/priority/sprint/label controls; Apply (`data-testid="bulk-apply"`, disabled until a field is set) + Clear (`data-testid="bulk-clear"`) buttons; selection `Set<string>` at page level; success toast `"Updated N issues."` + warning toast for failed ids; mobile-responsive wrapping at 390 px (no horizontal overflow); Dispatch ink-900 bar surface + signal-600 accent; sprint control shown only on BacklogPage; all existing BacklogPage/TriagePage `data-testid` attrs, ARIA roles, and keyboard handlers (j/k/s/p/a/l/f/?/Esc) fully preserved.
- ✅ **CSV export of project issues** (backend, 2026-06-28) — `GET /projects/:projectId/issues.csv?q=<NLQL>`; `text/csv; charset=utf-8`; `Content-Disposition: attachment; filename="<projectKey>-issues.csv"`; 13 columns: Key, Title, Type, Status, Priority, Assignee, Reporter, Story Points, Sprint, Labels (joined by `; `), Due Date, Created, Updated; RFC-4180 `csvCell()` helper: comma/quote/newline quoting + formula-injection guard (leading `=`/`+`/`-`/`@` prefixed with apostrophe); optional NLQL `q` filter — validated via `validateQuery` (400 on invalid), applied with `filterIssues` (same evaluator as the board); auth: project member (VIEWER+); rows ordered by issue number ascending; `IssuesCsvController` + `csv.util.ts` added to `IssuesModule`; 39 unit tests green; build clean.
- 🚧 **CSV export completeness** (founder-flagged 2026-07-02, in progress) — the 13-column export above is missing data a real export/reporting workflow needs: Description, Component, Fix Versions (Versions M:N), Custom Fields (all defined fields, not just core columns), Time estimates (`originalEstimateMinutes`/`timeSpentMinutes`), and Parent/Epic (parent issue key). All source data already exists on `IssueDto`/relations; this is a column-mapping extension of the existing `csv.util.ts`, not a new subsystem. Being fixed in the current build pass — see `docs/BACKLOG.md` Ready queue.
- ✅ **Workspace branding backend** (2026-06-28) — `PATCH /workspaces/:id` (name + `brandColor` #RRGGBB hex or null, Admin-only); `POST /workspaces/:id/logo` (multipart, png/jpeg/webp, 2 MB cap, SVG explicitly rejected, Admin-only, replaces previous file); `DELETE /workspaces/:id/logo` (Admin-only, best-effort unlink); `GET /workspaces/:id/logo` (public, no JWT via `@Public()` decorator, streams image with sensible `Cache-Control`); centralized `toWorkspaceDto` mapper (single source of truth for `brandColor` passthrough + `logoUrl` derivation); `UpdateWorkspaceDto` with `@Matches(/^#[0-9a-fA-F]{6}$/)` + null-allowed brandColor; 30 unit tests (745 total); build clean.
- ✅ **Board swimlanes (group-by)** (2026-06-28) — frontend-only; groups the filtered board issues into horizontal swimlanes by Assignee / Priority / Issue type / Epic; dimension persisted in URL `?group=assignee|priority|type|epic` (omitted when None); each lane is an independent `DndContext` (cross-lane DnD out of scope v1, prevents data corruption by design); lane header shows group label + count badge; only non-empty lanes rendered; Assignee lane shows Avatar; Priority lanes ordered Highest→Lowest; Epic lanes keyed by parent IssueRefDto (No epic fallback); `computeLanes()` pure function in `BoardSwimlanesView.tsx`; `data-testid`: `swimlane-groupby`, `swimlane-lane`, `swimlane-lane-header`; Dispatch ink-50/ink-200 lane header; `GroupBySelector` dropdown in toolbar (icon + active label); mobile horizontally scrollable per lane; build clean; 27/28 e2e green (1 pre-existing flaky inline-card-status mobile test unrelated to swimlanes).
- ✅ **Workspace branding frontend** (2026-06-28) — Token refactor: `signal` + `brand` Tailwind scales now resolve to CSS vars (`--nl-signal-50…900`) so runtime theming can swap the full palette; `:root` defaults in `index.css` set the exact original electric-cobalt hex values (zero visual change when no brand color is set); `--nl-accent*` vars derived from signal vars (DRY). Runtime theming: `applyBrandColor.ts` generates a full 50–900 scale from a single hex (600=anchor, lighter toward white for 50–500, darker toward black for 700–900) and writes CSS variables on `documentElement`; `WorkspaceContext` provider mounted in `App.tsx` applies/removes the override on workspace switch. Logo in AppHeader: `WorkspaceLogo` component renders `<img data-testid="workspace-logo">` from `API_URL/api/logoUrl` when set, falls back to the default Next Lane mark. Branding settings page at `/workspaces/:workspaceId/branding` (ADMIN-only; non-admins see access-denied): logo section (file picker `data-testid="logo-upload-input"`, live preview, Upload, `data-testid="logo-remove"`), accent-color section (`data-testid="brand-color-input"`, 10 preset swatches, live preview of primary button + active nav + status chip, `data-testid="brand-color-save"`, Reset to default); all three workspace pages (Members, Audit log, Branding) share a unified sub-nav using `signal-*` tokens; `useUpdateWorkspaceBranding`/`useUploadWorkspaceLogo`/`useDeleteWorkspaceLogo` hooks in `workspaces.ts`; `WorkspaceProvider` context in `src/contexts/WorkspaceContext.tsx`; build + tsc clean.
- 🚧 **Configurable workflows — bake in your full SDLC** *(high priority)*. Today statuses + ordering are customizable but transitions are unconstrained. Make the workflow a first-class, editable object per project (and optionally per issue type): a **status graph** with explicitly allowed transitions, plus per-transition **conditions / validators / gates** (e.g. require an assignee before "In Progress", a resolution before "Done", a linked PR before "In Review") and optional post-transition actions (hooks into the Glass Box automation engine). Ship default workflow **templates** (simple, Kanban, Scrum, bug-triage, full SDLC) and a visual workflow **builder** in project settings, with the board/triage/transition controls enforcing the graph. Crucially, the workflow definition must be **readable AND editable over MCP** — an agent can introspect a project's SDLC ("what states exist, what transitions are legal from here, what gates apply") and modify it (add a state/transition/gate) the same as the UI. This is both table-stakes parity *and* a structural differentiator: an agent-legible, fully self-defined SDLC is something closed per-seat trackers don't expose. (Pairs with Phase 6 MCP-native.)
  - ✅ **Phase 1 — Schema**: `Project.workflowEnforced`, `WorkflowTransition` model (projectId/fromStatusId/toStatusId/issueType/name/gates JSONB, unique constraint NULLS NOT DISTINCT). Prisma client generated. Shared contract final in `@next-lane/shared`: `WorkflowDto`, `WorkflowTransitionDto`, `WorkflowGateDto`, `WorkflowGateType` enum. (2026-06-28)
  - ✅ **Phase 2 — Backend**: `WorkflowModule` (`apps/api/src/workflows/`) with full REST API; transition enforcement wired into `IssuesService.move()` + `update()`; automation bypass; auto-seed on first enable; `ProjectDto.workflowEnforced` added to mapper; 47 unit tests; build clean. (2026-06-28)
  - ✅ **Phase 2b — Per-board named workflows backend** (2026-06-29): Named `Workflow` entity CRUD (`GET/POST /projects/:id/workflows`, `GET/PATCH/DELETE /workflows/:id`) with `transitionCount` + `boardCount` rollups; workflow-scoped transition CRUD (`POST /workflows/:id/transitions`, `PATCH/DELETE /workflow-transitions/:id`) on non-colliding paths; seed-from-template (`POST /projects/:id/workflows/from-template`) for `simple` / `kanban` / `scrum` / `bug-triage` templates; board workflow assignment — `UpdateBoardDto.workflowId: string | null` (same-project validation, null clears, Prisma `connect`/`disconnect` relation syntax); `boardId?` added to `MoveIssueDto`; `enforceMove` private method in `IssuesService.move` resolves board → named workflow → `enforceTransitionForWorkflow` vs project-level `enforceTransition` (3-branch routing + automation bypass preserved); `WorkflowService.enforceTransitionForWorkflow` mirrors project-level enforcement scoped to a workflow entity; `toBoardSummaryDto` now returns `workflowId: string | null`; 3 new Jest spec files (named-workflow.service.spec, board-workflow-assignment.spec, issues-board-enforcement.spec); 1085 unit tests total; `tsc --noEmit` clean. Also satisfies the founder's "workflows for the progression of a ticket / editable per board" request. (2026-06-29)
  - ✅ **Phase 3 — Per-board workflows frontend** (2026-06-29): `apps/web/src/api/workflows.ts` — `useWorkflows`, `useWorkflowDetail`, `useCreateWorkflow`, `useUpdateWorkflow`, `useDeleteWorkflow`, `useCreateWorkflowFromTemplate`, `useAddWorkflowTransition`, `useUpdateWorkflowTransition`, `useDeleteWorkflowTransition`, `useAssignBoardWorkflow`; `qk.workflows(projectId)` + `qk.workflow(id)` keys added to `keys.ts`. `WorkflowsManager` section in project Settings (list with transition/board counts + enforced badge; inline detail panel with enforcement toggle `data-testid="workflow-enforce-toggle-2"`, transition builder reusing WorkflowSection UI patterns; create + from-template modals; delete with confirm; ADMIN to mutate); `BoardWorkflowSelector` in board toolbar (admin `<select data-testid="board-workflow-select">` + read-only `data-testid="board-workflow-badge"`); `MoveIssueInput.boardId` added so drag-drop + card-status-picker pass board context → named workflow enforcement; 4/4 Playwright e2e green (desktop: create-from-template, assign-to-board+badge, enforced-422-toast; mobile: no overflow); `tsc --noEmit` + build clean.
  - ✅ **Phase 4 — MCP surface** (2026-06-29): new standalone `@next-lane/mcp` package (`apps/mcp/`) — a Model Context Protocol server (stdio, official `@modelcontextprotocol/sdk` + `zod`) that lets external agents (Claude Desktop, Claude Code) read AND write a project's workflows/SDLC and core entities via the REST API. Auth via `NEXT_LANE_TOKEN` (PAT, `Authorization: Bearer`) + `NEXT_LANE_API_URL` (default `http://localhost:4000`); fails fast if the token is missing. 18 tools (8 read / 10 write): `list_workspaces`, `list_projects`, `list_boards`, `list_statuses`, `list_workflows`, `get_workflow`, `list_issues`, `get_issue`, `create_workflow`, `create_workflow_from_template`, `update_workflow`, `delete_workflow`, `add_workflow_transition`, `update_workflow_transition`, `delete_workflow_transition`, `assign_board_workflow`, `create_issue`, `move_issue`. Centralized fetch wrapper (`client.ts`) surfaces the API's error message + HTTP status; thin handlers. 18 vitest unit tests (mocked fetch: missing-token fast-fail, URL/header/method/body construction, error surfacing); `tsc` build clean; stdio `tools/list` smoke verified. Additive — no schema/backend changes. Agents can now introspect/modify the project SDLC the same as the UI. README with Claude Desktop + Claude Code config blocks in `apps/mcp/README.md`.
  - ✅ **Phase 5 — Visual graph builder** (2026-06-29): `WorkflowGraph` custom SVG component in `apps/web/src/components/settings/WorkflowGraph.tsx` — nodes (statuses auto-laid-out left→right by category; synthetic Start node for null-fromStatus), edges (transitions as directed arrows with bezier curves; gate badge G on edges with gates), connect handles (real `<button>` inside `<foreignObject>` for keyboard + a11y), click-source-then-target interaction to POST a new transition, SVG `<foreignObject>` delete button always in DOM (opacity reveals on hover, JS-click reliable in e2e). View toggle (List / Graph segmented control, `data-testid="workflow-graph-toggle"`) in `WorkflowDetailPanel`. Both views operate on the same TanStack Query cache; all existing `useAddWorkflowTransition`/`useDeleteWorkflowTransition` mutations reused. Graph contained in `overflow-x-auto` box (page never overflows on mobile). `prefers-reduced-motion` respected via `motion-safe:` Tailwind modifier. `apps/web/e2e/workflow-graph.spec.ts` (4/4 green: desktop node-render, create-transition, delete-edge + mobile no-overflow); tsc + build clean. ADMIN-only mutate; read-only for MEMBER/VIEWER (no connect handles or delete buttons).
- ✅ **Filter-state URL persistence** (2026-06-28) — board filter state (NLQL `?q=`, title search `?s=`, assignee `?assignee=`, labels `?labels=`, types `?types=`, priorities `?priorities=`, quick-filter presets `?presets=`) synced to the URL via `useSearchParams`; URL is the single source of truth (no separate state mirror, no bidirectional-sync loop); existing `?issue=` and `?new=` deep-link params preserved; empty/default filters omit their param (clean URLs); `replace:true` for incremental typing, `replace:false` for discrete toggle actions; filter state survives reload and is shareable via link. Build clean; all 17 NLQL-filter + quick-filter e2e tests green.
- ✅ **Components backend** (2026-06-28) — `ComponentsModule` (`apps/api/src/components/`): `GET /projects/:projectId/components` (VIEWER+, ordered by name asc), `POST /projects/:projectId/components` (ADMIN; unique-name enforcement with 409; `defaultAssigneeId` must be workspace member or 400), `PATCH /components/:id` (ADMIN; re-validates uniqueness + assignee membership; 404 if foreign), `DELETE /components/:id` (ADMIN; 204; `Issue.componentId` set null via `onDelete: SetNull`). `IssueDto.componentId` (required, nullable) + `IssueDto.component` (lightweight `{ id, name }` relation) added to shared types and mapper; `CreateIssueDto.componentId` + `UpdateIssueDto.componentId` (nullable) added with cross-project validation via `assertSameProject`; default-assignee auto-assignment on issue create when `componentId` set and no `assigneeId` given. `ComponentDto`/`CreateComponentDto`/`UpdateComponentDto` added to `@next-lane/shared`. 40 new unit tests (36 ComponentsService/DTO + 4 IssuesService component integration); 849 total green; `tsc --noEmit` clean. [product-audit P1 #4]
- ✅ **Components frontend** (2026-06-28) — `apps/web/src/api/components.ts` (`useComponents`/`useCreateComponent`/`useUpdateComponent`/`useDeleteComponent` hooks; `qk.components(projectId)` query key); `ComponentsSection` in project Settings page (ADMIN create/edit/delete with name+description+default-assignee picker; MEMBER/VIEWER read-only list; 409 duplicate-name surfaced as friendly toast; ConfirmDialog for delete; `data-testid` hooks: `components-section`, `component-add`, `component-row`, `component-name-input`, `component-save`, `component-delete`); Component picker (`issue-component-picker`) in `IssueDetailDrawer` sidebar (select field with project components + None option, calls `useUpdateIssue` with `componentId`; read-only display when not editable); `componentId` added to `UpdateIssueInput` patch shape; 5 Playwright e2e tests (desktop + mobile) all green. [product-audit P1 #4]
- ✅ **Versions / Releases backend** (2026-06-28) — `VersionsModule` (`apps/api/src/versions/`): `GET /projects/:projectId/versions` (VIEWER+, ordered by createdAt asc, includes `issueCount` via `_count`), `POST /projects/:projectId/versions` (ADMIN; 409 on duplicate name within project), `PATCH /versions/:id` (ADMIN; 404 if not found/foreign; 409 on duplicate name; auto-sets `releaseDate` to now when transitioning to RELEASED with no existing date), `DELETE /versions/:id` (ADMIN; 204; IssueVersion join rows cascade). Issue↔version M:N assignment: `PUT /issues/:issueId/versions` with `{ versionIds: [] }` replaces the full set atomically (MEMBER+; cross-project version IDs rejected with 400; missing IDs rejected with 400). `VersionState` enum (UNRELEASED/RELEASED/ARCHIVED) + label map added to `@next-lane/shared/enums`; `VersionDto`/`CreateVersionDto`/`UpdateVersionDto` added to `@next-lane/shared/types`; `IssueDto.versions` (`{ id, name, state }[]`) added to shared types and mapper; `listInclude` in `IssuesService` extended to include versions relation. `VersionsModule` wired into `AppModule`. 55 new unit tests (33 VersionsService + 16 VersionsDto/SetIssueVersionsDto); 904 total green; `tsc --noEmit` clean. (2026-06-28)
- ✅ **Versions / Releases frontend** (2026-06-28) — `apps/web/src/api/versions.ts` (`useVersions`/`useCreateVersion`/`useUpdateVersion`/`useDeleteVersion`/`useSetIssueVersions` hooks; `qk.versions(projectId)` key); `VersionsSection` in project Settings (ADMIN create/edit/delete via modal with name+description+releaseDate; state badge UNRELEASED neutral/RELEASED emerald/ARCHIVED muted; issue count + releaseDate displayed per row; Release action on UNRELEASED versions, Archive action on UNRELEASED/RELEASED; MEMBER/VIEWER read-only; 409 duplicate-name surfaced as friendly toast; ConfirmDialog delete; `data-testid`: `versions-section`, `version-add`, `version-row`, `version-save`, `version-release`); `VersionsField` multi-select in `IssueDetailDrawer` sidebar (`data-testid="issue-versions-picker"`, chip display per assigned version with state badge colouring, dropdown listbox to toggle versions, `useSetIssueVersions` mutation calls PUT atomically); `VersionState`/`VERSION_STATE_LABELS` imported from `@next-lane/shared`; 6 Playwright e2e tests (desktop: create/release/assign/duplicate-error/delete + mobile no-overflow) all green; tsc + build clean. (2026-06-28)
- ✅ **WIP limits — schema + backend** (2026-06-28) — `wipLimit Int?` added to `Status` model (migration `20260628120000_add_status_wip_limit`); Prisma client regenerated; `wipLimit: number | null` in `StatusDto` (shared types + all status mappers); `CreateStatusDto`/`UpdateStatusDto` accept `wipLimit` with `@IsOptional @IsInt @Min(1)` + null-clear semantics; `toStatusDto` propagates field in all usages (`statuses.service`, `issue.mapper`, `issue-links.service`, `board.service`, `public.service`); 14 new unit tests (918 total; tsc clean). Advisory v1 — UI indicator follow-up tracked below. [product-audit P1 #7]
- ✅ **WIP limits — UI indicator** (2026-06-28) — `BoardColumn.tsx` header now renders `count / limit` (e.g. "3 / 2") when a WIP limit is set; over-limit state applies `bg-red-50 text-red-700 ring-red-200` danger tokens to the count chip and `aria-label="N of M, over limit"` for colour-blind accessibility; `data-testid="column-wip-indicator"` on the chip; no indicator when `wipLimit` is null (zero regression). Settings: `ColumnFormModal.tsx` gains a "WIP limit (optional)" numeric input (`data-testid="column-wip-limit-input"`) wired to `wipLimit` in `CreateStatusInput`/`UpdateStatusInput`; empty → send null (clears); positive integer → cap; client-side < 1 guard surfaces a toast before the API call. 5 Playwright e2e tests (desktop: set limit, over-limit indicator, under-limit indicator, no-limit plain count + mobile: no overflow) all green; tsc + build clean. [product-audit P1 #7]
- ✅ **Checklists backend** (2026-06-28) — `ChecklistModule` (`apps/api/src/checklist/`): `POST /issues/:issueId/checklist` (MEMBER+; new item order = max+1 or 0 for first item), `PATCH /checklist/:itemId` (MEMBER+; edit text / toggle done / set order; tenant check resolves item→issue→project), `DELETE /checklist/:itemId` (MEMBER+; 204), `PUT /issues/:issueId/checklist/reorder { itemIds }` (MEMBER+; validates all ids belong to issue; assigns order=index). `ChecklistItem` Prisma model (id/issueId/text/done/order/timestamps; `@@index([issueId])`; `onDelete:Cascade`); migration `20260628130000_add_checklist_items` applied and table verified live. `toChecklistItemDto` mapper; `checklistItems` included in `listInclude` (ordered by `order asc`); `IssueDto.checklist` + `IssueDto.checklistProgress: { done, total }` added to shared types and mapper. `ChecklistItemDto`/`CreateChecklistItemDto`/`UpdateChecklistItemDto` added to `@next-lane/shared`. 40 new unit tests (958 total); `tsc --noEmit` clean. [Phase 5 parity]
- ✅ **Checklists frontend** (2026-06-28) — `ChecklistSection` in IssueDetailDrawer main column; progress indicator (`done/total` text + slim emerald progress bar with `role=progressbar`/aria); per-item checkbox (real `<input type=checkbox>`, optimistic toggle), text with strikethrough-when-done, delete button (hover/focus-visible, MEMBER+ only); "Add item" controlled input (per-keystroke safe, Enter submits, clears on success, focus preserved); empty state; `data-testid` hooks: `checklist-section`, `checklist-progress`, `checklist-add-input`, `checklist-item`, `checklist-item-checkbox`, `checklist-item-delete`; `apps/web/src/api/checklist.ts` hooks (`useAddChecklistItem`, `useUpdateChecklistItem`, `useDeleteChecklistItem`, `useReorderChecklist`, `useChecklist`); `qk.checklist(issueId)` query key; `apps/web/e2e/checklist.spec.ts` (3 tests: desktop add+toggle+progress+delete, viewer read-only, mobile no-overflow — all green); tsc + build clean. [Phase 5 parity follow-up]
- ✅ **Issue templates backend** (2026-06-29) — `IssueTemplatesModule` (`apps/api/src/issue-templates/`): `GET /projects/:projectId/issue-templates` (VIEWER+, ordered by name asc), `POST /projects/:projectId/issue-templates` (ADMIN; 409 on duplicate name; `defaultAssigneeId` workspace-member check or 400; `componentId` project-ownership check or 400; `labelIds` project-ownership check or 400), `PATCH /issue-templates/:id` (ADMIN; same validations; 404 if not found/foreign), `DELETE /issue-templates/:id` (ADMIN; 204), `POST /issue-templates/:id/create-issue` (MEMBER+; title resolved: override > titleTemplate > 400; field overrides beat template defaults; labels attached via `IssueLabel.upsert` after issue creation; full `IssueDto` returned). `toIssueTemplateDto` mapper with `toUserDto` + `parseLabelIds` (Json→string[]). `IssueTemplatesModule` wired into `AppModule`; `IssuesModule` imported (already exported `IssuesService`). 72 new unit tests (35 service + 37 DTO; 1030 total); no new tsc errors.
- ✅ **Issue templates frontend** (2026-06-29) — `apps/web/src/api/issue-templates.ts` (`useIssueTemplates`/`useCreateIssueTemplate`/`useUpdateIssueTemplate`/`useDeleteIssueTemplate`/`useCreateIssueFromTemplate` hooks; `qk.issueTemplates(projectId)` key); `TemplatesManager` Settings section (ADMIN create/edit/delete modal: name, issueType, priority (optional), titleTemplate, descriptionTemplate, default-assignee picker, component select (optional), label multi-select checkboxes; MEMBER/VIEWER read-only list with type+priority badges; 409 friendly toast; ConfirmDialog delete; `data-testid`: `templates-manager`, `template-add`, `template-row`, `template-name-input`, `template-save`, `template-delete`); `FromTemplateMenu` on BoardPage toolbar (hidden when no templates exist, `data-testid`: `new-from-template-menu`, `new-from-template-option`; calls `POST /issue-templates/:id/create-issue`, invalidates board+issues caches, opens issue drawer + success toast); `TemplatesManager` registered in `SettingsPage` between ComponentsSection and VersionsSection; `apps/web/e2e/issue-templates.spec.ts` (5 tests: desktop create/duplicate-error/delete/from-template-board + mobile no-overflow — all green); `tsc --noEmit` + build clean. (2026-06-29)
- ✅ **CSV import backend** (2026-06-29) — `POST /projects/:projectId/issues/import` (MEMBER+; `issues:write` scope); accepts multipart/form-data `file` field (2 MB cap, buffered in memory via `memoryStorage`) OR JSON body `{ csv: string, dryRun?: boolean }`; `?dryRun=true` query param overrides body flag; `csv-parse/sync` RFC-4180 parser (quoted fields, embedded commas/newlines/CRLF, doubled double-quotes, UTF-8 BOM, relaxed column count); case-insensitive header mapping; 2000-row hard cap (400 when exceeded); per-row validation: Title required (1–300 chars), Type/Priority enum check (case-insensitive; 400 with valid values listed), Status name→id resolution (400 for unknown name; defaults to first TODO-category status when blank), Assignee email→workspace-member-id resolution (400 for unknown; regex-extracts email from cell), Story Points integer 0–999, Due Date ISO 8601; Labels comma-or-semicolon-split, case-insensitive create-or-match (auto-creates unknown labels; skips creation in dryRun mode); formula-injection apostrophe prefix stripped on import to round-trip with export; per-row errors collected without aborting the batch; each valid row calls `IssuesService.create` + `IssueLabel.upsert` per label; `ImportIssuesResultDto { created, skipped, errors: { row, message }[], dryRun }` + `ImportIssueRowError` added to `@next-lane/shared`; `IssuesImportService` + `IssuesImportController` registered in `IssuesModule`; `csv-parse` npm dep added; 36 new unit tests (1177 total green); `tsc --noEmit` clean. (2026-06-29)
- ✅ **CSV import frontend** (2026-06-29) — `apps/web/src/api/import.ts` (`useImportIssues` hook with `dryRun` + `importCsv` imperative helpers; bearer-auth multipart POST matching `export.ts` pattern; on real import invalidates `projectIssues`, `board`, and `boardView` queries so new issues appear without a manual refresh); `apps/web/src/components/ImportCsvModal.tsx` (`ImportCsvModal` — file picker `data-testid="import-csv-file"` accepting `.csv`; automatic dry-run on file pick with loading spinner; preview summary `data-testid="import-csv-dryrun-summary"` showing "{N} issues will be created, {M} skipped"; per-row error list `data-testid="import-csv-error-row"` in scrollable red panel; collapsible accepted-columns hint (Title required, 8 other columns); "Import" submit button `data-testid="import-csv-submit"` enabled only when dry-run found ≥1 creatable row; "Choose a different file" link resets state; import success closes modal and shows toast "Imported N issues"; real-import failure restores preview; VIEWER-gated — button hidden for viewers; accessible: labelled file input, `aria-live` on summary, `role=progressbar` on validating spinner, focus management via Modal's existing `useOverlay`); "Import CSV" trigger button `data-testid="import-csv"` placed next to "Export CSV" on BacklogPage toolbar (MEMBER+ only) and BoardPage toolbar (MEMBER+ only); `apps/web/e2e/csv-import.spec.ts` (desktop: trigger visible, modal opens, 3-row CSV dry-run shows 2 creatable + 1 error row, Import clicks, success toast + modal closes + issues appear in backlog; mobile 390px: no horizontal overflow; API-reachability guard skips gracefully with `test.skip` when backend unavailable); tsc + build clean. (2026-06-29)
- ✅ **Tracker importers — Jira / GitHub / Linear** (2026-06-29, file-based only) — `?source=jira|github|linear|generic` query param (and body field) on `POST /projects/:projectId/issues/import`; each non-generic source applies a header-alias map + enum-value map before the existing generic pipeline runs (all existing per-row validation, dryRun, error handling, bulk-create logic unchanged). Jira: `Summary`→title, `Issue Type`→type (Bug/Story/Task/Epic/Sub-task), Priority (Highest/Blocker/Critical/Major/Minor/Trivial/Lowest), duplicate Labels column merge, display-name assignee note. GitHub: CSV or JSON array (content-sniffed; `{ items: [] }` envelope supported; email-preferred assignee); `state=closed`→"Done", `state=open`→default TODO status; login-handle note. Linear: `Title`/`Description`/`Status`/`Priority` (Urgent/High/Medium/Low/No priority→HIGHEST…LOWEST), `Estimate`→story points, email-extraction from "Name <email>" format. `ImportSource` type + `ImportIssuesRequestDto` added to `@next-lane/shared`. Pure `issues-import.sources.ts` module (no NestJS deps). 126 new unit tests (1303 total green); `tsc --noEmit` clean. (2026-06-29)
- ✅ **Workspace discoverability + settings batch** (2026-06-30) — Founder-session + discoverability-audit gaps closed across backend + frontend:
  1. **Quick Links** (`/me/quick-links`): always-accessible personal shortcuts in the AppHeader — link list opens in new tab, inline add-form (label+URL, http/https validation, inline error), per-row edit + delete, friendly empty state; `useQuickLinks`/`useCreateQuickLink`/`useUpdateQuickLink`/`useDeleteQuickLink` hooks in `apps/web/src/api/quick-links.ts`; `qk.quickLinks` key.
  2. **Workspace chip** in AppHeader: always-visible current workspace name placed immediately after the logo; if >1 workspace, opens a switcher dropdown (checkmark on active, `setActiveWorkspaceId` on click) with footer links to "Workspace settings" and "Members"; single-workspace chip links directly to settings; mobile-safe truncation. `data-testid="workspace-chip"`.
  3. **Workspace General settings page** (`/workspaces/:id/settings`): rename form (`data-testid="workspace-name-input"`, `workspace-name-save`) + danger zone delete with type-to-confirm dialog (`data-testid="delete-workspace-button"`, `delete-workspace-confirm-input`, `delete-workspace-confirm-button`); `useDeleteWorkspace` hook; on success switches to next workspace (or root), toasts, navigates home; admin-gated mutations, non-admin sees read-only view. Route added to App.tsx.
  4. **Shared `WorkspaceSettingsNav`** component extracted from the three existing workspace pages (Members / Audit log / Branding); now includes a **General** tab as the first item; all four pages use the shared nav; nav `data-testid="workspace-settings-nav"`.
  5. **Invite member + role change on Members page**: `useAddMember` hook (POST `/workspaces/:id/members`, upserts); inline invite form (`data-testid="invite-member-form"`, `invite-email-input`, `invite-role-select`, `invite-member-submit`) with email + role select; per-row role dropdown for non-self members (`data-testid="member-role-select"`). `tsc --noEmit` + build clean.
  6. **Backend (same batch):** new `QuickLink` model + migration + per-user CRUD at `/me/quick-links` (http(s)-only URL validation that still allows `localhost`/LAN IPs for self-hosters); `DELETE /workspaces/:id` (admin-only, cascades projects/issues, cleans up logo file); workspace logo upload cap raised 2 MB → 4 MB to match the web form — the mismatch was the real cause of the "logo upload doesn't work" report. 55 backend unit tests + a tenant-isolation matrix row for cross-tenant workspace delete; all green.
  7. **Mobile fix:** the AppHeader primary nav (My Work / My Board / Insights) collapses into the user menu below `md`, and the logo shows mark-only on mobile, so the bar fits a phone viewport without clipping the bell / quick-links / avatar (a pre-existing overflow the new chip would have worsened). 68/68 affected e2e pass on desktop + mobile.
- ✅ **Quick links — colors + groups** (2026-06-30) — `QuickLink.color` (hex, palette-picked) + `QuickLink.group` (free-text) columns + migration; DTO validates hex (`#rrggbb`, nullable) and group (≤40 chars, empty→null). `QuickLinksMenu` extracted to its own component: links render under **collapsible group headers** (count badge, ungrouped section last) with a per-link color dot; shared add/edit form gains a curated 8-swatch palette (+none) and a group input with a datalist of existing groups. Scales cleanly to 25+ links (60vh scroll). Backend unit tests extended (hex/group validation, color+group persistence); web tsc + build clean; header e2e green desktop + mobile.
- ✅ **Personal board enrichment** (2026-07-01) — Audit found the personal board's cards were bare (title + notes only), all columns looked identical, and card actions were hover-only (invisible/unusable on touch). Fixes: **card accent color** (`PersonalCard.color`) shown as a left border; **card due date** (`PersonalCard.dueDate`) with a chip on the face that classifies urgency (overdue = red, today/tomorrow = amber, else muted); **click-to-open card detail** — the card body opens the editor (fixes discoverability + mobile), with card actions now always-visible on touch (`opacity-100 sm:opacity-0 sm:group-hover:opacity-100`); the editor gained a color palette, a due-date picker (with clear), and **markdown notes** with a Preview toggle (reuses `MarkdownRenderer`); **per-column color** (`PersonalColumn.color`) driving the header dot + top border, set via a palette popover in the column header. Shared `ColorSwatchPicker` primitive added. Backend: schema + migration (card color/dueDate, column color), DTO validation (`IsHexColor`, `IsISO8601`, nullable), service persistence; 24 personal-board unit tests + a new e2e for the color/due flow; 20/20 personal-board e2e green desktop + mobile; web tsc + build clean. Deferred: per-card checklists.
- ✅ **Personal board — column drag-reorder** (2026-07-01) — Columns are now reorderable by a grip handle in each header. Backend: `PATCH /me/personal-columns/reorder` (`{orderedIds}`) rewrites `order` to the array index in one transaction, rejecting partial/foreign/duplicate id sets (400). Frontend: columns wrapped in a horizontal `SortableContext`; each column is a `useSortable` whose drag activator is the grip handle only (cards + header controls keep working); optimistic reorder via `useReorderPersonalColumns`; column ghost in the `DragOverlay`. 3 new backend unit tests (27 total), reorder verified end-to-end via a real Playwright mouse-drag; existing 20 personal-board e2e stay green desktop + mobile.
- ✅ **Pass-10 audit hardening batch** (2026-07-01) — Independent product + engineering audits (docs/AUDIT-*.md Pass 10) surfaced a cluster of small, high-value fixes, all shipped: (1) **personal-board optimistic reorder was a no-op** — drags snapped back until the refetch; `useUpdatePersonalCard.onMutate` now performs a real optimistic move (removes the card, computes a fractional rank via shared `rankBetween`/`rankAfter`, drops it into the target column) so drags land instantly. (2) **Mobile board toolbar overflow** — the trailing button row (Colors/Export/Import/Create) had no wrap and overlapped board content at 393px; now `flex-wrap` on mobile. (3) **Orphaned attachment files on workspace delete** — the DB cascade never unlinked on-disk files; `remove()` now collects every attachment `storageKey` under the workspace before deletion and best-effort unlinks them (+ the logo). (4) **`promoteCard` atomicity** — if linking the card back fails after issue creation, the just-created issue is now compensatingly deleted (no orphan, guard preserved). (5) **De-duplicated the accent-color picker** — `QuickLinksMenu` now reuses the shared `ui/ColorSwatchPicker`. Backend 65 unit tests green (new attachment-cleanup test); 121 board + personal-board e2e green desktop + mobile; mobile toolbar fix confirmed by screenshot.
- ✅ **Blocked-issue badge on board cards** (2026-07-01, product-audit Pass-10 #2) — Issue dependencies existed but were invisible while scanning the board. Board cards now show a red **Blocked** badge (with a count when >1) when the issue has unresolved blockers. Backend: board `issueInclude` adds a Prisma filtered `_count` on `linksTo` where `type = BLOCKS` (BLOCKS is stored canonically blocker→blocked, so the *target* is the blocked issue); `toIssueDto` maps it to `IssueDto.blockedByCount` (shared type added). Frontend: `IssueCard` renders `data-testid="issue-blocked-badge"`. Verified end-to-end (link → board shows badge on the blocked card only) + new board e2e; 46 board e2e green desktop + mobile; api/web tsc clean.
- ✅ **Custom fields pinned on board cards** (2026-07-01, product-audit Pass-10 #3) — Custom fields were invisible without opening each issue. A field can now be flagged **Show on board cards** (`CustomFieldDefinition.showOnCard` + migration); flagged fields render their value as a compact `label: value` chip on the card face (respecting `appliesToTypes`, hidden when empty). Backend: shared DTO + mapper + create/update DTO/service. Frontend: a "Show on board cards" toggle in the custom-fields settings (create + edit) with an "· On card" hint in the field list; a `CardFieldDefsContext` provides the `showOnCard` defs at the board root so `IssueCard` (columns, swimlanes, drag overlay) renders chips without prop-drilling. Verified end-to-end (field → value → chip, screenshot) + new board e2e; 43 custom-field unit tests green; api/web tsc clean.
- ✅ **Workspace selector correctness fix** (2026-07-01) — QA of the workspace switcher (edge cases + navigation tracking) surfaced four real "the chip lies about where you are" bugs, all reproduced with Playwright and fixed: (1) **two unsynced selectors** — the header chip (`WorkspaceContext`) and the dashboard's own `<select>` were independent state, so changing one never updated the other; (2) **switching the chip did nothing to content** — it only re-themed the header while you kept looking at the previous workspace; (3) **no persistence** — every reload reset you to the first workspace, discarding your selection; (4) **chip misreported the current workspace** — opening a project board never synced the chip to that project's workspace. Fixes: `WorkspaceContext` is now the single source of truth, **persisted to `localStorage`** (`nl.activeWorkspaceId`) and restored synchronously on load, healing to the first workspace only when the stored one is gone (covers delete-active-workspace); `PulseDashboardPage` reads/writes the context instead of a local `selectedWs`; switching via the chip **navigates home** so the content re-scopes; a reusable `useSyncActiveWorkspace(workspaceId)` hook keeps the chip honest on every project-scoped page (board, backlog, triage, settings, standups, poker, automations). Verified: 7/7 QA scenarios green (incl. single-workspace user + delete-active heal), desktop + mobile; web tsc + build clean; 40 desktop + 17 mobile e2e (pulse-dashboard, board, board-switcher, auth, my-work, personal-board, realtime-auth) green — no regressions.
- ✅ **QA gate hardening: cross-page state coherence** (2026-07-01) — The selector bug cluster passed every per-page test because no gate ever tracked state ACROSS navigation. Closed the process gap: (1) permanent regression suite `apps/web/e2e/workspace-switcher.spec.ts` (7 scenarios × desktop + mobile = 14 checks: chip/dashboard agreement, switch-via-either-surface re-scopes content, reload persistence, deep-link chip sync, delete-active-workspace heal, single-workspace chip-as-link; parallel-safe via unique workspace names — creating same-named workspaces concurrently exposes a `uniqueSlug` read-then-write race in the API, filed to backlog); (2) `qa-tester` agent charter + `playwright-qa` skill now make the cross-page coherence matrix (change on A → check B; navigate; reload; deep-link; delete-entity heal) MANDATORY for any global/stateful UI; (3) CLAUDE.md principle #2 names the bug class. 14/14 green twice consecutively.
- ✅ **Personal board: spaces swallowed in edit modal** (2026-07-02, founder-reported) — Typing a space in the card edit modal (title or notes) produced nothing ("twowordshere"): dnd-kit's `KeyboardSensor` treats Space/Enter keydown as a drag activator and preventDefaults it; the edit modal renders inside the sortable card wrapper, and React PORTAL events bubble through the React tree, so every space typed in the modal reached the sortable's keydown listener. Fix: new shared `EditableSafeKeyboardSensor` (`apps/web/src/lib/dndSensors.ts`) that refuses to activate from `input/textarea/select/[contenteditable]/[role=dialog]` targets, swapped into all three DnD surfaces (PersonalBoardPage, BoardPage, BoardSwimlanesView) — keyboard-accessible dragging is preserved. Reproduced with per-keystroke Playwright typing before the fix, verified after (composer/title/notes/rename all accept spaces). Permanent regression e2e added ("typing REAL keystrokes with spaces works in the edit modal" — uses `pressSequentially`, since `.fill()` is exactly what masked this bug); personal-board suite 22/22 green desktop + mobile.
- ✅ **Workspace slug-creation race fix** (2026-07-02) — `WorkspacesService.create` used find-then-insert for slug uniqueness; two concurrent creates with the same name both saw the slug free and the loser surfaced a spurious 409/500 (observed empirically under parallel e2e workers). Now catches Prisma P2002 and retries with a fresh suffix (bounded). 3 new unit tests; 1338 API tests green.
- ✅ **Workspace chip sync — remaining seven pages** (2026-07-02, both Pass-11 audits, P1) — The `useSyncActiveWorkspace` fix from the earlier selector-correctness pass had only been wired into 8 of 15 workspace/project-scoped pages; on deep-link, bookmark, or back/forward navigation to Reports, Roadmap, Project Analytics, Workspace Members, Workspace Audit Log, Workspace Settings, or Workspace Branding, the header chip could still misreport the active workspace. Wired `useSyncActiveWorkspace(workspaceId)` into all seven (project-scoped pages source `workspaceId` from `useBoard(...).data?.project.workspaceId`; workspace-scoped pages source it directly from the route's `useParams`). Also removed a surprising side effect in `WorkspaceBrandingPage`: saving/resetting the brand color used to call `setActiveWorkspaceId(workspaceId)` as a byproduct of the mutation — now redundant since the page syncs on load, so it's gone. Deleted `DashboardPage.tsx`, confirmed-dead code (unreferenced anywhere) that re-implemented the original unsynced-selector bug. Extended `workspace-switcher.spec.ts` with a deep-link-to-workspace-settings regression case (17/17 green desktop + mobile); `tsc --noEmit` clean.
- ✅ **Blocked badge clears when the blocker is resolved** (2026-07-02, eng-audit Pass-11 P2) — The board's `blockedByCount` counted every BLOCKS link regardless of the blocker's status, so the red Blocked badge stayed forever even after the blocking issue was Done. The filtered `_count` now adds `source: { status: { category: { not: DONE } } }`. Board e2e extended: after moving the blocker to Done the badge disappears on reload. 43 board unit tests + 66 board/workspace-switcher e2e green desktop + mobile.
- ✅ **Route-derived scoped layouts — tenant context correct by construction** (2026-07-02, Ready #1) — `ScopedLayouts.tsx`: `/projects/:id/*` and `/workspaces/:id/*` now render through `ProjectScopedLayout`/`WorkspaceScopedLayout`, which own the workspace-chip sync; the 15 per-page `useSyncActiveWorkspace` calls are gone, so route #16 can't reintroduce the bug class. Parameterized class-guard e2e asserts the chip matches the URL's workspace on all 14 scoped routes (workspace-switcher 18/18 desktop+mobile).
- ✅ **SSO/OIDC — Phase 1: generic OIDC login provider** (2026-07-02, Ready #2) — env-configured single provider (`OIDC_ISSUER_URL`/`OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET`, optional `OIDC_BUTTON_LABEL`/`OIDC_REDIRECT_URI`; OFF unless all three required vars are set). `OidcModule` (`apps/api/src/auth/oidc/`) via `openid-client@5`: `GET /auth/oidc/login` (PKCE + state/nonce, signed short-lived httpOnly state cookie, redirects to the provider) + `GET /auth/oidc/callback` (state/nonce CSRF guard, token exchange, rejects unverified emails, JIT-provisions by email, issues the same JWT password login issues); both 404 when unconfigured. `GET /auth/providers` public capability probe; `LoginPage` renders "Continue with `<label>`" only when enabled; new SPA route `/login/sso-complete` completes the redirect. 41 new unit tests (`openid-client` mocked, no network); 1375 API tests green; `apps/web/e2e/sso.spec.ts` (button-absent + endpoint-404 when unconfigured) green desktop+mobile. SAML, multi-provider, and per-workspace/role JIT provisioning are the tracked Phase 2 follow-up.
- ✅ **Workspace switcher search/filter + recently-visited** (2026-07-02, Next-P2) — the chip dropdown gains a case-insensitive, autofocused, per-keystroke search box + a scrollable list once a user has >8 workspaces, plus a localStorage-backed "Recent" section (last 3 switched-to, excluding the active one); all existing `workspace-chip`/`workspace-switcher-item` test hooks and footer links preserved; 2 new e2e (desktop+mobile) in `workspace-switcher.spec.ts`.
- ✅ **Mobile breadcrumb: project name wins the space** (2026-07-02, Ready #4) — the project breadcrumb ("Projects / {name}") now wraps to its own full-width row below the icon row at mobile widths instead of competing inline with the workspace chip + action icons; a shared `<ProjectBreadcrumb>` component (11 project-scoped pages migrated) collapses "Projects" to a back-chevron icon and hides secondary badges on mobile so the project name — the primary "where am I" signal — is never truncated below ~15 characters; verified with a 393px Playwright text-content assertion (`mobile-breadcrumb.spec.ts`) and a desktop no-regression check.
- ✅ **Settings robustness pass — fix batch** (2026-07-02, founder-flagged, half of the "Settings/Workflows robustness pass" item below) — the `qa-tester` sweep (`docs/UI-REVIEW.md` "Settings robustness sweep — 2026-07-02") found 4 confirmed defects across every project-/workspace-settings surface; all fixed same day. **SETTINGS-1 (P1, admin lockout)**: the workspace Invite form's `addMember` upserted-by-email with no last-admin guard, so a solo admin re-typing their own (or any admin's) email into the free-text Invite form silently demoted them with zero recovery path. Fixed: `addMember` (`POST /workspaces/:id/members`) now only creates brand-new memberships — inviting an email that already belongs to a member returns a friendly 409 instead of upsert-demoting; role changes for existing members moved to a dedicated `PATCH /workspaces/:id/members/:membershipId`; both that endpoint and `removeMember` now enforce a last-admin invariant (400, friendly message) that also covers self-demotion/self-removal. **SETTINGS-2 (P2)**: the branding accent-color hex input accepted CSS 3-digit shorthand (`#fff`) client-side but the server DTO only accepted 6-digit, so Save round-tripped a raw technical 400; the client now normalizes 3-digit → 6-digit before submit (or shows a friendly inline message for genuinely invalid input). **SETTINGS-3 (P2)**: `statuses.service` now rejects a case-insensitive duplicate column name within a project (409, friendly), mirroring Labels/Components/Versions — a service-level check only (no DB `@@unique`, since existing self-hosted installs may already have duplicate column names). **SETTINGS-4 (P2)**: `labels.service` now catches the Prisma P2002 unique-constraint error on create/update and throws a friendly `A label named "X" already exists in this project` instead of the generic fallback message. Plus a P3 polish pass rewording leaked DTO-field/enum-name validation messages (GitHub `repoFullName`, custom-field type name, branding hex) into user voice. All 4 `test.fixme()` regression tests in `apps/web/e2e/settings-robustness.spec.ts` un-fixme'd and green desktop + mobile (20/20 total in that spec); 23 new API unit tests covering every guard branch (existing-member invite, last-admin demote, last-admin remove, non-last-admin demote-still-works, duplicate-name guards, friendly-conflict guards); 1461 API unit tests green; `api`/`web` `tsc --noEmit` clean.
- ⬜ **Navigation & IA overhaul** (founder-flagged 2026-07-02) — root-cause fix for a pattern, not a single bug: three already-shipped capabilities (workspace branding, board default filters, the Gantt-style roadmap timeline) were independently reported as "lost" because none of them live on a persistent nav surface — each is 1-3 clicks deep behind a "More" dropdown, a settings-modal tab, or a chip flyout. Answers the founder's direct "Left navbar needed?" question: **yes**, given the app is now used with many projects and many workspaces per instance and the current top nav collapses horizontally rather than scaling. Scope (two build slices, see `docs/BACKLOG.md` Ready queue for acceptance criteria):
  - ⬜ **Phase 1 — persistent left sidebar framework**: collapsible left sidebar (desktop) / drawer (mobile) with a workspace section (chip + switcher relocated in, branding/admin entry points visible without a submenu), and a pinned/recent-projects list, replacing the current header-only navigation model. Must use the `frontend-design` skill (this is UI-system-wide, not a component patch) and preserve every existing `data-testid`/route/URL so no e2e breaks.
  - ⬜ **Phase 2 — surface the buried features as first-class nav**: per-project view links inside the sidebar (Board / Backlog / Roadmap-Gantt / Reports as direct links, not nested in `ProjectNav`'s "More" dropdown), a workspace admin section with Branding as a direct, visible entry (not chip → dropdown → tab), and a clickable board-toolbar default-filter affordance (the mechanism — `Board.filterQuery` + `BoardSettingsModal` — already ships; this closes the *discovery* gap, including an empty-state "+ Set default filter" prompt when a board has none).
- ✅ **Light / dark mode** (2026-07-02, founder-flagged) — a full dark token palette added at the token layer ONCE so every existing component inherits it for free. `tailwind.config.js`: `darkMode: 'class'`; the `ink`/`slate`/`red`/`amber`/`emerald`/`green`/`blue`/`gray`/`orange`/`signal`/`brand` color scales are now all CSS-custom-property-backed (`var(--nl-<name>-<shade>)`) via a `withOpacity()` helper that restores Tailwind's `/NN` opacity-modifier support through `color-mix()` (the vars themselves stay plain hex strings — `getComputedStyle(...).getPropertyValue('--nl-signal-600')` still returns e.g. `#2563eb`, so `workspace-branding.spec.ts`'s existing assertions are unaffected). `index.css`: light values are byte-identical to the previous static Tailwind palette; a new `.dark { }` block redefines every var with deliberately-designed dark values (ink-scale roles fixed across modes — 50/100 wash, 200/300 border, 400-600 muted→secondary text, 700-900 body→primary text; canvas `#0d0f14` → surface `#141821` → surface-raised `#181c26` → surface-overlay `#1b202b`; semantic red/amber/emerald/green/blue/orange scales re-derived from their unchanged 600 anchor, mixing sub-anchor shades toward the dark canvas and super-anchor shades toward a bright paper tone instead of white/black — verified ≥4.5:1 contrast for every text-role pairing against both canvas and surface); shadows swap soft ambient blur for a 1px border-tinted shadow in dark (`--nl-shadow-*` vars); a new `scrim` token (mode-invariant, decoupled from `ink-900` specifically so modal backdrops never invert) and `surface`/`canvas` tokens replace ~190 hardcoded `bg-white`/`ring-white` usages app-wide. `applyBrandColor.ts` is now dark-mode-aware: it detects the `.dark` class and mixes a custom workspace brand color toward the dark canvas/paper endpoints instead of white/black, so a custom accent composes correctly with dark mode. `PulseDashboardPage` (explicitly flagged) migrated off `slate-*` to the `ink-*` vocabulary; `BulkActionBar`'s always-dark floating command strip pinned to literal (mode-invariant) hex so it doesn't invert when the app itself goes dark. Mode control: `ThemeContext` (`nl.theme` in localStorage: light/dark/system, default system), an inline bootstrap `<script>` in `index.html` applies the class before first paint (no flash), a `ThemeToggle` (Light/Dark/System) in both the sidebar utility area and the header user menu. New `apps/web/e2e/theme.spec.ts` (10 checks desktop+mobile: default-light, toggle+persist+reload, brand-var-format-unaffected, System-follows-emulated-`colorScheme`, mobile-reachable) plus the full nav-sidebar/workspace-switcher/board/auth/pulse-dashboard/settings-robustness suites re-verified green (104/104) with zero `data-testid`/role/text regressions; `tsc --noEmit` + production build clean.
- ✅ **Kanban sections by field (Swimlanes v2)** (2026-07-02, founder-flagged — "I want to be able to add sections within the kanban based on fields") — extends the shipped swimlane group-by (`BoardSwimlanesView.tsx` `computeLanes()`, previously Assignee/Priority/Issue type/Epic only) to **Component**, **Sprint**, **Labels**, and every project **custom SELECT field**, plus a **per-board default grouping**. `computeLanes()` stays a pure function, generalized over a `GroupByDimension` union (`assignee|priority|type|epic|component|sprint|label|cf:<fieldId>`); Component/Sprint each get an "unset" lane (`No component`/`No sprint`); **Labels duplicates an issue into every one of its label lanes** (matches the existing multi-label-filter mental model; cross-lane DnD stays structurally out of scope so duplicate membership is safe) plus a `No labels` lane; custom SELECT fields render one lane per configured option (in field order) followed by a `None` lane, with stale option values (since removed from the field) still surfaced rather than silently dropped. Lane headers gain an optional color dot (`lane.color`) for label lanes. **Schema (additive):** `Board.defaultGroupBy String?` (migration `20260702020000_board_default_group_by`) — one of the core dimension keys or `cf:<fieldId>`, validated server-side (`updateBoard`) against the project's real SELECT fields; a board's issue query also now includes `component` (previously missing from `issueInclude`, so cards never carried component data on the board view either). **Frontend:** `GroupBySelector` lists the new dimensions with a "Custom fields" section separator and stable `groupby-option-<value>` test ids; `BoardSettingsModal`'s General tab gains a "Default grouping" `<select>` (`board-default-groupby`); URL persistence stays `?group=<dimension>` (`cf:<fieldId>` round-trips through the URL/board default identically); a board with no `?group=` param falls back to its `defaultGroupBy`, an explicit `?group=<dim>` always overrides it, and a new `?group=none` sentinel lets a user explicitly turn grouping off even when a board default is configured (a bare cleared param would just re-apply the default). Shared `apps/web/src/lib/groupByDimensions.ts` keeps the toolbar picker and the settings select in lockstep. 15 new API unit tests (`updateBoard defaultGroupBy validation` — every core dimension, `cf:<id>` for a same-project SELECT field, rejects unknown/foreign/non-SELECT fields, null clears without a DB round-trip; 1519 API tests green); `update_board` MCP tool extended with `defaultGroupBy`. 3 new/extended `apps/web/e2e/swimlanes.spec.ts` cases (group by component incl. "No component"; group by a custom SELECT field incl. "None", reload-persisted; per-board default grouping applies on fresh load, `?group=` URL override wins, reload persists the override, explicit None overrides a configured default) plus the full `board.spec`/`board-switcher.spec`/`nav-sidebar.spec`/`components.spec`/`custom-fields.spec`/`dashboards.spec` regression suites, all green desktop+mobile; `api`/`web`/`mcp` `tsc --noEmit` clean; screenshots verified light+dark. [founder directive 2026-07-02]
- ✅ **Workflows robustness pass — fix batch** (2026-07-03, founder-flagged, workflow-builder half of the "Settings/Workflows robustness pass" item, whose Settings half shipped 2026-07-02) — the `qa-tester` sweep (`docs/UI-REVIEW.md` "Workflows robustness sweep — 2026-07-02") found 5 confirmed defects (WF-1..WF-5) across the named-workflow manager, the gate editor, the graph builder, and — the headline finding — enforcement across every status-change surface; all fixed same batch. **WF-1 (P1)**: Triage's `s` picker, the issue drawer's Status `<select>`, and bulk edit all silently bypassed a board's enforced named workflow (only board drag/the card status picker enforced it). Fixed: a single shared `IssuesService#enforceStatusChange()` now backs `move()`/`update()`/`bulkUpdate()` — with no explicit `boardId` it resolves the project's enforced board-assigned workflow via `resolveEnforcedWorkflowId()` (mirrors the board query's own KANBAN/SCRUM visibility rule; ties break to the default board), only falling back to the legacy project-level path when none resolves; automation bypass preserved. **WF-2 (P2)**: the REQUIRE_FIELD gate's custom-field mode could never actually succeed via the documented UI flow (`Issue.customFields` stored by definition id, gate configured by human key/name). Fixed: `WorkflowService.evaluateGate` now resolves `field` against `CustomFieldDefinition.key`/`name` (case-insensitive) to the definition id, with backward-compatible direct-match short-circuit; the gate editor's field input is now a `<select>` of core + real custom fields, not freeform text. **WF-3 (P2)**: a REQUIRE_FIELD/REQUIRE_LINK gate could be saved with a blank param and silently never gate anything; now rejected with 400 (`@MinLength(1)`), Save disabled client-side until a field is chosen, and any already-stored blank-key gate shows a "misconfigured" warning chip. **WF-4 (P2)**: added inline rename for named workflows (pencil → per-keystroke input, Enter/blur saves, Escape cancels, friendly 409). **WF-5 (P3)**: disambiguated the legacy vs. named workflow systems (heading + explainer + link, distinct "+ Add transition" accessible names). All 12 `test.fixme()` tests in `apps/web/e2e/workflow-robustness.spec.ts` un-fixme'd, 42/42 green desktop+mobile; `board-workflows.spec.ts`/`board.spec.ts`/`workflow.spec.ts`/`workflow-graph.spec.ts` regression green; 1471 API unit tests green; `tsc --noEmit` clean both apps.
- ⬜ **DB schema check-in** (founder asked "are we due for a schema overhaul?"): **no.** The current/upcoming wave is small additive tables/columns only — `Dashboard`/`DashboardGadget` (shipped 2026-07-02, see below), `GithubIntegration`/`IssueGithubLink` (Phase 9 kickoff, mid-flight), `Board.defaultGroupBy String?` (Swimlanes v2, shipped 2026-07-02, see the ✅ entry above) — the existing Prisma model holds. Light/dark mode (shipped 2026-07-02) confirmed no schema change was needed after all: the theme preference is a client-only concern, persisted to `localStorage` (`nl.theme`), matching the existing `nl.activeWorkspaceId`/`nl.sidebarCollapsed` pattern — no server-persisted column added.
- ✅ **Configurable dashboards — Phase 1: NLQL-native gadget framework** (2026-07-02, rescoped per founder directive — "custom dashboards based on the query language") — closes the flat-3 reporting/admin parity gap flagged across four consecutive audit passes (8/9/10/11). Every gadget — STAT/TABLE/BREAKDOWN/BURNDOWN — is defined identically: an NLQL `query` string (validated + evaluated through the exact shared `validateQuery`/`filterIssues` engine, no parallel query path) plus a `visualization` + a small JSON `config` (grid position/size, and per-viz settings: `field` for BREAKDOWN, `columns`/`limit` for TABLE). **Schema (additive):** `Dashboard` (`id`, `projectId`, `name`, `order`) and `DashboardGadget` (`id`, `dashboardId`, `title`, `query`, `visualization` enum, `config` Json), both `onDelete: Cascade`, migration `20260702010000_add_dashboards`. **Backend** `apps/api/src/dashboards/`: project-scoped dashboard CRUD (VIEWER read / MEMBER+ write, mirrors the Board module's role gating) + gadget CRUD nested under a dashboard; `GET /dashboards/:id/data` loads the project's issues once (capped at `DASHBOARD_ISSUES_CAP=2000`, `issuesTruncated` flag) and evaluates every gadget server-side — STAT → count; TABLE → capped issue rows (key/title/status/assignee/points); BREAKDOWN → counts grouped by a standard field (status/assignee/priority/type/label/component) or a custom SELECT/MULTI_SELECT field; BURNDOWN → resolves the single sprint the gadget's filtered issues belong to and reuses `ReportsService.burndown()` verbatim. A gadget with invalid/now-unresolvable NLQL (e.g. a referenced custom field later deleted) or missing config never 500s — it returns a per-gadget `{ error }` payload instead, so one bad gadget can't break the dashboard. 40 new unit tests (evaluator pure-function tests + service tests incl. tenant isolation via the shared `assertProjectMember`/`assertProjectRole` utilities) — 1551 API tests green. **Shared types + MCP**: `DashboardDto`/`DashboardGadgetDto`/`DashboardDataDto` family in `packages/shared`; 9 new `@next-lane/mcp` tools (`list_dashboards`, `get_dashboard`, `get_dashboard_data`, `create_dashboard`, `update_dashboard`, `delete_dashboard`, `create_dashboard_gadget`, `update_dashboard_gadget`, `delete_dashboard_gadget`) — 85 tools total (36 read / 49 write); `apps/mcp/README.md` tables updated; 59 MCP tests green. **Frontend**: "Dashboards" added to the sidebar's per-project `ProjectViewsSubNav` (`nav-sidebar-view`) and `ProjectNav`'s "More" menu; new route `/projects/:id/dashboards` (`DashboardsPage`, `dashboard-page`) — dashboard tabs, a CSS-grid gadget board (1/2-column span via `config.size`), create/edit gadget modal reusing the exact `NlqlInput` autocomplete (`gadget-query-input`) + a visualization picker + per-viz config fields, up/down reorder (writes `config.position`, no drag in v1), STAT (big mono number), TABLE (compact rows), BREAKDOWN (horizontal bars), and BURNDOWN (reuses the existing `BurndownChart` SVG component) renderers; VIEWER sees every gadget but no add/edit/delete/reorder affordance; Dispatch tokens throughout (light+dark verified via screenshots, no new palette). 10 new `apps/web/e2e/dashboards.spec.ts` tests (desktop+mobile: create dashboard → STAT gadget with a per-keystroke-typed NLQL query → value matches seeded data; BREAKDOWN-by-status bars; a gadget whose query references a deleted custom field shows a friendly per-gadget error, not a crash; VIEWER read-only; 393px no horizontal overflow) all green; `nav-sidebar`/`workspace-switcher`/`board` regression suites re-verified green; `tsc --noEmit` + build clean both apps. Phase 2 (more visualization types, cross-workspace gadget scoping) is the tracked follow-up — see `docs/BACKLOG.md` Next (P2). [product-auditor Pass 8/9/10/11 flat-3 finding; VISION.md § Better-than-Jira gaps #4; founder directive 2026-07-02]
- ✅ **Per-project role override — schema + backend (Phase 1 of 2)** (2026-07-02) — additive `ProjectMembership(projectId, userId, role)` override table (sparse; absence = inherit workspace role) resolved through a single `getEffectiveProjectRole` helper that every project-scoped `assertProjectRole` call already routes through — zero call-site changes needed beyond the shared helper itself. Elevates (MEMBER -> project ADMIN) or restricts (MEMBER -> project VIEWER, still read-only) a user's access to one project; workspace ADMINs always retain full access (a stray override row is ignored); a `ProjectMembership` row alone never grants access without workspace membership (tenant isolation). REST: `GET`/`PUT`/`DELETE /projects/:id/members[/:userId/role]` (`ProjectMembershipsController`, effective-project-ADMIN gated, audit-logged). MCP: `list_project_role_overrides`/`set_project_role_override`/`remove_project_role_override` (88 tools total). 13 new service unit tests + 9 new `membership.util` cases + 3 new tenant-isolation-matrix rows — 1575 API tests green. **Frontend UI (Phase 2 of 2) — ✅ shipped 2026-07-02, see below.**
- ✅ **Per-project role override — frontend UI (Phase 2 of 2)** (2026-07-02) — new "Members" section on the project Settings page (`apps/web/src/components/settings/MembersSection.tsx`, rendered between Project details and Columns in `SettingsPage.tsx`), consuming the Phase 1 REST surface as-is (zero backend changes). Lists every effective member (avatar/name/email, workspace-role chip, effective-role control, "Inherited"/"Override" badge); an effective-project-ADMIN viewer gets a role `<select>` per row (ADMIN/MEMBER/VIEWER, no-op skipped when unchanged) plus a "Revert to inherited" action behind a `ConfirmDialog` on overridden rows; a workspace ADMIN's row is a disabled fixed-ADMIN control with a tooltip mirroring the server's 400; the viewer's own row is never self-editable (mirrors `WorkspaceMembersPage`'s "isMe" convention — avoids an accidental project-access self-lockout); non-project-admin viewers see the identical list fully read-only; a solo-member project shows a "No other members" empty state. New `apps/web/src/api/projectMembers.ts` (`useProjectMembers`/`useSetProjectRoleOverride`/`useClearProjectRoleOverride`, `qk.projectMembers(projectId)`, invalidate-on-settle). New `apps/web/e2e/project-members.spec.ts` — 4 scenarios × desktop 1280 + mobile 393 (8/8 green): admin sees the inherited list; setting a VIEWER override flips the badge AND is proven as a **real** access change (a second, independent browser session as the target member creates an issue successfully before the override — positive-control baseline — then, after the override, the identical real-UI per-keystroke create-issue attempt gets a genuine 403 toast, "Requires MEMBER role in this project", with no issue created — not a cosmetic badge check); revert restores both the badge and write access (re-verified the same way); a workspace-ADMIN row's control is confirmed disabled with the tooltip; a non-admin viewer gets a fully read-only list. Mobile: the row layout switches `flex-col` → `sm:flex-row` below the `sm` breakpoint so name/email never gets crushed by the fixed-width role controls (caught + fixed via this pass's own screenshot review). `tsc --noEmit` + `pnpm --filter @next-lane/web build` clean; `settings-robustness.spec.ts`/`components.spec.ts`/`viewer-aware-ui.spec.ts`/`board.spec.ts` regression re-verified green desktop+mobile (44/44). MCP: already covered by the Phase 1 backend batch, no new tools needed. **Closes the "Admin controls" Better-than-Jira gap alongside the in-app SSO/OIDC config screen** — see `docs/VISION.md` § Better-than-Jira scorecard. [product-auditor Pass 9/10/11/12 carryover; VISION.md § Better-than-Jira gaps #2]
- ⬜ **Remaining parity gaps**: personal-board per-card checklists. (SSO/OIDC Phase 2 shipped 2026-07-06 — see § Current focus; configurable-dashboards Phase 2 shipped 2026-07-03 — see the ✅ entry above.)

## Phase 6 — Autopilot: a self-hosted AI teammate 🔭 (vision)

The unfair advantage of a free, self-hosted, MIT tracker: **AI that is private,
unlimited, and $0** because it runs on *your* hardware. Points at a local LLM
(Ollama) or a bring-your-own key — no data egress, no per-seat AI metering. This
is the headline differentiator the cloud-first incumbents structurally can't match.

- ⬜ **Natural language → NLQL.** "overdue bugs assigned to me in the mobile component" compiles to a safe NLQL query (Phase 5 gives the execution target; the model only translates).
- ⬜ **Auto-triage on create** — suggested type / priority / component / assignee / labels, with **semantic duplicate detection** (add `pgvector` embeddings on top of the existing Postgres FTS/GIN index).
- ⬜ **Sprint risk radar + summaries** — "this sprint will miss by ~6 pts; blocker is NL-142"; auto standups and release notes generated from closed issues.
- ⬜ **MCP-native** — ship Next Lane as an **MCP server** so AI coding agents (Claude Code, etc.) read & write issues directly from the IDE (file bugs, move cards, close tickets as they code). No paid tracker is MCP-native today.
- ✅ **MCP coverage parity sweep** shipped 2026-07-02 (founder-flagged — "most should be wired into the mcp") — `@next-lane/mcp` had grown organically from the 18 tools first shipped (2026-06-29, Phase 5) to 55 tools without a standing process keeping it in lockstep with new features. Audited all 55 against the shipped feature surface (full gap table in `docs/BACKLOG.md`) and closed every gap the founder directive scoped: GitHub links (read-only — configuring the integration stays out, admin-only + secret-bearing), quick links, personal boards, issue templates, the time-tracking estimate field, CSV export, bulk update, project/personal analytics + velocity/burndown/CFD reports, and notifications. 21 new tools + a parity fix to `create_issue`/`update_issue` bring the total to **76** tools (33 read / 43 write); live-smoked end-to-end against the running API before commit. **Standing rule (now in effect):** every new feature's definition of done includes MCP exposure where it makes sense, so this gap doesn't reopen — future feature work should add its own tool(s) as part of the same PR, not accrue into another backlog sweep.
- ⬜ **Privacy posture** — all inference local by default; a hard "no external calls" switch for regulated installs; per-workspace model/endpoint config.

## Phase 7 — Glass Box: unlimited automation + data ownership 🚧 (in progress)

Everything the incumbents meter or lock away, given freely because it's self-hosted.

- ✅ **Automation engine** (frontend + backend shipped 2026-06-28) — `AutomationsPage` (rule list + enable/disable toggle + run-log tab), `AutomationRuleEditor` modal (name/desc/enabled/trigger/NLQL condition/ordered actions builder with member/status/label/priority/custom-field pickers), `AutomationRunsPanel` Glass Box audit trail (rule name, issue key, trigger, match result, status badge, actions applied, error, timestamp). Backend: `AutomationEngineService` (`@OnEvent` listeners for ISSUE_CREATED/UPDATED/TRANSITIONED/COMMENTED; NLQL condition evaluation via shared evaluator; loop guard `if (event.automated) return`; Glass Box `AutomationRun` logging SUCCESS/SKIPPED/FAILED); `AutomationsService` CRUD (7 REST endpoints, NLQL validation at write-time); EventEmitter2 seams on `IssuesService.create/update/move` + `CommentsService.create`; 37 unit tests (668 total). Conditions reuse the NLQL evaluator (Phase 5). Unlimited runs vs per-seat metering; full audit of every execution. 10 Playwright e2e tests (desktop + mobile). Carry-forward: scheduled/time-based triggers (SLA escalations, stale-issue nudges) remain ⬜.
- ⬜ **Rule library + templates** — common automations one-click installable; rules are versioned and inspectable.
- ⬜ **True data ownership** — read-only SQL access / warehouse export of your own tracker data, plus shippable Grafana dashboards (pairs with the Phase 4 `/metrics` + observability work). Your data, your queries, no export tax.

## Phase 8 — The Unbundle 🔭 (vision)

Bundle, for free, what the incumbents sell as *separate paid products*. One
self-hosted app replaces a tracker + a wiki + a whiteboard + a feedback tool.

- 🚧 **Docs / wiki ("Pages")** — promoted to its own pillar and phase given the crown-jewel MCP + knowledge-graph angle: see **Phase 11 — Pages: a Confluence × Obsidian hybrid, agent-traversable**, below, and `docs/VISION.md` § The pillars, item 7. (Kept as a Phase-8 bullet for continuity with the original Unbundle framing — not duplicated content, just cross-referenced.)
- ⬜ **Whiteboard / story-mapping canvas** — infinite canvas for planning, story maps, and retros; cards can promote to real issues; realtime multi-cursor via the existing Socket.io layer.
- ⬜ **Public roadmap + feature-voting portal** — publish a project as a customer-facing roadmap with upvotes and status; built on the existing share-token mechanism. A whole separate SaaS, free, for OSS maintainers & product teams.
- ⬜ **Intake forms** — public, brandable submission forms that create pre-triaged issues (support/bug/feature intake); self-serve helpdesk-lite.

## Phase 9 — Developer Graph (SCM integrations) 🚧 (in progress)

The tracker that actually knows your code — and works with **self-hosted**
forges, not just the big clouds.

- 🚧 **GitHub integration — v1 kickoff (two-way link)** ✅ shipped 2026-07-02 — per-project repo link (`GithubIntegration`: repoFullName + AES-256-GCM-encrypted PAT + generated HMAC webhook secret; `IssueGithubLink`: PR/COMMIT/BRANCH, unique on `[issueId, kind, externalId]` for idempotent re-delivery). Backend `GithubModule` (`apps/api/src/github/`): ADMIN-gated `PUT/GET/DELETE /projects/:projectId/github` (GET returns a role-shaped DTO — full config incl. webhook secret for ADMIN, read-only summary for MEMBER/VIEWER); public `POST /github/webhook/:projectId` verifies `X-Hub-Signature-256` HMAC (constant-time compare) against the raw request body (`main.ts` `rawBody: true`) before processing `push` (per-commit + branch-name key scan → COMMIT/BRANCH links) and `pull_request` (title + head-branch key scan → PR links, state open/closed/merged) events; issue-key extraction (`NL-123`) is regex-scoped to the target project's own key so foreign-project keys never match; `GithubClient` is the single injectable seam for any future outbound GitHub API call (unused by any v1 endpoint — webhook payloads carry everything v1 needs — but unit-tested/mockable so later PR/CI-status polling has one auditable entry point, matching the network-isolated build/test environment). `GET /issues/:issueId/github-links` (MEMBER+). Frontend: Settings "GitHub" section (ADMIN form + generated webhook URL/secret with copy buttons + paste-into-GitHub instructions; read-only "Connected to owner/repo" summary for members, hidden entirely when unconfigured) and a "Development" section in the issue drawer (PR/commit/branch rows with state badges, external links; hidden when no links); realtime — webhook-driven upserts reuse the existing `issue.updated` socket event (minimal `{id}` payload) so an open drawer refreshes live. Two new PAT scopes (`github:read`/`github:write`). 63 new unit tests (signature verification valid/invalid/missing/tampered, issue-key extraction incl. multi-key commits + wrong-project-ignored + case-insensitive + word-boundary, upsert idempotency, ADMIN gating, tenant isolation, AES round-trip, GithubClient mocked-fetch) — 1440 total API tests green; `apps/web/e2e/github-integration.spec.ts` (4 scenarios × desktop + mobile: settings save + webhook URL/secret display, signed-webhook-links-issue end-to-end via a locally-computed HMAC fixture — no GitHub egress, invalid-signature rejected 401, member read-only view) all green; `tsc --noEmit` clean both apps. Auto-transition-on-merge, live CI status, and smart-commit `#done` syntax are the tracked Phase-9 follow-up slice (not v1 scope — see `docs/BACKLOG.md`). [P1, M — VISION.md § Better-than-Jira gaps #3]
- 🚧 **GitLab integration — v1 (two-way link)** ✅ shipped 2026-07-03 — same two-way linking shape as the GitHub v1 above, GitLab semantics, as a parallel `GitlabIntegration`/`IssueGitlabLink` table pair (additive, zero-risk to the already-shipped GitHub rows — not a provider-tagged generalization; that unification remains an option once Gitea lands and the duplication cost outweighs the migration risk). `gitlabBaseUrl` defaults to `https://gitlab.com` but is a first-class per-project field (self-hosted GitLab is core to Next Lane's audience, unlike GitHub's hardcoded host); `projectPath` supports nested subgroups (`group/subgroup/project`). Backend `GitlabModule` (`apps/api/src/gitlab/`): ADMIN-gated `PUT/GET/DELETE /projects/:projectId/gitlab` (GET role-shaped via `getEffectiveProjectRole` — full config incl. webhook secret for the caller's effective project ADMIN, summary otherwise); public `POST /gitlab/webhook/:projectId` verifies the literal `X-Gitlab-Token` header via `crypto.timingSafeEqual` (GitLab does not sign its payloads, unlike GitHub's HMAC — this is a length-guarded constant-time equality check) before processing `Push Hook` (commit + branch-name key scan → COMMIT/BRANCH links) and `Merge Request Hook` (title + description + source-branch key scan → MR links, state normalized `opened→open`/`merged`/`closed`/`locked`) events; issue-key extraction now lives in a shared `common/issue-key.util.ts` (extracted from GitHub's own util, which re-exports it unchanged) so both providers share one scoping implementation. `GitlabClient` mirrors `GithubClient`'s unused-in-v1-but-tested seam, parameterized on `baseUrl` for self-hosted support. `GET /issues/:issueId/gitlab-links`. Two new PAT scopes (`gitlab:read`/`gitlab:write`). Frontend: Settings "GitLab" section (mirrors GitHub's — ADMIN form + generated webhook URL/"Secret Token" + instructions; MEMBER read-only summary) and a "GitLab" Development sub-section in the issue drawer rendered beside GitHub's, so both providers' links are visible when both are configured. 5 new unit-test files mirroring the GitHub coverage depth (token-verify, crypto round-trip, client, 667-line service spec covering real Push/MR-Hook payload shapes + idempotency + tenant isolation) — 1665 total API tests green; tenant-isolation matrix 102/102 endpoints BLOCKED (4 new rows); `gitlab-integration.spec.ts` 10/10 e2e green desktop+mobile (locally token-verified fake webhook, zero GitLab egress); live round-trip verified against the running API (valid webhook → linked, tampered/missing token → 401, replay → idempotent, PAT scope gating → 403/200); `tsc --noEmit` clean both apps. MCP: `list_issue_gitlab_links` (92 tools total, was 91), live-verified end-to-end including the 403 scope-denial path. [P1, M — VISION.md § Better-than-Jira gaps #3]
- ✅ **PR-status + auto-transition-on-merge, with a board-card "linked PR" badge** — shipped 2026-07-03 — makes the shipped GitHub/GitLab link plumbing *act*, not just link. **(1) Auto-transition-on-merge:** additive `autoTransitionOnMerge`/`autoTransitionStatusId` fields on `GithubIntegration`/`GitlabIntegration` (migration `20260703100000_add_pr_auto_transition`), off by default; a token-free `PATCH /projects/:projectId/{github,gitlab}/automation` (separate from the full repo/token save) lets an ADMIN toggle it and pick a project-scoped target status; a `merged` PR/MR webhook event then moves every linked issue via `IssuesService.move(actorId, issueId, {statusId}, {automated:true})` — reusing the existing workflow-transition enforcement path's automation-bypass flag, the exact mechanism the automation engine's own TRANSITION action uses, so enforcement is correctly bypassed and the move is idempotent (a re-delivered webhook or an issue already at the target status is a no-op, never a redundant rank shuffle). No natural human actor exists for a webhook-triggered move, so a new shared `common/automation-actor.util.ts#resolveAutomationActor` falls back through issue assignee → reporter → project lead → the workspace's longest-tenured ADMIN, verified against real workspace membership; every issue's transition attempt is independently try/caught so one ineligible actor never blocks a sibling issue referenced by the same PR, and never fails the webhook response itself. **(2) Board-card badge:** `board.service.ts`'s `issueInclude` gained a compact `githubLinks`/`gitlabLinks` state-only select (the pre-existing `parent` include from `503b48d` deliberately left untouched) aggregated by `issue.mapper.ts` into `IssueDto.prLinkSummary: {open, merged}`; the board card (`IssueCard.tsx`) renders a small "PR"/"Merged" badge (emerald/purple) mirroring the existing blocked-issue badge pattern exactly. **(3) Live PR/CI status:** the first REAL outbound calls through the previously-seamed-but-unused `GithubClient`/`GitlabClient` — `getPullRequestStatus`/`getMergeRequestStatus`, polled on issue-drawer open (`GET /issues/:issueId/{github,gitlab}-links/live`), rendering a small CI-checks dot next to each PR/MR row and degrading gracefully (a quiet "live status unavailable" hint) when the live call fails, e.g. this sandboxed/self-hosted instance has no outbound internet — live-verified: `{"error":"GitHub API unreachable", state:null, ...}` per-link, never a hard failure. **SSRF (mandatory, both clients now share it):** every outbound call goes through the exact `resolveAndCheckBlocked()` DNS-preflight + `redirect:'manual'` guard `webhooks.service.ts` already used for outbound webhook delivery — defense-in-depth for GitHub's fixed host, the PRIMARY risk mitigation for GitLab's admin-supplied self-hosted `gitlabBaseUrl`. **Tests:** 69 new API unit tests (1731→1800, all green) — auto-transition disabled-by-default/enabled/idempotent-no-op/actor-fallback-chain/one-issue-failure-doesn't-block-sibling, `updateAutomation` wrong-project-status-rejected, board-payload `prLinkSummary` aggregation (open/merged/closed-excluded/relation-not-loaded-stays-undefined), both clients' live-status methods with DNS-mocked SSRF-guarded tests (never real egress); 4 new tenant-isolation-matrix rows (108/108 BLOCKED); `apps/web/e2e/pr-auto-transition.spec.ts` (6 cases × desktop+mobile, all green) — badge open→merged flip, settings toggle persists across reload, a **locally-HMAC-signed `merged` webhook drives a real status transition** (verified against the REST issue endpoint, not just the UI), disabled-by-default regression case, mobile badge-renders-without-overflow. **Live end-to-end verification** (real running API + Postgres, not just unit/e2e): registered a fresh user → connected GitHub → enabled auto-transition targeting "Done" → posted a locally-signed `merged` PR webhook → issue's `statusId` flipped to the "Done" status id in the same response cycle; `GET .../github-links/live` correctly degraded with `"GitHub API unreachable"` (zero real egress in this environment, as designed); board payload showed `prLinkSummary: {open:0, merged:1}`. **MCP:** 6 new tools (`get_issue_github_live_status`, `get_issue_gitlab_live_status`, `get_github_automation_config`, `get_gitlab_automation_config`, `set_github_automation_config`, `set_gitlab_automation_config`) — the two `get_*_automation_config` reads are a deliberately NARROWER surface than the REST GET (never return the webhook secret/PAT, even to an admin-scoped token); connecting the repo/token itself remains web-UI-only/not exposed (unchanged, secret-bearing). 104 tools total (was 98). [Ready queue #1 — product-auditor Pass-12 Ideation #2 / Backlog-Groomer Ingest; VISION.md § Better-than-Jira gaps #3]
- ✅ **Gitea integration — v1 (two-way link, third self-hosted forge)** ✅ shipped 2026-07-06 — first-class support for fully self-hosted Git, the combo the cloud incumbents can't credibly serve. Same two-way linking shape as the GitHub/GitLab v1s above; Gitea's webhook scheme is HMAC-SHA256 like GitHub's (`X-Gitea-Signature`, hex-encoded, no "sha256=" prefix), so `GithubModule` was the closer verification-shape template, while the DB tables (`GiteaIntegration`/`IssueGiteaLink`) mirror both providers' parallel-table pattern (a third parallel pair, not yet unified behind a provider-tagged table — still deferred). Additive `GiteaIntegration` (`giteaBaseUrl` REQUIRED — unlike GitLab's gitlab.com-defaulted field, Gitea has no canonical SaaS host; `repoFullName` flat "owner/repo" like GitHub's) / `IssueGiteaLink` (PR/COMMIT/BRANCH, unique `[issueId, kind, externalId]`), migration `20260706000000_add_gitea_integration` (verified zero-drift via `prisma migrate diff`). Backend `GiteaModule` (`apps/api/src/gitea/`): ADMIN-gated `PUT/GET/DELETE /projects/:projectId/gitea` (GET role-shaped via `getEffectiveProjectRole`) + `GET /issues/:issueId/gitea-links`; public `POST /gitea/webhook/:projectId` verifies `X-Gitea-Signature` HMAC-SHA256 (constant-time compare) against the raw body before processing `push` (commit + branch-name key scan → COMMIT/BRANCH links) and `pull_request` (title + head-branch key scan → PR links, state open/closed/merged) events, scoped to the project's own key via the shared `common/issue-key.util.ts`. Two new PAT scopes (`gitea:read`/`gitea:write`), every route scope-gated. **v1 is deliberately links-only** — no auto-transition-on-merge, no live PR/CI status, no outbound `GiteaClient` call (unlike the shipped GitHub/GitLab PR-status follow-up); tracked as a future slice if demand appears. Frontend: Settings "Gitea" section (mirrors Github/GitlabSection — instance URL + owner/repo + token form, webhook URL/secret with copy buttons; MEMBER read-only summary) and a "Gitea" Development sub-section in the issue drawer rendered beside GitHub/GitLab's (three-provider layout), no live-status spinner. 55 new unit tests (signature verification, AES round-trip, ADMIN gating, tenant isolation, push/PR event parsing incl. wrong-project-key scoping + idempotent re-delivery) — 1905 total API tests green (85→88 suites); tenant-isolation matrix +4 rows all BLOCKED, pat-scope-rollout matrix +4 rows DENY+ALLOW — 301 integration tests green; `gitea-integration.spec.ts` 8/8 e2e green desktop+mobile (locally HMAC-signed fake webhook, zero Gitea egress); `github-integration`/`gitlab-integration`/`issue-detail`/`issue-drawer-overlay`/`settings-robustness` regression re-verified green (50/50); `tsc --noEmit` clean both apps. Live round-trip verified against the running API: valid webhook → linked (`linksUpserted:1`); tampered signature → 401; replay → idempotent (same link id, no duplicate); missing-signature push → 401; PAT scope gating → 403 without `gitea:read` (exact scope message) / 200 with it; a cross-project issue key never links. MCP: `list_issue_gitea_links` (105 tools total, was 104), paged, `gitea:read`-scoped; `apps/mcp/README.md` scope/tool tables + counts updated. [ROADMAP Phase 9; VISION.md § Better-than-Jira gaps #3]
- ⬜ **Smart-commit `#done` syntax** — a commit message like "Fixes NL-42 #done" transitions the issue directly, complementing the now-shipped auto-transition-on-merge (which fires on the PR merge event, not individual commits).

## Phase 10 — Team rituals & personal workspace ✅ (complete)

Make Next Lane the place people actually start their day — not just where tickets
live.

- ✅ **Async standups backend** — `StandupsModule` (`apps/api/src/standups/`): `GET /projects/:projectId/standups?date=YYYY-MM-DD` (VIEWER+, team digest ordered by user name), `GET /projects/:projectId/standups/me?date=YYYY-MM-DD` (VIEWER+, caller's entry or null), `POST /projects/:projectId/standups` (MEMBER+, upsert for userId+projectId+date, atomic blocker-link replacement via `$transaction`, validates blockerIssueIds belong to project), `GET /projects/:projectId/standups/prefill` (VIEWER+, derives yesterday from 24-hour ActivityLog + today from assigned IN_PROGRESS issues, no persistence); `toStandupEntryDto` mapper (UTC midnight → YYYY-MM-DD, blockerIssueIds projection, nested user + IssueRefDto with key from project.key+number); 25 unit tests (548 total); `tsc --noEmit` clean. (2026-06-28)
- ✅ **Async standups frontend** — per-project daily standup page (`/projects/:projectId/standups`): date selector (default today, navigate past days); "My standup" editor card with Yesterday/Today/Blockers fields + "Prefill from my activity" button (calls `/prefill` endpoint, seeds form, user edits before saving) + optional blocker-issue picker (combobox → `blockerIssueIds`); save via `useSubmitStandup` (upsert); team digest showing all members' entries with amber blocker emphasis and issue-key links; VIEWER = read-only (editor gated); mobile-friendly; `prefers-reduced-motion` respected; `data-testids`: `standup-yesterday`, `standup-today`, `standup-blockers`, `standup-prefill`, `standup-save`, `standup-entry`, `standup-date`; "Standup" tab in `ProjectNav`; Playwright e2e `standups.spec.ts` (desktop + mobile); build green. (2026-06-28)
- ✅ **Personal boards backend** — `PersonalBoardsModule` (`apps/api/src/personal-boards/`): `GET /me/personal-board` (lazy-init three default columns on first visit, returns PersonalColumnDto[] with cards ordered by rank), `POST/PATCH/DELETE /me/personal-columns` (create at max+1 order, rename/reorder, delete with cascade), `POST/PATCH/DELETE /me/personal-cards` (create at end of column with fractional rank, edit/move with re-rank between `beforeId`/`afterId` neighbors, delete), `POST /me/personal-cards/:id/promote` (create real Issue TASK from card title/notes in a project the caller is a MEMBER+, sets `promotedIssueId`); ownership enforced — every query scoped to caller's userId (404 on foreign ids, no membership checks); 21 unit tests (569 total); `tsc --noEmit` clean. (2026-06-28)
- ✅ **Personal boards frontend** — `/my-board` route + "My Board" nav link in AppHeader; `apps/web/src/api/personal-board.ts` (8 hooks: `usePersonalBoard`, `useCreatePersonalColumn`, `useUpdatePersonalColumn`, `useDeletePersonalColumn`, `useCreatePersonalCard`, `useUpdatePersonalCard`, `useDeletePersonalCard`, `usePromotePersonalCard`; optimistic delete + move); `PersonalBoardPage` — dnd-kit kanban with horizontally-scrollable columns, inline card composer, edit-card modal (title + notes), rename/delete column, keyboard-friendly "Move to column" menu, "Promote to issue" project picker (workspace/project select → toast with issue key), promoted badge; all required `data-testid` hooks; Playwright e2e `personal-board.spec.ts` (desktop + mobile); build green. (2026-06-28)
- ✅ **Personal & team analytics backend** — `AnalyticsModule` (`apps/api/src/analytics/`): `GET /me/analytics?days=N` → `PersonalAnalyticsDto` (open/completed/overdue assigned issues, per-day throughput flow series, avg cycle time, byType/byPriority CategoryCountDto groups, personal board stats); `GET /projects/:projectId/analytics?days=N` → `ProjectAnalyticsDto` (per-day flow series, createdTotal/completedTotal, avg cycle time, all-5-bucket CycleTimeBucketDto distribution with en-dash labels, WorkloadRowDto by assignee busiest-first + Unassigned row); both endpoints use ActivityLog completion-date reconstruction identical to reports.service; `days` defaults to 30, clamped to [1, 366]; 25 unit tests (analytics.service.spec.ts); build + typecheck clean; registered in AppModule. (2026-06-28)
- ✅ **Personal & team analytics frontend** (2026-06-28) — `PersonalAnalyticsPage` at `/me/analytics` (14/30/90-day window selector, headline stat cards, hand-rolled SVG throughput chart, type/priority horizontal bar breakdowns, personal board mini-stats); `ProjectAnalyticsPage` at `/projects/:projectId/analytics` (window selector, headline stats, flow chart, cycle-time distribution, workload bars by assignee); "Analytics" tab in `ProjectNav`; "Insights" link in `AppHeader`; WCAG-AA, accessible charts with visually-hidden summaries; full data-testid coverage; Playwright e2e (desktop + mobile); build green.

## Phase 11 — Pages: a Confluence × Obsidian hybrid, agent-traversable 🚧 (schema + backend module + MCP tools shipped 2026-07-09; org-wide docs schema + workspace-scoped backend + workspace Docs frontend surface shipped 2026-07-10; cross-workspace-safe wiki-link resolution + workspace-wide graph shipped 2026-07-17; cross-project scope-indicator/link-routing frontend shipped 2026-07-17 — founder directive 2026-07-06, scope sharpened 2026-07-09, org-wide 2026-07-10; **item 18 — workspace-docs MCP traversal tools + search scoping — shipped 2026-07-30**, so every numbered slice in this phase is now ✅. Phase status left 🚧 pending an orchestrator close-out pass; the follow-up recall work — ranked search snippets and a real result cap, `docs/RESEARCH-AGENT-MEMORY.md` R1 — is tracked separately, not as a Phase 11 slice.)

**Founder directive, verbatim (2026-07-06): "How can we add a confluence type
section?"** **Sharpened same-week (2026-07-09): "Could it be hybrid of
confluence and obsidian md? I really like the graph feature of obsidian."**
The dominant incumbent's wiki is a *second, separately-priced* product for
the exact same audience Next Lane already serves — and it has no knowledge
graph at all. Obsidian has the graph and the linked-thought UX but is
local-only: no team backbone, no self-hosted multi-user server, no agent API.
Next Lane Pages is the hybrid neither offers: Confluence's team/RBAC/version-
history backbone **+** Obsidian's `[[wiki-link]]`-driven knowledge graph
**+** an agent that can traverse and author that graph over MCP. See
`docs/VISION.md` § Better-than-Jira scorecard, the new "Knowledge / Docs" row
(target: **beyond** both reference points, not just Parity), and § The
pillars, item 7. **Leads with the crown-jewel framing: the graph is
agent-traversable, not just a pretty view** — "what's connected to this
spec?", "walk the backlinks from this page," answered over MCP the same way
an agent reads/writes issues today. Deliberately sequenced to reuse nearly
all of Next Lane's existing infrastructure — tenant isolation, per-project
RBAC, PAT scopes, fractional ranking (the board's own scheme), full-text
search (Postgres `tsvector`/GIN), and `ShareToken` — with the graph, backlinks,
and `[[wiki-link]]` parsing as the genuinely new surface area.

**v1 slices (sequenced; full scope/acceptance-criteria/territory/size for
each lives in `docs/BACKLOG.md` § Ready):**

1. ✅ **Schema + migration** (shipped 2026-07-09) — `Page` (project-scoped,
   nestable via a `parentId` self-relation, fractional `rank` for sibling
   ordering — reuses the board's ranking scheme rather than inventing a
   second one — markdown `content`, `authorId`/`lastEditedById`),
   `PageVersion` (an immutable snapshot on every save: author, timestamp,
   full content — Confluence's own signature differentiator, not an
   afterthought), `PageIssueLink` (reserved for slice 10), and **`PageLink`**
   (a directed edge table, `sourcePageId` → `targetPageId`, one row per
   resolved `[[wiki-link]]` — the backing store for the backlinks panel and
   the graph view). Additive only.
2. ✅ **Backend module — CRUD/tree-move/version history** (shipped
   2026-07-09) — `apps/api/src/pages/**` (`PagesModule`): full CRUD,
   `POST /pages/:id/move` (reparent + resibling by rank via `rankBetween`,
   cycle-rejected, mirrors board drag-and-drop semantics), version history
   (list/get/restore-as-new-version, never destructive — a version is
   written on create and on any content/title-changing update, not on a
   pure move/archive), VIEWER read / MEMBER+ write via the existing
   `assertProjectRole`/`getEffectiveProjectRole` chokepoint, `pages:read`/
   `pages:write` PAT scopes gated from day one (no Hardening-Night-style
   retrofit needed). Delete of a page with children is an explicit 400
   (move/delete children first), not a cascade — see the ticked
   `docs/BACKLOG.md` entry for the full design-decision writeup.
3. ✅ **Backend — `[[wiki-link]]` parsing + `PageLink` sync on save**
   (shipped 2026-07-09, same commit as #2) — Obsidian's substance: every
   content-changing save parses `[[Page Title]]`/`[[Page Title|Alias]]`
   tokens (new shared `packages/shared/src/wikilink.ts#parseWikiLinks`,
   used by both the backend sync and, later, the frontend editor) out of
   the markdown content, resolves them to a target page by
   case-insensitive title within the project (self-links excluded), and
   upserts/prunes `PageLink` rows to match exactly (idempotent — re-saving
   unchanged content is a no-op diff). An unresolved link (no matching page
   title yet) is simply not persisted as an edge — Obsidian's "link to a
   not-yet-created page" is a valid state, not an error; it's surfaced at
   the frontend layer (slice 5) by re-parsing content against the known
   page-title list, not via a backend "phantom" row (the `PageLink` schema
   has no slot for a title-only unresolved reference).
4. ✅ **Backend — graph endpoint** (shipped 2026-07-09, same commit as #2)
   — `GET /projects/:id/pages/graph` returns the project's full node/edge
   set (pages as nodes, `PageLink` rows as edges; issue cross-links from
   slice 10 layered in as a second edge type once that slice ships),
   capped at `MAX_GRAPH_NODES` (1000) with a `truncated` flag mirroring the
   roadmap/board/dashboard cap pattern; `GET /pages/:id/backlinks` (the
   backing query for slice 6's panel) shipped alongside it.
5. ✅ **Frontend — tree nav + markdown editor + version history** (shipped
   2026-07-09, `49cedd6`; review+QA-fixed `79b6d32`/`e23eb47`) — nestable
   tree-nav with up/down reorder (rank-based, optimistic), markdown editor
   reusing the sanitized `MarkdownRenderer` with `[[`-triggered page-title
   autocomplete (per-keystroke, no focus loss), version-history drawer (view
   a past version, restore behind a `ConfirmDialog`). Page titles forbid
   `[ ] |` (reserved for the wiki-link grammar). VIEWER read-only.
6. ✅ **Frontend — backlinks panel** (shipped 2026-07-09, `49cedd6`) — every
   page shows "what links here": the reverse `PageLink` query rendered as a
   panel beside the editor.
7. ✅ **Frontend — knowledge graph view** (shipped 2026-07-09, `49cedd6`;
   perf/clipping-fixed `79b6d32`/`e23eb47`) — a hand-rolled, CSP-safe (no
   external graph lib) force-directed node graph of a project's pages and
   their `[[links]]`, reachable from the Pages nav; nodes open the page on
   click; pan/zoom, hover-neighbor highlight, dark mode, mobile,
   `prefers-reduced-motion`. Layout runs as a resumable stepper chunked
   across frames so a large graph never blocks the main thread. Once issue
   cross-linking (slice 10) fully ships, issue nodes/edges can layer into
   the same graph.
8. ✅ **MCP tools — Pages CRUD + version history** (shipped 2026-07-09) —
   `list_pages`/`get_page`/`create_page`/`update_page`/`move_page`/
   `delete_page`/`list_page_versions`/`get_page_version`/
   `restore_page_version`, compact/verbose + paginated envelope matching
   the existing MCP conventions (`list_pages` flattens the tree endpoint
   client-side into `{id, title, parentId, archived}` refs, since there is
   no flat paginated list REST route; `verbose: true` hydrates the
   returned page slice with full content/timestamps, bounded by `limit`).
9. ✅ **MCP tools — graph & backlink traversal (crown jewel)** (shipped
   2026-07-09) — `get_page_graph`/`get_page_backlinks`/`get_page_links`
   (outgoing, resolved vs. referenced-but-not-yet-written) — this is the
   differentiator that neither incumbent can follow us into: an agent
   traverses a team's knowledge graph the same way it reads/writes issues,
   not a local-only Obsidian vault with no server API and not a Confluence
   with no graph to traverse in the first place. `get_page` also inlines
   outgoing-links + backlink-count orientation by default (`includeLinks`)
   so "open a page, see what it connects to" is one call, not four. Tool
   descriptions explicitly teach the traversal pattern (walk backlinks to
   find everything referencing a page; load the graph to understand how a
   project's knowledge connects) the same way per-project agent-context
   memory's protocol-level `instructions` do. `apps/mcp/src/tools/index.ts`
   +12 tools (105→117), `apps/mcp/README.md` tool/scope tables updated,
   19 new vitest (112→131 MCP tests), tsc + build clean.
10. ✅ **Issue ↔ page cross-linking** (shipped 2026-07-09) — every
    content-changing save parses the project's issue keys (`NL-123`) via the
    shared `extractIssueNumbers` (same project-scoped parser the SCM
    integrations use), resolves them to same-project `Issue` rows, and
    reconciles `PageIssueLink` rows in the same transaction as the page
    write (mirrors `syncWikiLinks`); `GET /pages/:id/issues` +
    `GET /issues/:id/pages` (both `pages:read`, bounded + `truncated`).
    Cross-project keys never match, per the existing scoping convention. 6
    new unit tests. **Frontend shipped**: the issue drawer gains a "Linked
    pages" section (`LinkedPagesSection`, mirrors the GitHub/GitLab/Gitea
    Development sections — hidden when empty, click a page to open it + close
    the drawer). **MCP shipped**: `get_page_issues` + `get_issue_pages`
    (119 tools). e2e authored (`issue-linked-pages.spec.ts`); independent
    QA run queued. Layering issue nodes into the knowledge graph is a
    separate design decision (issues aren't page nodes) and stays deferred.
11. ✅ **Full-text search** (shipped 2026-07-09 — this item was stale ⬜
    until this pass; corrected against `git log`/code, no re-build needed)
    — `Page.searchVector` tsvector generated column + GIN index (migration
    `20260709120000_add_pages_fts`); `SearchService` page FTS/ILIKE,
    tenant-scoped; `SearchPageDto` + `pages` in `SearchResultsDto`; Cmd-K
    palette "Pages" group with a distinct page glyph, archived-muted; e2e
    `pages-search.spec.ts` 2/2 green desktop+mobile. See the ticked
    `docs/BACKLOG.md` § Already Done entry for full detail.
12. 🔭 **Later (not v1)** — page comments, page templates, and public page
    share links (reuse `ShareToken`, mirroring the dashboard/board
    share-link pattern). (Workspace-level "spaces" — formerly bundled here
    as one deferred idea — is promoted OUT of this later-bucket below: the
    founder confirmed org-level docs on 2026-07-10; see items 13-18.)

### Phase 11 continuation — Org-wide Pages: cross-project links + a workspace docs space (founder-approved 2026-07-10, no longer decision-gated)

**Founder directive, verbatim (2026-07-10): "Both."** — asked to choose
between (a) cross-project `[[wiki-link]]`s (a page in project A links to a
page in project B; backlinks/graph can span projects) and (b) a
workspace-level docs space not tied to any single project (company
handbook, runbooks, ADRs that aren't project-specific), the founder
confirmed both. This promotes and supersedes the "workspace-level 'spaces'"
idea previously bundled into item 12's Later-not-v1 grab-bag and the
matching `docs/BACKLOG.md` decision-gated item — that decision is now made.
See `docs/VISION.md` § The pillars, item 7, for the updated framing (open &
extensible + AI-native/agent-native: an org-wide knowledge graph an agent
can traverse, not just a per-project one).

**Everything Pages built for the per-project boundary (tenant isolation,
RBAC, PAT scopes, fractional ranking, full-text search) was just
re-hardened by the engineering audit (2026-07-10, `4d3a43a` — closed a live
`/search` PAT-scope leak of page content to an `issues:read`-only PAT).
Moving the boundary up to the workspace MUST preserve that isolation story,
not reopen it** — every slice below states its authz decision explicitly
rather than leaving it to build-time judgment.

**Key finding that shapes the whole design** (verified against
`apps/api/src/common/membership.util.ts`): a workspace member already has
at least VIEWER on every project in that workspace by default
(`getEffectiveProjectRole` falls back to the workspace `Membership.role`
absent a `ProjectMembership` override, and an override can only range
MEMBER↔ADMIN↔VIEWER — there is no "no access" state). That means a
`[[link]]` between two projects in the SAME workspace introduces no NEW
leak surface under today's model — the caller could already read both
projects. **The actual boundary that must never be crossed is
cross-WORKSPACE** (the same class of leak the just-fixed `/search` bug
was) — every slice below is scoped to prevent exactly that, using the
already-existing `assertWorkspaceMember`/`assertWorkspaceRole` helpers
(same file, already used by `WorkspacesController`) as the workspace-level
chokepoint, mirroring `assertProjectRole`'s role as the project-level one.

13. ✅ **Schema — nullable `Page.projectId` + always-present
    `Page.workspaceId`** — shipped 2026-07-10 (schema-architect design pass,
    not a mechanical migration) — recommended shape: add
    `Page.workspaceId String` (non-nullable, backfilled for every existing
    row from `project.workspaceId` in the same migration) and relax
    `Page.projectId` to nullable. A page is **project-scoped** when
    `projectId` is set (today's behavior, byte-for-byte unchanged for
    existing rows) and **workspace-scoped** ("lives in the org docs space,
    not any one project") when `projectId` is null. **Rejected
    alternative:** a discriminated-union-style separate `WorkspacePage`
    table — rejected because it would fork `PagesService`, `PageVersion`,
    `PageLink`, `syncWikiLinks`, the graph endpoint, the tree/rank UI, and
    all 12+ MCP page tools into two parallel implementations; a nullable FK
    on the existing `Page` table lets every one of those reuse the same
    code path with one added branch. **Back-compat/migration implications
    to flag explicitly for whoever builds this:** every existing query that
    assumes `page.projectId` is non-null (`PagesService` CRUD/tree/move/
    version methods, `syncWikiLinks`'s title-candidate query, the
    `GET /projects/:id/pages/graph` + `/pages/:id/backlinks` endpoints,
    `PagesController`'s `assertProjectRole` gate, the Cmd-K/`/search` page
    results, and all 12 existing MCP page tools) must add an explicit
    `projectId === null` branch or a workspace-scoped sibling method — this
    is NOT a transparent migration, it is a second code path in every one
    of those call sites, sized accordingly (see slice 14). **Acceptance
    criteria:** migration is additive-only (no existing `Page` row's
    `projectId` changes), `prisma migrate diff` shows zero drift for
    pre-existing data, every pre-existing project-page test still passes
    unmodified. **Territory:** `apps/api/prisma/schema.prisma` + migration.
    **Size:** S (schema is small; the real work is slice 14).
14. ✅ **Backend — workspace-scoped page CRUD/tree/move/version history** — shipped 2026-07-10 —
    mirrors `PagesService`'s existing project-scoped methods, branching on
    `projectId === null`. **Authz decision (explicit):** workspace-scoped
    pages are gated by `assertWorkspaceMember`/`assertWorkspaceRole`
    (`apps/api/src/common/membership.util.ts`, already shipped and used by
    `WorkspacesController`) directly against `Page.workspaceId` — VIEWER
    read / MEMBER+ write, the identical role shape project pages already
    use, resolved one level up (no per-project role override applies —
    there is no owning project). **PAT scopes stay `pages:read`/
    `pages:write`, unchanged and un-split** (see the scope-wide
    recommendation below) — the scope check is orthogonal to which
    membership chokepoint (`assertProjectRole` vs `assertWorkspaceRole`)
    actually authorizes the call. Reuses the same tree/`rankBetween`/
    fractional-rank sibling-ordering scheme, version-on-save semantics, and
    delete-blocked-by-children rule project pages already have — this is
    the SAME `Page` model, just with `projectId` null and `workspaceId`
    set. New nav-facing REST surface: `GET/POST /workspaces/:id/pages`
    (list/create at the workspace root); `PATCH/DELETE /pages/:id`
    unchanged (branches internally). **Acceptance criteria:** a workspace
    VIEWER can read but not write a workspace page; a workspace MEMBER can
    create/edit; a user who is a member of a DIFFERENT workspace gets
    403/404 (tenant-isolation-matrix rows added, mirroring the pattern that
    caught the `/search` leak); every existing project-page
    tenant-isolation row still passes unmodified. **Territory:**
    `apps/api/src/pages/**`. **Size:** M.
15. ✅ **Backend — cross-workspace-safe `[[wiki-link]]` resolution** — shipped 2026-07-17 —
    `syncWikiLinks`'s title-candidate query is rescoped from `projectId` to
    `workspaceId` (derived from the page's own project, or its direct
    `workspaceId` for a workspace page) — the candidate set becomes "every
    page (project-scoped OR workspace-scoped) in the SAME workspace,"
    matching the "already-visible by default" finding above. **The
    explicit authz decision for the founder's exact question — "what
    happens when a viewer can see the source but not the target?":** given
    a page is only ever readable by workspace members, and every workspace
    member can already read every page in that workspace, this case cannot
    occur WITHIN one workspace under today's model. It CAN occur across
    workspaces (a multi-tenant self-hosted instance) via a `[[Title]]` that
    happens to collide with a page title existing only in a workspace the
    viewer isn't a member of. **Decision: treat a same-title match in a
    foreign workspace exactly like a non-existent title — render it as an
    unresolved link (Obsidian's existing "not-yet-created page" state),
    never as a distinguishable "restricted" state.** A "restricted" state
    would itself leak the target's existence/title to a non-member, a new
    information-disclosure surface "unresolved" doesn't have (an agent or
    user genuinely cannot tell "no such page" from "a page exists but you
    can't see it," which is the conservative default and matches how the
    just-fixed `/search` leak was closed — suppress, don't half-reveal).
    **Acceptance criteria:** a `[[link]]` between two pages in the same
    workspace (project A → project B, project → workspace docs space, or
    workspace docs space → project) resolves and creates a `PageLink` edge
    exactly like same-project links do today; a `[[link]]` whose only title
    match lives in a different workspace produces zero `PageLink` row and
    renders identically to a genuinely nonexistent title — a
    live-reproduced adversarial test (two workspaces, colliding page
    titles, one viewer only a member of workspace A) is the acceptance
    gate, mirroring how the `4d3a43a` search-leak fix was verified.
    **Territory:** `apps/api/src/pages/pages.service.ts` (`syncWikiLinks`).
    **Size:** M. **Implementation note:** the candidate query is rescoped
    from `scopeWhere(scope)` to a flat `workspaceId: scope.workspaceId`
    filter — the exact authz boundary specified above. Tie-break when a
    title matches more than one page in the workspace: candidates are
    fetched once (`createdAt asc`), then reduced to `title -> id` in TWO
    passes — same-scope candidates first (a same-project, or same
    workspace-docs, match always wins — proven by a dedicated regression
    test), then a second pass over all candidates fills in any
    still-unresolved title from another scope in the same workspace, oldest
    wins either way. Verified live: an
    **adversarial cross-workspace integration test**
    (`apps/api/src/tenant-isolation.integration.spec.ts`, "org-level-docs
    epic — cross-workspace-safe `[[wiki-link]]` resolution + workspace
    graph") — two independent tenants (workspaces) with a COLLIDING page
    title, tenant A's `[[link]]` to it resolves to zero `PageLink` rows,
    renders identically to a nonexistent title, and leaks neither the
    foreign page id nor workspace id in the response body; a same-run
    positive control (a second project inside tenant A's OWN workspace)
    proves the legitimate cross-project case still resolves.
16. ✅ **Backend — workspace-wide graph + backlinks endpoint** — shipped 2026-07-17 —
    `GET /workspaces/:id/pages/graph` returns the union of every project's
    page graph plus the workspace docs space, scoped by the same
    `assertWorkspaceRole(VIEWER)` chokepoint as slice 14, with edges only
    included when BOTH endpoints resolve within that same workspace (an
    edge to/from a foreign-workspace page literally cannot exist per slice
    15, so this is enforced by construction, not a runtime filter) — same
    `MAX_GRAPH_NODES`/`truncated` cap pattern as the existing per-project
    graph endpoint. The existing `GET /projects/:id/pages/graph` is
    UNCHANGED (still project-scoped, for anyone who wants that narrower
    view). **Acceptance criteria:** the workspace graph for workspace X
    never contains a node or edge belonging to workspace Y, live-verified
    with a two-workspace fixture (same class of test as slice 15's).
    **Territory:** `apps/api/src/pages/**`. **Size:** S (mostly query
    composition once 14/15 land). **Implementation note:** `workspaceGraph`
    now calls `buildGraph({ workspaceId })` (dropped the `projectId: null`
    filter) — nodes are every page whose `workspaceId` matches, edges are
    scoped to that retained node-id set exactly like the per-project graph
    (no dangling edges under the node cap). The per-project `graph()` is
    untouched and verified to still drop a cross-project edge to a
    non-retained node (regression test added). `PageBacklinkDto` and
    `PageResolvedLinkDto` (`packages/shared`) were widened with
    `source-`/`targetProjectId` (nullable), `source-`/`targetProjectKey`
    (nullable), and `source-`/`targetWorkspaceId` so `GET /pages/:id/
    backlinks` and `GET /pages/:id/links` — which can now legitimately
    return a page in a different project or the workspace-docs space — carry
    enough scope for a client to route to and label the other page.
    Live-verified with the same two-tenant fixture as slice 15: tenant A's
    workspace graph unions both of tenant A's own projects' pages with no
    node/edge from tenant B, and tenant B's own graph is symmetric.
17. ✅ **Frontend — workspace Docs nav + reused tree/editor/backlinks/graph
    components** — shipped 2026-07-10 (frontend-builder, org-docs epic
    slice 5) — a new **workspace-level** nav destination (persistent left
    sidebar `Docs` row, alongside `Workspace settings`/`Branding`, PLUS a
    `Docs` tab on the `WorkspaceSettingsNav` strip that also holds Members/
    Audit log/Settings — NOT a project tab) opens the org's docs space at
    `/workspaces/:id/docs(/graph|/:pageId)`, using the SAME tree-nav/
    markdown-editor/version-history/backlinks-panel/graph-view components
    Phase 11 already shipped. Implemented by extracting the shared
    orchestration into a new scope-parameterized `PagesSurface` component
    (`{ kind: 'project' | 'workspace'; id }`) that both `PagesPage` (project
    route) and the new `WorkspaceDocsPage` (workspace route) compose —
    zero component-tree duplication, one `PagesScope`-aware invalidation
    path in `api/keys.ts`/`api/pages.ts` (`useWorkspacePagesTree`,
    `useCreateWorkspacePage`, `useWorkspacePageGraph`, plus the existing
    by-id hooks generalized to take a `PagesScope`). The "Linked issues"
    panel is hidden on a workspace page (no owning project to sync issue
    mentions against, matching the shipped backend). **Scope actually
    shipped vs. this item's original acceptance criteria:** the backend's
    slice-2 cut (see items 13/14 above) only resolves `[[wiki-link]]`s
    among workspace-scoped pages themselves and only graphs workspace-scoped
    pages (`PagesService.scopeWhere`/`buildGraph` are still strictly
    project-only for a project page, workspace-docs-only for a workspace
    page — NOT a cross-project union) — so the cross-project "scope
    indicator" / cross-project link routing this item originally described
    depends on items 15/16 below, which have NOT shipped. Deliberately not
    attempted this slice (per the org-docs epic's explicit scope note) so
    as not to build ahead of an unshipped backend contract. **Update
    2026-07-17:** items 15/16 have now shipped (backend-only — resolution is
    workspace-wide and the workspace graph/backlinks/links DTOs carry
    cross-project scope fields) — the frontend cross-project "scope
    indicator" / cross-project link routing this item originally described
    is now unblocked but NOT yet implemented; see `docs/BACKLOG.md` for the
    follow-up frontend item. **Update 2026-07-17 (later same day, BACKLOG
    #12b):** the cross-project-routing follow-on has now shipped too — the
    backlinks panel, a new "Links out" panel (`GET /pages/:id/links` finally
    has a frontend consumer), and the workspace graph's node click all route
    a cross-project/workspace-docs reference to its OWN scope
    (`/projects/:id/pages/:pageId` vs `/workspaces/:id/docs/:pageId`, via one
    centralized `pageRefPath` helper the `CommandPalette` was also
    refactored onto) and render a quiet project-key/"Workspace" badge only
    when the target's scope differs from the page being viewed. This closes
    the org-wide Pages epic's frontend surface; see the ticked
    `docs/BACKLOG.md` entry for full detail. A live
    `command-palette`/search fix rode along: a workspace-scoped page search
    result now opens `/workspaces/:id/docs/:pageId` instead of the
    previously-broken `/projects/null/pages/:id`. **Verified:** new
    `apps/web/e2e/workspace-docs.spec.ts` (desktop + mobile, 6/6) plus the
    full existing Pages regression suite (42/42) and the workspace-switcher
    chip-sync "class guard" (now sweeping the `docs` route too) all green.
    **Territory:** `apps/web/src/components/pages/**`,
    `apps/web/src/pages/PagesPage.tsx`, `apps/web/src/pages/
    WorkspaceDocsPage.tsx`, `apps/web/src/components/nav/**`,
    `apps/web/src/components/WorkspaceSettingsNav.tsx`, `apps/web/src/api/
    pages.ts`, `apps/web/src/api/keys.ts`. **Size:** M.
18. ✅ **Search + MCP — workspace-wide search scoping and cross-project/
    workspace-docs traversal tools** — **shipped 2026-07-30**
    (`docs/RESEARCH-AGENT-MEMORY.md` R2, "close the org-wide memory hole").
    **Three new MCP tools**, derived from the REST routes that actually
    exist rather than the eight originally sketched: `list_workspace_pages`
    (`GET /workspaces/:id/pages/tree`, `pages:read`),
    `get_workspace_page_graph` (`GET /workspaces/:id/pages/graph`,
    `pages:read`), `create_workspace_page` (`POST /workspaces/:id/pages`,
    `pages:write`) — 120 → **123 tools** (59 read / 64 write). The other
    five sketched tools (`get_/update_/move_/delete_workspace_page`,
    `get_workspace_page_backlinks`) were deliberately NOT built: those are
    by-id routes (`/pages/:id`, `…/move`, `…/backlinks`) that `PagesService`
    already branches on `projectId === null` for, so `get_page`/
    `update_page`/`move_page`/`delete_page`/`get_page_backlinks` already
    operate on workspace pages — duplicating them under a second name would
    add tool-list bytes and zero capability. Scopes match each route's
    `@RequireScope` exactly; MCP stays a pure PAT passthrough with no authz
    of its own. **Description corrections in the same commit:**
    `get_page_graph` now states the real node shape
    (`{id, title, projectId, projectKey, updatedAt}` — it had claimed
    `{id, title}`, hiding the built-in staleness signal), and every page
    tool that described `[[wiki-link]]` resolution as project-scoped now
    states the truth (workspace-wide since slice 15, 2026-07-17).
    **Server-instructions rewrite:** the MCP handshake text now names the
    pages graph as the memory and describes `get_project_context` as what
    it is — a short, full-replace, 64 KB handoff note that POINTS at the
    pages. It previously called that blob "the project's persistent
    memory" and mentioned the graph second, which is why agents reached for
    a flat document instead of the traversable knowledge base
    (`docs/RESEARCH-AGENT-MEMORY.md` §2, §4.2). Pinned by five new
    assertions in `apps/mcp/src/index.test.ts`. **Search half:** already
    satisfied by the shipped implementation and re-verified live —
    `searchPagesFts`/`searchPagesIlike` scope by `Page.workspaceId` (not
    `projectId`), so workspace-level pages are searchable and tenant-scoped
    by construction, and `/search/pages` is gated on `pages:read`; a
    ranked-snippet/pagination upgrade is `RESEARCH-AGENT-MEMORY.md` R1, a
    separate follow-up, NOT part of this item. **Verified:** MCP 147/147
    (+37) and build clean; API integration 441/441 incl.
    `pat-scope-coverage` — the scope matrix already rostered all three
    workspace page routes, no hole to fill; `tsc --noEmit` clean across
    api/web/mcp/shared; and a live round-trip through the REAL stdio MCP
    server (spawned `node dist/index.js`, JSON-RPC over stdin/stdout)
    creating two workspace pages + one project page that `[[wiki-link]]`s
    into the workspace docs space, then reading the graph back: **3 nodes /
    4 edges, all four cross-scope edges resolved, 1,078 B**;
    `list_workspace_pages` 359 B (2 items, no project-page leak);
    `create_workspace_page` 936 B; `get_page_backlinks` on the handbook
    747 B showing both the workspace runbook and the cross-project page
    with `sourceProjectKey`; the per-project `get_page_graph` correctly
    still shows 1 node / 0 edges (278 B), proving the cross-scope edges are
    visible ONLY through the workspace graph. **Acceptance criteria met:**
    live negative matrix — an outsider PAT with `pages:read`+`pages:write`
    gets 403 on all three workspace page routes, and an owner PAT
    WITHOUT `pages:read` also gets 403 on all three; the standing
    `tenant-isolation.integration.spec.ts` matrix (already covering the
    workspace graph/tree routes and asserting workspace A's graph contains
    no node or edge from tenant B) passes unchanged. **Territory:**
    `apps/mcp/src/**` (no API change was needed).
    <details><summary>Original slice definition</summary>
    Extends the existing
    `Page.searchVector` FTS (shipped 2026-07-09) and the
    `canReadPages`/`includePages` pattern (the exact mechanism the
    2026-07-10 `/search` leak fix introduced) to workspace-scoped pages: a
    search result NEVER surfaces a page — project- or workspace-scoped —
    from a workspace the caller isn't a member of, and a PAT scoped without
    `pages:read` sees zero page results, project or workspace, matching the
    just-hardened contract exactly. **MCP:** new `list_workspace_pages`/
    `get_workspace_page_graph`/`get_workspace_page_backlinks` tools
    mirroring the existing `list_pages`/`get_page_graph`/`get_page_backlinks`
    shape (same `pages:read`/`pages:write` PAT scopes, same compact/
    verbose/pagination envelope), plus a `workspaceId`-aware traversal note
    in the tool descriptions so an agent understands "walk the backlinks
    from this page" may now cross project boundaries within one workspace
    — this is the crown-jewel payoff the founder's framing calls out: an
    agent asking "what's connected to this handbook page across every
    project?" in one call, something neither Confluence's per-space wiki
    nor Obsidian's single-vault graph can answer at all. **Acceptance
    criteria:** a live-reproduced two-workspace fixture proves a
    `pages:read`-scoped PAT in workspace A never sees a workspace-B page
    via search OR any of the three new MCP tools; an `issues:read`-only PAT
    (no `pages:read`) sees zero pages from either scope, mirroring the
    just-fixed `/search` regression test shape exactly. **Territory:**
    `apps/api/src/search/**`, `apps/mcp/src/tools/**`. **Size:** M.
    </details>

**PAT-scope recommendation (applies to slices 14/16/18, stated once here
rather than per-slice):** keep `pages:read`/`pages:write` as the single
scope pair for ALL page operations, project- or workspace-scoped — do NOT
introduce a separate `workspace-docs:read`/`workspace-docs:write` pair.
Reasoning: from a PAT-consumer's perspective "pages" is one conceptual
resource regardless of which container it lives in (the same precedent as
`projects:read`/`projects:write`, which the Hardening Night PAT rollout
already "extended in practice" to cover every project-scoped structural
resource rather than minting a new scope per sub-resource); the REAL
authorization boundary for a workspace page is `assertWorkspaceRole`,
exactly as the boundary for a project page is `assertProjectRole` — the
scope grants "may operate on pages," the membership check decides "on
WHICH pages," and splitting the scope pair would only add PAT-configuration
complexity without adding any enforceable distinction a self-hoster would
actually want (a PAT trusted to write project docs but not the handbook is
a real-sounding ask, but is better solved later by a page-level ACL, if
ever needed, than by a scope split now — flagged as a deliberately deferred
idea, not a decision).

## Phase 12 — Systems Map: lightweight, agent-native architecture & dependency mapping 🔭 (future pillar — GATED, not current work)

**Founder directive, verbatim (2026-07-09): "Enterprise architecture is an
interesting thing to tackle... I've worked in many companies without a good
solution to map out architecture/dependencies and integrations. Does it make
sense to have this in this app?"** The orchestrator recommended a
**lightweight** version of this, explicitly not a LeanIX/Ardoq clone; founder
approved: **"Lite weight is good by me."** See `docs/VISION.md` § The
pillars, item 8, and § Better-than-Jira scorecard, the new "Architecture /
Systems mapping" row.

**Sequencing — an explicit gate, per `CLAUDE.md`'s converge-don't-sprawl
mandate ("drive toward the v1 release criteria... then polish — don't
generate endless backlog without finishing").** This phase is filed as a
future pillar, not queued work. The backlog-groomer must NOT promote its
`docs/BACKLOG.md` § Future entry into § Ready until **BOTH** hold:
1. The v1.0 release criteria (bottom of this file) are met, and
2. Phase 11 (Pages) has shipped its v1 slices — specifically the frontend
   force-directed graph view (Phase 11 item #7) — since this phase is a
   **second consumer** of that graph engine, not a parallel build.

**Reuses the Pages graph engine — the key framing, not a new pillar built
from scratch.** This is the same force-directed graph rendering + MCP
graph-traversal primitive Phase 11 builds for Pages (`get_page_graph`/
`get_page_backlinks` and their frontend counterpart), pointed at a different
node type (`System` instead of `Page`). **Design note for whoever builds
Phase 11's remaining frontend graph-view slice (item #7):** keep the graph
component (`apps/web/src/components/pages/**`, force-directed layout) and
the MCP graph-traversal tool shape generic — a graph of `{nodes, typed
edges}` — rather than baking Page-specific fields into the rendering/
traversal layer, so a `System` node type can reuse both without a rewrite
when this phase starts.

**The wedge — why this is genuinely ours, and why the founder has never seen
a good solution for it:** existing EA tools are heavyweight enterprise-sales
SaaS (LeanIX/Ardoq-class) or static offsite-whiteboard diagrams that are
stale the moment everyone's back at their desks — nobody maintains them
because nothing forces them to stay true. Next Lane's version stays current
for reasons no incumbent can structurally copy: (1) **the developer graph is
already real** — GitHub/GitLab/Gitea two-way links (Phase 9, shipped) give
code-level dependency signal, not hand-drawn boxes; (2) **an agent keeps the
map current over MCP** — the living-docs thesis Phase 11 establishes for
Pages, applied to systems; (3) **uniquely, an agent can traverse systems →
dependencies → linked issues → repos** to answer the question every EA tool
fails at: "what breaks if we deprecate service X?"; (4) architecture/
dependency maps are exactly the sensitive internal-topology data that
belongs on "your data, your compute" (VISION.md advantage 2), not handed to
a third-party SaaS. All four structural advantages apply directly here —
free/unlimited (no per-seat EA-tool tax), your-data (sensitive topology
stays self-hosted), open/extensible (MIT, no marketplace), agent-native
(traversal, not the picture, is the differentiator) — and it opens an
entirely new scorecard category (Enterprise Architecture / systems mapping)
the per-seat incumbent doesn't bundle at any price.

**v1 scope — explicitly lightweight, NOT a full EA suite (sketch only; break
into buildable slices with acceptance criteria/territory/size when the gate
above is actually met, mirroring how Phase 11 was sequenced):**
1. 🔭 **Schema** — a `System` node type (name, owner team, tier/criticality,
   description, links to its repo(s) — reusing the existing GitHub/GitLab/
   Gitea integration-link shape — docs page(s) — a Pages cross-link, Phase
   11 item #10's pattern — and owning project/issues). A typed directed
   dependency-edge table (`depends-on` / `calls` / `integrates-with`),
   mirroring `PageLink`'s shape.
2. 🔭 **Backend — CRUD + graph endpoint** — mirrors the Pages backend
   module's shape (`apps/api/src/pages/**` as the template): system CRUD,
   edge CRUD, a graph endpoint returning the full node/edge set (reusing the
   same capped-node/capped-edge truncation pattern `GET /projects/:id/pages/
   graph` established).
3. 🔭 **Frontend — force-directed graph view** — reuses the Pages graph-view
   component (see the reuse note above) rather than a second implementation;
   systems as nodes, typed edges color/label-coded by relationship kind.
4. 🔭 **MCP tools — systems CRUD + graph/dependency traversal (crown jewel,
   same framing as Pages)** — mirrors Pages' `get_page_graph`/
   `get_page_backlinks` shape: `get_system_graph`, `get_system_dependents`
   (what depends on this system — the "what breaks if I deprecate X" query),
   `get_system_dependencies` (what this system depends on), plus CRUD. The
   traversal is the differentiator, not the picture — an agent answering
   "what breaks if we deprecate service X?" in one or two calls is the
   whole point of this pillar.
5. 🔭 **Explicitly NOT v1 — scope discipline, call these out so this never
   creeps into a LeanIX/Ardoq clone:** capability models, TIME (Tolerate/
   Invest/Migrate/Eliminate) lifecycle scoring, compliance/GRC workflows,
   and diagram-authoring tools (freeform canvas/whiteboarding). Pulling any
   of these forward is a founder scope decision, not a default.

See `docs/BACKLOG.md` § Future for the filed (not-yet-Ready) epic entry.

---

### Current focus

**Gate status (2026-07-29): the E2E suite is green again after 25 days red.**
It had failed continuously since 2026-07-01 (~180 runs), which means nothing
merged in that window was actually gated. Restoring it surfaced **four real
user-visible bugs**, not just stale selectors: the project nav overflowed at
mobile widths and rendered Settings on top of its own "More" button; the More
menu unmounted itself whenever board data landed (a changing root element type
in `BoardPage`); a 401 on a request sent *without* a token cleared auth and
logged the user out; and reordering a page silently swallowed the following
click. Phase status below is unchanged by this work — it was a quality/CI
restoration, not a phase advance — but the phases it re-gates are now
trustworthy again. See `docs/BACKLOG.md` § Already Done for the full account.

A second pass then removed the residual **flakiness** that kept CI red with a
different single failure each run while local stayed green: specs were
reloading the page while their own mutation was still in flight (the guard
they used, `page.waitForLoadState('networkidle')`, is a no-op on an
already-loaded document), and two assertions named text that matched a second,
unintended element. Specs now wait for the server to answer their writes via
the new `trackApiWrites` helper. No test was weakened. Same § Already Done
entry.

That pass then exposed a **real P0 product bug** the flakiness had been
masking: fractional-index `rank` keys are byte-ordered, but on a Postgres with
a linguistic collation (`en_US.utf8` — the default for the Debian `postgres`
image and most managed Postgres) `ORDER BY rank` returns a different order, so
moving any board card, backlog item, personal-board card or page to the TOP of
a list silently put it at the BOTTOM after a refresh. Fixed by pinning
`COLLATE "C"` on those columns. CI had been reporting this correctly for four
rounds while local — on a C-collation database — could not reproduce it.

A third pass root-caused the one remaining `main` failure
(`pages-p1-fixes.spec.ts` on `mobile-chrome`, run 30494152793) and found
another **real user-visible bug** rather than a flaky selector: reopening the
"New page" modal left the previous page's title in the input with the caret at
offset 0, so typing spliced the two titles together and persisted a page named
`"Other DocDraft Doc"`. The reset lived in a `useEffect`, one render too late;
it now happens during render. Measured 2.7% → 0% over 300 trials. It was **not**
caused by PR #52's `modulePreload.polyfill: false` — the parent commit measures
the same rate — so the preceding green runs were luck, not evidence. Phase
status below is unchanged by this work. See `docs/BACKLOG.md` § Already Done.

**The bar: "Is this better than Jira?"** (founder mandate, `docs/VISION.md`
§ The operating question.) Not cheaper — *better*, on a daily-driver test: a
team that has run the incumbent for years should prefer Next Lane within the
first week for the tool itself, not just the price tag. The
`docs/VISION.md` "Better-than-Jira scorecard" was re-scored 2026-07-02 against
the two independent Pass-12 audits (`docs/AUDIT-PRODUCT.md`,
`docs/AUDIT-ENGINEERING.md`), which hands-on-verified the founder-wave that
shipped since Pass 11: persistent left sidebar (Nav & IA Phases 1+2), dark
mode, NLQL-native dashboards, Swimlanes v2, GitHub integration v1, SSO/OIDC
Phase 1, and the MCP surface (55 → 85 tools). Result: **4 dimensions better, 3
parity, 3 behind** (up from 3/2/5) — Reporting and Reliability/coherence-of-state
both flipped Behind → Parity, and Search & query power flipped Parity → Better.
Work is sequenced below to close what's left, in the order the two Pass-12
audits' evidence implies, ahead of any new pillar or moonshot.

**New current focus (2026-07-09): Pages — a Confluence × Obsidian hybrid,
agent-traversable knowledge base (founder directive 2026-07-06, "How can we
add a confluence type section?"; sharpened 2026-07-09, "Could it be hybrid
of confluence and obsidian md? I really like the graph feature of
obsidian.").** This is the one exception to "no new pillar ahead of closing
Behind rows" above — it doesn't compete with that work, it opens a category
Next Lane doesn't play in at all yet (the new "Knowledge / Docs" scorecard
row, `docs/VISION.md`, targeted at *beyond* both Confluence and Obsidian, not
mere parity with either). See **Phase 11**, above, for the pillar framing and
sequenced v1 slices — schema (incl. the `PageLink` graph-edge table) →
backend CRUD → `[[wiki-link]]` parsing → graph endpoint → frontend
tree/editor → backlinks panel → graph view → MCP CRUD tools → MCP graph/
backlink traversal tools (the crown jewel) → issue-linking → search — and
`docs/BACKLOG.md` § Ready for the buildable queue.

**Build update (2026-07-09, same day): schema + backend module shipped.**
Slices 1-4 above (schema, CRUD/tree-move/version-history, `[[wiki-link]]`
parsing + `PageLink` sync, graph + backlinks endpoints) are done — 11 new
REST routes (`apps/api/src/pages/**`), `pages:read`/`pages:write` PAT
scopes live, 32 new API unit tests + 13 new shared vitest for
`parseWikiLinks`, tenant-isolation + PAT-scope-matrix rows for every new
route, all green. See the ticked `docs/BACKLOG.md` § Already Done entry for
the full writeup (incl. the two documented design decisions: explicit-400
on delete-with-children, and unresolved-`[[link]]`-is-not-an-error). Next up:
the frontend (tree nav + markdown editor + version history + `[[link]]`
autocomplete, `docs/BACKLOG.md` § Ready item #1) is the critical path for
everything downstream (backlinks panel, graph view) to become human-visible.

**Build update (2026-07-09, same day): MCP tools shipped — Pages CRUD,
version history, and the crown-jewel graph/backlink traversal.** Slices 8-9
above (`docs/BACKLOG.md` § Ready former items #4/#5) are done, ahead of the
frontend slices they don't depend on: `list_pages`/`get_page`/`create_page`/
`move_page`/`update_page`/`delete_page` (CRUD), `list_page_versions`/
`get_page_version`/`restore_page_version` (history), and
`get_page_graph`/`get_page_backlinks`/`get_page_links` (the traversal trio —
neither Confluence nor Obsidian exposes any of this over an agent-callable
API). `get_page`'s default `includeLinks` inlines outgoing-links +
backlink-count so "open a page, see what it connects to" costs one call.
12 new tools (`apps/mcp/src/tools/index.ts`, 105→117), `apps/mcp/README.md`
tool/scope tables + prose updated, 19 new vitest (112→131 MCP tests), tsc +
build clean. `list_pages` composes the tree endpoint client-side (no flat
paginated list REST route exists) rather than adding new REST surface — see
the ticked `docs/BACKLOG.md` § Already Done entry for the full writeup. Next
up: the frontend slice (item #1 above) remains the critical path for the
graph/backlinks becoming human-visible in the web app.

**Founder directive (2026-07-03, shipped same day): per-project agent context memory over MCP** — every project carries a persistent agent handoff document (read-first/hand-off-last, prompted at the protocol layer via MCP server instructions + tool descriptions, distributable `skills/project-context` Agent Skill, measured staleness signal). The agent-native pillar now includes cross-session memory. **Web-UI panel follow-up — ✅ shipped 2026-07-03**: a new "Agent context" section on project Settings (`AgentContextSection.tsx`, after Members/GitLab) renders the shared handoff document as markdown (empty-state copy, updatedAt/updatedBy metadata, amber "N changes since last update" staleness pill), edit-in-place (Edit → textarea → Save/Cancel, toast on save, inline error on the 64 KB cap) for effective project MEMBER+, read-only for VIEWER; realtime via the existing `useBoardRealtime` project-socket hook (new `project-agent-context.updated` + issue-activity invalidation of `qk.projectAgentContext`). 12 new e2e cases in `agent-context.spec.ts` (desktop 1280 + mobile 393): empty state, write→render→survives reload, a second live session sees the save with no reload, the staleness pill appearing live after another session changes an issue, VIEWER read-only, and the 64 KB inline-error path — all green, plus `settings-robustness.spec.ts` (15) + `gitlab-integration.spec.ts` (5) + `project-members.spec.ts` (4) regression re-verified green.

**MCP-QA pass 1, finding 1 fixed (2026-07-03): NLQL person/sprint name resolution.** `assignee = "<display name or email>"` and `sprint = "<name>"` — the two most natural ways an agent asks "what is X working on?" / "what's left in sprint N?" — silently matched **zero** issues server-side (id-only lookups worked; the shared evaluator's existing name/email resolution for `user`-kind fields was never fed workspace members, and `sprint` had no name-resolution at all). Fixed at the shared layer (`packages/shared/src/nlql`: a new `sprint` `FieldKind` mirroring `user`'s id-or-name resolution, plus `getReferencedFieldKinds()` so a call site loads only the side-context a query needs) and wired through every server-side NLQL evaluation call site — `IssuesService.exportCsv` (the path `list_issues`'s `query` mode and `get_project_csv` drive over MCP), the dashboard-gadget evaluator, and the automation engine's condition eval — via a shared `loadNlqlEvalContext` helper, batch-loaded once per evaluation. Live-verified over REST against a real named-user/named-sprint fixture: 0→5 and 0→4 respectively, matching the QA-reported truth counts exactly. See the ticked `docs/BACKLOG.md` entry for full detail.

**PR-status + auto-transition-on-merge — ✅ shipped 2026-07-03 (Ready queue #1).** The GitHub/GitLab link plumbing now *acts*: an opt-in (off-by-default) auto-transition-on-merge automation, a board-card "linked PR" badge, and the first real outbound GitHub/GitLab API calls (live PR/CI status in the drawer, SSRF-guarded). Closes the biggest remaining "Integrations" Better-than-Jira gap short of Gitea/smart-commit syntax — see the ticked Phase 9 entry above for full detail.

**Configurable dashboards — Phase 2 — ✅ shipped 2026-07-03 (Ready queue #2).** Cross-sprint velocity-trend gadget (reuses the Reports page's own `VelocityChart`, not a bespoke report page), cross-workspace gadget scoping verified with a real multi-workspace deep-link e2e case (plus a genuine dashboard-selection race found and fixed along the way), drag-to-reorder gadgets (dnd-kit, replacing the v1 up/down buttons), pre-built starter gadgets on a project's first dashboard, and the bundled engineering hardening (`MAX_DASHBOARDS_PER_PROJECT`/`MAX_GADGETS_PER_DASHBOARD` caps + parallelized gadget evaluation, engineering-auditor Pass-12 P2-2). See item 5 above and the ticked `docs/BACKLOG.md` entry for full detail. Both former Ready-queue P1s are now shipped — see `docs/BACKLOG.md` § Ready for the refilled queue (NLQL unresolved-name diagnostics, epic-swimlanes e2e gap, cross-project issue MOVE, Gitea v1, dashboard-sharing public embed).

**Agent Experience Round 2 — ✅ shipped 2026-07-03 (founder-relayed field report #2 — "genuinely production-grade for AI-agent-driven project management" once these land).** All 7 acceptance criteria: fixed the confirmed-live P1 data-integrity bug (`POST /issues` accepted a cross-project `statusId`, rendering the issue on no board — `create()` now shares the same `assertSameProject` guard `update()`/`move()` already had; a second real gap, bulk `addLabelIds` with no project-scope check at all, was also found and closed); optional `idempotencyKey` on `create_issue`/`add_comment` (new additive `IdempotencyRecord` table, ~24h window) so a retried call after a network blip replays the original result instead of duplicating; `bulk_update_issues` gained `parentId` (cross-project-guarded — one call now parents 30 tickets under an epic) plus `atomic: true` (validates the whole batch first, writes inside one shared transaction, all-or-nothing) and `dryRun: true` (per-item verdicts, zero writes); comment edit/delete over MCP (REST gating upgraded from author-only to author-or-effective-project-ADMIN, mirroring work logs); a new unified `GET /projects/:id/activity` feed (+ MCP `list_project_activity`) merges issue field changes, comments, and work logs project-wide so an agent can ask "what changed since I last looked" in one call instead of polling blind; `expectedProjectKey` upgraded from a soft recommendation to MUST-pass language everywhere (tool description, server instructions, the `project-context` skill) plus an optional `NEXT_LANE_MCP_STRICT_PROJECT_KEY` hard-enforcement env var. Folded in from MCP-QA pass 1: agent-context staleness now also counts comments + work logs (was field changes + audit events only); `list_users` gained a server-side `q` name/email filter; new `create_project`/`create_workspace` MCP tools. MCP surface: **92 → 97 tools**. 44 new API unit tests (1683→1727), 13 new MCP tests (84→97), 1 new tenant-isolation row (103/103 BLOCKED), all live-verified against the running API. See the ticked `docs/BACKLOG.md` entry for full per-criterion detail.

**NLQL unresolved assignee/sprint name → 400 — ✅ shipped 2026-07-06 (Ready queue #1, MCP-QA pass 1 finding 1 residual, fully closed).** The deliberately-deferred half of `ec9f02e`: `assignee = "Alex Rivera"`/`sprint = "July-B"` resolve correctly when the name exists, but a typo'd/nonexistent name used to silently evaluate to a confident `0 results` — an agent would conclude "nobody has this name" when the truth is "there is no such user". New shared `resolveQueryNames(query, ctx)` (`packages/shared/src/nlql/validate.ts`) is a fail-loud PREPARE step server call sites run once per evaluation, after `validateQuery` and alongside loading `ctx.users`/`ctx.sprints` — it flags a `user`/`sprint`-kind comparison operand as unresolved when it is neither `me()` nor opaque-id-shaped (a `looksLikeOpaqueId` heuristic: no whitespace + length ≥ 20, matching `cuid()`/UUID shape, so a legitimate raw id not in the caller's loaded context — e.g. a former workspace member — still compares silently as before) and matches nothing in the supplied context. The pure evaluator (`evaluate`/`filterIssues`) is deliberately UNCHANGED and now explicitly documents its silent-fallback behavior for library consumers. Wired into all three server call sites via `loadNlqlEvalContext`: `IssuesService.exportCsv` now 400s (`Invalid NLQL query: unknown user "Alex Rivera" — use an exact display name, an id, or me(); see list_users` / equivalent for sprint) — this is also the MCP `list_issues` query-mode oracle, verified to pass the message through verbatim, the same path that already surfaces parser errors; the dashboard-gadget evaluator flags only the offending gadget's `error` field, never failing the whole dashboard read (a sibling gadget's `data` renders normally, live-verified); the automation engine's condition eval now produces a `FAILED` run with the same message (was previously an indistinguishable-from-real `SKIPPED`), mirroring its existing invalid-condition handling exactly — one bad rule's condition never blocks a sibling rule on the same event. Bonus fix caught while wiring the board query bar's client-side validation to the same helper: the CSV-export "Couldn't export issues." toast was swallowing the API's actual error message entirely (`fetchCsvBlob` never read the response body) — now surfaces it verbatim, so *every* NLQL 400 (parser errors too, not just this fix) is finally actionable from the export button, not just from the query bar. Also closed a latent gap found along the way: the board's client-side `filterIssues` calls never populated `ctx.sprints`, so `sprint = "<name>"` silently never matched on the board/card-colors surface even for a real sprint — now wired through the same `nlqlUsers`/`nlqlSprints` memo the new query-bar validation uses. Live-verified end-to-end against a real running API: unresolved assignee/sprint → 400 with the exact message; a real "Alex Rivera" workspace member → 200 with the correct row; a bad-condition automation rule → `FAILED` run with the message, sibling unconditional rule still fires; a two-gadget dashboard with one bad query → 200 overall, one gadget's `error` set, the other's `data` intact. 16 new shared vitest tests (146→162), 11 new API jest tests across the three call sites + 1 test updated in place to reflect the new fail-loud contract (1839→1850, 85 suites), 1 new MCP vitest test (110→111), integration suite re-verified green (293/293), `tsc --noEmit` clean in shared/api/web/mcp. [Ready queue #1 — MCP-QA pass 1 finding 1 residual, docs/MCP-QA.md]

**Gitea integration v1 — two-way link — ✅ shipped 2026-07-06 (Ready queue, third self-hosted forge).** Closes the last open half of the "GitLab/Gitea" Better-than-Jira Integrations gap — GitHub, GitLab, and now Gitea all have two-way issue linking. Links-only in v1 (no auto-transition-on-merge, no live status, mirroring the deliberate GitHub/GitLab v1 kickoff scope before their own PR-status follow-up). See the ticked Phase 9 entry above for full detail.

**Dashboard sharing — public read-only embed — ✅ shipped 2026-07-06 (Ready queue, Configurable dashboards follow-up).** A dashboard can now be published read-only, no-login, to a bookmarkable `/share/dashboard/:token` URL — the same public-share pattern the project board already had, extended to dashboards now that Phase 1/2 proved the gadget framework strong (AUDIT-PRODUCT.md Pass 12, Ideation #1). Schema: a parallel `DashboardShareToken` table (not a widened `ShareToken`) so the already-tested board share-token surface stayed untouched and a dashboard link can never double as a board link. The public read reuses the exact same gadget-evaluation core the authenticated dashboard view uses — no parallel evaluation path — with one deliberate anonymous-caller behavior: a gadget whose NLQL calls `me()` has no signed-in identity to resolve against, so it now fails loud with an explicit per-gadget error (a new shared `queryReferencesMe()` AST check) instead of silently evaluating `me()` as `null` (which would render as "unassigned" — confidently wrong, not merely absent). ADMIN mint/list/revoke endpoints mirror the board equivalent exactly (same scopes, same 404-not-403 cross-tenant contract); the web page reuses the authenticated dashboard's own gadget-visualization components (`GadgetResultBody` extracted from `GadgetCard.tsx`) so there is zero duplicated rendering logic, plus a "Share" button + modal on the Dashboards page toolbar. 24 new API unit tests (1906→1930, 88→90 suites), 6 new tenant-isolation + pat-scope-rollout matrix rows (307 integration tests total), 7 new shared vitest for `queryReferencesMe`, 14 new e2e cases (`dashboard-share-link.spec.ts`, desktop+mobile) covering mint→public-render→`me()`-degrades→revoke→error-page plus the admin UI flow; full regression (board share-link, dashboards Phase 1/2) re-verified green. MCP: not applicable — a public, no-token browser surface, not an agent action; noted explicitly per the DoD convention rather than silently skipped. See the ticked `docs/BACKLOG.md` entry for full detail.

**PAT-scope route-coverage guard + GitLab auto-transition e2e parity — ✅ shipped 2026-07-06 (Ready queue #2/#3, bundled).** Two hardening items closing regression-guard gaps on already-shipped features. (1) A new `pat-scope-coverage.integration.spec.ts` walks every registered controller route at runtime via Nest's `DiscoveryService`/`MetadataScanner` and asserts each either carries `@RequireScope` or is on an explicit, reasoned `EXEMPTIONS` allowlist (categories: auth/oidc/health/public/me/personal-boards-private/webhook-receivers, mirroring the in-code exemption docs from `4aec12a`); the route↔scope matrix itself was extracted from `pat-scope-rollout.integration.spec.ts` into a shared `pat-scope-matrix.fixture.ts` (one exported constant, imported by both specs — no duplication). Writing the guard caught **real, pre-existing drift**: `github.controller.ts`/`gitlab.controller.ts` had been `@RequireScope`-gated since before the Hardening Night rollout but were never added to the matrix (12 rows added), `GET /projects/:id/activity` was scoped but missing from the matrix (1 row added), and `GET /workspaces/:id/logo` (a `@Public()` branding-asset route) had no exemption entry (added) — all three fixed in the same commit. Matrix grew 143→190 rows; full integration suite 307→393 tests, all green. Proved the guard actually guards: temporarily removing `@RequireScope('issues:write')` from `IssuesController#create` made the spec fail naming the exact route (and the now-orphaned matrix row); reverting made it pass again. (2) `gitlab-auto-transition.spec.ts` mirrors `pr-auto-transition.spec.ts`'s GitHub depth for GitLab: enable `gitlab-auto-transition-toggle` targeting Done via the Settings UI, persist across reload, POST a correctly-`X-Gitlab-Token`-tokened `Merge Request Hook` webhook (`state: 'merged'`, GitLab's merge signal — no HMAC, unlike GitHub), assert the shared `issue-pr-badge`/`data-pr-state` board-card badge flips open→merged, the issue's real `statusId` transitions via REST (not just a UI observation), the MR link renders in the issue drawer's `gitlab-links-section`, disabled-by-default regression, and mobile (390px) no-overflow — 6 new e2e cases, desktop + mobile-chrome projects, all green; zero egress, zero app-code changes (the feature already shipped for both providers). MCP: not applicable — this is test-coverage-only work with no new API surface; noted per the DoD convention. See the ticked `docs/BACKLOG.md` entries for full detail.

**SSO/OIDC — Phase 2: SAML + multi-provider + JIT provisioning — ✅ shipped 2026-07-06 (Ready queue #1).** Closes the last "Admin controls" Better-than-Jira lever: SAML 2.0 support (`@node-saml/node-saml`) alongside the shipped generic-OIDC provider, N simultaneously-configured providers (new additive `SsoProvider` table, `/admin/sso-providers` REST + UI — the Phase-1 `OidcConfig` singleton stays entirely unmigrated), and just-in-time workspace/role provisioning on a brand-new SSO identity's first login (conservative default: `VIEWER`, off unless an admin sets a JIT default workspace). SAML assertion validation is strict and documented: signature required (never admin-configurable off), audience always enforced, single-use replay protection (Redis-backed when available, else in-memory) with a 5-minute window, timestamp checks always active. Proven end-to-end against the REAL `@node-saml/node-saml` library with a locally-generated self-signed certificate (zero network, zero real IdP) — accept-valid plus 7 forged/tampered/expired/replayed rejection cases, all live-verified via a real HTTP round-trip (register → promote to instance admin → create workspace → create SAML provider → real AuthnRequest → real signed assertion POST → session issued → JIT membership confirmed in the DB; replay confirmed rejected). 68 new API unit tests (1931→1999, 90→95 suites); full integration suite still green (401 tests, 3 suites, 4 new pat-scope-matrix rows + a new `sso` exemption category). `tsc --noEmit` clean across api/web/shared/mcp; no new env vars (SAML config is fully DB/admin-UI-driven). MCP: deliberately not exposed, same reasoning as Phase 1 — every write carries a secret/certificate, and the runtime login/callback routes have no agent-appropriate shape. See the ticked `docs/BACKLOG.md` entry for full detail.

**Founder directive (2026-07-10): Pages goes org-wide — "Both."** Confirmed
both cross-project `[[wiki-link]]`s and a workspace-level docs space (see
the new "Phase 11 continuation" section above, items 13-18). This is
sequenced as a continuation of Phase 11, not a new phase — it reuses
Pages' entire existing stack (tenant isolation, RBAC, PAT scopes,
fractional ranking, full-text search, the graph engine), and lands right
after Phase 11's v1 slices (all shipped as of this pass) rather than
waiting behind anything else, since it directly extends the "Knowledge /
Docs" Better-than-Jira row's *beyond-both-incumbents* target. See
`docs/BACKLOG.md` § Ready for the six sequenced, authz-explicit build items.

**Build update (2026-07-10): Slices 1-2 shipped — schema + workspace-scoped
page CRUD.** Items 13-14 above are done, landed as two coordinated slices in
the same working tree (schema-architect then backend-builder): **Slice 1**
(`apps/api/prisma/schema.prisma`, migration
`20260710120000_pages_workspace_scope`) added `Page.workspaceId String`
(non-nullable, present on every row — a project page's always equals
`project.workspaceId`, a workspace page's is its only owner), relaxed
`Page.projectId` to nullable (null = workspace-level page), added the
`Workspace.pages` back-relation, and two new indexes
(`[workspaceId, parentId]` / `[workspaceId, rank]`) mirroring the existing
project-scoped ones — additive-only, zero drift for pre-existing rows.
**Slice 2** (`apps/api/src/pages/**`, `apps/api/src/search/**`,
`apps/api/src/realtime/**`) is the backend module: every one of the ~25
call sites `PagesService` had that assumed a non-null `projectId` now
branches through one small `PageScope` helper set
(`assertPageRole`/`scopeOf`/`scopeWhere`/`siblingWhere`/`assertParentInScope`
— dispatches to `assertProjectRole` for a project page or the existing
`assertWorkspaceRole` for a workspace page, VIEWER read / MEMBER+ write
either way) instead of repeating the branch at each site; a new
`createWorkspacePage()` + `POST /workspaces/:id/pages`,
`GET /workspaces/:id/pages/tree`, `GET /workspaces/:id/pages/graph` mirror
the project entry points (the existing by-id routes — findOne/update/
remove/move/versions/links/issues — already work for both kinds, no new
routes needed there). `[[wiki-link]]` resolution for a workspace page is
scoped to that workspace's OTHER workspace-level pages only — a project
page's resolution is UNCHANGED (still project-scoped; broadening it to
cross-project, item 15, stays a later slice, deliberately not done here).
Issue-key sync is skipped entirely for a workspace page (no `PageIssueLink`
rows — `Issue` is project-scoped, a workspace page has no project to
resolve keys against). Realtime: a new `RealtimeService.emitToWorkspace` +
`workspaceRoom()` (`workspace:<id>`, mirroring `userRoom`'s convention)
broadcasts `page.updated` for a workspace page instead of the project room.
`SearchService` fixed two silent workspace-page-drop bugs the schema-architect
flagged ahead of time: the ILIKE page search scoped tenancy via
`project: { workspaceId: { in } } }` (excludes every `projectId: null` row);
the FTS raw query `JOIN`ed `Project` (an inner join drops every workspace
page) — both now scope directly by `Page.workspaceId` and the FTS query is a
`LEFT JOIN`. `PageDto`/`SearchPageDto` (`packages/shared/src/types.ts`) gained
`workspaceId: string` and `projectId`/`projectKey` went nullable. Tests: 24
new API unit tests across `pages.service.spec.ts` (workspace create/read/
update/move/remove, cross-scope wiki-link isolation both directions,
issue-link-skip control-cased against a project page, workspace tree/graph)
and `search.service.spec.ts` (ILIKE/FTS/`searchPagesOnly` all surfacing a
workspace page with `projectKey: null`, tenancy-by-`workspaceId` assertions);
3 new `pat-scope-matrix.fixture.ts` rows + 3 new tenant-isolation-matrix rows
(live cross-workspace HTTP attempts against the new routes, all BLOCKED —
126→129 endpoints, 0 issues) — both `pat-scope-coverage` and
`tenant-isolation` integration specs re-verified green against a disposable
DB. `tsc --noEmit` clean api/web/shared; full API unit suite green (2075
tests, 96 suites). MCP tools for workspace-level docs are a **follow-up, not
done in this slice** — see the ticked `docs/BACKLOG.md` entry for the
explicit note. Next up: item 15 (cross-workspace-safe `[[wiki-link]]`
resolution broadening project pages beyond same-project) and item 16
(a true workspace-WIDE graph unioning every project's pages, distinct from
this slice's workspace-root-only tree/graph).

**Build update (2026-07-10, same day): Slice 5 shipped — the workspace Docs
frontend surface.** Item 17 above is done (see its entry for full detail):
a new `WorkspaceDocsPage` (`/workspaces/:id/docs`) opens the org-wide docs
tree via a scope-parameterized `PagesSurface` shared verbatim with the
project Pages route — zero component-tree duplication. Reachable from the
persistent sidebar (`Docs` row, `nav-sidebar-workspace-docs`) and the
`WorkspaceSettingsNav` tab strip (`Docs` tab, alongside Members/Audit
log/Settings/Branding). `apps/web/e2e/workspace-docs.spec.ts` (6 cases,
desktop+mobile) covers nav discovery, the empty state, create→edit→
`[[wiki-link]]`→resolve→backlinks→graph, and confirms "Linked issues" is
absent on a workspace page; the full existing Pages e2e suite (42 cases)
and the workspace-switcher chip-sync class guard (now sweeping `docs` too)
re-verified green; `tsc --noEmit` + `pnpm build` clean. Deliberately did
NOT build the cross-project scope-indicator/link-routing UI item 17
originally described — the shipped backend (slice 2, above) doesn't yet
implement cross-project `[[wiki-link]]` resolution or a project-unioning
graph (`PagesService.scopeWhere`/`buildGraph` confirmed still project-only
/ workspace-docs-only), so that UI has nothing real to route to yet; it
follows items 15/16 once those land. A live drive-by fix: a workspace
page surfaced by the command palette's search previously opened the
dead `/projects/null/pages/:id` URL — now routes to
`/workspaces/:id/docs/:id`. Next up: items 15/16 (backend), then the
cross-project scope-indicator/link-routing this item's original acceptance
criteria described.

**Build update (2026-07-17): Slices 15+16 shipped — cross-workspace-safe
`[[wiki-link]]` resolution + the workspace-wide page graph (backend only).**
Items 15 and 16 above are done (see their entries for full detail).
`syncWikiLinks`'s candidate query is rescoped from `projectId`/workspace-docs
to a flat `workspaceId` filter, so a `[[wiki-link]]` can now resolve across
projects (and to/from the workspace-docs space) within one workspace, with a
same-scope-first, then-oldest-wins tie-break that provably doesn't regress
any pre-existing same-project link. `GET /workspaces/:id/pages/graph` is
broadened to the union of every project's pages plus the workspace-docs
space; the per-project `GET /projects/:id/pages/graph` is unchanged and
still drops cross-project edges (verified). `PageBacklinkDto`/
`PageResolvedLinkDto` (`packages/shared`) widened with nullable
`projectId`/`projectKey` + `workspaceId` on the "other page" so
`GET /pages/:id/backlinks`/`GET /pages/:id/links` can label and route a
now-legitimately-cross-project ref. **Authz (verbatim per the founder's exact
question):** a `[[Title]]` whose only match lives in a DIFFERENT workspace
resolves to NOTHING — zero `PageLink`, indistinguishable from a genuinely
nonexistent title, never a distinguishable "restricted" state (same
suppress-don't-half-reveal posture as the `4d3a43a` /search fix) — a live
two-tenant adversarial fixture in `tenant-isolation.integration.spec.ts`
("org-level-docs epic — cross-workspace-safe `[[wiki-link]]` resolution +
workspace graph") is the acceptance gate: a colliding title across two real
workspaces produces zero cross-workspace `PageLink`/node/edge and leaks no
foreign id, alongside a positive control (a second project inside the same
tenant's own workspace) proving the legitimate cross-project case still
resolves and both tenants' own graphs stay symmetric. Gates: pages-service
unit tests net +6 (2 pre-existing tests deliberately inverted to assert the
new cross-scope resolution instead of the old isolation; 70/70 in that file;
2081/2081 across all 96 API unit suites) + 4 new integration tests (441/441
across 3 integration suites, run against a
throwaway `nextlane_slice3` DB, never touching the shared dev DB/API);
`tsc --noEmit` clean api/web/mcp/shared. **Deliberately backend-only** — no
new MCP tool was needed (existing `get_page_graph`/`get_page_backlinks`/
`get_page_links`/workspace-graph MCP tools already call these same REST
routes and transparently inherit the broader resolution and the new DTO
fields; a client-side "cross-project badge" affordance is a follow-up, see
`docs/BACKLOG.md`). Frontend cross-project scope-indicator/link-routing
(item 17's original acceptance criteria) is now unblocked by a real backend
contract but not yet built — filed to `docs/BACKLOG.md` § Ready.

**Build update (2026-07-17, same day): item 17's cross-project-routing
follow-on shipped (BACKLOG #12b) — the org-wide Pages epic's frontend
surface is now complete.** A new centralized helper (`apps/web/src/lib/
pageRoute.ts`: `pageRefPath`/`isDifferentPageScope`/`pageScopeBadgeLabel`)
routes any page reference to its OWN scope regardless of what's currently
being viewed — `BacklinksPanel` and a brand-new `OutgoingLinksPanel`
("Links out", the previously-unbuilt frontend consumer of `GET /pages/:id/
links`) both use it, as does `KnowledgeGraphView`'s workspace-mode node
click (resolving a node's scope on demand via a new `fetchPageScope` since
`PageGraphNode` carries no scope fields itself) and the `CommandPalette`'s
page-result routing (refactored onto the same helper, replacing its
inline ternary). A quiet `PageScopeBadge` (project key, or "Workspace")
renders on a backlink/outgoing-link row only when that target's scope
differs from the page being viewed — verified absent on same-scope rows by
a dedicated negative-case e2e test. New `pages-cross-project-links.spec.ts`
(2 tests × desktop+mobile = 4/4): two projects in one workspace, a
cross-project `[[wiki-link]]`, asserting the outgoing-link/backlink/graph-
node routing + badge in both directions, plus the same-project no-badge
control. Full Pages regression suite (`pages.spec.ts`,
`pages-p1-fixes.spec.ts`, `workspace-docs.spec.ts`,
`issue-linked-pages.spec.ts`, `pages-adversarial.spec.ts`,
`pages-qa-extra.spec.ts`, `pages-search.spec.ts`) re-verified green desktop
+mobile, zero regressions; `tsc --noEmit` + `pnpm build` clean. See the
ticked `docs/BACKLOG.md` § Already Done entry for full detail. **Territory:**
`apps/web/src` only. Item 18 (search scoping + MCP traversal tools) is now
the epic's last remaining piece.

*(Note to backlog-groomer: this is the intended Ready-queue order for the next
build-loop pass; `docs/BACKLOG.md` itself is unchanged by this vision-steward
pass — groom the board against this sequencing next.)*

1. **Mobile — Swimlanes v2's own paint regression — ✅ fixed 2026-07-02
   (Pass-12 mobile fix batch).** The board's "Group by" and filter-chip
   dropdown menus were functionally clickable but rendered **completely
   invisible** on a real 393px phone (`overflow-x-clip` suppressed the paint
   of an absolutely-positioned menu that extended past the viewport) — this
   pass's flagship feature was unusable via touch. Fixed at the pattern
   level, not point-wise: a new portalled, viewport-clamped
   `<DropdownPanel>` component (`apps/web/src/components/ui/DropdownPanel.tsx`,
   `createPortal`-to-`document.body` + measured/clamped `position: fixed`,
   flips above the trigger when there's no room below) replaces every
   toolbar `position: absolute` menu in `BoardPage.tsx` (Group by, Labels,
   Type, Priority filters, saved-filter menu, NLQL help). The pre-existing
   quick-filter chip row's overflow regression (silently clipped "Recently
   updated" off-canvas) is fixed with a real `overflow-x: auto` +
   `shrink-0` chips + the house `.nl-scroll` thin-scrollbar style, and the
   "Group by" chip's two-line wrap is fixed with `whitespace-nowrap`/
   `shrink-0`, matching every sibling chip. Verified with paint-level e2e
   (not just `isVisible()`/`boundingBox()` — a real screenshot decoded via
   `<canvas>` to assert non-blank pixel content, per the audit's own
   recommended follow-up) in `swimlanes.spec.ts` and a chip-reachability
   check in `quick-filters.spec.ts`; desktop unaffected
   (AUDIT-PRODUCT.md Pass 12, top-ranked finding). Also fixed the related
   P3 the same pass: the persistent sidebar defaulted to expanded at the
   1024–1279px "small laptop" band, visibly cramping the 3-column board —
   now defaults to the collapsed rail there when the user has no stored
   preference (an explicit preference always wins, at any width).
2. **Reliability artifact gap — CSP blocks the dark-mode bootstrap script in
   the real Docker image — ✅ shipped 2026-07-02 (Pass-12 fix batch).** The
   no-flash bootstrap moved from an inline `<script>` in `index.html` to a
   self-hosted static file (`public/theme-init.js`) loaded via a normal
   BLOCKING `<script src="/theme-init.js">` — this satisfies production
   nginx's strict `script-src 'self'` (no hash/nonce/`unsafe-inline` needed)
   with the exact same no-flash guarantee, since it's a synchronous,
   non-module script that still runs before the app bundle mounts. Closes
   AUDIT-ENGINEERING.md Pass 12, P1-1. Hardened the regression guard rather
   than just the instance: `scripts/smoke-web-csp.sh` gained a mode-3 check
   that fetches the real served `index.html` + CSP header and FAILS if any
   inline `<script>` (no `src=`) exists while `script-src` lacks
   `unsafe-inline`/nonce/hash — this generalizes past this one bug to catch
   the *next* accidental inline script too. Also added a Docker-artifact-style
   Playwright check (`apps/web/e2e/csp-artifact.spec.ts`) that serves the real
   built `dist/` bundle with the production CSP header via a tiny Node static
   server and asserts zero `script-src` CSP violations + dark mode applies —
   closes the "green tests, broken shipped artifact" gap for this class
   without needing a full `docker compose` Playwright harness.
3. **Admin controls depth (behind, narrowing).** Real progress already
   shipped 2026-07-02 (SSO/OIDC Phase 1, workspace-switcher search/
   recently-visited), and one of the two remaining blockers closed the same
   day this pass: (a) **in-app SSO/OIDC configuration screen — ✅ shipped
   2026-07-02.** An instance admin now configures provider/client
   id/secret/issuer/label from `/admin/sso` instead of an env-var edit + API
   redeploy — client secret AES-256-GCM-encrypted at rest via the shared
   crypto util extracted from the GitHub PAT pattern
   (`apps/api/src/common/crypto/secret-crypto.util.ts`, both
   `github-crypto.util.ts` and the new `oidc-secret-crypto.util.ts` delegate
   to it); env vars still WIN over the DB config when set (12-factor,
   read-only "env-managed" banner in that state); a save takes effect on the
   very next login attempt/`GET /auth/providers` poll — NO API restart
   (`OidcService`'s discovery-client cache is keyed by a config fingerprint,
   not a process-lifetime singleton). New instance-level `User.isInstanceAdmin`
   (additive migration, first-ever user on a fresh install defaults true,
   oldest existing user backfilled on upgrade) gates it — deliberately
   narrower than workspace `Membership.role: ADMIN`, since this is a
   secret-bearing instance-wide setting. 33 new API unit tests (encryption
   round-trip, env>DB precedence, secret never serialized, instance-admin
   gate) — 1554 API tests green; new `apps/web/e2e/admin-sso-settings.spec.ts`
   (non-admin sees no nav entry + access-denied route; admin configures +
   enables via per-keystroke typing; the login page's SSO button appears with
   zero API restart; disable removes it) green desktop+mobile; MCP: not
   exposed — instance SSO secrets are not agent-appropriate (mirrors the
   existing GitHub-config skip in `apps/mcp/README.md`). (b) **per-project
   role override — ✅ schema + backend shipped 2026-07-02** (frontend UI is
   the tracked follow-up slice, see `docs/BACKLOG.md`). New additive
   `ProjectMembership(projectId, userId, role)` table — sparse by design,
   absence means "inherit the workspace role"; the shared `assertProjectRole`
   authz chokepoint (`apps/api/src/common/membership.util.ts`, already called
   by every project-scoped service — labels, statuses, sprints, workflows,
   webhooks, versions, components, dashboards, share tokens, GitHub
   integration, issue templates, custom fields, work logs, automations,
   checklist, issue links, poker, standups, saved filters, attachments,
   board, issues) now resolves the caller's *effective* project role through
   a new `getEffectiveProjectRole` helper: an override row wins over the
   workspace role — both ELEVATING (MEMBER -> project ADMIN) and RESTRICTING
   (MEMBER -> project VIEWER, still read-only via `assertProjectMember`) — a
   workspace ADMIN always resolves to ADMIN regardless of any stray override
   row, and a `ProjectMembership` row alone never grants access without a
   workspace `Membership` (tenant isolation preserved). New
   `ProjectMembershipsController`/`Service`
   (`apps/api/src/project-memberships/`): `GET /projects/:id/members` (every
   effective member: workspace role, effective role, `isOverride` flag) /
   `PUT`&`DELETE /projects/:id/members/:userId/role` (set/clear an override;
   effective-project-ADMIN gated; 400 refuses to override a workspace admin;
   audit-logged as `project_membership.override_set`/`_clear`). 13 new
   service unit tests + 9 new `membership.util.spec.ts` cases (elevate,
   restrict, admin-override-ignored, tenant-isolation-without-workspace-
   membership) — 1575 API tests green; 3 new tenant-isolation-matrix rows (96
   total) all BLOCKED. MCP: `list_project_role_overrides` /
   `set_project_role_override` / `remove_project_role_override` (88 tools
   total, up from 85) — role management is agent-appropriate, not
   secret-bearing. **Frontend UI (Phase 2 of 2) — ✅ shipped 2026-07-02,
   closing the "Admin controls" gap.** A new "Members" section on the
   project Settings page (`MembersSection.tsx`, between Project details and
   Columns) lists every effective member (avatar/name/email, workspace-role
   chip, effective-role control, "Inherited" vs "Override" badge). For a
   viewer who is themselves an effective project ADMIN: a role `<select>`
   (ADMIN/MEMBER/VIEWER) per row sets an override (skips the call when the
   picked role already matches, avoiding a no-op PUT), plus a "Revert to
   inherited" action (behind a `ConfirmDialog`) on overridden rows; a
   workspace ADMIN's row renders a disabled, fixed-ADMIN control with a
   tooltip ("Workspace admins always have full access to every project"),
   mirroring the server's 400; the viewer's own row is never
   self-editable (mirrors the existing `WorkspaceMembersPage` "isMe"
   convention, avoiding an accidental project-access self-lockout); a
   workspace with only the caller shows a "No other members" empty state.
   Non-project-admin viewers see the same list fully read-only (no
   `<select>`/no revert). New `apps/web/src/api/projectMembers.ts`
   (`useProjectMembers`/`useSetProjectRoleOverride`/
   `useClearProjectRoleOverride`, `qk.projectMembers(projectId)`,
   invalidate-on-settle — mirrors `ComponentsSection`'s mutation-hook
   convention) — zero backend changes (Phase 1's REST surface consumed
   as-is). New `apps/web/e2e/project-members.spec.ts` (4 scenarios × desktop
   1280 + mobile 393, 8/8 green): admin sees the effective list with
   inherited roles; setting a VIEWER override flips the badge AND is
   verified as a **real** access change — a second, independent browser
   session logged in as the target member creates an issue successfully
   *before* the override (positive-control baseline), then, after the
   admin sets the override, attempts the identical real-UI create-issue
   flow (per-keystroke title) and gets a genuine 403 error toast
   ("Requires MEMBER role in this project") with no issue created — not
   just a cosmetic badge check; "Revert to inherited" restores the badge
   AND write access (re-verified the same way); a workspace-ADMIN row's
   control is confirmed disabled with the tooltip; a non-project-admin
   viewer gets a fully read-only list. Mobile layout note: the row switches
   from a horizontal to a stacked (`flex-col` → `sm:flex-row`) layout below
   the `sm` breakpoint so the name/email block never gets crushed by the
   fixed-width role controls (caught and fixed during this pass's own
   screenshot review, not shipped un-reviewed). `tsc --noEmit` +
   `pnpm --filter @next-lane/web build` clean;
   `settings-robustness.spec.ts`/`components.spec.ts`/
   `viewer-aware-ui.spec.ts`/`board.spec.ts` regression re-verified green
   desktop+mobile (44/44). MCP already covered by the Phase 1 backend batch
   (`list_project_role_overrides`/`set_project_role_override`/
   `remove_project_role_override`) — no new MCP surface needed for this
   slice. **Both blockers now closed — "Admin controls" is fully addressed
   on end-user-visible grounds; only the still-tracked SSO Phase 2
   (SAML/multi-provider/JIT provisioning) remains as a separate, unblocked
   enhancement, not a scorecard blocker.**
4. **Integrations depth (closing — GitHub AND GitLab v1 both de-risked).**
   GitHub integration v1 is confirmed genuinely working end-to-end — a real
   HMAC-SHA256 signed webhook round trip (push + pull_request), correct
   idempotent issue linking, and signature tampering correctly rejected with
   401 (AUDIT-PRODUCT.md Pass 12). **GitLab integration v1 — ✅ shipped
   2026-07-03** (see the Phase 9 entry above for full detail): same
   two-way-link shape, GitLab semantics (`X-Gitlab-Token` shared-secret
   compare instead of HMAC, self-hosted-first `gitlabBaseUrl`), live
   round-trip verified against the running API (valid webhook links the
   issue, tampered/missing token 401s, replay is idempotent, PAT scope
   gating enforced). Next: **Gitea** (HMAC-based like GitHub, filed as a
   separate Next(P2) item in `docs/BACKLOG.md` since its signature scheme
   differs from GitLab's) and **PR-status + auto-transition-on-merge** (a
   per-project config toggle, off by default, plus a board-card "linked PR"
   badge mirroring the existing blocked-issue badge) — the incumbent's
   day-one SCM feature set is closing but not yet fully matched.

   **Agent Experience (AX) batch, Phase A — ✅ shipped 2026-07-03** (Phase B —
   the MCP surface — tracked separately in `docs/BACKLOG.md`, deferred until
   the GitLab work above lands to avoid touching `apps/mcp` concurrently).
   Founder-relayed field report from a real MCP-agent user: "No startDate on
   issues — only dueDate... had to jam start dates into description first
   lines." Added `Issue.startDate DateTime?` end-to-end: additive migration
   (`20260703030000_add_issue_start_date`); create/update DTOs +
   `IssueDto.startDate` in `packages/shared`; cross-field validation
   (startDate must be <= dueDate when both set, enforced in
   `IssuesService`, mirrors dueDate's null-clears/undefined-no-op semantics
   and activity-log entry); NLQL `startDate`/`start` field registered
   everywhere `dueDate` is (field allowlist, evaluator, autocomplete
   suggestions, `docs-site/guide/features.md` reference); CSV export gains a
   "Start Date" column beside "Due Date" (20 columns now); CSV/Jira importer
   maps a "Start Date" column when present (GitHub/Linear exports don't have
   one — not attempted); issue drawer gets a Start date picker beside Due
   date (same UX/clear affordance); the Roadmap timeline's epic-window
   derivation now prioritizes the epic issue's own `startDate`→`dueDate`
   range over the existing child-sprint-dates/createdAt fallback chain when
   `startDate` is present (`RoadmapEpicDto.fromOwnDates`). This is a
   data-model gap, not just an MCP gap — closing it here means Phase B's
   `list_issues`/`create_issue`/`get_epic_overview` MCP work (next) exposes a
   real field instead of the description-hack workaround.

   **Agent Experience (AX) batch, Phase B — ✅ shipped 2026-07-03** (the MCP
   surface, landed the same day Phase A did). Closes the remaining four
   frictions from the same field report, `apps/mcp` only (no API/schema
   changes — every fix composes existing REST endpoints):
   (1) **NLQL on `list_issues`:** new `query` param passes a full NLQL
   expression through to `GET /projects/:id/issues.csv?q=` (the only existing
   endpoint that runs the real parser/evaluator server-side) as a
   match-oracle, then hydrates full issue objects via the existing
   cursor-paginated `GET /issues` — an invalid query surfaces the API's exact
   parser message (`Invalid NLQL query: ...`), not a generic failure;
   documented missing-endpoint follow-up: a JSON NLQL-filtered issue list
   endpoint would remove this two-call composition and its id-hydration cap.
   (2) **Token-efficiency sweep across every `list_*`/`search_issues` tool**
   (25 tools, not just issues): a uniform `{ items, total?, limit, offset?,
   hasMore }` envelope, a hand-picked compact field set per resource
   (`list_issues` → `{key, title, status, assignee, priority, type,
   startDate}`) with `verbose: true` to opt into the full DTO, and
   `limit`/`offset` defaulting to 50 (max 200) — live-verified against a
   44-ticket fixture project: the same `list_issues` call that would have
   been ~150 KB is 11 KB compact / 3.8 KB for an NLQL-narrowed subset (was
   84 KB verbose). (3) **Wrong-project guard on `create_issue`:** response
   always echoes the resolved `project: {id, key, name}`; description tells
   agents to confirm the target project; optional `expectedProjectKey` fails
   *before* creating anything on a mismatch. (4) **`get_epic_overview`**: one
   REST call (`GET /issues/:id`, reusing the same parent→children relation
   the issue drawer's sub-tasks list uses) returns the epic, compact
   children, a per-status breakdown, and a `{done, total, fraction}`
   progress figure — children can't carry `assignee`/`startDate` because the
   API's `IssueRefDto` doesn't project those fields; call `get_issue` per
   child for that. (5) **startDate exposed on MCP**: `create_issue`/
   `update_issue` gain `startDate`; compact + verbose `list_issues` output
   both include it. `get_epic_overview` children omit it — the API's
   children relation doesn't select it (see above), filed as a small
   follow-up for whoever next touches that endpoint. 89 tools total (38
   read / 51 write); 18 new unit tests (80 total, all green); `apps/mcp/README.md`
   tables + counts updated. Evidence bar met: an epic status question is one
   tool call; a filtered list response is single-digit KB, not 150.
5. **Configurable dashboards — Phase 2 (parity, closing toward better) — ✅
   shipped 2026-07-03.** Phase 1 verified strong (all 4 gadget types,
   custom-field grouping, precise NLQL validation, excellent empty/error
   states — AUDIT-PRODUCT.md Pass 12, 8/10) — this is what flipped Reporting
   Behind → Parity; Phase 2 is what moves it toward Better. **Shipped:** a
   cross-sprint velocity-trend gadget (`GET /projects/:id/reports/
   velocity-trend?sprints=N`, new `VELOCITY_TREND` visualization reusing the
   existing `VelocityChart` component — project-wide, not query-scoped);
   cross-workspace gadget scoping verified correct (project-derived, never
   the app's "active workspace") with a new multi-workspace e2e case, plus a
   real dashboard-selection race fixed along the way (creating a second
   dashboard could snap back to dashboard #1 before the list refetch
   landed); drag-to-reorder gadgets (replacing the v1 up/down buttons with a
   real dnd-kit sortable grid, fractional-midpoint `config.position`); a
   project's first dashboard now seeds 3 starter gadgets; `MAX_DASHBOARDS_
   PER_PROJECT`/`MAX_GADGETS_PER_DASHBOARD` caps + `getDashboardData`
   parallelized with `Promise.all` (engineering-auditor Pass-12 P2-2).
   Dashboard sharing/public read-only embed (reusing the board share-token
   pattern) was intentionally left for a separate Next(P2) item in
   `docs/BACKLOG.md` rather than bundled into this slice — **shipped
   2026-07-06, see the narrative paragraph below and the ticked
   `docs/BACKLOG.md` entry for full detail.** See the ticked
   `docs/BACKLOG.md` entry for full detail. **Realtime coverage ✅ shipped
   2026-07-02 (Pass-12 fix batch):** `SocketEvents.DashboardUpdated` added
   (`packages/shared`), emitted from `DashboardsService` on every
   dashboard/gadget CRUD mutation (create/update/delete dashboard,
   create/update/delete gadget) to the project room; `DashboardsPage`
   subscribes via `useBoardRealtime(projectId)`, which now invalidates the
   whole `['dashboardData']` query family on any `issue.*` event (mirroring
   `invalidateBoardFamily`'s "invalidate the family, not a single key"
   shape) and the specific dashboard's summary/detail/data on
   `dashboard.updated` — closes AUDIT-ENGINEERING.md Pass 12, P1-2.

**Re-affirmed Better, not part of this queue:** Board speed & feel, Workflow
flexibility, and Keyboard-first ergonomics all re-verified with fresh Pass-12
evidence (Swimlanes v2 desktop, the `enforceStatusChange` unification, and
live Cmd-K typing, respectively). **Search & query power flipped
Parity → Better this pass:** NLQL is now the one query language spanning
board grouping, saved/shared filters, automation conditions, *and*
dashboards — an architectural unification the incumbent's fragmented
JQL/automation-builder/report-config trio doesn't match. **Onboarding stays
Parity:** the persistent sidebar (Phases 1+2, shipped) durably fixes the
founder's "buried features" complaint, but self-hosting setup friction is
unchanged, so it's not enough alone to flip to Better. See `docs/VISION.md`
§ Better-than-Jira scorecard for the full per-dimension evidence.

**Shipped this wave, for the record (2026-07-02 founder directives — Kanban
field-sections, Settings/Workflows robustness, NLQL-native dashboards, MCP
parity, schema check-in):** **Kanban sections by field ("Swimlanes v2")
shipped** — extends the group-by to Component/Sprint/Labels/custom SELECT
fields plus a per-board default grouping (see the ✅ entry below, and item 1
above for its mobile regression). **Settings** and **Workflows robustness
passes** — both shipped (Settings 2026-07-02, Workflows 2026-07-03; see the
✅ entries above). **Custom dashboards are NLQL-native** — every gadget,
built-in or custom, is an NLQL query + a visualization (see the "Configurable
dashboards — Phase 1" ✅ entry). **MCP coverage parity** — two sweeps this
wave took the server from 55 → 76 → **85 tools** (the second sweep added 9
dashboard tools alongside Phase 1's ship), with the standing rule that every
feature's definition of done includes MCP exposure where it makes sense. DB
schema overhaul: **answered no** — small additive tables only (Dashboard/
DashboardGadget, GithubIntegration/IssueGithubLink), see the Phase 5 "DB
schema check-in" bullet above. **Navigation & IA overhaul Phases 1+2 and
light/dark mode all shipped 2026-07-02** and were independently re-verified
by both Pass-12 audits (persistent sidebar closes the founder's "buried
features" complaint; dark mode is thorough and token-driven across 6
surfaces — modulo the CSP artifact gap in item 2 above). **CSV export
column-completeness shipped** — verified at 19 columns including
Description, Component, Fix Versions, Parent, time estimates, and all custom
fields (AUDIT-PRODUCT.md Pass 12); a 20th column, Start Date, was added
2026-07-03 alongside Due Date (AX batch Phase A, see item 4 above); the
README/first-impression surface overhaul remains owned by `oss-curator`,
tracked there.

**Pass-12 engineering fix batch — two more mechanical/perf findings closed
2026-07-02 (in addition to the CSP and dashboards-realtime items above):**
(1) **Tenant-isolation matrix gap closed** (AUDIT-ENGINEERING.md Pass 12,
P2-3 — open for three consecutive audit passes): `tenant-isolation.integration.spec.ts`
gained rows for personal-cards (PATCH/DELETE foreign card), quick-links
(PATCH/DELETE foreign link), workspace `PATCH` + logo `POST`, GitHub
integration (GET/PUT/DELETE config + issue github-links read), and
dashboards (GET/PATCH/DELETE foreign dashboard, gadget CRUD, evaluated-data
endpoint) — the matrix grew from ~72 to 94 rows, all 93 non-sanity-check rows
confirmed BLOCKED against a real cross-tenant attempt. (2) **`resolveEnforcedWorkflowId`
N+1 in bulk status updates fixed** (AUDIT-ENGINEERING.md Pass 12, P2-1):
`bulkUpdate` now precomputes the WF-1 named-workflow resolution once per
batch (`buildBulkWorkflowResolution` — one `board.findMany` + one
`sprint.findMany` for the whole batch's distinct sprints, not per issue) and
threads it through `MutationOpts.resolvedWorkflowId`, closing the gap where
the existing bulk preload only ever fed the legacy fallback path, not the
WF-1 resolution branch `enforceStatusChange` actually hits. New unit tests
assert `board.findMany`/`sprint.findMany` call counts stay O(1) for a
5+ issue, multi-sprint named-workflow-enforced batch.

Everything below this line documents what already shipped; it is not being
rewritten, only re-prioritized going forward per the ordering above.

**Phase 5 — Core PM parity (continuing) + Phase 7 Glass Box automation (partially shipped) + OSS DX (docs site) — 2026-06-29.** The major Phase 5 slice landed: multiple boards ✅, custom fields ✅, NLQL query language ✅, NLQL query autocomplete ✅, saved filters ✅, conditional card colors ✅, planning poker ✅, issue links ✅, quick-filter presets ✅, watch toggle ✅, bulk edit ✅, personal boards ✅, personal/team analytics ✅, CSV export ✅, workspace branding (backend ✅ + frontend ✅), Versions/Releases (backend ✅ + frontend ✅). Phase 7 Glass Box automation engine fully shipped ✅. Configurable workflows backend (Phase 2 — REST API + enforcement engine) shipped ✅ 2026-06-28. Per-board named workflows backend (Phase 2b) shipped ✅ 2026-06-29: named Workflow entity CRUD, workflow-scoped transition CRUD, seed-from-template (simple/kanban/scrum/bug-triage), board workflow assignment, 3-branch board-aware enforcement routing in IssuesService.move, 1085 unit tests. Design cohesion: analytics/reports on Dispatch ink/signal tokens ✅; ProjectNav "More" dropdown ✅; signal scale CSS-var backed for runtime theming ✅. Engineering Pass-7 hardening ✅. Engineering Pass-8 hardening ✅ (logo magic-byte validation, tenant-isolation matrix extended >45 rows, automation ADMIN-gate, cross-project action validation, analytics DTO validation, bulkUpdate workflow pre-load, workload SQL aggregation; 790 tests green). Workflows MCP surface (Phase 4) shipped ✅ 2026-06-29: new `@next-lane/mcp` package — an MCP server (stdio) exposing 18 read/write tools so external agents (Claude Desktop, Claude Code) can introspect AND modify a project's workflows/SDLC + core entities via PAT-authenticated REST calls. **Design elevation polish pass (2026-06-29):** Settings surfaces (WorkflowsManager, WorkflowGraph, TemplatesManager, ComponentsSection, VersionsSection, NotificationPreferencesSection) migrated from `slate-*` → `ink-*` tokens; empty states elevated to icon+heading+description dashed-card pattern; workflow graph gains dot-grid canvas + node feDropShadow; progress bars in TimeTrackingSection + ChecklistSection show monospace % label; BoardWorkflowSelector badge uses `ring-1 ring-inset` + inner ENFORCED chip; BoardColumn WIP over-limit chip gains warning triangle SVG icon; NotificationsPage issue keys use `.nl-issue-key` signature class; all `data-testid`/ARIA hooks preserved; tsc + build clean. **Design elevation pass 2 — older surfaces (2026-06-29):** `IssueCard` due-date and story-points chips gain `ring-1 ring-inset` badge vocabulary (overdue: `bg-amber-50 text-amber-700 ring-amber-200`); `AppHeader` NavLinks, search buttons, and user-menu avatar button gain `focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1`; active NavLink adds `ring-1 ring-inset ring-signal-100`; `NotificationBell` bell trigger and "Mark all read" button gain system focus rings; `RoadmapPage` full `slate-*` → `ink-*` migration + breadcrumb truncation pattern; `LoginPage` password label aligned to Field primitive (`text-xs font-medium text-ink-600`), forgot-password link `text-signal-600 font-medium`, error banner gains `role="alert" border border-red-200`; `RegisterPage` footer link `slate-*/brand-*` → `ink-*/signal-*`, error banner `role="alert"`; `ForgotPasswordPage` success-state copy `slate-*` → `ink-*`, email literal in `<code>` mono chip, both links migrated; `ApiTokensSection` and `WebhooksSection` complete `slate-*` → `ink-*` migration — scope pills `bg-signal-50 ring-1 ring-inset ring-signal-100`, status badges `ring-1 ring-inset`, delivery badges `ring-1 ring-inset`, empty states upgraded to icon+heading+description dashed-card, toggle `bg-emerald-500`/`bg-ink-300`. All `data-testid`/role/aria-label hooks preserved; tsc pre-existing error unchanged; `pnpm --filter @next-lane/web build` clean (CSS 87.23 kB). **Remaining parity gaps (next build targets):** email-to-issue (P1, M), automation dry-run endpoint (P1, M), Docker nginx CSP CI smoke-test (P1, S). Tracker importers (Jira/GitHub/Linear) ✅ shipped 2026-06-29 (file-based; `?source=` param). **Kubernetes/Helm deploy hardening (2026-06-29):** migrations moved from a pre-install hook (which ran before the bundled DB existed) to an API init-container with a retry loop (advisory-lock-safe across replicas; the opt-in hook Job remains for external DBs); the bundled Bitnami Postgres/Redis subcharts (images moved off Docker Hub) replaced with vendored official `postgres:16` StatefulSet + `redis:7-alpine` Deployment; the chart-managed Secret hook-annotation whitespace chomping fixed; and the **web pod made `readOnlyRootFilesystem`-safe** — the entrypoint writes `config.js` to a writable volume (served via nginx `alias`) and only substitutes the CSP placeholder when the conf is writable, with same-origin deployments injecting `API_URL=""` for relative requests (Helm + kustomize). Phase 6 (Autopilot: private/unlimited self-hosted AI + MCP-native) and Phase 7 rule library/data-ownership are next moonshots after parity. **Workspace chip sync completed across all workspace/project-scoped pages (2026-07-02):** the remaining seven pages flagged by both Pass-11 audits (Reports, Roadmap, Project Analytics, Workspace Members/Audit Log/Settings/Branding) now call `useSyncActiveWorkspace`; dead `DashboardPage.tsx` removed. **`project.updated` realtime event shipped (2026-07-02):** `Project` was the only top-level entity with zero realtime coverage — a rename/archive never propagated to a second open tab without a manual reload. `SocketEvents.ProjectUpdated = 'project.updated'` added to `packages/shared`, emitted from `ProjectsService.update()` and `.archive()` to the project room (payload: mapped `ProjectDto`); `useBoardRealtime` (`apps/web/src/api/socket.ts`) invalidates `qk.project`, `qk.projects(workspaceId)`, `qk.boards`, and the board-view family on receipt — no per-page wiring needed; 4 new unit tests (1342 API tests green); `tsc --noEmit` clean both apps. Realtime-coverage inventory: Board/Workflow/CustomFieldDefinition/Component/Version services still emit **zero** realtime events on mutation — same stale-tab gap, filed as a follow-up below. **SSO/OIDC Phase 1 shipped (2026-07-02):** env-configured generic OIDC login provider (`OIDC_ISSUER_URL`/`OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET`) via `openid-client`; PKCE + state/nonce CSRF-guarded authorization-code flow; JIT user provisioning by email issuing the same JWT session password login issues; `GET /auth/providers` capability probe gates the "Continue with `<label>`" button on `LoginPage`; fully off/no-op when unconfigured. 41 new unit tests (1375 API tests green); closes the first half of the "Admin controls" gap above — SAML/multi-provider/JIT workspace-role provisioning is the tracked Phase 2 follow-up. **Navigation & IA overhaul — Phase 1 (persistent left sidebar) shipped 2026-07-02:** App.tsx-level `AppShellFrame` renders `<AppSidebar>` (desktop, `lg`+) and `<MobileSidebarDrawer>` (overlay, below `lg`) as siblings of `<Routes>` — one mount for the whole session, never remounted per page. Sidebar sections: workspace (switcher reuses the extracted `WorkspaceSwitcherMenuContent` — the exact same search/recent/list logic and `WorkspaceContext` state as the header chip, no duplicate state), projects for the active workspace (active project gets the signature cobalt "rail tick" + `aria-current="page"`, project key rendered via the existing `.nl-issue-key` mono chip), personal (My Work/My Board/Insights/Notifications), and a bottom workspace-settings link. Collapsible to a 56px icon rail; state persisted to `localStorage` and restored synchronously (no flash). `AppHeader`'s My Work/My Board/Insights links hide at `lg`+ (sidebar owns them there, no duplication); `gotoSection` test helper made viewport-generic (checks all role-matched links for the first visible one, not just `.first()`) so it keeps working regardless of which surface currently owns a link. New `data-testid`s: `nav-sidebar`, `nav-sidebar-toggle`, `nav-sidebar-project`, `nav-sidebar-drawer`, `nav-sidebar-workspace-trigger`, `nav-sidebar-drawer-toggle`. `nav-sidebar.spec.ts` (12 tests) + a new `workspace-switcher.spec.ts` sidebar case, full existing e2e suite (898 tests, desktop+mobile) green; `tsc --noEmit` + build clean. Four real cross-suite regressions surfaced by the full-suite gate and fixed at the root cause (not papered over): an `activeWorkspace`-load timing gap that briefly left both the header link and the not-yet-mounted sidebar unreachable; three tests whose loose page-wide text/role matchers collided with the sidebar now also rendering every project's name (fixed by scoping locators, not by weakening the sidebar); a shared `.nl-scroll` utility class collision (new `board-scroll-container` testid disambiguates); and the new mobile hamburger pushing the header past its 375px wrap budget (chip `max-w` + hamburger footprint trimmed). Two further full-suite failures were confirmed pre-existing via `git stash`-to-baseline (unrelated in-flight CSV-column work; a stale mobile assertion against `ProjectBreadcrumb`'s documented desktop-only badge slot) and one (`role-enforcement.spec.ts`) traced to an already-shipped, unrelated backend behavior change — see the ticked BACKLOG entry for the full breakdown. **Navigation & IA overhaul — Phase 2 (surface buried features as first-class nav) shipped 2026-07-02:** built on Phase 1's sidebar shell, additive to `ProjectNav` (untouched). The active project's sidebar row now expands a `ProjectViewsSubNav` — Board/Backlog/**Roadmap**/Reports (`nav-sidebar-view`) — directly beneath it, so the Gantt-style Roadmap, previously two clicks deep in `ProjectNav`'s "More" dropdown, is one visible click away; a `Branding` row (`nav-sidebar-branding`) now sits beside "Workspace settings" in the sidebar's bottom utility section, gated on `useMyRole() === Role.ADMIN` (the same gate `WorkspaceBrandingPage` itself enforces); and the board toolbar's default-filter chip (`board-filter-indicator`) changed from a passive `<span>` to a `<button>` that opens `BoardSettingsModal` pre-scrolled to and auto-focusing the Default-filter field (`BoardSwitcher`'s new `openFilterField`/`focusFilterField` props mirror the existing `openColorsTab` pattern), with a new dashed-border "+ Default filter" empty-state affordance (`board-filter-chip`, MEMBER+) shown when no filter is configured yet. Both `AppSidebar` and `MobileSidebarDrawer` get every addition for free (shared `SidebarNavContent`). 3 new `nav-sidebar.spec.ts` cases (Roadmap reachable, Branding reachable for an admin, filter chip opens Board settings) plus full regression re-run — `nav-sidebar.spec.ts`/`workspace-switcher.spec.ts`/`board.spec.ts`/`board-switcher.spec.ts`/`roadmap.spec.ts`/`board-default-filter.spec.ts` all green desktop+mobile; `tsc --noEmit` + build clean. A pre-existing, unrelated `analytics.spec.ts` flake (More-menu click race under parallel load) was reproduced identically on the pre-Phase-2 baseline via `git stash` and filed separately rather than papered over — see the ticked BACKLOG entry. **MCP coverage parity sweep shipped 2026-07-02:** audited the 55 existing `@next-lane/mcp` tools against the shipped feature surface and closed every founder-scoped gap — GitHub issue links (read-only), quick links, personal boards (list/create/move cards), issue templates (list + create-issue-from-template), the time-tracking estimate field on `create_issue`/`update_issue`, CSV export (`get_project_csv`, raw text), bulk update, project/personal analytics + velocity/burndown/CFD reports, and notifications (list + mark read); 21 new tools total (12 read / 9 write), taking the server to 76 tools (33 read / 43 write); configuring the GitHub integration stayed unwired (admin-only, and its `GET` leaks the plaintext webhook secret to admins) per the same secret-bearing rule already applied to webhooks/API tokens. Full gap table in the ticked `docs/BACKLOG.md` entry.

**UI design elevation (2026-06-27): "Slate + Teal-Shift" design system foundation shipped.** Full token-system overhaul: deep teal accent replacing generic indigo; stone/amber/emerald status-progression arc (Todo→In Progress→Done); Plus Jakarta Sans Variable for UI copy + IBM Plex Mono for issue keys / story points (the signature element — teal `.nl-issue-key` class applied to every issue key); refined shadow/radius/spacing/animation scales; all UI primitives (Button, Input, Select, Textarea, Field, Badge, Avatar, Modal, Toast) and highest-traffic surfaces (AppHeader, BoardColumn, IssueCard, CardStatusPicker, IssueDetailDrawer, AuthShell) updated. Self-hosted via @fontsource (no CDN). Drawer and modal entrance animations; `prefers-reduced-motion` respected. WCAG-AA contrast maintained. All test hooks (`data-testid`, ARIA roles, accessible names) preserved; 24/24 representative e2e tests pass. The component redesign loop continues (see docs/UI-REVIEW.md tracker).

**Phase 3 security hardening sprint (Pass 5) + Phase 4 observability hooks now complete. Tenant isolation harness shipped (2026-06-27): 42-endpoint cross-tenant matrix + WebSocket gateway isolation, all BLOCKED.** Phases 0–2 are fully done (CFD shipped 2026-06-27, closing the last Phase 2 item). Phase 4 Kubernetes packaging is substantially complete (Helm, Kustomize, GHCR CI, Redis adapter, BullMQ queue, observability hooks — all shipped 2026-06-27). Phase 4 is now functionally complete; the only remaining gate is the real `docker compose up -d --build` first-run validation on a host with registry access.

Engineering-auditor Pass 5 (2026-06-27) identified a fresh security hardening cluster now being fixed: password reset token logged in plaintext to production logs (P1, S); SVG attachment served as `image/svg+xml` allowing direct-navigate XSS (P1, S); CFD/burndown unbounded queries that will OOM for any active project (P1, M — rewriting as Postgres `generate_series` aggregation); null-file upload returning 500 instead of 400 (P2, S); webhook HMAC secret stored in plaintext BullMQ job body (P2, S); PAT `expiresAt` accepting past dates (P2, S); nginx container missing Content-Security-Policy header (P2, S); Helm bundled-Postgres default password lacking a fail-fast guard (P2, S). All being addressed in the current build batch.

Product-auditor Pass 5 (2026-06-27) confirmed the product crossed the "credible daily-driver" threshold. The two Pass-5 P1s — SMTP email delivery for password reset and `WATCHED_UPDATED` notification emission — are both shipped (2026-06-27). Due date on issues is shipped (2026-06-27).

SMTP email delivery for password reset shipped 2026-06-27: `MailModule`/`MailService` (nodemailer); real SMTP when `SMTP_HOST` set; dev-log fallback when absent; production-safe.
Due dates shipped 2026-06-27: `dueDate DateTime?` on Issue model (migration `20260627220000_add_issue_due_date`); create/update DTOs; `IssueDto.dueDate` + `MyWorkIssueDto.dueDate`; drawer date picker with clear button + overdue amber styling; card chip; My Work overdue badge + sort; 5 unit tests + 8 e2e (desktop + mobile).
PAT auth at the WebSocket handshake shipped 2026-06-27: `nlp_` tokens authenticate the socket via `ApiTokensService.validateRawToken()`; JWT path unchanged; 11 gateway unit tests.

Markdown rendering + attachment admin-delete shipped 2026-06-27: `marked` + `DOMPurify` for sanitized markdown in issue descriptions (view/edit toggle) and comments; `MarkdownRenderer` component; `@mention` tokens preserved; links open `target=_blank rel=noopener noreferrer`; `AttachmentsPanel` now respects `viewerRole` — ADMIN sees delete button on any attachment (matching API rule); `IssueDetailDrawer`/`BoardPage`/`BacklogPage`/`TriagePage` all pass `viewerRole`; 20 new e2e tests (10 desktop + 10 mobile) all green.

Next build order: inline card status transition (S, P2) → PAT scopes (M, P2) → swimlanes/group-by (L, P1) → remaining perf (slim planning endpoint, board-overview prefetch) + P3 ideas (sprint retros, issue templates).

PATs shipped 2026-06-27: `nlp_`-prefixed (SHA-256 hashed) with create/list/revoke + JWT-guard extension + profile-settings UI.
PAT-at-WS-handshake shipped 2026-06-27: `RealtimeGateway.handleConnection` now detects `nlp_` prefix and validates via `ApiTokensService.validateRawToken()`; revoked/expired/unknown PATs disconnect the socket immediately; JWT path unchanged; 11 new unit tests.
Workspace audit log shipped 2026-06-27: ADMIN-only cursor-paginated event table (membership/project/webhook/token events).
Attachments shipped 2026-06-27: multer disk storage, MIME allowlist, auth-gated streaming download, drag-drop panel.
Label rename shipped 2026-06-27: PATCH /labels/:id + inline edit in Settings + LabelPicker.
Team Pulse dashboard shipped 2026-06-27: sprint snapshot, assigned-issues, recent activity, projects grid.
Keyboard triage mode shipped 2026-06-27: j/k/s/p/a/l/Enter/f/? keyboard model, ARIA listbox, command palette entry.

**v1 is feature-complete and green.** The single remaining gate is the real `docker compose up -d --build` first-run validation on a host with container-registry access. The following shipped during the v1 push and are no longer post-v1: NLQL query language + saved filters, custom fields, automation rules (Glass Box engine), bulk edit, planning poker, async standups, personal boards, personal/team analytics, CSV export, workspace branding, swimlanes, workflow transitions, time tracking, email notifications for all event types (beyond password reset), CSV import + tracker importers, SSO/OIDC Phase 1 (generic-provider login, 2026-07-02), SSO/OIDC Phase 2 (SAML + multi-provider + JIT workspace/role provisioning, 2026-07-06). Genuinely post-v1 remaining work: SQL/warehouse export, rule library/templates.

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

Everything beyond this (custom fields, automation rules, time tracking, SSO Phase 1, email-to-issue, importers — all since shipped; see Phase 5 above) was **post-v1** and did not block the release.
