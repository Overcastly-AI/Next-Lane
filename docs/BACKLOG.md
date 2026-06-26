# Next Lane — Dev Board (Backlog)

Single prioritized board maintained by the **backlog-groomer**, fed by the two independent auditors (`docs/AUDIT-PRODUCT.md`, `docs/AUDIT-ENGINEERING.md`), the front-end QA review (`docs/UI-REVIEW.md`), and the roadmap (`docs/ROADMAP.md`). The autonomous build loop pulls from **Ready (top of queue)**.

Format: `- [ ] (P1, M) title — description [src]` · P0 critical / P1 now / P2 next / P3 later · size S/M/L. Checked `[x]` = done.

> Grooming note (2026-06-26, Pass 3): Engineering auditor's Pass 3 found a TOCTOU race
> in sprint start (`assertNoOtherActiveSprint` runs OUTSIDE the transaction) and three
> input-validation gaps (description unbounded, storyPoints no range guard, label color
> not hex-validated). These land at P1 with the global exception filter (also P1, still
> not shipped). Product auditor's Pass 3 confirms the agile core is now genuinely
> functional and pivots the product gap to reports + observability + power-user flows.
> Both auditors agree the TOCTOU sprint race is correctness-critical (one-active-sprint
> invariant just shipped; must be hardened immediately). Tension noted: engineering
> auditor escalated the webhook/automation system to P1 (as the primary integration
> surface for self-hosted teams) while the product auditor treats it as P3 (flagging
> reports and "My Work" as higher-leverage for near-term user value). Resolution: webhook
> system remains P2 (the product's core loop is not blocked by it; reports and "My Work"
> unlock daily-use value faster); full-text search + saved views similarly kept P2
> (real gap, but not correctness-critical). The VIEWER-aware UI is promoted from P1-Next
> to Ready — it is S-sized, correctness-adjacent (closes the 403 confusion gap), and has
> been deferred two passes.

---

## Ready (top of queue)

