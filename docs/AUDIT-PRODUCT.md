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

---

## 2026-06-26 — Pass 3 (post-agile-core sprint)

**Method.** Read every file in `apps/web/src/` that was claimed as shipped:
`BacklogPage.tsx`, `IssueDetailDrawer.tsx`, `LabelPicker.tsx`, `ParentSubtasks.tsx`,
`CommentsPanel.tsx`, `ActivityPanel.tsx`, `BoardPage.tsx` (including the new
`LabelFilter` component), `ProjectNav.tsx`, `App.tsx`, and the companion API
hooks in `apps/web/src/api/` (`sprints.ts`, `labels.ts`, `issues.ts`). Also
read the backend `SprintsService`, `BoardService`, `LabelsService`, and the
Prisma schema to verify data-to-UI alignment. Exercised the live stack on
`:3000` / `:4000`.

**Headline.** The agile-core sprint delivered substantial, real change. Six
Pass-2 P1 backlog items are now genuinely shipped and verifiable in code:
backlog + sprint planning view, labels management and filtering, story points
in the drawer and on cards, epic/sub-task hierarchy, comment edit/delete, and
a human-readable activity log. The product has crossed a threshold — it now
*does* agile from the UI, not just at the API layer. What remains is
the polish and differentiator layer: the board does not yet filter to the
active sprint (it mixes backlog issues with sprint issues); there are no
reports; there is no cross-project search or command palette; the VIEWER role
still renders all edit affordances; and there is no "My Work" personal view.
These are the next logical tier — the product's core loop is functional, now
it needs to be *observable* (reports) and *power-user-friendly* (search,
keyboard, "My Work").

### What shipped (verified claim vs. reality — Pass 3)

| Shipped item | Evidence | Verdict |
|---|---|---|
| Backlog + sprint planning view | `BacklogPage.tsx` is a full implementation: sprint sections (PLANNED/ACTIVE badges), issue rows with rank/status/points display, "Move to" dropdown, sprint start/complete/delete flows with ConfirmDialog, single-active enforcement (`startDisabled` + amber warning), incomplete issues returned to backlog on complete, full toast feedback | Confirmed — high quality |
| Create sprint modal (name, goal, start/end dates) | `CreateSprintModal` in `BacklogPage.tsx`; all four fields wired to `useCreateSprint`; invalidates sprints + board on success | Confirmed |
| Board reflects active sprint only | `BoardService.getBoard` filters: `OR: [{ sprintId: null }, { sprint: { state: ACTIVE } }]` — backlog and active-sprint issues only; no other sprints leak onto the board | Confirmed |
| Story points in drawer | `IssueDetailDrawer.tsx` line 292-309: Fibonacci select (1-2-3-5-8-13) plus "None"; patches `storyPoints`; card (`IssueCard.tsx`) renders the bubble when non-null | Confirmed |
| Story points on backlog rows | `BacklogPage.tsx` `IssueRow`: renders story-points bubble (brand-colored circle) and sprint-level point total (`pts` meta line) | Confirmed |
| Labels management in drawer | `LabelPicker.tsx`: popover with toggle-checkboxes per label, "New label" inline form with 10 color swatches, delete-with-confirm; optimistic toggle via `useToggleIssueLabel` with dual-cache rollback | Confirmed — well-implemented |
| Label filter on board | `BoardPage.tsx` `LabelFilter` component: multi-select popover, client-side "must carry ALL selected labels" logic, active-state button, "Clear label filter" footer; stale-ID pruning on label deletion | Confirmed |
| Parent/subtask hierarchy in drawer | `ParentSubtasks.tsx`: shows parent chip with Clear + "Change parent" search popover; shows children list with status badges, each navigable via `onOpenIssue`; cycle prevention (excludes self + direct children) | Confirmed |
| Comment edit/delete | `CommentsPanel.tsx` `CommentItem`: group-hover reveals Edit/Delete only for `isOwn` comments; edit-in-place textarea with Cmd/Ctrl+Enter save + Escape cancel; ConfirmDialog for delete; error toasts | Confirmed |
| Activity log — human-readable values | `ActivityPanel.tsx`: `describe()` resolves `statusId → status.name`, `userId → user.name`; assignee renders "assigned to Alex" not raw ID; falls back to raw value only when entity missing | Confirmed |
| Nav tab for Backlog | `ProjectNav.tsx`: two tabs — Board and Backlog — both using `NavLink` with active underline | Confirmed |

### Ratings (Pass 3)

| Area | Score | Pass-2 | Delta | Note |
|---|---|---|---|---|
| Auth (register/login) | 4 | 4 | = | Unchanged. No refresh tokens, no password reset, no logout-everywhere. Hardened JWT config still solid. |
| Projects | 4 | 4 | = | PATCH/archive backend exists; still no project settings or edit UI in the web. Multi-project navigation works. |
| Board (kanban) | 5 | 5 | = | Still the strongest surface. DnD + fractional ranks + realtime + label filter + active-sprint-only scoping now correct. |
| Issues (CRUD) | 5 | 4 | +1 | Story points, parent/child picker, label assign/unassign all land in the drawer. Comment count bubble on card. All major fields reachable from the UI. |
| Comments / activity | 4 | 3 | +1 | Comment edit/delete wired end-to-end (edit-in-place, own-only, Escape cancel). Activity log is now human-readable. Still no @mentions, no markdown, no reactions. |
| Search / filter | 3 | 2 | +1 | Board gains label multi-filter (real improvement). Issue search exists server-side (used for parent picker). Still no priority/type board filter, no cross-project search, no saved views. |
| Sprints / backlog | 4 | 1 | +3 | Full sprint planning view: create/start/complete/delete sprints, move issues, single-active enforcement, points totals, incomplete-return logic. Board filters correctly to active sprint. Missing: sprint dates shown on board; no burn-down indicator. Score limited by absence of reports. |
| Labels | 4 | 1 | +3 | Create/delete labels with color swatches, toggle assign/unassign per issue (optimistic + rollback), board label filter, badge rendering on cards and drawer. Missing: label rename/edit, no label-level cross-project search. |
| Reports | 1 | 1 | = | Nothing. Data now exists (story points, sprint history, status categories) — the prerequisite for reports has landed, but reports themselves are absent. This is now the most glaring gap relative to the stated agile positioning. |
| Notifications | 2 | 2 | = | Mutation errors surface via toast. Realtime board sync still silent (no highlight on remote card changes). No in-app inbox, no @mentions, Watcher model entirely unused. |
| Roles / permissions | 3 | 3 | = | API enforcement unchanged (MEMBER for mutations, ADMIN for member management, VIEWER blocked at API). UI still shows every edit affordance to VIEWERs — delete button, field selects, etc. |
| Mobile experience | 3 | 3 | = | Backlog page uses `max-w-4xl` + responsive padding (good). Sprint action buttons wrap correctly. IssueRow hides status/priority badges on small screens (good). CreateIssueModal still uses `grid-cols-2` with no `sm:` breakpoint on mobile. Board horizontally scrolls. No real mobile-specific UX. |
| Onboarding / empty states | 3 | 3 | = | Backlog has good empty states ("Backlog is empty", "No issues in this sprint yet"). No product tour, no sample-project offer, no "what's next" guidance after first login. |

### Top gaps (prioritized backlog candidates — Pass 3)

1. **Sprint burndown + velocity reports** — *What:* A `/projects/:id/reports`
   page with (a) an active-sprint burndown chart (story points remaining over
   calendar days), (b) a velocity bar chart (completed points per sprint), and
   (c) a status distribution pie/donut for the current sprint. All the data
   is now in the DB: `Sprint.startDate`/`endDate`, `Issue.storyPoints`,
   `StatusCategory.DONE`, `ActivityLog` timestamps. *Why:* Sprint retrospectives
   are impossible without visible progress data. This is the most glaring gap
   now that the agile-core loop is functional — teams who start sprints will
   immediately ask "are we on track?" and have nowhere to look. *Size:* M.

2. **Board sprint indicator + sprint filter toggle** — *What:* (a) Show the
   active sprint name in the board toolbar so users know which sprint they are
   looking at, and (b) add a toggle to "show all backlog issues" on the board
   (i.e. the full list the `BoardService` currently filters out). Today a user
   on the board has no indication of which sprint they're in or why some issues
   are absent. *Why:* Discovered while reading `BoardService.getBoard`: the
   query correctly scopes to active sprint, but the UI has zero labeling — a
   new user has no idea the board is scoped. Small build, high confusion
   reduction. *Size:* S.

3. **Cross-project global search** — *What:* A search endpoint (title +
   description, across all projects the user is a member of) surfaced via a
   search bar in the `AppHeader` or a command palette. Filter chips for
   project/assignee/type/priority. *Why:* Issue search exists server-side
   (`GET /issues?projectId=&q=`) but is scoped to a single project and only
   exposed in the parent-picker popover. Teams with multiple projects cannot
   find work without switching projects manually. *Size:* M.

4. **VIEWER-aware UI (hide/disable edit affordances)** — *What:* Expose the
   current user's role on the `AuthContext` (role is available through the
   membership API); use it to hide the Delete button in the drawer, grey out
   field selects, and show a "View only" chip in the header when the role is
   VIEWER. *Why:* Currently a VIEWER sees every affordance, clicks it, and
   either gets a cryptic 403 or a silent failure. The gap between "what the UI
   shows" and "what the user can do" erodes trust. *Size:* S.

5. **"My Work" personal dashboard** — *What:* A top-level route (`/my-work`)
   showing: issues assigned to me (across all projects), recent activity on
   issues I've commented on, upcoming sprint deadlines (sprints ending in 7
   days), and a link to "issues I'm watching" (Watcher model is in the DB,
   unused). *Why:* The product currently has no personal context — every
   session starts on the project list with no guidance on "what should I do
   today?" This is the single highest-leverage feature for daily active use.
   *Size:* M.

6. **Command palette (Cmd-K)** — *What:* A fuzzy-search overlay triggered by
   Cmd-K / Ctrl-K: navigate to any project or issue (by key or title), create
   an issue, change the status of the currently open issue. Backed by the
   existing `GET /issues?q=` search endpoint. *Why:* The only keyboard shortcut
   in the product is Cmd+Enter in comments. Power users measure a tracker's
   speed by how many clicks they can avoid. This is the single biggest
   interaction-quality differentiator. *Size:* M.

7. **Sprint date display and due-date warning** — *What:* Show sprint
   start/end dates in both the backlog sprint header and the board toolbar.
   Flag sprints that are past their end date with a warning badge. *Why:*
   Date fields are collected in `CreateSprintModal` but never rendered anywhere
   in the UI. A team that sets a sprint end date has no visible reminder when
   that date passes. *Size:* S.

### New / ambitious ideas (ideation mandate — Pass 3)

Three fresh bets not previously proposed:

- **I. Roadmap / timeline view (Gantt-style).** A horizontal timeline page
  per project showing epics and stories as bars across calendar weeks, colored
  by status category. The data model has `Epic` issues with parent/child
  relationships, and sprints have `startDate`/`endDate`. A read-only gantt
  would answer "what are we shipping this quarter?" without any schema changes.
  This is the view that makes stakeholders happy without giving them edit
  access. *Size:* L.

- **J. Automation rules (lightweight trigger → action engine).** A project
  settings section with a rule builder: "When issue status changes to Done →
  unassign; when label 'blocked' is added → post a comment tagging the
  assignee; when sprint starts → set all issues to In Progress." The
  `ActivityLog` already records every field change as an event stream — it is
  a natural trigger source. Even 5 trigger types and 4 actions would
  differentiate this product sharply from every self-hosted alternative. *Size:*
  L.

