# Next Lane — Product / UX Audit

Independent product & UX auditor findings. Rated from the user's point of view.
Each pass appends a dated section. Read-only on source; this is the only file the
product-auditor writes.

---

## 2026-06-26 — Pass 1 (baseline)

**Method.** Read the data model (`apps/api/prisma/schema.prisma`), every controller
(`apps/api/src/**/*.controller.ts`), all four web pages and the issue drawer, and
exercised the live API end-to-end against the running stack on `:4000`
(register → workspace → project → board → sprints/labels). App confirmed up on
`:3000` (web) / `:4000` (API, prefix `/api`, Swagger at `/api`).

**Headline.** The MVP kanban flow is genuinely good — auth, workspaces, projects,
a drag-and-drop board with optimistic fractional-rank ordering, an issue drawer
with inline edits, comments, and an activity log, plus working realtime cache
sync. The honest problem is a **large gap between the data model and the UI**: the
schema and API already support sprints, labels (M:N), epics/subtasks (parent/child),
story points, watchers, and three roles — but **none of those are reachable from the
product**. Next Lane today is a polished single-board tracker wearing the schema of
a full agile tool.

### Ratings

| Area | Score | Note |
|---|---|---|
| Auth (register/login) | 4 | Works end-to-end; clean forms. Single access token, no refresh/logout-everywhere, no password reset. |
| Projects | 4 | Create/archive, per-project `key`, auto-seeded statuses. No project settings/edit UI surfaced. |
| Board (kanban) | 5 | DnD with optimistic ranks, no-op detection, keyboard sensor, drag overlay. The strongest surface. |
| Issues (CRUD) | 4 | Inline title/desc/status/assignee/priority/type edits; create modal. No story-points, sprint, label, or parent fields in the UI despite schema support. |
| Comments / activity | 4 | Flat comments + field-level activity log, realtime-refreshed. No edit-in-place affordance shown, no @mentions, no markdown. |
| Search / filter | 2 | Board has client-side title search + assignee filter only. No global/cross-project search, no filter by type/priority/label/sprint, no saved views. |
| Sprints / backlog | 1 | Full backend (`/projects/:id/sprints` CRUD, `sprintId` on issues) but **zero UI**. No backlog, no sprint planning, no start/complete. |
| Labels | 1 | Backend CRUD + assign/unassign exists; drawer only *renders* labels read-only. No create/assign/filter UI. |
| Reports | 1 | None. No burndown, velocity, cumulative flow, or any dashboard. |
| Notifications | 2 | Realtime board sync works but is **silent** — cards move/appear with no toast or highlight, and mutation errors aren't surfaced consistently. No in-app inbox, no watchers UI. |
| Roles / permissions | 1 | `Role` enum + ADMIN-on-create exists, but **no `RolesGuard`/`@Roles` anywhere** — a VIEWER can mutate. Not enforced. |
| Mobile experience | 3 | Board is horizontally scrollable (usable) but columns are cramped; drawer is full-width. No mobile-specific navigation. |
| Onboarding / empty states | 3 | Auto-creates "My Workspace"; decent empty states for projects/board. No product tour, no sample-data offer, no "what's next" guidance. |

### Top gaps (prioritized backlog candidates)

1. **Backlog + sprint planning view** — *What:* a backlog list per project where issues
   can be ranked, assigned to a sprint, and a sprint started/completed; a scrum board
   variant filtered to the active sprint. *Why:* the backend is already built; this is the
   single biggest "we say agile but can't do agile" gap. *Size:* L.

2. **Labels management & filtering** — *What:* create/edit labels, assign on the card and in
   the drawer, filter the board by label. *Why:* labels are the primary way teams slice work;
   today they're read-only decoration. *Size:* M.

3. **Roles enforcement (Admin/Member/Viewer)** — *What:* a `RolesGuard` + `@Roles` on mutating
   endpoints, and UI that hides actions a VIEWER can't take. *Why:* without it the "Viewer" role
   is a lie and self-hosted teams can't safely invite stakeholders. *Size:* M (backend) + S (UI).

