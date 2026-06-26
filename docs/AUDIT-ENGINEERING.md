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