- [x] (P0, M) Authenticate realtime gateway + membership-check subscribe — any client could join any projectId room and receive all issue/comment events; cross-tenant leak. Auth the handshake (JWT) and assertProjectMember before join [engineering-auditor]
- [x] (P0, M) Validate tenant ownership of statusId/sprintId/parentId/beforeId/afterId on issue update & move — members could attach issues to another project's status/sprint/parent and corrupt foreign boards [engineering-auditor]
- [x] (P0, M) Enforce roles (VIEWER read-only; ADMIN-only member mgmt & deletes) — Role enum was stored but never checked; any member could self-upsert ADMIN via addMember [engineering-auditor, product-auditor]
- [x] (P0, S) Fail fast on missing JWT_SECRET + remove bypass paths (docker-compose default + RealtimeModule fallback) — app could boot with a globally-known signing key when env was unset; compose injected the known string silently [engineering-auditor]
- [x] (P1, S) CORS origin allowlist from env — dropped origin:true + credentials:true; defaults to the web app URL [engineering-auditor]
- [x] (P1, S) Fix label-chip contrast in issue drawer — reuse Badge instead of inline raw-color chips so light labels stay legible [ui-review]
- [x] (P1, S) Drawer as first-class overlay — scroll-lock, focus trap + restore, z-index aligned with Modal via shared hook [ui-review]
- [x] (P1, M) Replace native window.prompt/window.confirm (new workspace, delete issue) with themed modals [ui-review]
- [x] (P1, M) Add a lightweight toast system; surface drawer-patch + mutation errors consistently [ui-review, product-auditor]
- [x] (P0, S) Validate assigneeId is a workspace member on issue create/update — any authenticated user ID can be set as assignee cross-tenant; assertWorkspaceMember utility already exists, just needs to be applied in IssuesService.create/update [engineering-auditor]
- [x] (P0, S) Scope GET /users to the caller's co-members — current endpoint returns all users' names + emails to any authenticated user across all tenants; add workspaceId filter to UsersService.findAll [engineering-auditor]
- [x] (P1, M) API unit tests for membership.util + assertSameProject + GitHub Actions CI — zero unit tests; test script is still a stub; isolation fixes are Playwright-only (slow, DB-dependent); a Jest suite + Actions workflow makes the security model self-maintaining [engineering-auditor]
- [x] (P1, S) Comment edit-in-place + delete in CommentsPanel — backend PATCH/DELETE /comments/:id exist; UI has no edit or delete affordance; visible gap that reduces user trust [product-auditor]
- [x] (P1, S) Activity log: resolve status/user IDs to human names — log currently shows raw DB IDs in from/to fields; drawer already has statuses and users in scope; <10-line fix [product-auditor]
- [x] (P1, L) Backlog + sprint planning view — `/projects/:id/backlog` page grouping issues into PLANNED/ACTIVE sprint sections + a Backlog section, with a "Move to" menu, create-sprint modal, Start (single-active enforced server-side), and Complete (incomplete issues return to backlog). Board/Backlog sub-nav added [product-auditor, roadmap]
- [x] (P1, M) Labels assign/unassign + filter UI — create/edit/delete labels, assign on card and in drawer, filter board by label(s); useLabels hook is written and backend CRUD + assign/unassign endpoints are live [product-auditor, roadmap]
- [x] (P1, M) Story points field + parent/child picker in issue drawer — expose storyPoints number field and a parentId picker for epic/story/subtask hierarchy; schema and API fully support it [product-auditor, roadmap]
- [x] (P1, S) Sprint TOCTOU race: move assertNoOtherActiveSprint inside $transaction + add partial unique index — `assertNoOtherActiveSprint` runs a `findFirst` OUTSIDE the `$transaction` block; two concurrent "start sprint" requests both pass the guard and both write `state: ACTIVE`, violating the one-active-sprint invariant; no DB-level partial unique index to enforce it. Fix: (a) move guard inside tx using `tx` client, (b) add migration `CREATE UNIQUE INDEX sprint_one_active_per_project ON "Sprint"("projectId") WHERE state = 'ACTIVE'` [engineering-auditor]
- [x] (P1, S) Sprint lifecycle: emit sprint.updated realtime event on start/complete — board viewers in other tabs see stale data until page reload; no push notification emitted when a sprint starts or completes; inject RealtimeService into SprintsService and emit `sprint.updated` on lifecycle transitions [engineering-auditor]
- [x] (P1, M) Global exception filter: map Prisma errors to structured HTTP responses — unhandled P2002/P2025/P2003 + rankBetween edge cases surface as raw NestJS 500s with stack traces in responses; add @Catch() filter with consistent { statusCode, message, error } envelope; suppress stack traces in production [engineering-auditor]
- [x] (P1, S) Input bounds: @MaxLength on description, @Min/@Max on storyPoints, hex validation on label color — description is unbounded (MB payloads accepted); storyPoints accepts negative/astronomic values; label color accepts any 20-char string and can produce corrupt UI renders [engineering-auditor]
- [x] (P1, S) VIEWER-aware UI: hide/disable edit affordances based on role — role enforced at API; UI still renders Delete button and all field-edit controls for VIEWERs who then get a silent or confusing 403 on click [product-auditor, engineering-auditor] — added `useMyRole(workspaceId)` (derives role from the existing `/workspaces/:id/members`, no new endpoint) + a `canEdit` helper; VIEWERs no longer see create-issue/add-column/create-sprint, drag-and-drop is disabled, the issue drawer hides Delete and disables all field edits, and label/parent/comment edit affordances are gone, with a subtle "View only" hint on board + backlog + drawer. ADMIN/MEMBER unchanged. e2e covers VIEWER vs ADMIN on board + backlog (desktop + mobile)
- [x] (P1, M) Manage board columns (statuses) from the board UI — "+ Add column" affordance at the end of the column row opens a name + category (To Do / In Progress / Done) form (optimistic insert + toast, server assigns next order); per-column overflow menu with Rename/edit, Move left/right (PATCH order swap), and a themed delete ConfirmDialog that surfaces a clear "Move or delete its issues first" toast on the 400 when the column still has issues; backend status CRUD already existed (API blocks VIEWER), errors surfaced gracefully. e2e covers add → rename → create issue in column → blocked delete → delete empty column on desktop + mobile [user-reported]