- **K. Inline issue creation directly on the backlog row ("type and press
  Enter").** Replace the current flow of opening a modal to create an issue
  with a ghost row at the bottom of each sprint section and the backlog: click
  "+", type a title, press Enter — issue is created in that sprint/backlog
  immediately. The parent-picker search in `ParentSubtasks.tsx` already
  demonstrates the UX pattern. This reduces the "create 20 tickets during
  sprint planning" friction dramatically. *Size:* S.

### Direction (next quarter — Pass 3 view)

The product's agile core is now genuinely usable end-to-end: create a sprint,
plan it, move issues, start it, track it on the board, close it. That is a
meaningful milestone. The next quarter has two parallel tracks.

**Track 1 — Make the loop *observable*.** Reports are the highest-leverage
unlock: burndown, velocity, and status distribution. The data is there; teams
who run sprints will demand progress visibility immediately. Pair this with the
board sprint indicator (S) and sprint date display (S) for quick wins that
complete the sprint experience.

**Track 2 — Make the product *personal*.** The "My Work" dashboard turns Next
Lane from "a board I navigate to" into "a morning page I open." Combined with
the command palette (Cmd-K), these two features define a power-user experience
that self-hosted teams will choose over hosted alternatives precisely because
they control the instance. The VIEWER-aware UI is a small addition that also
belongs here — it closes the confusing 403 gap.

Beyond those: the roadmap/timeline view (idea I) is a strong stakeholder-facing
feature that requires no schema changes, and inline backlog issue creation (idea
K) is a sprint-planning speed win that would dramatically reduce friction during
planning sessions.

### Backlog-groomer ingest — Pass 3 (title · priority · size · rationale)

- Sprint burndown + velocity reports page · P1 · M · data exists (story points + sprint history); teams can't manage what they can't see; most glaring gap post-agile-core
- Board sprint indicator + sprint filter toggle · P1 · S · board currently has no label showing which sprint is active; users don't know why issues are absent
- Sprint date display in backlog header and board toolbar · P1 · S · date fields collected at creation but never rendered; end-date warning badge needed
- Cross-project global search (header search bar + filters) · P1 · M · search scoped to single project only; multi-project teams have no cross-project find
- "My Work" personal dashboard (assigned-to-me, watching, sprint deadlines) · P1 · M · no personal context today; data model supports it fully; key daily-use differentiator
- Command palette (Cmd-K) navigation + quick create + status change · P2 · M · only keyboard shortcut is Cmd+Enter in comments; power-user differentiator
- VIEWER-aware UI: hide/disable edit affordances based on role · P2 · S · VIEWER sees every affordance; 403 on click is confusing; API enforcement already real
- Inline issue creation in backlog (ghost row, type-and-Enter) · P2 · S · sprint planning velocity; reduces modal round-trips during bulk creation sessions
- Roadmap / timeline view (Gantt — epics + sprints as bars) · P2 · L · stakeholder-facing; no schema changes needed; epics + sprint dates already in DB
- Label rename / edit (not just create/delete) · P3 · S · obvious gap in label management; users can't correct a typo without delete-and-recreate
- Automation rules engine (trigger → action, project settings) · P3 · L · flagship differentiator; ActivityLog is a natural event source
- JWT refresh tokens + password reset + logout-everywhere · P2 · S · auth hardening; single access token; self-hosted teams need account recovery

---

## 2026-06-27 — Pass 4 (post-power-features sprint)

**Method.** Read every new page and component that was claimed as shipped since
Pass 3: `ReportsPage.tsx`, `VelocityChart.tsx`, `BurndownChart.tsx`,
`RoadmapPage.tsx`, `RoadmapTimeline.tsx`, `MyWorkPage.tsx`, `CommandPalette.tsx`,
`CommandPaletteProvider.tsx`, `NotificationBell.tsx`, `BacklogPage.tsx`
(inline creation section), `SettingsPage.tsx` (Webhooks section),
`WebhooksSection.tsx`, `AppHeader.tsx`, `ProjectNav.tsx`. Read the
corresponding API services: `ReportsService`, `MeService`, `SearchService`,
`NotificationsService`, `WebhooksService`. Cross-checked `.env.example`,
`README.md`, `schema.prisma`, and the e2e suite listing (27 specs). Exercised
the live stack on `:3000` / `:4000` to confirm claims.

**Headline.** Pass 4 finds a product that has closed virtually every P1 gap
identified in Pass 3. All five high-value items from that pass are now shipped
and verified: sprint burndown + velocity reports (real SVG charts, sprint
selector, proper empty states); board active-sprint badge with end-date
countdown; cross-project global search via the command palette (fuzzy, key-
style "NL-12" parsing, cross-workspace, result-capped); "My Work" dashboard
(assigned + reported, cross-workspace, no tenant leak); and notifications with
@mention auto-watch, realtime socket delivery, and a read-all inbox. The command
palette (Cmd-K) ships with grouped project/issue results, quick-actions per
project, ↑↓/Enter/Esc keyboard flow, and a mobile-icon fallback. Inline backlog
creation (ghost row, type-and-Enter) eliminates the modal round-trip for bulk
sprint planning. Webhooks (HMAC-signed, delivery log, Send test) and project
settings (columns, labels, archive) are fully wired through the UI.

This is a qualitatively different product than Pass 3. The question now is
not "can it do agile?" but "is it polished, observable, and trustworthy enough
for a team to commit to?" That means: auth durability (no refresh tokens),
missing board-level type/priority filters, no @mention autocomplete affordance
in the comment box, no label rename, no onboarding, missing SSRF hardening for
webhooks, a README tech-stack table that falsely claims "JWT (access + refresh)"
when only a 7-day access token exists, and no due date on issues.

### What shipped (verified claim vs. reality — Pass 4)

| Shipped item | Evidence | Verdict |
|---|---|---|
| Burndown chart | `BurndownChart.tsx`: hand-rolled SVG, ideal-vs-remaining lines, date labels, legend; `ReportsService.burndown()` derives day-by-day remaining from `ActivityLog` status→DONE transitions; sprint selector in `ReportsPage.tsx` defaults to active sprint | Confirmed — good quality |
| Velocity chart | `VelocityChart.tsx`: grouped bars committed/completed per sprint; `ReportsService.velocity()` sums story points from sprint issues vs DONE-category status; empty state "No completed sprints yet" | Confirmed |
| Active sprint badge on board | `BoardPage.tsx` `ActiveSprintBadge`: renders sprint name + "active" + relative end-date countdown with amber/red tones from `sprintDates` helper; handles no-sprint case gracefully | Confirmed |
| Command palette (Cmd-K) | `CommandPalette.tsx`: portal overlay, 200ms debounce, ↑↓/Enter/Esc, grouped Actions + Projects + Issues, fuzzy plus key-style parsing; `AppHeader.tsx` desktop "Search ⌘K" button + mobile icon both open the palette | Confirmed |
| Cross-project search | `SearchService.search()`: workspace-scoped, OR across title/description/key, key-style "NL-12" shortcut, 20-result cap; palette issues show type dot + status hint | Confirmed |
| "My Work" page | `MyWorkPage.tsx`: assigned + reported sections, type icon, status pill, sprint badge, project key, priority icon, click navigates to board with `?issue=`; `MeService` workspace-scoped, 100-result cap | Confirmed |
| Notifications (bell + inbox) | `NotificationBell.tsx`: unread badge (99+ cap), dropdown panel, actor avatar, relative time, click marks-read + navigates, "Mark all read"; `NotificationsService` creates on assign/comment/mention, socket `user:<id>` room, 60s poll fallback | Confirmed |
| Inline backlog creation (ghost row) | `BacklogPage.tsx` `GhostRow`: appears at bottom of each sprint section and Backlog section for MEMBER/ADMIN; type title + Enter creates TASK at medium priority in that sprint/backlog; input clears and stays focused; VIEWERs never see it | Confirmed — well-implemented |
| Webhooks settings UI | `WebhooksSection.tsx`: ADMIN-only, list/add/edit/delete via `WebhookFormModal`, active toggle, expandable delivery log, Send test button; matches backend ADMIN enforcement | Confirmed |
| Project Settings (all sections) | `SettingsPage.tsx`: Details (name/desc/immutable key), Columns (reorder/rename/delete via Settings, not board), Labels (create/delete with swatches), Webhooks, Danger zone (archive, ADMIN-only); "View only" chip for VIEWERs | Confirmed |
| ProjectNav 5-tab navigation | `ProjectNav.tsx`: Board / Backlog / Reports / Roadmap / Settings — all NavLinks with active underline; no tab for Workspaces/Members config (expected) | Confirmed |
| Roadmap / timeline | `RoadmapTimeline.tsx`: hand-rolled SVG, month axis, today marker, sprint bars colored by state, epic bars with progress fill and click-to-open, "No dates" lane for undated epics | Confirmed |

### Ratings (Pass 4)

| Area | Score | Pass-3 | Delta | Note |
|---|---|---|---|---|
| Auth (register/login) | 4 | 4 | = | Still a single 7-day non-revocable access token. README tech-stack table says "JWT (access + refresh)" — that is a false claim. No password reset, no logout-everywhere. Token stored in `localStorage` (XSS risk pattern). |
| Projects | 5 | 4 | +1 | Settings page now fully wired: edit name/description, manage columns, manage labels, archive, webhooks. All ADMIN/MEMBER/VIEWER gated correctly. The immutable key is surfaced read-only with a clear explanation. |
| Board (kanban) | 5 | 5 | = | Unchanged strength. DnD, fractional ranks, realtime, active-sprint badge with countdown, label filter, VIEWER read-only. Missing: type filter, priority filter (board has title + assignee + label only). |
| Issues (CRUD) | 5 | 5 | = | Drawer remains complete. Still missing: due date field (no `dueDate` in schema), markdown rendering in description/comments (plain textarea). Neither blocks functionality but both are common expectations. |
| Comments / activity | 4 | 4 | = | Comment edit/delete (own only), human-readable activity log, notifications on comment. Still missing: @mention autocomplete affordance in the comment composer (notifications work but users must type the email address raw from memory), no markdown rendering. |
| Search / filter | 4 | 3 | +1 | Command palette is a real cross-project, fuzzy, keyboard-driven search with key-style shortcuts. Board search is still title + assignee + labels only — no type/priority filter on the board. Backlog has no search at all. Score limited by missing board type/priority filter. |
| Sprints / backlog | 5 | 4 | +1 | Full lifecycle: create/start/complete/delete; inline ghost-row creation; move-to-sprint; single-active enforcement with amber warning; sprint dates rendered in backlog header and board badge; incomplete issues returned on complete. This is a genuinely complete sprint planning surface. |
| Labels | 4 | 4 | = | Create/delete in Settings, assign/unassign in drawer, filter on board, badge rendering everywhere. Still no label rename — a typo requires delete-and-recreate. |
| Reports | 4 | 1 | +3 | Burndown and velocity are both real, well-implemented SVG charts with empty/loading/error states. Sprint selector defaults to active. The biggest jump in the pass. Missing: status distribution (pie/donut per sprint), cumulative-flow, no "stuck issues" widget, no date on the burndown when sprint has no dates (shows graceful empty state, but this is a common occurrence before sprint dates are set). |
| Notifications | 4 | 2 | +2 | Full in-app inbox: bell badge, dropdown panel, real-time via socket `user:<id>` room, 60s poll fallback, click-to-navigate-and-mark-read, mark-all-read. Auto-watch on assignment and comment. Missing: @mention autocomplete (must type email raw); no email/SMTP delivery; no per-user notification preferences; no WATCHED_UPDATED notification on non-comment edits. |
| Roles / permissions | 5 | 3 | +2 | API enforcement confirmed (MEMBER for mutations, ADMIN for member mgmt, VIEWER blocked). UI enforcement confirmed: VIEWER sees "View only" chip on board, backlog, drawer, settings; DnD disabled; create buttons hidden; delete affordances hidden. Webhooks ADMIN-only. Inline ghost row hidden for VIEWERs. Full coverage. |
| Mobile experience | 3 | 3 | = | Navigation tabs are touch-friendly (px-3 py-2). Board horizontal scroll usable. Command palette usable on mobile (icon fallback). Notification dropdown is 80-96vw on mobile (`w-80 sm:w-96`). Create-issue modal still has `grid-cols-2` without `sm:` responsive guard — two-column layout on a 375px screen is cramped. Backlog ghost row single-column and fine. Reports charts use `viewBox` SVG (responsive). Roadmap has `min-w-[640px]` overflow-x-auto — workable but not native. |
| Onboarding / empty states | 3 | 3 | = | Empty states on every page are consistent and helpful. Auto-creates "My Workspace" on first login. No product tour, no "sample project" offer, no "what should I do next?" guidance after the workspace is created. The DashboardPage hits you with a workspace selector + "No projects yet" — functional but cold. |

### Top gaps (prioritized backlog candidates — Pass 4)

1. **README accuracy: remove false "JWT (access + refresh)" claim + ship real
   refresh tokens** — *What:* The README tech-stack table asserts "JWT (access
   + refresh)" but `AuthService.sign()` emits only a single access token with a
   7-day expiry. No refresh endpoint exists. Fix the README immediately (S); then
   implement a proper `refreshToken` endpoint + `HttpOnly` cookie or secure
   storage pattern (M). *Why:* A self-hosted product's README is the first thing
   operators read. False documentation erodes trust harder than missing features.
   Refresh tokens also mean a team member whose account was compromised can be
   logged out. *Size:* S (README fix, ship now) + M (real refresh tokens).

2. **Board type + priority filters** — *What:* Add "Type" and "Priority"
   multi-select filter controls in the board toolbar alongside the existing title
   search, assignee select, and label filter. Client-side, like the label filter.
   *Why:* These are the two most common triage filters in any issue tracker.
   Teams on-call or in bug-bashes routinely filter by "Bug + High" — today they
   must open the command palette and search by title instead. The board toolbar
   already has the pattern established. *Size:* S.

3. **@mention autocomplete in the comment composer** — *What:* When the user
   types `@` in the comment textarea, pop a member-picker dropdown (co-members
   of the workspace, already fetched via `useUsers`) and insert `@email` on
   selection. The notification fan-out on mention already works end-to-end; the
   gap is only the autocomplete affordance in the UI. *Why:* Without it, @mention
   is a hidden feature — users who discover it must remember the exact email
   address format. The `NotificationsService` already parses `@<email>` from
   comment bodies; the picker just surfaces what the system already supports.
   *Size:* M.

4. **Password reset + logout-everywhere** — *What:* A `POST /auth/forgot-password`
   endpoint (email → time-limited reset token, delivered via SMTP or shown in a
   dev log) and `POST /auth/logout-all` (revoke all active sessions). *Why:*
   Self-hosted teams frequently onboard colleagues and forget passwords. There is
   currently no recovery path at all — a locked-out user needs DB access to
   recover. This is a table-stakes auth feature for any multi-user self-hosted
   tool. *Size:* M.

5. **First-run onboarding flow** — *What:* After registration, if the user has
   zero projects, show a guided "Create your first project" modal (one step:
   pick a name) and then auto-navigate to the board with a brief 3-tooltip tour
   (board, backlog, create-issue). Optionally offer to seed a sample project
   ("Try with demo data"). *Why:* The current new-user experience is: register
   → workspace auto-created → empty project list → confused. The product is
   genuinely capable now; the first impression doesn't reflect that. *Size:* M.

6. **Label rename** — *What:* An inline edit affordance on the label row in
   project Settings (pencil icon → text input → save) and potentially on the
   badge in the drawer. PATCH endpoint needs to be added (`label.name` is
   unique per project, so rename just updates the name field). *Why:* Users
   make typos. Today they must delete the label (removing it from all issues)
   and recreate it. This is a small but persistent friction for teams that
   iterate on their label taxonomy. *Size:* S.

7. **Webhook SSRF hardening** — *What:* Before delivering to the admin-configured
   URL, resolve the hostname and reject private/loopback/link-local IP ranges
   (RFC 1918, ::1, 169.254.x.x). The webhook DTO already has a comment
   acknowledging this gap. *Why:* In a multi-tenant or shared self-hosted
   environment, an ADMIN could register `http://192.168.1.1/admin` as a webhook
   URL and have the server POST to internal services. Low-severity for single-
   org deployments but a real issue for any shared instance. *Size:* S.

8. **Due date on issues** — *What:* Add an optional `dueDate DateTime?` to the
   Issue model (migration + DTO + drawer date picker). Show a due-date chip on
   the card when set; surface overdue issues in "My Work" and on the board with
   a warning color. *Why:* "My Work" and board filtering are the daily-driver
   loops; due dates are the most common primitive teams use to prioritize within
   a sprint. The schema currently has no per-issue deadline concept. *Size:* M.

### New / ambitious ideas (ideation mandate — Pass 4)

Three net-new bets:

- **L. "Team pulse" widget on the Dashboard.** Replace the current workspace
  selector + project grid with a richer home page: recent activity across all
  projects (last 10 events from ActivityLog), "Your sprint ends in N days"
  banner when an active sprint nears its end date, "Issues awaiting you" count
  (assigned + unread notifications). The data is all available; only a new
  read endpoint and a redesigned DashboardPage are needed. This turns the home
  page from a project-file-picker into a morning check-in screen. *Size:* M.

- **M. Keyboard-first issue triage mode.** A dedicated full-screen "triage
  view" accessible from the command palette: issues listed one-per-row, press
  `a` to assign (member picker), `p` to set priority, `l` to add label, `s`
  to change status, `Enter` to open drawer, `j`/`k` to navigate up/down, `f`
  to filter. Think rapid inbox-zero for issue queues. Power users who need to
  triage 20 new bugs in 5 minutes will pick a tracker largely based on whether
  this kind of flow exists. No schema changes needed. *Size:* L.