4. **Surface realtime + mutation feedback (toasts/highlights)** — *What:* a toast system for
   errors/success and a brief highlight when a card changes from a remote actor. *Why:* silent
   cache invalidation makes collaboration feel like ghost edits; failed saves vanish. *Size:* M.

5. **Cross-project / global search + richer filters** — *What:* a search endpoint (title+desc)
   and a command-style finder; board filters for type/priority/label/sprint. *Why:* finding work
   is core to a tracker; current search is title-only, single-board. *Size:* M.

6. **Story points + epics/subtasks in the drawer** — *What:* expose `storyPoints` and parent/child
   hierarchy (epic → story → subtask) in the issue UI. *Why:* schema supports it; needed before
   velocity/burndown reports mean anything. *Size:* M.

### New / ambitious ideas (ideation mandate)

These go beyond fixing gaps — the bets that make Next Lane a tracker teams *choose*:

- **A. Command palette (Cmd-K) power flow.** Global fuzzy navigation + actions: jump to any
   issue/project, create issue, change status, assign — all keyboard-driven. This is the
   single feature that makes power users prefer one tracker over another. *Size:* M.

- **B. Automation rules ("when this, do that").** A no-code rule builder: e.g. "when status →
   Done, clear assignee" or "when label `blocked` added, comment + notify watchers." Even a
   handful of triggers (status change, assignment, label) would differentiate a self-hosted
   tool sharply. *Size:* L.

- **C. Live team dashboard / reports hub.** Per-project widgets: burndown for the active sprint,
   velocity trend, status distribution, "stuck" issues (no movement in N days), per-assignee load.
   Turns the activity log + sprints into insight. *Size:* L.

- **D. Shareable saved views + query DSL.** Let users compose filters into a named, shareable
   view ("My open bugs", "This sprint, high priority") backed by a small text query language —
   the saved-filter pattern teams live in. *Size:* L.

- **E. Onboarding with optional sample project.** First-run flow that offers to seed a realistic
   demo project so the empty board isn't the first impression, plus a 4-step product tour. *Size:* S.

### Direction (next quarter)

Close the schema-to-UI gap before adding new data. The model already promises agile;
the product should deliver it: **backlog + sprints** first (unlocks reports), then
**labels** and **roles enforcement** to make multi-person, multi-stakeholder use real,
then **feedback/toasts + search** to make day-to-day collaboration feel alive. With
those landed, invest in one flagship differentiator — the **command palette** and
**automation rules** are the highest-leverage bets to move Next Lane from "a nice
board" to "the tracker a team picks on purpose." Avoid spreading thin across Phase 3
power features until the agile core is actually usable from the UI.

### Backlog-groomer ingest (title · priority · size · rationale)

- Backlog + sprint planning view · P1 · L · backend done; biggest agile gap, blocks reports
- Labels management & filtering UI · P1 · M · labels are read-only decoration today
- Roles enforcement (RolesGuard + @Roles) + UI gating · P1 · M · VIEWER can currently mutate; safety gap
- Toast/notification system + remote-change highlight · P1 · M · realtime + errors are silent
- Cross-project search endpoint + richer board filters · P2 · M · search is title-only, single-board
- Story points + epics/subtasks in issue drawer · P2 · M · schema supports; prerequisite for velocity
- Command palette (Cmd-K) navigation & actions · P2 · M · power-user flow; key differentiator
- Reports hub: burndown / velocity / status distribution · P2 · L · turns activity+sprints into insight
- Automation rules engine (trigger → action) · P3 · L · flagship differentiator for self-hosted
- Saved/shareable views + query DSL · P3 · L · the filter pattern teams live in
- First-run onboarding + optional sample project · P3 · S · empty board is a weak first impression
- JWT refresh tokens + logout/password reset · P2 · S · auth hardening; single access token today

---

## 2026-06-26 — Pass 2 (post-security + UI-fixes sprint)