---

## Next (P1 — high value, queue as Ready empties)

- [x] (P1, M) Sprint burndown + velocity reports page — `/projects/:id/reports` with active-sprint burndown chart (story points remaining over calendar days), velocity bar chart (completed points per sprint); all data now in DB (Sprint.startDate/endDate, Issue.storyPoints, StatusCategory.DONE, ActivityLog timestamps); most glaring product gap post-agile-core [product-auditor]
  - [x] API: read-only `ReportsModule` — `GET /projects/:id/reports/velocity` (committed vs completed points per active/completed sprint) and `GET /projects/:id/sprints/:sprintId/burndown` (daily ideal vs actual-remaining derived from ActivityLog status→DONE transitions); membership-authorized; unit-tested with mocked Prisma; seed now sets story points + completion transitions
  - [x] UI: Reports page + ProjectNav link with hand-rolled responsive SVG velocity bar chart and burndown line chart (sprint selector defaulting to the active sprint, empty/loading/error states); e2e covers desktop + mobile
- [x] (P1, S) Board sprint indicator + backlog sprint dates — board now shows an active-sprint badge in the header (name · active · relative end-date countdown that turns amber when near / red when overdue), and the backlog sprint sections render each sprint's start–end date range plus an end-date warning chip for the active sprint when it's near/overdue. Reuses a shared sprintDates helper; handles missing dates gracefully. e2e covers the board badge + backlog dates/warning on desktop + mobile. (Sprint filter toggle to reveal off-sprint issues remains a separate follow-up.) [product-auditor]
- [ ] (P1, S) Sprint date display + due-date warning in backlog header and board toolbar — date fields collected at CreateSprintModal but never rendered anywhere; flag sprints past end date with a warning badge [product-auditor]
- [x] (P1, M) Cross-project global search — membership-scoped `GET /search` + `GET /projects/:id/search` (title/description/key contains) surfaced via the global command palette and header search button [product-auditor]
- [x] (P1, M) "My Work" personal dashboard — top-level `/my-work` route reachable from the header (next to Search): membership-scoped `GET /me/work` returns issues assigned to and reported by the caller across every workspace/project they belong to (key, title, type, priority, status, project key, sprint name/state); page renders "Assigned to me" + "Reported by me" sections with type icon, status pill, project key and priority, clicking a row opens its board with `?issue=`; empty/loading/error states; unit test asserts workspace+caller scoping (no cross-tenant leak); e2e proves a foreign tenant's issue never appears [product-auditor]
- [ ] (P1, L) Notifications: @mentions, auto-watch on assign/comment, in-app inbox (+ optional SMTP) — ActivityLog and Watcher models exist and are unused; high user value; exercises realtime properly [engineering-auditor, product-auditor]
- [ ] (P1, L) Tenant-isolation test harness + declarative authz layer — reusable two-workspace matrix asserting every mutating endpoint + socket room rejects cross-tenant access; @RequireRole/@ResourceScope decorator so isolation is structural, not hand-rolled per service [engineering-auditor]

---

## Next (P2)

