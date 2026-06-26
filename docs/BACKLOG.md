# Next Lane — Dev Board (Backlog)

Single prioritized board maintained by the **backlog-groomer**, fed by the two independent auditors (`docs/AUDIT-PRODUCT.md`, `docs/AUDIT-ENGINEERING.md`), the front-end QA review (`docs/UI-REVIEW.md`), and the roadmap (`docs/ROADMAP.md`). The autonomous build loop pulls from **Ready (top of queue)**.

Format: `- [ ] (P1, M) title — description [src]` · P0 critical / P1 now / P2 next / P3 later · size S/M/L.

> Grooming note (2026-06-26): The engineering auditor surfaced **multi-tenant
> isolation & authz holes** the product audit and prior board missed
> (unauthenticated realtime room join, cross-project FK injection, role
> escalation, default JWT secret, no CI). Per the "balance the two auditors"
> mandate, correctness/security risk wins the top of the queue over net-new agile
> UI: a self-hosted multi-workspace tracker that leaks across tenants is the
> defining risk. Quick UI wins and high-value agile features follow immediately
> behind so the queue never runs dry.

## Ready (top of queue)

- [x] (P0, M) Authenticate realtime gateway + membership-check `subscribe` — any client can `join` any projectId room and receive all issue/comment events; cross-tenant leak. Auth the handshake (JWT) and `assertProjectMember` before join [engineering-auditor]
- [x] (P0, M) Validate tenant ownership of statusId/sprintId/parentId/beforeId/afterId on issue update & move — members can attach issues to another project's status/sprint/parent and corrupt foreign boards; verify every referenced id resolves to the issue's own projectId [engineering-auditor]
- [ ] (P0, M) Enforce roles (VIEWER read-only; ADMIN-only member mgmt & deletes) — Role enum is stored but never checked; any member can self-upsert ADMIN via addMember. Add `assertWorkspaceRole(min)` + guard mutating endpoints [engineering-auditor, product-auditor]
- [ ] (P0, S) Fail fast on missing `JWT_SECRET`; remove hardcoded `change-me` default — app boots with a globally-known signing key (trivial token forgery) if env unset [engineering-auditor]
- [ ] (P1, S) CORS origin allowlist from env — drop `origin:true` + `credentials:true`; default to the web app URL [engineering-auditor]
- [ ] (P1, M) API unit tests for authz/isolation paths + CI pipeline (lint, build, test) — zero unit tests today, stubbed test script, no `.github/` gate; lock the isolation fixes above with a regression net [engineering-auditor]
- [ ] (P1, S) Fix label-chip contrast in issue drawer — reuse `<Badge>` instead of inline raw-color chips so light labels stay legible [ui-review]
- [ ] (P1, S) Drawer as first-class overlay — add scroll-lock, focus trap + restore, align z-index with `Modal` via a shared hook [ui-review]
- [ ] (P1, M) Replace native `window.prompt`/`window.confirm` (new workspace, delete issue) with themed modals [ui-review]
- [ ] (P1, M) Add a lightweight toast system; surface drawer-patch + mutation errors consistently (also highlight remote realtime changes) [ui-review, product-auditor]

## Next (P1 — high value, queue these as Ready empties)

- [ ] (P1, L) Backlog + sprint planning view — per-project backlog list with ranking, assign-to-sprint, start/complete, and a scrum board filtered to the active sprint. Backend sprint CRUD already exists; biggest "agile but can't do agile" gap; unblocks reports [product-auditor, roadmap]
- [ ] (P1, M) Labels management & filtering UI — create/edit labels, assign on card + drawer, filter board by label (backend assign/unassign exists; today read-only) [product-auditor, roadmap]
- [ ] (P1, M) Story points + epics/subtasks in the issue drawer — expose `storyPoints` and parent/child hierarchy; prerequisite for velocity/burndown [product-auditor, roadmap]
- [ ] (P1, L) Notifications: @mentions, auto-watch on assign/comment, in-app inbox (+ optional SMTP) — leverages existing `ActivityLog`/`Watcher` models; high user value, exercises realtime properly [engineering-auditor, product-auditor]
- [ ] (P1, L) Tenant-isolation test harness + declarative authz layer — reusable two-workspace matrix asserting every mutating endpoint + socket room rejects cross-tenant; `@RequireRole`/`@ResourceScope` decorator to make isolation structural, not hand-rolled [engineering-auditor]