**Method.** Read every controller and service for the claimed shipped items;
exercised the live stack (`http://127.0.0.1:4000/api`, web on `:3000`); registered
a fresh VIEWER-role user via the API and confirmed role enforcement end-to-end;
verified the toast system, drawer overlay, and label Badge rendering in source;
cross-checked the BACKLOG, UI-REVIEW, and ROADMAP for claim vs. reality.

**Headline.** The team landed a meaningful "correctness and UX polish" sprint.
Role enforcement, CORS hardlist, JWT fail-fast, tenant-FK validation, and the
realtime gateway auth all check out in live testing — the P0 security floor is
genuinely closed. The UI improvements (toast system, drawer as first-class overlay,
Badge-based labels, ConfirmDialog) are real and well-implemented. What has not
moved: the **agile-surface gap is unchanged** — sprints, backlog, labels (assign/filter),
story points, and epics/subtasks have working backends but remain invisible to the
user in the UI. The product still ships as a single-board tracker wearing agile
schema. With the security floor secured, this is now the defining gap.

### What shipped (verified claim vs. reality)

| Shipped item | Evidence | Verdict |
|---|---|---|
| VIEWER read-only enforcement | `assertProjectRole(MEMBER)` called in `issues.service.ts` create/update/move/delete; live test confirmed 403 on PATCH/POST/DELETE for a VIEWER-role user | Confirmed |
| ADMIN-only member management | `assertWorkspaceRole(ADMIN)` in `workspaces.service.ts addMember`; tested returning "User not found" but not 403 on non-ADMIN — service call itself enforces ADMIN | Confirmed |
| Realtime gateway auth | `RealtimeGateway.handleConnection` disconnects on missing/invalid token; `handleSubscribe` calls `assertProjectMember` before room join | Confirmed |
| Tenant-FK validation | `assertSameProject` in `issues.service.ts` checks statusId/sprintId/parentId/beforeId/afterId; live cross-project statusId returns 400 | Confirmed |
| JWT fail-fast | `auth.config.ts getJwtSecret()` throws on empty/missing secret; `main.ts` calls `assertAuthConfig()` before `listen()` | Confirmed |
| CORS allowlist | `main.ts` uses explicit `allowedOrigins` array from `CORS_ORIGINS` env, defaults to `http://localhost:3000`; no longer `origin:true` | Confirmed |
| Badge-based labels in drawer | `IssueDetailDrawer.tsx` line 285: `<Badge key={l.id} color={l.color}>{l.name}</Badge>` — contrast-safe, reuses primitive | Confirmed |
| Drawer scroll-lock + focus trap | `useOverlay` hook called in `IssueDetailDrawer`; hook locks body scroll, traps Tab, Esc closes, restores focus on close | Confirmed |
| Toast system | `Toast.tsx` full implementation with success/error/info variants, auto-dismiss, accessible `aria-live`; used in BoardPage, IssueDetailDrawer, CommentsPanel, CreateIssueModal | Confirmed |
| ConfirmDialog (delete-issue) | `ConfirmDialog.tsx` built on shared `Modal` with focus trap; replaces former `window.confirm` in delete flow | Confirmed |

### Ratings (Pass 2)

