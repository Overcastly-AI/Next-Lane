# Engineering Audit — Next Lane

Independent engineering-health audits. Each pass is dated and appended; newest on
top. Read-only review by the `engineering-auditor` role. Findings feed the backlog
groomer alongside the product audit and QA reviews.

---

## 2026-06-26 — Pass 1 (initial deep audit)

Scope: full API (`apps/api`), shared package (`packages/shared`), data model
(`prisma/schema.prisma`), web data layer, Docker/config. Typecheck of the API
passes clean (`tsc --noEmit` → exit 0). The codebase is small, well-organized,
and consistent — the per-domain NestJS module pattern is followed everywhere and
fractional-index ranking is correctly factored into `packages/shared`. The risks
below are about **runtime authorization correctness, multi-tenant isolation, and
test/CI absence**, not structure.

### Ratings

| Area | Score | Note |
|------|:----:|------|
| Architecture & module boundaries | 4 | Clean per-domain modules; shared types in one package; no leaks. Realtime gateway is the one weak seam. |
| Data model & migrations | 4 | Sensible schema, good indexes (`[statusId, rank]`, `[projectId, number]`), proper cascades. Single init migration; `rank` not unique-scoped (acceptable for fractional indexing). |
| AuthN | 4 | argon2 hashing, global JWT guard via `APP_GUARD`, `@Public()` opt-out. Solid. Token TTL 7d with no refresh/revocation. |
| AuthZ & multi-tenant isolation | **2** | Membership checks exist on REST, but **no role enforcement** (VIEWER can mutate), **cross-project reference injection** in issue update/move, and **the WebSocket gateway is unauthenticated**. |
| Input validation | 3 | `class-validator` DTOs with `whitelist`+`forbidNonWhitelisted` globally. Gaps: foreign-key IDs not checked for tenant ownership; no bounds on description/comment length; `storyPoints` unbounded. |
| Error handling | 4 | Consistent Nest exceptions; correct 403/404/409 usage. No global exception filter / structured error shape. |
| N+1 / query efficiency | 3 | Good use of `include`/`_count`. But issue list is **unbounded (no pagination)**; per-request membership lookups are uncached. |
| Realtime correctness | 2 | Events emit to project rooms, but anyone can `join` any room (no auth, no membership check) — an isolation hole, not just a quality one. |
| Rank / ordering integrity | 3 | `fractional-indexing` used correctly. But `move` is **not transactional** and reads neighbor ranks outside a tx → concurrent moves can collide; no rank-rebalance fallback. |
| Test coverage (unit + e2e) | **1** | **Zero unit tests.** API `test` script is `echo "no tests yet"`. Only 3 Playwright e2e specs. No isolation/authz tests at all. |
| Type safety | 5 | Strict TS, no stray `any`, typecheck clean, DTOs typed against `@next-lane/shared`. |
| Build / CI / Docker | 2 | Dockerfiles + compose present and reasonable. **No CI pipeline** (`.github/` absent) — nothing runs lint/typecheck/tests on change. |
| Secrets / config hygiene | 3 | `.env` is gitignored and only holds placeholders (not leaked). But a **known default JWT secret** is hardcoded as a fallback in two files; app boots silently insecure if env is unset. |
| Dependency risk | 4 | Mainstream, current stack (NestJS, Prisma, argon2, socket.io). No obvious abandoned deps. No automated audit/Dependabot. |

### Top risks & debt (prioritized)

1. **Unauthenticated realtime gateway — cross-tenant data leak** *(High impact / High likelihood)*
   `apps/api/src/realtime/realtime.gateway.ts:15-22` — `handleSubscribe` does
   `client.join(projectId)` for **any** `projectId` with no JWT and no membership
   check. Any client can join another workspace's project room and receive every
   `issue.*` / `comment.*` event, including titles, descriptions, and comment
   bodies. Connections themselves are unauthenticated.
   *Fix:* authenticate the socket handshake (JWT in `auth`/query), and on
   `subscribe` call `assertProjectMember` before `join`. *Size: M.*

