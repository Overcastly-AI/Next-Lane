# Next Lane — Dev Board (Backlog)

Single prioritized board maintained by the **backlog-groomer**, fed by the two independent auditors (`docs/AUDIT-PRODUCT.md`, `docs/AUDIT-ENGINEERING.md`), the front-end QA review (`docs/UI-REVIEW.md`), and the roadmap (`docs/ROADMAP.md`). The autonomous build loop pulls from **Ready (top of queue)**.

Format: `- [ ] (P1, M) title — description [src]` · P0 critical / P1 now / P2 next / P3 later · size S/M/L. Checked `[x]` = done.

> Grooming note (2026-06-26, Pass 2): The engineering auditor's Pass 2 found two
> residual cross-tenant isolation holes (assigneeId not validated as a workspace
> member; GET /users leaks all platform emails). Both are S-sized and land at P0
> — the isolation floor is not fully closed without them. The engineering auditor
> also flagged that the JWT bypass fix shipped clean (docker-compose + realtime
> module both corrected), so that P0 is genuinely done. The product auditor
> confirmed the agile-surface gap is now the dominant product risk: backlog, labels,
> story points, and epics are schema-complete but invisible in the UI. Both auditors
> agree: close the two remaining isolation holes first (S, fast), then queue the
> test harness + CI (makes the security model self-maintaining), then drive the
> agile UI gap. Tension noted: product auditor wants comment edit/delete and
> activity-log legibility queued at P1 (visible trust-reducers); engineering auditor
> flags the global exception filter as equally urgent (unhandled Prisma 500s with
> stack traces in responses). Both land at P1 — they are independent and
> parallelizable.

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
- [ ] (P0, S) Validate assigneeId is a workspace member on issue create/update — any authenticated user ID can be set as assignee cross-tenant; assertWorkspaceMember utility already exists, just needs to be applied in IssuesService.create/update [engineering-auditor]
- [ ] (P0, S) Scope GET /users to the caller's co-members — current endpoint returns all users' names + emails to any authenticated user across all tenants; add workspaceId filter to UsersService.findAll [engineering-auditor]
- [ ] (P1, M) API unit tests for membership.util + assertSameProject + GitHub Actions CI — zero unit tests; test script is still a stub; isolation fixes are Playwright-only (slow, DB-dependent); a Jest suite + Actions workflow makes the security model self-maintaining [engineering-auditor]
- [ ] (P1, M) Global exception filter: map Prisma errors to structured HTTP responses — unhandled P2002/P2025 + rankBetween edge cases surface as raw NestJS 500s with stack traces in responses; add @Catch() filter with consistent { statusCode, message, error } envelope [engineering-auditor]
- [ ] (P1, S) Comment edit-in-place + delete in CommentsPanel — backend PATCH/DELETE /comments/:id exist; UI has no edit or delete affordance; visible gap that reduces user trust [product-auditor]
- [ ] (P1, S) Activity log: resolve status/user IDs to human names — log currently shows raw DB IDs in from/to fields (e.g. "cmq…abc → cmq…xyz"); drawer already has statuses and users in scope; <10-line fix [product-auditor]

---

## Next (P1 — high value, queue as Ready empties)

- [ ] (P1, S) VIEWER-aware UI: hide/disable edit affordances based on role — role enforced at API layer; UI still renders Delete button and all field-edit controls for VIEWERs who then get a silent or confusing 403 on click [product-auditor, engineering-auditor]
- [ ] (P1, L) Backlog + sprint planning view — per-project backlog list with drag-rank, assign-to-sprint, start/complete sprint controls, and a scrum board variant filtered to the active sprint; backend sprint CRUD is fully live and confirmed; biggest "agile but can't do agile" gap; blocks velocity/burndown reports [product-auditor, roadmap]
- [ ] (P1, M) Labels assign/unassign + filter UI — create/edit/delete labels, assign on card and in drawer, filter board by label(s); useLabels hook is written and backend CRUD + assign/unassign endpoints are live; labels are currently read-only decoration only placed by seed data [product-auditor, roadmap]
- [ ] (P1, M) Story points field + parent/child picker in issue drawer — expose storyPoints number field and a parentId picker for epic/story/subtask hierarchy; schema and API fully support it; storyPoints confirmed in DB; prerequisite for meaningful velocity/burndown [product-auditor, roadmap]
- [ ] (P1, L) Notifications: @mentions, auto-watch on assign/comment, in-app inbox (+ optional SMTP) — ActivityLog and Watcher models exist and are unused; high user value; exercises realtime properly [engineering-auditor, product-auditor]
- [ ] (P1, L) Tenant-isolation test harness + declarative authz layer — reusable two-workspace matrix asserting every mutating endpoint + socket room rejects cross-tenant access; @RequireRole/@ResourceScope decorator so isolation is structural, not hand-rolled per service [engineering-auditor]

