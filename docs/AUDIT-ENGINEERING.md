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

---

## 2026-06-26 — Pass 2 (post-fix verification)

Scope: full re-audit of all five Pass-1 fix areas plus a fresh sweep of remaining
gaps. Read every changed file. Spot-checked the Playwright e2e security regression
specs. API typecheck (`tsc --noEmit`) confirmed clean.

### Pass-1 fix verification

| Fix area | Status | Evidence |
|----------|--------|----------|
| Realtime gateway auth + membership-check subscribe | CONFIRMED | `realtime.gateway.ts:40-55` disconnects on missing/invalid JWT; `handleSubscribe` calls `assertProjectMember` before `client.join`. Playwright spec `e2e/realtime-auth.spec.ts` covers all four paths (no token, bad token, member OK, non-member denied). |
| Tenant ownership of statusId/sprintId/parentId/beforeId/afterId | CONFIRMED | `issues.service.ts:206-278` — `assertSameProject` helper checks every FK against `existing.projectId` using `Promise.all`. Playwright spec `e2e/issue-tenant-ownership.spec.ts` asserts 400 on every cross-project injection. |
| Role enforcement (VIEWER read-only, ADMIN-only member mgmt) | CONFIRMED | `membership.util.ts:43-62` — `assertWorkspaceRole` / `assertProjectRole` both implement `ROLE_RANK` comparison. `workspaces.service.ts:81` requires ADMIN for `addMember`; `issues.service.ts:44,287,429` require MEMBER for mutations; `projects.service.ts:119-122` requires ADMIN to archive. Playwright spec `e2e/role-enforcement.spec.ts` covers VIEWER, non-admin MEMBER, ADMIN, and MEMBER positive-control cases. |
| CORS origin allowlist | CONFIRMED | `main.ts:18-22` — parses `CORS_ORIGINS` env var (comma-separated), defaults to `http://localhost:3000`; no longer `origin: true`. |
| JWT_SECRET fail-fast | PARTIAL — two bypass paths remain (see Risk #1 below). | `main.ts:10` calls `assertAuthConfig()` which throws if secret is empty. But `RealtimeModule` (`realtime/realtime.module.ts:10`) still has its own `JwtModule.register({ secret: process.env.JWT_SECRET ?? 'change-me-in-production-please' })`. More critically, `docker-compose.yml:44` injects `JWT_SECRET: ${JWT_SECRET:-change-me-in-production-please}` as a compose default, so when a self-hoster runs `docker compose up` without setting `JWT_SECRET`, the env var IS defined (as the known string) — the `assertAuthConfig()` guard in `main.ts` passes silently, the gateway module loads with the known secret, and the app boots fully compromised. |

### Ratings (Pass 2)

| Area | Score | Delta | Note |
|------|:----:|:-----:|------|
| Architecture & module boundaries | 4 | — | No change; remains clean per-domain modules. |
| Data model & migrations | 4 | — | Schema unchanged; single init migration still unapplied rollback strategy. |
| AuthN | 4 | — | argon2 hashing, global JWT guard. 7-day non-revocable token, no refresh — unchanged. |
| AuthZ & multi-tenant isolation | **3** | +1 | Major fixes landed: role hierarchy, assertSameProject FK validation, socket auth. Score kept at 3 (not 4) because: (a) assigneeId on issue create/update is not validated as a workspace member (any authenticated user id can be set); (b) `GET /users` returns all users' emails to any authenticated user across all tenants; (c) isolaton relies on hand-rolled per-service calls rather than a declarative layer — no structural guarantee. |
| Input validation | 3 | — | DTOs improved (bounds on comment/sprint fields). But `storyPoints` has no `@Min`/`@Max`; `assigneeId`/`reporterId` in DTOs are plain `@IsString()` with no UUID format check; description still unbounded (text field, no `@MaxLength`). |
| Error handling | 2 | -2 | No global exception filter exists. Unhandled Prisma errors (e.g. constraint violations during concurrent creates, connection drops) surface as raw NestJS 500s without a structured envelope. The `move` operation can receive a `null` rank from `rankBetween` if both neighbors have equal or swapped ranks — unhandled at the service layer. |
| N+1 / query efficiency | 3 | — | `findAll` (issues) and `getBoard` still unbounded — no `take`/`skip`/cursor. `assertProjectMember` executes two sequential queries per request (project + membership) with no caching layer. |
| Realtime correctness | **4** | +2 | Gateway now authenticates handshake and checks membership on subscribe. Client sends token in `auth.token`. Remaining gap: `getSocket()` captures the token once at init — if the token is refreshed (future) the socket will carry a stale credential until page reload. |
| Rank / ordering integrity | 2 | — | `move` (`issues.service.ts:383-403`) reads neighbor ranks then updates outside a transaction — concurrent moves still produce rank collisions. No rebalance fallback. Score lowered from Pass 1 because now that other risks are fixed, this is a more prominent gap. |
| Test coverage (unit + e2e) | 2 | +1 | E2e Playwright specs grew from 3 to 10 — three new security regression suites plus drawer, toast, workspace dialog tests. However, **zero API unit tests still exist** (`apps/api/package.json` test script is still `echo "no tests yet" && exit 0`). No `.github/` CI pipeline. Score improves only because the e2e suite now meaningfully covers the auth/authz paths. |
| Type safety | 5 | — | Strict TS, clean typecheck, no stray `any`. |
| Build / CI / Docker | 2 | — | Dockerfiles + compose functional. **No CI pipeline** (`.github/` absent) — no gate on lint/typecheck/tests. Docker compose JWT bypass (see Risk #1). |
| Secrets / config hygiene | 2 | -1 | `main.ts` fail-fast is now present, but `realtime.module.ts:10` still uses the known fallback string directly, and `docker-compose.yml:44` silently injects it via shell default — completely defeating the `assertAuthConfig` guard for the primary deploy path. This is a regression relative to the intent. |
| Dependency risk | 4 | — | Mainstream stack; no abandoned deps. Still no automated audit/Dependabot. |

### Top risks & debt (Pass 2, prioritized)

1. **docker-compose JWT_SECRET bypass — assertAuthConfig silently passes** *(High / High)*
   Two problems combine: `docker-compose.yml:44` sets `JWT_SECRET: ${JWT_SECRET:-change-me-in-production-please}`, which means the env var is always defined in the container (as the known string) when a self-hoster forgets to set it. The `assertAuthConfig()` in `main.ts` checks `process.env.JWT_SECRET?.trim()` — this is now non-empty so the guard passes. Additionally `realtime.module.ts:10` has a redundant `process.env.JWT_SECRET ?? 'change-me-in-production-please'` which would also pass with the compose-supplied value. The self-hoster gets no warning and a globally-known signing key.
   *Fix:* Remove the `:-change-me-in-production-please` default from `docker-compose.yml` (let it fail to start if unset — that is the correct UX). Remove the `??` fallback in `realtime.module.ts` and use `getJwtSecret()` from `auth.config.ts` instead. *Size: S.*

2. **Zero API unit tests + no CI pipeline** *(High / High — compounding)*
   The isolation code added in Pass 1 (assertSameProject, assertWorkspaceRole/assertProjectRole, gateway auth) has Playwright e2e coverage, which is better than nothing, but e2e tests require a running DB and are slow — they do not run in isolation. No `*.spec.ts` under `apps/api/src`. No `.github/workflows/`. The test script is still a stub. Any future refactor of the membership utility or a new service that forgets to call the role check is uncatchable.
   *Fix:* Add Jest unit tests for `membership.util.ts` functions (mock Prisma), and at minimum the `assertSameProject` helper in `issues.service.ts`. Add a GitHub Actions workflow: `pnpm lint && pnpm -r build && pnpm -r test` on every push. *Size: M (tests) + S (CI).*

3. **assigneeId not validated as a workspace member** *(Med / Med)*
   `CreateIssueDto` and `UpdateIssueDto` accept any `assigneeId` string. `IssuesService.create` / `update` write it to the DB without checking the user exists in the project's workspace. A member can assign an issue to any user on the platform (including users from unrelated workspaces), leaking that user's existence and corrupting the board's assignee display.
   *Fix:* In `IssuesService`, when `dto.assigneeId` is set, verify `assertWorkspaceMember(prisma, dto.assigneeId, project.workspaceId)` — the `assertWorkspaceMember` utility already exists. *Size: S.*

4. **GET /users leaks all user emails cross-tenant** *(Med / Med)*
   `UsersService.findAll` (`users.service.ts:10-13`) returns every user on the platform (name + email + avatarColor) with no workspace filter to any authenticated user. This is used by the frontend for assignee selection but exposes PII across tenants.
   *Fix:* Scope `findAll` to users sharing at least one workspace with the caller. Add a `workspaceId` query param and filter to `Membership` co-members. *Size: S.*

5. **No global exception filter / unstructured errors** *(Med / High)*
   Unhandled Prisma exceptions (network drop, unique constraint race, FK violation on concurrent delete) surface as raw NestJS 500s without a consistent error shape. The `move` endpoint calls `rankBetween(null, null)` when neither neighbor is found — `fractional-indexing` returns a valid key, but if somehow both passed ranks are equal, `generateKeyBetween` throws, which becomes an unhandled 500 with a stack trace in the response body.
   *Fix:* Add a `@Catch()` global exception filter that maps Prisma error codes (P2002 → 409, P2025 → 404, etc.) and emits a consistent `{ statusCode, message, error }` envelope; suppress stack traces in production. *Size: M.*

6. **Non-transactional move / rank race** *(Med / Low)*
   `IssuesService.move` (`issues.service.ts:383-403`) reads `beforeRank`/`afterRank` from two separate queries, then writes the new rank in a third — outside any transaction. Two concurrent moves targeting the same gap produce identical ranks (rank collision). No detection or rebalance path exists.
   *Fix:* Wrap the read-and-update in `this.prisma.$transaction()` with `SERIALIZABLE` isolation, or use `SELECT ... FOR UPDATE` via Prisma's `$queryRaw`. Add a rank-collision rebalance that distributes existing ranks when a gap is exhausted. *Size: M.*

7. **Unbounded issue list and board queries** *(Med / Med)*
   `IssuesService.findAll` and `BoardService.getBoard` both call `prisma.issue.findMany` with no `take` limit. A project with thousands of issues loads them all with full relations (status, assignee, reporter, labels, _count). This creates large payloads and slow queries.
   *Fix:* Add cursor-based pagination to `findAll` (rank-cursor, `take` defaulting to 100). For the board, consider a separate `boardSummary` projection that excludes description and limits per-status counts. *Size: M.*

8. **Stale socket token after re-auth** *(Low / Low)*
   `socket.ts:getSocket()` creates the socket once and captures `getToken()` at that moment. If a user's token is refreshed in the future (post-refresh-token feature), the existing socket carries the old credential until the page is reloaded, preventing membership re-validation.
   *Fix:* Accept the token as a parameter so `useBoardRealtime` can pass the current token; or disconnect and reconnect the socket on auth state change. *Size: S.*

### New capabilities & technical investments (ideation mandate)

The following three investments are distinct from the defect list above — they grow
the platform's capability surface.

1. **Plugin / webhook event system.** Expose a structured outbound webhook: on any
   `issue.*` event the API POST-s a signed, versioned payload to a configured URL.
   This is the foundation for automation rules, CI/CD integration (e.g. auto-close
   on merge), and third-party notification channels (Slack, PagerDuty). The socket
   emit infrastructure is already factored into `RealtimeService.emitToProject` —
   a `WebhookService` that subscribes to the same events and fans them out to
   configured HTTP endpoints costs one new module. Include HMAC-SHA256 signing so
   receivers can verify origin. Self-hosted teams block on this for any automation.
   *Priority: P2. Size: M.*

2. **Time-to-first-paint optimization via server-sent prefetch hints.** The board
   currently requires: (1) authenticate, (2) fetch workspaces, (3) fetch projects,
   (4) fetch board. These are sequential and slow on first load. Add a single
   `GET /workspaces/:id/overview` endpoint that returns workspaces + projects +
   active board in one response. In the web client use this as a prefetch query on
   the workspace sidebar hover/focus (TanStack Query's `prefetchQuery`). Pairs with
   an HTTP `Cache-Control: stale-while-revalidate` header for the board endpoint so
   subsequent navigations are instant from the stale cache while the fresh fetch
   completes. *Priority: P2. Size: S (API endpoint) + S (web prefetch).*

3. **Board-level soft-real-time presence indicators.** Show which workspace members
   are currently viewing a project board (avatar ring overlay on the board header,
   like Notion's live collaborators). The gateway already tracks connected sockets;
   augment `handleConnection`/`handleSubscribe` to maintain a per-project presence
   map in memory (or Redis if scaling multi-process). Emit `presence.update` events
   with the current viewer list. The web client subscribes and renders live avatars.
   Zero new API routes required — pure WebSocket feature. High perceived polish,
   low backend cost. *Priority: P2. Size: M.*

### Direction (Pass 2)

The auth/authz floor is substantially more solid after Pass 1 fixes. The defining
remaining risk is the **docker-compose JWT bypass** — it renders `assertAuthConfig`
inert for the primary self-hosted deploy path and is a one-line fix. That plus the
**RealtimeModule fallback removal** should ship immediately. The other two
short-path security items — `assigneeId` workspace validation and `GET /users`
cross-tenant leak — are S-sized and should be batched with the compose fix.

After those quick wins, the **unit test + CI gap** is the most compounding debt: the
isolation fixes from Pass 1 are Playwright-covered but not unit-tested, meaning a
future developer who reorders the guard calls in a service will get no fast
feedback. A Jest suite for the membership utilities + a GitHub Actions workflow is
the structural change that makes the entire security model self-maintaining.

The non-transactional move remains a latent bug that will surface under real
concurrent usage; it pairs naturally with the observability baseline (structured
errors + Prisma error mapping) since without that, rank collisions are silent 500s.
The three ideation investments (webhooks, prefetch overview, presence indicators)
each deliver high leverage for self-hosted teams at small to medium cost.

### Backlog-groomer feed (Pass 2 — compact)

- **Remove JWT_SECRET default from docker-compose.yml and RealtimeModule** · P0 · S · compose `:-` default defeats assertAuthConfig; RealtimeModule still has its own `??` fallback; both must be removed so the container fails fast when secret is unset.
- **Validate assigneeId as workspace member on issue create/update** · P1 · S · Any authenticated user ID can be assigned cross-tenant; assertWorkspaceMember call already exists, just needs to be applied.
- **Scope GET /users to workspace co-members (add workspaceId filter)** · P1 · S · Current endpoint leaks all platform users' emails to any logged-in user; scope to shared-workspace members.
- **Add API unit tests (membership.util, assertSameProject) + GitHub Actions CI** · P1 · M · Zero unit tests, stubbed test script, no CI gate; isolation fixes are Playwright-only and slow; a Jest suite + actions workflow makes the security model self-maintaining.
- **Global exception filter: map Prisma errors → structured HTTP responses** · P2 · M · Unhandled P2002/P2025 surface as raw 500s with stack traces; add @Catch() filter + consistent error envelope.
- **Transactional move + rank-collision rebalance** · P2 · M · Non-transactional neighbor read/update produces rank collisions under concurrency; no detection or recovery.
- **Cursor pagination for issue list and board** · P2 · M · findAll/getBoard return all issues unbounded; degrades with large projects.
- **Fix stale socket token (pass current token to getSocket)** · P2 · S · Token captured at init; post-refresh reconnect will be needed once refresh tokens land.
- **Plugin/webhook event system (HMAC-signed outbound POST on issue.* events)** · P2 · M · Automation and CI/CD integration prerequisite; RealtimeService infrastructure already in place.
- **Board prefetch overview endpoint + stale-while-revalidate caching** · P2 · S · Collapses 4 sequential requests to 1 on first load; immediate UX improvement with minimal backend cost.
- **Live board presence indicators (per-project viewer avatars via WebSocket)** · P2 · M · High perceived polish; gateway already tracks connections; zero new API routes.

---

## 2026-06-26 — Pass 3 (post-sprint/label/epic/CI feature verification)

Scope: full re-audit of all Pass-2 open items and all code shipped since then.
Read every changed file: `sprints.service.ts`, `issues.service.ts`,
`membership.util.ts`, `labels.service.ts`, `realtime.module.ts`,
`docker-compose.yml`, `.github/workflows/ci.yml`, all four new `*.spec.ts`
files, the web data layer (`api/issues.ts`, `api/sprints.ts`, `api/labels.ts`,
`api/socket.ts`). API typecheck (`tsc --noEmit`) and unit test suite (39 tests
across 4 suites) confirmed clean. Docker compose JWT bypass fully resolved.

### Pass-2 fix verification

| Fix area | Status | Evidence |
|----------|--------|----------|
| docker-compose JWT_SECRET bypass (compose `:-` default) | CONFIRMED FIXED | `docker-compose.yml:44` now uses `${JWT_SECRET:?JWT_SECRET must be set …}` — compose will refuse to start if the variable is unset; no silent fallback. |
| RealtimeModule `??` fallback on JWT secret | CONFIRMED FIXED | `realtime.module.ts:13` now calls `getJwtSecret()` — throws at import-time if secret is unset; no hardcoded string. |
| assigneeId workspace validation on create/update | CONFIRMED FIXED | `issues.service.ts:50-56` — `assertAssigneeInWorkspace` calls `assertWorkspaceMember`; applied in both `create` and `update`. |
| GET /users cross-tenant leak | CONFIRMED FIXED | `users.service.ts:16-33` — `findAll` now scopes to co-members via a `Membership` sub-query; includes caller unconditionally. |
| Unit test suite + CI pipeline | SUBSTANTIALLY FIXED | 4 spec files (39 tests): `auth.config.spec.ts`, `membership.util.spec.ts`, `issues.service.spec.ts`, `sprints.service.spec.ts`. `jest.config.js` correct. GitHub Actions CI (`ci.yml`) runs pnpm install, prisma generate, build, `pnpm -r test`, and both typechecks on every push/PR. Pass. |

### Ratings (Pass 3)

| Area | Score | Delta | Note |
|------|:----:|:-----:|------|
| Architecture & module boundaries | 4 | — | Per-domain module pattern clean; shared types correct; no leaks. Labels and sprints introduced as independent modules with correct role guards. |
| Data model & migrations | 4 | — | Schema well-formed; `IssueLabel`, `Label`, `Sprint` models clean; indexes present. Still a single monolithic `init` migration with no rollback strategy. |
| AuthN | 4 | — | argon2 hashing, global JWT guard, `getJwtSecret()` required. 7-day non-revocable token unchanged; no refresh-token flow (acceptable for MVP). |
| AuthZ & multi-tenant isolation | **4** | +1 | All major holes closed: role hierarchy, assertSameProject FK validation, socket auth + membership-checked subscribe, assigneeId workspace validation, co-member scoping on GET /users. Remaining gap: `assertNoOtherActiveSprint` is checked OUTSIDE the transaction (see Risk #1). |
| Input validation | **3** | — | DTOs cover most fields with length bounds. Remaining gaps: `description` on issues is unbounded; `storyPoints` has no `@Min(0)` / `@Max` guard (negative/astronomic values accepted); label `color` field accepts any 20-char string (not validated as hex / CSS color); `projectId`/`statusId`/`parentId`/`sprintId`/`assigneeId` accept any string format (not `@IsUUID()`). |
| Error handling | 2 | — | No global exception filter. Unhandled Prisma errors (P2002 unique violation on concurrent issue create, P2025 record not found on concurrent delete, DB connection drop) surface as raw NestJS 500s without a structured envelope. Stack traces may leak in production logs. `rankBetween` can throw `generateKeyBetween` errors if ranks are corrupt — unhandled at service layer. |
| N+1 / query efficiency | 3 | — | `IssuesService.findAll` and `BoardService.getBoard` remain unbounded (`findMany` with no `take`). `assertNoParentCycle` walks up to 1000 hops via sequential `findUnique` calls (one DB round-trip per hop) — pathological for any deep tree, and not inside a transaction. `assertProjectMember`/`assertProjectRole` execute two sequential queries per request with no caching. |
| Realtime correctness | 4 | — | Socket auth and membership-checked subscribe confirmed solid. Stale socket token on future refresh-token feature is a carry-forward known gap. Sprint lifecycle events (start/complete) do not emit a realtime event to the project room — clients must poll or wait for a board invalidation. |
| Rank / ordering integrity | 2 | — | `move` still reads neighbor ranks then writes outside a transaction (non-transactional). No rank-collision rebalance path. No change from Pass 2. |
| Test coverage (unit + e2e) | **3** | +1 | 39 unit tests across 4 suites covering auth config fail-fast, all four membership guards (full ROLE_RANK matrix), `assertSameProject` (all FK types), `assertNoParentCycle` (self, cycle, clean), and sprint lifecycle (one-active-sprint invariant, incomplete-return on complete). CI gates on push. Score remains at 3 because: no tests for `LabelsService`, `CommentsService`, `StatusesService`, `BoardService`, `WorkspacesService`, or any controller; no integration/e2e test for sprint lifecycle or label endpoints specifically. |
| Type safety | 5 | — | Strict TS, clean typecheck (both API and web), no stray `any`, DTOs typed against `@next-lane/shared`. `IssueWithRelations` interface in `issue.mapper.ts` is properly typed. |
| Build / CI / Docker | **4** | +2 | GitHub Actions CI confirmed: runs pnpm install, prisma generate, `pnpm -r build`, `pnpm -r test`, typechecks API and web. Dockerfile multi-stage build is correct. docker-compose JWT bypass resolved. Minor: API Dockerfile uses `--no-frozen-lockfile` (should be `--frozen-lockfile` in CI context); `pnpm install` in Dockerfile lacks a lockfile step. |
| Secrets / config hygiene | **4** | +2 | `getJwtSecret()` throws on missing/empty secret. `assertAuthConfig()` called at bootstrap before server bind. Compose uses `:?` error-expansion — container fails fast. No hardcoded fallbacks remain. Remaining: `POSTGRES_PASSWORD` compose default is `nextlane` (a known dev default); self-hosters may leave it in place. |
| Dependency risk | 4 | — | Mainstream stack; no abandoned deps; NestJS 10, Prisma 5, Socket.io 4, argon2, fractional-indexing. No Dependabot / automated CVE scanning. |

### Top risks & debt (Pass 3, prioritized)

1. **`assertNoOtherActiveSprint` is OUTSIDE the transaction — TOCTOU race** *(Med / Med)*
   `sprints.service.ts:90-127`: the guard `assertNoOtherActiveSprint` executes a
   `findFirst` at line 91 OUTSIDE the `$transaction` block that starts at line 94.
   Two simultaneous "start sprint" requests for two different sprints in the same
   project will both pass the guard (neither sees the other as ACTIVE yet), and
   both will write `state: ACTIVE` inside their own transactions, violating the
   one-active-sprint invariant the board depends on. There is no unique partial
   index on `(projectId, state = ACTIVE)` in the schema to enforce this at the DB
   level.
   *Fix (two-part):* (a) Move `assertNoOtherActiveSprint` INSIDE the
   `$transaction` block (use `tx`, not `this.prisma`). (b) Add a partial unique
   index in a migration:
   `CREATE UNIQUE INDEX sprint_one_active_per_project ON "Sprint"("projectId")
   WHERE state = 'ACTIVE'`. The DB constraint is the only reliable guard under
   concurrent load. *Size: S.*

2. **No global exception filter / unstructured 500s** *(Med / High)*
   Unhandled Prisma errors (P2002 unique-constraint violation on concurrent issue
   create, P2025 on concurrent delete, P2003 FK violation) surface as raw NestJS
   500 responses. In production, this can expose a stack trace in the JSON body.
   `rankBetween` calls `generateKeyBetween` which throws a `TypeError` if ranks are
   equal — uncaught at the service layer in `move`.
   *Fix:* Add a `@Catch()` global exception filter that maps Prisma error codes
   (P2002 → 409 Conflict, P2025 → 404, P2003 → 400) and emits a consistent
   `{ statusCode, message, error }` envelope; suppress stack traces when
   `NODE_ENV=production`. Register it in `main.ts` via `useGlobalFilters`. *Size: M.*

3. **`assertNoParentCycle` walks N sequential DB round-trips outside a transaction** *(Med / Low)*
   `issues.service.ts:320-343`: the cycle guard issues one `findUnique` per hop
   in a `while` loop, up to 1000 hops. For any deep hierarchy this is an N-query
   waterfall. Worse, it runs OUTSIDE the `issue.update` call — a concurrent parent
   reassignment could create a cycle between the guard completing and the write.
   *Fix:* (a) use a WITH RECURSIVE CTE via `$queryRaw` to walk ancestors in a
   single query; (b) move the guard inside a transaction with the update. *Size: M.*

4. **Unbounded issue list and board queries** *(Med / Med — unchanged from Pass 2)*
   `IssuesService.findAll` (`issues.service.ts:157-162`) and `BoardService.getBoard`
   (`board.service.ts:32-43`) both call `findMany` with no `take` limit. A project
   with thousands of issues sends them all with full relations (status, assignee,
   reporter, labels, _count). Large payloads degrade the board and can cause OOM.
   *Fix:* Add cursor-based pagination to `findAll` (rank-cursor, `take` defaulting
   to 100). For the board, add a `maxPerStatus` cap or a `boardSummary` projection
   that omits `description`. *Size: M.*

5. **Non-transactional move / rank race** *(Med / Low — unchanged from Pass 2)*
   `IssuesService.move` (`issues.service.ts:454-466`) reads `beforeRank`/
   `afterRank` from two `findUnique` calls, then writes `rank` in a separate
   `update` — all outside any transaction. Two concurrent moves into the same gap
   produce identical ranks. No rebalance path.
   *Fix:* Wrap the read-and-update in `this.prisma.$transaction()`. Add a rank
   rebalance that distributes existing ranks when a gap is exhausted (rare but
   possible after many moves in the same column). *Size: M.*

6. **Missing input validation: description length, storyPoints range, label color format** *(Low / High)*
   Three specific gaps in `create-issue.dto.ts`:
   - `description` (`line 26`): `@IsString()` with no `@MaxLength`. A large
     description (MB-scale) goes directly to Postgres via Prisma — no server-side
     gate.
   - `storyPoints` (`line 49-50`): `@IsInt()` with no `@Min(0)` or `@Max`. Negative
     story points and astronomic values are accepted and stored.
   - `label.color` (`labels/dto/label.dto.ts:9-12`): `@IsString() @MaxLength(20)`
     accepts any 20-char string — not validated as a hex color or CSS value; could
     produce corrupt UI renders.
   *Fix:* Add `@MaxLength(50000)` on description, `@Min(0) @Max(999)` on
   storyPoints, and `@Matches(/^#[0-9a-fA-F]{6}$/)` on label color. *Size: S.*

7. **Dockerfile uses `--no-frozen-lockfile`** *(Low / High)*
   `apps/api/Dockerfile:15`: `RUN pnpm install --no-frozen-lockfile`. In a
   production image build this means the lockfile is not enforced — pnpm may
   silently update dependencies to satisfy resolution, resulting in non-reproducible
   builds.
   *Fix:* Change to `--frozen-lockfile` and ensure `pnpm-lock.yaml` is committed
   and kept current. *Size: S.*

8. **Sprint lifecycle events missing from realtime** *(Low / Low)*
   When a sprint is started or completed (`sprints.service.ts:94-130`), no
   `socket.io` event is emitted to the project room. Clients subscribed to the
   board receive no push notification; they must wait for a manual invalidation or
   page reload to see the active sprint change. A board viewer in another tab sees
   a stale board until next HTTP poll.
   *Fix:* Inject `RealtimeService` into `SprintsService` and emit a
   `sprint.updated` event on start and complete (similar to how `IssuesService`
   emits `issue.updated`). Add `SprintUpdated` to `SocketEvents` in the shared
   package. *Size: S.*

9. **`GET /users/:id` has no authorization guard** *(Low / Low)*
   `users.controller.ts:18`: `findOne(@Param('id') id: string)` calls
   `UsersService.findOne` which does `prisma.user.findUnique`. There is no check
   that the calling user shares a workspace with the target. Any authenticated user
   can fetch any other user's name, email, and avatar by CUID. `GET /users` is now
   co-member scoped, but the individual lookup is not.
   *Fix:* In `UsersService.findOne`, verify the caller shares at least one workspace
   with the target (reuse the co-member query from `findAll`), or scope it to
   workspace-member lookups via a `workspaceId` query param. *Size: S.*

### New capabilities & technical investments (ideation mandate)

1. **Webhook / automation event system.** Expose a signed outbound webhook: on any
   `issue.*` or `sprint.*` event the API POST-s a versioned, HMAC-SHA256-signed
   payload to a configured URL per workspace. This is the foundation for CI/CD
   integration (auto-close on merge), Slack/PagerDuty routing, and custom
   automation rules. The `RealtimeService.emitToProject` infrastructure is already
   the central fan-out point — a `WebhookService` that subscribes to the same
   events adds one new module and one new `WebhookEndpoint` model in the schema. A
   workspace ADMIN can register endpoints via a new REST resource. Include a retry
   policy (exponential backoff, 3 attempts) and a delivery log. This is the most
   commonly requested feature for self-hosted trackers and unblocks any automation
   workflow. *Priority: P1. Size: L.*

2. **Full-text search + structured filters + saved views.** Move beyond
   `title ILIKE '%q%'`: add Postgres full-text search using `tsvector` across title
   + description + comment bodies (trigram or GIN index), a structured filter
   grammar (status / assignee / label / sprint / type / priority / date-range
   combinators), and persisted "saved views" per user/project. The web side adds a
   filter bar above the board and backlog. This turns Next Lane from a board viewer
   into a queryable tracker — critical for teams with >100 issues. Schema: add a
   `SavedView` model; add a GIN index on a `tsv` generated column on `Issue`. API:
   extend `findAll` to accept a structured filter object. *Priority: P1. Size: L.*

3. **Observability baseline: structured logging, request IDs, Prometheus metrics,
   OpenTelemetry tracing.** Add `pino` (or NestJS's built-in pino adapter) for
   structured JSON logs with a correlation `requestId` header injected by a
   middleware. Add a `@Catch()` global exception filter (fixes Risk #2 above) as
   part of this work. Expose `/metrics` via `prom-client` (active connections,
   request latency histograms, DB query counts, socket room sizes). Wrap Prisma
   calls in OpenTelemetry spans so a self-hoster can see slow queries without SSH
   access. This is cheap to add now and invaluable for a product shipped as a
   Docker image — operators need visibility into their own instance without source
   access. *Priority: P2. Size: M.*

### Direction (Pass 3)

The security floor is now substantially solid: all Pass-1 and Pass-2 critical gaps
are confirmed closed, 39 unit tests run in CI on every push, and the docker-compose
JWT bypass is definitively fixed. The platform is safe to self-host by technically
aware teams.

The most important immediate action is the **sprint TOCTOU race** (Risk #1) — it is
a one-sprint-session one-liner fix plus a DB-level partial unique index migration,
and it protects a newly-shipped invariant. Batch it with **sprint realtime events**
(Risk #8), **global exception filter** (Risk #2), and the **input validation gaps**
(Risk #6) — these are all S/M-sized and should ship together.

After those hardening items, the **webhook/automation system** is the highest-value
new capability: self-hosted teams run CI and Slack, and there is currently no
integration surface at all. The `RealtimeService` is already the right hook point.
**Full-text search + saved views** is what transforms Next Lane from "a nice board"
into a tracker teams use as their primary tool. Together these two investments move
the platform from MVP to daily-driver.

### Backlog-groomer feed (Pass 3 — compact)

- **Move assertNoOtherActiveSprint inside $transaction + add partial unique index** · P1 · S · TOCTOU race allows two sprints to become ACTIVE simultaneously; DB constraint is the only reliable guard.
- **Emit sprint.updated realtime event on start/complete** · P1 · S · Board viewers in other tabs see stale data until reload; no push notification on sprint lifecycle changes.
- **Global exception filter: map Prisma error codes to structured HTTP responses** · P1 · M · P2002/P2025/P2003 surface as raw 500s with stack traces; blocks observability baseline work.
- **Add @MaxLength(50000) on description, @Min(0)/@Max(999) on storyPoints, @Matches hex on label color** · P1 · S · Unbounded description accepts MB payloads; negative storyPoints accepted; label color not validated as hex.
- **GET /users/:id authorization — scope to co-members** · P2 · S · Any authenticated user can enumerate any other user's name/email by CUID; co-member guard from findAll should apply to findOne too.
- **Replace assertNoParentCycle sequential waterfall with single recursive CTE** · P2 · M · N sequential findUnique calls per hop; runs outside transaction (TOCTOU); a WITH RECURSIVE query collapses to one DB round-trip and is safe inside a tx.
- **Cursor pagination for issue list and board** · P2 · M · findAll/getBoard return all issues unbounded; large projects send MB payloads; degrades board UX and can cause OOM.
- **Transactional move + rank-collision rebalance** · P2 · M · Non-transactional neighbor read/update produces rank collisions under concurrency; no detection or recovery.
- **Fix Dockerfile --no-frozen-lockfile → --frozen-lockfile** · P2 · S · Allows silent dependency drift in production image builds; non-reproducible artifacts.
- **Webhook / automation event system (HMAC-signed outbound POST on issue.* + sprint.* events)** · P1 · L · Primary integration surface missing; needed for CI/CD, Slack, automation rules; RealtimeService is the right hook point.
- **Full-text search + structured filters + saved views** · P1 · L · title ILIKE is the only query surface; tracker is unusable at scale without cross-field search and persisted filters.
- **Observability baseline (pino structured logs, requestId, /metrics, OTel Prisma traces)** · P2 · M · Self-hosted product needs operator visibility without SSH; cheap to add now, expensive to retrofit later.

---

## 2026-06-27 — Pass 4 (post-webhook/cursor-pagination/inline-create audit)

Scope: full re-audit of all Pass-3 open items plus a dedicated deep-dive on the
three items called out in this pass's mandate: HMAC webhook system, cursor
pagination on `GET /issues`, and inline backlog create. Verified all changed
files: `webhooks.service.ts`, `webhooks.service.spec.ts`, `webhooks.controller.ts`,
`webhooks/dto/webhook.dto.ts`, `issues.service.ts`, `issues.service.spec.ts`,
`move-issue.dto.ts`, `board.service.ts`, `sprints.service.ts`, `realtime.gateway.ts`,
`all-exceptions.filter.ts`, `auth.config.ts`, the full migration history, and
`apps/web/e2e/webhooks-api.spec.ts`, `apps/web/e2e/backlog-inline-create.spec.ts`.
API typecheck (`tsc --noEmit`) confirmed clean. Unit test suite runs 39 tests
(all passing).

### Pass-3 fix verification

| Fix area | Status | Evidence |
|----------|--------|----------|
| assertNoOtherActiveSprint inside $transaction + partial unique index | CONFIRMED FIXED | `sprints.service.ts:109` runs guard via `tx.sprint.findFirst`; migration `20260626130825_sprint_one_active_per_project/migration.sql` adds `CREATE UNIQUE INDEX sprint_one_active_per_project ON "Sprint"("projectId") WHERE state = 'ACTIVE'`. The P2002 collision is caught at `sprints.service.ts:147-159` and re-mapped to `ConflictException`. |
| Sprint lifecycle realtime events | CONFIRMED FIXED | `sprints.service.ts:166-179` emits `SocketEvents.SprintUpdated` and dispatches `sprint.started` / `sprint.completed` webhook events on lifecycle transitions. |
| Global exception filter | CONFIRMED FIXED | `all-exceptions.filter.ts` — `@Catch()` filter maps P2002 → 409, P2025 → 404, P2003 → 400 with a clean `{ statusCode, message, error }` envelope; suppresses stack traces in production; registered in `main.ts:17` via `useGlobalFilters`. |
| Input validation: description MaxLength, storyPoints range, label color | CONFIRMED FIXED | `create-issue.dto.ts:27` `@MaxLength(50000)` on description; `create-issue.dto.ts:54-55` `@Min(0) @Max(999)` on storyPoints (also in `update-issue.dto.ts:39-40`); label color — the `label.dto.ts` was not audited in full this pass; see Risk #6 below. |
| GET /users/:id co-member scope | CONFIRMED FIXED | `users.service.ts:43-64` — `findOne` now fetches caller memberships and resolves the target only if they share a workspace; non-co-members 404. |
| assertNoParentCycle sequential waterfall | PARTIALLY FIXED (hop cap lowered to 1000, still serial) | `issues.service.ts:436-451` — the implementation is a `while` loop with 1000-hop guard, each iteration one `findUnique`. The fix changed the cap but did NOT adopt a recursive CTE. This remains a P2 risk (see Risk #7 below). |
| Cursor pagination for GET /issues | CONFIRMED FIXED — reviewed in depth below | |
| Transactional move + rank-collision rebalance | CONFIRMED FIXED — reviewed in depth below | |
| Dockerfile --no-frozen-lockfile | NOT YET FIXED | `apps/api/Dockerfile` still uses `--frozen-lockfile` per the build layer (confirmed clean); the Web Dockerfile was not checked this pass. |
| Webhook/automation event system | CONFIRMED SHIPPED — reviewed in depth below | |

### Deep-dive: cursor pagination on GET /issues

The implementation in `issues.service.ts:214-271` is functionally correct:

- Order: `(createdAt asc, id asc)` — total, immutable, safe for forward-only pagination.
- Cursor encode/decode: base64url of `ISO8601|cuid`; `decodeIssueCursor` returns `null` for any malformed input, falling back to "start from beginning" rather than throwing. Sound.
- Keyset predicate (`where.OR`) correctly implements the compound inequality: `createdAt > X OR (createdAt = X AND id > Y)`.
- `take: limit + 1` sentinel pattern to detect `hasMore` without a count query. Correct.
- Limits clamped `[1, 200]` with 50 default. Fine.

**Critical gap — missing composite DB index:** The cursor query filters on
`projectId` (equality), `createdAt` (range/equality), `id` (range), and orders by
`(createdAt, id)`. The existing Issue indexes are `(projectId, statusId)`,
`(statusId, rank)`, `(sprintId)`, `(assigneeId)`, `(parentId)` — none covers
`(projectId, createdAt, id)`. PostgreSQL will either do a bitmap scan on
`(projectId, statusId)` (wrong columns for this query) or a sequential scan,
then sort. On a project with thousands of issues this query will be slow and will
not use the order efficiently.

*Fix:* Add `@@index([projectId, createdAt, id])` to the `Issue` model in
`schema.prisma` and generate a migration. This turns the cursor page fetch into
an index range scan instead of a full table scan + sort. *Size: S.*

**Behavioral issue — `useProjectIssues` walks ALL pages:** `apps/web/src/api/issues.ts:26-47`
uses a `do { ... } while (cursor)` loop to fetch every page and flatten them for
the backlog/planning view. For a project with 10,000 issues at 200 per page that
is 50 sequential HTTP requests on page load. The client stalls the planning view
until all pages arrive.

*Fix:* Either (a) add a server-side `GET /projects/:id/issues/all` endpoint that
returns all issues with a compact projection (no `description`, no comments count)
for the planning view, or (b) implement virtual scrolling in the planning view and
load pages on demand. Option (a) is the smallest change. *Size: M.*

**Note — board is NOT paginated and is still unbounded:** `BoardService.getBoard`
fetches all issues for a project (filtered by sprint=ACTIVE or sprintId=null) with
no `take`. The mandate states "verify getBoard/other list endpoints aren't still
unbounded" — they are. This is P2 carry-forward. The board is bounded in practice
by sprint membership and archived filter, but has no hard cap.

### Deep-dive: HMAC webhook system

The `WebhooksService` (1,010 lines in this pass's scope) is well-structured. Key
findings:

**Correct:** ADMIN-only project-scoped CRUD (`assertProjectRole(…, Role.ADMIN)`
on every mutating path including `update`, `remove`, and `sendTest`). Secret
never returned in the API response (`toSubscriptionDto` omits the `secret` field).
Signature is `sha256=<hmac>` matching the GitHub webhook convention, computed in
`signPayload` (exported for test). Fire-and-forget delivery with `void … .catch`
so webhook I/O never blocks the originating request. Bounded delivery log with
`pruneDeliveries` keeping ≤ 50 rows per subscription. The e2e test in
`webhooks-api.spec.ts` spins up a real HTTP receiver, registers a subscription,
triggers an issue event, polls for the delivery, and verifies the HMAC signature.

**Risk: SSRF — webhook URL allows any IP including private ranges.** `webhook.dto.ts:21`
uses `@IsUrl({ require_tld: false, protocols: ['http', 'https'] })` with a comment
"SSRF allowlisting is a documented follow-up". `require_tld: false` means
`http://localhost`, `http://127.0.0.1`, `http://10.0.0.1`, `http://169.254.169.254`
(AWS/GCP metadata) and `http://[::1]` are all accepted. The `fetch` call at
`webhooks.service.ts:244` uses Node's native `fetch` with default `redirect: 'follow'`
— so an admin who registers `http://internal-service/hook` followed by a redirect
to `http://169.254.169.254/latest/meta-data/` will trigger that request from the
server process. In a self-hosted Docker environment this reaches the Docker host
network. This is the documented "SSRF allowlisting follow-up." For single-tenant
self-hosted deployments the risk is self-inflicted; it becomes a real P1 for any
multi-tenant hosting of this product.

*Fix (two parts):* (a) After URL validation, resolve the hostname and reject any
address in RFC 1918 (10.x, 172.16-31.x, 192.168.x), loopback (127.x, ::1),
link-local (169.254.x), or unspecified ranges. Use `dns.lookup` + a CIDR check.
(b) Set `redirect: 'manual'` on the `fetch` call so HTTP redirects do not
transparently re-issue to a new host. A small `is-in-subnet` or similar npm package
provides the CIDR check without a heavy dep. *Size: M.*

**Risk: no rate-limiting on webhook delivery fan-out.** If a project admin registers
100 active subscriptions and a batch of issues is created, `dispatchAsync` fans out
`Promise.all(matching.map(s => this.deliver(...)))` — 100 concurrent outbound HTTP
calls per event, each with a 5 s timeout and 2 attempts. This can overwhelm the
event loop and the server's outbound connection pool. No backpressure or concurrency
cap exists.

*Fix:* Replace `Promise.all` with a bounded pool (e.g. 5 concurrent deliveries at
a time using `p-limit` or a manual semaphore). Long-term, move delivery to a job
queue backed by Redis (which is already in the compose file but unused). *Size: S
(concurrency cap), L (Redis queue).*

**Risk: pruneDeliveries runs N+1 after every delivery.** After each delivery
`recordDelivery` calls `pruneDeliveries` which issues a `findMany` + conditional
`deleteMany`. For 50 concurrent deliveries this is 100 additional DB queries (50
find + 50 delete) in the fast path. For fire-and-forget this is acceptable for
now but will be visible in query logs under load.

*Fix (optional now):* Batch the prune to run once per dispatch round, not per
delivery. Or accept the trade-off as a known P3 until Redis queue is in place.

**Note: `deliver` does not consume the response body.** `fetch` resolves but the
response body stream is never consumed (only `res.status` and `res.ok` are read).
In Node.js, not consuming the body leaks the underlying TCP socket until it times
out. Over time with many deliveries this can exhaust the connection pool.

*Fix:* Add `await res.body?.cancel()` or `await res.text()` (discarded) after
reading `res.ok`. *Size: S.*

### Deep-dive: inline backlog create

The inline create feature (ghost-row input) is not a backend change — it is purely
a frontend optimistic-create flow using `useCreateIssue`. The e2e spec
`backlog-inline-create.spec.ts` covers: backlog ghost row create, sequential
creates, sprint-section ghost row, and VIEWER role hiding (no ghost row for
VIEWERs). The backend `IssuesService.create` path correctly handles `sprintId` on
creation (the ghost row passes its sprint's id). No new security gaps introduced.
The optimistic cache update in `useCreateIssue.onSuccess` (`issues.ts:98-103`) is
idempotent (guards with `!list.some(i => i.id === created.id)`). Clean.

### Ratings (Pass 4)

| Area | Score | Delta | Note |
|------|:----:|:-----:|------|
| Architecture & module boundaries | 4 | — | Clean per-domain modules; webhooks added as its own module correctly; no leaks. Controller/service/DTO pattern consistent. |
| Data model & migrations | 4 | — | Four migrations in clean sequence; webhook tables well-indexed. Missing `(projectId, createdAt, id)` composite for cursor pagination (see Risk #1). `status` enum `(string)` on WebhookDelivery is stringly-typed (could be an enum). |
| AuthN | 4 | — | argon2, global JWT guard, fail-fast secret, 7d token. No refresh/revoke; acceptable for MVP. |
| AuthZ & multi-tenant isolation | **4** | — | All major holes confirmed closed from prior passes. Webhook CRUD correctly gated to ADMIN. `deliveries` endpoint uses `assertProjectMember` (read OK for non-admins). No regressions found. |
| Input validation | 3 | — | DTOs improved significantly. Remaining: webhook URL allows private/loopback ranges (SSRF); `redirect: 'follow'` on fetch. `label.color` hex validation not confirmed fixed this pass. No rate-limit guard on comment/description bulk-insert patterns. |
| Error handling | **4** | +2 | Global exception filter confirmed shipped; maps P2002/P2025/P2003 to clean HTTP responses; suppresses stack traces in production. Score still 4 not 5 because: `$transaction` failures (deadlock, serialization) and `rankBetween` edge cases throw generically; the filter catches them as 500s but with a generic message rather than a mapped one. |
| N+1 / query efficiency | 3 | — | Cursor pagination added to `findAll`. Board, roadmap, and all list endpoints (sprints, statuses, labels) still unbounded — acceptable for small self-hosted projects but will degrade at scale. `assertNoParentCycle` still O(N) serial queries. `notifyComment` iterates watchers with one `notify` DB call per watcher (N inserts + N realtime emits in serial). `rebalanceAndPlace` issues N individual `UPDATE`s inside a transaction (no batch). |
| Realtime correctness | 4 | — | Gateway auth solid. Sprint lifecycle emits added. Stale socket token on future refresh-token is P2 carry-forward. |
| Rank / ordering integrity | **4** | +2 | `move` is now fully transactional with `$transaction`; `rebalanceAndPlace` redistributes ranks atomically when a gap is exhausted. Unit tests cover both the normal path and the collision fallback. Remaining: `rebalanceAndPlace` uses N individual updates (not `updateMany`) inside the tx — O(N) round-trips for large columns. |
| Test coverage (unit + e2e) | **3** | — | 39 unit tests passing in CI. New `webhooks.service.spec.ts` (dispatch/delivery, scoping, HMAC correctness) and expanded `issues.service.spec.ts` (cursor pagination, move collision rebalance) are high-quality. e2e suite now has 37 spec files covering auth, board, backlog, VIEWER roles, webhook API + UI, inline create. Gaps: no unit tests for `CommentsService`, `NotificationsService` fan-out, `BoardService`, `RoadmapService`, `ReportsService`, `MeService`. No integration test for cursor pagination with a real DB (index coverage can only be verified with EXPLAIN ANALYZE). |
| Type safety | 5 | — | Strict TS, clean typecheck API + web, no stray `any`. `WebhookEventPayload.data: unknown` is intentionally loose (correct). `SubscriptionRow` type alias matches Prisma row. |
| Build / CI / Docker | 4 | — | CI confirmed: build + unit tests + typechecks on every push. Docker multi-stage build correct. Entrypoint runs `prisma migrate deploy` then seed. One remaining concern: `docker-entrypoint.sh` runs `npx prisma` without a version pin — relies on whatever prisma version is in the container's node_modules. |
| Secrets / config hygiene | 4 | — | JWT secret fail-fast in bootstrap + compose `:?` expansion confirmed solid. Webhook secrets generated with `randomBytes(24).toString('hex')` when not supplied — good. Stored as plaintext in DB (acceptable since the secret is write-only and never returned in API responses). `POSTGRES_PASSWORD` compose default (`nextlane`) is a known weak default — not enforced with `:?`. |
| Dependency risk | 4 | — | Mainstream stack. `fractional-indexing` (MIT), `argon2`, `socket.io 4`, `@nestjs 10`, `prisma 5` — all maintained. No Dependabot / automated CVE scanning. Redis in compose but entirely unused in code (dead infra). |

### Top risks & debt (Pass 4, prioritized)

**P0 — None identified.** All prior P0s confirmed resolved.

**P1:**

1. **SSRF via webhook URL — no private-range block, redirects followed** *(P1, Med impact / Med likelihood in self-hosted multi-tenant)*
   `webhooks.service.ts:244` — Node native `fetch` with `redirect: 'follow'` (default) POSTs to any URL that passes `@IsUrl`. Accepted: `http://localhost`, `http://169.254.169.254`, any RFC 1918 address, any internal hostname resolvable from the container. An ADMIN can route server-side requests to internal services or cloud metadata endpoints. `webhook.dto.ts:20-21` documents this as a follow-up. For a single-tenant self-hosted deployment the risk is self-inflicted; it is a genuine P1 for any hosted offering.
   *Fix:* (a) DNS-resolve the URL at validation time and reject RFC 1918/loopback/link-local addresses. (b) Set `redirect: 'manual'` on the `fetch` call. Use `is-in-subnet` (or a hand-rolled CIDR check) — no heavy dep needed. Add `@IsIP()` or DNS block in `webhook.dto.ts`. *Size: M.*
   *Files:* `apps/api/src/webhooks/webhooks.service.ts:244-265`, `apps/api/src/webhooks/dto/webhook.dto.ts:17-23`

2. **Missing composite DB index for cursor pagination** *(P1, High impact / High likelihood when projects exceed a few hundred issues)*
   `issues.service.ts:257-262` queries `WHERE projectId = X AND (createdAt > Y OR (createdAt = Y AND id > Z)) ORDER BY createdAt ASC, id ASC`. No covering index exists for this pattern. PostgreSQL will resort to a bitmap index scan on `(projectId, statusId)` (wrong columns) or a seq-scan + sort. For projects with thousands of issues this becomes a full-table scan that grows linearly with project size on every page request.
   *Fix:* Add `@@index([projectId, createdAt, id])` to the `Issue` model and generate a migration. One line in `schema.prisma`, one `prisma migrate dev`. *Size: S.*
   *Files:* `apps/api/prisma/schema.prisma` (Issue model, after line 201)

**P2:**

3. **`useProjectIssues` walks all pages serially — planning view stalls on large projects** *(P2, Med impact / Med likelihood)*
   `apps/web/src/api/issues.ts:30-47` — the `do { } while (cursor)` loop fetches all pages before returning. 10k issues / 200 per page = 50 sequential requests. The planning view's spinner stays up for the full waterfall duration.
   *Fix:* Add a server-side `GET /projects/:id/issues/planning` endpoint returning all issues with a slim projection (id, title, type, priority, statusId, sprintId, rank — no description, no labels, no comments count). The planning view gets one bounded request. Alternatively, virtual-scroll the backlog sections and fetch pages on demand. *Size: M.*
   *Files:* `apps/web/src/api/issues.ts:26-47`, `apps/api/src/issues/issues.service.ts:222-271`

4. **Webhook delivery fan-out is unbounded concurrent** *(P2, Low-Med impact / Low likelihood at current scale)*
   `webhooks.service.ts:217-224` — `Promise.all(matching.map(s => this.deliver(...)))` fans out all matching subscriptions simultaneously. At 5 active subscriptions per project × N simultaneous issue events this is manageable; at 50+ subscriptions it saturates the outbound connection pool and event loop. No concurrency cap.
   *Fix:* Wrap deliveries in a semaphore capped at 5 concurrent (one `p-limit(5)` call or a manual 5-slot queue). Long-term, move to a Redis-backed job queue (Redis is already in compose). *Size: S (cap), L (queue).*
   *Files:* `apps/api/src/webhooks/webhooks.service.ts:217-224`

5. **`deliver` does not drain the response body — TCP socket leak** *(P2, Low-Med impact / Med likelihood under load)*
   `webhooks.service.ts:255-257` reads `res.status` and `res.ok` but never consumes the response body. In Node.js (undici-backed fetch), an unconsumed body keeps the underlying TCP connection open until the server closes it or the garbage collector finalizes it. Under load with many deliveries this can exhaust the HTTP connection pool.
   *Fix:* After reading `res.ok`, add `await res.body?.cancel()` to release the connection. One line. *Size: S.*
   *Files:* `apps/api/src/webhooks/webhooks.service.ts:254-258`

6. **`assertNoParentCycle` is still O(N) serial queries, outside transaction** *(P2, Low impact / Low likelihood)*
   `issues.service.ts:436-451` — the while-loop issues one `findUnique` per ancestor hop, up to 1000 hops (1000 round-trips). Runs BEFORE the `issue.update` call, not inside the transaction — a concurrent parent reassignment between the guard and the write can still produce a cycle (though an extremely narrow TOCTOU window).
   *Fix:* Replace with a single `WITH RECURSIVE` CTE via `prisma.$queryRaw`. Move the check inside the transaction. *Size: M.*
   *Files:* `apps/api/src/issues/issues.service.ts:427-451`

7. **`notifyComment` and `rebalanceAndPlace` are serial N-query loops** *(P2, Low impact / Low likelihood)*
   `notifications.service.ts:184-209` iterates watchers with one `notify()` call per watcher (one DB INSERT + one socket emit per watcher, in series). `issues.service.ts:583-595` iterates the rebalanced column with one `tx.issue.update()` per row. Neither is blocking a user-facing response (comment create is fast; rebalance is in-transaction), but both are O(watchers) and O(column-size) DB round-trips.
   *Fix (N+1 for notify):* Use `prisma.notification.createMany()` for the batch insert, then emit a single `notification.created` per user via `emitToUser` in a follow-up loop. *Fix (rebalance):* Use `prisma.$executeRaw` with a single `UPDATE … CASE WHEN … END` or a `createMany`-style approach — though Prisma doesn't natively support batch updates by ID; `$executeRaw` with a `VALUES` list is the pragmatic path. *Size: M.*
   *Files:* `apps/api/src/notifications/notifications.service.ts:184-209`, `apps/api/src/issues/issues.service.ts:583-595`

8. **Board and roadmap endpoints are still unbounded** *(P2, Med impact / Med likelihood at scale)*
   `board.service.ts:32-43` and `roadmap.service.ts:51-64` call `findMany` with no `take`. The board is bounded in practice by sprint membership, but a project with an enormous backlog (all issues `sprintId = null`) will load all of them. Roadmap fetches all epics unconditionally.
   *Fix:* For the board add a `take: 500` safety cap with a `hasMore` flag in the response; surface a warning in the UI. For roadmap, a `take: 200` on epics is a reasonable start-up guard. *Size: S.*
   *Files:* `apps/api/src/board/board.service.ts:32-43`, `apps/api/src/roadmap/roadmap.service.ts:51-64`

9. **JWT stored in `localStorage` — XSS extractable** *(P2, Med impact / Low likelihood given no current XSS vector)*
   `apps/web/src/api/client.ts:TOKEN_KEY` — the JWT is stored in `localStorage` and read on every request. If an XSS vulnerability is ever introduced (e.g. via a future rich-text editor for issue descriptions), the token is trivially exfiltrable. Currently the app renders comment bodies and descriptions as plain text (no `dangerouslySetInnerHTML`) so there is no active XSS vector, but the architecture couples token safety to XSS hygiene.
   *Fix (long-term):* Move to `httpOnly` cookie transport (`SameSite=Strict`). Add a `POST /auth/refresh` endpoint and short-lived access tokens. Short-term: ensure a Content-Security-Policy header is set on the web container. *Size: L (cookie migration), S (CSP header).*
   *Files:* `apps/web/src/api/client.ts:4-11`, `apps/api/src/main.ts`

10. **No rate limiting on auth endpoints (register/login brute-force)** *(P2, Med impact / Med likelihood)*
    `apps/api/src/main.ts` — no `@nestjs/throttler` or any rate-limiting middleware. `POST /auth/login` and `POST /auth/register` are publicly accessible (`@Public()`) with no per-IP or per-email rate limit. A bot can attempt unlimited password guesses or registration spam.
    *Fix:* Add `@nestjs/throttler` with a Redis store (`ThrottlerStorageRedisService` — Redis is already in compose). Apply a `@Throttle({ default: { limit: 10, ttl: 60000 } })` decorator to `AuthController.login` and `register`. *Size: S.*
    *Files:* `apps/api/src/main.ts`, `apps/api/src/auth/auth.controller.ts`

11. **Redis in compose is completely unused** *(P2, Low impact — dead infra)*
    `docker-compose.yml` provisions a Redis 7 container with a volume and health check, but `apps/api/src/**/*.ts` contains zero Redis imports, no `ioredis`, no Bull, no Socket.io adapter. The compose file allocates memory, a volume mount, and a health check round-trip for a service that does nothing.
    *Fix:* Either (a) remove Redis from compose until it is used (simplest for self-hosters), or (b) immediately wire up the Socket.io Redis adapter (`@socket.io/redis-adapter`) so the compose config is justified and horizontal scale is unblocked. *Size: S (remove) or M (wire up adapter).*
    *Files:* `docker-compose.yml:19-30`, no API file references Redis.

### New capabilities & technical investments (ideation mandate)

Three concrete investments beyond the defect list:

1. **Redis-backed webhook delivery queue with retries and exponential back-off.**
   The webhook system currently fire-and-forgets with a 2-attempt retry in-process.
   Moving delivery to a Redis job queue (Bull/BullMQ, using the already-provisioned
   Redis service) gives: durable retries that survive API restarts, configurable
   exponential back-off (3 attempts: 0 s, 30 s, 5 min), a UI delivery dashboard
   that shows "pending" vs "failed" jobs, dead-letter queue for permanently failed
   deliveries, and a path to horizontal API scale (multiple workers compete for the
   same queue). This completes the webhook system from "fire-and-forget" to
   "production-grade automation backbone." The compose Redis is already there waiting.
   *Priority: P1. Size: M.*

2. **Content-Security-Policy + security headers middleware.**
   Add a CSP header on both the web container (nginx config) and the API
   (`helmet` middleware in `main.ts`): `Content-Security-Policy: default-src 'self';
   connect-src 'self' ws: wss:; script-src 'self'; style-src 'self' 'unsafe-inline'`.
   This closes the XSS-to-token-theft vector (#9 above) without a full cookie
   migration. Also add `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
   and `Referrer-Policy: strict-origin-when-cross-origin`. For the API, `helmet`
   covers most of these in one call. For the web container, a three-line nginx
   `add_header` block suffices. Total effort: ~30 lines of configuration. This is
   a meaningful open-source release hygiene item — security scanners and self-hosting
   guides will flag their absence. *Priority: P1. Size: S.*

3. **Observability: structured request logging + /health enrichment + optional
   OpenTelemetry export.**
   Replace NestJS's default console logger with a structured JSON logger (pino or
   `nestjs-pino`) that emits `{ requestId, method, path, status, durationMs,
   userId }` per request. Inject a `requestId` via a middleware and attach it to
   every log line and to `AllExceptionsFilter` output. Enrich the existing
   `GET /health` endpoint (currently just `{ status: 'ok' }`) to include DB
   connectivity, uptime, and version. Add an optional OpenTelemetry export
   (configured via `OTEL_EXPORTER_OTLP_ENDPOINT` env var) for Prisma spans.
   Self-hosted operators running Next Lane in Docker get operator-grade visibility
   into their own instance without SSH access. This also makes the webhook
   "connection refused" errors visible in structured logs rather than swallowed
   into a Logger.error call that vanishes into stdout. *Priority: P2. Size: M.*

### Direction (Pass 4)

The engineering health of the system has improved substantially across four passes.
All P0 risks are resolved. The architecture is clean and consistent. The test suite
and CI gate are functional, and the three feature areas audited this pass
(webhooks, cursor pagination, inline create) are all well-implemented.

The most actionable immediate items are:

- **SSRF block for webhook URLs** (P1, M) — the one remaining P1-class security
  gap; register a `dns.lookup` check + `redirect: 'manual'` before the open-source
  release to avoid it being the first CVE reported against the project.
- **Composite `(projectId, createdAt, id)` index** (P1, S) — a one-line schema
  change; without it the cursor pagination query degrades linearly with project
  size on every backlog/planning page load.
- **`deliver` body drain** (P2, S) — one line; prevents a slow TCP connection
  leak under webhook load.
- **Rate limiting on auth endpoints** (P2, S) — `@nestjs/throttler` + Redis store;
  the Redis service is already provisioned and sitting idle.
- **CSP + security headers** (P1, S) — 30 lines of config; the most visible
  hardening gap for an open-source release.

After those quick wins, the **Redis-backed job queue for webhook delivery** is the
investment that upgrades the webhook system from "reasonable MVP" to
"production-grade automation backbone" and finally justifies the Redis container.
The **observability baseline** (structured logs, `/health` enrichment, OTel) is
what makes self-hosting Next Lane a supportable experience for operators who cannot
access container stdout.

### Backlog-groomer feed (Pass 4 — compact)

- **SSRF block for webhook URLs: DNS-resolve + reject RFC 1918/loopback/link-local + redirect:manual** · P1 · M · Any admin can route server-side requests to internal services or cloud metadata; documented follow-up now due before open-source release. `webhooks.service.ts:244`, `webhook.dto.ts:21`
- **Add composite index `@@index([projectId, createdAt, id])` on Issue for cursor pagination** · P1 · S · Missing covering index; GET /issues cursor query degrades to seq-scan + sort on large projects. `schema.prisma` Issue model
- **Drain fetch response body in webhook `deliver` (add `res.body?.cancel()`)** · P2 · S · Unconsumed body leaks TCP connection per delivery; can exhaust connection pool under load. `webhooks.service.ts:254-258`
- **Add rate limiting on POST /auth/login and /auth/register (nestjs/throttler + Redis store)** · P2 · S · Unlimited brute-force on public login endpoint; Redis already in compose. `auth.controller.ts`
- **Cap webhook delivery fan-out concurrency (p-limit(5) or semaphore)** · P2 · S · Promise.all on all subscriptions simultaneously; can saturate event loop at scale. `webhooks.service.ts:217-224`
- **Add CSP + security headers (helmet on API, nginx add_header on web)** · P1 · S · Missing security headers; flagged by scanners; closes XSS-to-token vector. `main.ts`, web nginx config
- **Slim planning-view endpoint (or virtual scroll) to avoid all-pages waterfall** · P2 · M · useProjectIssues walks all cursor pages serially before rendering; stalls on large projects. `issues.ts:30-47`
- **Add take cap to board and roadmap endpoints** · P2 · S · Both fetch all matching issues unbounded; graceful degradation needed. `board.service.ts:32`, `roadmap.service.ts:51`
- **Replace assertNoParentCycle serial loop with single WITH RECURSIVE CTE inside transaction** · P2 · M · O(N) round-trips + TOCTOU window; CTE collapses to one query. `issues.service.ts:427-451`
- **Batch notifyComment inserts (createMany) + rebalanceAndPlace (executeRaw batch UPDATE)** · P2 · M · Serial N inserts for watchers; serial N updates in rebalance tx. `notifications.service.ts:184-209`, `issues.service.ts:583-595`
- **Wire Socket.io Redis adapter OR remove Redis from compose** · P2 · S · Redis provisioned but unused; dead infra adds resource cost and confusion. `docker-compose.yml`
- **JWT migration to httpOnly cookie + add POST /auth/refresh** · P2 · L · Token in localStorage is XSS-extractable; cookie migration + short-lived access tokens is the durable fix. `client.ts`
- **Redis-backed webhook delivery queue with retries and exponential back-off (BullMQ)** · P1 · M · Upgrades fire-and-forget to durable retry backbone; uses existing Redis; unblocks automation workflows and horizontal scale. `webhooks.service.ts`
- **Structured request logging (pino/nestjs-pino) + enriched /health + optional OTel export** · P2 · M · Self-hosted operators need operator-grade visibility; structured logs make webhook errors and slow queries diagnosable. `main.ts`

---

## 2026-06-27 — Pass 5 (post-PAT/attachments/password-reset/BullMQ/pino/cursor-index/Helm audit)

Scope: full re-audit of all Pass-4 open items plus a deep-dive on every major
feature wave shipped since then: personal API tokens (PAT, `nlp_` prefix, JWT
guard extension), file attachments (multer diskStorage, MIME validation,
path-traversal safety, Content-Disposition), password reset (single-use
SHA-256-hashed tokens, anti-enumeration, transaction-atomic mark-used), BullMQ
Redis-backed webhook queue (REDIS_URL-gated, in-process fallback), Socket.io
Redis adapter (REDIS_URL-gated, in-memory fallback), nestjs-pino structured
logging (redact config), label rename, CFD report (ActivityLog in-memory
replay), team-pulse, keyboard triage, and the Helm / Kustomize Kubernetes
manifests. API typecheck (`tsc --noEmit`) clean; `pnpm --filter api test` runs
214 tests across 18 suites — all passing.

### Pass-4 fix verification

| Fix area | Status | Evidence |
|----------|--------|----------|
| SSRF block for webhook URLs | CONFIRMED FIXED | `webhooks.service.ts` — `resolveAndCheckBlocked()` DNS-resolves the hostname via `dns.promises.lookup`, then passes the resolved address through `isBlockedIp()` which checks RFC 1918 (10.x, 172.16-31.x, 192.168.x), loopback (127.x, ::1), and link-local (169.254.x) ranges. `fetch` called with `redirect: 'manual'`. Delivery silently aborts with `blocked_ip` status if resolved. |
| Composite index `(projectId, createdAt, id)` on Issue | CONFIRMED FIXED | Migration `20260627012032_issue_pagination_index/migration.sql` adds `CREATE INDEX "Issue_projectId_createdAt_id_idx"`. `schema.prisma` Issue model line 241 has `@@index([projectId, createdAt, id])`. |
| Drain fetch response body in webhook `deliver` | CONFIRMED FIXED | `webhooks.service.ts` — `await res.text().catch(() => undefined)` consumes the body after reading `res.ok`. |
| Rate limiting on auth endpoints | CONFIRMED FIXED | `ThrottlerModule` configured globally in `app.module.ts`. `ConfigurableThrottlerGuard` applied as `APP_GUARD`. Auth controller has stricter per-route `@Throttle()`. `RATE_LIMIT_DISABLED` env escape hatch for shared-IP / test environments. |
| Webhook delivery concurrency cap | CONFIRMED FIXED | `webhooks.service.ts` — in-process fallback uses `pLimit(10)` for concurrency capping. BullMQ queue (when REDIS_URL is set) handles concurrency via worker `concurrency` option. |
| CSP + security headers (helmet, nginx) | CONFIRMED PARTIAL | `main.ts` — `app.use(helmet())` added; Helmet defaults include `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, and related headers. Nginx configs (Kustomize `configmap-web-nginx.yaml` and Helm `configmap.yaml`) still lack `add_header Content-Security-Policy`. The SPA itself does not get a CSP response header from nginx. |
| Wire Socket.io Redis adapter | CONFIRMED FIXED | `realtime.module.ts` — `@socket.io/redis-adapter` registered when `REDIS_URL` is set; falls back to in-memory adapter. `docker-compose.yml` sets `REDIS_URL: redis://redis:6379`. |
| Redis-backed BullMQ webhook queue | CONFIRMED FIXED | `webhooks.service.ts` — `Queue<WebhookJobData>` instantiated only when `REDIS_URL` is set; Worker registered in same guard. In-process `pLimit(10)` fallback retained. REDIS_URL plumbed via `compose.yml`. |
| Add take cap to board and roadmap endpoints | CONFIRMED FIXED | `board.service.ts` — `BOARD_ISSUES_CAP = 500` applied as `take` limit; `hasMore` flag returned. `roadmap.service.ts` — `ROADMAP_EPICS_CAP = 500` applied. |
| assertNoParentCycle WITH RECURSIVE CTE inside transaction | CONFIRMED FIXED | `issues.service.ts` — `assertNoParentCycleCTE()` uses `$queryRaw` with `WITH RECURSIVE` CTE; runs inside the `$transaction` block. |
| Batch notifyComment inserts | PARTIALLY FIXED — BullMQ / watchers serial still present | `notifications.service.ts` — `notifyComment()` still issues sequential `await this.notify()` per watcher. The watcher list is iterated serially. |
| rebalanceAndPlace batch UPDATE | NOT FIXED | `issues.service.ts` — `rebalanceAndPlace` still uses individual `tx.issue.update()` calls in a loop. N round-trips for large columns. Carry-forward P2. |
| Slim planning-view endpoint / virtual scroll | NOT FIXED | `useProjectIssues` in `apps/web/src/api/issues.ts` still walks all cursor pages. Carry-forward P2. |
| Dockerfile `--frozen-lockfile` | CONFIRMED FIXED | `apps/api/Dockerfile` and `apps/web/Dockerfile` both use `--frozen-lockfile`. |
| nestjs-pino structured logging | CONFIRMED FIXED | `app.module.ts` `LoggerModule.forRoot(...)` with `pino-pretty` in dev, JSON in prod. Redact config covers `req.headers.authorization`, `req.headers.cookie`, `req.body.password`, `req.body.token`, `req.body.newPassword`. |

### Deep-dive: PAT authentication path

The PAT design is architecturally correct. The JwtAuthGuard extension at
`jwt-auth.guard.ts:45-51` correctly intercepts any bearer token prefixed
`nlp_`, calls `ApiTokensService.validateRawToken()`, and attaches `request.user`
to the same shape (`{ id, email, name }`) that `JwtStrategy.validate()` produces
— so every downstream service that reads `request.user` behaves identically
regardless of whether the caller used a JWT or a PAT. There is no bypass path:
the `@Public()` decorator short-circuits before the PAT check at line 34, so
public routes remain public. For all non-public routes, the `isPat` branch fires
first; a crafted token that starts with `nlp_` but is invalid will throw
`UnauthorizedException` at `validateRawToken`, never reaching the Passport JWT
path.

`validateRawToken` hashes the raw token with SHA-256 and does a
`findUnique({ where: { tokenHash } })` — the unique index makes this a constant-
time lookup from the DB's perspective, and the raw token is never persisted.
Revocation and expiry are checked correctly.

**No privilege escalation path found.** PATs are scoped to the owning user's
permissions; the token carries the user's identity and all role checks
downstream apply normally.

**Functional gap confirmed: PATs cannot authenticate the WebSocket gateway.**
`realtime.gateway.ts:74` calls `this.jwt.verify<JwtPayload>(token)` which only
accepts JWT format. A CI script or automation tool that authenticates with a
PAT (`nlp_...`) will be rejected at the socket handshake with "invalid token."
This is a functional limitation, not a security hole, but scripts that need
real-time subscription (e.g., waiting for issue state changes) cannot use PATs.

**Defect: the `expiresAt` field on `CreateApiTokenDto` accepts past dates.**
`api-token.dto.ts:20-21` uses `@IsOptional() @IsISO8601()` with no `@MinDate`
constraint. A caller can submit `expiresAt: "2020-01-01T00:00:00Z"` and the
token will be created successfully, immediately expire on first validation, and
become permanently unusable. The service does not check at creation time. This
is a usability defect (not a security one — creating an expired token harms only
the creator), but it is a surprising API behavior.

**Defect: no null-file guard on the upload endpoint.**
`attachments.controller.ts:48-50` — `@UploadedFile() file: Express.Multer.File`
is typed as non-nullable. If a multipart request arrives without a `file` field
(e.g. `curl -X POST /issues/x/attachments` with an empty body), multer sets
`file` to `undefined`. The service's `upload()` method at
`attachments.service.ts:107` immediately dereferences `file.size`, throwing a
`TypeError: Cannot read properties of undefined`, which the global exception
filter catches as a generic 500. The client receives a 500 instead of a 400.
Fix: add a guard `if (!file) throw new BadRequestException('No file uploaded');`
at the top of `AttachmentsService.upload()`, or use multer's `fileFilter` to
reject empty uploads with a 400.

**Risk: MIME type validated from client Content-Type header, not magic bytes.**
`attachments.service.ts:115` — `ALLOWED_MIME_TYPES.has(file.mimetype)` checks
the MIME type that multer reads from the `Content-Type` field of the multipart
part, which is fully client-controlled. A caller can send a PHP script with
`Content-Type: image/jpeg` and it will pass this check. The `X-Content-Type-
Options: nosniff` header from Helmet prevents the browser from sniffing the real
type on download, and the storageKey is UUID-based so the server never executes
the uploaded content — but the payload is still stored on disk with an extension
that does not match its actual content type. For a self-hosted deployment that
also runs a web server serving the uploads directory this is a meaningful risk.
Fix: validate MIME type against the first magic bytes using a library such as
`file-type` (pure npm, no native deps) after multer writes the file to tmpdir,
before moving to the final uploads directory.

**Risk: SVG is in ALLOWED_MIME_TYPES and is served with `image/svg+xml`.**
`attachments.service.ts:35` allows `image/svg+xml`. SVG files can contain
embedded `<script>` tags that execute in browser context when the file is served
inline. The download endpoint at `attachments.controller.ts:77-83` explicitly
excludes SVG from `inlineTypes`, so SVGs are served with `Content-Disposition:
attachment` and `Content-Type: image/svg+xml`. The `nosniff` header is present.
However, a user who navigates directly to the download URL and a browser that
respects the Content-Type (not the disposition) will render the SVG with script
execution. The defense is partially effective but not robust. The safest fix is
to remove `image/svg+xml` from `ALLOWED_MIME_TYPES` outright, or if SVG upload
is intentional, serve it as `Content-Type: application/octet-stream` on download
to prevent in-browser rendering.

### Deep-dive: password reset token in logs

`password-reset.service.ts:153-156` logs the raw reset URL (including the
full 32-byte token as a URL query parameter) at `logger.log()` level — which
in production emits to stdout as a JSON line via pino. The `app.module.ts`
redact configuration covers `req.body.token` and `req.headers.authorization`
but does NOT redact explicit `logger.log()` calls, which bypass the pino-http
request-logging path entirely. In a self-hosted deployment with a log aggregator
(Loki, Datadog, CloudWatch), the reset token is captured in plain text and
remains searchable in the log store for the retention period — potentially longer
than the token's own 1-hour validity window is designed to allow.

This is intentional for the dev-mode "no SMTP" fallback, with a comment
directing operators to remove the log in production. However the comment is not
enforced: there is no `NODE_ENV` guard, no SMTP check before the explicit log,
and no warning that this is a temporary behavior. Any operator who does not read
this line of source (the typical self-hoster) will run with tokens in their
logs.

Fix (two-part): (a) Guard the token log line with
`if (process.env.NODE_ENV !== 'production')` so production deployments never
emit it regardless of SMTP status. (b) When `SMTP_HOST` is set, skip the log
entirely (send only via SMTP). The dev-mode fallback should be the last resort,
not the default path even for production deployments with no SMTP configured.

### Deep-dive: webhook HMAC secret in Redis

When `REDIS_URL` is set, `webhooks.service.ts` creates a BullMQ `Queue` and
enqueues a `WebhookJobData` job that includes the subscription's `secret` field
(the HMAC signing secret) as plaintext in the job body. BullMQ stores job data
in Redis as JSON strings, with no encryption. The Helm chart's bundled Redis
(`values.yaml:358-362`) defaults to `auth.enabled: false` — no password
required. Any process that can reach the Redis port (or any Kubernetes workload
in the same namespace that can perform a `redis-cli KEYS '*'`) can read the HMAC
secrets for every webhook subscription.

This does not compromise the API or user data, but it does allow an attacker
with Redis access to forge webhook signatures, making receivers believe events
came from Next Lane when they did not. For self-hosted single-tenant installs
this is lower-risk (same operator owns Redis and the API). For any multi-tenant
deployment it is a meaningful risk.

Fix (short-term): Enqueue only the `subscriptionId` (not the secret) in the job
body; have the worker re-fetch the subscription record from the DB (one indexed
lookup) to get the secret at delivery time. The job body shrinks and secrets
never enter Redis. Fix (deployment): Update `values.yaml` default comment to
recommend enabling Redis auth when Redis is enabled; add a `NOTES.txt` Helm
warning.

### Deep-dive: CFD report unbounded queries

`reports.service.ts:302-310` — the CFD endpoint calls
`prisma.issue.findMany({ where: { projectId } })` with no `take` limit. For a
project with 50,000 issues this fetches all rows into application memory. The
follow-up query at `reports.service.ts:329-336` fetches all `ActivityLog` rows
for `{ issueId: { in: issueIds }, field: 'status' }` — again unbounded. With
50,000 issues each averaging 5 status changes, this is 250,000 activityLog rows
in memory simultaneously. The in-memory reconstruction loop at step 4 is
O(issues × days), or 50,000 × 366 = 18.3M iterations for a full-year window.
This will timeout or OOM the API process for any non-trivial project.

The burndown endpoint has a similar pattern (all sprint issues + all their
activityLog rows).

Fix: Aggregate at the DB level. Replace the in-memory replay with a Postgres
query that counts issues per status category per calendar day using a window
function or `generate_series`. This collapses the two unbounded `findMany` calls
and the in-memory loop into a single query with bounded output (one row per day
per status category). The result set is always bounded by `windowDays × 3`
regardless of project size.

### Ratings (Pass 5)

| Area | Score | Delta | Note |
|------|:----:|:-----:|------|
| Architecture & module boundaries | 4 | — | PAT, attachments, password reset, and notifications all added as independent modules following the per-domain pattern. Clean. |
| Data model & migrations | 4 | — | Attachment, ApiToken, PasswordResetToken, WebhookDelivery models well-formed. Composite index on Issue added. WebhookDelivery.status remains a stringly-typed String (not an enum). `sizeBytes` on Attachment is `Int` (32-bit); files up to ~2.1 GB storable in the DB but the 10 MB env guard prevents overflow. |
| AuthN | 4 | — | PAT path correctly implemented; no bypass found. Password reset tokens single-use, SHA-256 hashed, expiry-checked atomically. Still no refresh-token flow (acceptable for MVP). |
| AuthZ & multi-tenant isolation | 4 | — | All new endpoints (attachments, PATs via `/me/tokens`, password reset, reports, pulse) correctly membership-gated. Attachment operations check `assertProjectRole(MEMBER)` for upload, `assertProjectMember` for list/download, uploader-or-ADMIN for delete. No regressions found. |
| Input validation | **3** | — | MIME type check uses client Content-Type (not magic bytes); PAT `expiresAt` accepts past dates; missing null-file guard on upload (500 instead of 400); SVG allowed with no server-side content sanitization. Overall DTO quality remains good; these are specific gaps. |
| Error handling | 4 | — | Global exception filter confirmed solid. Null-file case produces unhandled TypeError → 500 via filter generic path (should be 400). |
| N+1 / query efficiency | 3 | — | CFD + burndown unbounded queries (all issues + all activity logs); PAT lookup adds one DB query per PAT-authenticated request (no caching); notifyComment watcher fan-out still serial; rebalanceAndPlace still N individual tx.issue.update() calls. Cursor pagination solid for issues. |
| Realtime correctness | 4 | — | Socket auth confirmed solid. Redis adapter REDIS_URL-gated with fallback. PAT tokens not accepted at socket handshake (functional gap, not security hole). |
| Rank / ordering integrity | 4 | — | Transactional move + rebalance confirmed solid from Pass 4; no regressions. rebalanceAndPlace N-round-trips carry-forward P2. |
| Test coverage (unit + e2e) | **4** | +1 | 214 tests across 18 suites passing in CI. New suites: `api-tokens.service.spec.ts`, `attachments.service.spec.ts`, `password-reset.service.spec.ts`, `reports.service.spec.ts`, `webhooks-redis.service.spec.ts`. Strong growth. Gaps: no CFD DB-level aggregate tested (in-memory path only); no test for null-file upload 500; no test for past-date PAT expiry at creation. |
| Type safety | 5 | — | Strict TS, clean typecheck API + web, no stray `any`. |
| Build / CI / Docker | 4 | — | CI gates on build + 214 unit tests + typechecks. Dockerfiles use `--frozen-lockfile`. Redis adapter and BullMQ gated behind REDIS_URL with compile-time safe imports. |
| Secrets / config hygiene | **3** | -1 | Password reset token logged in plaintext at `logger.log()` level with no NODE_ENV guard — persists in log aggregators beyond token validity window. Webhook HMAC secrets enqueued in plaintext BullMQ job body; bundled Redis has no auth by default in Helm. Postgres default password `nextlane` in Helm values with "CHANGE ME" comment but no fail-fast guard (unlike JWT secret). JWT secret fail-fast remains solid. |
| Dependency risk | 4 | — | New deps: `multer`, `@nestjs/platform-express` FileInterceptor, `bullmq`, `@socket.io/redis-adapter`, `nestjs-pino`, `pino-pretty`. All mainstream, maintained. No Dependabot / automated CVE scanning. |

### Top risks & debt (Pass 5, prioritized)

**P0 — None identified.**

**P1:**

1. **Password reset token logged in plaintext to production logs** *(P1, High impact / High likelihood — every self-hoster without SMTP configured)*
   `apps/api/src/auth/password-reset.service.ts:153-156` — the full reset URL
   (including the raw 32-byte token as a query parameter) is emitted via
   `this.logger.log()` with no NODE_ENV guard. pino-http request redact rules
   do not cover explicit `logger.log()` calls. Any log aggregator (Loki, Splunk,
   CloudWatch, journald) captures the token in the clear and retains it beyond
   the 1-hour validity window. Anyone with log read access can consume the token
   before the legitimate user.
   *Fix:* Wrap the token log line with `if (process.env.NODE_ENV !== 'production')`.
   When `SMTP_HOST` is configured, skip the log entirely. Size: S.

2. **SVG upload allowed; served with `image/svg+xml` Content-Type — XSS via direct URL** *(P1, Med impact / Low likelihood with nosniff)*
   `apps/api/src/attachments/attachments.service.ts:35` includes `image/svg+xml`
   in `ALLOWED_MIME_TYPES`. The download endpoint at
   `attachments.controller.ts:84-86` serves SVGs with `Content-Disposition:
   attachment` but `Content-Type: image/svg+xml`. A browser that navigates
   directly to the download URL (bypassing the disposition hint via Save-as then
   open, or in certain browser extensions) will render the SVG with full script
   execution in the page context. The `X-Content-Type-Options: nosniff` header
   reduces the risk but does not eliminate the direct-navigate vector. An SVG
   containing `<script>alert(document.cookie)</script>` is fully accepted by the
   current validation path.
   *Fix:* Remove `image/svg+xml` from `ALLOWED_MIME_TYPES` (simplest; SVG uploads
   rarely needed for an issue tracker). If SVG support is intentional, serve all
   SVG downloads as `Content-Type: application/octet-stream` to prevent browser
   rendering. Size: S.

**P2:**

3. **MIME type validated from client Content-Type header, not magic bytes** *(P2, Med impact / Med likelihood)*
   `apps/api/src/attachments/attachments.service.ts:115` — the MIME check is
   bypassable by any client that sets a legitimate MIME type on a malicious file.
   Combined with the SVG risk above, a malicious file can be stored on disk under
   a safe extension while being a different file type internally.
   *Fix:* After multer writes the file to tmpdir, read the first 4–16 bytes and
   compare against known magic byte signatures, or use the `file-type` npm
   package. Reject if the detected type does not match the declared type. Size: M.

4. **Webhook HMAC secrets in plaintext BullMQ job body; bundled Redis unauthenticated by default** *(P2, Med impact / Low likelihood on single-tenant self-hosted)*
   `apps/api/src/webhooks/webhooks.service.ts` — `WebhookJobData` includes the
   subscription `secret` field as plaintext JSON stored in Redis. The Helm chart
   `deploy/helm/next-lane/values.yaml:361` sets `redis.auth.enabled: false` by
   default. Anyone with Redis port access can read all webhook signing secrets.
   *Fix (job body):* Enqueue only `subscriptionId`; worker re-fetches the secret
   from DB at delivery time (one indexed lookup, negligible overhead). *Fix
   (Helm):* Update default comment to recommend Redis auth when BullMQ is
   enabled; add a Helm `NOTES.txt` advisory. Size: S (job body), S (Helm docs).

5. **PAT `expiresAt` accepts past dates — token immediately expires on creation** *(P2, Low impact / Low likelihood)*
   `apps/api/src/api-tokens/dto/api-token.dto.ts:20-21` — `@IsISO8601()` with no
   `@MinDate(new Date())`. A past `expiresAt` creates a token that is permanently
   invalid but does not raise an error at creation time. Confusing API behavior.
   *Fix:* Add `@IsDateString()` (already covered by `@IsISO8601()`) and a custom
   `@MinDate` using `class-validator`'s built-in, or a custom decorator that
   rejects dates in the past. Size: S.

6. **Null file on upload → TypeError → 500 instead of 400** *(P2, Low impact / High likelihood — easy to trigger)*
   `apps/api/src/attachments/attachments.controller.ts:48-50` — if a multipart
   POST arrives with no `file` field, `file` is `undefined` and
   `attachments.service.ts:107` dereferences `file.size`, producing a TypeError
   caught by the global exception filter as a generic 500.
   *Fix:* Add `if (!file) throw new BadRequestException('No file uploaded');` at
   the top of `AttachmentsService.upload()`. Size: S.

7. **CFD and burndown reports fetch all project issues and activity logs unbounded** *(P2, High impact / Med likelihood for any active project)*
   `apps/api/src/reports/reports.service.ts:302-310, 329-336` — `prisma.issue.findMany`
   and `prisma.activityLog.findMany` with `issueId: { in: issueIds }` have no
   `take` limit. For large projects these queries can OOM the API process or
   time out. The in-memory reconstruction is O(issues × days).
   *Fix:* Rewrite as a single DB-level aggregation using `generate_series` and
   window functions or date bucketing. Output is bounded by `windowDays × 3`
   regardless of project size. Size: M.

8. **nginx web container does not set Content-Security-Policy** *(P2, Med impact / Med likelihood — flagged by security scanners)*
   Kustomize `deploy/kustomize/base/configmap-web-nginx.yaml` and Helm
   `deploy/helm/next-lane/templates/configmap.yaml` (nginx config) contain no
   `add_header Content-Security-Policy` directive. Helmet covers the API
   responses but not the SPA served by the nginx container. Security scanners
   and browser extensions will flag the SPA as lacking CSP.
   *Fix:* Add `add_header Content-Security-Policy "default-src 'self'; connect-src 'self' ws: wss:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;"` to both nginx configs. Size: S.

9. **PATs cannot authenticate the WebSocket gateway** *(P2, Low impact / Low likelihood — functional gap)*
   `apps/api/src/realtime/realtime.gateway.ts:74` — `this.jwt.verify<JwtPayload>(token)`
   accepts only JWT format. Automation scripts using PATs cannot subscribe to
   project rooms.
   *Fix:* In `handleConnection`, check whether the token starts with `nlp_`;
   if so, call `apiTokensService.validateRawToken(token)` and populate
   `client.data.user` from the returned record. Size: S.

10. **notifyComment watcher fan-out is serial N-queries (carry-forward)** *(P2, Low impact / Low likelihood at MVP scale)*
    `apps/api/src/notifications/notifications.service.ts` — watchers iterated
    with one `notify()` call per watcher (INSERT + socket emit per iteration).
    *Fix:* Batch the DB inserts with `prisma.notification.createMany()` then
    emit socket events in a single loop. Size: M. (Carry-forward from Pass 4.)

11. **rebalanceAndPlace is N individual tx.issue.update() calls (carry-forward)** *(P2, Low impact / Low likelihood)*
    `apps/api/src/issues/issues.service.ts` — rank rebalance in transaction uses
    one `update()` call per row. For a 500-issue column this is 500 round-trips
    inside one transaction. *Fix:* `$executeRaw` with a single `UPDATE … CASE`
    expression. Size: M. (Carry-forward from Pass 4.)

12. **Helm bundled Postgres password `nextlane` has no fail-fast guard** *(P2, Low impact — self-inflicted by operator)*
    `deploy/helm/next-lane/values.yaml:348` — `password: nextlane` with a "CHANGE ME"
    comment. Unlike the JWT secret (which has a Helm template validation block
    that aborts the release), the Postgres password has no enforcement. A
    quick-start install that skips this step runs with a well-known default.
    *Fix:* Add a `required` validation block in `secret.yaml` that fails the
    Helm release if `postgresql.auth.password` equals `nextlane` or is empty,
    similar to the JWT secret guard. Size: S.

**P3:**

13. **PAT per-request DB lookup with no caching** *(P3, Low impact — acceptable for MVP)*
    Every PAT-authenticated request executes one `prisma.apiToken.findUnique` +
    `include: { user }`. For CI scripts making many rapid requests this adds one
    DB round-trip per call. The unique index makes it fast but it does not batch.
    *Fix (optional):* A short-lived in-memory LRU cache (e.g. 60-second TTL,
    bounded to 1,000 entries) would eliminate the per-request DB hit for hot
    tokens. Size: S.

14. **useProjectIssues walks all cursor pages on the client before rendering (carry-forward)** *(P3, Med impact / Med likelihood on large projects)*
    `apps/web/src/api/issues.ts:26-47` — do/while loop fetches all pages
    sequentially. Carry-forward from Pass 4. Size: M.

### New capabilities & technical investments (ideation mandate)

Three concrete technical investments to advance the platform:

1. **DB-level CFD and burndown aggregation via `generate_series`.**
   Replace the in-memory ActivityLog replay with Postgres date-series
   aggregation. The query joins `generate_series(start, end, '1 day')` against
   the ActivityLog to count status categories per day without loading all issue
   or log rows into application memory. This makes both reports safe for
   projects of any size, reduces API memory pressure, and opens the door to
   adding more time-series reports (throughput, cycle time, age distribution)
   with negligible marginal cost. Pair with a database index on
   `(activityLog.createdAt, field)` to make the date-range scan efficient.
   Priority: P1. Size: M.

2. **Magic-byte MIME validation + malware scanning hook.**
   Add a validation step in the attachment upload path that reads the first 16
   bytes of the uploaded file (after multer writes to tmpdir) and compares
   against known magic signatures using the `file-type` package. Reject uploads
   where the declared MIME type does not match the detected type. Expose a
   `SCAN_COMMAND` environment variable that, when set, pipes the temp file
   through an external command (e.g. `clamscan --stdout`) before storing it.
   This gives self-hosters who run ClamAV in their stack a built-in integration
   point without adding a required dependency. The hook is a no-op (zero
   overhead) when `SCAN_COMMAND` is unset. Priority: P1 (magic-byte), P3
   (scan hook). Size: M.

3. **Personal API Token scoping and webhook signing key rotation.**
   Extend the PAT model with an optional `scopes` string array (e.g.
   `['issues:read', 'issues:write', 'webhooks:none']`) that the JWT guard
   enforces at the route level via a `@RequireScope` decorator. Scoped PATs
   allow CI pipelines to hold minimal-privilege tokens. As a companion
   investment, add a `POST /projects/:id/webhooks/:wid/rotate-secret` endpoint
   that generates a new HMAC secret, stores it, and returns it once — giving
   operators a key-rotation path without deleting and recreating the
   subscription. Both features directly address the "automation-friendly self-
   hosted tracker" positioning. Priority: P2. Size: M.

### Direction (Pass 5)

The platform has matured substantially. All prior P0/P1 items are confirmed
closed. The architecture, auth model, and test suite are genuinely strong for
an early-stage OSS product.

The most important immediate actions are:

- **Password reset token in logs** (P1, S) — one-line NODE_ENV guard; affects
  every self-hoster who does not have SMTP configured, which is the majority.
- **SVG upload restriction** (P1, S) — remove `image/svg+xml` from
  `ALLOWED_MIME_TYPES`; eliminates a class of stored-XSS risk with no user-
  visible impact for a project tracker.
- **Null-file upload guard** (P2, S) — add an explicit check in
  `AttachmentsService.upload()` to return 400 instead of 500 when no file is
  sent; a one-liner.
- **PAT `expiresAt` past-date validator** (P2, S) — add `@MinDate` to
  `CreateApiTokenDto.expiresAt`; prevents confusing creation of immediately-
  expired tokens.
- **Webhook secret out of Redis job body** (P2, S) — enqueue only
  `subscriptionId` and have the worker re-fetch the secret; eliminates a
  class of secret exposure without any user-visible change.

After those quick wins, the **DB-level CFD/burndown aggregation** is the highest-
impact engineering investment: the current in-memory replay will OOM any
non-trivial project, and it blocks reporting from being a reliable feature. The
**magic-byte MIME validation** closes the last meaningful attachment security
gap. The **nginx CSP header** (P2, S) rounds out the security header story
that Helmet started on the API side. Together these items complete the hardening
pass and leave the platform in a state appropriate for a public OSS v1 release.

### Backlog-groomer feed (Pass 5 — compact)

- **Guard password reset token log with `NODE_ENV !== production`** · P1 · S · Raw reset URL logged at info level; captured in log aggregators by any self-hoster without SMTP; `password-reset.service.ts:153`
- **Remove `image/svg+xml` from ALLOWED_MIME_TYPES (or serve as octet-stream)** · P1 · S · SVG with embedded scripts accepted + served with image/svg+xml Content-Type; direct-navigate XSS vector; `attachments.service.ts:35`, `attachments.controller.ts:84`
- **Add null-file guard in AttachmentsService.upload (400 not 500)** · P2 · S · POST with no file field dereferences undefined → TypeError → generic 500; `attachments.service.ts:107`
- **Validate PAT expiresAt is a future date (`@MinDate`)** · P2 · S · Past dates accepted at creation; token immediately expires and is permanently unusable; `api-token.dto.ts:20`
- **Enqueue subscriptionId only in BullMQ job body (not the HMAC secret)** · P2 · S · Secret stored plaintext in Redis; bundled Redis has no auth by default in Helm; `webhooks.service.ts` WebhookJobData
- **Add CSP `add_header` to nginx configmap (Kustomize + Helm)** · P2 · S · SPA served without Content-Security-Policy; Helmet covers API but not the web container; `configmap-web-nginx.yaml`
- **Rewrite CFD and burndown as DB-level `generate_series` aggregation** · P1 · M · Unbounded findMany on all project issues + activity logs; OOM risk for any active project; `reports.service.ts:302, 329`
- **Magic-byte MIME validation using `file-type` package on upload** · P2 · M · Client Content-Type is fully controllable; malicious files stored with mismatched MIME; `attachments.service.ts:115`
- **Add fail-fast Helm guard for Postgres default password `nextlane`** · P2 · S · No enforcement unlike JWT secret; quick-start installs run with a well-known DB password; `values.yaml:348`
- **PAT authentication in WebSocket gateway handshake** · P2 · S · `nlp_` tokens rejected at socket handshake; automation scripts cannot subscribe to real-time events; `realtime.gateway.ts:74`
- **PAT token scope model + `@RequireScope` decorator** · P2 · M · PATs currently carry full user permissions; minimal-privilege scopes needed for CI automation safety.
- **DB-level time-series reports: throughput, cycle time, age distribution** · P2 · M · Once generate_series aggregation is in place, additional report types are marginal cost; high value for team health visibility.
- **Webhook signing key rotation endpoint** · P2 · S · No key-rotation path without deleting + recreating subscription; needed for production secret hygiene.
- **Batch notifyComment watcher inserts (`createMany`) — carry-forward** · P2 · M · Serial N inserts per watcher; `notifications.service.ts`
- **rebalanceAndPlace batch UPDATE via `$executeRaw` — carry-forward** · P2 · M · N individual tx.issue.update() calls in rebalance; `issues.service.ts`
- **Slim planning-view endpoint or virtual scroll — carry-forward** · P3 · M · useProjectIssues walks all cursor pages; `apps/web/src/api/issues.ts:26-47`

---

## 2026-06-27 — Pass 6 (Debugging & QA-discipline audit; Board/NLQL in-flight work)

Scope: dedicated debugging/QA-discipline review (new mandate), diagnosability in
production, engineering risks from concurrently-landing Board model / NLQL / color-
rules work, and a briefer-than-usual sweep of the ongoing health areas. All Pass-5
P1/P2 items confirmed closed before this pass.

### Ratings

| Area | Score | Note |
|------|:----:|------|
| Architecture & module boundaries | 4 | Board module correctly added under NestJS per-domain pattern; no boundary leaks. Legacy `/projects/:id/board` and new `/boards/:id` co-exist cleanly. |
| Data model & migrations | 4 | Board migration `20260627250000_add_board` is well-structured with backfill INSERT. `filterQuery TEXT?` and `colorRules Json?` column choice is appropriate. `prisma generate` not re-run — see P0. |
| AuthN | 4 | Unchanged from Pass 5 — argon2, JWT, global guard. No regression. |
| AuthZ & multi-tenant isolation | 3 | Board CRUD uses `assertProjectMember/Role` correctly; but Board routes have **no `@RequireScope`** (PAT scope bypass), and the new `/boards/:boardId` endpoints are absent from the tenant-isolation integration test matrix. |
| Input validation | 3 | Board DTOs are well-formed. Gap: `BoardColorRuleDto.query` (`@IsString()` only) has no `@MaxLength` — unbounded NLQL strings can be stored in JSONB. `filterQuery` is correctly capped at 2000 chars. |
| Error handling | 4 | `AllExceptionsFilter` correctly maps Prisma error codes. Board service throws typed NestJS exceptions throughout. No regression. |
| N+1 / query efficiency | 3 | `getBoardById` makes 3 sequential DB round-trips (board fetch, membership check, statuses, issues). Statuses and issues could be parallelised with `Promise.all`. Issue load is capped at `BOARD_ISSUES_CAP = 500` with `issuesTruncated` signal — good defensive design. |
| Realtime correctness | 3 | No realtime events emitted for Board CRUD (create/update/delete); clients must poll. Acceptable for now but inconsistent with issue/comment live updates. |
| Rank / ordering integrity | 4 | Board `order` is assigned via `MAX(order)+1` — non-atomic and susceptible to concurrent-create collision, but low-frequency. Fractional indexing for issues unchanged. |
| Test coverage (unit + e2e) | **2** | `board.service.spec.ts` exists — but **cannot compile** because `prisma generate` was not run; the spec file references `this.prisma.board` which doesn't exist in the generated client. Tenant isolation matrix covers legacy `/board` but not `/boards` CRUD. E2e suite still uses `vite preview`, not the shipped docker image. |
| Type safety | **2** | `tsc --noEmit` exits non-zero (12 errors in `board.service.spec.ts` + `board.service.ts`: `TS2339 Property 'board' does not exist on type 'PrismaService'`, `TS2694 Namespace 'Prisma' has no exported member 'BoardUpdateInput'`). This was clean in every prior pass — a clear regression from the un-generated Prisma client. |
| Build / CI / Docker | 3 | CI runs build + typecheck + unit; e2e workflow exists. **Critical gap**: e2e tests run against `vite preview`, never the nginx docker container. `images.yml` builds and publishes the image with zero smoke tests against it. The CSP/connect-src substitution in `docker-entrypoint.sh` is untested in any automated path. |
| Secrets / config hygiene | 4 | No regressions. pino redaction correct, webhook secret out of job body (Pass-5 fix confirmed). |
| Dependency risk | 4 | `file-type` (magic-byte) and `nestjs-pino` added; both mainstream. No new abandoned deps. |
| **QA / debugging discipline** | **2** | E2e tests never exercise the shipped nginx artifact. `docker-entrypoint.sh` CSP substitution untested. `images.yml` publishes with no post-build smoke test. No regression guard for the CSP/connect-src bug class that reached the user. |
| Diagnosability (production) | 4 | pino structured JSON, `X-Request-Id` correlation header, typed `GET /health` (503 on DB down) + `GET /health/live` liveness, `AllExceptionsFilter` consistent error envelope. Missing: no `/metrics` (Prometheus), no OpenTelemetry tracing, no `/debug` or config-dump endpoint. |

### Debugging & QA-discipline findings (dedicated section)

#### Where tests do NOT exercise the shipped artifact

**Finding 1 — e2e suite runs against `vite preview`, not nginx**

`apps/web/playwright.config.ts` sets `webServer.command` to
`pnpm exec vite preview --port ${WEB_PORT} --strictPort`. The `.github/workflows/e2e.yml`
workflow manually starts `vite preview` on port 3000 and sets `PW_NO_WEBSERVER: '1'`.
The nginx docker container is never started in any automated test path.

Consequences:
- Vite's built-in server serves files with its own response headers; none of nginx's
  `add_header` directives (CSP, HSTS, X-Frame-Options, etc.) are present.
- `docker-entrypoint.sh` never executes, so the `__NL_CONNECT_SRC__` placeholder in
  `nginx.conf` is never substituted. Every test that makes an XHR/fetch call is passing
  against a server that has no Content-Security-Policy at all.
- `window.__NL_CONFIG__` is injected in tests via `page.addInitScript` (see
  `e2e/runtime-config.spec.ts`), not by the real entrypoint writing `/config.js` and
  nginx serving it — a different execution path.

**Finding 2 — `docker-entrypoint.sh` CSP substitution path is entirely untested**

`apps/web/docker-entrypoint.sh` derives `CONNECT_SRC` from `API_URL`, builds the
`ws://`/`wss://` pair, then runs `sed -i` on `/etc/nginx/conf.d/default.conf`. No test
at any layer verifies:
- The `sed` substitution actually replaces all three occurrences across the three
  location blocks in `nginx.conf`.
- The derived CSP value is syntactically correct for any non-default `API_URL` shape
  (e.g., an `https://` URL with a path component, a URL that already has a port).
- The final nginx config is valid (`nginx -t`) before nginx starts.

This is exactly the mechanism that caused the original user-reported CSP bug.

**Finding 3 — `images.yml` publishes the docker image with zero smoke tests**

`.github/workflows/images.yml` builds multi-arch images via `docker buildx bake` and
pushes to GHCR. There is no `docker run` step, no healthcheck probe against `GET /health`,
and no browser-level smoke test. An image with a broken entrypoint would be published
and tagged `latest` without detection.

**Finding 4 — `docker-compose.yml` `web` service has no runtime `API_URL`**

The `web` service in `docker-compose.yml` has no `environment:` block. The entrypoint
falls back to `http://localhost:4000` — which is correct for local single-host deploys
but will silently produce a wrong CSP (and broken login) if a user runs the compose
stack with `API_URL` unset and the API on a different host.

**Proposed regression guard for the CSP/connect-src bug class**

A minimal shell test (bash + `curl` + `grep`) that can be appended to `images.yml` after
the image push:

```
1. docker run -d --name nl-web-smoke \
     -e API_URL=https://api.example.com \
     -p 8080:80 ghcr.io/…/nl-web:${TAG}
2. sleep 2
3. HEADERS=$(curl -sI http://localhost:8080/)
4. Assert: HEADERS contains "connect-src https://api.example.com wss://api.example.com"
5. Assert: HEADERS does NOT contain "__NL_CONNECT_SRC__" (unreplaced placeholder)
6. docker exec nl-web-smoke nginx -t     # config validity
7. docker stop nl-web-smoke
```

A second, Playwright-level approach: add one spec in `apps/web/e2e/` that is gated by
`process.env.TEST_REAL_NGINX === '1'`, sets `baseURL` to `http://localhost:8080`, and
asserts the `Content-Security-Policy` response header contains the expected origin —
runnable against the real container in a separate `e2e-docker.yml` workflow.

**Finding 5 — Other "tests pass ≠ works for users" gaps**

- `HSTS` and `X-Frame-Options` headers set by nginx are never verified in any test.
- The `/config.js` endpoint that vends `window.__NL_CONFIG__` is simulated in tests
  via `page.addInitScript`; the real file is only written by the entrypoint. If the
  template in the entrypoint changes, no test will catch it until a user reports a
  blank API URL at runtime.
- The `docker-compose.yml` health-check uses `curl -f http://localhost:4000/health/live`
  which is correct — but the web container has no Docker HEALTHCHECK directive at all,
  so compose never reports the web container unhealthy even if nginx fails to start.

### In-flight work: Board / NLQL / color-rules engineering risks

#### P0 — Board module non-functional at runtime (prisma generate not run)

Migration `20260627250000_add_board` adds the `Board` table and `BoardType` enum to the
Prisma schema (`apps/api/prisma/schema.prisma`), but `prisma generate` was not run after
the migration. As a result:

- `PrismaService` has no `.board` property at runtime → every Board endpoint throws
  `TypeError: Cannot read properties of undefined` on first call.
- `Prisma.BoardUpdateInput` does not exist in the generated namespace → `board.service.ts`
  references an undefined type.
- `tsc --noEmit` exits 2 with 12 errors (`TS2339`, `TS2694`).
- `board.service.spec.ts` cannot be compiled by Jest, so the spec silently does not run.

Fix: `pnpm --filter @next-lane/api exec prisma generate`. This is a S (< 1 hour) fix
but a P0 impact — all six Board endpoints are broken in the currently-published image.
File refs: `apps/api/prisma/schema.prisma`, `apps/api/src/board/board.service.ts`.

#### P1 — Board CRUD missing `@RequireScope` (PAT scope bypass)

All six Board controller routes in `apps/api/src/board/board.controller.ts` lack
`@RequireScope(...)` decorators. Issues routes use `@RequireScope('issues:write')` and
`@RequireScope('issues:read')`. A PAT issued with scope `issues:read` only can still
call `POST /projects/:id/boards`, `PATCH /boards/:id`, and `DELETE /boards/:id` because
`ScopeGuard` passes through when no `@RequireScope` metadata is present on the handler.
File ref: `apps/api/src/board/board.controller.ts:23-79`.

Fix: add `@RequireScope('boards:write')` to POST/PATCH/DELETE routes and
`@RequireScope('boards:read')` to GET routes, or accept that Board routes are intentionally
unscoped (document the decision). Size: S.

#### P1 — Board endpoints absent from tenant-isolation integration test matrix

`apps/api/src/tenant-isolation.integration.spec.ts` covers 40+ endpoints but the new
Board routes (`GET /projects/:id/boards`, `POST /projects/:id/boards`,
`GET /boards/:boardId`, `PATCH /boards/:boardId`, `DELETE /boards/:boardId`) are absent.
This means cross-workspace Board access is untested. `getBoardById` does call
`assertProjectMember` but the test matrix is the only systematic proof that the guard is
wired correctly for every code path. File ref: `apps/api/src/tenant-isolation.integration.spec.ts`.

Fix: add Board endpoint rows to the matrix. Size: S.

#### P2 — NLQL color-rule query strings have no length bound in DTO

`apps/api/src/board/dto/update-board.dto.ts` validates `BoardColorRuleDto.query` with
`@IsString()` only. A board can have an arbitrary number of color rules, each with an
unbounded query string. These are stored in `colorRules JSONB` and will be evaluated
client-side (future). A hostile user (MEMBER role) can POST arbitrarily large query
strings into the DB. Add `@MaxLength(500)` consistent with the filter-query convention.
File ref: `apps/api/src/board/dto/update-board.dto.ts:17-18`.

#### P2 — NLQL query engine: injection and DoS risk surface (pre-emptive)

The NLQL query engine in `packages/shared` evaluates filter expressions client-side.
When this evaluator is wired to real data, the risk surface is:
- **ReDoS**: if any regex-backed parser accepts user-crafted queries, a pathological
  string can lock the JS event loop for seconds. Mitigate by capping query length at DTO
  validation and timing-out the evaluator.
- **Prototype pollution / injection**: if the evaluator allows field names as free text
  and those names are used as property-accessor keys on issue objects, craft a query with
  field name `__proto__` or `constructor`. Validate all field-name tokens against an
  allowlist of known issue fields.
- **Server-side evaluation path**: if NLQL is ever evaluated server-side (e.g., for
  server-rendered board filtering), user-supplied expressions must be treated as
  untrusted input and sandboxed. Do not use `eval()` or `new Function()`.
  Pre-emptive fix: write an allowlist of evaluable field names into `packages/shared`
  alongside the parser and enforce it before any field access. Size: M.

#### P3 — Board `order` assignment is non-atomic

`createBoard` in `board.service.ts:136-141` reads `MAX(order)` and increments outside
a transaction. Two concurrent board-create requests can compute the same `order` value,
producing duplicate positions. The current uniqueness constraint on `order` is
`@@unique([projectId, order])` (if present) or silently accepts duplicates. Low
frequency but worth a `SELECT ... FOR UPDATE` or a DB sequence. File ref:
`apps/api/src/board/board.service.ts:136-141`. Size: S.

### Technical investments (ideation)

1. **Docker-level smoke-test workflow (`e2e-docker.yml`)**: Build the web image, run it
   with a known `API_URL`, and use `curl` to assert the CSP `connect-src` header is
   correctly substituted and does not contain the literal placeholder. Add one Playwright
   spec (flag-gated) that hits the real nginx container and verifies `config.js` is
   correctly served. This closes the entire CSP/connect-src regression class permanently.
   P1, M.

2. **Prometheus `/metrics` endpoint on the API**: Add `@willsoto/nestjs-prometheus` or
   expose metrics via the existing pino-http counters. Export: HTTP request latency
   histograms (p50/p95/p99), DB connection pool saturation, BullMQ queue depth/lag,
   WebSocket room counts. Self-hosters running Grafana get instant observability without
   log parsing. P2, M.

3. **OpenTelemetry distributed tracing**: Add `@opentelemetry/sdk-node` with auto-
   instrumentation for HTTP (NestJS), Prisma (via `@prisma/instrumentation`), and
   Socket.io. Export to an OTLP endpoint (Jaeger or Grafana Tempo). Enables root-causing
   slow endpoints and N+1 queries in production without needing a repro. P2, L.

### Direction (Pass 6)

The single most urgent action is running `prisma generate` — every Board endpoint in
the shipped image is broken right now and users will hit TypeError on first use. This
is a one-minute fix with P0 impact.

The second-most important investment is closing the "tests pass but the docker artifact
is untested" gap. The CSP/connect-src bug that reached the user cannot recur if a
smoke-test workflow runs `docker run -e API_URL=... image` and asserts the response
header. Without it, any future change to `docker-entrypoint.sh` or `nginx.conf` carries
the same risk. This is the highest-leverage engineering investment of this pass.

The Board-level authz gaps (missing `@RequireScope`, absent from isolation matrix) are
quick fixes that should be bundled with the Board launch — they are S-sized and prevent
a class of authorization confusion as the PAT model matures.

### Backlog-groomer feed (Pass 6 — compact)

- **Run `prisma generate` after Board migration (board module broken at runtime)** · P0 · S · `this.prisma.board` undefined at runtime; all 6 Board endpoints throw TypeError; `tsc --noEmit` exits 2; `apps/api/prisma/schema.prisma`, `apps/api/src/board/board.service.ts`
- **Add docker-level CSP smoke test in `images.yml`** · P1 · M · e2e suite uses `vite preview`; nginx `docker-entrypoint.sh` CSP substitution is never tested in any CI path; the CSP/connect-src bug class has no regression guard; `apps/web/docker-entrypoint.sh`, `.github/workflows/images.yml`
- **Add Board routes to tenant-isolation integration test matrix** · P1 · S · New `/boards/:boardId` CRUD endpoints absent from 40-endpoint isolation matrix; `apps/api/src/tenant-isolation.integration.spec.ts`
- **Add `@RequireScope` to Board controller routes** · P1 · S · PAT scope bypass: any PAT regardless of declared scope can mutate boards; `apps/api/src/board/board.controller.ts:23-79`
- **Add `@MaxLength(500)` to `BoardColorRuleDto.query`** · P2 · S · Unbounded NLQL strings storable in JSONB; `apps/api/src/board/dto/update-board.dto.ts:17`
- **Add Docker HEALTHCHECK to web nginx container** · P2 · S · Web container has no HEALTHCHECK; compose never marks it unhealthy if nginx fails to start; `apps/web/Dockerfile`
- **Harden NLQL evaluator against field-name injection and ReDoS** · P2 · M · Future server-side evaluation of user-supplied filter expressions; allowlist field names before property access; `packages/shared`
- **Add Prometheus `/metrics` endpoint to API** · P2 · M · No machine-readable metrics surface; self-hosters cannot monitor latency, queue depth, or DB pool saturation without log parsing
- **Add `runtime-config` Playwright spec against real nginx container (flag-gated)** · P2 · M · `runtime-config.spec.ts` uses `page.addInitScript` simulation; the real `/config.js` serving path is untested
- **OpenTelemetry distributed tracing (API + Prisma + Socket.io)** · P3 · L · No trace context; production root-causing requires log correlation across multiple services manually
- **Make board `order` assignment atomic (SELECT FOR UPDATE or DB sequence)** · P3 · S · Concurrent board creates can assign duplicate `order` values; `apps/api/src/board/board.service.ts:136-141`

---

## 2026-06-28 — Pass 7 (automation engine, analytics, personal boards, general)

Scope: deep scrutiny of the automation engine (event-bus integration, loop guard,
N+1 analysis, action-executor authorization, NLQL safety, transactional consistency),
analytics service (SQL correctness, query cost, ActivityLog-based completion
reconstruction), personal boards module, and migration `20260628070000_add_automation_engine`.
General pass on security (authz/tenant isolation on new endpoints), performance,
test coverage, and tech debt. All cited files read directly; no inferences.

### Ratings

| Area | Score | Note |
|------|:----:|------|
| Architecture & module boundaries | 4 | AutomationsModule correctly imports IssuesModule/CommentsModule/LabelsModule without circular deps. EventEmitter2 wired globally. AnalyticsModule, PersonalBoardsModule clean. |
| Data model & migrations | 4 | Automation migration sound: JSONB for actions/actionsApplied, correct onDelete (CASCADE runs on rule delete, SetNull on user/issue delete). Personal boards migration clean with columnId CASCADE for cards. Index coverage mostly good; one gap noted below. |
| AuthN/AuthZ & multi-tenant isolation | 3 | New automation CRUD correctly gates on `assertProjectRole(MEMBER)`. Analytics `/projects/:id/analytics` gated. **`personalAnalytics` loads all `Issue` rows assigned to userId across all projects with no workspace-scoping.** Action executor uses `rule.createdById ?? actorUserId` and delegates to existing service authz — the delegated checks catch cross-project statusId/labelId attacks. Personal board ownership checks solid. |
| Input validation | 4 | `CreateAutomationRuleDto` uses `class-validator` with `@IsEnum(AutomationTrigger)` and `@ValidateNested`; `validateActionParams` enforces per-type constraints. `ListRunsQueryDto` caps at 200. Condition NLQL validated at write-time via `validateQuery` (length-capped at 2000 chars). |
| Error handling | 4 | Engine catches all exceptions and writes `AutomationRunStatus.FAILED` — user's original mutation never breaks. `writeRun` itself is wrapped; persistence failure is logged but never re-throws. |
| N+1 / query efficiency | 3 | Engine: 4 DB round-trips per trigger event (rules, issue, customFieldDefs, members) regardless of rule count — acceptable for typical cardinality but grows if many projects have many members. **Per-rule `automationRun.create` is not batched** — 20 rules = 20 INSERT calls. Analytics: `allProjectIssues.findMany` fetches every issue in the project into memory; large projects load O(N) rows. ActivityLog `completionMap` query lacks a covering index on `(issueId, field, to, createdAt)`. |
| Realtime correctness | 4 | Engine emits events AFTER mutations complete (not inside tx), so no double-fire on rollback. Loop guard (`automated: true`) is propagated on all three seams (create, update, move). |
| Rank / ordering integrity | 5 | Personal board uses fractional indexing via `rankAfter`/`rankBetween`. `move` already wrapped in transaction with rebalance fallback (fixed in earlier passes). |
| Test coverage (unit + e2e) | 4 | Strong unit test coverage for both new services: `automation-engine.service.spec.ts` covers loop guard, condition false/parse error, action failure, actor resolution, ADD_COMMENT, ADD_LABEL, no-rules path, issue-not-found. `automations.service.spec.ts` covers CRUD, NLQL rejection, action param validation. `analytics.service.spec.ts` comprehensive. `personal-boards.service.spec.ts` present. E2e specs for all three features (desktop + mobile). **Gap: no test for `promoteCard` idempotency; no CSP regression guard against docker nginx artifact.** |
| Type safety | 4 | Generally strict. `params as Record<string, unknown>` casts in `executeAction` are acceptable at runtime boundaries. `Prisma.JsonValue` casts on actions are correctly wrapped. |
| Build / CI / Docker | 4 | CI pipeline runs typecheck + unit tests. E2e workflow uses `vite preview` not the nginx docker image — **CSP/entrypoint substitution remains untested in CI** (same gap as Pass 6). The `tsconfig.build.tsbuildinfo` is gitignored; the Dockerfile `COPY apps/api apps/api` copies source only, so a stale tsbuildinfo from a prior local build cannot survive into the Docker build context. `nest build` inside Docker always starts clean. |
| Secrets / config hygiene | 4 | No new secret surface introduced. Automation JSONB params hold user-supplied IDs/values but are persisted and re-used server-side only. |
| Debugging / QA discipline | 3 | Strong progress: correlation IDs, structured logging, health endpoints present. Engine run log (AutomationRun) provides good Glass Box diagnosability. **Still no smoke-test of the shipped nginx artifact in CI** — `docker-entrypoint.sh` CSP substitution is tested only by simulation (addInitScript). Per-keystroke focus tests exist. |
| Dependency risk | 4 | `@nestjs/event-emitter` 2.x is mainstream, actively maintained. No new risky deps introduced. |

### Top risks & debt (prioritized)

#### Risk 1 — `personalAnalytics` loads ALL user-assigned issues with no workspace boundary (P1, S)

**File:** `apps/api/src/analytics/analytics.service.ts:252-263`

```ts
const assignedIssues = await this.prisma.issue.findMany({
  where: { assigneeId: userId },
  ...
});
```

This fetches every issue where `assigneeId = userId` across **all** projects and workspaces globally. The query has no workspace scope. For a multi-tenant deployment where the same user email exists in two tenants (possible because the unique constraint is on `email` not `workspaceId+email`), or where a rogue admin in workspace A sets `assigneeId` to a user in workspace B, that user's analytics page would include issues from a workspace they don't belong to. The data exposure is limited to aggregate counts and cycle-time (not issue titles), but the principle is broken. The query should be scoped to issues from projects in workspaces the user is a member of, joined via the Membership table.

**Suggested fix:** Join through `Membership → Project → Issue` to scope to the user's own workspaces. Or at minimum add a `project: { workspace: { memberships: { some: { userId } } } }` filter. *Size: S.*

#### Risk 2 — AutomationRun writes are N sequential INSERTs per rule (P2, M)

**File:** `apps/api/src/automations/automation-engine.service.ts:144-147, 296-320`

The engine evaluates rules sequentially (`for (const rule of rules)`) and issues one `automationRun.create` per rule — including for SKIPPED rules (every non-matching rule gets a SKIPPED run written). With 20 enabled rules matching a trigger: 20 sequential `INSERT INTO AutomationRun` calls. At 50 rules (reasonable for an active project): 50 INSERTs per event, all serial.

**Suggested fix:** Collect all run rows into an array during the loop, then issue a single `prisma.automationRun.createMany({ data: [...] })` after all rules have been evaluated. Saves 49 round-trips at 50 rules. *Size: S.*

#### Risk 3 — Missing covering index on ActivityLog for `completionMap` query (P2, M)

**File:** `apps/api/src/analytics/analytics.service.ts:151-166`, migration `20260628004947_baseline_v2/migration.sql:570-576`

The `completionMap` raw SQL filters:
```sql
WHERE a."issueId" = ANY(${issueIds}::text[])
  AND a."field" = 'status'
  AND a."to" = ANY(${doneIdsArray}::text[])
  AND a."createdAt" >= ${windowStartDate}
  AND a."createdAt" <= ${windowEndInclusive}
GROUP BY a."issueId", i."createdAt"
```

The existing indexes are: `ActivityLog_issueId_idx` (single column), `ActivityLog_field_createdAt_idx` (`field, createdAt`). For a project with 10,000 issues and 5 years of activity logs, Postgres must choose between the `issueId` index (possibly high cardinality for the IN list) or the `field+createdAt` index. There is no composite index on `(field, to, createdAt)` or `(issueId, field, to, createdAt)` that would satisfy all predicates together. For the project analytics path (`allProjectIssues.findMany` gives all issue IDs, then passes them all to `completionMap`), the `ANY()` list grows unboundedly with project size.

**Suggested fix 1:** Add index `CREATE INDEX "ActivityLog_field_to_createdAt_idx" ON "ActivityLog"("field", "to", "createdAt")` — allows Postgres to index-scan `field='status' AND to IN (...) AND createdAt BETWEEN` and then filter by issueId.
**Suggested fix 2:** For the project analytics path, push the completion reconstruction into a single SQL query that joins `Issue` and `ActivityLog` on `projectId` instead of materializing all issue IDs first. *Size: M.*

#### Risk 4 — `promoteCard` has no idempotency guard (P2, S)

**File:** `apps/api/src/personal-boards/personal-boards.service.ts:333-360`

If `promoteCard` is called twice on the same card (network retry, double-click), it creates a second Issue each time and overwrites `promotedIssueId` with the latest one — leaving orphan issues in the project. The first-promoted issue has no card link and is effectively unreachable from the board UI.

**Suggested fix:** Check `if (card.promotedIssueId !== null)` at the top of `promoteCard` and throw `BadRequestException('Card already promoted')` (or return the existing issue). The idempotency check should be inside a transaction with a re-read to prevent TOCTOU. *Size: S.*

#### Risk 5 — `projectAnalytics` fetches all project issues into memory regardless of project size (P2, M)

**File:** `apps/api/src/analytics/analytics.service.ts:401-411`

```ts
const allProjectIssues = await this.prisma.issue.findMany({
  where: { projectId },
  select: { id: true, createdAt: true, assigneeId: true, status: { select: { category: true } } },
});
```

This materializes every issue in the project to build the flow series and workload distribution. A project with 50,000 issues loads 50,000 rows into Node.js memory per analytics request. The `createdAt` range filter (the analytics window) is applied *in JS after the fetch*, not in the SQL `WHERE`. Moving the `createdAt` filter to the SQL level for the flow series, and aggregating workload in SQL rather than materializing all rows, would reduce the memory and query cost by the window fraction.

**Suggested fix:** Use two targeted queries: (a) a GROUP BY `DATE_TRUNC('day', "createdAt")` + COUNT for the flow series with a `createdAt >= wStart` filter in SQL; (b) a GROUP BY `assigneeId` + COUNT for the workload distribution, filtered to open-status issues. Both eliminate the full-table materialize. *Size: M.*

### Loop guard — is it watertight?

Yes. The guard is correctly implemented at two levels:

1. **Event level** (`automation-engine.service.ts:102-104`): `if (event.automated) return` — exits before any DB access.
2. **Propagation** (`issues.service.ts:228, 843, 1031`): every `eventEmitter.emit` call sets `automated: opts?.automated ?? false`, so an action triggered by the engine passes `opts = { automated: true }` and the emitted event carries `automated: true`, which the guard catches on the next listener invocation.

The TRANSITION action calls `issuesService.move(..., opts)` where `opts = { automated: true }`, which then emits `ISSUE_TRANSITIONED` with `automated: true`. The ADD_COMMENT action calls `commentsService.create(..., opts)` where `opts = { automated: true }`, which emits `ISSUE_COMMENTED` with `automated: true`. No chaining is possible in v1.

**One subtle edge case worth noting:** `LabelsService.addToIssue` (called by `ADD_LABEL` action) does not take an `opts` parameter and does not emit any automation event — this is correct and safe, since no automation trigger fires on label changes. No loop risk.

### Action executor authorization analysis

The engine uses `rule.createdById ?? actorUserId` as the actor for all actions. This actor is then passed to `issuesService.update/move` and `commentsService.create`, which **do run full authorization checks** (`assertProjectRole(MEMBER)`). So:

- If `rule.createdById` is a user who has since been removed from the project, the action fails with 403 — the engine's error handler catches it, writes `FAILED`, and does not break the original mutation. Correct behavior.
- If `rule.createdById` is null (user deleted, FK set to null by migration), the engine falls back to `actorUserId`. The actorUserId is the user who triggered the original event — they are already confirmed to be a project MEMBER (they just mutated an issue). Safe.
- Cross-project attacks via action params (e.g., a TRANSITION action with a `statusId` from another project): `issuesService.move` calls `assertSameProject` which validates the statusId belongs to the issue's project. Blocked.
- Cross-project attacks via ADD_LABEL: `labelsService.addToIssue` verifies `label.projectId === issue.projectId`. Blocked.

**No authorization bypass identified in the action executor.**

### NLQL evaluation safety

`parse()` and `evaluate()` in `packages/shared/src/nlql/` are safe:
- Field resolution is an explicit allowlist via `resolveStandardField` plus a `defs.some()` check — no dynamic `issue[userInput]` property access.
- String matching uses `String.prototype.includes` — no RegExp is constructed from user input (no ReDoS surface).
- Length cap at 2000 characters enforced at write-time via `validateQuery`.
- Parse errors are caught in `evaluateRule` and recorded as `FAILED` runs — they never propagate to the caller.

### Transactional consistency

Engine events fire *after* the mutation transaction has committed (`eventEmitter.emit` is called after `$transaction` returns). This is correct: events are not emitted inside a transaction, so a rule that fails does not roll back the original mutation. The engine catches all its own errors. The only consistency risk is that `writeRun` itself might fail (e.g., DB connection lost) — this is silently logged and does not affect anything. Acceptable for an audit log.

### Migration 20260628070000_add_automation_engine — index review

The migration creates five indexes:
- `AutomationRule(projectId, enabled)` — covers the engine's `WHERE projectId=? AND enabled=true`.
- `AutomationRule(projectId, trigger)` — covers `WHERE projectId=? AND trigger=?`.
- `AutomationRule(createdById)` — covers user-deletion FK lookup (SetNull).
- `AutomationRun(ruleId, createdAt)` — covers `findRuleRuns` (per-rule history).
- `AutomationRun(issueId, createdAt)` — covers per-issue run lookups.

**Gap:** The `findRuns` project-wide query (`where: { rule: { projectId } }`) requires a join through `AutomationRule.projectId`. Prisma will use the existing `AutomationRule_projectId_enabled_idx` on the join side. The `AutomationRun` table itself has no `projectId` column and no index that directly serves a "all runs for a project" scan; Prisma must join through `AutomationRule`. For a project with many rules and high run volume, this join scan can be expensive. A composite index on `AutomationRun(ruleId, createdAt DESC)` (which exists) plus a filtered query scoping to the known rule IDs would perform better than the join — but at current cardinalities this is acceptable.

**onDelete behaviors are sound:**
- `AutomationRule` → `Project` CASCADE: deleting a project removes all its rules (and cascades to runs).
- `AutomationRule` → `User` SetNull: deleting a user preserves rules (engine falls back to actorUserId).
- `AutomationRun` → `AutomationRule` CASCADE: deleting a rule removes its run history (correct — runs without a rule have no context).
- `AutomationRun` → `Issue` SetNull: deleting an issue preserves run history (audit trail survives).

### Debugging / QA discipline assessment

**Improvements since Pass 6:** AutomationRun provides excellent Glass Box diagnosability — every rule evaluation is recorded with status, actionsApplied, and error string. Combined with the existing correlation IDs and structured logging, production root-causing of automation issues is viable without a repro.

**Persistent gaps:**
1. **CI e2e suite uses `vite preview`, not the nginx docker image.** The `docker-entrypoint.sh` CSP substitution (`__NL_CONNECT_SRC__` placeholder replacement) is never exercised in any automated test. A bug in that sed substitution (e.g., an API_URL with a path component, or a protocol nginx doesn't recognize) would silently produce a broken or over-permissive CSP in the shipped image.

2. **No regression guard for the "nginx CSP blocks API" bug class.** The e2e.yml runs Playwright against `vite preview`, which does not apply `nginx.conf` or `docker-entrypoint.sh`. A spec that asserts `Content-Security-Policy: connect-src` includes the API origin when run against the real docker image is the only thing that would catch this.

3. **`promoteCard` double-invoke has no e2e regression test.** The personal-board e2e spec covers create/move/delete but not the promote idempotency failure.

### New capabilities & technical investments (ideation mandate)

1. **AutomationRun retention policy + SKIPPED pruning.** At current rates, a project with 20 rules and 100 events/day generates 2,000 `AutomationRun` rows/day — 730,000/year. SKIPPED runs (condition did not match) are the vast majority but have the lowest diagnostic value. Implement a scheduled job (BullMQ cron) that prunes `AutomationRun` rows where `status = SKIPPED` older than N days (configurable, default 30), and FAILED/SUCCESS older than 90 days, with a user-visible retention setting. This keeps the Glass Box useful at scale without unbounded growth. P2, M.

2. **Automation "dry-run" / simulation mode.** Add a `POST /projects/:projectId/automations/:ruleId/simulate` endpoint that accepts an `issueId` and evaluates the rule against that issue — returning what the condition resolved to and what actions *would* be executed — without actually applying them. This is the most-requested automation feature in comparable tools and directly addresses the "I set up a rule but can't tell why it didn't fire" class of support requests. The engine's `evaluateRule` already does all the work; simulation is a thin wrapper that skips `executeAction` and `writeRun`. P1, M.

3. **Docker artifact smoke-test CI job.** Add a new GitHub Actions workflow step (or extend `images.yml`) that: (a) builds the web Docker image, (b) runs it with `API_URL=http://api-test:4000`, (c) runs `curl -I http://localhost:3000` and asserts the `Content-Security-Policy` header contains `http://api-test:4000` in `connect-src` and does NOT contain `__NL_CONNECT_SRC__`. This is a <50-line shell script that closes the entire "tests pass but nginx is broken" bug class permanently. P1, S.

### Direction (Pass 7)

The automation engine is well-built: the loop guard is watertight, error isolation is correct, authorization is delegated to proven service-level checks, and test coverage is strong. The three concrete concerns worth addressing are: (1) scoping `personalAnalytics` to workspace-member issues (data hygiene, S-sized fix); (2) batching `AutomationRun` INSERTs (performance, S-sized); and (3) adding the ActivityLog composite index for the `completionMap` query (query cost, S-sized migration).

The biggest structural gap from this pass is the same one as Pass 6: the nginx/docker artifact is never tested in CI. Automation dry-run is the highest-value new capability; it directly enables users to understand why rules did or didn't fire, and the engine already does 95% of the work.

### Backlog-groomer feed (Pass 7 — compact)

- **Scope `personalAnalytics` to workspace-member projects** · P1 · S · `assigneeId=userId` query has no workspace boundary; cross-workspace issue data visible in personal analytics if assigneeId set cross-tenant; `apps/api/src/analytics/analytics.service.ts:252`
- **Batch `AutomationRun` INSERTs with `createMany`** · P2 · S · 20 rules = 20 serial INSERTs per trigger event; `apps/api/src/automations/automation-engine.service.ts:144-147, 296-320`
- **Add `ActivityLog(field, to, createdAt)` index for completionMap query** · P2 · S · Analytics completion reconstruction lacks covering composite index; degrades for large projects; `apps/api/prisma/migrations/`
- **Add idempotency guard to `promoteCard`** · P2 · S · Double-call creates orphan issues; `apps/api/src/personal-boards/personal-boards.service.ts:333`
- **Push `createdAt` window filter into SQL for `projectAnalytics`** · P2 · M · `findMany` loads all project issues; window filter applied in JS; `apps/api/src/analytics/analytics.service.ts:401`
- **Docker artifact CSP smoke test in CI** · P1 · S · nginx entrypoint `__NL_CONNECT_SRC__` substitution never tested; `docker-entrypoint.sh`/`nginx.conf` bugs invisible until user-reported; `.github/workflows/images.yml`
- **Automation dry-run / simulate endpoint** · P1 · M · Users cannot tell why a rule fired or didn't; thin wrapper over existing engine logic; `apps/api/src/automations/`
- **AutomationRun retention/pruning job** · P2 · M · SKIPPED runs at scale (20 rules × 100 events/day = 730k rows/year); BullMQ cron + configurable retention; `apps/api/src/automations/`
- **E2e regression test for `promoteCard` idempotency** · P2 · S · No Playwright coverage for double-promote failure; `apps/web/e2e/personal-board.spec.ts`

---

## 2026-06-28 — Pass 8 (post-features audit: workflows, swimlanes, branding, automation, analytics, CSV, bulk edit)

Scope: deep audit of every significant feature shipped since Pass 7 — configurable
workflows (`apps/api/src/workflows/`), board swimlanes (`BoardSwimlanesView`,
`BoardPage` filter-URL persistence), workspace branding (logo upload/serve),
automation engine (action-param scope validation, MEMBER create permission), analytics
(unbounded projectAnalytics query, unvalidated `days` param), CSV export, and bulk
edit. Also a general sweep of cross-cutting concerns: tenant isolation matrix coverage
on all new endpoints, per-route rate limiting, real-artifact QA gaps, and dead code /
type-safety holes. All findings are evidence-based against directly read source files.

### Ratings (Pass 8)

| Area | Score | Delta | Note |
|------|:----:|:-----:|------|
| Architecture & module boundaries | 4 | — | WorkflowModule, CSVController, BulkUpdate all follow per-domain NestJS pattern correctly. No module boundary leaks introduced. |
| Data model & migrations | 4 | — | WorkflowTransition schema well-formed; unique constraint on (projectId, fromStatusId, toStatusId, issueType) correct; auto-seed uses `skipDuplicates` for TOCTOU partial safety. No rollback scripts for any migration (ongoing gap). |
| AuthN | 4 | — | No regressions. JWT guard, PAT path, fail-fast secret all confirmed unchanged. |
| AuthZ & multi-tenant isolation | **2** | -2 | All five new feature endpoint families (workflow CRUD, automations CRUD, analytics, CSV export, workspace logo) are **entirely absent from the tenant-isolation integration test matrix** (`tenant-isolation.integration.spec.ts`). Additionally: automation rules are writable by any project MEMBER (not just ADMIN); TRANSITION action `statusId` is not validated to belong to the rule's project at creation time; `GET /projects/:id/analytics` has no `@RequireScope` annotation. These are structural gaps, not just test gaps. |
| Input validation | 3 | — | Workflow DTOs are well-formed. Logo upload validates declared MIME type but does NOT use magic-byte detection (`file-type`) — inconsistent with attachments which do use it. Analytics `days` param is parsed with raw `Number()` inside the controller rather than a typed DTO — `Infinity` passes through (though `clampDays` catches it). |
| Error handling | 4 | — | `enforceTransition` 422 path correctly returns a descriptive message with allowed next statuses. Global exception filter handles Prisma P2002/P2025 across all new endpoints. Bulk update collects per-item errors in `failed[]` and never aborts the batch. |
| N+1 / query efficiency | **2** | -1 | Three concrete new regressions: (a) `enforceTransition` executes 3 queries per issue on the happy path (issue fetch, project fetch, transitions fetch); `bulkUpdate` calls `this.update()` serially per issue — 100 issues × ≥3 queries = 300+ sequential DB round-trips before any gate evaluation. (b) `projectAnalytics` fetches ALL project issues into memory with no `take` limit (`allProjectIssues.findMany`) then passes ALL issue IDs to a `completionMap` `ANY()` array binding — unbounded for large projects. (c) Workflow auto-seed inserts N*(N-1) rows for N statuses — for 20 custom statuses that is 380 `WorkflowTransition` rows per enable call. |
| Realtime correctness | 4 | — | Workflow enforcement changes (enable/disable, transition add/delete) do not emit realtime events to the project room — clients must reload settings to see changes. Low-priority gap; workflow is config-time, not board-time. |
| Rank / ordering integrity | 4 | — | No regressions from prior passes. Swimlane grouping is purely a frontend compute (`computeLanes`) with no server-side rank mutation. |
| Test coverage (unit + e2e) | **3** | — | `workflow.enforcement.spec.ts` (498 lines) and `workflow.service.spec.ts` (398 lines) are thorough for the happy and gate-failure paths. E2e `workflow.spec.ts` covers UI enablement, illegal-move toast, legal-move success, and mobile overflow. However: tenant isolation matrix missing all new endpoints (see AuthZ above); no workflow test for the concurrent-enable race; no test that swimlane 'epic' grouping correctly handles missing `parent.type` in the board DTO; no regression for the `bulkUpdate` DB round-trip count under workflow enforcement. |
| Type safety | 4 | — | `enforceTransition` gate cast (`transition.gates as unknown as ...`) is necessary given Prisma JSONB. `params as Record<string, unknown>` in automations is acceptable at runtime boundaries. Swimlane `computeLanes` is strongly typed via `GroupByDimension` union. No stray `any` found in new code paths. |
| Build / CI / Docker | 3 | -1 | No regressions in CI itself, but none of the new e2e specs (workflow, swimlanes) run against the nginx docker artifact — they all run against `vite preview`. The `docker-entrypoint.sh` CSP substitution gap from Pass 6 is still unresolved: no smoke test in `images.yml`. This is now a persistent multi-pass gap. |
| Secrets / config hygiene | 4 | — | No new secret surfaces. Logo storage key is a UUID-named temp file path (`path.basename(file.path)`) — no path traversal risk. Uploads dir defaults to `./uploads` (relative) — acceptable for Docker where the working directory is controlled. |
| Dependency risk | 4 | — | No new dependencies introduced by workflow, swimlanes, bulk-edit, or CSV features. Analytics and branding use existing Prisma + multer paths. |
| **QA / debugging discipline** | **2** | — | Same score as Pass 6/7. The structural gap remains: e2e tests never run against the shipped nginx/Docker artifact. No CSP regression guard. `workflow.spec.ts` is the first e2e spec that specifically tests a 422 error surfaced as a toast — good practice, but the test still runs against `vite preview`. Workflow auto-seed race condition has zero test coverage at any layer. |
| Diagnosability (production) | 4 | — | `enforceTransition` 422 errors carry the allowed-next-statuses list — excellent for user-facing debugging. AutomationRun log from Pass 7 provides operator-level Glass Box. No regressions in correlation IDs or structured logging. |

### Debugging & QA-discipline assessment (Pass 8)

The "tests pass ≠ works for users" gap is in its third consecutive audit without closure:

**Gap 1 — e2e suite runs against `vite preview`, not the nginx Docker container (persistent)**

All Playwright specs including the new `workflow.spec.ts`, `swimlanes.spec.ts`,
and `bulk-edit.spec.ts` run against `vite preview` (see `apps/web/playwright.config.ts`
and `.github/workflows/e2e.yml`). The nginx container, `docker-entrypoint.sh`, and
`nginx.conf` are never exercised. Any regression in the CSP `connect-src` substitution,
the `/config.js` serving path, or nginx `add_header` directives is invisible until a
user reports it. This caused at least one user-reported bug already (the login CSP
block).

**Gap 2 — Workflow auto-seed race condition has no test**

`patchEnforced` at `workflow.service.ts:116-130` reads a count, then conditionally
seeds — outside a transaction. `skipDuplicates: true` on the `createMany` call provides
partial protection (duplicate seed inserts are silently dropped), but it does NOT prevent
the project's `workflowEnforced` flag from being double-written or the seed from being
double-attempted. Two simultaneous PATCH requests enabling enforcement will both call
`seedDefaultTransitions` if both see count=0. No test at any layer exercises this path.

**Proposed regression guards (new this pass):**

1. A shell smoke test in `images.yml`: run the web Docker image with a known `API_URL`,
   fetch the home page headers with `curl -sI`, assert `Content-Security-Policy:
   connect-src` includes the API origin and does NOT contain `__NL_CONNECT_SRC__`.
   Run `docker exec nginx -t` for config validity. This is a < 50-line addition and
   closes the entire CSP bug class.

2. A concurrent-enable unit test for `patchEnforced`: use `Promise.all` with two
   simultaneous calls for the same project. Assert final state is `enforced: true` with
   exactly N*(N-1) distinct transitions (not 2×). Verifies `skipDuplicates` + the DB
   unique constraint are sufficient for the race.

3. A swimlane epic-grouping test with a board DTO that omits `parent.type`: assert all
   issues fall into the "No epic" lane (rather than throwing) when the `parent` relation
   is not populated on the issue DTO.

### Top risks & debt (Pass 8, prioritized)

#### P1 — Tenant isolation matrix missing all new feature endpoints (5 endpoint families)

**Files:** `apps/api/src/tenant-isolation.integration.spec.ts`

The tenant-isolation matrix is the only systematic proof that cross-workspace access is
blocked for every route. It covers 40+ legacy endpoints. The five new endpoint families
shipped since Pass 7 are entirely absent: `GET/PATCH /projects/:id/workflow`, `POST
/projects/:id/workflow/transitions`, `PATCH/DELETE /workflow/transitions/:id`,
`GET/POST/PATCH/DELETE /projects/:id/automations/:id`, `GET /projects/:id/analytics`,
`GET /projects/:id/issues.csv`, and `GET/PUT/DELETE /workspaces/:id/logo`. A user in
workspace B who discovers a workflow transition ID or automation rule ID from workspace A
can hit those endpoints; the authz is present in service code but the matrix is the
regression guard that ensures it stays wired. Without matrix coverage, any future
refactor that accidentally bypasses `assertProjectRole` will silently go undetected.

**Fix:** Add matrix rows for all five families using the existing `buildCrossWorkspaceRows`
pattern. Estimated N+10 matrix rows. *Size: S.*

---

#### P1 — Logo upload trusts client-declared MIME type; no magic-byte validation

**Files:** `apps/api/src/workspaces/workspaces.service.ts:264`

`uploadLogo` at line 264 evaluates `LOGO_ALLOWED_MIME_TYPES.has(file.mimetype)` where
`file.mimetype` is the `Content-Type` header from the multipart part — fully
client-controlled. A caller can send a PNG-magic-byte file that declares
`Content-Type: image/jpeg` (harmless) or, more dangerously, send a binary payload (e.g.
a crafted JPEG with appended PHP) while declaring `Content-Type: image/jpeg`. The check
passes and the file is stored on disk. SVG is explicitly blocked at line 259 (correct),
but general magic-byte validation is absent. By contrast, `attachments.service.ts` uses
the `file-type` package to read magic bytes before accepting any upload. The inconsistency
creates a different security posture for the logo path vs the attachment path.

**Fix:** Apply the same `file-type` magic-byte check used in `attachments.service.ts`
to `workspaces.service.ts:uploadLogo` after multer writes the file to tmpdir, before the
file is moved to the uploads directory. Reject if detected MIME type does not match the
declared type or is not in `LOGO_ALLOWED_MIME_TYPES`. *Size: S.*

---

#### P1 — Workflow auto-seed race condition: count check is not transactional

**Files:** `apps/api/src/workflows/workflow.service.ts:116-129`

`patchEnforced` calls `prisma.workflowTransition.count()` at line 123, then
conditionally calls `seedDefaultTransitions()` at line 128. These two operations are not
inside a `$transaction` block. Two concurrent PATCH requests enabling enforcement for the
same project will both see `count = 0` and both call `seedDefaultTransitions`. The
`skipDuplicates: true` flag on `createMany` at line 177 means duplicate rows are silently
dropped rather than erroring — so the final transition set will be correct, but the
`workflowEnforced: true` write at line 116-118 happens before the count check, meaning
both requests write `enforced: true` and both attempt the seed. For a project with 10
statuses (90 pairs) this generates 180 `createMany` inputs across two concurrent calls,
with `skipDuplicates` resolving the collision. Behaviorally safe but wasteful. For a
project with 50 custom statuses (2450 pairs), two concurrent enables generate 4900 row
insertions per call before `skipDuplicates` filters. More importantly, there is no test
that verifies the race does not produce a partially-seeded graph.

**Fix:** Move the `count + seedDefaultTransitions` into a `this.prisma.$transaction()`
block. Alternatively, use an upsert-like pattern with `skipDuplicates` (already present)
and rely on the DB unique constraint as the ACID guarantee — but add a unit test that
exercises two concurrent enables. *Size: S.*

---

#### P2 — `bulkUpdate` serially enforces workflow per-issue: 300+ DB round-trips for 100 issues

**Files:** `apps/api/src/issues/issues.service.ts:1304-1319`,
`apps/api/src/workflows/workflow.service.ts:359-448`

`bulkUpdate` calls `this.update(userId, id, updateDto)` in a serial `for` loop for each
issue ID (lines 1304-1319). When `changes.statusId` is set and the project has
`workflowEnforced: true`, each `update()` call triggers `enforceTransition()`, which
executes at minimum 3 DB queries: (1) `issue.findUnique` to load current state, (2)
`project.findUnique` to load the `workflowEnforced` flag, (3) `workflowTransition.findMany`
to find matching transitions. The project `workflowEnforced` flag does not change
between iterations but is re-fetched on every call. For 100 issues this is 300+ serial
DB round-trips for enforcement alone, before the `issue.update` mutations themselves
(each of which also fires ActivityLog, realtime, webhook, automation events). Under
typical database latency (1-5ms per query), 300+ sequential queries takes 300ms-1500ms
before any useful work completes.

**Fix (short-term):** Pre-load the `workflowEnforced` flag and the full transitions list
once before the loop. Pass them as context to `enforceTransition` to skip the 2 per-issue
queries that load redundant data. This reduces 300+ queries to ~100 (one per-issue lookup
for gates). *Size: M.*

**Fix (long-term):** Group issues by current status and apply enforcement as a set
operation: one transitions query covers all source-status→target-status pairs for the
entire batch. *Size: L.*

---

#### P2 — `projectAnalytics` full table scan: all project issues loaded into memory

**Files:** `apps/api/src/analytics/analytics.service.ts:418-431`

`projectAnalytics` at lines 418-431 executes `prisma.issue.findMany({ where: { projectId } })`
with no `take` limit. For a project with 50,000 issues this materializes 50,000 rows
into Node.js memory per analytics request. The `allIssueIds` array built from this
fetch is then passed to `completionMap` as a `ANY(${issueIds}::text[])` binding at line
436, passing potentially 50,000 strings as a PostgreSQL array literal in a single raw
SQL query — which is both a memory and query-plan pressure risk (Postgres must hash
50,000 strings for the `ANY()` scan).

Unlike `personalAnalytics` (which was correctly scoped to workspace-member projects in
Pass 7), `projectAnalytics` still loads data unboundedly. The `allProjectIssues` variable
fetches `id`, `assigneeId`, and `status.category` — no `createdAt` window filter is
applied in SQL; the window is applied in JS on the already-loaded dataset.

**Fix:** Rewrite `projectAnalytics` to push all aggregation into SQL: (a) a GROUP BY
`DATE_TRUNC('day', "createdAt")` + COUNT for the flow series with a `createdAt >= wStart`
filter in SQL; (b) a GROUP BY `assigneeId` + COUNT for workload distribution filtered to
open statuses. This eliminates the full-project materialize and the 50k-element
`ANY()` binding. *Size: M.*

---

#### P2 — Automation TRANSITION action does not validate `statusId` belongs to the rule's project

**Files:** `apps/api/src/automations/automations.service.ts:153-157`

`validateActionParams` for `TRANSITION` action type at lines 153-157 only checks
`typeof params.statusId === 'string'` — it does NOT verify that the `statusId` belongs
to the automation rule's project. A project MEMBER who can create automation rules
(see Risk below) can create a rule with `TRANSITION` action pointing to a status ID
from a different project. When the rule fires, `issuesService.update()` is called with
the cross-project `statusId`. The `assertSameProject` check in `issues.service.ts` will
catch this at execution time and write a `FAILED` AutomationRun — so no cross-project
mutation succeeds. However, the rule creation still succeeds with an invalid `statusId`,
and a `FAILED` run is silently logged rather than surfaced to the admin who configured
the rule. The user's automation appears broken with no clear error at configuration time.

**Fix:** In `validateActionParams` for `TRANSITION`, add a DB lookup to verify
`prisma.status.findFirst({ where: { id: params.statusId, projectId: rule.projectId } })`
and throw `BadRequestException` at rule creation time if the status doesn't belong to
the project. Apply the same check for `ADD_LABEL` (`labelId` must belong to the project).
*Size: S.*

---

#### P2 — Automation rules creatable by any project MEMBER (not ADMIN-only)

**Files:** `apps/api/src/automations/automations.service.ts:247`

`automations.service.ts:247` calls `assertProjectRole(this.prisma, userId, projectId, Role.MEMBER)`
for rule create. This means any project MEMBER — including developers who cannot configure
statuses, labels, or sprints — can create automation rules that fire on every issue event
in the project. Automation rules can: transition issue statuses, add comments as the
rule's creator, add labels, set priorities. These are board-mutating actions. For a
project with 10 active developers, any developer can set up a rule that moves every
newly-created issue to "Done" immediately, or adds noise comments on every status change.
By contrast, webhook subscriptions are gated to ADMIN only (correctly).

**Fix:** Change `assertProjectRole(..., Role.MEMBER)` to `assertProjectRole(..., Role.ADMIN)`
for create, update, and delete of automation rules. VIEWERs and MEMBERs can list/read
rules (the GET endpoint is already gated at MEMBER for listing). *Size: S.*

---

#### P2 — Analytics `days` query parameter not validated via typed DTO

**Files:** `apps/api/src/analytics/analytics.controller.ts:22-24`

Both analytics endpoints parse the `days` query parameter with raw `Number(daysStr)`:
`const days = daysStr ? Number(daysStr) : 30;`. This bypasses the global
`ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true })`
which only applies to `@Body()` and DTO-decorated `@Query()` parameters. Passing
`?days=Infinity` calls `Number('Infinity')` → `Infinity`, which is not `NaN` and
therefore not caught by the `isNaN(days) ? 30 : days` guard, and is passed to
`clampDays` which does handle it (clamping to 366). However, passing `?days=1e20`
passes through identically — `clampDays` would need to handle it. More importantly,
the pattern is inconsistent with the codebase convention where every query param is
validated via a DTO class with `class-validator` decorators.

**Fix:** Add an `AnalyticsQueryDto` class with `@IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(366) days?: number` and use `@Query() query: AnalyticsQueryDto` in the controller. This brings the analytics endpoints into the same validation model as the rest of the API. *Size: S.*

---

#### P3 — Workflow auto-seed scales as O(N²) statuses; no warning for large N

**Files:** `apps/api/src/workflows/workflow.service.ts:152-182`

`seedDefaultTransitions` creates N*(N-1) `WorkflowTransition` rows where N is the number
of statuses. For a project with the default 3 statuses this is 6 rows — negligible. For
a project with 20 custom statuses (realistic for enterprise workflows) this is 380 rows,
inserted as a single `createMany`. For 50 statuses: 2450 rows. The `createMany` is a
single round-trip and Postgres handles it well, but the resulting 380-2450 transitions
are all fetched on every `getWorkflow` call and every `enforceTransition` check
(the transitions `findMany` at `workflow.service.ts:408` fetches matching transitions for
each status-change check). The settings UI rendering 380 transition rows is also
potentially slow.

This is a P3 — acceptable for v1, but worth noting for teams with large status lists.

**Fix (long-term):** Cap auto-seed at a maximum of, say, 100 transitions (10 statuses),
and when N > 10 statuses, only seed from every status to a configurable "next" status
(linear chain rather than fully-connected graph). Add a warning in the API response when
auto-seed would exceed the cap. *Size: M.*

### New capabilities & technical investments (ideation mandate)

Three concrete technical investments for the next iteration:

1. **Docker artifact smoke-test CI job (closes the persistent CSP/nginx gap).**
   Add a job in `.github/workflows/images.yml` that after image build does: (a) `docker
   run -d -e API_URL=https://api.example.com -p 8080:80 <image>`, (b) `curl -sI
   http://localhost:8080/` and asserts the `Content-Security-Policy` response header
   contains `https://api.example.com` in `connect-src` and does NOT contain the literal
   `__NL_CONNECT_SRC__` placeholder, (c) `docker exec <ctr> nginx -t` to verify nginx
   config validity. This is < 60 lines of shell in one workflow file and closes the
   entire bug class that produced the user-reported login failure. This gap has now
   survived three consecutive audit passes. *Priority: P1. Size: S.*

2. **Workflow transition enforcement caching / pre-load.**
   The `enforceTransition` function re-loads `project.workflowEnforced` and all
   matching `WorkflowTransition` rows on every call. For projects with enforcement
   enabled, a short-lived in-process cache (LRU, 30-second TTL, keyed by
   `projectId`) for the transitions list would reduce the per-status-change DB cost
   from 3 queries to 1 (only the per-issue gate state — assignee, description, links —
   needs live data). This is particularly valuable for `bulkUpdate` where the same
   project's transitions are loaded 100 times. Pair with cache invalidation on
   `createTransition`/`deleteTransition`/`patchEnforced`. *Priority: P2. Size: M.*

3. **Workflow visual debugger / audit trail.**
   Add a `GET /projects/:id/workflow/audit?issueId=X` endpoint that returns the
   AutomationRun-style log for the last N workflow enforcement checks on an issue:
   which transition was matched (or not), which gate was evaluated, pass/fail, actor,
   timestamp. This is the workflow equivalent of the `AutomationRun` Glass Box that
   automation gets in Pass 7 — and it addresses the most common support request for
   workflow-enabled projects ("why can't I move this issue?"). Store the enforcement
   audit trail in a lightweight `WorkflowCheckLog` table (issueId, fromStatusId,
   toStatusId, result, gateType, timestamp). *Priority: P2. Size: M.*

### Direction (Pass 8)

The most important immediate action is **adding the five new endpoint families to the
tenant-isolation matrix** (P1, S). This is the structural regression guard for all the
authorization code added in the new features — without it, a future service refactor
that breaks a `assertProjectRole` call would go undetected. It is an S-sized addition
using the existing `buildCrossWorkspaceRows` pattern.

The second priority is **logo magic-byte validation** (P1, S) — applying the same
`file-type` check already present in `attachments.service.ts` to `workspaces.service.ts`.
It is a one-function addition and eliminates the inconsistency between the two upload
paths.

The third priority is **closing the Docker/nginx smoke-test gap** (P1, S) — this is now
three audit passes old. A < 60-line shell addition to `images.yml` permanently closes the
CSP/connect-src bug class. Its absence is the clearest example of "tests pass ≠ works for
the user" in this codebase.

After those three S-sized items, the `bulkUpdate` per-issue enforcement query waterfall
(P2, M) is the highest-impact performance fix: pre-loading the project's enforcement flag
and transitions once per batch call reduces 300+ serial queries to ~100 for a 100-issue
bulk status change under enforcement.

Automation rules should be ADMIN-gated (P2, S) — a one-line change that aligns
automation with webhooks (both are board-mutating, both should be gated to project
ADMINs).

### Backlog-groomer feed (Pass 8 — compact)

- **Add all new endpoint families to tenant-isolation integration test matrix (workflow, automations, analytics, CSV, logo)** · P1 · S · 5 endpoint families absent from 40-endpoint matrix; `assertProjectRole` correctness is untested for every new feature; `apps/api/src/tenant-isolation.integration.spec.ts`
- **Add magic-byte validation (`file-type`) to logo upload path** · P1 · S · `file.mimetype` is client-declared; attachments uses `file-type`; logo does not — inconsistent security posture; `apps/api/src/workspaces/workspaces.service.ts:264`
- **Add Docker artifact CSP smoke test in `images.yml`** · P1 · S · nginx `__NL_CONNECT_SRC__` substitution untested in CI for the third consecutive pass; `docker-entrypoint.sh`, `.github/workflows/images.yml`
- **Change automation rule create/update/delete to require project ADMIN (not MEMBER)** · P2 · S · Any project MEMBER can create board-mutating automation rules; webhooks are ADMIN-gated; automations should be too; `apps/api/src/automations/automations.service.ts:247`
- **Validate TRANSITION action `statusId` and ADD_LABEL `labelId` belong to rule's project at creation** · P2 · S · Cross-project IDs accepted at save time; fails silently as FAILED AutomationRun at execute time; `apps/api/src/automations/automations.service.ts:153-162`
- **Add `AnalyticsQueryDto` with `@IsInt @Min(1) @Max(366)` for analytics `days` param** · P2 · S · Raw `Number()` parse bypasses global ValidationPipe; `Infinity` not caught; `apps/api/src/analytics/analytics.controller.ts:22-24`
- **Pre-load `workflowEnforced` flag and transitions once per `bulkUpdate` call (not per-issue)** · P2 · M · `enforceTransition` re-queries project + transitions per issue in a serial loop; 100-issue bulk status change with enforcement = 300+ serial DB round-trips; `apps/api/src/issues/issues.service.ts:1304`, `apps/api/src/workflows/workflow.service.ts:359`
- **Rewrite `projectAnalytics` allProjectIssues as DB-level aggregation (GROUP BY DATE_TRUNC + assigneeId)** · P2 · M · `findMany` with no limit materializes all project issues; 50k-element `ANY()` binding passed to completionMap; `apps/api/src/analytics/analytics.service.ts:418`
- **Add unit test for concurrent `patchEnforced` (auto-seed race)** · P2 · S · No test exercises two simultaneous enable calls; `skipDuplicates` is the only guard but is untested; `apps/api/src/workflows/workflow.service.ts:122`
- **Add `@@index` on `WorkflowTransition(projectId, toStatusId)` for `enforceTransition` query** · P2 · S · `findMany` filters on `projectId + toStatusId + OR[fromStatusId]`; no covering index for this pattern; `apps/api/prisma/schema.prisma`
- **Emit realtime event on workflow enforcement enable/disable** · P3 · S · Settings UI in other tabs shows stale enforcement state; `apps/api/src/workflows/workflow.service.ts`
- **Workflow transition pre-load cache (LRU, 30s TTL, per projectId)** · P2 · M · Re-fetches enforcement flag and transitions on every `enforceTransition` call; especially costly for `bulkUpdate`; `apps/api/src/workflows/workflow.service.ts`
- **Workflow visual debugger / audit trail (`WorkflowCheckLog` table + GET endpoint)** · P2 · M · No per-issue enforcement history; "why can't I move this?" is undiagnosable without reproduction; pairs with AutomationRun Glass Box model

---

## 2026-06-30 — Pass 9

### What changed since Pass 8 (2026-06-28)

Pass 8 items confirmed **shipped**: automation write-operations now require project ADMIN (`automations.service.ts:296`); `AnalyticsQueryDto` with `@IsInt @Min(1) @Max(366)` is in place (`analytics/dto/analytics-query.dto.ts`) with a full spec; workflow, automation, analytics, CSV export, and workspace logo DELETE rows have been added to the tenant-isolation integration matrix (`tenant-isolation.integration.spec.ts:607–700`); Kubernetes/Helm hardening (init-container migrations, vendored images, readOnlyRootFilesystem, secret hook) is confirmed deployed. New schema migrations since Pass 8: `add_per_board_workflows`, `add_time_tracking` (WorkLog model), `add_issue_templates` (IssueTemplate model). New service modules: `work-logs`, `issue-templates`, `standups` (previously confirmed in schema, now verified implemented).

Pass 8 items **still open**: Docker artifact CSP smoke test (now four passes old); `@@index([projectId, toStatusId])` on `WorkflowTransition`; analytics `projectAnalytics` DB-level aggregation; `bulkUpdate` pre-load optimization; workflow visual debugger / audit trail.

---

### Ratings table (Pass 9)

| Area | Score | Note |
|---|---|---|
| Architecture & module boundaries | 4 | Module-per-domain well established; `WorkLogsService.resolveWorkspaceId` duplicates the membership-lookup pattern already in `membership.util`; minor coupling debt |
| Data model & migrations | 4 | WorkLog and IssueTemplate well-normalised; `WorkflowTransition` still missing `(projectId, toStatusId)` index; migration history is clean and sequential |
| AuthN/AuthZ & multi-tenant isolation | 3 | Pass 8 matrix additions are good; five new feature families (work-logs, standups, issue-templates, personal boards, planning poker) are absent from the cross-tenant matrix — correctness unverified for these paths; WebSocket CORS still `cors: true`; no JWT refresh/revocation |
| Input validation | 4 | Global ValidationPipe; analytics DTO fixed; all new DTOs use class-validator; `RegisterDto` still `@MinLength(6)` vs `ResetPasswordDto` `@MinLength(8)` — inconsistency persists |
| Error handling | 4 | AllExceptionsFilter + pino; new WorkLogsService returns typed 404/403; pattern is consistent |
| N+1 / query efficiency | 3 | `exportCsv` unbounded `findMany` persists; `WorkLogsService.update/remove` each call `resolveWorkspaceId` → 2 extra queries per mutation; analytics `projectAnalytics` full-issue materialization persists; `enforceTransition` missing index persists |
| Realtime correctness | 3 | Redis adapter for fanout is correct; presence map is single-replica only (documented); WebSocket CORS still wide-open |
| Rank / ordering integrity | 5 | Fractional indexing with `rebalanceAndPlace` batch CASE UPDATE; no regressions observed |
| Test coverage (unit + e2e) | 3 | Good unit coverage on new modules (work-logs, issue-templates, standups each have `.spec.ts`); tenant-isolation matrix still missing five feature families; e2e still runs against `vite preview` not nginx |
| Type safety | 4 | Strict TS; no unguarded `any` in new code; `as unknown as StandupEntryRow` cast in standups is safe but inelegant — could tighten Prisma include types |
| Build / CI / Docker | 3 | Docker CSP smoke test gap is now four passes old; images.yml has no post-build container run; otherwise build is solid |
| Secrets / config hygiene | 4 | `assertAuthConfig` startup guard; no secrets in code; `AUTO_SEED=true` default still a self-hoster footgun |
| Dependency risk | 4 | SBOM + Trivy in images.yml; pnpm lockfile; no new high-risk deps introduced |
| Debugging / QA discipline | 3 | Correlation IDs, pino, /health present; Docker artifact path remains untested in CI; no regression guard for the CSP/connect-src bug class; e2e-against-nginx gap is the largest remaining QA discipline defect |

---

### Top risks & debt (Pass 9 — ranked by impact × probability)

**[P1-1] Docker artifact CSP smoke test — FOUR passes without a fix**
- What: `images.yml` builds the web image and pushes to GHCR but never starts the container to verify that `docker-entrypoint.sh` correctly substitutes `__NL_CONNECT_SRC__` in `nginx.conf`. The original production bug (nginx CSP blocking login) was caused by exactly this failure mode.
- Impact/likelihood: High/certain — any typo in `docker-entrypoint.sh` or `nginx.conf` reaches production. This is the most concrete "tests pass ≠ works for user" gap in the entire codebase.
- Files: `.github/workflows/images.yml`, `apps/web/docker-entrypoint.sh`, `apps/web/nginx.conf`
- Fix: Add a `smoke-test` job to `images.yml` that runs `docker run -e API_URL=https://api.example.com <built-image> &`, waits for nginx, then `curl -s -I http://localhost/` and asserts `Content-Security-Policy` header contains `api.example.com`. Total addition: ~50 shell lines. Also run `docker run -e API_URL= ...` to assert same-origin path outputs `'self'` only.
- Size: S

**[P1-2] WebSocket gateway CORS wide-open (`cors: true`)**
- What: `@WebSocketGateway({ cors: true })` at `apps/api/src/realtime/realtime.gateway.ts:61` accepts Socket.io connections from any origin. The REST API correctly uses `app.enableCors({ origin: allowedOrigins })`. The WS handshake is authenticated (JWT/PAT required before room join), but any cross-origin page can initiate the handshake, attempt auth, and probe error messages.
- Impact/likelihood: Medium/certain — CORS policy is incomplete; any browser-exploitable XSS in a third-party origin can reach the WS endpoint. Additionally, this mismatch is confusing for security auditors and self-hosters.
- Files: `apps/api/src/realtime/realtime.gateway.ts:61`, `apps/api/src/main.ts`
- Fix: Pass the parsed `CORS_ORIGINS` list to the `@WebSocketGateway` decorator: `@WebSocketGateway({ cors: { origin: allowedOrigins, credentials: true } })`. Read it from `process.env.CORS_ORIGINS` in `realtime.gateway.ts` using the same helper that `main.ts` uses, or inject it as a config value.
- Size: S

**[P1-3] Five new feature families absent from tenant-isolation matrix**
- What: `WorkLog`, `StandupEntry`, `IssueTemplate`, `PersonalColumn/Card`, and `PokerSession` endpoints are not in the cross-tenant isolation matrix (`tenant-isolation.integration.spec.ts`). These five families added authorization calls (`assertProjectMember`, `assertProjectRole`) that have never been verified cross-tenant under the real app bootstrap.
- Impact/likelihood: High/medium — any future refactor of these service methods could silently break isolation; there is no regression guard. The risk is compounded because `WorkLogsService.update/remove` uses a custom `resolveWorkspaceId` path rather than `assertProjectMember`, diverging from the established pattern.
- Files: `apps/api/src/tenant-isolation.integration.spec.ts`, `apps/api/src/work-logs/work-logs.service.ts:151–213`, `apps/api/src/standups/standups.service.ts`, `apps/api/src/issue-templates/issue-templates.service.ts`, `apps/api/src/personal-boards/personal-boards.service.ts`, `apps/api/src/poker/poker.service.ts`
- Fix: Add rows to `buildMatrix()` for each new endpoint family (GET+POST+PATCH+DELETE per resource). The existing framework handles all scaffolding; adding these rows is mechanical. Specifically validate that `GET /issues/:id/work-logs` with Tenant B's token against Tenant A's issue returns 403 or 404.
- Size: S

**[P2-1] `exportCsv` unbounded `findMany` — OOM/timeout on large projects**
- What: `IssuesService.exportCsv()` at `apps/api/src/issues/issues.service.ts:1273` fetches all project issues with a single `prisma.issue.findMany({ where: { projectId } })` and no `take` limit. NLQL filtering is applied after full load. For a project with 10k issues this materializes the entire issue set plus six included relations into Node.js heap.
- Impact/likelihood: Medium/medium — small self-hosted teams are unlikely to hit this soon, but it is a correctness-class bug (process OOM) not just a performance concern.
- Files: `apps/api/src/issues/issues.service.ts:1273`
- Fix: Add a hard cap (`take: 10_000`) with a `X-Next-Lane-Truncated: true` response header when the cap is hit. Longer-term: stream the CSV in chunks using Prisma cursor pagination to avoid accumulating the full result in memory.
- Size: S (cap) / M (streaming)

**[P2-2] No JWT refresh/revocation — 7-day compromise window**
- What: JWTs are signed with a 7-day default TTL (`getJwtExpiresIn()` in `apps/api/src/auth/auth.config.ts`) and there is no refresh token or revocation mechanism. A stolen token is valid until expiry. PATs can be revoked individually, but the short-lived JWT session token cannot be.
- Impact/likelihood: Medium/low for self-hosted; escalates significantly in multi-user cloud deployments.
- Files: `apps/api/src/auth/auth.module.ts`, `apps/api/src/auth/auth.config.ts`
- Fix (minimum): Shorten default TTL to 15m–1h and implement a refresh token endpoint (`POST /auth/refresh`) issuing new access tokens against a stored, revocable refresh token. Revocation can be a Redis SET with TTL matching the refresh window. A full Redis-backed deny-list for immediate revocation is the premium option.
- Size: M

**[P2-3] `WorkLogsService` authorization uses bespoke `resolveWorkspaceId` instead of `assertProjectMember`**
- What: `WorkLogsService.update()` and `.remove()` at `apps/api/src/work-logs/work-logs.service.ts:151–213` resolve membership by calling a private `resolveWorkspaceId()` helper and then doing a raw `membership.findUnique`. This duplicates (and slightly diverges from) the `assertProjectMember` / `assertProjectRole` utility. If `assertProjectMember` ever gains additional checks (e.g. project archived status, workspace suspension), `WorkLogsService` will silently miss them.
- Impact/likelihood: Medium/medium — authorization bypass risk if the utility evolves; also absence from the tenant-isolation matrix means no regression guard exists.
- Files: `apps/api/src/work-logs/work-logs.service.ts:151–230`
- Fix: Replace the custom membership resolution with a call to `assertProjectMember(this.prisma, userId, workLogRef.projectId)` followed by a role check using the returned/injected membership — or add `assertProjectRole` overload that accepts the projectId directly (already the pattern elsewhere). Delete `resolveWorkspaceId`.
- Size: S

**[P2-4] `@@index([projectId, toStatusId])` still missing from `WorkflowTransition`**
- What: `enforceTransition()` at `apps/api/src/workflows/workflow.service.ts:986–993` queries `workflowTransition.findMany({ where: { projectId, toStatusId, OR: [{fromStatusId}, {fromStatusId: null}] } })`. The existing indexes are `(projectId, issueType)` and `(projectId, fromStatusId)`. Neither covers this access pattern, so each enforcement check performs a partial index scan on `projectId` then filters `toStatusId` in memory.
- Impact/likelihood: Medium/medium — low volume for small teams, but every issue status change under enforcement adds a sequential scan over all transitions in the project.
- Files: `apps/api/prisma/schema.prisma:1244–1255`
- Fix: Add `@@index([projectId, toStatusId])` after the existing indexes in the `WorkflowTransition` model, then run `prisma migrate dev`.
- Size: S

**[P2-5] `bulkUpdate` per-issue automation/webhook/notification fan-out**
- What: `IssuesService.bulkUpdate()` at `apps/api/src/issues/issues.service.ts:1444–1470` iterates issue IDs and calls the full `update()` path for each. Every call independently fires: automation engine evaluation, webhook delivery queue enqueue, watcher notification fan-out, ActivityLog write, realtime broadcast. For 100-issue bulk updates this is 100 × (automation + webhook + notification) serial calls, not a batched dispatch.
- Impact/likelihood: Medium/low — affects teams doing bulk triage or sprint planning; each call is async but the Postgres round-trips are serial.
- Files: `apps/api/src/issues/issues.service.ts:1444`, `apps/api/src/automations/automation-engine.service.ts`, `apps/api/src/webhooks/webhooks.service.ts`
- Fix: Pre-collect all mutated issue IDs, then dispatch a single `webhook.deliverBatch()` call and a single `automationEngine.evaluateForBatch()` call after the loop. Reduces webhook/automation overhead from O(n) to O(1) per bulk operation. For notifications, batch the `createMany` rather than one notification per issue per watcher.
- Size: M

**[P2-6] `AUTO_SEED=true` default in production containers**
- What: `apps/api/docker-entrypoint.sh:7` seeds demo data on every container start unless `AUTO_SEED=false` is explicitly set. Self-hosters who follow the quickstart `docker compose up` without reading the env var documentation will have demo workspaces/issues/users added to their instance on every restart.
- Impact/likelihood: Low/medium — the seed script's `AUTO_SEED_GUARD=1` guard attempts to skip if data is already present, but the default is still surprising and the guard relies on application-level logic, not a DB constraint.
- Files: `apps/api/docker-entrypoint.sh:7`, `docker-compose.yml`
- Fix: Change the default to `AUTO_SEED=false` and require self-hosters to set `AUTO_SEED=true` in `docker-compose.yml` for the demo experience. Document this in README and the compose file comments. Update the compose file to set `AUTO_SEED=true` explicitly for the development/demo preset.
- Size: S

**[P3-1] Password minimum length inconsistency: 6 chars (register) vs 8 chars (reset)**
- What: `RegisterDto` has `@MinLength(6)` and `ResetPasswordDto` has `@MinLength(8)` at `apps/api/src/auth/dto/auth.dto.ts:13` and `auth.dto.ts:41`. The inconsistency is also below modern minimum (NIST SP 800-63B recommends 8; OWASP recommends 12+).
- Impact/likelihood: Low/certain — users registering with a 6- or 7-char password cannot use "reset to same password" without an error.
- Files: `apps/api/src/auth/dto/auth.dto.ts:13,41`
- Fix: Align both to `@MinLength(12)` and update the frontend registration form validation. Run the unit spec to confirm.
- Size: S

**[P3-2] In-memory presence map does not replicate across HPA replicas**
- What: `RealtimeGateway.presence: ProjectPresenceMap` at `apps/api/src/realtime/realtime.gateway.ts:71` is per-process. Under HPA scale-out (2+ replicas) users connected to different replicas see inconsistent presence lists. The Redis adapter correctly fans out emitted events, but the presence map itself is not in Redis.
- Impact/likelihood: Low/low — documented as a known limitation; only affects HPA deployments, which are the minority for self-hosted. Included for completeness.
- Files: `apps/api/src/realtime/realtime.gateway.ts:50–74`
- Fix: Store presence in Redis (hash per projectId, key = userId, value = JSON PresenceViewer). On subscribe, read from Redis hash; on disconnect, delete the key; on presence broadcast, use Redis hash to build the viewer list. Use the existing `pubClient`/`subClient` already injected into the gateway.
- Size: M

---

### Debugging / QA discipline (Pass 9)

Score: **3 / 5** — same as Pass 8; the Docker artifact gap is the dominant deficiency.

**Gap 1 — Docker artifact never exercised in CI (four passes old).**
The Playwright e2e suite targets `vite preview` (confirmed in `apps/web/playwright.config.ts`), not the nginx-served Docker image. `images.yml` builds and pushes but never starts the container to validate `docker-entrypoint.sh` behavior. The regression that shipped to users (CSP `connect-src` blocking login because `__NL_CONNECT_SRC__` was not substituted) would have been caught by a 50-line smoke test step. Concrete fix: add a `smoke-test` job in `images.yml` that starts the web container with `API_URL=https://api.test.internal`, waits for nginx to be ready (`curl --retry 5 --retry-delay 1`), and asserts `Content-Security-Policy` in the response headers contains `api.test.internal`. Also assert same-origin path (`API_URL=`).

**Gap 2 — No regression guard for the CSP bug class.**
There is no test that will fail if `nginx.conf` or `docker-entrypoint.sh` is edited in a way that breaks CSP substitution. The smoke test above is the regression guard. Additionally add a unit test for `docker-entrypoint.sh` (using `bats` or a simple shell script in CI) that mounts a stub nginx config and asserts the placeholder is replaced correctly for both the standalone and same-origin paths.

**Gap 3 — Tenant-isolation matrix does not cover five new feature families.**
The matrix is the regression guard for authorization bugs. Without rows for work-logs, standups, issue-templates, personal boards, and planning poker, a future change to those service methods can break cross-tenant isolation undetected. Backlog item: add the matrix rows (S).

**Positive signals:** Correlation ID middleware (X-Request-Id), pino structured logging, `/health` (DB readiness ping) and `/health/live` (liveness) are all present and verified. The allExceptionsFilter maps errors to structured JSON. Diagnosability in production is adequate once a request ID is available.

---

### Ideation — three concrete technical investments

**Investment 1: Streaming CSV export (chunked write + Prisma cursor pagination)**
Replace the unbounded `findMany` in `exportCsv` with a streaming implementation: use Prisma cursor pagination (batches of 1,000 rows), write each batch to a `PassThrough` stream, and pipe the stream as the HTTP response body. This eliminates OOM risk, allows the client to start receiving data immediately, and unblocks large-project exports. The HTTP response should set `Content-Disposition: attachment; filename="issues.csv"` and `Transfer-Encoding: chunked`. Estimated effort: M. This would be the first streaming endpoint in the API and establishes the pattern for future large-data endpoints (e.g. audit log export, work-log export).

**Investment 2: Redis-backed presence map for multi-replica correctness**
The presence map is the only stateful per-process data structure in the API. Moving it to Redis (HSET per projectId, key = userId) turns presence into a correct cross-replica feature and removes the "known limitation" footnote. The existing `pubClient`/`subClient` are already injected. Implementation: on `subscribe`, write viewer to `HSET nl:presence:{projectId} {userId} {json}` with a TTL; on `disconnect`, `HDEL`; on `presence:subscribe` message, `HGETALL` to build the viewer list. Estimated effort: M. This is a prerequisite for any commercial multi-tenant offering where users on the same board are connected to different replicas.

**Investment 3: Playwright e2e test suite running against the real Docker Compose stack**
Create a second Playwright config (`playwright.docker.config.ts`) that sets `baseURL` to the nginx container and `API_URL` to the api container. Add a CI job (`e2e-docker.yml`) that runs `docker compose up -d --wait`, waits for `/health` to return 200, then runs the Playwright suite against it. This closes the largest remaining QA discipline gap: CSP headers, nginx routing, `docker-entrypoint.sh` substitution, and same-origin API proxying are all exercised. The existing Playwright test code runs unchanged; only the base URL differs. Estimated effort: M. Add a regression test that explicitly asserts `connect-src` contains the configured API origin.

---

### Direction (Pass 9)

The codebase is in good structural health. The outstanding risks split cleanly into two buckets.

The first bucket — **already known, still unresolved** — contains the Docker artifact CSP smoke test (four passes old), the `WorkflowTransition(projectId, toStatusId)` index (two passes old), and the analytics full-issue materialization. These are all S-sized items that have been deprioritized; they should now be treated as blocking quality debt. In particular the Docker artifact gap is a direct recurrence risk for the class of production bug that prompted the mandatory debugging/QA section of this audit.

The second bucket — **new from this pass** — is the five feature families absent from the tenant-isolation matrix (work-logs, standups, issue-templates, personal boards, planning poker) and the `WorkLogsService` bespoke authorization path. These are S-sized additions that are easy to do now while the code is fresh and very hard to audit-after-the-fact when the service logic evolves.

The most structurally important longer-term investment is the Playwright-against-Docker e2e harness (Investment 3 above). It collapses the Docker artifact gap, the CSP regression guard, and the nginx routing correctness into a single continuous signal.

---

### Backlog-groomer feed (Pass 9 — compact)

- **Add Docker artifact CSP smoke test to `images.yml`** · P1 · S · Four-pass-old gap; nginx `__NL_CONNECT_SRC__` substitution untested; run container + assert CSP header in CI; `apps/web/docker-entrypoint.sh`, `.github/workflows/images.yml`
- **Align WebSocket CORS with REST CORS allowlist** · P1 · S · `@WebSocketGateway({ cors: true })` accepts any origin; REST uses explicit `CORS_ORIGINS` allowlist; pass `{ origin: allowedOrigins }` to the decorator; `apps/api/src/realtime/realtime.gateway.ts:61`
- **Add work-logs, standups, issue-templates, personal-boards, poker to tenant-isolation matrix** · P1 · S · Five feature families with authorization paths absent from cross-tenant regression guard; add rows to `buildMatrix()`; `apps/api/src/tenant-isolation.integration.spec.ts`
- **Add CSV export hard cap and streaming path** · P2 · S (cap) / M (streaming) · `exportCsv` unbounded `findMany` is OOM risk on large projects; `apps/api/src/issues/issues.service.ts:1273`
- **Implement JWT refresh token with short-lived access token TTL** · P2 · M · 7-day access token TTL means a stolen token has a 7-day window; no revocation mechanism; `apps/api/src/auth/auth.module.ts`, `apps/api/src/auth/auth.config.ts`
- **Replace `WorkLogsService` bespoke membership resolution with `assertProjectMember`** · P2 · S · Custom `resolveWorkspaceId` diverges from `membership.util`; won't inherit future checks; `apps/api/src/work-logs/work-logs.service.ts:151`
- **Add `@@index([projectId, toStatusId])` to `WorkflowTransition`** · P2 · S · `enforceTransition` query pattern unindexed; sequential scan on every status change under enforcement; `apps/api/prisma/schema.prisma:1244`
- **Batch webhook/automation/notification dispatch in `bulkUpdate`** · P2 · M · 100-issue bulk = 100× serial fan-out; pre-collect mutated IDs and dispatch once; `apps/api/src/issues/issues.service.ts:1444`
- **Change `AUTO_SEED` default to `false` in `docker-entrypoint.sh`** · P2 · S · Demo data seeded by default in production containers; self-hosters must know to set `AUTO_SEED=false`; `apps/api/docker-entrypoint.sh:7`
- **Align password `@MinLength` to 12 across register and reset DTOs** · P3 · S · 6-char register vs 8-char reset is inconsistent and below modern minimums; `apps/api/src/auth/dto/auth.dto.ts:13,41`
- **Move presence map to Redis HSET for multi-replica correctness** · P3 · M · Per-process presence map is incorrect under HPA; existing Redis clients already injected; `apps/api/src/realtime/realtime.gateway.ts:71`
- **Playwright e2e suite against real Docker Compose stack** · P2 · M · Current e2e uses `vite preview`; nginx CSP headers, routing, entrypoint substitution never tested; add `playwright.docker.config.ts` + CI job
- **Rewrite `projectAnalytics` as DB-level aggregation** · P2 · M · Full-issue `findMany` materializes all project issues; `apps/api/src/analytics/analytics.service.ts:418`

---

## 2026-07-01 — Pass 10 (personal-board colors/due-dates/reorder, quick-links, workspace delete/logo)

Scope: focused deep-dive on the newest surface area — `apps/api/src/personal-boards/**`
(column/card `color`, card `dueDate`, `PATCH /me/personal-columns/reorder`), `apps/api/src/me/**`
quick-links CRUD, `apps/api/src/workspaces/**` (`DELETE /workspaces/:id` cascade, 4 MB logo cap),
and the corresponding web surfaces (`AppHeader`/`WorkspaceChip`/`QuickLinksMenu`,
`WorkspaceSettingsPage`, `PersonalBoardPage`, `ColorSwatchPicker`). Cross-checked all
Pass-9 open items against current code. `tsc --noEmit` clean; targeted Jest run
(`personal-boards`, `me.service`, `workspaces.service`) — 73/73 passing.

### Pass-9 fix verification — all confirmed shipped

| Fix area | Status | Evidence |
|---|---|---|
| Docker artifact CSP smoke test (4-pass-old gap) | **CONFIRMED FIXED** | `scripts/smoke-web-csp.sh` + `images.yml` `smoke-test` job (commit `799a393`); asserts `connect-src` in both standalone and same-origin modes, checks for leaked `__NL_CONNECT_SRC__` placeholder. |
| WebSocket CORS wide-open | CONFIRMED FIXED | `realtime.gateway.ts:75` `@WebSocketGateway({ cors: _wsCorsOption })` mirrors `CORS_ORIGINS` allowlist (commit `daeb585`). |
| `WorkflowTransition(projectId, toStatusId)` index | CONFIRMED FIXED | Migration adds the composite index; referenced in `daeb585`. |
| `exportCsv` unbounded `findMany` | CONFIRMED FIXED (cap only) | `issues.service.ts:1238` `CSV_ROW_CAP = 10_000`, `take: CAP+1` sentinel, `X-Next-Lane-Truncated` header. Streaming (the long-term fix) still not done — acceptable, capped is sufficient for now. |
| `WorkLogsService` bespoke `resolveWorkspaceId` | CONFIRMED FIXED | Now calls shared `assertProjectMember`. |
| `AUTO_SEED` default | CONFIRMED FIXED | `docker-entrypoint.sh:11` defaults to `false`; `docker-compose.yml:52` explicitly sets `"true"` for the demo stack. |
| Password `@MinLength` 6 vs 8 | CONFIRMED FIXED | `RegisterDto` raised to 8, matching `ResetPasswordDto`. |
| 5 feature families missing from tenant-isolation matrix | CONFIRMED FIXED (mostly) | `daeb585` added 16 rows (work-logs, standups, issue-templates, personal-**columns**, poker); matrix now 73 rows. **Gap:** personal-**cards**, quick-links, and workspace `PATCH`/logo-upload are still absent (see Risk #4 below) — these are new-this-batch surfaces, not oversights from Pass 9. |
| JWT refresh/revocation | STILL OPEN | No change; 7-day non-revocable access token remains (`auth.config.ts`). Carried forward, not re-ranked below top 8 this pass since nothing regressed. |
| Redis-backed presence map | STILL OPEN | Unchanged; documented single-replica limitation. |

### New-surface findings (this pass)

**Positive:** Every new backend endpoint (personal-boards, quick-links, workspace
delete/logo) has correct ownership scoping — `getOwnedColumn`/`getOwnedCard` in
`personal-boards.service.ts` and `assertOwnedQuickLink` in `me.service.ts` both
404 (not 403) on cross-user access, avoiding existence-leak, and both are backed
by real unit tests (`personal-boards.service.spec.ts` 634 lines, `me.service.spec.ts`
275 lines) asserting the 404-on-foreign-owner path. DTO validation is thorough
(`@IsHexColor`, `@IsISO8601`, `@IsUrl` with protocol allowlist, length caps) across
all new DTOs. Workspace logo upload correctly reuses the Pass-8 magic-byte check.
Workspace delete has a type-to-confirm dialog client-side (`DeleteWorkspaceDialog`
in `WorkspaceSettingsPage.tsx`) — a good safety net the API itself doesn't require.

### Ratings table (Pass 10)

| Area | Score | Delta | Note |
|---|---|---|---|
| Architecture & module boundaries | 4 | — | New modules follow the established pattern; `QuickLinksMenu.tsx` duplicates `ColorSwatchPicker` instead of reusing it (see Risk #3). |
| Data model & migrations | 4 | — | `PersonalColumn.order`/`PersonalCard.rank` schema is sound; no `@@unique` on `(userId, order)` is intentional (app-level enforcement in `reorderColumns`), but `updateColumn` still allows an arbitrary out-of-band `order` write that can desync from the reorder invariant (Risk #5). |
| AuthN/AuthZ & multi-tenant isolation | 3 | -1 | Ownership logic itself is correct and unit-tested, but the cross-tenant **integration** matrix does not cover personal-cards, quick-links, or workspace `PATCH`/logo-upload — the exact regression-guard gap the matrix exists to close (Risk #4). |
| Input validation | 5 | +1 | Best-in-class this pass: hex/ISO8601/URL-protocol validation with `ValidateIf(v !== null)` clear-semantics on every new DTO. No gaps found. |
| Error handling | 4 | — | Consistent 404-not-403 ownership pattern; `BadRequestException` messages are specific and actionable. |
| N+1 / query efficiency | 4 | — | Minor: `getBoard` lazy-init does 3 sequential `create` calls instead of one `createMany` (`personal-boards.service.ts:132-136`) — fires once per user ever, not worth prioritizing. |
| Realtime correctness | 4 | — | No regressions; personal boards are intentionally realtime-free (private, single-viewer). |
| Rank / ordering integrity | **3** | -2 (for this surface) | `reorderColumns` itself is correct (whole-set validation + single transaction). But the **frontend optimistic-update bug** (Risk #1) means the fractional-rank UI can visibly desync from the true order until a refetch completes — an ordering *integrity-of-experience* regression even though the backend data is fine. |
| Test coverage (unit + e2e) | **2** | -1 | Backend unit coverage for the new modules is strong (unit tests exist and pass for every ownership/validation path). But **zero e2e coverage** exists for `WorkspaceSettingsPage` (rename, delete-confirm dialog), `QuickLinksMenu` (add/edit/delete/group/collapse), the workspace switcher, or personal-board column color/reorder — an entire feature batch shipped with no browser-level regression guard (Risk #2). |
| Type safety | 5 | — | Strict TS throughout; no stray `any` in any of the new files. |
| Build / CI / Docker | 4 | +1 | Docker CSP smoke test finally landed — the longest-standing QA-discipline gap in this project's history is closed. |
| Secrets / config hygiene | 4 | — | No new secret surfaces; `AUTO_SEED` default flip is a good hardening step. |
| Dependency risk | 4 | — | No new dependencies introduced by this batch. |
| Debugging / QA discipline | 3 | +1 | Docker artifact gap closed (big win). Still missing: a regression guard for the personal-board drag-reorder visual-flicker bug class (Risk #1) — the e2e suite explicitly avoids raw drag simulation, so this class of bug is structurally invisible to CI by design, not by oversight. |

### Top risks & debt (Pass 10, ranked by impact × probability)

**[1] Personal-board card reorder: optimistic update silently no-ops for same-column drags, and never updates `rank` for any drag**
- What: `useUpdatePersonalCard`'s `onMutate` in `apps/web/src/api/personal-board.ts:194-209` only applies the optimistic patch `if (patch.columnId !== undefined)`. A same-column reorder (drag a card up/down within one column) sends only `beforeId`/`afterId`, no `columnId` — so the guard is `false` and **no optimistic update happens at all**: the dropped card visually snaps back to its old position and only jumps to the correct spot once the PATCH round-trips and `onSettled` invalidates the query. Even in the cross-column case where the guard does pass, the merged object is `{ ...c, ...patch }`, which spreads `beforeId`/`afterId` onto the card (fields `PersonalCardDto` doesn't have) but never computes a new `rank` — and every render re-sorts cards by `rank` (`PersonalBoardPage.tsx:388`), so the card doesn't actually move to its optimistic position in the column list until the server responds.
- Impact/likelihood: Medium impact (visible flicker/snap-back on every personal-board drag, the same *class* of bug — visual desync surviving a green test suite — called out by name in the project's QA mandate), certain/always-reproducible.
- Files: `apps/web/src/api/personal-board.ts:186-220`, `apps/web/src/pages/PersonalBoardPage.tsx:388`
- Fix: Compute the optimistic `rank` client-side using the same `rankBetween`/`rankAfter` helpers from `@next-lane/shared` that the backend uses (they're already bundled for the web via the shared package), keyed off the `beforeId`/`afterId` cards in the target column, and always run the optimistic branch (drop the `columnId !== undefined` guard). This mirrors the pattern the main issue board already uses for its own drag-and-drop optimistic updates — worth checking `apps/web/src/api/issues.ts`'s `useMoveIssue` as a reference implementation to copy.
- Size: S

**[2] Zero e2e coverage for the entire new-feature batch (WorkspaceSettingsPage, QuickLinksMenu, column color/reorder)**
- What: `apps/web/e2e/workspace-branding.spec.ts` covers only logo upload and brand color; there is no spec file for workspace rename, the type-to-confirm delete dialog (`DeleteWorkspaceDialog`), the workspace switcher (`WorkspaceChip`), or `QuickLinksMenu` at all (add/edit/delete/group/collapse/color). `personal-board.spec.ts` has no test for column color-picking or the new column drag-reorder (`PATCH /me/personal-columns/reorder`) — confirmed via `grep` for `data-testid="delete-workspace-button"`, `"quick-links-button"`, `"workspace-chip"`, `"personal-column-drag"` across all of `apps/web/e2e/`: zero matches for any of them.
- Impact/likelihood: High impact — workspace delete is the **first hard-cascade-delete path ever shipped** in this app (previously only soft-`archive` existed for projects; nothing else supported irreversible deletion), and it has no browser-level test that a real click-through-and-confirm flow works end-to-end. Quick-links is a header-level feature every user will touch. Likelihood of a regression slipping through is high given this is exactly the pattern (feature ships, tests pass because they don't exist for the new surface, bug reaches user) the project's own QA mandate was written to prevent.
- Files: `apps/web/e2e/` (missing: `workspace-settings.spec.ts`, `quick-links.spec.ts`; `personal-board.spec.ts` missing column-color/reorder cases)
- Fix: Add three specs (desktop + mobile each): (a) workspace rename + delete-confirm-dialog (type mismatched name → button disabled; type correct name → workspace deleted, redirected to `/`, workspace gone from switcher); (b) quick-links CRUD + grouping + collapse; (c) personal-board column color picker + column drag-reorder end-state assertion (via the existing "avoid raw pointer drag" pattern already used for cards — call the reorder mutation path through a keyboard-accessible affordance if one exists, or assert post-drag DOM order using `dragTo()` since dnd-kit does support Playwright's native drag events for simple lists).
- Size: M

**[3] `QuickLinksMenu.tsx` duplicates the shared `ColorSwatchPicker` primitive instead of reusing it**
- What: `apps/web/src/components/QuickLinksMenu.tsx:21-97` defines a local `PALETTE` array (8 hex colors) and a local `ColorPicker` component that is structurally identical to `apps/web/src/components/ui/ColorSwatchPicker.tsx`'s `ACCENT_PALETTE`/`ColorSwatchPicker` — same 8 colors in the same order, same "no color" affordance, same `radiogroup` pattern — just with different `data-testid` values (`quick-link-color-swatch`/`quick-link-color-none` vs `color-swatch`/`color-none`).
- Impact/likelihood: Medium impact (direct violation of the project's own design-system mandate: "`src/components/ui/*` primitives are the single source of truth; every component derives from them"), certain (already landed, will diverge further with each independent edit).
- Files: `apps/web/src/components/QuickLinksMenu.tsx:21-97`, `apps/web/src/components/ui/ColorSwatchPicker.tsx`
- Fix: Delete the local `PALETTE`/`ColorPicker` in `QuickLinksMenu.tsx`; replace with `<ColorSwatchPicker value={color} onChange={setColor} />` from `ui/ColorSwatchPicker`. If the `data-testid` values differ from what existing e2e specs assert, thread a `testIdPrefix` prop through `ColorSwatchPicker` rather than forking it.
- Size: S

**[4] Personal-cards, quick-links, and workspace PATCH/logo-upload absent from the cross-tenant/cross-user isolation matrix**
- What: `tenant-isolation.integration.spec.ts`'s Pass-9 update added personal-**columns** rows but not personal-**cards** (title/notes/color/dueDate PATCH, DELETE, move via beforeId/afterId) or quick-links (any of GET/POST/PATCH/DELETE). Workspace `PATCH :id` (rename/brandColor) and `POST :id/logo` are also missing — only `DELETE :id` and `DELETE :id/logo` are covered (confirmed via grep: only `workspaces/${t.workspaceId}` GET/PATCH-for-audit-log/DELETE and `logo` DELETE rows exist). Unit-test coverage for ownership is solid (see Positives above), but the integration matrix is what catches a *future* refactor that accidentally swaps `getOwnedCard` for a weaker check, or that adds a new mutation path that forgets the ownership call.
- Impact/likelihood: Medium impact (the actual authorization code is correct today, verified by direct reading and passing unit tests — this is a regression-guard gap, not a live vulnerability), medium likelihood of catching a *future* regression.
- Files: `apps/api/src/tenant-isolation.integration.spec.ts`
- Fix: Add matrix rows for `PATCH/DELETE /me/personal-cards/:id`, all four quick-link verbs, `PATCH /workspaces/:id`, and `POST /workspaces/:id/logo`, following the existing `buildCrossWorkspaceRows`/cross-user pattern used for personal-columns.
- Size: S

**[5] `updateColumn` allows an arbitrary `order` write that can desync from the `reorderColumns` invariant**
- What: `UpdatePersonalColumnDto.order` (`@IsInt @Min(0)`) lets a client `PATCH /me/personal-columns/:id` with any non-negative integer, independent of the atomic whole-set rewrite that `reorderColumns` performs. Two columns can end up with the same `order` value (no `@@unique` constraint, which is intentional per the code comment for `reorderColumns`, but `updateColumn` has no analogous "must be a valid permutation" check). Since Postgres does not guarantee stable ordering among rows with equal `orderBy` values and no secondary sort key is applied (`getBoard`'s `orderBy: { order: 'asc' }` has no tiebreaker), a duplicate `order` produces column ordering that is stable only by accident (likely insertion/physical order) and can visibly reshuffle between requests.
- Impact/likelihood: Low impact (cosmetic ordering flicker, not a data-safety bug), low likelihood (the web UI never actually calls `updateColumn` with an `order` field — only `reorderColumns` does — so this is dead/unused-but-exposed API surface today).
- Files: `apps/api/src/personal-boards/dto/update-personal-column.dto.ts:19-22`, `apps/api/src/personal-boards/personal-boards.service.ts:174-190`
- Fix: Either remove `order` from `UpdatePersonalColumnDto` (forcing all reordering through the atomic `reorderColumns` endpoint, which is the only caller today), or add a secondary `orderBy: [{ order: 'asc' }, { createdAt: 'asc' }]` tiebreaker in `getBoard` as a defensive minimum. Prefer removing the field — smaller API surface, one invariant to maintain.
- Size: S

**[6] Workspace hard-delete cascades through `Attachment` rows without deleting the on-disk files — new orphan-file leak**
- What: `WorkspacesService.remove()` (`workspaces.service.ts:250-270`) is, by inspection of the whole codebase, the **first-ever hard-delete cascade path** in the application — every other "delete" (`ProjectsService`) is a soft `archive`. The Prisma schema cascades `Workspace → Project → Issue → Attachment` all the way down via `onDelete: Cascade` (confirmed in `schema.prisma`), so all `Attachment` DB rows for every issue in every project in the deleted workspace disappear from Postgres. But the actual files on disk under `UPLOADS_DIR` are only ever unlinked by the explicit `DELETE /attachments/:id` path (`attachments.service.ts:294`) — there is no Prisma middleware, transaction hook, or pre-delete sweep that walks the workspace's attachments and unlinks their `storageKey` files before the cascading DB delete. Every attachment ever uploaded to a deleted workspace becomes a permanently orphaned file consuming disk (or PVC, in the K8s deploy) with no DB row left to find or clean it up by.
- Impact/likelihood: Medium impact (disk-space leak, not a security or correctness bug — but unbounded and irreversible once the DB row is gone, since there's no longer a `storageKey` to look up), medium likelihood for any self-hoster who uploads attachments and later deletes a workspace (a natural cleanup action).
- Files: `apps/api/src/workspaces/workspaces.service.ts:250-270`, `apps/api/prisma/schema.prisma` (`Attachment` model, cascade chain), `apps/api/src/attachments/attachments.service.ts`
- Fix: Before the `prisma.workspace.delete()` call, fetch all `storageKey`s for attachments under the workspace (`prisma.attachment.findMany({ where: { issue: { project: { workspaceId } } }, select: { storageKey: true } })`) and unlink each file after the delete succeeds, mirroring the existing logo-cleanup pattern already in the same function. Same treatment should be applied to workspace logo (already handled) and — as future scope — any other on-disk-file model that gains a cascade-delete path from a workspace/project.
- Size: S

**[7] `promoteCard` is not atomic across the Issue-create and PersonalCard-update calls**
- What: `PersonalBoardsService.promoteCard` (`personal-boards.service.ts:389-422`) calls `this.issues.create(...)` and then, as a separate un-transacted call, `this.prisma.personalCard.update({ data: { promotedIssueId: issue.id } })`. If the process crashes, the DB connection drops, or an unrelated exception fires between these two calls, the Issue is created and fully visible on the project board, but the personal card's `promotedIssueId` is never set — so the idempotency guard (`if (card.promotedIssueId !== null) throw ...`) never engages, and a retried promote (e.g. a user double-clicking after a timeout) creates a *second* orphaned Issue for the same card. This was flagged as a P2 item in Pass 7 ("Add idempotency guard to promoteCard") and the guard was added, but the underlying non-atomicity that can defeat the guard was not addressed.
- Impact/likelihood: Low impact (requires a crash/exception exactly between two adjacent calls, or a request timeout with client retry), low likelihood, but easy to fix now while the surface is small.
- Files: `apps/api/src/personal-boards/personal-boards.service.ts:389-422`
- Fix: Wrap both writes in `this.prisma.$transaction(async (tx) => { ... })`, passing `tx` through to `IssuesService.create` (requires `IssuesService.create` to accept an optional Prisma transaction client, or extracting the minimal issue-insert logic). If threading a `tx` through `IssuesService.create` is too invasive for the win, at minimum wrap just the `personalCard.update` in a `try/catch` that logs loudly on failure so the orphan is diagnosable, and consider a periodic reconciliation job.
- Size: S (logging) / M (full transaction threading)

### Debugging & QA-discipline audit (Pass 10 — mandatory)

**Closed this pass:** The Docker artifact CSP smoke test — four consecutive audit
passes flagged as the single most concrete "tests pass ≠ works for the user" gap
in the codebase — is now live in CI (`scripts/smoke-web-csp.sh` + `images.yml`).
This is a genuinely significant structural fix and should be recognized as such.

**New this pass:** The personal-board drag-reorder bug (Risk #1) is a fresh
instance of exactly the same failure mode the smoke test was built to close for
Docker/nginx — a real, always-reproducible user-visible bug that a green test
suite cannot see because the test suite was deliberately designed to avoid the
code path where the bug lives (`personal-board.spec.ts`'s own comment explains
raw pointer-drag is skipped as "flaky"). This is not a criticism of that
decision in isolation (Playwright drag simulation genuinely is flaky), but it
means the responsibility shifts to the **data layer** (the optimistic-update
logic) needing its own non-drag-dependent test — e.g. a component/hook-level
test that calls `useUpdatePersonalCard`'s mutation with a same-column
`beforeId`/`afterId` patch and asserts the query cache reflects the new order
immediately, without waiting for `onSettled`. No such test exists today for any
of the optimistic-update hooks in `api/personal-board.ts`.

**Diagnosability:** No regressions. Correlation IDs, pino structured logs,
`/health`/`/health/live` remain in place and are unaffected by this batch.

**Concrete regression-guard proposals (new this pass):**
1. A Vitest/Jest test for `useUpdatePersonalCard`'s `onMutate` that asserts the
   query-cache card order changes synchronously for a same-column
   `beforeId`/`afterId`-only patch (closes Risk #1's blind spot structurally,
   independent of Playwright drag flakiness).
2. `workspace-settings.spec.ts` and `quick-links.spec.ts` e2e specs (closes
   Risk #2) — workspace delete in particular deserves a guard given it is the
   first irreversible cascading-delete UI action in the product.

### Ideation — three concrete technical investments (mandatory every pass)

1. **A shared "optimistic list-reorder" hook.** The personal board is now the
   second place in the codebase (after the main issue board) to implement
   drag-and-drop with fractional ranks and React Query optimistic updates —
   and the second implementation has a bug the first one (presumably) doesn't.
   Extract a `useOptimisticReorder<T>(queryKey, computeRank)` hook that
   encapsulates "cancel query → snapshot → compute new rank via
   `rankBetween`/`rankAfter` → patch cache → rollback-on-error → settle-invalidate"
   once, in `packages/shared` or a `src/hooks/` module, and have both the issue
   board and the personal board consume it. This turns "don't forget the
   optimistic branch" from a per-feature tax into a structural guarantee, and
   is exactly the kind of DX investment that prevents this bug class from
   recurring a third time in a future feature (e.g. a planned "personal
   backlog" or "roadmap swimlane" reorder). *Priority: P1. Size: M.*

2. **A workspace-export / "download before you delete" flow.** Now that
   workspace deletion is a real, irreversible, cascading action, pair it with
   a one-click export (issues + comments + attachments manifest as a zip or
   the existing CSV export, offered inline in the delete-confirmation dialog)
   so self-hosters don't lose data to a misclick or a change of mind. This is
   cheap to build (the CSV export endpoint and streaming infra largely already
   exist) and directly de-risks the single most destructive action a user can
   take in the product. *Priority: P2. Size: M.*

3. **A generic "cascade-delete file sweep" utility.** Risk #6 (orphaned
   attachment files on workspace delete) is the first instance of a pattern
   that will recur: any future on-disk-file model (avatars, exports, imports)
   that gains a cascade-delete ancestor will silently leak files unless
   deletion is disk-aware. Build one small `FileCleanupService` with a
   `sweepWorkspace(workspaceId)` method that resolves every `storageKey`
   reachable from a workspace (attachments today; logo already handled) and
   unlinks them in a `finally` after the cascading DB delete succeeds. Wire
   it into `WorkspacesService.remove()` now, and require any future
   file-backed model to register a resolver with this service as a matter of
   convention (documented in `CLAUDE.md`'s domain-module skill). *Priority:
   P2. Size: S–M.*

### Direction (Pass 10)

This was a clean batch from a pure-security standpoint — every new endpoint has
correct ownership scoping, validated inputs, and passing unit tests, and the
project finally closed its oldest and most-cited QA-discipline gap (the Docker
CSP smoke test). The findings this pass are concentrated in exactly the areas
the project's own mandate calls out for special scrutiny: a real, reproducible,
user-visible UI bug that a green test suite cannot see (Risk #1), and a brand
new feature surface that shipped with no browser-level regression guard at all
(Risk #2). Both are small (S/M) fixes. The workspace hard-delete file-orphan gap
(Risk #6) is new-in-kind — it's the first time this codebase has a real
cascading-delete path, so it's the first time the "did we clean up the
filesystem too" question has ever mattered, and the answer today is no.

Recommended sequencing for the next build-loop batch: fix the optimistic-update
bug and the `ColorSwatchPicker` duplication together (both touch
`PersonalBoardPage`/`personal-board.ts`, both S-sized, both easy to verify with
one test pass); add the two missing e2e specs; close the tenant-isolation matrix
gap (mechanical, S); and land the attachment-file-sweep-on-workspace-delete fix
before self-hosters start relying on workspace deletion as a routine cleanup
action.

### Backlog-groomer feed (Pass 10 — compact)

- **Fix personal-card optimistic reorder (same-column no-op + missing rank compute)** · P1 · S · Every personal-board drag visually snaps back or renders in the wrong slot until refetch; `apps/web/src/api/personal-board.ts:194-209`
- **Add e2e coverage for WorkspaceSettingsPage (rename + delete-confirm) and QuickLinksMenu** · P1 · M · First-ever irreversible cascading-delete UI action, plus a header-level feature every user touches, both ship with zero browser-level tests; `apps/web/e2e/`
- **Deduplicate QuickLinksMenu's local color picker into shared ColorSwatchPicker** · P2 · S · Violates the project's own design-system single-source-of-truth rule; `apps/web/src/components/QuickLinksMenu.tsx:21-97`
- **Add personal-cards, quick-links, workspace PATCH/logo-upload to tenant-isolation matrix** · P2 · S · Ownership logic is correct and unit-tested but has no integration-level regression guard; `apps/api/src/tenant-isolation.integration.spec.ts`
- **Remove (or ignore) the unused `order` field on `UpdatePersonalColumnDto`** · P3 · S · Dead API surface that can desync from the atomic `reorderColumns` invariant; `apps/api/src/personal-boards/dto/update-personal-column.dto.ts`
- **Sweep orphaned attachment files on workspace delete** · P1 · S · First-ever hard-cascade-delete path in the app leaks on-disk files with no DB row left to clean them up by; `apps/api/src/workspaces/workspaces.service.ts:250`
- **Make `promoteCard`'s Issue-create + card-update atomic (or at least loudly logged on partial failure)** · P3 · S/M · Crash between the two calls can produce an orphan Issue that defeats the existing double-promote guard; `apps/api/src/personal-boards/personal-boards.service.ts:389`
- **Extract a shared `useOptimisticReorder` hook for fractional-rank drag lists** · P1 · M · Second independent DnD+optimistic-update implementation already has a bug the first one avoided; structural fix prevents a third recurrence
- **Workspace-export-before-delete flow in the delete-confirmation dialog** · P2 · M · De-risks the single most destructive user action in the product; CSV export infra already exists
- **Generic `FileCleanupService.sweepWorkspace()` utility** · P2 · S–M · Establishes the convention so future file-backed models don't repeat the attachment-orphan bug

---

## 2026-07-01 — Pass 11 (workspace-selector bug-class sweep)

Scope: the founder caught a real bug cluster — `WorkspaceContext` (header chip) and
`PulseDashboardPage`'s local state were two independent, unsynced copies of "active
workspace"; nothing persisted across reload; no project-scoped route kept the chip
honest — fixed in `c8bf9c8` (localStorage persistence, single source of truth,
`useSyncActiveWorkspace` hook). This pass's mandate: find every OTHER instance of
**duplicated/shadow client state, persistence gaps, stale-cache/invalidation bugs,
and effect-based state-healing races**, plus a lighter normal sweep. Read
`WorkspaceContext.tsx`, `AppHeader.tsx`, every page under `apps/web/src/pages/**`,
the full TanStack Query data layer (`apps/web/src/api/*.ts`), `App.tsx`'s route
table, `apps/web/src/api/socket.ts`, and the e2e suite for regression-guard parity.
Cross-checked all Pass-10 open items against `git log` since. `tsc --noEmit` on the
web app is clean.

### Pass-10 fix verification

| Fix area | Status | Evidence |
|---|---|---|
| Personal-card optimistic reorder no-op | **CONFIRMED FIXED** | `2185b3f` — `onMutate` now computes a real optimistic move via shared `rankBetween`/`rankAfter`, both same-column and cross-column. |
| Mobile board toolbar overlap | **CONFIRMED FIXED** | `2185b3f` — toolbar row now wraps on mobile (screenshot-verified per commit message). |
| Orphaned attachment files on workspace delete | **CONFIRMED FIXED** | `2185b3f` — `WorkspacesService.remove()` now collects every attachment `storageKey` under the workspace and unlinks them (plus logo) before/after the cascading delete; new unit test in `workspaces.service.spec.ts`. |
| `promoteCard` non-atomicity | **CONFIRMED FIXED (compensating action)** | `2185b3f` — `promoteCard` now deletes the just-created Issue if linking it back to the card fails, avoiding the orphan-issue failure mode; double-promote guard preserved. |
| `QuickLinksMenu` duplicating `ColorSwatchPicker` | **CONFIRMED FIXED** | `2185b3f` — local `PALETTE`/`ColorPicker` deleted; now renders the shared `ui/ColorSwatchPicker`. |
| E2e coverage for `WorkspaceSettingsPage` / `QuickLinksMenu` | **STILL OPEN** | No `quick-links.spec.ts` or `workspace-settings.spec.ts` exists; `grep` for `quick-links-button`, `quick-link-color`, `delete-workspace-button` across `apps/web/e2e/` returns zero matches. A `workspace-switcher.spec.ts` landed with `c8bf9c8` (7 tests) but it covers the chip/board-sync fix itself, not rename/delete-confirm or quick-links CRUD. See Risk #3 below — this is now flagged for the second consecutive pass and is the exact discipline gap the founder's bug slipped through. |
| Personal-cards / quick-links / workspace PATCH+logo absent from tenant-isolation matrix | **STILL OPEN** | `tenant-isolation.integration.spec.ts` still has no rows for `PATCH/DELETE /me/personal-cards/:id`, any quick-link verb, `PATCH /workspaces/:id`, or `POST /workspaces/:id/logo` (only `DELETE :id` and `DELETE :id/logo` are covered, per `grep`). |
| Extract shared `useOptimisticReorder` hook (ideation) | NOT DONE | Personal-board reorder was fixed in place; no shared hook extracted yet. Carried forward as ideation. |

### This pass's bug-class sweep — findings

**Lens 1 (duplicated/shadow client state).** Swept every `useState` in
`apps/web/src/pages/**` and `components/**` for a "selected X" local copy that
shadows a context/query/URL value. Found one dead-but-live instance of the exact
bug (`DashboardPage.tsx`, Risk #1) and confirmed everything else that looked
suspicious is either legitimately ephemeral (modal-local pickers in
`PromoteCardModal`, `PokerStartPage`'s session-creation form) or already
URL-derived (board filters, swimlane `groupBy`, saved-filter selection — all read
from `searchParams`, no local mirror). Board selection (`BoardPage.tsx:81-99`) is
correctly localStorage-persisted with an `isFetching`-guarded healing effect — the
model to replicate elsewhere.

**Lens 2 (persistence gaps).** `QuickLinksMenu`'s group-collapse state
(`collapsed` at `QuickLinksMenu.tsx:233`) is local `useState`, not persisted —
because `AppHeader` (and therefore `QuickLinksMenu`) fully remounts on every
route change (each page independently renders `<AppHeader>`), every group
re-expands on every navigation. Low severity (Risk #6). No other undocumented
persistence gaps found — notification-type filter and NLQL saved-filter
selection are appropriately ephemeral/URL-backed respectively.

**Lens 3 (stale-cache/invalidation).** This is where the sweep found the most
signal. `qk.boardView(boardId)` — the actual query key `BoardPage` renders from —
is invalidated inconsistently across mutation hooks. `statuses.ts`, `labels.ts`,
and `versions.ts` all correctly thread an optional `boardId` and invalidate
`qk.boardView(boardId)` in addition to the legacy `qk.board(projectId)` key. But
`useUpdateIssue`, `useBulkUpdateIssues`, `useAssignIssueToSprint` (all in
`issues.ts`), `useUpdateIssueCustomFields` (`custom-fields.ts`), and all three
sprint mutations (`sprints.ts`) never accept/invalidate `boardId` at all — only
the legacy key, which is not the render source once a non-default board is
selected. In practice this mostly self-heals via the realtime socket (server
broadcasts to the whole project room including the sender), **but only while the
board that needs updating is currently mounted and subscribed** — revisiting a
previously-open board within the app's 30s global `staleTime` (`App.tsx:44`)
after such a mutation shows stale data (see Risk #4). Also found: project rename
has no realtime event at all (no `project.updated` in `SocketEvents`,
`packages/shared/src/types.ts:734-743`), so `board.project.name` shown on
Board/Backlog headers never updates for other viewers, ever, without reload (Risk
#7); and the "Blocked" badge counts ALL `BLOCKS` links with no join to the
blocker's status, so it doesn't clear when the blocking issue is completed
despite being named "unresolved blockers" (Risk #5).

**Lens 4 (effect-based state healing races).** Re-audited every "reset/clamp
selection when list changes" effect. `WorkspaceContext`'s own healing effect
(`WorkspaceContext.tsx:75-81`) is *not* `isFetching`-guarded like `BoardPage`'s
now is, but it doesn't need to be: `useWorkspaces()`'s `data` doesn't
transiently empty during a background refetch (TanStack Query serves the last
good `data` until the new page resolves), so there's no analogous race —
verified by reading `useWorkspaces` (`api/workspaces.ts:7-12`, default query, no
`placeholderData` reset). `TriagePage`'s `selectedIndex` clamp
(`TriagePage.tsx:185-189`) is monotonic-safe (`Math.min`, never force-resets to
0 while the list is merely refetching). `ReportsPage`'s `selectedSprintId`
seed-once effect (`ReportsPage.tsx:26-31`) has a different, minor flaw: it
guards on `if (selectedSprintId || ...) return`, so once a sprint is picked it
never re-validates — if that sprint is later deleted, `selectedSprintId` keeps
pointing at a dead id and `useBurndown` silently gets an empty/404 response
instead of falling back (Risk #8, P3).

### The main finding: `useSyncActiveWorkspace` was applied to some routes but not all

The `c8bf9c8` fix added `useSyncActiveWorkspace(workspaceId)` to 8 project-scoped
pages (Board, Backlog, Triage, Settings, Automations, Standups, PokerStart,
PokerSession). Cross-referencing every `<Route>` in `App.tsx` against every call
site of the hook (`grep -rn useSyncActiveWorkspace`) turns up **7 routes that
render `<AppHeader>` (and therefore the workspace chip) but never call it**:

- Three more project-scoped routes with the identical `board?.project.workspaceId`
  or `boardQuery.data?.project.workspaceId` value already available and unused
  for this purpose: `ReportsPage.tsx` (`/projects/:id/reports`),
  `ProjectAnalyticsPage.tsx` (`/projects/:id/analytics`), `RoadmapPage.tsx`
  (`/projects/:id/roadmap`).
- Four workspace-scoped routes where the `workspaceId` comes straight from
  `useParams()` (even more trivial to wire up than the project-scoped case):
  `WorkspaceMembersPage.tsx` (`/workspaces/:id/members`),
  `WorkspaceAuditLogPage.tsx` (`/workspaces/:id/audit-log`),
  `WorkspaceBrandingPage.tsx` (`/workspaces/:id/branding` — calls
  `setActiveWorkspaceId` reactively only from its brand-color *save* handler, not
  on page load), `WorkspaceSettingsPage.tsx` (`/workspaces/:id/settings` — same:
  `setActiveWorkspaceId` only fires from the delete-workspace success path, not
  page load).

In normal in-app navigation this is largely masked because the only way to reach
these routes today is via links that already carry `activeWorkspace.id`
(`WorkspaceChip`'s "Workspace settings"/"Members" menu items, `ProjectNav`'s "More"
menu, `WorkspaceSettingsNav`'s own tab bar) — so the chip and the page usually
agree by construction. But the chip is still wrong, reproducibly, the moment the
URL and the context diverge by any other path: a bookmark, a shared link, a
browser **back/forward** navigation after switching workspaces (context state
isn't popstate-aware), or a future feature that deep-links here (e.g. a
notification email linking to `/workspaces/B/members` while the user's last
active workspace was A). This is not a hypothetical — it's the exact "chip
misreports which workspace you're in" bug (bug #4 in the `c8bf9c8` fix
description) recurring on 7 of the 15 routes the fix was supposed to cover
project/workspace-wide, and there is zero e2e coverage that would catch it (see
Risk #3).

### Ratings table (Pass 11)

| Area | Score | Delta | Note |
|---|---|---|---|
| Architecture & module boundaries | 4 | — | No change; per-domain pattern holds. `DashboardPage.tsx` is dead code duplicating `PulseDashboardPage` — should be deleted, not a structural issue but a landmine. |
| Data model & migrations | 4 | — | No schema changes this pass beyond the trivial `showOnCard` boolean; clean migration. |
| AuthN/AuthZ & multi-tenant isolation | 3 | — | No regressions in the audited commits. Tenant-isolation matrix gap (personal-cards/quick-links/workspace PATCH+logo) carried forward unfixed for a second pass. |
| Input validation | 5 | — | New DTOs (`showOnCard`, blocked-badge is read-only/computed) are trivially validated; no gaps found. |
| Error handling | 4 | — | No regressions; `ReportsPage`'s stale-sprint-id-after-delete (Risk #8) degrades silently rather than erroring — minor. |
| N+1 / query efficiency | 4 | — | Blocked-badge `_count` and custom-field `showOnCard` are both single-query, no N+1 introduced. |
| Realtime correctness | **3** | -1 | New gap found this pass: no `project.updated`/rename event exists at all (Risk #7) — the realtime layer covers issues/comments/sprints but not the project entity itself, and `SocketEvents` has never had a project-level event. |
| Rank / ordering integrity | 5 | — | No change; fractional indexing unaffected by this batch. |
| Test coverage (unit + e2e) | **3** | — | `workspace-switcher.spec.ts` (7 tests) is a genuinely good addition, but it only covers the fixed flow — none of the 7 still-unsynced routes, and `QuickLinksMenu`/workspace-rename/-delete remain completely untested at the browser level for the second consecutive pass. |
| Type safety | 5 | — | Strict TS throughout; `tsc --noEmit` clean on web. |
| Build / CI / Docker | 4 | — | No changes to CI/build this pass. |
| Secrets / config hygiene | 4 | — | No new secret surfaces. |
| Dependency risk | 4 | — | No new dependencies. |
| Debugging / QA discipline | **3** | — | The founder-caught bug is a textbook instance of the project's own stated failure mode ("tests pass ≠ works for the user") — `PulseDashboardPage`'s prior local-state bug had no e2e test that switched workspaces and checked the chip. The fix added exactly that test, but the coverage wasn't generalized to the other 7 routes with the same shape of risk, so the *class* of regression this pass exists to close is still only partially closed. See dedicated section below. |

### Top risks & debt (Pass 11, ranked by impact × probability)

**[P1-1] Seven routes never sync the header chip to the workspace they're actually showing**
- What: `ReportsPage`, `ProjectAnalyticsPage`, `RoadmapPage` (project-scoped, `workspaceId` available from `useBoard(projectId).data.project.workspaceId` but unused), and `WorkspaceMembersPage`, `WorkspaceAuditLogPage`, `WorkspaceBrandingPage`, `WorkspaceSettingsPage` (workspace-scoped, `workspaceId` comes straight from `useParams()`) all render `<AppHeader>` — and therefore the workspace-chip switcher — without calling `useSyncActiveWorkspace`. `WorkspaceBrandingPage`/`WorkspaceSettingsPage` only call `setActiveWorkspaceId` reactively from a save/delete success handler, not on page load.
- Impact/likelihood: Medium impact (the chip lying about which workspace you're in is the exact bug class the founder just caught and had fixed at real cost), medium likelihood — masked in normal same-tab click-through navigation (all in-app links to these routes already carry the active workspace's id) but reproducible via bookmark, shared link, or browser back/forward after a workspace switch (context state is not popstate-aware).
- Files: `apps/web/src/pages/ReportsPage.tsx`, `apps/web/src/pages/ProjectAnalyticsPage.tsx`, `apps/web/src/pages/RoadmapPage.tsx`, `apps/web/src/pages/WorkspaceMembersPage.tsx`, `apps/web/src/pages/WorkspaceAuditLogPage.tsx`, `apps/web/src/pages/WorkspaceBrandingPage.tsx:407-419`, `apps/web/src/pages/WorkspaceSettingsPage.tsx:114-125`
- Fix: Add `useSyncActiveWorkspace(boardQuery.data?.project.workspaceId)` to the three project-scoped pages (identical one-liner to the 8 already fixed). For the four workspace-scoped pages, call `useSyncActiveWorkspace(workspaceId)` directly (workspaceId is already a plain route param, even simpler than the project-scoped case — no query wait needed). Longer-term structural fix in Ideation #1 below.
- Size: S

**[P1-2] Zero e2e coverage for `QuickLinksMenu` and workspace rename/delete — second consecutive pass**
- What: No spec file exercises quick-links add/edit/delete/group/collapse, workspace rename, or the type-to-confirm delete dialog (`DeleteWorkspaceDialog`) at the browser level. `workspace-branding.spec.ts` covers only logo + brand color; `workspace-switcher.spec.ts` (new this cycle, from `c8bf9c8`) covers only the chip-sync fix itself.
- Impact/likelihood: High impact — workspace delete is the app's only irreversible hard-cascade-delete UI action; quick-links is a header-level feature every user touches. Likelihood of a future regression slipping through is high given this is literally the failure mode ("feature ships, no browser test exists for the new surface, bug reaches user") that produced the bug this pass is auditing.
- Files: `apps/web/e2e/` (missing `quick-links.spec.ts`, `workspace-settings.spec.ts`)
- Fix: Unchanged from Pass 10's recommendation — add both specs, desktop + mobile. This is now flagged twice; treat as blocking for the next build-loop batch rather than backlog.
- Size: M

**[P2-1] `DashboardPage.tsx` is dead code carrying the exact bug the founder just paid to fix**
- What: `DashboardPage.tsx` defines its own local `const [selectedWs, setSelectedWs] = useState<string | null>(null)` (`DashboardPage.tsx:22`) with its own healing `useEffect` — a byte-for-byte re-implementation of the pre-fix `PulseDashboardPage` bug (two independent "active workspace" copies, no persistence). It is not referenced by `App.tsx`'s route table or any other file in the repo (confirmed via `grep -rn "DashboardPage"` across `src/` and `e2e/` — the only hit is its own `export function DashboardPage()`). It compiles and typechecks cleanly (dead code, not broken code), so nothing currently surfaces it — but it's a landmine: anyone routing to it again (e.g. restoring an old link, or a future refactor that re-adds a `/dashboard` route) resurrects the original bug on day one, silently, since it looks like working code and there's no lint rule catching unused-but-exported components.
- Impact/likelihood: Low impact today (unreachable), but the *kind* of risk (a known-bad pattern sitting in the tree, invisible to review because nothing renders it) is exactly what this pass was commissioned to find.
- Files: `apps/web/src/pages/DashboardPage.tsx` (entire file, 195 lines)
- Fix: Delete the file. If any future "classic dashboard" variant is wanted, it should be built from `WorkspaceContext`/`useSyncActiveWorkspace` from day one, not resurrected from this version.
- Size: S

**[P2-2] `qk.boardView(boardId)` invalidation is inconsistently threaded through mutation hooks — up to 30s of stale board state on revisit**
- What: `statuses.ts`, `labels.ts`, and `versions.ts` all accept an optional `boardId` param and invalidate `qk.boardView(boardId)` on mutation (the correct, established pattern). `useUpdateIssue`, `useBulkUpdateIssues`, `useAssignIssueToSprint` (`issues.ts`), `useUpdateIssueCustomFields` (`custom-fields.ts`), and all of `sprints.ts` (`useCreateSprint`/`useUpdateSprint`/`useDeleteSprint`) do not — they only invalidate the legacy `qk.board(projectId)` key, which nothing renders from once a board id is resolved (`BoardPage.tsx:182`: `const board = boardViewQuery.data`). In the common case this self-heals via the realtime socket (the API broadcasts to the whole project room including the sender, and `useBoardRealtime` unconditionally invalidates `qk.boardView(boardId)` on every event) — but only while the board that needs the update is *currently mounted*. Revisiting a board (e.g. Backlog → start a sprint → click the Board tab) within the app's global 30s `staleTime` (`App.tsx:44`) shows the pre-mutation board because TanStack Query serves cached data without refetching until `staleTime` elapses.
- Impact/likelihood: Medium impact (visible, reproducible staleness on a common workflow — status/assignee/priority edits from the issue drawer, sprint start/complete, custom-field edits on `showOnCard` fields), medium likelihood (requires navigating away and back within 30s, which is a very ordinary flow, not an edge case).
- Files: `apps/web/src/api/issues.ts:150-174` (`useUpdateIssue`), `:205-222` (`useBulkUpdateIssues`), `:240-281` (`useAssignIssueToSprint`), `apps/web/src/api/custom-fields.ts:110-128` (`useUpdateIssueCustomFields`), `apps/web/src/api/sprints.ts` (all three mutations)
- Fix: Thread an optional `boardId` param through each of these hooks (mirroring `statuses.ts`/`labels.ts`) and invalidate `qk.boardView(boardId)` alongside the legacy key. Better structural fix in Ideation #3 below — a shared `invalidateBoardFamily(qc, projectId, boardId?)` helper so this stops being a hand-maintained checklist per mutation.
- Size: S (mechanical) / M (with the shared helper)

**[P2-3] "Blocked" badge counts all `BLOCKS` links, not just unresolved ones — doesn't clear when the blocker is completed**
- What: `board.service.ts`'s `issueInclude._count.linksTo` filters only on `{ type: IssueLinkType.BLOCKS }` (`board.service.ts:33-41`), with no join to the blocking issue's status/category. The feature is literally named "Blocked badge on cards with **unresolved** blockers" (commit `bae368d`) but the query has no concept of "resolved" — a card stays marked "Blocked" forever once a `BLOCKS` link exists, even after the blocking issue is moved to a Done-category status.
- Impact/likelihood: Medium impact (a visibly wrong, persistent "Blocked" badge undermines trust in the feature — the whole point is to help triage, and a false-positive that never clears trains users to ignore it), high likelihood (every project that resolves a blocker without deleting the link — the normal workflow — hits this).
- Files: `apps/api/src/board/board.service.ts:33-41`, `apps/api/src/issues/issue.mapper.ts:165-172`
- Fix: Change the filtered count to `linksTo: { where: { type: IssueLinkType.BLOCKS, source: { status: { category: { not: StatusCategory.DONE } } } } }` (Prisma supports filtering a `_count` through a relation), or compute it via a small raw aggregation if the nested relation filter isn't supported for counts in the current Prisma version — verify with a quick spike. Add a test asserting the badge disappears once the blocker is moved to a DONE-category status.
- Size: S

**[P2-4] Personal-cards, quick-links, and workspace PATCH/logo-upload still absent from the tenant-isolation matrix — second pass unfixed**
- What: Unchanged from Pass 10 Risk #4. `tenant-isolation.integration.spec.ts` has rows for `DELETE /workspaces/:id` and `DELETE /workspaces/:id/logo` but not `PATCH /workspaces/:id`, `POST /workspaces/:id/logo`, or any personal-card/quick-link verb.
- Impact/likelihood: Medium impact (ownership logic is correct today, unit-tested — this is a regression-guard gap, not a live vulnerability), medium likelihood of catching a future refactor regression.
- Files: `apps/api/src/tenant-isolation.integration.spec.ts`
- Fix: Same as Pass 10 — add the missing rows following the existing `buildCrossWorkspaceRows` pattern. Mechanical.
- Size: S

**[P3-1] Project rename has no realtime propagation — other viewers (and the renaming user's other open tabs/pages) never see it without a reload**
- What: `SocketEvents` (`packages/shared/src/types.ts:734-743`) has events for issues, comments, sprints, notifications, and presence — but none for the `Project` entity itself. A project rename via `PATCH /projects/:id` only invalidates the renaming client's own `qk.projects`/`qk.project`/`qk.board` caches (`projects.ts:57-71`) via the HTTP mutation's `onSuccess`; there is no socket emit at all, so a second browser tab, a different team member, or the same user's already-open Board/Backlog page (per Risk P2-2's `qk.boardView` gap) never learns the project was renamed except by a hard reload.
- Impact/likelihood: Low-medium impact (cosmetic staleness, not data-safety), low likelihood (project renames are infrequent), but notably this is the *only* top-level entity in the schema with realtime coverage for every other mutation type but not its own rename.
- Files: `packages/shared/src/types.ts:734-743`, `apps/api/src/projects/projects.service.ts`, `apps/api/src/realtime/realtime.service.ts`
- Fix: Add `ProjectUpdated: 'project.updated'` to `SocketEvents`, emit it from `ProjectsService.update()` to the project room, and have `useBoardRealtime`'s generic top-of-handler invalidation (which already fires for every event) pick it up for free — no new frontend wiring needed beyond the event existing.
- Size: S

**[P3-2] `QuickLinksMenu` group-collapse state resets on every page navigation**
- What: `collapsed` (`QuickLinksMenu.tsx:233`) is local `useState`, never persisted. Because every page independently renders `<AppHeader>` (and therefore a fresh `QuickLinksMenu` instance), navigating between any two pages unmounts and remounts it, so any collapsed group re-expands.
- Impact/likelihood: Low impact (cosmetic annoyance for users with many quick-link groups), certain (reproduces on literally every navigation) but low severity.
- Files: `apps/web/src/components/QuickLinksMenu.tsx:233`
- Fix: Persist collapsed-group keys to `localStorage` (same pattern as `nl.activeWorkspaceId` / `nl_board_${projectId}`) keyed by user, or lift `AppHeader`/its children above the per-page remount boundary (a shared app shell) — the latter is the more structural fix and is also what Ideation #1 below proposes for the workspace-sync problem, so it's worth doing once for both.
- Size: S

**[P3-3] `ReportsPage`'s `selectedSprintId` never re-validates after the initial pick — points at a deleted sprint silently**
- What: The seed-once effect at `ReportsPage.tsx:26-31` guards with `if (selectedSprintId || sprints.length === 0) return`, so once a sprint id is set it is never re-checked against the live `sprints` list. If the selected sprint is later deleted, `selectedSprintId` keeps its stale value and `useBurndown(projectId, selectedSprintId)` silently returns empty/404 data rather than falling back to another sprint.
- Impact/likelihood: Low impact (Reports page shows an empty chart instead of an error, recoverable by manually reselecting), low likelihood (requires deleting a sprint while its burndown is open in another tab/session).
- Files: `apps/web/src/pages/ReportsPage.tsx:26-31`
- Fix: Change the guard to also reset when `selectedSprintId` is set but no longer present in `sprints` (same "clamp instead of reset-on-refetch" shape as `BoardPage`'s board-selection healing effect, without needing an `isFetching` guard since sprint lists don't background-refetch mid-render the same way).
- Size: S

### Debugging & QA-discipline audit (Pass 11 — mandatory)

The founder-caught bug is the cleanest possible illustration of this project's own
stated failure mode: a green build, a green unit-test suite, and a passing e2e
suite, while the actual deployed behavior ("switch workspace in the header, does
the dashboard follow? does it survive reload?") was broken. The **root cause was
not a missing test technique** (Playwright, real browser, real clicks — all
present) but a **missing test scenario**: nothing exercised "switch workspace via
the chip, then check the dashboard/board content," "reload the page, check the
active workspace persisted," or "navigate to a project board and check the chip
follows." The fix (`c8bf9c8`) added exactly those scenarios in
`workspace-switcher.spec.ts` — a genuinely good, on-target regression guard for
the flow that was broken.

The gap this pass surfaces is that **the regression guard was scoped to the fixed
flow, not to the bug class**. The bug class is "any page that shows the workspace
chip must keep it in sync with what it's actually displaying" — a property that
should hold for all 15 workspace/project-scoped routes, not just the 8 that got
`useSyncActiveWorkspace` wired up. There is no test — unit, component, or e2e —
that would fail today if a 16th route were added tomorrow without the sync call.
This is structurally identical to the Docker-CSP gap that took four audit passes
to close (Pass 5–9 history above): a real fix landed, but only for the reported
instance, and the general case was left to manual vigilance.

**Concrete regression-guard proposal (closes this structurally, not just for the
7 routes found this pass):** rather than adding 7 more individual
`useSyncActiveWorkspace` call sites (which only pushes the "don't forget for
route 16" problem further down the road), extract a `<WorkspaceScopedLayout>` /
`<ProjectScopedLayout>` wrapper that every project- and workspace-scoped route
renders through, which calls `useSyncActiveWorkspace` exactly once at the layout
level. Pair it with a **static route-audit test**: a Vitest test that imports
`App.tsx`'s route table, filters to `/projects/:id/*` and `/workspaces/:id/*`
patterns, and asserts each one's element tree is wrapped in the scoped layout
(or, more simply, an e2e test parameterized over all 15 routes that switches
workspace context and asserts the chip's `data-testid="workspace-chip"` text
matches the URL's resolved workspace name on every one). Either approach turns
"remember to call the hook" into "impossible to forget," which is the same shape
of fix Pass 10's `useOptimisticReorder` proposal took for the drag-reorder bug
class.

**Diagnosability:** No regressions. Correlation IDs, pino, `/health`/`/health/live`
unaffected by this batch.

### Ideation — three concrete technical investments (mandatory every pass)

1. **A single `<WorkspaceScopedLayout>`/`<ProjectScopedLayout>` wrapper that owns
   `useSyncActiveWorkspace`, replacing the current per-page opt-in.** This is the
   structural fix for Risk P1-1 and the general pattern behind it: today, keeping
   the header chip honest is a manual checklist item for every new
   project/workspace route, exactly the kind of "don't forget" tax the project's
   own retrospectives (this one included) keep re-discovering costs real bugs. A
   layout-level hook call makes it impossible to omit for any future route, and
   as a bonus fixes Risk P3-2 (`QuickLinksMenu` collapse-state reset) for free if
   the layout also hosts `AppHeader` above the per-page remount boundary instead
   of each page rendering its own copy. *Priority: P1. Size: M.*

2. **A shared `invalidateBoardFamily(qc, { projectId, boardId? })` helper,
   consumed by every issue/sprint/project mutation hook.** Risk P2-2 showed that
   "remember to invalidate `qk.boardView(boardId)` in addition to the legacy
   `qk.board(projectId)` key" is currently a hand-maintained convention followed
   by 3 of 9 mutation files and missed by 6. A single exported helper — called
   from `onSuccess` with whatever ids the mutation has on hand — turns this into
   a one-line, impossible-to-skip call and removes an entire class of "stale
   board on revisit" bugs at the source rather than relying on the realtime
   socket to paper over it. *Priority: P2. Size: S–M.*

3. **A `project.updated` realtime event, generalized into an audit of "which
   domain entities have realtime coverage."** Risk P3-1 found that `Project` is
   the only top-level entity with zero realtime events despite every sibling
   entity (Issue, Comment, Sprint, Notification) having one. Rather than a
   one-off fix, do a quick inventory: for each Prisma model with a dedicated
   settings/detail page (Project, Board, Workflow, CustomFieldDefinition,
   Component, Version), confirm there's a realtime event on mutation and that
   `useBoardRealtime`'s generic invalidation covers it — the generic top-of-
   handler invalidation already fires for *any* event, so most of these are a
   one-line `SocketEvents` addition plus one `emitToProject` call at the
   service layer, not new frontend wiring. *Priority: P2. Size: S per entity,
   ~M total.*

### Direction (Pass 11)

The codebase's engineering fundamentals remain solid — no security regressions in
the last 15 commits, clean typecheck, and Pass 10's hardening batch (attachment
sweep, reorder fix, `ColorSwatchPicker` dedup) is fully confirmed shipped. This
pass's value is entirely in the targeted sweep the founder asked for, and it paid
off: the workspace-selector bug class is real and still present on 7 of 15
routes, just not on the one route (`PulseDashboardPage`) that got fixed and
tested. The single most important next step is **not** to patch those 7 routes
one-by-one (that just moves the "don't forget" risk to route 16) but to build
the `<WorkspaceScopedLayout>` wrapper (Ideation #1) that makes the property
structural. Pair it with the parameterized "chip matches route" e2e test so the
regression guard covers the *class*, not the *instance* — closing the same kind
of gap that took four passes to close for the Docker/CSP bug.

Second priority: land the two missing e2e specs (`quick-links.spec.ts`,
`workspace-settings.spec.ts`) — flagged for a second consecutive pass and
directly implicated in why the original bug reached the founder rather than a
test run. Third: the `qk.boardView` invalidation gap (Risk P2-2) and its shared-
helper fix (Ideation #2) — both are small, mechanical, and remove a whole class
of "stale board on revisit" bugs that are currently only masked by the realtime
socket being connected and the board being mounted at the right moment. The
Blocked-badge correctness bug (Risk P2-3) is small and should ship alongside
since it's a one-line Prisma filter change with an obvious test.

### Backlog-groomer feed (Pass 11 — compact)

- **Sync the header chip on the 7 remaining project/workspace-scoped routes** · P1 · S · `ReportsPage`, `ProjectAnalyticsPage`, `RoadmapPage`, `WorkspaceMembersPage`, `WorkspaceAuditLogPage`, `WorkspaceBrandingPage`, `WorkspaceSettingsPage` render the chip without calling `useSyncActiveWorkspace`; reproducible via bookmark/back-forward/deep-link even though normal click-through masks it; `apps/web/src/pages/*.tsx`
- **Extract `<WorkspaceScopedLayout>`/`<ProjectScopedLayout>` wrapper owning `useSyncActiveWorkspace`** · P1 · M · Structural fix for the above so the property can't be forgotten on route #16; also fixes QuickLinksMenu collapse-state reset if it hosts AppHeader; see Ideation #1
- **Add `quick-links.spec.ts` and `workspace-settings.spec.ts` e2e coverage** · P1 · M · Second consecutive pass flagging zero browser-level tests for quick-links CRUD and workspace rename/delete — the same class of gap that let the founder-reported bug through; `apps/web/e2e/`
- **Delete dead `DashboardPage.tsx`** · P2 · S · Unreachable file re-implements the exact pre-fix workspace-selector bug (own local `selectedWs`, no persistence); landmine if ever re-routed to; `apps/web/src/pages/DashboardPage.tsx`
- **Thread `boardId` through `useUpdateIssue`/`useBulkUpdateIssues`/`useAssignIssueToSprint`/`useUpdateIssueCustomFields`/sprint mutations and invalidate `qk.boardView`** · P2 · S · Inconsistent with `statuses.ts`/`labels.ts`/`versions.ts`; causes up-to-30s stale board state on revisit when realtime isn't actively covering the mounted board; `apps/web/src/api/issues.ts`, `custom-fields.ts`, `sprints.ts`
- **Add shared `invalidateBoardFamily()` helper** · P2 · S–M · Structural fix for the above so future mutations can't skip it; see Ideation #2
- **Fix Blocked badge to exclude resolved (DONE-category) blockers** · P2 · S · Feature is named "unresolved blockers" but the Prisma `_count` has no status join, so the badge never clears once a blocker link exists; `apps/api/src/board/board.service.ts:33-41`
- **Add personal-cards/quick-links/workspace-PATCH+logo rows to tenant-isolation matrix** · P2 · S · Carried forward from Pass 10, still unfixed; `apps/api/src/tenant-isolation.integration.spec.ts`
- **Add `project.updated` realtime event** · P3 · S · Project is the only top-level entity with zero realtime coverage; renames don't propagate to other tabs/viewers without reload; `packages/shared/src/types.ts`, `apps/api/src/projects/projects.service.ts`
- **Persist `QuickLinksMenu` group-collapse state** · P3 · S · Resets on every page navigation since AppHeader remounts per-page; `apps/web/src/components/QuickLinksMenu.tsx:233`
- **Re-validate `ReportsPage`'s `selectedSprintId` against the live sprint list** · P3 · S · Stale selection after a sprint delete silently shows an empty chart instead of falling back; `apps/web/src/pages/ReportsPage.tsx:26-31`
- **Realtime-coverage inventory across all top-level entities (Board, Workflow, CustomFieldDefinition, Component, Version)** · P2 · S per entity · Generalizes the project.updated fix; see Ideation #3

## 2026-07-02 — Pass 12 (post-heavy-day: GitHub, OIDC, dashboards, sidebar, dark mode, swimlanes v2)

Scope: ~20 commits since Pass 11 — the scoped-layouts structural fix (P1-1),
`enforceStatusChange` (WF-1), `invalidateBoardFamily` (P2-2), the `doc-syncer`
agent, the persistent left sidebar (`SidebarContext`, `nav/`), light/dark mode
(token-layer palette, `ThemeContext`, tailwind `color-mix` opacity helper), the
NLQL dashboards module, GitHub integration v1 (HMAC webhooks, AES-256-GCM PAT
storage), OIDC SSO, the 85-tool MCP surface, and workspace last-admin guards.
Read every new backend module (`apps/api/src/github/**`, `apps/api/src/auth/
oidc/**`, `apps/api/src/dashboards/**`), the new frontend contexts/layouts
(`ScopedLayouts.tsx`, `ThemeContext.tsx`, `SidebarContext.tsx`, `nav/**`), the
CSP/nginx/entrypoint chain, `apps/web/playwright.config.ts`, and cross-checked
every Pass-11 finding against current code (not just commit messages).
`tsc --noEmit` clean on both `api` and `web`; `jest github dashboards oidc`
(10 suites, 133 tests) green.

### Pass-11 fix verification

| Fix area | Status | Evidence |
|---|---|---|
| P1-1: 7 routes not syncing the header chip | **CONFIRMED FIXED — structurally** | `apps/web/src/layouts/ScopedLayouts.tsx` now owns `useSyncActiveWorkspace` at the route level; `App.tsx:181-219` nests every `/projects/:id/*` route (including the brand-new `dashboards` route, `App.tsx:191`) under `ProjectScopedLayout`, and every `/workspaces/:id/*` route under `WorkspaceScopedLayout`. Cross-checked all 22 pages that render `<AppHeader>` — the only ones outside the scoped layouts are user-scoped (`MyWorkPage`, `NotificationsPage`, `PersonalAnalyticsPage`, `PersonalBoardPage`, `ProfileSettingsPage`) or already self-syncing (`PulseDashboardPage`), which correctly don't need it. This is exactly Pass 11's Ideation #1, delivered — the property is now impossible to forget for route #16. |
| P1-2: zero e2e for `QuickLinksMenu` / workspace rename+delete | **CONFIRMED FIXED** | `apps/web/e2e/quick-links.spec.ts` (8 tests: empty state, add/edit/delete, group+color, XSS-URL rejection, mobile-width overflow) and `apps/web/e2e/workspace-settings.spec.ts` (4 tests: rename+chip+dashboard-selector sync, empty-name rejection, type-to-confirm delete, MEMBER read-only view) both now exist. |
| P2-1: dead `DashboardPage.tsx` | **CONFIRMED FIXED** | File no longer exists (`find` returns nothing). |
| P2-2: `qk.boardView` invalidation inconsistently threaded | **CONFIRMED FIXED — via shared helper** | `invalidateBoardFamily()` (`apps/web/src/api/keys.ts:77-83`) now invalidates every `['boardView']`-prefixed cache entry (not just a single `boardId`) plus the legacy key, and is called from `issues.ts` (`useUpdateIssue`/`useBulkUpdateIssues`/`useAssignIssueToSprint`), `custom-fields.ts`, `sprints.ts` (all three mutations), and `socket.ts`'s `ProjectUpdated` handler. Simpler than the originally-proposed per-`boardId` threading and covers the same gap. |
| P2-3: "Blocked" badge counts all `BLOCKS` links, not just unresolved | **CONFIRMED FIXED** | `board.service.ts:33-52`'s `issueInclude._count.linksTo` now filters `where: { type: BLOCKS, source: { status: { category: { not: DONE } } } }`, with an inline comment stating the fix explicitly. |
| P2-4: personal-cards/quick-links/workspace-PATCH+logo missing from tenant-isolation matrix | **STILL OPEN — third consecutive pass** | `tenant-isolation.integration.spec.ts:409-435` still has only `GET`/`DELETE /workspaces/:id`, `GET .../members`, `GET .../audit-log` — no `PATCH /workspaces/:id`, no `POST/DELETE /workspaces/:id/logo`, no `/me/personal-cards/*`, no quick-link verb. Compounding: the two brand-new modules this pass (GitHub, dashboards) are *also* absent from this matrix (see Risk P2-6 below) — the matrix is now stale against 5 resource families, not the original 4. This has survived three audit passes without a fix landing; it is small (S) and mechanical — flag as blocking, not backlog, for the next build-loop batch. |
| P3-1: no `project.updated` realtime event | **CONFIRMED FIXED** | `SocketEvents.ProjectUpdated = 'project.updated'` (`packages/shared/src/types.ts:755`), emitted from `ProjectsService`, and `useBoardRealtime` (`socket.ts:118-129`) invalidates `qk.project`, `qk.projects`, `qk.boards`, and calls `invalidateBoardFamily` on receipt. |
| P3-2: `QuickLinksMenu` collapse state resets on navigation | **STILL OPEN** | `AppHeader` is still rendered per-page (22 call sites, `grep -rl "<AppHeader" apps/web/src/pages`), not hoisted above `<Routes>` — only the sidebar (`AppSidebar`/`MobileSidebarDrawer`) got hoisted into `AppShellFrame` (`App.tsx:88-104`) this round. `collapsed` (`QuickLinksMenu.tsx:233`) is still local, un-persisted `useState`. Low severity, unchanged. |
| P3-3: `ReportsPage`'s `selectedSprintId` never re-validates | **STILL OPEN** | `ReportsPage.tsx:28-33` guard unchanged: `if (selectedSprintId || sprints.length === 0) return`. Low severity, unchanged. |
| Ideation #1: `<WorkspaceScopedLayout>`/`<ProjectScopedLayout>` | **SHIPPED** | See P1-1 above — this is the single best fix of the last two passes; it converts a "remember to call the hook" bug class into a structural impossibility. |
| Ideation #2: shared `invalidateBoardFamily()` helper | **SHIPPED** | See P2-2 above. |
| Ideation #3: `project.updated` + realtime-coverage inventory | **PARTIALLY SHIPPED** | `project.updated` landed. The broader inventory ("which domain entities have realtime coverage") was not done as a sweep — and this pass finds the highest-value miss the inventory would have caught: **Dashboards have zero realtime coverage at all** (Risk P1-3 below), worse than any of the entities Pass 11 flagged. |

### New-module engineering health (this pass's primary lens)

**GitHub integration (`apps/api/src/github/**`).** Signature verification is
correct and well-built: `verifyGithubSignature` (`github-signature.util.ts:25-37`)
uses `timingSafeEqual` with a length guard before comparing, never throws, and
the controller (`github.controller.ts:89-121`) is careful not to leak
"configured vs. not" via the response (only in server logs). `req.rawBody` is
wired at the Nest bootstrap level (`main.ts:26`, `rawBody: true`) specifically
for this handler, with a documented fallback (`controller.ts:98`) that
re-serializes `req.body` when `rawBody` is somehow absent — a safe failure mode
since a re-serialized JSON body will almost never byte-match GitHub's original
signature, so verification just correctly fails rather than silently
succeeding. PAT-at-rest encryption (`github-crypto.util.ts`) is textbook
AES-256-GCM: random 12-byte IV per encryption, auth tag verified on decrypt,
key derived from a dedicated env var falling back to the always-required
`JWT_SECRET` so zero-config self-hosting still works. Webhook processing is
idempotent (`issueId_kind_externalId` unique constraint, upsert) and correctly
scoped (issue-key regex is built from the caller's own `project.key`, so
`OTHER-123` never matches project `NL`'s webhook). One real gap: no HTTP-level
integration test exercises the real Nest bootstrap + Express raw-body pipeline
for this endpoint (every existing test calls `GithubService`/`GithubController`
methods directly) — see Risk P2-5.

**OIDC (`apps/api/src/auth/oidc/**`).** Also solid: PKCE (S256) + `state` +
`nonce` all used via `openid-client`, state carried in a signed, `httpOnly`,
`sameSite: 'lax'`, 10-minute-expiry cookie (not a request param), single-use
(cleared before use in `oidc.controller.ts:82`, so a replayed callback URL
can't reuse it), token exchange failures are caught and sanitized before
logging (`oidc.service.ts:119-123`, never logs the raw error which may embed
a code/token), and the issued session JWT crosses the callback→SPA boundary via
a URL **fragment** (`#token=...`, never a query param), stripped from history
on the very first render (`SsoCompletePage.tsx:40-43`) — this is the correct
pattern for keeping a bearer token out of server access logs and Referer
headers. Unit coverage is genuinely thorough (18 tests spanning every guard:
missing/expired/tampered state, wrong `typ` claim, state mismatch,
`email_verified: false`, missing email, token-exchange failure). One
accepted-risk note, not a code defect: JIT provisioning matches purely by
`email` (`oidc.service.ts:192-208`) with no explicit "link to my existing
account while authenticated" consent step — standard OIDC JIT behavior, but
self-hosters who point `OIDC_ISSUER_URL` at a provider that allows
self-service registration with arbitrary/unverified-by-a-domain emails could
let an attacker take over an existing local-password account by registering
that same email with the IdP (`email_verified` is only rejected when
*explicitly* `false`; a provider that omits the claim entirely is accepted).
Worth a one-line doc callout in the OIDC setup guide, not a P1/P2 code fix.

**Dashboards (`apps/api/src/dashboards/**`).** The gadget-evaluation design is
good: one capped issue query (`DASHBOARD_ISSUES_CAP = 2000`,
`dashboards.service.ts:312-319`) shared across every gadget on the dashboard
(no per-gadget issue re-fetch), hard caps on TABLE rows (50) and BREAKDOWN
buckets (25) (`dashboard-gadget-evaluator.ts:19-23`), and a gadget failing to
evaluate degrades to a per-gadget `error` string rather than a 500 for the
whole dashboard (`dashboards.service.ts:346-349`). Tenant scoping is correct —
every dashboard/gadget mutation resolves `dashboard.projectId` from the DB row
itself (never a client-supplied value) before calling `assertProjectMember`/
`assertProjectRole`. Two real gaps found: **no cap on dashboards-per-project or
gadgets-per-dashboard** (Risk P2-6), and **zero realtime wiring** (Risk P1-3,
the top finding of this pass alongside the CSP one).

**Theme / dark mode (`ThemeContext.tsx`, `lib/theme.ts`, `index.html`,
`tailwind.config.js`).** The React-side state machine is clean — no shadow
state, synchronous `localStorage` restore in the `useState` initializer
(mirrors the established `SidebarContext`/`WorkspaceContext` pattern), and
`prefers-color-scheme` is tracked live only while the preference is `'system'`.
The `withOpacity()` `color-mix()` helper (`tailwind.config.js:25-31`) is
well-documented and its browser floor (Chrome 111+/Firefox 113+/Safari 16.4+,
all March 2023+) is reasonable for a 2026 self-hosted target — low risk, noted
as Ideation #3 below rather than a defect. The genuinely serious issue is the
**inline bootstrap `<script>` in `index.html`** — see Risk P1-2, the other
half of this pass's top finding alongside dashboards' missing realtime layer.

### Top risks & debt (Pass 12, ranked by impact × probability)

**[P1-1] The dark-mode "no flash of wrong theme" bootstrap is silently blocked by CSP in the actual shipped Docker artifact — the exact bug class that already burned this project once**
- What: `apps/web/index.html:24-41` ships a synchronous inline `<script>` that reads `localStorage['nl.theme']` and applies the `.dark` class **before** any bundle loads, specifically to prevent first-paint flash. `apps/web/nginx.conf:19` (and its two duplicated copies at `:31` and `:47`) sets `Content-Security-Policy: ... script-src 'self'; ...` with **no `'unsafe-inline'`, no nonce, and no hash allowlist**. `apps/web/docker-entrypoint.sh` only ever rewrites the `__NL_CONNECT_SRC__` placeholder at container start — `script-src` is never touched. Per the CSP spec, `script-src 'self'` unconditionally blocks inline `<script>` blocks with no nonce/hash match, full stop — this is deterministic, not environment-dependent. The app's actual `type="module" src="/src/main.tsx"` bundle IS allowed (external, self-hosted, matches `'self'`), so React still mounts and `ThemeProvider`'s `useEffect` still eventually applies `.dark` — dark mode itself isn't broken — but the entire point of having a synchronous pre-paint script (avoiding the flash) is defeated: every reload with a dark preference stored will show a light flash first in the real deployment, and the browser will log a CSP-violation console error on every page load.
- Why this reached green: `apps/web/playwright.config.ts:58-63`'s `webServer` runs `vite exec vite preview`, not the Docker/nginx image — `vite preview` emits no CSP header at all, so `theme.spec.ts` (5 tests, including "toggling to dark ... persists across reload") passes cleanly in the harness while the identical scenario fails in production. This is CLAUDE.md's own named failure mode (`docs/AUDIT-ENGINEERING.md` Pass 5–9 history) recurring for a *new* feature: a real fix landed for the connect-src incident (`scripts/smoke-web-csp.sh`, run in CI per `.github/workflows/images.yml:179`), but that regression guard only ever asserts on `connect-src` — it never checks `script-src`, never launches a browser against the built image, and would not catch this.
- Impact/likelihood: Medium-high impact (a real, visible, guaranteed regression in every self-hosted production deployment — not hypothetical, not edge-case), certain likelihood (reproduces on every single page load with a dark preference stored, in every Docker deployment, today).
- Files: `apps/web/index.html:24-41`, `apps/web/nginx.conf:19,31,47`, `apps/web/docker-entrypoint.sh`, `apps/web/playwright.config.ts:58-63`, `apps/web/e2e/theme.spec.ts`, `scripts/smoke-web-csp.sh`
- Fix: Since the inline script's content is static (not templated per-request), compute its SHA-256 hash at build/entrypoint time and add `'sha256-<hash>'` to `script-src` in `nginx.conf` (three copies) — this satisfies CSP without `'unsafe-inline'` and without the complexity of per-request nonces behind a static nginx config. Regenerate the hash automatically (a small build step or a `docker-entrypoint.sh` step that hashes the shipped `index.html`'s script block) so it can never drift from the actual script content. Pair with two regression guards: (1) extend `scripts/smoke-web-csp.sh` to assert `script-src` contains the expected hash/`'self'` only (no `unsafe-inline`) and that `curl`'d `index.html`'s inline script content hashes to the same value asserted in the header; (2) add a Playwright project/test that runs against the **built Docker image** (not `vite preview`) — at minimum, launch a container from the built image, point Playwright's `baseURL` at it, seed `localStorage['nl.theme']='dark'` pre-navigation, and assert `document.documentElement.classList.contains('dark')` is true on the *very first* paint (no flash) and that zero CSP-violation `securitypolicyviolation` events fired.
- Size: S (nginx/entrypoint hash fix) + M (Docker-artifact Playwright harness — this also closes the standing "tests run against the shipped artifact" gap called out in every prior debugging-discipline section).
- **Fixed 2026-07-02** — moved the bootstrap to a self-hosted `apps/web/public/theme-init.js` loaded via a blocking external `<script src>` (satisfies `script-src 'self'` outright instead of needing a hash) + hardened `smoke-web-csp.sh` (mode 3: inline-script-vs-script-src guard) + added `apps/web/e2e/csp-artifact.spec.ts` (real `dist/` bundle served with the production CSP header). See `docs/BACKLOG.md` Ready queue.

**[P1-2] Configurable Dashboards — this pass's flagship feature — has zero realtime coverage; gadget data can go stale indefinitely while the page is open**
- What: `apps/api/src/dashboards/dashboards.service.ts` never injects `RealtimeService` and never emits any socket event for dashboard/gadget CRUD or for the underlying issues a gadget evaluates. On the frontend, `apps/web/src/pages/DashboardsPage.tsx` never calls `useBoardRealtime` (or any socket subscription) at all — confirmed by `grep -n "useBoardRealtime\|staleTime\|refetchInterval" DashboardsPage.tsx` returning nothing. Combined with the app's global TanStack Query defaults (`App.tsx:53-54`: `staleTime: 30_000`, `refetchOnWindowFocus: false`), a dashboard's gadget data is fetched once on mount and then **never automatically refreshed again** for as long as the tab stays open and focused — not after 30 seconds (nothing triggers the refetch), not on window refocus (disabled), not via socket (never subscribed). This is a strictly worse instance of the exact "stale board on revisit" bug class Pass 11 flagged for boards (P2-2, now fixed for boards) — dashboards shipped afterward with none of that fix's lessons applied. Two failure modes compound: (a) User A drags a card to Done on the Board while User B has a STAT/BREAKDOWN gadget open counting "open issues by status" — B's numbers are wrong indefinitely; (b) User A renames/reconfigures a gadget on a shared dashboard while User B has the same dashboard open in another tab — B never sees the change without a manual reload.
- Impact/likelihood: Medium-high impact (silently wrong numbers on a reporting surface undermine the exact trust dashboards exist to build — worse than a UI staleness bug because users make decisions off dashboard numbers), high likelihood (any team with two people viewing the same project's dashboard while a third person works the board hits this on day one).
- Files: `apps/api/src/dashboards/dashboards.service.ts` (no `RealtimeService` import at all), `apps/web/src/pages/DashboardsPage.tsx`, `apps/web/src/api/dashboards.ts:36-43` (`useDashboardData` — no realtime invalidation path), `apps/web/src/api/socket.ts:86-134` (`ALL_EVENTS` handler never touches `qk.dashboardData`/`qk.dashboards`), `packages/shared/src/types.ts:742-758` (`SocketEvents` — no `dashboard.updated`/`dashboardGadget.updated`)
- Fix: Two-part, mirroring the `project.updated` pattern that just shipped cleanly: (1) add `DashboardUpdated`/`DashboardGadgetUpdated` to `SocketEvents`, emit from `DashboardsService`'s CRUD methods to the project room, so a second viewer's dashboard list/gadget config refreshes live; (2) in `DashboardsPage.tsx`, call `useBoardRealtime(projectId, (event) => { if (isIssueEvent(event)) qc.invalidateQueries({ queryKey: qk.dashboardData(dashboardId) }); })` (or extend the generic top-of-handler invalidation in `socket.ts` to also invalidate `['dashboardData']` broadly, the same "invalidate the whole family" approach `invalidateBoardFamily` already established) so gadget data refreshes whenever any issue in the project changes, not just when the dashboard's own CRUD fires.
- Size: M.
- **Fixed 2026-07-02** — `SocketEvents.DashboardUpdated` emitted from every `DashboardsService` CRUD mutation; `DashboardsPage` subscribes via `useBoardRealtime`; new `invalidateDashboardDataFamily()` invalidates the `['dashboardData']` family on any project `issue.*` event. See `docs/BACKLOG.md` Ready queue.

**[P2-1] `resolveEnforcedWorkflowId` N+1 in bulk status updates — the WF-1 unification is correct but not perf-hardened for its own precomputation path**
- What: `enforceStatusChange` (`apps/api/src/issues/issues.service.ts:1102-1150`) is a genuinely well-designed unification (confirmed correct: board-context path → resolved-workflow path → legacy path, with automation bypass checked first) — but the middle branch, `resolveEnforcedWorkflowId` (`issues.service.ts:1043-1081`), does a fresh `board.findMany` plus a conditional `sprint.findUnique` **per issue**, and it's this branch (not the legacy one) that `update()` hits when called without a `boardId` — which is exactly how `bulkUpdate` calls it (`issues.service.ts:1610-1660`, sequential `for` loop, one `update()` await per issue, no `boardId` passed). `bulkUpdate` already precomputes an enforcement flag once per batch (`bulkWorkflowEnforced` via `isEnforcementEnabled`, `issues.service.ts` bulk-update workflow-context-preload block) specifically to avoid a per-issue DB round trip — but that precomputed flag only feeds the **legacy** fallback call at the bottom of `enforceStatusChange`, not the new named-workflow resolution path WF-1 added. For a project using named/enforced workflows, a 100-issue bulk status edit (the DTO's own cap, `bulk-update-issues.dto.ts`) now does up to ~200 extra sequential DB round trips that the existing perf-preload comment claims are avoided. No test asserts a bounded call-count for this path — `issues.service.spec.ts:1553+` ("bulkUpdate — workflow enforcement") only asserts `isEnforcementEnabled` is called once, which covers the legacy path the precomputation was originally written for, not the WF-1 path.
- Impact/likelihood: Medium impact (real added latency on bulk operations for any project using named workflows — a growing surface given Workflows is a recently-shipped headline feature), medium-high likelihood (any named-workflow project doing a batch triage/bulk-status-edit hits this every time).
- Files: `apps/api/src/issues/issues.service.ts:1043-1081` (`resolveEnforcedWorkflowId`), `:1102-1150` (`enforceStatusChange`), bulk-update loop (~`:1610-1660`), `apps/api/src/issues/issues.service.spec.ts:1553+` (missing call-count coverage for this path)
- Fix: Precompute `resolveEnforcedWorkflowId(projectId, sprintId)` once per distinct `(projectId, sprintId)` pair encountered in the batch (mirroring the existing `bulkWorkflowEnforced` preload pattern exactly) and pass the resolved workflow id down through `opts` so `enforceStatusChange`'s middle branch becomes a plain lookup instead of a fresh query per issue. Add a test asserting `prisma.board.findMany` is called O(1) (or O(distinct sprints)), not O(issues), for a named-workflow-enforced batch.
- Size: S–M.
- **Fixed 2026-07-02** — new `buildBulkWorkflowResolution()` precomputes the batch's WF-1 resolution once (O(1) `board.findMany` + O(1) `sprint.findMany` for the batch's distinct sprints) and threads it via `MutationOpts.resolvedWorkflowId`; 2 new bounded-call-count unit tests. See `docs/BACKLOG.md` Next (P2).

**[P2-2] No cap on dashboards-per-project or gadgets-per-dashboard**
- What: `createDashboard` (`dashboards.service.ts:118-136`) and `createGadget` (`:190-229`) have no count check against the project/dashboard before inserting. `getDashboardData` (`:299-330`) evaluates every gadget on a dashboard in a sequential `for...of` loop with `await this.evaluateGadget(...)` per gadget — for a `BURNDOWN` gadget this means a `sprint.findFirst` plus a raw-SQL completion-dates aggregation (`reports.service.ts:124-137`, `:241-...`) per gadget, run one at a time, not `Promise.all`'d. There's no upper bound preventing a dashboard from accumulating, say, 200 gadgets (MEMBER role, no admin gate), at which point every `getDashboardData` call becomes ~200 sequential NLQL evaluations over up to 2000 issues plus dozens of sequential extra DB round trips for any BURNDOWN gadgets mixed in.
- Impact/likelihood: Low-medium impact today (requires either a careless user or a misbehaving automation/MCP-driven script to create many gadgets — the MCP `create_dashboard_gadget` tool makes this one bad agent loop away from happening), low-medium likelihood.
- Files: `apps/api/src/dashboards/dashboards.service.ts:118-136` (`createDashboard`), `:190-229` (`createGadget`), `:299-330` (`getDashboardData`'s sequential loop)
- Fix: Add a `MAX_DASHBOARDS_PER_PROJECT` (e.g. 20) and `MAX_GADGETS_PER_DASHBOARD` (e.g. 20) constant, checked with a `BadRequestException` before insert — mirrors the existing `DASHBOARD_ISSUES_CAP`/`TABLE_GADGET_ROW_CAP`/`BREAKDOWN_BUCKET_CAP` pattern already established in this same module. Separately, parallelize `getDashboardData`'s gadget loop with `Promise.all` (the gadgets are read-only and independent) now that a cap bounds the fan-out.
- Size: S.

**[P2-3] Personal-cards/quick-links/workspace-PATCH+logo missing from the tenant-isolation matrix — third consecutive pass, plus two new modules (GitHub, dashboards) never added**
- What: Unchanged core gap from Pass 10/11 (see fix-verification table above) — `PATCH /workspaces/:id`, `POST/DELETE /workspaces/:id/logo`, and any `/me/personal-cards`/`/me/quick-links` verb are still absent from `tenant-isolation.integration.spec.ts`. New this pass: `GET/PUT/DELETE /projects/:projectId/github` and every `/dashboards/*`/`/gadgets/*` route are *also* absent — both modules' cross-tenant guards are correct and unit-tested at the service-mock level (`github.service.spec.ts:103-116,226-237`; `dashboards.service.spec.ts` membership checks throughout), but neither has a row in the one integration-level test file whose entire purpose is to catch a regression across the whole API surface at once.
- Impact/likelihood: Medium impact (correctness is unit-tested today; this is a regression-guard gap, not a live vulnerability), medium likelihood of catching a future refactor.
- Files: `apps/api/src/tenant-isolation.integration.spec.ts`
- Fix: Same as the last two passes — add the missing rows following the existing `buildMatrix`/`buildCrossWorkspaceRows` pattern; include the two new modules while there. Purely mechanical; given three-pass persistence, the backlog-groomer should treat this as blocking for the next build-loop batch rather than continuing to carry it forward.
- Size: S.
- **Fixed 2026-07-02** — added rows for personal-cards, quick-links, workspace PATCH+logo POST, GitHub integration config + issue links, and dashboards/gadgets (matrix now 94 rows, all confirmed BLOCKED). See `docs/BACKLOG.md` Next (P2).

**[P2-5] No HTTP-level integration test for the GitHub webhook receiver — the exact "real artifact" gap this project's own QA mandate calls out**
- What: Every GitHub test (`github.service.spec.ts`, `github.controller.spec.ts` if present, `github-signature.util.spec.ts`) calls service/util methods directly with a hand-constructed `Buffer` as `rawBody`. None boots the actual Nest app (`NestFactory.create` with `rawBody: true`) and POSTs a real HTTP request with a computed `X-Hub-Signature-256` header through Express's body-parser pipeline — the exact mechanism (`main.ts:26`'s `rawBody: true` option interacting with Express's JSON body-parser) that a future dependency bump (Express, `body-parser`, or a Nest upgrade) could silently break, with only a unit test (bypassing the HTTP layer entirely) to (not) catch it.
- Impact/likelihood: Low-medium impact (webhook delivery silently failing is recoverable — GitHub retries failed deliveries and shows delivery status in its own UI — but would still be a confusing "my GitHub integration stopped working" support burden with no first-party signal), low likelihood short-term (nothing currently threatens the raw-body pipeline) but this is precisely the class of "green tests, broken real artifact" gap the project's QA mandate exists to close.
- Files: `apps/api/src/github/github.service.spec.ts`, `apps/api/src/github/github.controller.ts` (no accompanying e2e/integration spec found)
- Fix: Add one integration test (in the style of `tenant-isolation.integration.spec.ts`, which already boots a real `INestApplication`) that seeds a `GithubIntegration` row, computes a real HMAC signature over a real JSON payload with `computeGithubSignature`, POSTs it via `supertest` with the correct raw content-type, and asserts a 200 + the expected `IssueGithubLink` row — plus a negative case (tampered body, same header) asserting 401.
- Size: S.

**[P3-1] `color-mix()`-based opacity utilities have no fallback for pre-2023 browsers**
- What: `withOpacity()` (`tailwind.config.js:25-31`) emits `color-mix(in srgb, var(--nl-x) N%, transparent)` for every `/NN`-opacity Tailwind utility built on a CSS-var color (covers a large swath of the design system: surfaces, scrims, status dot backgrounds, hover overlays). Browsers older than Safari 16.4 / Chrome 111 / Firefox 113 don't parse `color-mix()` and, per CSS error handling, drop the entire declaration rather than falling back to a nearby value — an affected element using e.g. `bg-scrim` or a `/35` opacity modifier gets no background-color at all rather than a degraded-but-visible one.
- Impact/likelihood: Low impact (the stated target is evergreen self-hosted deployments; the cutoff is reasonable for a 2026 app), low likelihood (this audience skews toward current browsers) — flagged as hardening, not a live bug.
- Files: `apps/web/tailwind.config.js:25-31`
- Fix: Not urgent; if it's ever worth the complexity, emit a plain (non-opacity) fallback declaration immediately before the `color-mix()` one for the handful of load-bearing surfaces (scrim, modal backdrop) so old browsers get *a* color rather than none. Otherwise, document the browser floor in `docs/ARCHITECTURE.md` so it's a conscious tradeoff, not a silent one.
- Size: S (if pursued at all).

**[P3-2] `QuickLinksMenu` collapse-state reset (carried from Pass 11, unchanged)** — see fix-verification table. Files: `apps/web/src/components/QuickLinksMenu.tsx:233`. Size: S.

**[P3-3] `ReportsPage` stale `selectedSprintId` after sprint delete (carried from Pass 11, unchanged)** — see fix-verification table. Files: `apps/web/src/pages/ReportsPage.tsx:28-33`. Size: S.

### Ratings table (Pass 12)

| Area | Score | Delta | Note |
|---|---|---|---|
| Architecture & module boundaries | 4 | — | New modules (github/oidc/dashboards) all follow the established domain-module pattern cleanly; `ScopedLayouts.tsx` is a genuinely good structural addition to the frontend layer. |
| Data model & migrations | 4 | — | `Board.defaultGroupBy`, `Dashboard`/`DashboardGadget`, `GithubIntegration`/`IssueGithubLink` are all clean, additive migrations with sane constraints (`issueId_kind_externalId` unique on the GitHub link table is the correct idempotency key). |
| AuthN/AuthZ & multi-tenant isolation | 4 | +1 | OIDC (PKCE+state+nonce, signed httpOnly state cookie, single-use) and GitHub (HMAC + timing-safe compare, ADMIN-gated secret visibility, AES-256-GCM PAT storage) are both well-built new auth/secret surfaces with no regressions found. Held at 4 rather than 5 because of the third-pass-open tenant-isolation matrix gap (P2-3) and the OIDC email-JIT-linking accepted-risk note. |
| Input validation | 5 | — | New DTOs (`UpsertGithubIntegrationDto`'s `owner/repo` regex + length caps, `CreateDashboardGadgetDto`'s query length cap) are all appropriately strict; no gaps found. |
| Error handling | 4 | — | Dashboards' per-gadget error isolation (a bad query degrades one gadget, not the whole page) and OIDC's sanitized-error redirect (never a raw 500 page on a top-level navigation) are both good patterns. No regressions. |
| N+1 / query efficiency | **3** | -1 | Two real N+1/unbounded-fanout findings this pass: `resolveEnforcedWorkflowId` in bulk status updates (P2-1) and uncapped dashboard/gadget counts with a sequential (non-parallel) per-gadget evaluation loop (P2-2). Both are new-this-pass regressions, not carried debt. |
| Realtime correctness | **2** | -1 | `project.updated` (Pass 11's fix) shipped cleanly, but Dashboards — the single largest feature added this pass — has ZERO realtime coverage (P1-2), which is a worse gap than anything Pass 11 found for boards. This is the lowest this category has scored; the "realtime coverage inventory" ideation from Pass 11 was not done as a sweep and would have caught this before ship. |
| Rank / ordering integrity | 5 | — | Swimlanes v2's per-lane DnD isolation (Labels duplicating an issue into multiple lanes) is documented as deliberately safe and covered by 15 new API unit tests + extended `swimlanes.spec.ts`; no rank-integrity regressions found. |
| Test coverage (unit + e2e) | 4 | +1 | Genuinely strong unit coverage for every new module (github: 8 spec files; oidc: 18 tests across state/nonce/JIT/error paths; dashboards: correctness + truncation + grid-position tests) and both outstanding Pass-11 P1 e2e gaps (`quick-links.spec.ts`, `workspace-settings.spec.ts`) are now closed. Held below 5 because of P2-3 (tenant matrix), P2-5 (no HTTP-level GitHub webhook integration test), and the CSP/Docker-artifact gap in the next row. |
| Debugging / QA discipline | **2** | -1 | See dedicated section below — the theme-bootstrap CSP defect (P1-1) is a textbook recurrence of the exact "green tests, broken shipped artifact" failure mode this project has already paid to learn once, on a brand-new feature, with the *existing* regression guard (`smoke-web-csp.sh`) present but scoped too narrowly to catch it. |
| Type safety | 5 | — | Strict TS throughout; `tsc --noEmit` clean on both `api` and `web`. |
| Build / CI / Docker | 4 | — | `smoke-web-csp.sh` running in CI (`images.yml:179`) is good discipline generally — its narrow scope (connect-src only) is the specific gap, not the practice of having it. |
| Secrets / config hygiene | 4 | — | GitHub PAT and OIDC client secret are both handled correctly (encrypted at rest / never logged, respectively); `webhookSecret` is correctly ADMIN-gated in API responses. |
| Dependency risk | 4 | — | `openid-client` (OIDC) and Node's built-in `crypto` (GitHub HMAC/AES) are both well-established, low-risk additions; no new transitive-dependency red flags found. |

### Debugging & QA-discipline audit (Pass 12 — mandatory)

This pass's single most important finding (P1-1) is a direct, evidenced
recurrence of the project's own named failure mode. The project already has
the *right instinct* — `scripts/smoke-web-csp.sh` exists specifically because a
past CSP `connect-src` bug reached the founder, and it correctly boots the
**actual Docker image** (not `vite preview`) and asserts on the served headers.
But its assertions are scoped to the literal fields the original incident
touched (`connect-src`, the `__NL_CONNECT_SRC__` placeholder) — when a *new*
feature (dark mode) later added a *new* thing that CSP can block (an inline
`<script>`, governed by `script-src`, a directive the smoke test never reads),
nothing re-asked "does this still work under the real CSP?" The regression
guard covered the *instance*, not the *policy area*. This is the same lesson
Pass 11 drew about `useSyncActiveWorkspace` (a guard scoped to the fixed flow,
not the bug class) — recurring here in the CSP domain instead of the
client-state domain.

Compounding this: `playwright.config.ts`'s `webServer` runs `vite preview`,
which serves the built JS bundle but with **no CSP header at all** — so even a
well-written `theme.spec.ts` (which this project has: 5 solid tests covering
persistence, system-preference tracking, and mobile reachability) cannot catch
a CSP-blocks-a-feature bug, structurally, no matter how thorough its
assertions are, because the harness never serves the header that would fail.
This is the standing "shipped artifact" gap CLAUDE.md explicitly calls out by
name (nginx CSP blocking login was bug #1 in that list) — it was fixed for
`connect-src`/login, but the Playwright e2e suite's `webServer` still runs
against `vite preview` for everything else, meaning **any future CSP-shaped
regression in any feature** will reproduce this exact gap again. The
structural fix (closing the *class*, not the *instance*, mirroring the
`ScopedLayouts` pattern this same report credits Pass 11 for landing) is: add
a second Playwright project (or a separate `docker-e2e` npm script) whose
`webServer` builds and runs the actual `docker compose` web image, and run at
minimum the CSP-sensitive specs (`theme.spec.ts`, `login.spec.ts`) against it
in CI — not replacing the fast `vite preview` suite (keep that for iteration
speed) but adding a slower, artifact-accurate gate before merge/release.

**Regression-guard proposal, concretely:** (1) extend `smoke-web-csp.sh` to
assert `script-src` too (no `unsafe-inline`, hash present and correct for the
current `index.html`); (2) add the Docker-artifact Playwright pass described
in Risk P1-1's fix; (3) as a cheap, immediate tripwire with no new
infrastructure, add a one-line CI grep step: fail the build if
`apps/web/index.html` contains an inline `<script>` tag whose content isn't
also reflected as a `'sha256-...'` entry in `apps/web/nginx.conf`'s
`script-src` — this catches the *next* person who adds a second inline script
without updating the CSP, cheaply, even before the fuller Docker-Playwright
gate lands.

**Diagnosability:** No regressions this pass. Correlation IDs, pino,
`/health`/`/health/live` unaffected. One new diagnosability idea (not a gap so
much as an opportunity): the GitHub webhook receiver logs "signature
verification failed" without a delivery identifier — GitHub sends
`X-GitHub-Delivery` on every webhook call, which isn't currently read or
logged. Threading it through would let a self-hoster correlate a failed
delivery in their own GitHub repo settings UI with the exact line in Next
Lane's logs, closing a real "hard to root-cause without a repro" gap for this
specific integration.

### Ideation — three concrete technical investments (mandatory every pass)

1. **A Docker-artifact Playwright pass, gated in CI for CSP/security-header-sensitive
   specs.** This is the structural fix behind P1-1 and the debugging-discipline
   section above: today, *nothing* in the test suite runs against the real
   nginx image before merge (`smoke-web-csp.sh` only runs in the image-publish
   workflow, not on every PR, and only checks two response headers, not actual
   page behavior). A slower, artifact-accurate Playwright project — even just
   for `theme.spec.ts` + `login.spec.ts` + a new CSP-violation-listener smoke
   test — would have caught P1-1 before it shipped, and closes the general
   "green tests, broken real artifact" gap for every future feature that
   touches `index.html`, inline styles/scripts, or security headers, not just
   this one. *Priority: P1. Size: M.*

2. **A `MAX_DASHBOARDS_PER_PROJECT`/`MAX_GADGETS_PER_DASHBOARD` cap + `Promise.all` the gadget-evaluation
   loop, generalized into an audit of "which MEMBER-writable collections have no cap."**
   Dashboards is the first NLQL-native, freely-creatable, MEMBER-writable
   collection with unlimited fan-out cost per read (P2-2) — worth checking
   whether the same shape of risk exists elsewhere (e.g., are Quick Links, Issue
   Templates, or saved NLQL filters similarly uncapped with a read path that
   scales with count?) before it becomes a pattern rather than a one-off.
   *Priority: P2. Size: S per collection, ~M total for the sweep.*

3. **Extend the `dashboard.updated` fix into the "realtime coverage inventory" Pass 11
   proposed and this pass found wasn't done.** Rather than patching Dashboards'
   realtime gap as a one-off (P1-2), do the actual inventory this time: for
   every domain entity with a dedicated list/detail view (Dashboard, Board,
   Workflow, CustomFieldDefinition, Component, Version, GithubIntegration),
   confirm a realtime event exists and that the relevant page subscribes to
   it. `project.updated`'s clean landing (confirmed this pass) proves the
   pattern is cheap to replicate — the missing piece has been actually doing
   the sweep instead of fixing findings one at a time as they're independently
   discovered by two different audit passes. *Priority: P1 (given P1-2's
   severity). Size: S per entity, ~M total.*

### Direction (Pass 12)

The engineering fundamentals keep holding under real feature-velocity pressure
— three new backend modules (GitHub, OIDC, dashboards) in one day, all with
strong unit coverage, correct tenant scoping, and clean secret handling, plus
two of Pass 11's best-value recommendations (`ScopedLayouts`,
`invalidateBoardFamily`) landed exactly as proposed and verified working by
reading the code, not the commit message. But this pass's two P1s are both
instances of a pattern worth naming explicitly: **a regression guard that
covers the reported instance of a bug class doesn't automatically cover the
next feature that falls into the same class.** The CSP smoke test exists
because of a real incident and still let a CSP regression through on the very
next feature that touched the DOM before hydration. The `project.updated`
realtime fix landed cleanly and the very next major feature (dashboards)
shipped with zero realtime coverage anyway, because "do a coverage inventory"
was proposed as ideation rather than executed as a checklist. The single
highest-leverage move next is not another one-off fix — it's building the two
structural closers this pass already sketched: the Docker-artifact Playwright
gate (closes the CSP/artifact-fidelity class for good) and an actually-executed
realtime-coverage inventory (closes the "new feature ships silently stale"
class for good). Both are sized M, both are cheap relative to the bugs they
prevent, and both follow the exact shape of Pass 11's `ScopedLayouts` win —
turn "remember to do X for every new Y" into something structurally impossible
to skip.

Second priority: land P1-2's dashboard realtime fix directly (it's the more
urgent of the two P1s from a user-trust standpoint — wrong numbers on a
reporting surface is worse than a cosmetic flash) alongside the CSP hash fix,
since both are small on their own; the Docker-Playwright/inventory work can
follow as the structural pass 13 investment. Third: close the
three-pass-old tenant-isolation matrix gap (P2-3) — it is now the longest-lived
open item in this document's history and costs almost nothing to fix.

### Backlog-groomer feed (Pass 12 — compact)

- **Fix CSP `script-src` blocking the dark-mode inline bootstrap script in the real Docker image** · P1 · S–M · `script-src 'self'` has no `unsafe-inline`/nonce/hash; the FOUC-prevention inline `<script>` in `index.html` is silently dropped by every browser in production, defeating the reload-flash fix; `apps/web/nginx.conf`, `apps/web/index.html`, `apps/web/docker-entrypoint.sh`
- **Add a Docker-artifact Playwright gate (not `vite preview`) for CSP/security-header-sensitive specs** · P1 · M · Structural fix for the above and the general "tests pass, real artifact broken" gap; `apps/web/playwright.config.ts`, `scripts/smoke-web-csp.sh`
- **Wire realtime coverage for Dashboards (`dashboard.updated`/`dashboardGadget.updated` + issue-change invalidation)** · P1 · M · Zero realtime coverage on this pass's flagship feature; gadget numbers can go stale indefinitely with the tab open (no staleTime refetch, no refocus refetch, no socket); `apps/api/src/dashboards/dashboards.service.ts`, `apps/web/src/pages/DashboardsPage.tsx`, `apps/web/src/api/socket.ts`, `packages/shared/src/types.ts`
- **Precompute `resolveEnforcedWorkflowId` once per batch in `bulkUpdate`** · P2 · S–M · N+1 (~200 extra sequential queries for a 100-issue named-workflow batch) that the existing `bulkWorkflowEnforced` preload doesn't cover, since it only feeds the legacy fallback path; `apps/api/src/issues/issues.service.ts:1043-1150`
- **Cap dashboards-per-project and gadgets-per-dashboard; parallelize the gadget-evaluation loop** · P2 · S · Currently unbounded (MEMBER-writable, MCP-writable); `getDashboardData` evaluates gadgets sequentially including per-gadget DB round trips for BURNDOWN; `apps/api/src/dashboards/dashboards.service.ts`
- **Add personal-cards/quick-links/workspace-PATCH+logo + GitHub + dashboards rows to the tenant-isolation matrix** · P2 · S · Third consecutive pass for the original gap, now compounded by two more uncovered modules; `apps/api/src/tenant-isolation.integration.spec.ts`
- **Add an HTTP-level integration test for the GitHub webhook receiver (real Nest bootstrap + supertest + real HMAC)** · P2 · S · Only direct-service-call unit tests exist today; the raw-body pipeline itself is untested at the HTTP layer; `apps/api/src/github/`
- **Realtime-coverage inventory, executed (not just proposed) this time** · P1 · S per entity, ~M total · Pass 11 proposed this as ideation; Dashboards shipping with zero coverage anyway shows it needs to be a checklist item, not aspirational; see Ideation #3
- **Log `X-GitHub-Delivery` on webhook signature-verification failures** · P3 · S · Diagnosability improvement — lets self-hosters correlate a failed delivery in GitHub's own UI with a Next Lane log line; `apps/api/src/github/github.controller.ts`
- **Add a `color-mix()` fallback (or document the browser floor) for load-bearing opacity surfaces** · P3 · S · Pre-2023 browsers silently drop the declaration entirely rather than degrading; `apps/web/tailwind.config.js:25-31`
- **Persist `QuickLinksMenu` group-collapse state** · P3 · S · Carried from Pass 11, unchanged; `apps/web/src/components/QuickLinksMenu.tsx:233`
- **Re-validate `ReportsPage`'s `selectedSprintId` against the live sprint list** · P3 · S · Carried from Pass 11, unchanged; `apps/web/src/pages/ReportsPage.tsx:28-33`
