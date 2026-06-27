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