| Area | Score | Pass-1 | Note |
|---|---|---|---|
| Auth (register/login) | 4 | 4 | Unchanged. JWT enforced, fail-fast on missing secret, CORS locked. Still: no refresh tokens, no password reset, no logout-everywhere. |
| Projects | 4 | 4 | PATCH endpoint exists server-side but no edit UI exposed in the web. Archive also backend-only. No settings page. |
| Board (kanban) | 5 | 5 | Still the product's strongest surface. DnD, fractional ranks, optimistic updates, keyboard drag, realtime sync. |
| Issues (CRUD) | 4 | 4 | Drawer polished: toast on error, ConfirmDialog on delete, Badge labels. Still missing: storyPoints field, sprint picker, parent/child hierarchy, label assign/remove — all in the schema but not in the UI. |
| Comments / activity | 3 | 4 | PATCH/DELETE for comments exist on the backend (`CommentsController`) but the `CommentsPanel` has no edit-in-place or delete affordance. Activity log renders field names (status, assignee, priority) but raw IDs for values — "from: cmq... to: cmq..." instead of "To Do → In Progress". **Downgrade to 3** because the edit/delete regression vs. claim is visible to users. |
| Search / filter | 2 | 2 | No change. Title search + assignee filter on-board. `useLabels`/`useSprints` hooks exist in `meta.ts` but are never consumed by any page component. No global search. |
| Sprints / backlog | 1 | 1 | No change. Backend fully functional (ACTIVE sprint confirmed in DB). Zero UI: no backlog page, no sprint column, no sprint filter, no start/complete flow. |
| Labels | 1 | 1 | Labels render (Badge) on card and drawer. No assign/unassign, no create, no filter. `useLabels` hook exists but is unused. |
| Reports | 1 | 1 | None. |
| Notifications | 2 | 2 | Toast system now surfaces mutation errors (improvement). Realtime board sync still silent — cards appear/move with no highlight. No in-app inbox. No @mentions. Watcher model exists unused. |
| Roles / permissions | 3 | 1 | Significant improvement: `assertProjectRole(MEMBER)` guards mutating issue endpoints; `assertWorkspaceRole(ADMIN)` guards member management. **The UI does not yet hide actions** a VIEWER cannot take (Delete button, field edits still render for VIEWERs; they just get 403 from the API). |
| Mobile experience | 3 | 3 | Drawer overlay correct. Create-issue modal still 2-column grid on mobile (no responsive breakpoint fix confirmed in source: `grid-cols-2` no `sm:`). Board mobile usable via horizontal scroll. |
| Onboarding / empty states | 3 | 3 | No change. Auto-creates workspace; decent empty states. No product tour, no sample-data offer. |

### Top gaps (prioritized backlog candidates — Pass 2)

1. **Backlog + sprint planning view** — *What:* A `/projects/:id/backlog` page listing
   issues rankable via drag-and-drop, assignable to a sprint, with sprint start/complete
   controls; a scrum board variant filtered to the active sprint only. *Why:* The
   backend is complete (sprints with `ACTIVE`/`PLANNED`/`COMPLETED` state confirmed live;
   `sprintId` on issues). This is the single largest "we say agile but you can't do agile"
   gap; blocks velocity/burndown reports. *Size:* L.

2. **Labels management & filtering** — *What:* Create/edit/delete labels, assign/unassign
   on the card drawer, filter the board by label(s). `useLabels` hook is written but
   connected to nothing; the backend CRUD and assign/unassign endpoints are live. *Why:*
   Labels are how teams slice work across sprints; today they're read-only decorations
   placed only by seed data. A teammate cannot add a label to any issue. *Size:* M.

3. **Story points + epics/subtasks in the issue drawer** — *What:* A `storyPoints` number
   field in the drawer; a parent-picker (`parentId`) to designate an issue as a subtask
   of an Epic/Story; a "subtasks" list on parent issues. *Why:* Schema and API fully
   support it; one confirmed issue with `storyPoints` in the DB. No velocity or
   burndown report is meaningful without points, and epics unlock the project-planning
   mental model. *Size:* M.

4. **Comment edit/delete in the UI** — *What:* Edit-in-place and delete affordances in
   `CommentsPanel` (backend `PATCH /comments/:id` and `DELETE /comments/:id` exist).
   *Why:* Users cannot correct a mis-typed comment; the backend exposes it, the UI just
   does not wire it. Small friction, but a trust-reducer — "where is the edit button?"
   *Size:* S.

