# Next Lane — Architecture

This document describes how Next Lane is structured and the key technical decisions. For the underlying research and trade-offs, see [`RESEARCH.md`](./RESEARCH.md).

## High-level

Next Lane is a self-hosted issue tracker designed to run on a single machine via Docker Compose. It is a TypeScript monorepo with three deployable concerns plus shared contracts.

```
┌─────────────┐     HTTP/WS      ┌──────────────┐     SQL      ┌────────────┐
│   web       │ ───────────────► │     api      │ ───────────► │ postgres   │
│ React+Vite  │ ◄─────────────── │   NestJS     │ ◄─────────── │            │
└─────────────┘   REST + Socket  └──────┬───────┘              └────────────┘
                                         │ pub/sub, queue
                                         ▼
                                   ┌──────────┐
                                   │  redis   │
                                   └──────────┘
```

## Monorepo layout

| Path | Purpose |
|------|---------|
| `apps/api` | NestJS backend — REST API, WebSocket gateway, Prisma data access |
| `apps/web` | React + Vite single-page app |
| `apps/mcp` | MCP (Model Context Protocol) server — 85 tools for AI agents to read/write workspace state |
| `packages/shared` | Shared TypeScript types, enums, and API contracts used by both sides |
| `docs` | Architecture, roadmap, research |
| `.claude` | Claude Code skills, agents, and workflows for AI-assisted development |

Managed with **pnpm workspaces**.

## Backend (`apps/api`)

- **NestJS** with the standard module/controller/service/dto pattern. Modules by domain: `auth`, `users`, `workspaces`, `projects`, `boards`, `sprints`, `issues`, `custom-fields`, `components`, `versions`, `labels`, `comments`, `issue-links`, `issue-templates`, `checklist`, `work-logs`, `workflows`, `statuses`, `personal-boards`, `saved-filters`, `sprints`, `standups`, `poker`, `automations`, `dashboards`, `notifications`, `webhooks`, `share-tokens`, `dashboard-share-tokens`, `api-tokens`, `analytics`, `reports`, `roadmap`, `attachments`, `audit`, `search`, `realtime`, `mail`, `redis`, `github`, `gitlab`, `gitea`, `pages`, `admin-settings`, `project-memberships`, `agent-context`, and `prisma`. Shared utilities in `common` include SSRF-safe fetch with DNS-pinning (`ssrf-safe-fetch.ts`), idempotency utilities, and secret encryption. Auth includes an optional `oidc` sub-module (Phase 1 — single generic-OIDC provider, env or DB config, left unchanged) and a `sso` sub-module (Phase 2 — SAML 2.0 via `@node-saml/node-saml` + N simultaneously-configured OIDC/SAML providers via additive `SsoProvider` table, with strict assertion validation: signature required and never admin-configurable off, audience always enforced, single-use InResponseTo replay protection, timestamp checks always active).
- **Prisma** as the ORM and migration tool. The schema is the single source of truth for the data model.
- **PostgreSQL** for persistence. JSONB is used for custom fields and color rules.
- **Auth**: JWT access tokens + refresh tokens, password hashing with argon2/bcrypt, route guards for RBAC; optional OIDC/SAML SSO with JIT user provisioning. Phase 1 (unchanged) — the legacy single-provider OIDC config is configurable via environment variables (env-only) or in-app admin screen (`/admin/sso`, gated to `User.isInstanceAdmin` — the first user on a fresh install, or oldest user on an existing install), stored in `OidcConfig`. Phase 2 (Phase 1→2 as of 2026-07-06) — additional OIDC and/or SAML providers configured via the same admin screen's provider list (`/admin/sso-providers`), stored in additive `SsoProvider` table, each provider optionally with its own just-in-time default-workspace/role provisioning rule. SAML assertions are validated strictly: signature always required (never admin-configurable off), audience always enforced, single-use InResponseTo replay protection (Redis-backed when `REDIS_URL` is set, else in-memory), timestamp checks always active. Instance-admin is distinct from workspace-level ADMIN and gates instance-wide settings (e.g., SSO configuration) that predate workspace membership.
- **Workspace members**: `POST /workspaces/:id/members` invites a new member (rejects if already a member with 409); role changes routed to `PATCH /workspaces/:id/members/:membershipId`, which enforces a last-admin invariant (workspace never left with zero admins). Removal via `DELETE /workspaces/:id/members/:membershipId` respects the same guard.
- **Per-project role overrides**: a sparse `ProjectMembership` table allows ADMIN-level users to grant or restrict a member's role on individual projects (e.g., elevate a MEMBER to project ADMIN, or restrict to VIEWER). All project-scoped authorization checks resolve effective role via `getEffectiveProjectRole()`, which routes through the override when present. Accessed via `GET/PUT/DELETE /projects/:id/members/:userId/role`; workspace ADMINs bypass overrides (always retain full access).
- **Status change enforcement**: a single unified `IssuesService#enforceStatusChange()` method gates status transitions across all UI surfaces (board drag-and-drop, triage picker, issue drawer status dropdown, bulk edit) against board-assigned named workflows and project-level legacy workflow rules. Ensures no surface can silently bypass SDLC enforcement.
- **Realtime**: a Socket.io gateway broadcasts board/issue/workspace/dashboard changes; Redis adapter enables horizontal scaling. Dashboard gadgets subscribe to project updates via `SocketEvents.DashboardUpdated` and refresh data on any issue mutation.
- **Validation**: `class-validator` DTOs at the controller boundary.
- **API docs**: Swagger/OpenAPI served at `/api`.