---

## Next (P2)

- [ ] (P2, S) Fix stale socket token after re-auth — getSocket() captures the token once at init; when refresh tokens land, the socket will carry a stale credential until page reload; pass the current token as a parameter or reconnect on auth state change [engineering-auditor]
- [ ] (P2, M) "My Work" personal dashboard — dedicated page showing: issues assigned to me, issues I'm watching (Watcher model exists, unused), recent activity across all projects, upcoming sprint deadlines; data model supports this entirely today [product-auditor]
- [ ] (P2, S) Inline card status transition (right-click / keyboard shortcut) — tiny context menu on the card showing the 2–4 statuses; eliminates drawer round-trip for status changes; power-user flow [product-auditor]
- [ ] (P2, M) Public read-only project share link — token-authenticated read-only URL shareable with stakeholders who don't need an account; ShareToken model + unauthenticated board endpoint + readonly board view (no DnD, no create); top self-hosted adoption lever [product-auditor]
- [ ] (P2, M) Full-text search (title+desc+comments) + richer board filters (type/priority/label/sprint) — current search is title-only, single-board; useLabels/useSprints hooks exist but are never consumed by any page [product-auditor, engineering-auditor]
- [ ] (P2, M) Command palette (Cmd-K) navigation & actions — global fuzzy jump to issue/project, create issue, change status, assign; key power-user differentiator [product-auditor]
- [ ] (P2, L) Reports hub: active-sprint burndown, velocity trend, status distribution, stuck-issue + per-assignee load — blocked on backlog+sprint UI and story points landing first [product-auditor, roadmap]
- [ ] (P2, M) Cursor pagination for issue list and board — findAll/getBoard return all issues with full includes unbounded; degrades large projects [engineering-auditor]
- [ ] (P2, M) Transactional move + rank-collision rebalance — neighbor read/update outside a transaction can collide under concurrent moves; wrap in $transaction + add rebalance fallback [engineering-auditor]
- [ ] (P2, M) Plugin/webhook event system (HMAC-signed outbound POST on issue.* events) — automation and CI/CD integration prerequisite; RealtimeService.emitToProject infrastructure already in place; one new module [engineering-auditor]
- [ ] (P2, S) Board-overview prefetch endpoint + stale-while-revalidate caching — collapses 4 sequential requests (auth → workspaces → projects → board) into 1 on first load; immediate perceived performance improvement [engineering-auditor]
- [ ] (P2, M) Live board presence indicators (per-project viewer avatars via WebSocket) — gateway already tracks connections; augment handleSubscribe to maintain a per-project presence map and emit presence.update; zero new API routes [engineering-auditor]
- [ ] (P2, S) JWT refresh tokens + logout/password reset — single 7-day non-revocable access token today; auth hardening [product-auditor, roadmap]
- [ ] (P2, S) Theme tokens for issueMeta hardcoded hex; create-issue modal single-column on mobile (grid-cols-1 sm:grid-cols-2) [ui-review]
- [ ] (P2, S) Extract shared InlineError/FormError (4 duplicated banners) + drawer title aria-label + min 40px touch tap targets [ui-review]

---

## Later (P3)

- [ ] (P3, L) Automation rules engine (trigger → action: status/assignment/label) — flagship differentiator for self-hosted; depends on webhook system [product-auditor, roadmap]
- [ ] (P3, L) Saved/shareable views + query DSL (JQL-like filter grammar) — the saved-filter pattern teams live in [product-auditor, engineering-auditor, roadmap]
- [ ] (P3, S) First-run onboarding + optional sample project + 4-step tour — empty board is a weak first impression [product-auditor]
- [ ] (P3, M) Custom fields (typed, JSONB-backed) [roadmap]
- [ ] (P3, M) Attachments (uploads volume) [roadmap]
- [ ] (P3, M) Webhooks + REST API tokens + audit log [roadmap]
- [ ] (P3, L) Time tracking / worklogs; CSV import + tracker importers; SSO/OIDC [roadmap]
- [ ] (P3, S) Scrub trademarked "Jira alternative" string from seed data [ui-review]

---

## Changelog

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