- [ ] (P2, S) GET /users/:id authorization — scope to co-members — any authenticated user can fetch any other user's name/email/avatar by CUID; the co-member guard from `findAll` should also apply to `findOne`; Low severity but consistent with the isolation model [engineering-auditor]
- [ ] (P2, M) Replace assertNoParentCycle sequential waterfall with single recursive CTE — N sequential `findUnique` calls per hop (up to 1000 round-trips for deep trees); runs outside the update transaction (TOCTOU on concurrent parent reassignment); replace with a `WITH RECURSIVE` CTE via `$queryRaw` inside the transaction [engineering-auditor]
- [ ] (P2, M) Cursor pagination for issue list and board — findAll/getBoard return all issues with full includes unbounded; degrades large projects and can cause OOM [engineering-auditor]
- [ ] (P2, M) Transactional move + rank-collision rebalance — neighbor read/update outside a transaction can collide under concurrent moves; wrap in $transaction + add rebalance fallback [engineering-auditor]
- [ ] (P2, S) Fix Dockerfile --no-frozen-lockfile → --frozen-lockfile — non-reproducible image builds; pnpm may silently update dependencies in production image context [engineering-auditor]
- [x] (P2, M) Command palette (Cmd-K) navigation & actions — global keyboard-driven palette (Cmd-K/Ctrl-K + header button): grouped cross-project Issues/Projects search with ↑/↓/Enter/Esc, jump to issue (opens its board + drawer) or project, and current-project quick actions (Create issue, Go to Board/Backlog/Reports) [product-auditor]
- [ ] (P2, S) Inline issue creation in backlog (ghost row, type-and-Enter) — replace modal round-trip with a ghost row at the bottom of each sprint/backlog section; reduces bulk-creation friction during sprint planning [product-auditor]
- [ ] (P2, M) Plugin/webhook event system (HMAC-signed outbound POST on issue.* + sprint.* events) — automation and CI/CD integration prerequisite; RealtimeService.emitToProject infrastructure already in place; one new module [engineering-auditor, product-auditor]
- [ ] (P2, M) Full-text search + structured filters + saved views — move beyond `title ILIKE`; Postgres full-text search (GIN/tsvector) across title + description + comments; filter grammar (status/assignee/label/sprint/type/priority); persisted SavedView model; tracker unusable at scale without this [engineering-auditor, product-auditor]
- [ ] (P2, M) Observability baseline (pino structured logs, requestId, /metrics, OTel Prisma traces) — self-hosted product needs operator visibility without SSH; global exception filter (P1 item) is a prerequisite [engineering-auditor]
- [ ] (P2, M) Public read-only project share link — token-authenticated read-only URL shareable with stakeholders who don't need an account; ShareToken model + unauthenticated board endpoint + readonly board view (no DnD, no create); top self-hosted adoption lever [product-auditor]
- [ ] (P2, S) Fix stale socket token after re-auth — getSocket() captures the token once at init; when refresh tokens land, the socket will carry a stale credential until page reload; pass the current token as a parameter or reconnect on auth state change [engineering-auditor]
- [ ] (P2, S) JWT refresh tokens + logout/password reset — single 7-day non-revocable access token today; auth hardening [product-auditor, roadmap]
- [ ] (P2, S) Inline card status transition (right-click / keyboard shortcut) — tiny context menu on the card showing the 2–4 statuses; eliminates drawer round-trip for status changes; power-user flow [product-auditor]
- [ ] (P2, L) Roadmap / timeline view (Gantt — epics + sprints as bars) — horizontal timeline per project showing epics and stories across calendar weeks; no schema changes needed; stakeholder-facing; epics + sprint dates already in DB [product-auditor]
- [ ] (P2, M) Live board presence indicators (per-project viewer avatars via WebSocket) — gateway already tracks connections; augment handleSubscribe to maintain a per-project presence map and emit presence.update; zero new API routes [engineering-auditor]
- [ ] (P2, S) Board-overview prefetch endpoint + stale-while-revalidate caching — collapses 4 sequential requests (auth → workspaces → projects → board) into 1 on first load; immediate perceived performance improvement [engineering-auditor]
- [ ] (P2, S) Theme tokens for issueMeta hardcoded hex; create-issue modal single-column on mobile (grid-cols-1 sm:grid-cols-2) [ui-review]
- [ ] (P2, S) Extract shared InlineError/FormError (4 duplicated banners) + drawer title aria-label + min 40px touch tap targets [ui-review]

---

## Later (P3)