### Card ordering — fractional indexing

Issues on a board (and in a sprint/backlog) are ordered by a `rank` **string** column. To move a card, we compute a new rank lexicographically *between* its target neighbors and update **only that one row**. This avoids the mass-renumbering of integer `position` columns and the precision exhaustion of float midpoints. A periodic rebalance job (later) normalizes keys if gaps shrink.

## Frontend (`apps/web`)

- **React + Vite + TypeScript**, SPA.
- **TanStack Query** for all server state (caching, optimistic updates on drag).
- **Tailwind CSS + shadcn/ui** for styling and components.
- **dnd-kit** for accessible drag-and-drop on the board and personal board.
- **Socket.io client** subscribes to realtime board/issue/workspace updates.
- Talks to the API at `VITE_API_URL`.
- **Mermaid.js** for rendering diagrams in markdown descriptions and comments.
- **Theming layer** (light/dark mode): Dispatch design system color scales (ink/slate/red/amber/emerald/green/blue/gray/orange/signal/brand) backed by CSS custom properties with dark palette (ink-scale shade roles, canvas/surface/shadow semantic tokens). `ThemeContext` manages user preference (light/dark/system via localStorage `nl.theme`); a synchronous bootstrap script (`public/theme-init.js`, loaded as a self-hosted static file via `<script src>` in `index.html`) applies `.dark` class before first paint with no flash and satisfies a strict CSP `script-src 'self'`. `ThemeToggle` rendered in sidebar utility area and header user menu. Dark-aware `applyBrandColor()` composes custom workspace brand colors correctly in dark mode.
- **Persistent left sidebar** (Navigation & IA Phase 1 & 2): `SidebarContext` provides workspace/project navigation, workspace switcher, personal section (My Work/My Board/Insights/Notifications), per-project views (Board/Backlog/Roadmap/Reports), and settings utility area. Desktop (lg+) shows a fixed sidebar collapsible to an icon rail with state persistence; mobile (below lg) uses an overlay drawer opened from the header hamburger button. State managed through context providers mounted above per-page remount boundaries. Phase 2 surfaces per-project Board/Backlog/Roadmap/Reports directly under active project; Branding link (admin-gated) sits beside Workspace settings.

## MCP Server (`apps/mcp`)

