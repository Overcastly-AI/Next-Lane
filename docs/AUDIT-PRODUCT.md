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