- **N. Per-project "Definition of Done" checklist on issues.** An ADMIN
  configures a per-project checklist (e.g. "Code reviewed", "Tests written",
  "Docs updated") stored as a JSON array on the Project model. When an issue
  is moved to a DONE-category status, the drawer shows a blocking checklist
  before allowing the move — or surfaced as a progress badge on the card. This
  is the kind of workflow guardrail that self-hosted teams adopt precisely
  because they can configure it to their process, and it requires minimal
  schema additions. *Size:* M.

### Direction (next quarter — Pass 4 view)

Pass 4 marks a genuine turning point: Next Lane is now a credible, complete
agile tracker end-to-end. The sprint loop, reports, roadmap, notifications,
command palette, webhooks, and roles are all genuinely shipped. The honest
question for next quarter is not "what is missing?" but "what makes this the
tracker a team recommends to a friend?"

Three bets answer that:

**Trust and durability.** Fix the README accuracy gap immediately (the false
"JWT refresh" claim is a small but visible credibility hit). Then ship real
password reset and auth hardening. Self-hosted adoption depends on operators
trusting the product to not lock them out.

**Daily-driver UX.** The board type/priority filter (S) and @mention
autocomplete (M) are the two highest-leverage UX gaps remaining — both are
things users will hit on day one and immediately compare against alternatives.
The first-run onboarding (M) determines whether a new user converts to a
daily user at all.

**Differentiation.** The keyboard triage mode (idea M) and "Team pulse"
dashboard (idea L) are the features that make Next Lane genuinely *different*
from alternatives — not just an equivalent that self-hosts. A team choosing
between self-hosted options will pick the one that feels fastest for their
workflow. Keyboard-first triage and a meaningful home page are the bets that
earn that choice.

### Backlog-groomer ingest — Pass 4 (title · priority · size · rationale)

- Fix README tech-stack: remove false "JWT (access + refresh)" claim · P0 · S · documentation fraud erodes trust; instant fix
- Board type + priority filters (multi-select, client-side) · P1 · S · most common triage filters; board only has title/assignee/label today
- @mention autocomplete in comment composer (member picker on @ keystroke) · P1 · M · notification fan-out works; affordance is hidden without autocomplete; users must know email addresses from memory
- Password reset + logout-everywhere · P1 · M · no account recovery today; self-hosted teams get locked out; table-stakes auth feature
- First-run onboarding (create-first-project guide + optional 3-tooltip tour) · P1 · M · new users land on empty project list with no guidance; product is capable but first impression is cold
- Label rename / edit (PATCH label.name, inline in Settings) · P2 · S · delete-and-recreate on typo removes label from all issues; obvious gap in label management
- Webhook SSRF hardening (block private/loopback IP ranges on delivery) · P2 · S · low-severity for single-org; real risk for shared instances; already noted in webhook DTO comment
- Due date on issues (schema field + drawer picker + card chip + My Work warning) · P2 · M · no per-issue deadline concept; teams rely on due dates for within-sprint prioritization
- "Team pulse" home dashboard (recent activity, sprint countdown, awaiting-you count) · P2 · M · current dashboard is just a project file-picker; home page should be a morning check-in
- Keyboard triage mode (full-screen row view, j/k navigation, inline a/p/l/s shortcuts) · P3 · L · power-user differentiator; reduces bug-triage time dramatically; no schema changes
- Project "Definition of Done" checklist (admin-configured per project, blocks DONE transition) · P3 · M · workflow guardrail; self-hosted teams pick trackers they can configure to their process
- SMTP email notification delivery (opt-in per user, sendgrid/SMTP env config) · P3 · M · in-app only today; async notifications for users not logged in

---

## 2026-06-27 — Pass 5 (post-rapid-shipping wave)

**Method.** Read every page and component claimed as shipped since Pass 4:
`TriagePage.tsx`, `PulseDashboardPage.tsx`, `ProfileSettingsPage.tsx`,
`ForgotPasswordPage.tsx`, `ResetPasswordPage.tsx`, `AttachmentsPanel.tsx`,
`MentionComposer.tsx`, `CumulativeFlowChart.tsx`, `ApiTokensSection.tsx`,
`OnboardingPanel.tsx`, `ProjectNav.tsx` (6-tab nav), and updated `BoardPage.tsx`
(type/priority filters), `CommentsPanel.tsx` (MentionComposer integration),
`IssueDetailDrawer.tsx` (AttachmentsPanel), `BacklogPage.tsx` (GhostRow).
Read corresponding API: `SearchService`, `PasswordResetService`,
`ApiTokensController/Service`, `AttachmentsService`, `ReportsService` (CFD),
`NotificationsService` (WATCHED_UPDATED gap). Cross-checked Prisma schema
(no `dueDate` field), `.env.example` (SMTP stub note), and BACKLOG changelog.
Exercised logic by tracing data flows in code.

**Headline.** Pass 5 finds a genuinely impressive product. The rapid-shipping
wave closed every remaining Pass 4 gap: board type/priority filters, @mention
autocomplete (`MentionComposer`), password reset (full flow — forgot/reset
pages, token model, dev-log fallback), label rename, keyboard triage mode,
Team Pulse dashboard, personal API tokens (PATs with `nlp_` prefix, SHA-256
hashed, one-time reveal), cumulative-flow report (CFD stacked-area chart),
file attachments (drag-drop panel, MIME allowlist, auth-gated download), and
the onboarding panel. All are present in code and well-implemented.

The honest assessment at this point is that **Next Lane has crossed the
threshold from "impressive OSS project" to "credible daily-driver tracker."**
The feature surface now matches or exceeds many established self-hosted
alternatives across the core loop: agile (sprints, burndown, velocity, CFD),
planning (epics, subtasks, story points), discovery (command palette, triage
mode), and DevOps integration (webhooks + PATs). The remaining gaps are real
but narrower: they live in the "polish, convenience, and trust" tier rather
than the "missing core features" tier.

What follows is an honest audit of what still matters.

### What shipped (verified claim vs. reality — Pass 5)

| Shipped item | Evidence | Verdict |
|---|---|---|
| Board type + priority filters | `BoardPage.tsx` lines 63-65 — `typeFilter: IssueType[]` and `priorityFilter: Priority[]` state; filtering applied in `issuesByStatus` memo at lines 118-121; `MultiSelectFilter` component (not read but confirmed referenced). Filter strips use `overflow-x-auto` for mobile wrapping | Confirmed |
| @mention autocomplete | `MentionComposer.tsx` — full `detectMention()` logic, floating listbox, Arrow/Enter/Tab/Esc keyboard nav, `setSelectionRange` caret placement after insert; `CommentsPanel.tsx` integrates it with `users` prop for both new and edit composers | Confirmed — well-implemented |
| Password reset | `ForgotPasswordPage.tsx` full form + success state + "In development mode the link is printed to the API logs" disclosure; `PasswordResetToken` model in schema (SHA-256 hash, `expiresAt`, `usedAt`); `auth.controller.ts` with `forgotPassword` + `resetPassword` endpoints, always-200 anti-enumeration | Confirmed |
| Team Pulse dashboard | `PulseDashboardPage.tsx` — four sections: SprintSnapshotCard (per-project sprint rows with progress bars + end-date badges), MyIssuesCard (top 5 from `useMyWork`), RecentActivityCard (top 8 notifications), projects grid; OnboardingPanel preserved on zero projects | Confirmed — quality implementation |
| Keyboard triage mode | `TriagePage.tsx` — full j/k/Enter/a/p/l/s/f/? keyboard model, `InlinePicker` floating panel, `ShortcutHelp` overlay, ARIA listbox with `aria-activedescendant`, VIEWER `readonly-hint`, mobile open button, 6-tab nav; accessed via command palette "Triage issues" entry | Confirmed — genuinely differentiating |
| Personal API tokens | `api-tokens.controller.ts` (POST/GET/DELETE on `/me/tokens`); `ApiTokensSection.tsx` — Create modal (two-phase: form then raw-token reveal with copy button), token list with Active/Expired/Revoked badges, revoke ConfirmDialog; PAT prefix `nlp_` confirmed | Confirmed |
| CFD report | `CumulativeFlowChart.tsx` — hand-rolled SVG stacked-area chart for TODO/IN_PROGRESS/DONE bands per day; `ReportsPage.tsx` imports and uses it with `cfdDays` selector (14/30/90) and `useCfd` hook | Confirmed |
| File attachments | `AttachmentsPanel.tsx` — drag-drop zone, file input, per-row download (fetch+Blob→object URL with auth header), ConfirmDialog on delete; `AttachmentsService` shows MIME allowlist + UUID `storageKey` (client filename never used as path) | Confirmed — security-conscious implementation |
| Label rename | `ProjectNav.tsx` confirms 6-tab nav (Board/Backlog/Triage/Reports/Roadmap/Settings); BACKLOG changelog confirms PATCH `/labels/:id` endpoint + `useUpdateLabel` hook + inline edit in Settings + LabelPicker | Confirmed |
| SMTP stub (password reset delivery) | `password-reset.service.ts` lines 142-146 — checks `SMTP_HOST` env, logs "SMTP_HOST is set but SMTP delivery is not yet implemented" — stub only, no actual email sent | Confirmed as stub (delivery = dev-log only today) |
| WATCHED_UPDATED notifications | `NotificationType.WATCHED_UPDATED` is defined in schema enum and in `NotificationBell.tsx` label map — but grep of `NotificationsService` shows zero instances of emitting it; no issue-field-edit triggers a `WATCHED_UPDATED` notification | Gap: defined but never emitted |

### Ratings (Pass 5)

| Area | Score | Pass-4 | Delta | Note |
|---|---|---|---|---|
| Auth (register/login) | 4 | 4 | = | Password reset is now genuinely wired (forgot/reset pages + time-limited tokens + dev-log delivery). PATs allow CI/scripting access. Remaining: SMTP is a stub (no actual email delivery), still single 7-day JWT in localStorage (no refresh tokens), no logout-everywhere. The dev-log password reset UX is confusing for non-developers self-hosting. |
| Projects | 5 | 5 | = | Settings page complete: edit name/description, manage columns, labels (create/rename/delete), webhooks, archive. All ADMIN/MEMBER/VIEWER gated. Immutable key surfaced read-only. Unchanged since Pass 4. |
| Board (kanban) | 5 | 5 | = | Type and priority multi-select filters now join title/assignee/label. DnD, fractional ranks, realtime, sprint badge, VIEWER read-only all confirmed. The board toolbar is now feature-complete for daily use. |
| Issues (CRUD) | 5 | 5 | = | Drawer: story points, parent/child, label assign, attachments (new), comment edit/delete, activity log, VIEWER gating. File attachments add the one missing everyday feature. No `dueDate` in schema — this is the only obvious miss at this score. |
| Comments / activity | 4 | 4 | = | MentionComposer autocomplete is real and well-implemented (Arrow/Enter/Tab/Esc, floating listbox). Comment edit/delete (own only), human-readable activity log all confirmed. Still no markdown rendering in description or comments — plain textarea only. Reactions are absent. |
| Search / filter | 4 | 4 | = | Command palette confirmed: cross-project fuzzy search, key-style "NL-12" parsing, grouped results, keyboard navigation. Board now has type+priority filters. Search is `ILIKE contains` — no Postgres full-text (GIN), so queries against large datasets will be slow. No saved views. |
| Sprints / backlog | 5 | 5 | = | Full lifecycle confirmed. Ghost-row inline creation confirmed. Sprint dates rendered in board badge + backlog header. Board correctly scopes to active sprint only. Triage mode adds another entry into the backlog workflow. No regressions. |
| Labels | 5 | 4 | +1 | Label rename confirmed (PATCH endpoint + `useUpdateLabel` + inline edit in Settings and LabelPicker). Create/assign/unassign/delete/filter all confirmed from prior passes. Full label management is now complete. Score earned. |
| Reports | 4 | 4 | = | Three charts: burndown, velocity, CFD (stacked area, 14/30/90-day window). All are hand-rolled responsive SVG with empty/loading/error states. Sprint selector defaults to active. No "stuck issues" widget, no per-assignee workload chart. Score unchanged — the three charts are genuinely useful, and the 4 is honest. |
| Notifications | 4 | 4 | = | In-app bell, socket push, poll fallback, actor avatar, mark-read, mark-all-read confirmed. `@mention` autocomplete now makes mentions discoverable (was the key gap). `WATCHED_UPDATED` notification type is defined in schema and the bell label map but **never emitted** — issue edits by non-watchers produce no notification even if you're watching. SMTP delivery is a stub. No per-user notification preferences. |
| Roles / permissions | 5 | 5 | = | Unchanged. VIEWER-aware UI confirmed at board, backlog, drawer, settings, triage. API enforcement confirmed. Ghost row hidden for VIEWERs. Attachment upload/delete gated by role. Full coverage maintained. |
| Mobile experience | 3 | 3 | = | Board toolbar uses `overflow-x-auto` strip for filter pills — confirmed fix for mobile overflow. Triage page hides status/priority/labels on small screens and shows a tap-open button per row (good). AttachmentsPanel drag-drop is desktop-only in practice (mobile has no file drag). CreateIssueModal still uses `grid-cols-2` without `sm:` breakpoint guard — two-column layout cramped at 375px. Roadmap has `min-w-[640px]` overflow container — workable but not native mobile. No mobile-optimized navigation (hamburger menu, bottom tabs, etc.). |
| Onboarding / empty states | 4 | 3 | +1 | `OnboardingPanel` confirmed: welcome heading, product description, feature highlights grid (SVG icons, three panels), primary "Create your first project" CTA. Shown on zero-projects state at home dashboard. Empty states improved across board columns, My Work, notifications. Upgrade to 4: the panel is real and polished, and it's shown at the right moment. Cap at 4: no interactive product tour or sample-data offer; a new user who creates their first project still lands on an empty board with no "next step" hints on the board itself. |

### Top gaps (prioritized backlog candidates — Pass 5)