- [ ] (P3, S) Label rename / edit — users can't correct a label name typo without delete-and-recreate; obvious gap in label management [product-auditor]
- [ ] (P3, L) Automation rules engine (trigger → action: status/assignment/label) — flagship differentiator for self-hosted; depends on webhook system; ActivityLog is natural event source [product-auditor, roadmap]
- [ ] (P3, L) Saved/shareable views + query DSL (JQL-like filter grammar) — the saved-filter pattern teams live in; depends on full-text search + structured filters (P2) [product-auditor, engineering-auditor, roadmap]
- [ ] (P3, S) First-run onboarding + optional sample project + 4-step tour — empty board is a weak first impression [product-auditor]
- [ ] (P3, M) Custom fields (typed, JSONB-backed) [roadmap]
- [ ] (P3, M) Attachments (uploads volume) [roadmap]
- [ ] (P3, M) Webhooks + REST API tokens + audit log [roadmap]
- [ ] (P3, L) Time tracking / worklogs; CSV import + tracker importers; SSO/OIDC [roadmap]
- [ ] (P3, S) Scrub trademarked "Jira alternative" string from seed data [ui-review]

---

## Changelog

- 2026-06-26 (Pass 3 groom) — Ingested engineering-auditor Pass 3 + product-auditor Pass 3 findings.
  - **Ticked done [x]:** backlog + sprint planning view (`abd433b` + `4be79d6`), sprint lifecycle backend (single-active enforcement + incomplete-return), story points + parent/child hierarchy (`a2ec10c`), labels management + filter UI (`1d76d22`), activity log human-readable names (`04d096e`), comment edit/delete (`e03a807`), unit tests + GitHub Actions CI (`793b390`), assigneeId workspace validation (`58b4307`), GET /users co-member scoping (`2ef9f44`). All nine items verified confirmed by engineering auditor Pass 3 against shipped code.
  - **Escalated to P1 (added to Ready):** Sprint TOCTOU race — `assertNoOtherActiveSprint` runs outside `$transaction`; two concurrent start-sprint requests can both write `state: ACTIVE`; DB-level partial unique index is the only reliable guard (engineering-auditor Pass 3 Risk #1; S-sized, correctness-critical for a feature that just shipped). Sprint realtime events — start/complete emit no socket event; board viewers in other tabs see stale state (engineering-auditor Pass 3 Risk #8; S-sized). Input bounds — description unbounded, storyPoints unguarded, label color not hex-validated (engineering-auditor Pass 3 Risk #6; S-sized). VIEWER-aware UI promoted from P1-Next to Ready — S-sized, deferred two passes, correctness-adjacent.
  - **Kept P1 (global exception filter):** carried forward from Pass 2; still not shipped; severity confirmed unchanged by engineering-auditor Pass 3 (raw 500s with stack traces; P2002/P2025/P2003 unhandled).
  - **Added P1 (product — Next section):** sprint burndown + velocity reports (biggest remaining product gap; data now in DB); board sprint indicator + filter toggle (S, quick win); sprint date display (S, quick win; dates collected but never rendered); cross-project global search (M; single-project only); "My Work" personal dashboard (M; highest-leverage daily-use feature).
  - **Added P2 (engineering):** GET /users/:id co-member guard (S; Low severity, consistent with isolation model); assertNoParentCycle CTE refactor (M; N+1 + outside-transaction TOCTOU); Dockerfile --frozen-lockfile fix (S).
  - **Added P2 (product):** command palette Cmd-K (M; only keyboard shortcut is Cmd+Enter in comments); inline backlog issue creation (S; sprint planning friction); roadmap/timeline Gantt view (L; stakeholder-facing, no schema changes).
  - **Added P3:** label rename/edit (S; obvious gap; was missing from board).
  - **Kept P2 (carry-forwards):** transactional move + rank rebalance, cursor pagination, stale socket token, JWT refresh, inline card status transition, plugin/webhook event system, full-text search + saved views, observability baseline, public share link, presence indicators, board-overview prefetch. All confirmed still unshipped by Pass 3.
  - **Tension noted and resolved:** Engineering auditor escalated webhooks and full-text search to P1 (largest new capability gaps); product auditor treats them as P2/P3 relative to reports and "My Work". Resolution: both remain P2 — neither blocks the daily-use loop, and the product gains more from observable reports + personal context in the next sprint. The engineering auditor's P1 escalation reflects integration value for self-hosted operators, which is real but not the immediate daily-driver gap.
  - **Deduped/merged:** full-text search (engineering P1 ideation) merged with existing P2 board-filter item into single "Full-text search + structured filters + saved views"; saved views from P3 folded in as the natural endpoint of that investment.
  - **No pruning:** P3 items remain valid; board size healthy at 10 P1 items (7 Ready + 3 large/complex in Next), 16 P2, 9 P3.
- 2026-06-26 (Pass 2 groom) — Ingested engineering-auditor Pass 2 + product-auditor Pass 2 findings.
  - **Ticked done [x]:** realtime gateway auth, tenant-FK ownership validation, role enforcement, JWT fail-fast + docker-compose + RealtimeModule bypass closure, CORS allowlist, Badge labels in drawer, drawer overlay, toast system, themed dialogs — all verified confirmed by both auditors against the live stack.
  - **Escalated to P0 (new items added to Ready):** `assigneeId` workspace-member validation (any user ID can be set cross-tenant — S-sized fix using existing assertWorkspaceMember); GET /users scoped to co-members (cross-tenant email PII leak — S-sized). Both surface from the engineering auditor's Pass 2 re-sweep of the auth/authz layer.
  - **Added P1 to Ready queue:** global exception filter / structured error envelope (Prisma P2002/P2025 → raw 500s with stack traces; engineering auditor Pass 2 Risk #5); comment edit/delete UI (backend PATCH/DELETE exist; product auditor Pass 2 Gap #4, downgraded comments to score 3); activity log ID → human name resolution (product auditor Pass 2 Gap #5, <10-line fix).
  - **Kept P1 (CI/tests) in Ready:** API unit tests + GitHub Actions CI — moved from Next into Ready because it is the structural gate that makes all isolation fixes self-maintaining (engineering auditor Pass 2 Risk #2).
  - **Added P1 (Next section):** VIEWER-aware UI (product auditor Pass 2 Gap #6; role enforced at API but all edit affordances still render for VIEWERs).
  - **Added P2:** stale socket token (engineering auditor Pass 2 Risk #8); "My Work" personal dashboard (product auditor Pass 2 Idea F); inline card status transition (product auditor Pass 2 Idea G); public read-only share link (product auditor Pass 2 Idea H); plugin/webhook event system (engineering auditor Pass 2 Idea #1); board-overview prefetch (engineering auditor Pass 2 Idea #2); live presence indicators (engineering auditor Pass 2 Idea #3).
  - **Reprioritized:** global exception filter P2 → P1 (engineering auditor Pass 2 raised severity to Med/High; both auditors agree structural error handling is a baseline requirement for a self-hosted product); VIEWER-aware UI P2 → P1 (product auditor confirmed that VIEWERs see all affordances and get confusing 403 responses, making the role enforcement invisible to the user).
  - **Deduped/merged:** webhook ideation from engineering-auditor Pass 1 "Observability baseline" is now split — exception filter is P1 (Ready), structured logs/metrics/OTel remains P2 under observability; webhooks separated as P2 plugin/webhook system.
  - **No pruning:** all P3 items remain valid; board size is stable.
- 2026-06-26 (Pass 1 groom) — Major groom from auditor Pass 1 (product + engineering) and UI review.
  - **Added & escalated to P0:** realtime gateway auth, tenant-FK-ownership validation, role enforcement, fail-fast JWT secret — surfaced by the engineering auditor; none were on the board. These now lead the Ready queue (security/correctness > net-new UI).
  - **Added P1:** CORS allowlist, authz unit tests + CI, notifications/@mentions, tenant-isolation test harness, story-points/epics in drawer.
  - **Reprioritized:** roles enforcement P2→P0 (both auditors + escalation path); toast system folded with remote-change highlight; backlog+sprints and labels kept high-value P1 but placed behind the security floor.
  - **Added P2:** full-text search, command palette, reports hub, cursor pagination, transactional move, observability, bulk ops + optimistic concurrency.
  - **Added P3:** automation rules, saved views/query DSL, onboarding + sample project.
  - **Kept:** all four UI-review top items in Ready; remaining UI nits batched into P2.
- (initial) Seeded from UI review + roadmap.
