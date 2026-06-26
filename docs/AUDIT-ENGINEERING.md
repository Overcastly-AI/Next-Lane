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