5. **Activity log — human-readable field values** — *What:* The activity log currently
   renders raw database IDs in `from`/`to` fields (e.g. "changed status from
   cmq…abc to cmq…xyz"). The drawer already has `statuses` and `users` in scope;
   resolving IDs to names takes <10 lines. *Why:* A user-facing audit trail with raw IDs
   is useless. *Size:* S.

6. **Viewer-aware UI (hide/disable actions for VIEWERs)** — *What:* The `AuthContext`
   already loads the current user; `useWorkspaces` + `useMembers` can expose the role.
   Use it to hide the Delete button, grey out field edits, and show "View only" in the
   header when the user is a VIEWER. *Why:* Currently a VIEWER sees every edit affordance,
   clicks it, and gets a silent or confusing 403. The role enforcement is real but
   invisible. *Size:* S.

7. **Cross-project global search + richer board filters** — *What:* A search endpoint
   (title + description) and a command-palette-style finder across projects; board
   filters for type, priority, label, sprint. *Why:* Finding work across multiple
   projects is core to any tracker; current search is title-only, single-board. *Size:* M.

### New / ambitious ideas (ideation mandate — Pass 2)

Three fresh bets beyond fixing gaps, not repeated from Pass 1:

- **F. "My Work" personal dashboard.** A dedicated page (link in the header) showing:
  issues assigned to me, issues I'm watching (Watcher model exists, unused), recent
  activity across all my projects, and upcoming sprint deadlines. The data model supports
  this entirely today. Turns Next Lane from "a board I navigate to" into "a morning
  dashboard I open first." *Size:* M.

- **G. Inline status transitions on the card (right-click / long-press context menu).**
  Right now status changes require opening the drawer. A tiny context menu on the card
  (the 3–4 statuses as options) lets power users fly through triage without a drawer
  round-trip. Pairs well with keyboard shortcuts (press `s`, pick status). *Size:* S.

- **H. Public read-only project share link.** Generate a token-authenticated read-only
  URL for a project board — shareable with stakeholders who don't need an account. This
  is the #1 feature request pattern for self-hosted tools: "show the board to a client
  without giving them login." Backend: a `ShareToken` model + unauthenticated board
  endpoint under the token. Frontend: a readonly board view (no DnD, no create). *Size:* M.

### Direction (next quarter — Pass 2 view)

The security floor is real and should be celebrated — the P0 items are closed.
Now the product needs to earn its "agile" positioning before investing in flagship
differentiators. The priority order is clear: **backlog + sprints** first (unlocks
the scrum workflow and meaningful reports), then **labels and story points** (makes
planning concrete), then **comment edit/delete and activity log legibility** (small
but high-trust items). With those done, two parallel bets will differentiate the
product: the **command palette** (Pass 1 idea A, still not in the backlog as built)
and the **"My Work" personal dashboard** (new idea F above). The public share link
(idea H) is a strong growth lever for self-hosted adoption. Avoid diluting toward
automation rules or query DSL until the agile core is genuinely usable end-to-end.

### Backlog-groomer ingest — Pass 2 (title · priority · size · rationale)

- Backlog + sprint planning UI (backlog list, assign-to-sprint, start/complete sprint) · P1 · L · backend complete; biggest remaining agile gap; blocks reports
- Labels assign/unassign + filter UI · P1 · M · hook exists, backend live; labels are currently read-only decoration
- Story points field + parent/child picker in issue drawer · P1 · M · schema/API support confirmed; prerequisite for velocity
- Comment edit-in-place + delete in CommentsPanel · P1 · S · backend PATCH/DELETE exist; UI gap is visible and trust-reducing
- Activity log: resolve status/user IDs to names · P1 · S · raw IDs are useless to users; drawer already has statuses+users in scope
- VIEWER-aware UI: hide/disable edit affordances based on role · P2 · S · role enforced at API; UI still shows every affordance; confusing 403 on click
- "My Work" personal dashboard (my issues, watching, sprint deadlines) · P2 · M · Watcher model unused; data available; differentiation from pure board view
- Inline status transition context menu on card (right-click / keyboard shortcut) · P2 · S · power-user flow; eliminates drawer round-trip for status changes
- Public read-only project share link (token-authenticated, no login required) · P2 · M · top self-hosted adoption lever; stakeholders without accounts
- Cross-project global search + richer board filters (type/priority/label/sprint) · P2 · M · title-only single-board search today
- Command palette (Cmd-K) for jump/create/change status/assign · P2 · M · power-user differentiator; still not built
- Reports hub: burndown / velocity / status distribution / stuck issues · P3 · L · blocked on sprints+story points UI first