- **Model Context Protocol** server (stdio transport) with **126 tools** (61 read, 65 write — Pages pillar added 12 tools for CRUD, version history, and knowledge-graph traversal).
- Speaks MCP over stdio; makes authenticated HTTP calls to the Next Lane REST API using Personal Access Tokens (PATs).
- Tools expose: projects, boards, workflows, statuses, issues (with NLQL `query` param for server-side evaluation), sprints, comments, worklogs, checklists, labels, components, versions, saved filters, automations, dashboards, GitHub links, GitLab links, Gitea links, personal boards, issue templates, time-tracking, analytics, reports, notifications, bulk updates, CSV export, and project agent context.
- **Token-efficiency features:** all list_*/search_* tools return a uniform `{items, total?, limit, offset?, hasMore}` envelope; resources support `compact` (default, minimal field set) and `verbose:true` (full DTO); pagination defaults to 50 items/page with a maximum of 200. Live-verified: the same list call is ~11 KB (compact) vs. ~150 KB (verbose).
- **Project agent context:** `get_project_context` / `update_project_context` tools expose a per-project persistent agent handoff document (up to 64 KB) with measured staleness signals. Server-level MCP instructions guide agents to read context first and hand off to the next agent/run with a structured summary.
- **Workflow safeguards:** `create_issue` supports an optional `expectedProjectKey` parameter that fails *before* creating anything on a mismatch; `get_epic_overview` returns epic details, compact children, per-status rollup, and progress metrics in one call.
- Allows AI agents (Claude Desktop, Claude Code, any MCP host) to **read and write** workspace state, including the workflow/SDLC graph itself.
- See `apps/mcp/README.md` for the full tool reference and configuration.

## Data model (essentials)

Baseline v2 (applied 2026-06-28). Single migration: `20260628004947_baseline_v2`. See `docs/DATA-MODEL-REVIEW.md` for the full audit and deferred items.

Core entities and relationships:

- `User` —< `Membership` >— `Workspace` (a user belongs to workspaces with a role; User.isInstanceAdmin gates instance-wide settings)
- `Workspace` —< `Project` (`key`, `leadId` FK → User with `onDelete: SetNull`)
- `Project` —< `ProjectMembership` >— `User` (sparse per-project role overrides; allows restricting or elevating a member's workspace role on a per-project basis)
- `Workspace` —< `Team` —< `TeamMember` >— `User` (sub-workspace groups for standups / poker / analytics)
- `Project` —< `Issue`, `Status`, `Sprint`, `Board`, `Label`, `Component`, `Version`, `CustomFieldDefinition`, `SavedFilter`
- `Issue`: `number` (per-project seq), `type` (TASK/BUG/STORY/EPIC/SUBTASK), `title`, `description`, `statusId`, `assigneeId`, `reporterId`, `priority`, `storyPoints`, `parentId` (self-FK, `onDelete: SetNull`), `sprintId`, `startDate`, `dueDate`, `rank` (fractional index), `customFields` (JSONB with GIN index), `componentId`, `searchVector` (generated tsvector, GIN indexed)
- `Issue` —< `Comment` (authorId nullable, `onDelete: SetNull`; `searchVector` generated tsvector + GIN index, so comment bodies — where decisions get recorded — are reachable from the `comments` group of `GET /search`), `Attachment` (uploaderId nullable, `onDelete: SetNull`), `ActivityLog` (actorId nullable, `onDelete: SetNull`), `Watcher`, `Notification`, `IssueGithubLink` (two-way links to PRs/commits/branches, `onDelete: Cascade`)
- `Issue` >—< `Label` (via `IssueLabel`), `Version` (via `IssueVersion`), `IssueLink` (directed links: BLOCKS, RELATES_TO, DUPLICATES, etc.)
- `ProjectAgentContext` (one row per project): persistent agent handoff document (`content` Markdown string, up to 64 KB), `updatedById` (nullable FK → User, `onDelete: SetNull`), `createdAt` timestamp. Accessible via `/projects/:id/agent-context` (VIEWER+ read, MEMBER+ write via `getEffectiveProjectRole`). Exposed to agents via MCP `get_project_context` / `update_project_context` tools with measured staleness (changes since last update, last project activity timestamp).
- `IdempotencyRecord` (additive, ~24h TTL): tracks client-supplied idempotency keys to enable safe replay on create_issue / add_comment retries; returns the original response without duplicating work. Opportunistically cleaned up on write operations.
- **Project activity feed** (GET /projects/:id/activity, VIEWER+): cursor-paginated k-way merge of ActivityLog, Comment, and WorkLog entries ordered chronologically, scoped to a single project. Enables agents to track all project-scoped changes in one call.
- `Status`: per-project, `category` (TODO / IN_PROGRESS / DONE), `createdAt` / `updatedAt`
- `Sprint`: goal, start/end dates, `completedAt`, state (PLANNED/ACTIVE/COMPLETED), `updatedAt`
- `Board`: KANBAN or SCRUM, `filterQuery` (NLQL), `colorRules` (JSON), optional `savedFilterId` FK → `SavedFilter`, optional `defaultGroupBy` (swimlane/grouping dimension: Assignee, Priority, Issue type, Epic, Component, Sprint, Labels, or custom SELECT field `cf:<fieldId>`). Swimlanes v2 allows per-board configuration of the grouping dimension; URL parameter `?group=` overrides the default.
- `Dashboard`: per-project configurable analytics surface (name, order), MEMBER+ write / VIEWER read
- `DashboardGadget`: NLQL-native widgets on dashboards (STAT/TABLE/BREAKDOWN/BURNDOWN visualizations), each with a query and per-viz config (grid position/size, field grouping, column selection)
- `SavedFilter`: NLQL query owned by a user, optionally shared to a project; boards can reference it
- `CustomFieldDefinition`: project-scoped typed field definitions (TEXT/NUMBER/SELECT/…); values stored as JSONB on `Issue.customFields`
- `Component`: project-scoped sub-areas with optional `defaultAssigneeId`
- `Version` (aka Release): project-scoped, `VersionState` (UNRELEASED/RELEASED/ARCHIVED), M:N with Issue via `IssueVersion`
- `Notification.projectId` now has a proper FK (`onDelete: Cascade`)
- `GithubIntegration`: per-project webhook config (repo fullname, HMAC secret, AES-256-GCM encrypted PAT); `onDelete: Cascade` when project is deleted.
- `OidcConfig`: instance-wide singleton (id='singleton') holding the Phase-1 legacy SSO/OIDC provider configuration (issuer URL, client ID, AES-256-GCM encrypted client secret, button label, optional JIT default-workspace/role). Env variables (`OIDC_*`) take precedence over DB config; updated via in-app admin screen at `/admin/sso` (instance-admin gated). Secrets encrypted using a shared `secret-crypto.util.ts` (same pattern as GitHub integration). Phase-1 remains untouched and unmigrated on existing deployments.
- `SsoProvider`: Phase-2 addition (2026-07-06), additive alongside (not replacing) `OidcConfig` — one row per ADDITIONAL identity provider, OIDC or SAML (`type`-discriminated, mutually-exclusive nullable column groups), each with its own slug (used in the runtime route + OIDC discovery cache key), enabled flag, and optional JIT default-workspace/role. SAML certificates are stored as plaintext PEM (public keys, not secrets); OIDC client secrets reuse the same AES-256-GCM encryption as `OidcConfig`. Login page renders one button per enabled provider (Phase-1 OIDC + all enabled SsoProvider rows).
- **Pages** — project-scoped knowledge base (Phase 11):
  - `Page`: nestable tree (parentId FK, `onDelete: Restrict` — deleting a page with children is rejected), project-scoped, markdown content, fractional-index rank for sibling ordering.
  - `PageVersion`: immutable snapshots of each page save, monotonic per-page `versionNumber`, stores title + content at snapshot time.
  - `PageLink`: directed edges between pages, sourced from `[[wiki-link]]` references (`packages/shared/src/wikilink.ts#parseWikiLinks` resolves them case-insensitively); every save syncs the delta (adds/removes only changed links). An unresolved link (reference to a not-yet-created page) is valid and tracked.
  - `PageIssueLink`: many-to-many cross-links between pages and issues (on roadmap, not yet shipped).
  - `PageImage`: an image uploaded into a page body (`onDelete: Cascade` from the page; `SetNull` on the uploader). Referenced from `Page.content` as `![alt](nl-image:<id>)` — an app-internal scheme, not a URL. Two reasons: a stored absolute URL would bake the deployment origin into user content, and it would have to be fetchable *without* an `Authorization` header, which would make an image embedded in a private page less private than the page. The web renderer resolves the scheme at display time, fetching each image with the caller's token and swapping in a `blob:` URL, so an image inherits the page's authorization exactly (`pages:read` on the page's project or workspace) with no separate image ACL. Bytes go through the same `StorageDriver` as attachments; `apps/web/src/lib/pageImages.ts` holds the resolver and the rationale.

**Developer Graph (GitHub, GitLab, Gitea integration):** three self-hosted-friendly forges supported with two-way issue linking. GitHub and GitLab webhooks process inbound events (push, pull_request/merge_request); Gitea uses HMAC-SHA256 webhook verification. Commit messages, PR/MR/branch titles and names referencing an issue key (e.g. `NL-123`) trigger upsert of `IssueGithubLink`/`IssueGitlabLink`/`IssueGiteaLink` rows, visible in the issue's Development section. Every webhook is HMAC-verified against the secret before processing; PATs/tokens are encrypted at rest and never returned by the API. Gitea v1 is links-only; GitHub and GitLab also support live PR/MR status polling and auto-transition-on-merge automation.

**Outbound request security (SSRF hardening):** webhook delivery, GitHub/GitLab/Gitea live status polling, and any user/admin-supplied outbound URL go through `apps/api/src/common/ssrf-safe-fetch.ts`, which resolves DNS exactly once and pins the TCP/TLS connection to the single vetted address via a custom undici Agent connector. This closes the DNS-rebinding TOCTOU window (where an attacker nameserver could answer the SSRF check with a public IP and the real fetch with an internal one). The `@RequireScope` decorator gates ~190 routes (matrix extracted to shared `pat-scope-matrix.fixture.ts` for test-driven verification), ensuring Personal Access Tokens with restricted scopes (e.g. `issues:read` only) cannot escalate to mutations on unrelated surfaces; 6 controllers are legitimately exempt and documented in-code. A regression guard (`pat-scope-coverage.integration.spec.ts`) boots the real `AppModule` and asserts every registered controller route either carries `@RequireScope` or is on an explicit, per-route-reasoned `EXEMPTIONS` allowlist (auth/oidc/health/public/me/personal-boards-private/webhook-receivers), catching route additions that slip through without scoping. PAT scopes include 20+ distinct scope strings covering read/write access to major resource families.

**Cascade / delete policy:** user deletion sets actor/author/uploader fields to null (`onDelete: SetNull`) rather than deleting history. Project deletion cascades to all project-scoped children. Workspace deletion cascades to projects (and thus everything). See `docs/DATA-MODEL-REVIEW.md` §3.3 for the full policy table.

See `apps/api/prisma/schema.prisma` for the authoritative definition.

## Deployment (Docker Compose)

Services:

- **db** — Postgres 16, named volume for data, healthcheck.
- **redis** — Redis 7, healthcheck.
- **api** — built from `apps/api`; runs `prisma migrate deploy` on boot, then starts. Depends on db/redis being healthy.
- **web** — built from `apps/web`; static build served by nginx (prod) or Vite dev server (dev override).

A `docker-compose.dev.yml` override mounts source and enables hot reload. Uploads (attachments, workspace logos, page images) go through a `StorageDriver`: `local` by default, writing to a named `uploads` volume, or `s3` against any S3-compatible store — Ceph RADOS Gateway, MinIO (shipped behind a compose profile), AWS S3, R2, Wasabi. See `apps/api/src/storage/` and `docs-site/guide/configuration.md` § Object storage.

## Conventions

- Strict TypeScript across the monorepo.
- Database changes only via Prisma migrations.
- Shared types in `packages/shared`; never duplicate domain enums.
- Errors surface as proper HTTP status codes with a consistent error shape.