## Next (P2)

- [ ] (P2, M) Full-text search (title+desc+comments) + richer board filters (type/priority/label/sprint) — current search is title-only, single-board [product-auditor, engineering-auditor]
- [ ] (P2, M) Command palette (Cmd-K) navigation & actions — jump to issue/project, create, change status, assign; key power-user differentiator [product-auditor]
- [ ] (P2, L) Reports hub: active-sprint burndown, velocity trend, status distribution, stuck-issue + per-assignee load widgets [product-auditor, roadmap]
- [ ] (P2, M) Cursor pagination for issue list — `findAll` returns every issue with full includes, unbounded; degrades large boards [engineering-auditor]
- [ ] (P2, M) Transactional move + rank-collision rebalance — neighbor read/update outside a tx can collide under concurrency; wrap in `$transaction` + rebalance fallback [engineering-auditor]
- [ ] (P2, M) Observability baseline — pino structured logs, request IDs, global exception filter + consistent error envelope, `/metrics`, OTel around Prisma/socket [engineering-auditor]
- [ ] (P2, M) Bulk operations + optimistic concurrency — batch move/assign/label/transition in one tx + `updatedAt` lost-update protection for multi-user realtime [engineering-auditor]
- [ ] (P2, S) JWT refresh tokens + logout/password reset — single 7d access token today; auth hardening [product-auditor, roadmap]
- [ ] (P2, S) Theme tokens for issueMeta hardcoded hex; create-issue modal single-column on mobile (`grid-cols-1 sm:grid-cols-2`) [ui-review]
- [ ] (P2, S) Extract shared `<InlineError>`/`<FormError>` (4 duplicated banners) + drawer title `aria-label` + ≥40px touch tap targets [ui-review]

## Later (P3)

- [ ] (P3, L) Automation rules engine (trigger → action: status/assignment/label) — flagship differentiator for self-hosted [product-auditor, roadmap]
- [ ] (P3, L) Saved/shareable views + query DSL (JQL-like filter grammar) — the saved-filter pattern teams live in [product-auditor, engineering-auditor, roadmap]
- [ ] (P3, S) First-run onboarding + optional sample project + 4-step tour — empty board is a weak first impression [product-auditor]
- [ ] (P3, M) Custom fields (typed, JSONB-backed) [roadmap]
- [ ] (P3, M) Attachments (uploads volume) [roadmap]
- [ ] (P3, M) Webhooks + REST API tokens + audit log [roadmap]
- [ ] (P3, L) Time tracking / worklogs; CSV import + tracker importers; SSO/OIDC [roadmap]
- [ ] (P3, S) Scrub trademarked "Jira alternative" string from seed data [ui-review]

## Changelog

- 2026-06-26 — Major groom from auditor Pass 1 (product + engineering) and UI review.
  - **Added & escalated to P0:** realtime gateway auth, tenant-FK-ownership validation, role enforcement, fail-fast JWT secret — surfaced by the engineering auditor; none were on the board. These now lead the Ready queue (security/correctness > net-new UI).
  - **Added P1:** CORS allowlist, authz unit tests + CI, notifications/@mentions, tenant-isolation test harness, story-points/epics in drawer.
  - **Reprioritized:** roles enforcement P2→P0 (both auditors + escalation path); toast system folded with remote-change highlight; backlog+sprints and labels kept high-value P1 but placed behind the security floor (auditor-balance note above).
  - **Added P2:** full-text search, command palette, reports hub, cursor pagination, transactional move, observability, bulk ops + optimistic concurrency.
  - **Added P3:** automation rules, saved views/query DSL, onboarding+sample project.
  - **Kept:** all four UI-review top items in Ready; remaining UI nits batched into P2.
- (initial) Seeded from UI review + roadmap.