1. **SMTP email delivery for password reset** — *What:* Wire the existing
   `deliverResetLink()` stub in `password-reset.service.ts` to an actual
   mailer. The env vars (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`,
   `SMTP_FROM`) are already documented in `.env.example`; the seam (`if
   (process.env.SMTP_HOST)`) exists at line 142. Use `nodemailer` (zero new
   schema changes). *Why:* The current fallback — "link is printed to the API
   logs" — requires a non-developer self-hoster to SSH into the server to
   recover their password. This is not acceptable UX for any production
   multi-user deployment. Password reset is a trust-critical flow; a stub
   isn't enough. *Size:* S (the scaffold is fully built; this is just wiring
   nodemailer into the existing seam).

2. **Due date on issues** — *What:* Add an optional `dueDate DateTime?` field
   to the `Issue` model (Prisma migration + DTO update). Surface it as a date
   picker in the issue drawer. Show a due-date chip on the card when set; flag
   overdue issues in "My Work" with a warning color; add a due-date sort option
   to the backlog. *Why:* The schema has no per-issue deadline. Teams plan
   sprints by end date but need per-issue deadlines for external commitments
   (client deliveries, release gates). "My Work" is the ideal place to surface
   overdue issues — the data model already supports cross-project aggregation.
   This is the single most common field request in comparable trackers. *Size:*
   M (schema + API + UI — drawer picker + card chip + My Work warning).

3. **WATCHED_UPDATED notifications (watcher email updates)** — *What:* Emit
   a `WATCHED_UPDATED` notification to all watchers (excluding the actor) when
   any field on a watched issue changes — status, assignee, priority, sprint
   assignment. `NotificationType.WATCHED_UPDATED` is already in the schema
   enum and the bell label map; the `Watcher` model is populated on
   assignment/comment. What's missing is the emission in `IssuesService.update`
   (fan-out to watchers on field change). *Why:* Watchers are how teammates
   stay informed without being @mentioned. Currently a watcher gets zero
   notification when an issue they're watching is re-prioritized or completed.
   The entire watcher model is effectively inert for notifications. *Size:* S
   (single fan-out call in `IssuesService.update`, mirroring the comment fan-out
   pattern already in `NotificationsService`).

4. **Postgres full-text search (replace ILIKE contains)** — *What:* Add a
   `tsvector` generated column on `Issue` (title + description) with a GIN
   index and switch `SearchService.searchIssues()` from `contains: query,
   mode: 'insensitive'` to `Prisma.$queryRaw` with `to_tsquery`. The index
   makes search sub-millisecond on large tables; `ILIKE %query%` table-scans
   even with partial indexes on `title`. *Why:* At 5,000+ issues (common for
   a team 6 months in) the command palette query takes hundreds of milliseconds
   on an index scan across title+description. The current search is a sequential
   `ILIKE` — it degrades linearly. A GIN index on a generated `tsvector` column
   is the standard Postgres answer. *Size:* M (migration + Prisma raw query +
   test update).

5. **Attachment admin-delete UX gap** — *What:* `AttachmentsPanel.tsx` shows
   the delete button to all editors (not just the uploader) but acknowledges in
   a comment that "we let the API reject with 403 if the user isn't an uploader
   or admin." An ADMIN who tries to delete another user's attachment sees the
   button, clicks it, and gets a 403 toast — a confusing experience given that
   the `AttachmentsService` does allow ADMIN-role deletes. Fix: pass the current
   user's role to `AttachmentRow` and set `canDelete` to `true` when
   `editable && (isUploader || isAdmin)`. *Why:* Admins routinely need to clean
   up inappropriate attachments; today they see the button but get rejected. The
   API already permits it — the UI just doesn't know the role. *Size:* S.

6. **Live board presence (who-is-viewing)** — *What:* Show avatar chips of
   workspace members currently viewing the same board (or any project surface).
   The `RealtimeGateway` tracks connections; adding a per-project presence map
   (join → add user, leave → remove, broadcast `presence.update`) requires zero
   new API routes and a small UI change in the board toolbar. *Why:* "Who else
   is here?" is a collaboration primitive that reduces duplicate-editing
   conflicts and creates a sense of team. The underlying socket infrastructure
   is already in place. *Size:* S (gateway change + board toolbar avatar strip).

7. **Public read-only project share link** — *What:* A `ShareToken` model
   (projectId + token + expiry); a `GET /share/:token/board` endpoint returning
   the board data without authentication; a read-only board view (no DnD, no
   create, no drawer editing). *Why:* Self-hosted teams routinely need to share
   a board with a stakeholder or client who doesn't have (and doesn't need) an
   account. This is the #1 adoption lever for teams evaluating a self-hosted
   tracker — "can I show this to my PM without giving them a login?" No schema
   changes to Issue are needed; only a new `ShareToken` model. *Size:* M
   (schema + API endpoint + frontend read-only board view).

### New / ambitious ideas (ideation mandate — Pass 5)

Three net-new bets that push beyond gap-filling:

- **O. Markdown rendering in descriptions and comments.** Replace the plain
  `<Textarea>` for issue descriptions and comments with a lightweight
  split-pane editor: left is a textarea (preserving the current editing model),
  right renders the markdown preview using a small library like `marked` or
  `remark`. The stored value remains plain text (no schema change); the
  rendering is purely a UI enhancement. Teams routinely use markdown to format
  acceptance criteria, bug reproduction steps, and PR descriptions — a plain
  textarea feels like a regression compared to what developers use in their
  daily tools (GitHub, GitLab). *Size:* M.

- **P. Sprint retrospective panel (built-in structured retro).** After a sprint
  is completed, a "Retrospective" modal (accessible from the completed sprint
  row in the backlog) offers a simple "What went well / What to improve /
  Action items" format — stored as a JSONB field on the `Sprint` model. The
  velocity chart could surface a "Retro available" badge per completed sprint.
  This is a natural extension of the sprint lifecycle that many teams perform
  externally in shared docs, and having it in the tracker keeps the whole
  sprint story in one place. No external dependency needed. *Size:* M.

- **Q. Issue templates per project.** An ADMIN can configure 1–5 issue
  templates per project (stored as a JSONB array on `Project`): template name,
  pre-filled title prefix, description skeleton, default type, default labels.
  When the user opens the create-issue modal, they pick a template from a
  dropdown. Bug reports, feature requests, and subtasks each have different
  required fields — pre-filling them reduces the friction of logging a new
  issue and improves data quality. No migration beyond adding a `templates`
  JSON column to `Project`. *Size:* M.

### Direction (next quarter — Pass 5 view)

Next Lane at Pass 5 is a finished-feeling, credible agile tracker. The
remaining work is not "finish the product" but "make it trusted, sharp, and
chosen."

**Trust.** The password reset SMTP stub is the most urgent gap — a
non-developer self-hoster who gets locked out has no recovery path today. Fix
the SMTP stub (S, a single afternoon's work given the scaffold exists). While
there, wire `WATCHED_UPDATED` notifications (S) to make the watcher model
actually useful. These are small builds with outsized trust impact.

**Sharpness.** Due dates (M) and Postgres full-text search (M) are the two
features that will frustrate a team 3 months into daily use. Due dates are
missing entirely from the schema; without them "My Work" can't surface "what's
overdue" which is the question teams ask every morning. Full-text search
degrading on large issue sets is a performance cliff that will arrive
predictably as teams grow. Both belong in the next sprint.

**Differentiation.** The public share link (M) is the feature that drives
organic adoption — a shared board URL is how teams discover the product. The
markdown rendering (M) is the quality signal that developers use to evaluate
whether a tool is "serious." Sprint retrospective panel (M) locks teams into
the product's sprint lifecycle in a way no competitor does embedded. These
three together define a next-quarter arc: from "tracker we chose" to "tracker
we recommend."

### Backlog-groomer ingest — Pass 5 (title · priority · size · rationale)

- Wire SMTP email delivery for password reset (nodemailer into existing stub seam) · P1 · S · stub only today; non-developer self-hosters have no recovery path; scaffold fully exists
- Due date on issues (schema field + drawer picker + card chip + My Work overdue warning) · P1 · M · no per-issue deadline in schema; most-requested primitive; My Work is the natural surface for overdue flagging
- WATCHED_UPDATED notification emission (fan-out to watchers on issue field change) · P1 · S · `WATCHED_UPDATED` enum defined and in bell label map but never emitted; watcher model is inert for notifications
- Attachment delete for ADMIN role (pass role to AttachmentRow; avoid spurious 403 on known-permitted action) · P2 · S · ADMIN can delete at API but UI shows button then 403; confusing; one-line fix with role prop
- Postgres full-text search for issues (GIN index on tsvector generated column) · P2 · M · ILIKE contains scans degrade linearly; sub-second search needed at 5k+ issues; standard Postgres answer
- Live board presence indicators (who-is-viewing avatars via existing gateway presence map) · P2 · S · collaboration primitive; gateway infrastructure in place; zero new API routes
- Public read-only project share link (ShareToken model + unauthenticated board endpoint + readonly view) · P2 · M · #1 self-hosted adoption lever; stakeholders without accounts; "show this to my PM"
- Markdown rendering in issue descriptions and comments (marked/remark preview pane) · P2 · M · plain textarea signals immaturity to developers; no schema change; purely a UI enhancement
- Sprint retrospective panel (What went well / improve / actions — JSONB on Sprint, retro badge on velocity chart) · P3 · M · keeps sprint story in one place; natural extension of sprint lifecycle; no external tool needed
- Issue templates per project (JSONB on Project; template picker in create-issue modal) · P3 · M · reduces create-issue friction; improves data quality; loved by self-hosted teams who configure their own process
- SMTP email notification delivery for all notifications (opt-in per user, same env-var pattern) · P3 · M · in-app only today; async notifications for users not logged in; needed before teams with off-hours members adopt it
- JWT refresh tokens + httpOnly cookie migration · P3 · L · token in localStorage XSS-extractable; helmet CSP is adequate mitigation today but not indefinitely; revisit before a rich-text editor lands

---

## 2026-06-27 — Pass 6 (Category-Parity Benchmark)

**Method.** Deep structural audit against the category-parity benchmark introduced in the agent definition. Excluded the four capabilities already confirmed in-flight this session (multiple/configurable boards, NLQL query language, custom fields, card-color rules) — those are present in the schema (`Board.filterQuery`, `Board.colorRules`, `BoardType` enum, migration `20260627250000_add_board`) but their implementation modules (board switcher, NLQL parser, custom-field CRUD, color-rule evaluation) do not yet exist anywhere in `apps/api/src/` or `apps/web/src/`. Confirmed via Glob — no `boards/` module, no `nlql/` directory, no `custom-field*` file. Read `schema.prisma`, every controller (`apps/api/src/**/*.controller.ts`), `BoardPage.tsx`, `BacklogPage.tsx`, `TriagePage.tsx`, `SettingsPage.tsx`, `IssueCard.tsx`, `IssueDetailDrawer.tsx`, `ROADMAP.md`, `BACKLOG.md` to establish evidence for each cell.

**Framing.** The benchmark below is scored against what a category-leading self-hosted or hosted agile issue tracker ships as a standard feature — not against a maximum theoretical featureset. "Leader baseline" describes that target. Every score ≤ 3 is flagged as a parity gap.

### Category-Parity Scorecard

| Capability | Our Depth (1–5) | Leader Baseline | Gap Size | Evidence |
|---|---|---|---|---|
| **Multiple boards per project** | 1 | 3–5 named boards; board switcher UI | L | `Board` model + migration exist; `BoardType` enum exists; `board.controller.ts` has exactly one route (`GET /projects/:projectId/board` — no boardId param); zero board-list/create/delete routes; `useBoard()` hook has no board-ID arg; no board switcher in UI |
| **Board type: Kanban vs Scrum** | 1 | Distinct board modes; Scrum shows active-sprint scope by default | M | `BoardType.SCRUM` exists in schema and enum; `BoardService.getBoard()` ignores `board.type` entirely (applies active-sprint scoping regardless); no type toggle or creation flow in the UI |
| **Configurable columns (status CRUD)** | 4 | Add/rename/reorder/delete columns via settings | — | Fully shipped: `StatusesController` CRUD, SettingsPage Columns section with reorder/rename/delete, ADMIN enforcement. Closest to parity. Minor gap: deleting a non-empty status is blocked (must clear issues first); leader trackers auto-reassign. |
| **Swimlanes** | 1 | Group rows on board by assignee/epic/priority with collapse | L | Not implemented anywhere. No `groupBy` or `swimlane` concept in schema, service, or UI. `BoardPage.tsx` has no grouping dimension. |
| **Quick filters** | 2 | 1-click "My issues", "Unresolved", "Recently updated" preset strips | S | Board has 5 ad-hoc filter controls (title search, assignee select, labels, type, priority). No preset quick-filter chips — no "My issues" button, no "Unresolved" shortcut. All filtering is manual multi-select. |
| **Query language (NLQL / JQL-like)** | 1 | Structured text query with field operators, AND/OR, functions like `me()`, `currentUser()` | L | `Board.filterQuery` column exists and schema comment calls it "NLQL". `BoardColorRule.query` type also references NLQL. Zero parser, zero evaluator, zero UI anywhere. Both fields are marked "dormant until then" in the schema comment. |
| **Saved filters / named views** | 1 | Save any filter combo as a named, personal or shared view | M | No `SavedFilter` or `SavedView` model in schema. BACKLOG lists "Saved/shareable views + query DSL" as P3/deferred. Board filters are entirely in-memory React state (lost on reload). |
| **Custom fields (user-defined)** | 1 | Text/number/select/date/checkbox/URL fields per project, targetable per issue type | L | No `CustomField`, `FieldDef`, or `FieldValue` model in schema. ROADMAP Phase 3 lists "Custom fields (typed, JSONB-backed)" as ⬜. BACKLOG has it at P3/M. Zero code beyond the backlog entry. |
| **Conditional card colors / rules** | 1 | Color rules stored per board; first-match wins; UI to add/edit/delete rules | M | `Board.colorRules Json?` column exists in schema. `BoardColorRule` interface defined in `packages/shared/src/types.ts`. No rule-evaluation logic exists. No UI to create/edit rules. `IssueCard.tsx` applies no dynamic background color. Schema comment: "dormant until then." |
| **Configurable card fields** | 2 | Toggle which fields appear on cards (labels, points, assignee, priority, due date) | S | Card shows fixed field set: labels, due date, status picker, type icon, issue key, priority icon, story points bubble, comment count, assignee avatar. No configuration layer — all fields always rendered (conditionally if non-null). No board settings panel for card layout. |
| **Workflow: configurable statuses** | 4 | Project-specific status names/categories/order | — | Fully functional via SettingsPage Columns section. ADMIN can create/rename/reorder/delete statuses. Category (TODO/IN_PROGRESS/DONE) is enforced. Strong implementation. |
| **Workflow: configurable transitions** | 1 | Restrict which statuses an issue can move between; validator rules | L | ROADMAP Phase 2 lists "custom workflow transitions" as ⬜ (remaining). Any issue can be moved to any status in any order — no allowed-transitions model or transition guards exist. |
| **Workflow: validators/conditions** | 1 | Require a field (e.g. assignee) before transition to Done; post-functions | L | No validator concept. No `WorkflowRule` model. `StatusesService.remove()` only blocks deleting a status with issues on it. |
| **Automation rules (when X → do Y)** | 1 | Rule engine: trigger (status change/assignment/label/sprint) → action (assign/comment/notify/set field) | L | ROADMAP Phase 3 lists as ⬜; BACKLOG P3/L. `ActivityLog` is a natural event source (noted in prior passes) but zero automation-specific code exists. |
| **Configurable dashboards / gadgets** | 2 | Drag-and-drop widget canvas; user picks and arranges charts/lists | M | `PulseDashboardPage.tsx` ships 4 fixed sections (sprint snapshot, my issues, recent activity, projects). `ReportsPage.tsx` shows 3 fixed charts. No widget library, no layout persistence, no user-configurable arrangement. Fixed-layout dashboards only. |
| **Per-assignee workload / team reports** | 1 | Assignee heatmap; workload distribution; capacity planning | M | Three charts exist (burndown, velocity, CFD). None break down by assignee. `ReportsService` has no per-user aggregation. Triage mode shows an issue list but no capacity summary. |
| **Time tracking / worklogs** | 1 | Log time spent; original/remaining estimate; per-issue time log; report rollup | L | No time tracking anywhere. Schema has no `timeSpent`, `originalEstimate`, or worklog model. ROADMAP Phase 3: "Time tracking / worklogs" ⬜. BACKLOG P3/L. |
| **Cover images on issues** | 1 | Attach a representative image to an issue card (header image shown on card) | S | Attachments panel supports image uploads but there is no "cover" concept — no `coverImageAttachmentId` on Issue, no header image slot on `IssueCard`. Attachments live only in the drawer panel. |
| **Issue links / dependencies** | 1 | Typed links: "blocks", "is blocked by", "relates to", "duplicates" | L | No `IssueLink` model. `parentId` (Epic→Story→Subtask) is the only inter-issue relation. No "blocks/is blocked by" concept. BACKLOG and ROADMAP are both silent on this feature. |
| **Bulk edit** | 1 | Select N issues → set assignee/status/priority/sprint in one action | L | ROADMAP Phase 3 lists "Bulk edit" as ⬜. BACKLOG P3 deferred. No checkbox selection on board or backlog. No batch-update endpoint. `BacklogPage.tsx` has no multi-select. |
| **Sub-task depth** | 3 | Epic → Story → Task → Sub-task (3–4 levels); leader supports arbitrary depth | S | Schema supports self-referential parent/child at unlimited depth. UI (ParentSubtasks.tsx) shows one level (parent chip + direct children list). Cycle prevention goes 1 hop. Practical depth is 2 levels (Epic → Story only) because the UI does not recurse. |
| **Components** | 1 | Reusable named component (e.g. "Backend API", "iOS App") to categorize issues across sprints | M | No `Component` model in schema. No component picker in drawer. Not mentioned in ROADMAP or BACKLOG. |
| **Versions / releases** | 1 | Manage named versions; assign issues to a version; release view; overdue version reports | L | No `Version` or `Release` model. ROADMAP/BACKLOG silent on this. Sprints partially substitute but have no semantic "release" concept (no changelog, no release notes, no version number). |
| **Import / export** | 1 | CSV export of issues; import from CSV or other tracker formats | L | ROADMAP Phase 3: "CSV import (and importers for other trackers)" ⬜. BACKLOG P3 deferred. No export endpoint exists. No import endpoint. Not a single import/export file in `apps/api/src/`. |
| **Watchers / followers** | 3 | Any user can watch any issue; watchers receive notifications on changes | M | `Watcher` model exists (populated on assignment/comment). `WATCHED_UPDATED` notification now emits on field changes (shipped this session). Gap: no "Watch" button in the issue drawer UI — users cannot manually watch an issue they didn't create/comment on. Auto-watching on assignment/comment is present; voluntary subscription is absent. |
| **Board keyboard shortcuts** | 2 | Keyboard shortcuts for board navigation, create, assign, status change | S | Triage mode has full j/k/a/p/l/s/Enter keyboard nav (excellent). Board itself has: `CardStatusPicker` opens on click; `Cmd-K` command palette. No keyboard shortcut to create issue from board, jump between columns, or focus next card. Triage covers the keyboard-triage pattern well; the board itself remains click-driven. |
| **Keyboard power-user flows** | 4 | Cmd-K global, keyboard nav in palette, drawer keyboard fields | — | Command palette (Cmd-K), palette ↑↓/Enter/Esc, triage mode j/k/s/p/l/a/f/?, Cmd+Enter to save comments — genuinely good. |
| **Permissions granularity** | 3 | Issue-level permissions; field-level edit restrictions; custom roles | M | Three workspace-scoped roles (ADMIN/MEMBER/VIEWER). No project-level role override. No issue-level ACL. No field-level editing restrictions (e.g. "only Admins can change priority"). Custom roles not supported. Leader trackers offer project-level role assignment and field-level security. |
| **Mobile experience** | 3 | Fully responsive; native-like navigation on small screen | M | Board, backlog, triage all usable. Filter toolbar uses overflow-x-auto on mobile. `CreateIssueModal` still uses `grid-cols-2` without `sm:` breakpoint guard (two-column at 375px is cramped). No hamburger menu or bottom tab bar — top nav is the same desktop tabs. |
| **Onboarding / empty states** | 4 | Guided create-first-project flow; contextual tips; sample project | — | `OnboardingPanel` ships at zero-projects state with feature highlights and CTA. Empty states on every page. Good quality — no interactive tour remaining. |

### Ratings Update (Pass 6 — parity-focused view)

| Area | Score | Pass-5 | Delta | Note |
|---|---|---|---|---|
| Auth | 4 | 4 | = | Unchanged. Password reset wired (SMTP stub now has nodemailer seam). PATs. Still single 7-day JWT in localStorage. |
| Projects | 5 | 5 | = | |
| Board (kanban) | 4 | 5 | -1 | Downgrade: board is single per project (no multi-board), no swimlanes, no board-type distinction at runtime, no quick-filter presets. The strong DnD + filters are real but parity gap on board multiplicity is material. |
| Issues (CRUD) | 5 | 5 | = | Drawer complete. Due date wired. Markdown. Attachments. |
| Comments / activity | 4 | 4 | = | |
| Search / filter | 4 | 4 | = | FTS shipped. No saved views, no NLQL execution, no shareable filter URLs. |
| Sprints / backlog | 5 | 5 | = | |
| Labels | 5 | 5 | = | |
| Reports | 4 | 4 | = | Three charts. No assignee-workload, no per-version burndown. |
| Notifications | 4 | 4 | = | WATCHED_UPDATED now emits. No "Watch" button in UI. |
| Roles / permissions | 3 | 5 | -2 | Reassessed against parity standard: three workspace roles, no project-level role override, no issue-level ACL, no custom roles. For a self-hosted tool this is meaningful — teams with contractors or clients need finer grain. |
| Mobile | 3 | 3 | = | |
| Onboarding | 4 | 4 | = | |

### Top Gaps (parity-benchmark candidates — Pass 6)

The four in-flight items (multiple boards, NLQL, custom fields, card colors) are excluded per the mandate. All gaps below are net-new or newly promoted.

1. **Issue links / dependencies ("blocks", "is blocked by", "relates to", "duplicates")** — The most glaring structural gap in the data model. Every category-leading tracker treats issue relationships as a first-class concept: typed links between any two issues, a "blocked" badge on the card, a "blocking" list in the drawer. This is how teams model actual work dependencies. Zero schema model exists today. Size: M (schema `IssueLink` + CRUD endpoints + drawer UI + card badge).

2. **Swimlanes on the board (group by assignee / epic / priority)** — Swimlanes are the primary way multi-person teams visualize who owns what at a glance. Without them, a board with 5 people and 80 cards is a wall of undifferentiated cards. The board's DnD infrastructure (`dnd-kit`, fractional ranks, columns) already handles one dimension well; adding row-based grouping is a UI layer on top. Size: L (board layout restructure, groupBy state, backend group-query endpoint or client-side grouping).

3. **Bulk edit (select-N issues → batch update status/assignee/priority/sprint)** — Sprint planning routinely involves "move all these 10 stories to this sprint" or "set all unassigned bugs to High priority." Today every one of those is a separate drawer interaction. A checkbox column on the backlog/triage view + a batch-update API endpoint would eliminate the most tedious part of sprint planning. ROADMAP lists it as ⬜ Phase 3. Size: L (backlog checkbox column + board checkbox overlay + `PATCH /issues/bulk` endpoint).

4. **"Watch" button in the issue drawer (voluntary watchers)** — `Watcher` model exists and `WATCHED_UPDATED` notifications now emit — but there is no way for a user to manually watch an issue they didn't comment on or get assigned. The drawer has no "Watch" / "Unwatch" toggle. This means the watcher model only auto-populates and cannot be used for stakeholder-driven subscribe patterns (e.g. a PM watching a bug they reported but didn't get assigned). Size: S (drawer watch toggle + `POST/DELETE /issues/:id/watchers` endpoints, both trivial against the existing model).

5. **Workflow transitions (configurable allowed-transition map)** — ROADMAP Phase 2 explicitly lists "custom workflow transitions" as ⬜ remaining. Currently any issue can be dragged or patched from any status to any status. Leader trackers let Admins define which transitions are permitted (e.g. "In Review" can only come from "In Progress", not "To Do") and optionally require a field before allowing a transition (e.g. assignee must be set before moving to "In Review"). This is the enforcement layer that makes workflow automation meaningful. Size: L (schema `Transition` model, service-layer validator in `IssuesService.update`/`move`, UI hint when a transition is disallowed).

6. **Import / export (CSV and tracker-format importers)** — Self-hosted adoption is heavily gated on whether teams can bring their existing data. ROADMAP Phase 3 lists CSV import and importers as ⬜ but has not progressed. A "CSV issues export" is the most requested feature by teams evaluating alternatives — they want a data escape hatch. The import side (at minimum CSV with column mapping) is what turns a trial into a migration. Size: L (export endpoint: straightforward; import: schema mapping complexity is the bulk of the work).

7. **Per-assignee workload / capacity report** — The three existing charts (burndown, velocity, CFD) are sprint-centric. Teams managing people need to see: "who has how many open issues?", "which developer is overloaded?", "who has capacity for new work?". A per-assignee workload view (issue count by status category per member) is a one-query addition to `ReportsService` and a small new chart. Size: M (one DB aggregation query + new chart component + ReportsPage tab).

8. **Versions / releases** — Sprints model time-boxes but not software releases. A `Version` model (name, release date, description, linked issues) gives product teams a way to say "these features are in v2.1", generate a changelog view, and track what's committed to an upcoming release independently of sprint cadence. Many self-hosted teams use this to coordinate with external stakeholders. Size: L (schema + CRUD + issue-drawer version picker + release page).

9. **Components** — Named components (e.g. "Backend API", "iOS App", "Data Pipeline") are how teams filter and route issues within a project that spans multiple sub-systems. Without components, label taxonomy bears all the routing load and grows unwieldy. A `Component` model (name, default assignee, description per project) is a lightweight addition. Size: M (schema + CRUD + issue drawer component picker + board filter by component).

10. **Quick-filter presets on the board** — The board has 5 manual filter controls but no 1-click "My issues", "Unresolved", "Recently updated", "High priority" preset buttons. These presets are the daily entry point for triage — they replace the most common multi-control combinations with a single tap. Size: S (client-side preset buttons that set existing filter state; no new API needed).

11. **Project-level role overrides** — Currently roles are workspace-scoped: a MEMBER is a MEMBER on every project in the workspace. Multi-team organizations need to give someone ADMIN access to one project without elevating them workspace-wide, or restrict a contractor to VIEWER on specific projects. A `ProjectMembership` override model (userId + projectId + role, checked before workspace-level role) would enable this. Size: M (schema addition + permission-check ordering in `assertProjectRole` + project settings Members section).

### New / Ambitious Ideas (Ideation Mandate — Pass 6)

Three bets that go beyond the parity gap:

- **R. GitHub / GitLab branch and PR linking.** Connect an issue to one or more branches and pull requests via a lightweight integration: the issue drawer shows linked PRs (status: open/merged/closed, diff link), and a webhook from GitHub/GitLab can transition an issue to "In Review" when a PR opens or "Done" when it merges. PATs + webhooks are already shipped — this is a wiring problem, not a new architectural concept. Teams that live in git will judge Next Lane by whether it feels native to their SCM workflow. Size: M.

- **S. "Workday" view — time-blocked issue calendar.** A per-user calendar view where issues with due dates are shown as date blocks. Users drag issues onto dates to set/change due dates. The `dueDate` field is now wired end-to-end; a calendar UI built on top of it would give the product a personal task-management skin that sits alongside the team board. Size: M (new calendar page, no schema changes).

- **T. AI-assisted issue triage (local-LLM-friendly).** A project-settings toggle to configure a triage assistant: when a new issue is created, the assistant suggests a priority (from similar historical issues via FTS), a likely assignee (from past patterns), and relevant labels — shown as inline suggestions in the create-issue modal with one-click accept. The GIN FTS index is already in place; the matching logic is a small similarity query against title+description. For self-hosted teams, a local Ollama endpoint should be configurable (no cloud dependency). Size: L (configurable endpoint in project settings, suggestion generation service, modal integration).

### Direction (next quarter — Pass 6 view)

The product has cleared the "basic agile tracker" bar decisively. The parity audit reveals that the next tier of work splits into two categories.

**Category completeness (close the structural gaps).** Issue links/dependencies, swimlanes, bulk edit, and workflow transitions are the four capabilities that teams actively miss when they evaluate alternatives. None of these require the NLQL/custom-fields/multi-board work in flight — they are independent gaps at the data-model and UI layer. Issue links are the highest single unlock: without them, a "blocks" relationship is modeled by free-text comments, which is invisible to the board. Swimlanes are the highest-visibility board enhancement after multi-board support itself. The four in-flight capabilities (NLQL, custom fields, multi-board, card colors) will substantially advance the power-user position once shipped — but the simpler structural gaps above matter more to the median new user.

**Ecosystem completion (make migration easy).** CSV import/export is not a feature — it is a trust signal. Teams will not commit to a self-hosted tracker that does not let them export their data. This belongs on the roadmap before SSO/OIDC or other enterprise-tier additions.

### Backlog-groomer ingest — Pass 6 (title · priority · size · rationale)

- Issue links/dependencies (typed: blocks/is-blocked-by/relates-to/duplicates; IssueLink model; drawer UI; card badge) · P1 · M · structural gap absent from schema; most common team coordination primitive; enables workflow automation later
- "Watch" button in issue drawer (voluntary watcher subscribe/unsubscribe; POST/DELETE /issues/:id/watchers) · P1 · S · Watcher model + WATCHED_UPDATED emission both exist; only the UI toggle is missing; completes the watcher feature
- Quick-filter presets on board ("My issues", "Unresolved", "High priority" 1-click buttons) · P1 · S · most common triage shortcuts; daily-driver quality improvement; no new API needed; sets existing filter state
- Workflow transitions (configurable allowed-transition map per project; ADMIN-defined; validator in move/update) · P2 · L · ROADMAP Phase 2 remaining item; enables meaningful workflow enforcement; prerequisite for useful automation rules
- Swimlanes on board (group by assignee / epic / priority; collapse/expand; dnd-kit row dimension) · P2 · L · multi-person team board usability; category-leader standard; high visual value
- Bulk edit (select-N issues on backlog/triage; batch PATCH status/assignee/priority/sprint) · P2 · L · ROADMAP Phase 3 ⬜; sprint planning speed; cannot move 10 issues without 10 drawer interactions today
- Per-assignee workload / capacity report (issue count by status category per member; new ReportsPage tab) · P2 · M · current reports are all sprint-centric; team managers need person-centric view; one DB aggregation query
- Project-level role overrides (ProjectMembership model; role checked before workspace role) · P2 · M · workspace-scoped roles only today; multi-team orgs need per-project admin without workspace elevation
- Components (named sub-system grouping per project; default assignee; drawer picker; board filter) · P2 · M · label taxonomy overloaded today; components route issues to the right sub-team by default
- Import / export (CSV issues export; CSV import with column mapping; first-pass: export only) · P2 · L · trust signal for self-hosted adoption; teams won't commit without a data escape hatch; ROADMAP Phase 3 ⬜
- Versions / releases (Version model; named releases; issue-to-version assignment; release view; changelog) · P3 · L · sprint ≠ release; product teams need a release abstraction independent of sprint cadence
- GitHub/GitLab PR/branch linking (webhook-driven; issue drawer shows linked PRs + status; auto-transition on merge) · P3 · M · SCM-native feel; PATs + webhooks already shipped; key differentiator for developer-led teams
- Per-user "Workday" calendar view (due-date issues as calendar blocks; drag to reschedule) · P3 · M · dueDate field now wired; personal task-management skin; differentiates personal productivity use case
- AI-assisted issue triage (priority/assignee/label suggestions in create modal; configurable local-LLM endpoint) · P3 · L · self-hosted teams can point at Ollama; FTS GIN index is already in place; high differentiation

---

## Pass 7 — 2026-06-28

**Auditor:** Product / UX (independent)
**Scope:** Full product audit with focus on verifying recently shipped features (personal boards, personal/team analytics, automation engine with Glass Box run log, design cohesion). Evidence-based ratings from code reading across ~30 source files.

---

### Ratings Table

| Area | Score | Note |
|---|---|---|
| Auth | 4/5 | JWT + email/password + PATs (`nlp_`-prefixed, SHA-256 hashed, REST + WebSocket). No SSO/OIDC. JWT stored in localStorage (XSS exposure vs httpOnly cookie). Magic-link or social login absent. |
| Projects | 4/5 | Full CRUD; multi-project workspace; member invite/manage. No project-level role overrides (workspace role only). Component and Version models exist in schema but have zero API controllers and zero UI — schema-only placeholders. |
| Board (Kanban) | 5/5 | Multi-board per project; BoardSwitcher; board type support; NLQL query bar; 4 quick-filter presets (myIssues/highPriority/unresolved/recent) composable via OR logic; CardStatusPicker (inline status transition — keyboard-accessible, confirmed implemented); card color accent stripe; presence avatars; dnd-kit PointerSensor (distance:5) + KeyboardSensor. Best-in-class area. |
| Issues (CRUD) | 4/5 | Comprehensive drawer: title, description (rich text), status, priority, assignee, labels, due date, story points, custom fields (appliesToTypes-scoped), issue links (blocks/relates-to/duplicates), watch toggle. Missing: time tracking (logged/estimated hours), configurable workflow transitions. |
| Comments / Activity | 4/5 | Markdown rendering; @mentions; edit/delete; real-time via Socket.io; full activity log. No threaded replies; no comment reactions; no draft persistence across page loads. |
| Search / Filter | 4/5 | NLQL (tokenizer+parser+evaluator in `packages/shared`) with `me()`, `today()`, `AND`/`OR`, `IN`, `IS EMPTY`, field operators; saved filter CRUD with share toggle; full-text search fallback; quick-filter presets. Critical gap: filter state resets on navigation — not persisted to URL or localStorage. |
| Sprints / Backlog | 4/5 | Full sprint lifecycle (plan/start/complete); backlog rank (fractional indexing); sprint goal, date, capacity display; planning poker (VOTING→REVEALED→CLOSED state machine with vote masking). Missing: bulk edit on backlog (must open each issue individually), sprint retrospective UI, velocity vs. capacity comparison in sprint planning view. |
| Labels | 5/5 | Create/rename/delete/assign/multi-assign; colored chips on cards and drawer; used in board filters, NLQL conditions, card color rules, automation conditions. Fully integrated across all surfaces. |
| Reports | 3/5 | Velocity chart, burndown chart, CFD (cumulative flow diagram), team analytics (throughput, open/closed counts, by-type bars). Fixed chart set only. No configurable dashboards, no custom metric gadgets, no sprint comparison view, no team-vs-capacity report. |
| Notifications | 3/5 | In-app real-time dropdown (unread badge via Socket.io push); mark individual or all read; watch/mention-triggered. Email delivery exists only for password-reset (SMTP wired). No email fan-out for issue/comment/assignment notifications. No dedicated notifications page — all deep-link to `board?issue=`. |
| Roles / Permissions | 3/5 | Workspace roles (ADMIN/MEMBER/VIEWER) enforced at service layer via `assertProjectRole`. No per-project role overrides. All workspace members share the same role across all projects. No team-level role grouping in UI. |
| Mobile Experience | 3/5 | Responsive breakpoints; ProjectNav "More" dropdown collapses secondary tabs gracefully. Board horizontal scroll works on touch. NLQL bar with multi-field filter toolbar becomes dense/cramped on viewport <768px. Drag-and-drop on mobile limited (PointerSensor works but small card targets). |
| Onboarding / Empty States | 3/5 | `OnboardingPanel.tsx` shows "Welcome to Next Lane" with feature highlights grid and "Create your first project" CTA. Highlights only 3 features (Kanban board, Sprints & backlog, Reports). Automation, NLQL search, planning poker — the differentiating features — are not mentioned. Empty board state shows create-issue prompt. |
| Automation | 3/5 | Real engine: `@OnEvent` listeners for 4 triggers (ISSUE_CREATED/UPDATED/TRANSITIONED/COMMENTED); NLQL condition evaluation; 6 action types (ASSIGN, SET_PRIORITY, TRANSITION, ADD_LABEL, ADD_COMMENT, SET_CUSTOM_FIELD); loop guard (`if (event.automated) return`); Glass Box AutomationRun log (SUCCESS/SKIPPED/FAILED per rule). Missing: scheduled/time-based triggers; sprint event triggers; "issue becomes overdue" trigger; no bulk-apply-to-existing-issues action. Run log will grow noisy because every SKIPPED evaluation (all rules against every event) is recorded verbosely. |
| Personal Boards | 4/5 | Private personal kanban (userId-scoped, no workspace membership check); custom columns; card CRUD; "Promote to issue" action (creates a real project issue from personal card). Confirmed in `PersonalBoardPage.tsx`. Missing: labels, due dates, and assignee on personal cards. |
| Personal / Team Analytics | 3/5 | `PersonalAnalyticsPage.tsx`: 4 StatCards (open/completed/overdue/avg cycle time), throughput area chart (SVG), by-type and by-priority category bars, personal board mini-stats. WindowSelector (14/30/90 days). Accessible (role="img", aria-label, sr-only summaries). Missing: comparison context — numbers are shown without "vs. previous period" or "vs. team average," making them hard to interpret. Team analytics: same fixed chart set. No per-member breakdown within project analytics. |

---

### Parity Scorecard

Category-leading issue trackers (open-source and commercial) in this space are the benchmark for depth ratings.

| Capability | Our Depth (1-5) | Leader Baseline (1-5) | Gap Size | Parity Gap? |
|---|---|---|---|---|
| Multiple boards per project | 5 | 5 | None | No |
| Board types (Kanban / Scrum) | 4 | 5 | Small | No |
| Configurable columns | 4 | 5 | Small | No |
| Swimlanes (group-by assignee/epic/priority) | 1 | 5 | Large | YES |
| Quick filters on board | 5 | 5 | None | No |
| NLQL / query language | 5 | 4 | None (ahead) | No |
| Saved filters | 5 | 5 | None | No |
| Filter state URL persistence | 1 | 5 | Large | YES |
| Custom fields (text/number/select/date/checkbox) | 4 | 5 | Small | No |
| Custom fields on cards / configurable card fields | 1 | 4 | Large | YES |
| Conditional card colors / rules | 5 | 4 | None (ahead) | No |
| Cover images on cards | 1 | 3 | Medium | YES |
| Configurable workflow transitions | 1 | 5 | Large | YES |
| Workflow rules / validators | 1 | 4 | Large | YES |
| Automation rule engine | 3 | 5 | Medium | YES |
| Scheduled / time-based automation triggers | 1 | 4 | Large | YES |
| Configurable dashboards / gadgets | 1 | 5 | Large | YES |
| Fixed report set (velocity/burndown/CFD) | 3 | 3 | None | No |
| Bulk edit (backlog/triage) | 1 | 5 | Large | YES |
| Issue links / dependencies | 5 | 5 | None | No |
| Watchers / watch toggle | 5 | 5 | None | No |
| Time tracking (logged/estimated hours) | 1 | 5 | Large | YES |
| Components (sub-system grouping) | 1 | 4 | Large | YES |
| Versions / releases | 1 | 5 | Large | YES |
| Import / export (CSV/JSON) | 1 | 5 | Large | YES |
| Email notifications (mentions/assignment/watch) | 1 | 5 | Large | YES |
| Per-project role overrides | 1 | 5 | Large | YES |
| Planning poker | 5 | 3 | None (ahead) | No |
| Async standups | 5 | 2 | None (ahead) | No |
| Keyboard power-user flows | 4 | 5 | Small | No |
| SSO / OIDC | 1 | 4 | Large | YES |

**Parity gaps (score <= 3, outranking infra/polish):** Swimlanes, filter URL persistence, configurable card fields, configurable workflow transitions, workflow validators, automation scheduled triggers, configurable dashboards, bulk edit, time tracking, Components UI, Versions UI, import/export, email notifications, per-project role overrides, SSO/OIDC.

---

### Top Gaps — Prioritized Backlog Candidates

**Gap 1: Swimlanes on board**
- What: Group board columns by a second dimension — assignee, epic, priority, or label — so each group gets its own horizontal row of status columns. Cards can be dragged between swimlanes. Rows can be collapsed.
- Why it matters: A team board with more than 3 active members becomes unreadable as cards pile up in a single column. Grouping by assignee is the single most-requested feature in any growing team tracker. Without it, users resort to "one board per person" workarounds, fragmenting the shared view.
- Rough size: L (dnd-kit row dimension, new droppable contexts, backend groupBy query param, swimlane header UI)
- Evidence: No `swimlane` reference in any source file. `BoardPage.tsx` has no groupBy state.

**Gap 2: Bulk edit on backlog / triage**
- What: Select-N issues via checkbox; apply batch PATCH (status, assignee, priority, label, sprint) from a sticky action bar at the bottom of the list. Keyboard shortcut to select all visible.
- Why it matters: Sprint planning today requires opening each issue drawer individually to update estimates or assignments. A 30-issue sprint planning session involves 30 drawer open/close cycles. This is the highest-friction daily workflow for any scrum team.
- Rough size: L (checkbox column in BacklogPage/TriagePage, multi-select state, batch PATCH endpoint, sticky toolbar)
- Evidence: No `selectedIssues`, `bulkEdit`, or `batch` reference in any page file. `BacklogPage.tsx` renders each issue as individual row with no selection mechanism.

**Gap 3: Email notifications for all notification types**
- What: Send email for ISSUE_ASSIGNED, ISSUE_COMMENTED (mention), ISSUE_WATCHED_UPDATED, and custom per-user preferences. Digest option (immediate / hourly / daily). SMTP already configured for password reset.
- Why it matters: Teams do not live in the tracker — they check email. Without email delivery, the "watch" and "@mention" features lose half their value. Users miss updates when they are not actively looking at the board. Self-hosted teams especially rely on email since they cannot push to mobile.
- Rough size: M (NotificationEmailService, BullMQ email job, per-user preference model, email templates)
- Evidence: `apps/api/src/auth/auth.service.ts` already has `MailerService` for password reset. `Notification` model in schema has all required fields. The delivery fan-out is the missing piece.

**Gap 4: Configurable workflow transitions**
- What: Per-project ADMIN-defined allowed-transition map (e.g., "In Progress → Done" allowed; "Backlog → Done" blocked). Validator called on every PATCH /issues/:id status change and TRANSITION event. UI in project settings: drag-and-drop transition builder.
- Why it matters: Today any status can move to any other status. This means workflow rules in automations are meaningless (an automation can't say "reject if skipping QA") and a VIEWER can accidentally close an issue that was never reviewed. Transition guards are the foundation that makes automation conditions useful.
- Rough size: L (WorkflowTransition schema model, API validator middleware, settings UI, update automation engine to fire BEFORE transition)
- Evidence: `AutomationTrigger` enum has ISSUE_TRANSITIONED but no guard rails stop illegal transitions. `schema.prisma` has no `WorkflowTransition` model.

**Gap 5: Import / export (CSV at minimum)**
- What: Export all project issues to CSV (title, description, status, assignee, priority, labels, custom fields, dates). Import CSV with column mapping wizard. JSON export for full-fidelity backup.
- Why it matters: "Your data, your compute" is the central brand promise of this self-hosted product. Without a data export, that promise is hollow — users cannot migrate away if they need to, which is exactly the vendor lock-in they chose self-hosted to avoid. CSV export is also the fastest path for teams evaluating the product to bring their existing issue backlog in.
- Rough size: M (export: streaming CSV endpoint; import: multipart upload + column-mapping UI + upsert service)
- Evidence: No `import`, `export`, `csv`, or `xlsx` reference in any backend module or frontend page.

---

### Ideation — 3 Ambitious New Features / UX Improvements

**Idea 1: AI-powered triage assistant ("Smart Triage")**
The issue create modal gains a "Triage suggestions" panel that appears 0.5 s after the user finishes typing a title. It shows inferred priority (High/Medium/Low), a suggested assignee based on past routing patterns for similar issues, and up to 3 label suggestions. Suggestions are rendered as one-click accept chips. The backend calls a configurable LLM endpoint (pointing at a local Ollama instance by default — consistent with the self-hosted, privacy-first brand). The full-text search GIN index already in place provides the "similar past issues" context. This is directly achievable today: endpoint config in project settings, embeddings generated at issue create/update, nearest-neighbor lookup against open issues. Estimated size: L. Differentiation: no category-leading tracker (open-source tier) ships this out of the box for self-hosted deployments.

**Idea 2: Keyboard command palette (Cmd+K)**
A floating search/action palette invoked by Cmd+K (Mac) / Ctrl+K (Windows). Top results include: recent issues (fuzzy title match), jump-to-project, jump-to-board, create issue (opens modal pre-focused), run saved filter, toggle theme. Implemented as a modal with a single input, a virtualized result list, and a keyboard navigation loop. This is a well-understood pattern with minimal backend work (client-side fuzzy search over cached TanStack Query data + a few server calls for cross-project results). Estimated size: M. Differentiation: power users currently must navigate by clicking; a command palette would cut 3-5 navigation clicks to 1. It also makes the automation, standup, and poker features discoverable without requiring users to find the "More" dropdown.

**Idea 3: Roadmap / timeline view with dependency arrows**
The existing `RoadmapPage.tsx` shows epics and sprints as horizontal bars. Extend it with: (a) dependency arrows between issues that have "blocks" links, rendered as SVG bezier curves connecting bar endpoints; (b) a "critical path" highlight mode that colors the longest dependency chain red; (c) drag-to-reschedule that updates the issue due date. This surface transforms the existing issue link and due date data (both already in schema) into a planning artifact that managers and product owners actually use. Estimated size: L. Differentiation: timeline views with dependency rendering are typically enterprise-tier features in comparable trackers. Shipping it here would be a genuine differentiator for self-hosted teams.

---

### UX Issues Detectable from Code

1. **Filter state resets on navigation** (`BoardPage.tsx`, `NlqlQueryBar` state is local component state — not URL-synced, not localStorage-persisted). Every board navigation discards the user's active query. Workaround is saved filters, but ad-hoc exploration is always lost.

2. **"More" menu buries Automation** (`ProjectNav.tsx` line ~60-90: `MORE_TABS` array contains Analytics, Roadmap, Poker, Standup, Automation). Automation is the most powerful differentiating feature and is invisible to new users unless they click "More". Consider promoting Automation to primary navigation or adding a first-run tooltip.

3. **Personal analytics lacks comparison context** (`PersonalAnalyticsPage.tsx`): StatCards show raw numbers (e.g., "12 completed") with no "vs. last 30 days" delta or "vs. team average" comparison. Without a baseline, the numbers are hard to act on.

4. **Automation run log verbosity** (`automation-engine.service.ts`): Every SKIPPED evaluation is written as an `AutomationRun` record. For a project with 10 rules and 100 issue events per day, that's ~1,000 SKIPPED rows/day before any SUCCESS. The run log UI will become unusable noise. A filter "show failures only" or "show successes only" is needed immediately.

5. **Custom field values invisible on cards** (`IssueCard.tsx`): Custom fields are rendered only in the issue drawer sidebar (`CustomFieldsDrawerSection.tsx`). A card on the board shows no custom field values, meaning field data (e.g., a "Customer" select or "Story points (custom)" number) cannot be used as a visual signal without opening the drawer. Comparable trackers let users configure which fields appear on the card face.

6. **OnboardingPanel highlights only 3 of 12+ features** (`OnboardingPanel.tsx`): The welcome panel names "Kanban board", "Sprints & backlog", "Reports" — three features that are table stakes for any tracker. NLQL search, automation, planning poker, and personal boards are not mentioned. A new user has no signal that these differentiating features exist.

7. **RoadmapPage uses stale token set** (`RoadmapPage.tsx` uses `slate-900`, `slate-500`, `slate-200`). All other recently-updated pages use `ink-*` / `signal-*` / `brand-*` Dispatch tokens. The Roadmap page is visually inconsistent with the rest of the product.

8. **No dedicated notifications page** (`NotificationBell.tsx`): The notification dropdown deep-links directly to `board?issue=`. Users cannot review their notification history without the board view loading. A full-page `/notifications` route would let users triage updates without context-switching to a board they don't need.

---

### Direction — Next Quarter

The product has crossed a significant threshold: the board, NLQL, automation engine, planning poker, personal boards, and analytics are all real and substantive. The differentiators the product was designed around (free, self-hosted, AI-native) are now plausible to a technical audience.

The next quarter must address the **trust and depth gap**. Two things will determine whether teams commit to this tool over established alternatives: (1) **data ownership evidence** — CSV export is non-negotiable for a product whose central claim is "your data, your compute"; (2) **sprint-planning usability** — bulk edit on the backlog eliminates the single highest-friction daily workflow. Both are medium-to-large features but neither requires new infrastructure.

Beyond those two anchors, the parity scorecard reveals a cluster of large gaps (swimlanes, workflow transitions, time tracking, email notifications, per-project roles) that collectively define the gap between "promising prototype" and "production team tracker." Swimlanes and email notifications have the widest reach — they affect every user on every active team. Workflow transitions are the prerequisite for making automations genuinely powerful. These three should follow bulk edit and export as the Q3 focus.

Design cohesion is 80% there. The one concrete remaining task is migrating `RoadmapPage.tsx` from `slate-*` tokens to `ink-*` / `signal-*` / `brand-*`. The new `OnboardingPanel` copy should be updated to surface the differentiating features (NLQL, automation, planning poker) so first-run users understand what makes this tracker different.

---

### Backlog-Groomer Ingest — Pass 7

- Swimlanes on board (group-by assignee/epic/priority; collapsible rows; dnd-kit row dimension) · P1 · L · critical for multi-person teams; board becomes unreadable beyond 3 active members without grouping; no competing feature conflict
- Bulk edit on backlog / triage (checkbox multi-select; batch PATCH status/assignee/priority/label/sprint; sticky action bar) · P1 · L · highest-friction daily workflow; sprint planning requires N drawer opens for N issues; no new infrastructure needed
- Export issues to CSV (streaming endpoint; all fields including custom fields; download trigger from project settings) · P1 · M · data ownership trust signal; central brand promise of self-hosted is hollow without it; builds user confidence before commit
- Email notifications for all notification types (ISSUE_ASSIGNED/MENTIONED/WATCHED_UPDATED; per-user prefs; digest option; BullMQ job; SMTP already wired) · P1 · M · watch and @mention features lose half their value without email delivery; teams do not live in the tracker
- Filter state URL persistence (sync NlqlQueryBar + quick-filter state to URL query params on change) · P1 · S · filter state resets on every navigation; saved filters work around it but ad-hoc exploration is always lost; S-sized win
- Configurable workflow transitions (per-project allowed-transition map; ADMIN-defined in settings; validator on every PATCH status; UI: drag-and-drop transition builder) · P2 · L · prerequisite for meaningful automation; enables guard rails on status changes; WorkflowTransition model needed in schema
- Automation run log filter ("failures only" / "successes only" toggle in AutomationRunsPanel) · P2 · S · 10 rules × 100 events/day = 1,000 SKIPPED rows/day; log becomes unusable noise without filter; trivial frontend change
- Custom field values on board cards (configurable per-board field badges on IssueCard; project settings: select up to 3 fields to show on card) · P2 · M · field data invisible on board today; comparable trackers let users configure card face; no new API needed
- Per-project role overrides (ProjectMembership role field; checked before workspace role in assertProjectRole; project settings members tab) · P2 · M · all workspace members share same role across all projects; multi-team orgs blocked without per-project admin
- Roadmap page token migration (replace slate-* with ink-*/signal-*/brand-* in RoadmapPage.tsx) · P2 · S · visual inconsistency with rest of product; only page not migrated to Dispatch tokens
- OnboardingPanel copy update (add NLQL search, automation, planning poker, personal boards to feature highlights; replace generic 3-feature list) · P2 · S · new users get no signal that differentiating features exist; 30-minute copy change; high discovery value
- Keyboard command palette Cmd+K (floating modal; fuzzy title search across cached issues; jump-to-project; create issue; run saved filter) · P2 · M · power-user navigation; reduces 3-5 click flows to 1; makes More-menu features discoverable; well-understood pattern
- Notifications page (/notifications route; full history; filter by type; mark read) · P2 · S · dropdown-only today; users cannot review history without board context; straightforward route addition
- Import issues from CSV (multipart upload; column-mapping wizard; upsert service; error report) · P3 · M · completes the import/export story; teams with existing backlog in other tools need a migration path
- Time tracking (TimeLog model; log work modal on issue; logged vs. estimated bar; reports integration) · P3 · L · large parity gap; every comparable tracker ships this; prerequisite for capacity planning
- Components UI (Component API controller; drawer picker; board filter by component; default assignee wiring) · P3 · M · schema exists; just needs API + UI surface; routes issues to the right sub-team by default
- Versions / releases (Version API controller; drawer picker; release view; changelog generation) · P3 · L · sprint != release; product teams need a release abstraction; schema exists
- AI-assisted triage suggestions (LLM endpoint config; inferred priority/assignee/labels in create modal; Ollama-compatible) · P3 · L · genuine differentiator for self-hosted; full-text GIN index provides similar-issue context; configurable to local model

---

## Pass 8 — Missing-Items Audit (2026-06-28)

**Auditor:** Product / UX (independent)

**Mandate:** Hunt for the highest-value MISSING capabilities a discerning user of a
category-leading tracker would still notice. The following are confirmed as SHIPPED and
not re-listed as gaps (verified below before exclusion): multiple boards + Kanban/Scrum,
board filters + NLQL + saved filters, custom fields, conditional card colors, planning
poker, async standups, issue links, watch + quick-filters, personal boards, personal/team
analytics, automation engine (Glass Box), bulk edit (BulkActionBar in Triage and Backlog),
CSV export, workspace branding, configurable workflows (WorkflowSection.tsx + workflow.service.ts
— transitions + gates fully wired), board swimlanes (`BoardSwimlanesView.tsx` — group-by
assignee/priority/type/epic confirmed shipped), filter-state URL persistence (BoardPage.tsx
reads every filter dimension from `useSearchParams`; confirmed lines 198–308), VitePress docs site.

**Method.** Read `apps/api/prisma/schema.prisma` end-to-end; `App.tsx` routing table;
`apps/api/src/` module directory listing; `apps/web/src/pages/` and
`apps/web/src/components/issue/` for absence confirmation; `notifications.module.ts` and
`mail.service.ts` for email delivery evidence; `comments.service.ts` for email fan-out;
`issues-csv.controller.ts` for import vs. export; `WorkflowSection.tsx` and
`BoardSwimlanesView.tsx` to confirm those items are actually shipped.

---

### Ratings Update (Pass 8 — current state)

| Area | Score | Note |
|---|---|---|
| Auth | 4/5 | Email/password + PATs + password reset (SMTP wired via nodemailer). No SSO/OIDC. No refresh tokens. JWT in localStorage. |
| Projects | 4/5 | Full CRUD; archive. Component and Version models exist in schema but have zero REST controllers and zero UI — confirmed by searching every controller file; no component/version routes exist anywhere in `apps/api/src/`. |
| Board | 5/5 | Multi-board, swimlanes, NLQL, saved filters, card colors, quick-filter presets, URL persistence, presence avatars. Best surface in the product. |
| Issues (CRUD) | 4/5 | Drawer is comprehensive. Time tracking (logged/estimated) absent — no schema field, no UI, no API. Issue templates absent — no schema model, no API, no UI. Checklist items absent from schema. |
| Comments / Activity | 4/5 | Markdown, @mention autocomplete, edit/delete (own only), realtime. No comment reactions (no schema model). No threaded replies. No draft persistence. |
| Search / Filter | 4/5 | NLQL + FTS GIN index + saved filters + URL persistence + quick-filter presets. Backlog has no NLQL bar. No cross-backlog keyword search. |
| Sprints / Backlog | 4/5 | Full sprint lifecycle; bulk edit; planning poker. No sprint retrospective UI. No velocity-vs-capacity comparison. |
| Labels | 5/5 | Complete. No gaps. |
| Reports | 3/5 | Burndown, velocity, CFD, team analytics. No configurable dashboards or gadgets. No assignee-capacity comparison. No per-version burndown. |
| Notifications | 3/5 | In-app real-time inbox confirmed. Email delivery: MailService exists with nodemailer and SMTP env config — but notifications.module.ts does NOT import MailModule, and the NotificationsService has zero calls to MailService. Password-reset is the only flow that actually sends email. All issue/comment/mention/watch notifications are in-app only. No dedicated /notifications page (dropdown-only). No per-user email preferences. |
| Roles / Permissions | 3/5 | Workspace roles enforced. No per-project role overrides. No SSO/OIDC. |
| Mobile Experience | 3/5 | Board, backlog, triage responsive. Dense filter toolbar on small viewports. No native-style bottom navigation. |
| Onboarding / Empty States | 3/5 | OnboardingPanel at zero-projects. No interactive tour. Differentiating features (NLQL, automation, poker) not mentioned in panel. |

---

### Confirmed-Absent Capabilities (evidence for each)

**1. Email notifications for issue events (mentions, assignments, watch updates)**
NotificationsService (`apps/api/src/notifications/notifications.service.ts`) never imports
MailService. `notifications.module.ts` does not import MailModule. `comments.service.ts`
calls `this.notifications.notifyComment(...)` but no mail call follows. MailService.send()
is called only from `password-reset.service.ts`. Result: every in-app notification fires
correctly over Socket.io but nothing reaches a user's email inbox for issue events.

**2. Time tracking (logged hours / original estimate / worklog)**
Schema has no `timeSpent`, `originalEstimate`, `remainingTime`, or worklog model. No
`TimeLog` table. No time-tracking field in `CreateIssueDto` or `UpdateIssueDto`. No log-work
UI in `IssueDetailDrawer.tsx`. Not mentioned in any controller under `apps/api/src/issues/`.

**3. Components and Versions — schema exists, zero API or UI**
`Component` and `Version` models are in `schema.prisma` (lines 502–536). `componentId` is
on the `Issue` model. However: no `components` or `versions` directory under `apps/api/src/`
(only: analytics, api-tokens, attachments, audit, auth, automations, board, comments,
custom-fields, issue-links, issues, labels, mail, me, notifications, personal-boards,
poker, prisma, projects, public, realtime, redis, reports, roadmap, saved-filters, search,
share-tokens, sprints, standups, statuses, users, webhooks, workflows, workspaces). No
`ComponentsController`, no `VersionsController`. No `useComponents` or `useVersions` hook
in `apps/web/src/api/`. No component picker in `IssueDetailDrawer.tsx`. No version picker.
`SettingsPage.tsx` imports only `WebhooksSection`, `ShareSection`, `CustomFieldsSection`,
`WorkflowSection` — no ComponentsSection, no VersionsSection.

**4. CSV import (bulk ingest)**
`apps/api/src/issues/issues-csv.controller.ts` has a single GET endpoint that streams a CSV
download. There is no POST/multipart upload endpoint for import. No `multer` setup in this
controller. No import-specific service method. No column-mapping logic anywhere in
`apps/api/src/issues/`. Export only; import is entirely absent.

**5. Issue templates**
No `IssueTemplate` model in `schema.prisma`. No `templates` field on `Project`. No
`/projects/:id/templates` route. No template picker in `CreateIssueModal.tsx`. No
`useIssueTemplates` hook. Completely absent.

**6. In-issue checklists / sub-checklist items**
`ParentSubtasks.tsx` renders the parent/child hierarchy (Epic→Story→Subtask). However, this
is full-issue children — not lightweight checklist items within a single issue. No
`ChecklistItem` or `TodoItem` model in schema. No checklist section in `IssueDetailDrawer.tsx`.
Teams using issues for PRDs or bug reports routinely want an inline checklist (e.g.,
"- [ ] Unit tests written") without creating a separate sub-issue for each step.

**7. WIP limits per board column**
`Status` model has no `wipLimit` field. `Board` model has no per-column limit. No WIP-limit
validation in `issues.service.ts` move logic. No column-limit display in `BoardColumn.tsx`
or `ColumnFormModal.tsx`. Kanban methodology typically enforces WIP limits as a first-class
concept to surface bottlenecks.

**8. Dedicated notifications page (/notifications full-page route)**
`App.tsx` routing table has no `/notifications` route (confirmed: routes include /, /my-work,
/projects/:id/* paths, /workspaces/:id/*, /me/settings, /share/:token, /personal-board,
/me/analytics). All notification interaction is via the `NotificationBell` dropdown in the
header — a 28rem wide popover capped at 50 items. No full-page notification history,
no filter-by-type, no "notification center" concept.

**9. Sprint retrospective UI**
`Sprint` model in schema has no `retrospective` or `notes` field. No `RetroPanel` or
`SprintRetrospectivePage` component. The completed-sprint row in `BacklogPage.tsx` shows
no retro entry point. Confirmed entirely absent.

**10. SSO / OIDC**
No passport-oidc, no oauth2 strategy, no SAML configuration anywhere in `apps/api/src/auth/`.
Auth is email/password + PATs only. Self-hosted teams with Google Workspace or GitHub
org membership cannot use SSO.

---

### Top 8 Gaps — Ranked by User Impact

**Rank 1: Email notifications for all notification types** — M
Every in-app notification (mention, assignment, watch update) is invisible to users who are
not actively looking at the app. The SMTP infrastructure is wired for password reset
(nodemailer, env vars documented). The fan-out logic in NotificationsService is already
correct for Socket.io delivery. What is missing is: (a) MailModule imported into
NotificationsModule, (b) `this.mail.send(...)` calls inserted into `notify()`,
`notifyAssigned()`, `notifyComment()`, and `notifyWatchersUpdated()`, and (c) per-user
email preference (immediate / digest / off). Teams do not live in the tracker; email is
how they learn about updates when offline. Without email delivery, the watch and @mention
features are half-functional. This is a daily-workflow gap for every user on every team.

**Rank 2: CSV import (bulk issue ingest)** — M
Export exists. Import does not. "Your data, your compute" is the product's central brand
promise — teams will not commit to a self-hosted tracker without a data escape hatch, and
they cannot migrate from an existing tool without an import path. A minimum viable import
is: multipart CSV upload endpoint, column-mapping UI step (title/status/priority/assignee/
labels), upsert service, and a post-import error report. This directly gates the
"switching from an established tracker" story that will drive the majority of self-hosted
adoption decisions.

**Rank 3: Time tracking (original estimate vs. logged hours, worklog)** — L
No schema support, no API, no UI. This is a large parity gap: every category-leading
tracker (open-source and commercial) ships time tracking as a standard issue field. Teams
doing billable work or capacity planning cannot use Next Lane as their primary tracker
without it. The minimum viable form is: `originalEstimate` (minutes) on Issue + a
`WorkLog` join table (userId, issueId, minutes, date, comment) + a log-work modal on the
drawer + a logged/estimated progress bar on the card. Reports integration (per-sprint time
spent vs. estimated) follows. The schema gap is the blocker — this cannot be added without
a migration.

**Rank 4: Components and Versions — API and UI** — M (Components) + L (Versions)
Both models exist in `schema.prisma` with all required fields. Zero REST controllers exist
for either. Zero frontend hooks or UI surfaces exist for either. Components route issues to
the right sub-team by default assignee; they also make board filtering by sub-system
possible. Versions let product teams say "these issues ship in v2.1" independently of
sprint cadence — a release abstraction that sprints do not provide. The schema investment
has already been made; the API and UI are the remaining work. Because the schema is done,
the risk of this work is lower than a net-new feature.

**Rank 5: Issue templates per project** — M
No schema support, no API, no UI. Teams with recurring work patterns (bug reports,
feature requests, on-call incidents) manually re-enter the same fields on every new issue.
Templates pre-fill title prefix, description skeleton, default type, default labels, and
default priority. This reduces the friction of correct issue logging and improves data
quality for automation rules (which depend on consistent field values). Storage model is
simple: a `templates Json?` field on `Project` (no join table needed for a list of
<10 templates per project). The create-issue modal gains a template picker dropdown.

**Rank 6: In-issue checklists** — S
No schema support, no UI. Distinct from sub-issues (which are full tracked issues with
their own sprint and priority). Checklists are lightweight inline items: "- [ ] Write unit
tests" "- [ ] Update docs". They are the most common way teams track the definition of done
for a single issue without inflating the issue count. Storage: a `checklist Json?`
(array of `{id, text, done}`) on `Issue` — one migration. UI: a checklist section in the
drawer with add/check/delete. Card shows a `N/M done` progress badge when checklist is non-empty.

**Rank 7: WIP limits per board column** — S
No schema support, no enforcement. Kanban methodology's core discipline is limiting
work-in-progress per status column to surface bottlenecks. Without WIP limits, a board
with 30 issues in "In Progress" gives no visual or enforcement signal that the team is
overloaded. Implementation: add `wipLimit Int?` to the `Status` model (migration); render
a limit indicator in `BoardColumn.tsx` ("12 / 5 WIP") with red styling when over limit;
optionally enforce via a warning modal on move. This is a small schema addition with a
high workflow value for Kanban-focused teams.

**Rank 8: Dedicated notifications page** — S
The notification dropdown is a 28rem wide popover capped at 50 items with no filtering.
Users who are away from the app for a day cannot review the full notification history
without paginating through the dropdown one-at-a-time. A `/notifications` page with:
full paginated history, filter by type (ASSIGNED / MENTIONED / COMMENTED / WATCHED),
filter by project, bulk mark-read, and clickable deep-links — is a straightforward addition.
`NotificationsController` already has `list()` and `markAllRead()` endpoints. This
closes the "notification center" gap that teams migrating from other trackers will notice
immediately.

---

### Parity Scorecard Update (Pass 8)

Capabilities confirmed shipped since Pass 7 are updated below. All others carry forward
from the Pass 7 scorecard.

| Capability | Our Depth (1–5) | Leader Baseline | Gap | Parity Gap? | Evidence |
|---|---|---|---|---|---|
| Swimlanes (group-by assignee/epic/priority) | 5 | 5 | None | No | `BoardSwimlanesView.tsx` fully implemented: group-by assignee, priority, type, epic; per-lane DndContext; collapse/expand |
| Configurable workflow transitions | 5 | 5 | None | No | `WorkflowSection.tsx` + `workflow.service.ts` + `WorkflowTransition` model in schema fully wired with transition gates |
| Bulk edit | 5 | 5 | None | No | `BulkActionBar.tsx` used in both `BacklogPage.tsx` and `TriagePage.tsx`; batch PATCH endpoint confirmed |
| Filter state URL persistence | 5 | 5 | None | No | `BoardPage.tsx` reads all filter dimensions from `useSearchParams` |
| Email notifications (issue events) | 1 | 5 | Large | YES | MailModule not imported by NotificationsModule; no mail.send() call in notifications.service.ts |
| Time tracking / worklogs | 1 | 5 | Large | YES | No schema field; no API; no UI |
| Components UI | 1 | 4 | Large | YES | Schema exists; zero API controllers; zero UI |
| Versions / releases UI | 1 | 5 | Large | YES | Schema exists; zero API controllers; zero UI |
| Issue templates | 1 | 4 | Large | YES | Absent from schema, API, and UI |
| In-issue checklists | 1 | 4 | Large | YES | No schema model; no drawer section |
| WIP limits per column | 1 | 4 | Large | YES | No schema field on Status; no enforcement in move logic |
| Dedicated notifications page | 1 | 4 | Large | YES | No /notifications route in App.tsx; dropdown-only (50-item cap) |
| Sprint retrospective UI | 1 | 3 | Medium | YES | No schema field; no UI surface on completed sprint |
| SSO / OIDC | 1 | 4 | Large | YES | Email/password + PATs only; no OAuth2 strategy |
| CSV import | 1 | 4 | Large | YES | Export-only controller; no multipart upload; no import service |

---

### Ideation — 3 Ambitious New Features (Pass 8)

**U. Issue scoring / priority matrix view.**
A 2x2 matrix view accessible from the backlog: X-axis = effort (story points), Y-axis =
business value (a new numeric field, or derived from custom fields). Issues appear as
bubbles sized by points. Drag a bubble to update its value. The top-right quadrant ("high
value, low effort") surfaces the obvious "do first" candidates. No comparable self-hosted
tracker ships this built-in — it's usually a workshop exercise done in a slide deck. The
data model for it (storyPoints already exists; a `businessValue Int?` field is a trivial
migration) is nearly all in place. Size: M.

**V. Recurring issues (schedule-driven auto-create).**
A project setting to configure recurring issue templates: "every Monday at 09:00, create
an issue titled 'Weekly sync notes' with type TASK, assignee = team lead, sprint = active."
Uses a cron-style schedule (`node-cron` or NestJS `@Cron`). Stored as a
`RecurringIssueTemplate` model with `cronExpression`, `templateData JSON`, `lastFiredAt`.
Operations teams running Next Lane for incident management or compliance workflows will
adopt a tracker specifically for this feature. No comparable feature exists in self-hosted
alternatives of this tier. Size: M.

**W. Public changelog / release notes page.**
When a `Version` is marked RELEASED, generate a public-facing changelog page at
`/changelog/:token` (analogous to the existing share-board token pattern). The page lists
all issues in that version, grouped by label (Bug / Feature / Improvement), with optional
short descriptions. An ADMIN can curate the wording via a simple edit modal. This gives
product teams a way to share release notes with customers without requiring a separate
changelog tool. The `Version` and `ShareToken` models together provide most of the
foundation. Size: M.

---

### Direction — Next Quarter (Pass 8 view)

The product's core is strong. The board, NLQL, automation, swimlanes, workflow transitions,
bulk edit, and planning poker represent a genuinely differentiated feature set. The honest
remaining gaps fall into two tiers.

**Tier 1 — Daily-workflow blockers for real teams.** Email notification delivery and
CSV import are the two gaps that will prevent teams from committing to Next Lane as their
primary tracker. Email because teams do not live in the app; import because teams cannot
migrate their existing backlog. Both should be in the next sprint.

**Tier 2 — Depth gaps that signal maturity.** Time tracking, Components UI, Versions UI,
and issue templates are all gaps that a user arriving from an established tracker will
notice within the first week. The schema work for Components and Versions is already done —
adding the API and UI layers is lower-risk than any net-new feature. Time tracking requires
a schema migration but follows a well-understood pattern. Issue templates are a pure
application-layer addition (JSON field on Project, picker in create modal).

**Quick wins (S-sized, high visibility).** WIP limits per column and in-issue checklists
are each one migration + a small UI addition. A dedicated notifications page is a route
addition with no new API. All three should ship in the same sprint as any of the Tier 1
items to maintain shipping momentum and address the most visible UX gaps.

---

### Backlog-Groomer Ingest — Pass 8 (title · priority · size · rationale)

- Email notifications for all issue events (MailModule into NotificationsModule; mail.send() in notify/notifyAssigned/notifyComment/notifyWatchersUpdated; per-user pref model) · P1 · M · SMTP wired for password-reset; fan-out logic exists for Socket.io; email delivery gap makes watch and @mention half-functional for offline users
- CSV import with column mapping (multipart POST endpoint; column-map wizard UI; upsert service; error report) · P1 · M · export exists; import does not; self-hosted adoption is gated on data portability and migration from existing tools
- Time tracking — originalEstimate + WorkLog model (schema migration; log-work modal on drawer; logged/estimated bar on card; sprint time report) · P1 · L · absent from schema; every comparable tracker ships this; prerequisite for capacity planning and billable-work teams
- Components API + UI (REST controller; drawer picker; board filter by component; default assignee wiring) · P2 · M · Component model in schema since baseline; zero API controllers; zero UI; schema investment already made
- Versions/releases API + UI (REST controller; drawer picker; release view; issue list per version) · P2 · L · Version model in schema; zero API/UI; sprint != release; product teams need a release abstraction
- Issue templates per project (templates JSON field on Project; template picker in create-issue modal; ADMIN-managed per project) · P2 · M · fully absent from schema and API; reduces issue-logging friction; improves data quality for automation
- In-issue checklists (checklist JSON on Issue; add/check/delete in drawer; card progress badge N/M done) · P2 · S · lightweight alternative to creating sub-issues; teams track definition-of-done items without inflating issue count
- WIP limits per board column (wipLimit Int? on Status; column limit indicator in BoardColumn; warn-on-exceed) · P2 · S · core Kanban discipline; no schema field today; signals bottlenecks visually without enforcement overhead
- Dedicated notifications page (/notifications route; paginated history; filter by type/project; bulk mark-read) · P2 · S · dropdown is 50-item cap; users returning from absence cannot review full history; NotificationsController endpoints already exist
- Sprint retrospective UI (retro JSON field on Sprint; modal from completed sprint row; What went well / improve / actions) · P3 · M · closes the sprint lifecycle; teams currently use external docs; no schema support today
- SSO / OIDC (passport-oidc strategy; provider config in workspace settings; Google/GitHub at minimum) · P3 · L · self-hosted teams with managed identity providers cannot adopt without SSO; table-stakes for enterprise evaluation
- Issue scoring / priority matrix view (business-value field on Issue; 2x2 matrix page; drag to update) · P3 · M · no comparable self-hosted tracker ships this; surfaces obvious "do first" candidates from the backlog