2. **Cross-project reference injection in issue update/move** *(High / Med)*
   `apps/api/src/issues/issues.service.ts:237-251` (`update`) and `:266-296`
   (`move`). After the membership check on the issue's *own* project, the service
   writes `statusId`, `sprintId`, `parentId` (update) and `statusId` +
   neighbor-derived `rank` (move) **without verifying those IDs belong to the same
   project**. A member of project A can attach their issue to project B's status or
   sprint, or set `parentId` to a foreign issue — corrupting B's board and leaking
   B's rank-space ordering. `move` also reads `beforeId`/`afterId` from any issue
   globally (`:277-288`).
   *Fix:* validate every referenced `statusId`/`sprintId`/`parentId`/`beforeId`/
   `afterId` resolves to `existing.projectId`; reject otherwise. *Size: M.*

3. **No role enforcement — VIEWER can mutate, any member can escalate** *(High / Med)*
   The `Role` enum (ADMIN/MEMBER/VIEWER, `schema.prisma:41-45`) is stored but
   **never checked**. `assertProjectMember`/`assertWorkspaceMember`
   (`apps/api/src/common/membership.util.ts`) only assert *presence* of a
   membership. Consequences: a VIEWER can create/delete/move issues; and
   `WorkspacesService.addMember` (`apps/api/src/workspaces/workspaces.service.ts:73-101`)
   is gated by `assertWorkspaceMember`, not admin — so **any member can add users
   and upsert any role, including ADMIN, for themselves or others** (privilege
   escalation).
   *Fix:* add a role-aware guard/util (`assertWorkspaceRole(min)`), require ADMIN
   for member management and project/status/sprint deletion, and treat VIEWER as
   read-only. *Size: M.*

4. **Hardcoded default JWT secret fallback** *(High if triggered / Low likelihood)*
   `apps/api/src/auth/jwt.strategy.ts:18` and `apps/api/src/auth/auth.module.ts`
   both fall back to `'change-me-in-production-please'` when `JWT_SECRET` is unset.
   A self-hoster who skips env setup boots with a globally-known signing key →
   trivial token forgery.
   *Fix:* fail fast on missing `JWT_SECRET` at startup (throw in bootstrap); never
   ship a usable default. *Size: S.*

5. **Permissive CORS with credentials** *(Med / Med)*
   `apps/api/src/main.ts:11` — `enableCors({ origin: true, credentials: true })`
   reflects any origin. Combine with credentials and it weakens browser-side
   origin protection.
   *Fix:* drive allowed origins from an env allowlist; default to the web app URL.
   *Size: S.*

6. **Zero unit tests + no CI** *(High / High — compounding)*
   API `test` is a stub (`apps/api/package.json`); no `*.spec.ts` under `src`; no
   `.github/` workflows. None of the isolation logic above has a regression net,
   and nothing enforces lint/typecheck/test on change.
   *Fix:* add Jest unit tests for the membership/authz utils and issue service
   isolation paths first; add a CI workflow running `pnpm lint && pnpm -r build &&
   pnpm test`. *Size: M (tests) + S (CI).*

7. **Unbounded issue list query** *(Med / Med)*
   `IssuesService.findAll` (`issues.service.ts:114-138`) returns every matching
   issue with full includes, no `take`/`skip`/cursor. A large project degrades the
   board and the payload.
   *Fix:* add cursor pagination (rank-based) and a sane default page size. *Size: M.*

8. **Non-transactional move / rank race** *(Med / Low)*
   `move` (`issues.service.ts:266-316`) reads neighbor ranks then updates outside a
   transaction. Two simultaneous moves into the same gap can produce equal/adjacent
   ranks with no rebalance path.
   *Fix:* wrap neighbor-read + update in `$transaction` with appropriate isolation;
   add a rank-collision rebalance fallback. *Size: M.*

### New capabilities & technical investments (ideation mandate)

Beyond fixing the above, three+ ambitious investments to keep the platform
evolving — chosen for leverage, not just hardening:

1. **Tenant-isolation test harness + a policy layer.** Build a reusable e2e/unit
   fixture that provisions two isolated workspaces with separate users, then runs a
   matrix asserting *every* mutating endpoint and the socket room reject
   cross-tenant access. Pair it with a small central authorization layer (a
   `@RequireRole`/`@ResourceScope` decorator + interceptor) so isolation is
   declarative per route instead of hand-rolled in each service. This turns
   isolation from "audited" into "structurally guaranteed and continuously tested."
   *Priority: High. Size: L.*

