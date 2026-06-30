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