2. **Activity feed → real notifications & @mentions.** The `ActivityLog` and
   `Watcher` models already exist but are under-used. Build a notification service:
   parse `@mention`s in comments, auto-watch on assignment/comment, fan out
   in-app + email (self-host SMTP) notifications, and an unread inbox. High user
   value, leverages existing schema, and exercises the realtime layer properly.
   *Priority: High. Size: L.*

3. **Saved views, full-text search & JQL-style filtering.** Move beyond the single
   `title contains` filter: add Postgres full-text search across title +
   description + comments, a structured filter grammar (status/assignee/label/
   sprint/type/priority), and persisted "saved views" per user/project. This is the
   feature that makes a tracker usable at scale.
   *Priority: High. Size: L.*

4. **Observability baseline.** Structured logging (pino), request IDs, a global
   exception filter with a consistent error envelope, `/metrics` (Prometheus), and
   OpenTelemetry traces around Prisma + socket emits. Cheap to add now, invaluable
   for a self-hosted product where you can't SSH into the user's box.
   *Priority: Med. Size: M.*

5. **Bulk operations + optimistic concurrency.** Batch move/assign/label/transition
   (one transactional endpoint), plus `updatedAt`-based optimistic-lock checks on
   issue mutations to prevent lost updates in the multi-user realtime setting.
   *Priority: Med. Size: M.*

### Direction

The single most important investment is **closing the multi-tenant isolation gaps
and locking them with tests** — items 1, 2, 3, 6 and ideation #1. The product is
architecturally sound and type-clean, but its authorization is presence-based, not
permission-based, and the realtime layer is open; for a self-hosted multi-workspace
tracker that is the defining risk. Sequence: (a) fail-fast secret + CORS allowlist
(quick wins), (b) socket auth + membership-checked subscribe, (c) tenant-ownership
validation on all foreign-key writes, (d) role enforcement, (e) the isolation test
harness + CI to keep it that way. Once the floor is safe, the activity/notification
and search/saved-views investments are what move Next Lane from "MVP board" to a
tracker teams would actually adopt.

### Backlog-groomer feed (compact)

- **Authenticate realtime gateway + membership-check subscribe** · P0 · M · Unauth socket lets any client join any project room and receive all issue/comment events (cross-tenant leak).
- **Validate tenant ownership of statusId/sprintId/parentId/beforeId/afterId on issue update & move** · P0 · M · Members can attach issues to other projects' resources / corrupt foreign boards.
- **Enforce roles (VIEWER read-only; ADMIN-only member mgmt & deletes)** · P0 · M · Role enum unused; any member can escalate to ADMIN via addMember.
- **Fail fast on missing JWT_SECRET; remove hardcoded default** · P1 · S · App boots with globally-known signing key if env unset.
- **CORS origin allowlist from env (drop `origin:true` + credentials)** · P1 · S · Reflects any origin with credentials.
- **Add API unit tests (authz/isolation paths) + CI pipeline** · P0 · M · Zero unit tests; stubbed test script; no CI gate.
- **Cursor pagination for issue list** · P2 · M · `findAll` returns all issues with full includes, unbounded.
- **Transactional move + rank-collision rebalance** · P2 · M · Non-transactional neighbor read/update can produce colliding ranks under concurrency.
- **Tenant-isolation test harness + declarative authz layer** · P1 · L · Reusable two-tenant matrix + `@RequireRole`/scope interceptor to make isolation structural.
- **Notifications: @mentions, auto-watch, in-app + email inbox** · P1 · L · Leverages existing ActivityLog/Watcher; high user value.
- **Full-text search + structured filters + saved views** · P1 · L · Replaces single title-contains filter; needed for scale.
- **Observability baseline (pino, request IDs, global error filter, metrics, OTel)** · P2 · M · Critical for a self-hosted product you can't introspect remotely.
- **Bulk operations + optimistic concurrency on issue mutations** · P2 · M · Batch transitions + lost-update protection for multi-user realtime.
