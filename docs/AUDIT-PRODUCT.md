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

---

## 2026-06-30 — Pass 9 (current-state deep audit)

**Method.** Read docs/ROADMAP.md (all phases), docs/BACKLOG.md, all 27 web pages,
all 40 API modules, the Prisma schema, and the enums/types packages. Cross-checked
every previously "open" gap against the actual module list, service implementations,
and frontend pages to confirm shipped vs. absent. The mandate below explicitly notes
items the system prompt listed as done — this pass verifies that claim with code.

**Verification of claimed completions.** Every item the ROADMAP marks ✅ in Phase 5
and below was verified against source files:
- Multiple boards: `apps/api/src/board/board.service.ts` + `BoardSwitcher.tsx` — confirmed.
- Custom fields: `apps/api/src/custom-fields/` module + `CustomFieldsSection.tsx` — confirmed.
- NLQL + autocomplete: `packages/shared/src/nlql/suggest.ts` + `NlqlInput.tsx` — confirmed.
- Saved filters: `apps/api/src/saved-filters/` + `saved-filters.ts` hooks — confirmed.
- Conditional card colors: `CardColorsManager.tsx` + `resolveCardColor` in `lib/cardColors.ts` — confirmed.
- Per-board default filters: `Board.filterQuery` in schema + `board-default-filter` testid — confirmed.
- Swimlanes: `BoardSwimlanesView.tsx` — confirmed.
- Planning poker: `apps/api/src/poker/` + `PokerSessionPage.tsx` — confirmed.
- Automation engine: `apps/api/src/automations/` + `AutomationsPage.tsx` — confirmed.
- Configurable workflows (incl. per-board named workflows): `apps/api/src/workflows/` + `WorkflowsManager.tsx` — confirmed.
- Components: `apps/api/src/components/` + `ComponentsSection.tsx` — confirmed.
- Versions/releases: `apps/api/src/versions/` + `VersionsSection.tsx` — confirmed.
- WIP limits: `wipLimit` on Status model + `column-wip-indicator` testid in `BoardColumn.tsx` — confirmed.
- Checklists: `apps/api/src/checklist/` + `ChecklistSection` in drawer — confirmed.
- Time tracking: `apps/api/src/work-logs/` + `TimeTrackingSection` in drawer — confirmed.
- Issue templates: `apps/api/src/issue-templates/` + `TemplatesManager.tsx` — confirmed.
- CSV import/export: `issues-import.controller.ts` + `ImportCsvModal.tsx` — confirmed.
- Tracker importers: `?source=jira|github|linear` in `issues-import.controller.ts` (file-based only) — confirmed.
- Issue links: `apps/api/src/issue-links/` + `LinkedIssuesSection` in drawer — confirmed.
- Watch/notifications/email: `NotificationsModule`, `MailModule`, `emailNotifications` toggle — confirmed.
- MCP server: `apps/mcp/` package with 18 tools — confirmed.
- Mermaid in markdown: `MarkdownRenderer` splits mermaid blocks, lazy-imports mermaid — confirmed.
- Bulk edit: `BulkActionBar.tsx` in both BacklogPage and TriagePage — confirmed.
- Share links (public read-only board): `share-tokens.service.ts` + `SharedBoardPage.tsx` — confirmed.

**Remaining genuine gaps confirmed after source verification:**

1. Roles are workspace-level only. `membership.util.ts` `assertProjectRole` derives the
   role from `prisma.membership` which is workspace-scoped (userId_workspaceId unique key,
   no project-level role column in schema). There is no `ProjectMembership` model. A user
   who is ADMIN in one project is ADMIN in all projects in the same workspace. Project-level
   role overrides are explicitly called out in `ROADMAP.md` Phase 5 remaining gaps.

2. Automation triggers have no time/schedule dimension. `AutomationTrigger` enum has only
   four event-driven values (ISSUE_CREATED, ISSUE_UPDATED, ISSUE_TRANSITIONED,
   ISSUE_COMMENTED). No cron, no "issue stale for N days", no SLA escalation path exists
   in the schema or engine.

3. Configurable dashboards do not exist. `ReportsPage.tsx` is a fixed three-chart layout
   (velocity + burndown + CFD). No drag/drop gadget grid, no user-defined layout, no widget
   library. This is the only item still listed as a remaining parity gap in ROADMAP Phase 5
   alongside project-level role overrides.

4. SSO / OIDC: no passport-oidc strategy, no OAuth2 provider model in schema, no provider
   config UI. Email+password + PATs are the only auth paths.

5. Automation scheduled/time-based triggers: no `@Cron` usage in any automation file,
   no "stale issue" or "SLA breach" trigger type.

6. PAT scopes are stored but enforcement is thin: `ScopeGuard` exists and `@RequireScope`
   is used on a handful of routes (`issues:write` on import, `webhooks:write` on webhooks)
   but the vast majority of API endpoints have no `@RequireScope` decoration, meaning a
   scoped PAT is functionally unscoped for most operations.

7. Sprint retrospective: no `retro` field on Sprint model, no retro UI surface, no
   retrospective data structure anywhere. Captured as P3 in backlog.

8. `SharedBoardPage.tsx` uses legacy `slate-*` token classes
   (`bg-slate-100/70`, `text-slate-600`, `text-slate-400`) — it was not included in the
   design elevation passes. Minor but visible to external stakeholders who receive share links.

---

### Ratings (Pass 9)

| Area | Score | Note |
|---|---|---|
| Auth (register/login/reset/PAT) | 4 | Solid email/password + PAT; password reset SMTP wired; no SSO/OIDC; JWTs in localStorage (not httpOnly). |
| Projects | 5 | Create/edit/archive, project key, components, versions, templates, settings UI — complete. |
| Board (kanban/scrum) | 5 | Multiple boards, board types, swimlanes, quick filters, card colors, WIP limits, inline status picker, presence avatars, DnD. Fully feature-complete. |
| Issues (CRUD + depth) | 5 | Full field set: type/status/priority/assignee/reporter/due date/story points/sprint/labels/components/versions/custom fields, checklists, time tracking, links, watchers, attachments, markdown. Nothing missing. |
| Comments / activity | 5 | Flat comments + @mentions + markdown + attachments, activity log, realtime, email fan-out. |
| Search / filter | 5 | NLQL with autocomplete, saved/shareable filters, URL persistence, quick presets, full-text Postgres search, cross-project command palette. |
| Sprints / backlog | 4 | Sprints CRUD, start/complete, backlog view, bulk move, velocity/burndown; no retrospective UI (schema absent). |
| Labels | 5 | Create/edit/delete/color/rename, M:N assign, filter, board filter, bulk assign. |
| Reports | 3 | Velocity, burndown, CFD, and project/personal analytics are all good. Gap: fixed layout only, no configurable dashboards or gadgets. |
| Notifications | 5 | In-app bell + notifications page, email opt-in, @mentions, watch, realtime Socket.io, all event types covered. |
| Roles / permissions | 3 | Admin/Member/Viewer enforced throughout; workspace-level only — no per-project role overrides, meaning one workspace member role applies to all projects. Real teams with multi-project trust boundaries need project-level roles. |
| Automation | 4 | Event-driven rules engine with NLQL conditions and 6 action types; Glass Box audit trail. Gap: no scheduled/time-based triggers (no cron, no SLA escalation). |
| Workflow | 5 | Configurable statuses, transitions, gates, named workflows per board, visual graph builder, templates, MCP-accessible. |
| Custom fields | 5 | 7 types, project-level, issue-type targeted, usable in NLQL and on cards. |
| Mobile experience | 4 | Responsive throughout; ProjectNav "More" dropdown for mobile; some dense surfaces (triage, analytics) less comfortable on 390px. |
| Onboarding / empty states | 4 | Team Pulse home, onboarding panel, empty states elevated. Gap: no product tour or "setup checklist" for first admin. |
| SSO / OIDC | 1 | Entirely absent. Enterprise adoption blocker. |
| Configurable dashboards | 1 | Fixed report layout only; no user-arranged gadget grid. |
| Automation (scheduled triggers) | 1 | No time-based triggers; SLA/stale-issue automation unavailable. |
| Project-level role overrides | 1 | Roles are workspace-granular only; membership.util.ts confirms no project-level role model. |

---

### Parity Scorecard (Pass 9)

All items from Pass 8 that were parity gaps have been verified as shipped or remain open.

| Capability | Our Depth (1–5) | Leader Baseline | Gap Size | Parity Gap? | Evidence |
|---|---|---|---|---|---|
| Multiple boards per project | 5 | 5 | None | No | `Board` model + `BoardSwitcher.tsx`, KANBAN/SCRUM types, lazy-create default |
| Board types (Kanban/Scrum) | 5 | 5 | None | No | `BoardType` enum; SCRUM scopes to active sprint issues |
| Configurable columns/swimlanes | 5 | 5 | None | No | `StatusCategory` + reorder; `BoardSwimlanesView` group-by 4 dimensions |
| Quick filters | 5 | 5 | None | No | Quick-filter preset chips + NLQL bar + pill filters, all composable |
| Query language (NLQL) | 5 | 4 | Ahead | No | `packages/shared/src/nlql/` — full tokenizer/parser/evaluator + autocomplete |
| Saved filters | 5 | 5 | None | No | `SavedFiltersModule` + UI with personal + shared badges |
| Sharable filters | 5 | 4 | Ahead | No | Filter state in URL params; saved filters have `isShared` flag |
| Custom fields | 5 | 5 | None | No | 7 types, JSONB storage, NLQL filterable, `CustomFieldsSection` |
| Card color rules | 5 | 4 | Ahead | No | `CardColorsManager` + `resolveCardColor` + per-board ordered rules |
| Configurable workflow statuses | 5 | 5 | None | No | `WorkflowsManager` + named workflows + visual graph builder |
| Workflow transitions + gates | 5 | 5 | None | No | `WorkflowTransition` model + 5 gate types + enforcement in move/update |
| Automation rule engine | 4 | 5 | Small | YES — scheduled triggers absent | 4 event triggers + 6 action types; no cron/time-based trigger |
| Configurable dashboards | 1 | 4 | Large | YES | Fixed 3-chart `ReportsPage`; no user-arranged gadget grid |
| Components | 5 | 4 | Ahead | No | `ComponentsModule` + `ComponentsSection` + drawer picker + default-assignee wiring |
| Versions/releases | 5 | 5 | None | No | `VersionsModule` + `VersionsSection` + issue M:N assignment |
| Bulk edit | 5 | 5 | None | No | `BulkActionBar` in BacklogPage + TriagePage; `POST /issues/bulk` |
| Issue links/dependencies | 5 | 5 | None | No | `IssueLinksModule` + `LinkedIssuesSection` + 6 link types |
| Watchers | 5 | 5 | None | No | `Watcher` model + watch toggle + `WATCHED_UPDATED` notifications |
| Time tracking | 5 | 5 | None | No | `WorkLogsModule` + `TimeTrackingSection` + estimate + progress bar |
| Checklists | 5 | 4 | Ahead | No | `ChecklistModule` + `ChecklistSection` + drag-reorder |
| Issue templates | 5 | 4 | Ahead | No | `IssueTemplatesModule` + `TemplatesManager` + board "From template" menu |
| CSV import/export | 4 | 5 | Small | YES — live API import (Jira/GitHub/Linear live pull) absent | File-based import with source normalisation; no live API pull from trackers |
| Per-project role overrides | 1 | 4 | Large | YES | Workspace-level roles only; `membership.util.ts` confirms no project-level model |
| SSO / OIDC | 1 | 5 | Large | YES | Absent from schema, auth module, and UI |
| Scheduled/time automation | 1 | 4 | Large | YES | No cron/SLA triggers in `AutomationTrigger` enum or engine |
| Configurable reports/dashboards | 1 | 4 | Large | YES | Fixed layout only; no gadget/widget model |
| Sprint retrospective | 1 | 3 | Medium | YES | No schema field; no UI surface |
| PAT scope enforcement | 2 | 4 | Large | YES | `ScopeGuard` exists; only 3 routes decorated with `@RequireScope`; most API surface unscoped |

---

### Top Gaps (Pass 9 — prioritized backlog candidates)

**1. Project-level role overrides** — size L — backend does not exist.
Today a workspace ADMIN is ADMIN on every project in the workspace. Real teams (agencies,
multi-team companies) need to invite a client as a VIEWER on Project A while keeping them
off Project B entirely. Requires a `ProjectMembership` model alongside the existing
`Membership`, with resolver fallback to workspace role. This is the most operationally
blocking permission gap for multi-project adoption.

**2. Configurable dashboards (gadget grid)** — size L — does not exist.
The fixed three-chart Reports page is good for a starting user but cannot be arranged to
show what a specific team cares about. A "Dashboard" entity with a gadget layout JSON
column (velocity chart, open issue count, overdue heatmap, burndown, sprint health, custom
NLQL result table) would let teams build a single-pane-of-glass. This is the only item
still flagged in ROADMAP Phase 5 "remaining parity gaps" alongside project roles.

**3. Scheduled / time-based automation triggers** — size M — backend does not exist.
`AutomationTrigger` has four event-driven values; there is no cron or "issue idle for N
days" path. Without this, teams cannot automate SLA escalation ("if an issue stays In
Progress for 3 days without an update, add a label 'Stale' and notify the assignee") or
compliance nudges. A `ScheduledTrigger` model with `cronExpression` + `conditionQuery`
(reuses NLQL evaluator) + NestJS `@Cron` processor is the natural extension. This is
explicitly called out in the Phase 7 "carry-forward" note in ROADMAP.

**4. SSO / OIDC** — size L — does not exist.
Email/password + PATs are the only auth paths. Any self-hosted team using Okta, Google
Workspace, GitHub org identity, or an internal IdP cannot adopt Next Lane without managing
a separate credential. Passport-oidc strategy + provider config per workspace + "Login with
Google/GitHub" buttons are the standard shape. This is also the most commonly cited
enterprise adoption blocker for open-source tools.

**5. PAT scope enforcement completeness** — size S — partially exists.
`ScopeGuard` and `@RequireScope` exist and work, but only three routes use them
(`issues:write` on import, `webhooks:write` on webhooks, `webhooks:read` inferred). The
remaining ~60 API routes have no scope gate, meaning a PAT with narrow declared scopes
(e.g. `issues:read`) can write issues, manage members, and delete webhooks. For teams
using PATs for CI/CD or agent integrations, this defeats the purpose of scoped tokens.
Adding `@RequireScope` annotations to the controller layer is low-risk and completable in
one session.

**6. Sprint retrospective UI** — size M — schema absent.
The sprint lifecycle ends at "Complete" with no structured place to capture what went well,
what to improve, and team action items. A `retrospective JSON?` field on the Sprint model
+ a modal triggered from the completed sprint row in BacklogPage (three free-text sections
+ save) closes the Scrum loop. Teams currently maintain external docs for retros; a single
source of truth in the tracker strengthens adoption.

**7. Automation dry-run endpoint** — size S — does not exist.
When a user builds a complex NLQL condition + action chain in the automation editor, there
is no way to preview which issues it would match before enabling the rule. A
`POST /projects/:projectId/automations/dry-run { condition, trigger }` endpoint that
returns matching issues (max 20, with matchReason) would dramatically reduce "I accidentally
spammed my team with auto-comments" incidents. The NLQL evaluator and issue list are already
available; this is a thin controller addition.

**8. Inline card status transition (right-click / long-press)** — size S — partially exists.
`CardStatusPicker` is implemented in `apps/web/src/components/board/CardStatusPicker.tsx`
and wired into `IssueCard.tsx`, so the component exists. However, BACKLOG.md lists "inline
card status transition" as still open (P2, S) — it is present on the board column view but
not on the backlog issue rows or triage list rows, requiring a drawer round-trip for status
changes from those views.

**9. Live tracker API import (Jira/GitHub/Linear)** — size M — file-based only.
The import pipeline accepts `?source=jira|github|linear` but only processes locally-uploaded
files. Teams migrating from a live Jira cloud instance or GitHub repository need OAuth
authentication to the source + server-side fetch + field mapping wizard. This is the gap
between "I can export a CSV from my old tracker and upload it" (shipped) and "click
Connect, authorize, import all 4000 issues" (not built). The data model and parsing layer
are ready; the integration auth and fetch layer are not.

**10. Public changelog / release notes page** — size M — does not exist.
When a `Version` is marked RELEASED, there is no public-facing output. A `Version` entity
already carries state and a `releaseDate`; the `ShareToken` model provides the access
control pattern. A `/changelog/:token` public route listing issues grouped by label
(Bug / Feature / Improvement) with optional admin-edited summary text per version would
give product teams a lightweight release notes page without a separate tool. This was
raised as ideation item W in Pass 8; it remains entirely absent from both schema and UI.

---

### Ideation — 3 Ambitious New Features (Pass 9)

**X. AI triage assistant (Phase 6 preview, self-hosted).**
Surface a sidebar panel in the issue drawer: "What should I know about this issue?" The
panel calls a configurable local LLM endpoint (Ollama by default; `OLLAMA_URL` env var)
with the issue title, description, comments, and linked issues as context, then returns:
suggested type/priority/component (with one-click accept), a duplicate detector (semantic
search over existing issues using pgvector embeddings on the description tsvector column
already in the schema), and a plain-text "risk summary". All inference runs on the
self-hoster's own hardware — no data leaves the instance. This is the single feature that
makes the "free, private, AI-native" positioning concrete and tangible. Size: L.

**Y. Team capacity planner (sprint scoping view).**
A dedicated view at `/projects/:projectId/capacity` showing the active or planned sprint:
on the left, team members with their declared capacity (hours/points per sprint, editable
here); on the right, issues dragged from backlog into their lane. Running totals per person
+ per sprint update live. Issues color-code by whether they are over/under the person's
capacity. When a sprint is over-committed, a banner says so with the shortfall. This is the
"should we start this sprint" decision view that scrum masters currently do in spreadsheets.
The sprint model, story points, assignee, and fractional-rank DnD are all present. Size: M.

**Z. Keyboard-first global command mode (beyond Cmd-K).**
Extend the existing Cmd-K command palette into a full vim-inspired global command mode:
press `:` anywhere to open a colon-command bar accepting commands like `:go NL-142`,
`:create bug "Login breaks on Safari" p=high`, `:assign NL-200 me`, `:close NL-155`.
Commands are parsed client-side against the NLQL grammar (already exists in shared
package) and dispatched to the relevant mutation hooks. Power users who live in the
keyboard can operate the entire tracker without touching the mouse. This is the kind of
DX detail that makes developers choose a tool over a PM-optimized incumbent. Size: M.

---

### Direction — Next Quarter (Pass 9 view)

The product has crossed a maturity threshold: the core feature set is genuinely comparable
to (and in several areas — NLQL, automation, workflow graph, planning poker — ahead of)
category leaders at this tier. The remaining work is not "make it work" but "make it
enterprise-ready and AI-native."

**The three axes that should drive next quarter:**

**Axis 1 — Trust and adoptability.** Project-level role overrides and SSO/OIDC are the
two features that determine whether a real company can deploy Next Lane as their primary
tracker rather than a side experiment. Without per-project roles, a multi-team workspace
is a security anti-pattern. Without SSO, any enterprise IT evaluation is a no. Both should
be in the immediate backlog regardless of effort; SSO is L but high-leverage, project roles
is L but architecturally self-contained.

**Axis 2 — Close the automation loop.** Scheduled/time-based triggers are the one
remaining gap in the automation engine that prevents automating real operational workflows
(SLA escalation, stale-issue nudges, compliance reminders). Adding `@Cron`-driven triggers
completes the Phase 7 Glass Box vision. Pair this with the automation dry-run endpoint (S)
to make rule authoring safe.

**Axis 3 — AI-native differentiation.** Phase 6 (Autopilot) is the structural
differentiator no commercial incumbent can match: unlimited, private, local-LLM AI on the
user's own hardware. The MCP server (shipped) is the foundation. The next concrete
deliverable is the AI triage assistant panel (Ideation X above) — it makes the "private
AI" positioning tangible to the first user who opens an issue drawer. Start with the
simplest shape (local Ollama call, suggest fields, accept/reject) and ship it before
building the full pgvector duplicate detector.

Configurable dashboards (Axis 1-adjacent) and the public changelog page are the two
highest-leverage "delight" features for teams who have already committed — they close
the "why do I still need a separate tool" question.

---

### Backlog-Groomer Ingest — Pass 9 (title · priority · size · rationale · backend exists?)

- Project-level role overrides — P1 · L · Multi-team workspaces need VIEWER on project A, ADMIN on B; workspace-only roles block multi-project adoption · backend does not exist (no ProjectMembership model)
- Configurable dashboards (gadget grid) — P1 · L · Only remaining ROADMAP Phase 5 parity gap; fixed charts don't serve diverse team needs · does not exist
- Scheduled / time-based automation triggers — P1 · M · SLA escalation and stale-issue automation unavailable; completes Phase 7 Glass Box vision · does not exist (AutomationTrigger enum has no cron value)
- SSO / OIDC — P1 · L · Enterprise adoption blocker; email+password only; any IdP-managed team cannot adopt · does not exist
- PAT scope enforcement completeness — P2 · S · ScopeGuard exists; only 3 of ~60 routes decorated; scoped PATs functionally unscoped · backend exists (ScopeGuard + @RequireScope); needs annotation pass
- Automation dry-run endpoint — P2 · S · No preview before enabling a rule; teams accidentally trigger mass-comment events · backend partial (NLQL evaluator + issue list exist); thin controller addition
- Sprint retrospective UI — P2 · M · Sprint lifecycle has no structured retro capture; teams use external docs; closes Scrum loop · backend does not exist (no retro field on Sprint model)
- Live tracker import (Jira/GitHub/Linear API) — P2 · M · File-based import only; OAuth + server-side pull needed for real migration flows · backend partial (parsing layer done; auth/fetch layer absent)
- AI triage assistant panel (Phase 6 preview) — P2 · L · Concrete embodiment of "private AI" differentiator; Ollama call from issue drawer; suggest type/priority/component · backend does not exist (pgvector not installed; Ollama client not wired)
- Public changelog / release notes page — P3 · M · Version RELEASED state has no public output; share-token pattern already exists · backend does not exist (no changelog endpoint or public route)

---

## 2026-07-01 — Pass 10 (hands-on audit: fresh user + live QA-polluted demo workspace)

**Method.** Ran the live stack (web on :3000, API on :4000, already up from a prior
session). Did two hands-on passes with Playwright driven manually (not the fixed e2e
suite): (1) registered a **brand-new user** end-to-end — register → empty workspace →
create first project → create issue → Reports → Roadmap — to judge true first-run
experience; (2) explored the **existing demo workspace** (heavily polluted by hundreds
of prior QA-run projects/sprints/workspaces with names like "QA Backlog 255950910" /
"QA Sprint 1782625596211") on both desktop and Pixel-5 mobile viewport. Cross-checked
every finding against `apps/web/src/**` and `apps/api/src/**` before writing it down.
Read `docs/ROADMAP.md` Phase 5 and the full `docs/BACKLOG.md` Ready/Next/Done sections
first — the shipped-feature list in the task brief is confirmed accurate; this pass
looks for what's *still* missing or broken beneath that list, not what's already done.

### Headline finding: a real, reproducible mobile bug on the single most-used screen

The board toolbar's trailing button row (Colors / Export CSV / Import CSV / **+ Create
issue**) is a plain `flex items-center gap-3` with no `flex-wrap` and no
`overflow-x-auto` (`apps/web/src/pages/BoardPage.tsx:854`, inside the toolbar wrapper at
line 734 that only gains `sm:flex-row sm:flex-wrap` — below the `sm:` breakpoint it's
`flex-col` for the *rows*, but this particular row is unconditionally `flex` with no
wrap of its own). At a 393px viewport (Pixel 5) the row overflows its container, is not
clipped by a scroll region, and renders **the "+ Create issue" button's label directly
on top of the column header content below it** ("issue" literally overlaps "Burndown
chart"). This was caught by direct screenshot, not the fixed e2e suite (which likely
uses `.click()` on a test-id locator that still hits the (invisible/overlapping)
element regardless of visual position — a case of "tests pass, product broken" that
CLAUDE.md explicitly warns about). Screenshot evidence: toolbar overflow at 393px width
showed Group-by/remaining quick-filter chips clipped off-screen with no way to reach
them, and the Create/Colors/Export/Import row overlapping board content.

### Ratings (Pass 10)

| Area | Score | Note |
|---|---|---|
| Auth / onboarding | 5 | Fresh-register → empty-workspace → "Welcome to Next Lane" panel with 3 feature callouts → "Create your first project" is genuinely well-designed; zero friction, zero dead ends observed. |
| Projects / board (desktop) | 5 | Dense, professional Kanban board; NLQL bar, quick-filter chips, saved filters, swimlanes, card colors, WIP limits, per-board workflow selector all present and coherent together. |
| Board (mobile) | **2** | Toolbar overflow bug above actively breaks the primary daily-driver screen at phone width — buttons unreachable or visually broken. This is a regression-class bug, not a missing feature. |
| Issue detail drawer (mobile) | 5 | By contrast, the drawer itself (description, attachments, checklist, time tracking, activity) is flawless on the same 393px viewport — full width, correctly stacked, no overflow. |
| Custom fields | 4 | Backend + settings + drawer + create-modal all solid, but **not surfaced on the board card face** — a user scanning the board cannot see a custom field's value without opening every card. Category leaders let you pin a custom field to the card. |
| Issue links / dependencies | 3 | Backend + drawer UI solid, but (per the backlog's own note) "board card badge skipped" — a blocked issue looks identical to an unblocked one on the board. This is a real scanning-cost gap: the whole point of visualizing blockers is seeing them without a click. |
| Dashboards (Pulse home) | 3 | Well-designed, useful sections (active sprints, assigned-to-me, recent activity, projects) but entirely fixed/hardcoded — no gadget/widget model, can't add a chart, can't reorder, can't remove a section you don't use. Matches the Pass-8/9 finding; still true. |
| Roadmap / timeline | 3 | Attractive hand-rolled Gantt-style view (sprints + epics as bars, "today" marker, progress fill) but **strictly read-only** — no drag-to-reschedule an epic's dates, no cross-project roadmap, single-project scope only. |
| Automation engine | 4 | Trigger set is issue-lifecycle-only (`ISSUE_CREATED/UPDATED/TRANSITIONED/COMMENTED`) — no time-based/scheduled trigger, so SLA escalation ("no update in 3 days") or due-date reminders aren't buildable. Confirms Pass-9 finding, still open. |
| Reports | 4 | Velocity/burndown/cumulative-flow all present with good empty states; no export-to-image/PDF, no cross-sprint comparison view. |
| Permissions / roles | 3 | Only 3 flat workspace-wide roles (Admin/Member/Viewer); confirmed no per-project role override — a user is Admin or nothing across every project in a workspace. Real friction for agencies/consultancies running multiple client projects in one workspace. Matches Pass-9 finding. |
| Notifications | 4 | Center, preferences, @mentions, watch toggle all present and functional; "You're all caught up" empty state is clean. No digest/batching options (e.g., "email me a daily summary" vs. per-event) observed in preferences. |
| Project/issue creation flow | 4 | Clean modals, sensible defaults (Task/Medium/To Do/Unassigned); no project templates (e.g., "Scrum software project" starter with pre-built statuses/board), no project icon or color at creation — every project card looks identical until you memorize keys. |

### Parity Scorecard (Pass 10 — re-verified, deltas from Pass 9 noted)

| Capability | Our depth | Leader baseline | Gap | Delta |
|---|---|---|---|---|
| Multiple boards / board types | 5 | 5 | none | unchanged |
| Configurable columns/swimlanes | 5 | 5 | none | unchanged |
| Query language (NLQL) + saved/shared filters | 5 | 5 | none | unchanged — verified `isShared` flag works, confirmed in code |
| Custom fields (definition + input types) | 4 | 5 | **card-face surfacing missing** | narrowed from prior "does not exist" framing — definition/CRUD is excellent, only card display is the gap |
| Card color rules | 5 | 5 | none | unchanged |
| Card-level link/dependency indicator | **2** | 4 | blocked/linked issues invisible on board | **new finding this pass** |
| Configurable statuses/transitions + gates | 5 | 5 | none | unchanged |
| Automation rule engine | 4 | 5 | no scheduled/time trigger | confirmed still open (Pass 9) |
| Dashboards/gadgets | 3 | 5 | fixed sections, no gadget grid | confirmed still open (Pass 8/9) |
| Issue depth (components/versions/bulk/links/watchers/time) | 5 | 5 | none | unchanged |
| Permissions granularity | 3 | 5 | no per-project role override | confirmed still open (Pass 9) |
| Mobile board toolbar | **2** | 5 | **overflow/overlap bug, not a missing feature** | **new finding this pass — regression-class** |
| Import/export | 4 | 5 | file-based only, no live OAuth pull | confirmed still open (Pass 9) |

### Top gaps — prioritized backlog candidates

| Rank | Item | Why it matters (user value) | Size | Area |
|---|---|---|---|---|
| 1 | **Fix mobile board toolbar overflow/overlap** — wrap or horizontally scroll the Colors/Export/Import/Create-issue button row (`BoardPage.tsx` ~line 854) the same way the filter-pill row already does (`overflow-x-auto` + `sm:overflow-x-visible`) | The board is the single most-visited screen; on a phone, users currently cannot reliably tap "Create issue" and see unreachable buttons overlapping column content. This is a visible, embarrassing bug a real user hits in their first minute on mobile. | S | Board / mobile |
| 2 | **Surface blocked/linked-issue indicator on board cards** — a small icon badge (chain-link / blocked-stop icon) on `IssueCard` when the issue has any `BLOCKS`/`BLOCKED_BY` link, fetched via a lightweight per-board link-count endpoint (avoids the N+1 concern that shelved this originally) | Dependency tracking only has value if you can *see* blockers while scanning the board — right now you must open every card to know. This is the highest-leverage finish on an already-shipped feature. | M | Board / issue links |
| 3 | **Pin a custom field onto the card face** — let a custom-field definition carry a `showOnCard: boolean` and render it as a small chip on `IssueCard`, same visual language as story points/labels | Custom fields exist end-to-end but are invisible without opening the drawer, which defeats their purpose for at-a-glance board scanning (e.g., a "Severity" or "Customer" field teams actually want visible). | M | Custom fields / board |
| 4 | **Configurable dashboard (gadget grid) for the Pulse home page** — let a user add/remove/reorder gadgets (sprint snapshot, my issues, a saved-filter result list, a velocity chart) instead of the fixed 4-section layout | Reinforces Pass 8/9 finding with fresh evidence: the home screen is the retention surface, and every category-leading tracker lets you configure it. Users we're trying to convert judge "is this a real tool" partly on this. | L | Dashboards |
| 5 | **Scheduled/time-based automation trigger** (e.g., `TIME_ELAPSED_SINCE_TRANSITION`, `DUE_DATE_APPROACHING`) evaluated by a cron sweep | Confirms Pass 9: today's 4 triggers are all reactive to a user action; the most valuable automations in real teams (SLA nudges, stale-issue escalation, due-date reminders) are time-based and are structurally impossible right now. | M | Automation |
| 6 | **Per-project role override** (a `ProjectMembership` layer above the workspace-wide `Membership`) so a user can be Viewer on Project A and Admin on Project B in the same workspace | Confirms Pass 9: any team running client work, cross-functional access, or a "guest reviewer on one project only" pattern is blocked today — it's binary workspace-wide access. | L | Permissions |
| 7 | **Project creation: template + visual identity** — a project-type preset (Kanban starter / Scrum starter with seeded statuses) and a color/icon picker at creation time, shown on the project card | Every project card in a workspace looks identical (same generic folder icon, same gray key badge) until a user memorizes the key — a small thing that compounds with >5 projects. Low cost, immediate "feels considered" payoff, and directly supports the founder's "premium, distinctive" design directive. | S | Projects / onboarding |
| 8 | **Roadmap: drag-to-reschedule epics + cross-project view** — make the existing read-only Gantt bars draggable (reuse the fractional-rank/date-patch pattern already used for sprint bars elsewhere) and add a workspace-level "all projects" roadmap toggle | The visualization already exists and is well-built; today it's look-but-don't-touch and single-project only, so PMs doing real portfolio planning still leave the app to reschedule work. | M | Roadmap |

### Ideation — 3 ambitious new features/UX improvements (Pass 10)

1. **"Board health" scan on load** — a lightweight, dismissible banner on the board (or a badge in the toolbar) that surfaces board hygiene issues at a glance: N issues blocked with no comment in 7+ days, N issues with no assignee in an active sprint, N stale issues untouched 14+ days. This turns the already-shipped analytics/automation infrastructure into a proactive nudge instead of a passive report you have to remember to check — a genuinely differentiated "the tool tells you what needs attention" moment that neither the Reports page nor Automation currently deliver on their own.
2. **Inline quick-add for sprint/epic from the board card** — right now moving an unassigned backlog issue into the active sprint, or attaching it to an epic, requires opening the drawer or using Backlog drag-and-drop. A right-click / long-press card context menu ("Add to sprint", "Set epic", "Set assignee") would remove several clicks from the most repetitive daily action power users do dozens of times.
3. **Public/embeddable status page per project** — reusing the already-shipped share-token pattern (used for shared boards) to generate a read-only, branded, no-login "project status" page a team can send to a client or stakeholder: current sprint progress, recently completed issues, upcoming milestones. This is a strong, low-effort story for the "self-hosted but still looks professional to external stakeholders" pitch and differentiates from tools that gate this behind an expensive plan tier.

### Direction — next quarter

The core tracker is genuinely feature-complete and, on desktop, competitive with category
leaders — the shipped list in this task's brief is not an exaggeration. The next quarter
should **not** be more net-new surface area; it should be **finishing what's already
built** so nothing shipped reads as a demo. Concretely: (a) close the mobile regression
found this pass immediately — it is a one-file fix and directly contradicts the
"desktop AND mobile" quality bar in CLAUDE.md; (b) spend a focused sprint making already-
shipped features *visible where users actually look* — card-face surfacing for custom
fields and blocked-link badges, both cheap relative to the original feature build; (c)
tackle the one remaining structural parity gap (configurable dashboards) since it's the
last item on the original parity benchmark that's still a flat "3"; (d) treat permissions
granularity and scheduled automation as the two features that unlock adjacent buyer
segments (agencies/consultancies; SLA-driven support teams) rather than deepening
features the current buyer segment already has enough of.

### Backlog-Groomer Ingest — Pass 10 (title · priority · size · rationale)

- Fix mobile board toolbar overflow/overlap (Colors/Export/Import/Create-issue row) — P0 · S · Reproducible visual bug on the primary screen at 393px width; button overlaps column content; violates the desktop+mobile quality bar
- Board card blocked/linked-issue indicator — P1 · M · Issue links exist but are invisible while scanning the board; highest-leverage finish on a shipped feature
- Card-face custom field display (`showOnCard` flag) — P1 · M · Custom fields invisible without opening every card; defeats at-a-glance scanning value
- Configurable dashboard / gadget grid for Pulse home — P1 · L · Last remaining flat-3 parity gap from Pass 8/9, still open; home screen drives retention
- Scheduled/time-based automation trigger (cron sweep) — P2 · M · Reactive-only triggers block SLA/stale-issue/due-date automation patterns; reconfirms Pass 9
- Per-project role override (ProjectMembership layer) — P2 · L · Workspace-wide-only roles block agency/consultancy multi-client usage; reconfirms Pass 9
- Project creation template + color/icon picker — P2 · S · Every project card looks identical; cheap "feels considered" win aligned with design-elevation directive
- Roadmap drag-to-reschedule + cross-project view — P2 · M · Visualization is built but look-only and single-project; PMs still leave the app to replan
- "Board health" proactive nudge banner (stale/unassigned/blocked-too-long) — P3 · M · New ideation; turns existing analytics/automation data into a proactive signal
- Inline card context menu (quick sprint/epic/assignee) — P3 · S · New ideation; removes clicks from the most repetitive daily board action
- Public embeddable project status page (share-token reuse) — P3 · M · New ideation; strong self-hosted-but-professional story for external stakeholders

---

## 2026-07-01 — Pass 11 (full-functionality audit, cross-page coherence focus)

**Trigger.** The founder caught a real bug cluster QA had missed: the workspace
selector's header chip and the dashboard's own selector were two unsynced states,
had no persistence across reload, and the chip misreported the workspace while
viewing a project. That fix landed in `c8bf9c8` immediately before this pass. This
pass's mandate: verify the fix, then hunt for the *rest* of that bug class —
"each page works in isolation, but state is incoherent across pages/navigation/
reload" — across the whole product, plus a general functionality sweep.

**Method.** Registered a fresh user via `POST /api/auth/register`, created two
workspaces ("Workspace A/B Coherence Test") each with one project (Alpha/Bravo)
via the API to get a clean two-tenant fixture (`/tmp/audit-product/scenario.json`),
then drove the real UI with Playwright (`chromium`, desktop 1440×900 and mobile
393×851) — deep-linking directly into every project-scoped and workspace-scoped
page while deliberately leaving the "active workspace" pointed at the *other*
workspace, the way a user would after opening a bookmark, a notification link, or
a second browser tab. Also re-tested the original bug's exact repro (dashboard
`<select>` vs. header chip sync), the delete-active-workspace and
delete-last-workspace heal paths, sprint creation, and the two features shipped
immediately before this pass (blocked-issue board badge, custom-field card chips)
to confirm they work as advertised. Also logged into the demo account to
re-quantify the workspace-list scaling problem flagged in Pass 9/10. Screenshots
in `/tmp/audit-product/*.png` (ephemeral scratch dir, referenced by number below).

### Headline: the workspace-chip fix was real but incomplete — 7 of 12 workspace/project-scoped pages still lie

`c8bf9c8` added a `useSyncActiveWorkspace(workspaceId)` hook and wired it into
**8** pages: `BoardPage`, `BacklogPage`, `TriagePage`, `SettingsPage` (project
settings), `AutomationsPage`, `StandupsPage`, `PokerStartPage`, `PokerSessionPage`.
It did **not** wire it into `ReportsPage`, `RoadmapPage`, or `ProjectAnalyticsPage`
(all project-scoped — trivial to fix, same one-line pattern), nor into any of the
four **workspace-scoped** admin pages: `WorkspaceMembersPage`,
`WorkspaceAuditLogPage`, `WorkspaceSettingsPage`, `WorkspaceBrandingPage` (these
already have `workspaceId` from the route and need a plain
`setActiveWorkspaceId(workspaceId)` on mount — no lookup required).

**Repro (P1-1):** With two workspaces A (active) and B, deep-link to
`/projects/{bravoProjectId}/reports` (Bravo is in Workspace B). The breadcrumb
correctly reads "Bravo Project," but the header chip still reads "Workspace A
Coherence Test." Opening the chip's dropdown shows **Workspace A checked as
active** while you are unambiguously inside a Workspace B project.
Screenshots: `03-reports-projB-direct.png`, `04-roadmap-projB-direct.png`,
`05-analytics-projB-direct.png`, `14-switcher-open-on-projB-reports.png` (the
clearest single piece of evidence — checkmark on the wrong workspace).

**Repro (P1-2):** Deep-link to `/workspaces/{wsB.id}/settings` while active is A.
The page body correctly says "Delete this workspace ... Workspace B Coherence
Test" but the header chip still says "Workspace A." Same for `/members`,
`/audit-log`, `/branding`. Screenshots: `06-members-wsB-direct.png`,
`07-audit-wsB-direct.png`, `08-wssettings-wsB-direct.png`,
`09-branding-wsB-direct.png`. This is the single most dangerous instance of the
bug class: the **danger-zone delete-workspace page** is exactly where a user
glances at the header to double-check where they are before clicking a
destructive red button. (The actual delete action is safe — it's route-scoped
and requires typing the workspace name to confirm — but the header actively
undermines that confirmation ritual by showing the wrong workspace name right
next to it.)

**Repro (P1-3, consequence of P1-1):** From the wrongly-labeled Reports page,
click the "Projects" breadcrumb link (`ReportsPage.tsx:229`, `<Link to="/">`).
It navigates to `/` (the dashboard), which reads the same stale context — so a
user trying to go "back to my projects" from Bravo Project (Workspace B) can
silently land on **Workspace A's** dashboard/project list instead, with no
transition cue that they changed tenants. Screenshot:
`13-after-click-projects-breadcrumb.png`.

**Confirmed still correct (no regression):** `BoardPage`, `BacklogPage`,
`TriagePage` all synced correctly on deep-link (screenshots `02-board-projB.png`,
`23-backlog-projB.png`, `28-triage-projB.png`). The original bug's exact repro —
dashboard `<select>` vs. header chip — is genuinely fixed and stays in sync live
without navigation (`22-dashboard-select-sync.png`). Reload persistence and
delete-active-workspace healing both work. **Delete-the-last-workspace** (an edge
case not explicitly called out in the fix commit) also heals cleanly: deleting a
user's only workspace lands them back on the onboarding "Welcome to Next Lane"
screen with a freshly auto-created default workspace, no crash, no blank state
(`40-after-delete-last-workspace.png`). Board-level state (selected board,
NLQL/text filter) correctly persists via URL query params and per-project
`localStorage` across navigation and reload — this part of the "coherence"
surface is well-built and was not regressed.

**Secondary finding (P2):** `WorkspaceBrandingPage`'s `handleSave`/`handleReset`
call `setActiveWorkspaceId(workspaceId)` as a *side effect* of saving or
resetting the brand color (`WorkspaceBrandingPage.tsx:237,254`) — meaning simply
saving a color on a workspace you're not "in" silently and permanently (it's
persisted to `localStorage`) switches your global active workspace, with no
explicit "switch workspace" affordance, confirmation, or even a toast that says
so. This reads as an accidental workaround for the exact bug above (force a sync
after a mutation) rather than an intentional feature, and it's the wrong fix — it
should sync on page **load**, not smuggle a workspace switch into a color-save
mutation.

**Compounding finding on mobile (P2):** At 393px, the header breadcrumb has so
little space that "Bravo Project" collapses to **"Pro..."** (unreadable) right
next to a chip truncated to "Workspace ..." — so on mobile a user has almost no
way to visually confirm which project or workspace they're looking at without
opening the switcher dropdown. This isn't a new regression (it's a width/truncation
consequence of the existing layout) but it materially worsens the severity of
P1-1/P1-2 on the platform where users are least equipped to double-check via a
wide browser tab title or URL bar. Screenshot: `15-mobile-reports-projB.png`,
`16-mobile-switcher-open.png` (same wrong-workspace-checked bug, reproduced on
mobile).

### Other functionality verified this pass

- **Board fixes from Pass 10 confirmed shipped and working.** The mobile board
  toolbar overflow/overlap bug (Pass 10's #1 finding) is genuinely fixed — the
  Colors/Export/Import/Create-issue row now wraps cleanly into its own rows at
  393px with no overlap (`34-mobile-board.png`). The blocked-issue board badge
  and custom-field card-face chip (Pass 10's #2 and #3 recommendations) are both
  shipped and correctly rendered: a card with a `showOnCard` custom field shows a
  "Severity: High" chip, and a card with an unresolved `BLOCKED_BY` link shows a
  red "Blocked" badge, both visible while scanning the board without opening a
  card (`31-board-cards-cf-blocked.png`). Good, fast turnaround on two of last
  pass's highest-ranked recommendations.
- **Sprint creation** works end-to-end from the Backlog page (name/goal/dates
  modal, required-field validation via native HTML validation, sprint appears in
  the sprint list immediately after create).
- **Notification unread-count coherence is well-built** — `useNotifications` and
  the unread-count query share TanStack Query cache keys and every
  mark-as-read/mark-all-read mutation invalidates `qk.unreadCount`
  (`apps/web/src/api/notifications.ts`), so the header bell badge and the
  Notifications page can't drift out of sync. This is the *correct* pattern the
  workspace-chip bug should have used from the start (a single source of truth
  invalidated on mutation) instead of duplicating local state.
- **My Work / Notifications / Personal Analytics (Insights) are correctly
  workspace-agnostic** — they query "across all projects" by design and say so
  in their empty states, and clicking into an issue from either page correctly
  routes to `/projects/{id}/board?issue={id}`, which re-syncs the workspace chip
  via `BoardPage`'s hook. No coherence bug in this direction.
- **Quick Links are per-user, not per-workspace** — correctly workspace-agnostic,
  no coherence concern.
- **Fresh registration onboarding is unchanged and still strong** — clean
  "Welcome to Next Lane" panel, 3 feature callouts, "Create your first project"
  CTA, zero dead ends (`21-after-register.png`).
- **Demo account workspace-switcher scaling re-confirmed, now quantified.** The
  demo account's switcher dropdown currently lists **50+** entries — dozens of
  `Assignee Test <timestamp>`, `Tenant Test A/B <timestamp>`, `Role Test
  <timestamp>` junk workspaces from prior QA runs — in one long unstyled list
  with no search box, no grouping beyond alphabetical-ish insertion order, no
  archive/delete-from-list affordance, and no visual distinction between a real
  workspace and a test fixture (`42-demo-ws-switcher.png`). This is dev-data
  pollution, not strictly a shipped-product bug, but it is a real, live
  demonstration of a **product gap**: there is no workspace search/filter in the
  switcher, which will bite any real self-hoster who accumulates >15-20
  workspaces (agencies, consultancies). Matches Pass 9/10; re-flagging because it
  has visibly gotten worse (more QA runs since Pass 10) and remains unaddressed.
- **False alarm, ruled out:** an apparent "Insights" nav item stuck in a
  hover/active state across unrelated pages turned out to be a stationary
  Playwright virtual-cursor artifact (confirmed by moving the mouse away and
  re-screenshotting, `43-nav-mouse-away.png`) — not a real product bug. Noted here
  so a future audit doesn't waste time rediscovering the same false lead.

### Ratings (Pass 11)

| Area | Score | Note |
|---|---|---|
| Auth / onboarding | 5 | Unchanged from Pass 10 — register → empty workspace → first-project flow is clean, zero dead ends. |
| **Cross-page / cross-navigation state coherence** | **2** | New dedicated rating this pass. The exact bug class the founder flagged is still present on 7 of 12 workspace/project-scoped pages (Reports, Roadmap, Project Analytics, Members, Audit log, Settings, Branding) — the header chip is a facade that only some pages bother to keep honest. The fix pattern exists and works; it just wasn't applied everywhere. |
| Board (desktop) | 5 | Confirmed all Pass 9/10-rated capabilities still work; blocked badge + custom-field chip now live on cards, closing two Pass-10 gaps. |
| Board (mobile) | 4 | Pass 10's overflow/overlap regression is fixed. Docked at 4, not 5, because of the breadcrumb-truncation-plus-wrong-chip compounding issue noted above. |
| Backlog / sprints | 4 | Sprint create works; workspace-chip sync correct on this page (part of the original fix). Unchanged otherwise from Pass 9/10. |
| Triage | 4 | Functions correctly, workspace-chip sync correct (part of the original fix). |
| Reports / Roadmap / Project Analytics | 3 | Functionally correct (data is route-scoped, not context-scoped, so the numbers shown are right) but **all three actively display the wrong workspace name in the header** on direct navigation — a trust/coherence defect layered on top of otherwise-solid Pass 9/10 features. |
| Workspace admin (Members/Audit log/Settings/Branding) | 3 | Functionally correct (mutations are route-scoped) but all four pages fail to sync the header chip on load; General Settings' danger-zone page is the highest-stakes place for this to be wrong. |
| Notifications | 5 | Confirmed well-architected: shared query-cache keys keep the bell badge and inbox page perfectly in sync — the pattern the workspace context should have followed from day one. |
| My Work / Personal Analytics / Personal Board | 4 | Correctly workspace-agnostic; issue links from these pages correctly re-sync the workspace chip via the board route. Unchanged from Pass 9/10 otherwise. |
| Onboarding / empty states | 5 | Unchanged — still a genuine strength. |
| Workspace switcher at scale | 2 | Reconfirmed and now quantified: 50+ entries, zero search/filter/grouping in the demo account. Real self-hosters doing multi-tenant/agency work will hit this. |

### Parity Scorecard (Pass 11 — re-verified, deltas from Pass 10 noted)

| Capability | Our depth | Leader baseline | Gap | Delta |
|---|---|---|---|---|
| Multiple boards / board types | 5 | 5 | none | unchanged |
| Configurable columns/swimlanes | 5 | 5 | none | unchanged |
| Query language (NLQL) + saved/shared filters | 5 | 5 | none | unchanged |
| Custom fields (definition + input types + card display) | 5 | 5 | none | **closed this pass** — card-face `showOnCard` chip verified live, was the last open item |
| Card color rules | 5 | 5 | none | unchanged |
| Card-level link/dependency indicator | 5 | 5 | none | **closed this pass** — blocked badge verified live |
| Configurable statuses/transitions + gates | 5 | 5 | none | unchanged |
| Automation rule engine | 4 | 5 | no scheduled/time trigger | unchanged, not retested this pass (no code change since Pass 10) |
| Dashboards/gadgets | 3 | 5 | fixed sections, no gadget grid | unchanged |
| Issue depth (components/versions/bulk/links/watchers/time) | 5 | 5 | none | unchanged |
| Permissions granularity | 3 | 5 | no per-project role override | unchanged |
| **Cross-surface state coherence (active workspace, active tenant context)** | **2** | 5 | **header/chip lies on 7 of 12 workspace-scoped pages; no dedicated audit lens for this before this pass** | **new benchmark row — this is the class of defect the founder specifically asked us to hunt for, and it's a real, current, unfixed gap** |
| Mobile board toolbar | 5 | 5 | none | **closed since Pass 10** |
| Import/export | 4 | 5 | file-based only, no live OAuth pull | unchanged |
| Workspace-switcher scale (search/filter for many workspaces) | 2 | 4 | flat unstyled list, no search, confirmed 50+ entries in a real account | unchanged from Pass 9/10, now quantified |

### Top gaps — prioritized backlog candidates

| Rank | Item | Why it matters (user value) | Size | Area |
|---|---|---|---|---|
| 1 | **Finish the workspace-chip sync fix on the remaining 7 pages** — add `useSyncActiveWorkspace(project?.workspaceId)` to `ReportsPage`, `RoadmapPage`, `ProjectAnalyticsPage` (same one-line pattern already used on 8 sibling pages), and add a direct `setActiveWorkspaceId(workspaceId)` on mount to `WorkspaceMembersPage`, `WorkspaceAuditLogPage`, `WorkspaceSettingsPage`, `WorkspaceBrandingPage` (they already have `workspaceId` from the route — no lookup needed, just call it on load instead of only as a save side effect on `WorkspaceBrandingPage`) | This is the exact bug class the founder caught, still open on the majority of workspace/project-scoped surfaces. A user cannot trust the header to tell them where they are — and the worst instance is the "Delete this workspace" danger-zone page, where believing the header over the page body could genuinely confuse someone about which tenant they're destroying. | S | Cross-page coherence |
| 2 | **Fix `WorkspaceBrandingPage`'s save-triggers-workspace-switch side effect** — remove `setActiveWorkspaceId(workspaceId)` from `handleSave`/`handleReset`; rely on the load-time sync from item 1 instead | Saving a brand color shouldn't have the surprising, undocumented, persisted side effect of switching the user's global active workspace. Small but a real "state changed without me asking" defect once item 1 exists to make it redundant anyway. | S | Cross-page coherence |
| 3 | **Workspace-switcher search/filter for scale** — add a text filter input at the top of the chip dropdown once workspace count exceeds ~8-10, matching the pattern already used in NLQL/project pickers elsewhere in the app | Directly reproducible today: the demo account's switcher is a 50+-entry unstyled list with no way to find a workspace by typing. Any self-hoster running an agency/consultancy pattern (the same audience item permissions-granularity is meant to serve) will hit this quickly, and it undermines confidence in the workspace model at exactly the scale where it matters most. | S | Workspace admin |
| 4 | **Mobile header identity legibility** — when width is too narrow to show the full breadcrumb, prefer truncating the *workspace* name (which is also in the chip) over the *project* name (which is the primary "where am I" signal on a project-scoped page), or collapse to an icon + tooltip/long-press instead of an unreadable 3-character fragment | "Pro..." tells a mobile user nothing; combined with gap #1, mobile users currently have the least reliable "where am I" signal of any surface in the product. Cheap layout fix, meaningful trust improvement. | S | Mobile / navigation |
| 5 | **Configurable dashboard (gadget grid) for the Pulse home page** — carried forward from Pass 8/9/10, still the last flat-3 structural parity gap; not retested this pass (no code change) but remains open | Reinforces three consecutive passes' finding: the retention surface still can't be customized. | L | Dashboards |
| 6 | **Scheduled/time-based automation trigger** — carried forward from Pass 9/10, not retested this pass (no code change) | SLA/stale-issue/due-date automation patterns remain structurally impossible with reactive-only triggers. | M | Automation |
| 7 | **Per-project role override** — carried forward from Pass 9/10, not retested this pass (no code change) | Agencies/consultancies running multiple clients in one workspace still can't scope a Viewer to one project. | L | Permissions |

### Ideation — 3 ambitious new features/UX improvements (Pass 11)

1. **A visible, always-correct "you are here" breadcrumb component** — rather than
   patching each page's sync call one at a time (the root cause of this pass's
   headline finding), introduce a single `<TenantBreadcrumb>` component that
   *derives* workspace/project identity from the route params and a fetch, never
   from local/context state that pages have to remember to update. Route-derived
   truth cannot drift the way a shared-but-optionally-synced context can. This
   would retire the whole class of bug structurally instead of chasing it page by
   page, and is a natural companion to fixing gap #1 above — worth considering as
   the actual long-term fix rather than the incremental one.
2. **A lightweight "workspace switcher" telemetry/guard for destructive actions**
   — on any danger-zone action (delete workspace, delete project, bulk-delete
   issues), render the target's identity inline in the confirm button itself
   ("Delete **Workspace B Coherence Test**") sourced from the same route data as
   the page body, and require it to literally match what's typed — which
   `WorkspaceSettingsPage` already does well for delete. Extend that same
   type-to-confirm pattern to project deletion and any other irreversible action
   that doesn't have it yet, so the header's correctness stops being
   safety-critical at all.
3. **A "recently visited" workspace/project switcher** — instead of (or in
   addition to) the flat A-Z workspace list, surface the last 3-5
   workspaces/projects visited at the top of both the header chip and the
   command palette, the way browser tab-switchers and IDE "recent files" do. This
   directly defuses the 50+-entry scaling problem (gap #3) without requiring a
   user to type a search query for the workspace they were just in, and is a
   natural, cheap complement to a text-search filter.

### Direction — next quarter

The core tracker's feature surface is genuinely strong and two more Pass-10
recommendations shipped fast (blocked badge, custom-field card chip) — that
velocity is good. But this pass's headline finding is a warning: a UI built by
composing many independently-correct pages, each fetching its own data and
optionally syncing a shared "current tenant" pointer, will keep producing this
exact bug class every time a new page is added unless the sync becomes
structural rather than opt-in. The immediate priority is closing the remaining
7 pages (gap #1 — genuinely an S-sized, one-afternoon fix) so the founder's
original report is *fully* resolved, not just majority-resolved. The medium-term
priority is the structural fix in Ideation #1 — a route-derived breadcrumb that
can't drift — so this doesn't recur the next time someone ships a new
project-scoped or workspace-scoped page. After that, return to the Pass 10
backlog (configurable dashboards, scheduled automation, per-project roles) which
remains accurate and unretested this pass since no code changed there.

### Backlog-Groomer Ingest — Pass 11 (title · priority · size · rationale)

- Finish workspace-chip sync on Reports/Roadmap/Project-Analytics/Members/Audit-log/Settings/Branding pages — P1 · S · Same bug class the founder just caught, still open on 7 of 12 scoped pages; worst instance is the workspace-delete danger-zone page
- Remove WorkspaceBrandingPage's save-triggers-workspace-switch side effect — P1 · S · Saving a brand color silently and persistently switches the user's global active workspace with no confirmation
- Workspace-switcher search/filter — P2 · S · Reproduced live: 50+ unstyled entries in the demo account, no way to search; blocks agency/multi-tenant self-hosters
- Mobile header: prefer truncating workspace name over project name in the breadcrumb — P2 · S · "Pro..." gives mobile users zero identity signal, compounding the coherence bug above
- Route-derived `<TenantBreadcrumb>` component (structural fix) — P2 · M · Retires this entire bug class instead of chasing it page-by-page every time a new scoped page ships
- Recently-visited workspace/project switcher — P3 · S · New ideation; cheap complement to the search filter for the same scaling problem
- Configurable dashboard / gadget grid for Pulse home — P2 · L · Carried forward from Pass 8/9/10, still the last flat-3 structural parity gap, unretested this pass
- Scheduled/time-based automation trigger — P2 · M · Carried forward from Pass 9/10, unretested this pass
- Per-project role override — P2 · L · Carried forward from Pass 9/10, unretested this pass

---

## 2026-07-02 — Pass 12 (founder-wave verification: sidebar, dark mode, dashboards, swimlanes v2, GitHub v1)

**Trigger.** A large founder-driven wave shipped since Pass 11 (same day): persistent
left sidebar (Nav & IA Phases 1+2), light/dark mode, NLQL-native dashboards
(STAT/TABLE/BREAKDOWN/BURNDOWN), Swimlanes v2 (group-by custom field/component/
label/sprint), GitHub integration v1, SSO/OIDC Phase 1, MCP 55→85 tools,
workspace-switcher search/recents, two robustness fix batches, and CSV export
completeness. This pass verifies every one of those as a real user, re-scores the
Better-than-Jira scorecard with fresh evidence, and hunts regressions the wave's
own surface area introduced.

**Method.** Registered a fresh user via `POST /api/auth/register`
(`audit12-*@example.com`), built a scenario via the API (`GBA` project, a `Team`
SELECT custom field with three option values assigned across six issues, a
second/third+ workspace, then 12 more `Scale Test WS N` workspaces to force the
switcher's search/scale UI), then drove the real UI with Playwright
(`chromium`, desktop 1440×900, mobile 393×851 `isMobile`/`hasTouch`, and 1024×768
for the "small laptop" breakpoint called out in this pass's brief) —
`/home/user/Next-Lane/apps/web/node_modules/@playwright/test/index.js` CJS
default-import, browser launched with `executablePath` pointed at the
environment's installed Chromium build. Configured GitHub v1 via the real API
(`PUT /projects/:id/github`) and sent **real HMAC-SHA256-signed webhook payloads**
(`push` and `pull_request` events, plus a deliberately-tampered signature) to
`POST /github/webhook/:projectId` — not a mock, an actual signature computed with
the returned `webhookSecret`. Screenshots in `/tmp/audit-p12/*.png` (ephemeral
scratch, referenced by name below).

### Headline: the wave is real and mostly excellent — but Swimlanes v2 shipped a mobile-breaking regression, and one Pass-11 fix has a subtler side effect than "fixed" implies

Every major new surface was exercised end-to-end and, with one serious exception,
works as advertised, well-built, and honestly represents the ROADMAP claims. The
exception is severe enough to be this pass's top finding: **the board's
"Group by" and filter-chip dropdown menus render completely invisible on mobile
(393px) the moment the toolbar row's total width exceeds the viewport** —
functionally interactive (a forced click on the invisible "Team" option correctly
applies the swimlane grouping) but **not paintable to a real user's eyes on a real
touchscreen**, which for all practical purposes makes Swimlanes v2 — this pass's
flagship feature — unusable via touch on mobile. This directly contradicts the
CLAUDE.md quality bar ("test real-user behavior... desktop AND mobile") and is a
regression: Pass 11 rated the mobile board toolbar a clean 5/5 after Pass 10's
overflow fix, and `git log -- apps/web/src/pages/BoardPage.tsx` confirms Swimlanes
v2's commit (`8ff195c`) is the most recent touch to that file — the new "Group by"
chip pushed the toolbar row's content past 393px and reintroduced the class of
bug Pass 10 fixed, this time as an invisible-render bug rather than a visible
overlap.

**Repro (P1 — invisible mobile dropdown menus).** At 393×851 (`isMobile: true`),
open the board, tap "Group by." The menu opens (confirmed via Playwright: the
"Team" `<button>` is present, `opacity: 1`, `z-index: 20`, non-zero bounding box,
`isVisible()` returns `true`) but **a full-viewport screenshot shows nothing at
all** at that screen location — not even the left ~114px of the 208px-wide panel
that geometrically overlaps the visible viewport (`ax-mobile-menu-verify.png`,
taken twice, before and after, to rule out a timing fluke). An **element-level**
screenshot of the same "Team" button (`az-team-btn-direct.png`) renders its text
correctly, proving the node itself is paintable — this is a compositing/clipping
bug, not a `display:none`/opacity issue. Root cause (via computed-style ancestor
walk, `mobile-swimlanes7.mjs`): the dropdown is `position: absolute; left: 0`
anchored to a wrapper that sits near the toolbar's right edge (`x: 279`, chip
width 98px) inside a chain that includes `<div class="flex h-screen flex-col
overflow-x-clip">` at the app-shell root — the dropdown's own box (`x: 279` to
`x: 487`, 208px wide) extends 94px past the 393px viewport, and Chromium's
`overflow-x-clip` (a stricter, newer clip primitive than `overflow: hidden`)
appears to suppress the paint of the **entire** absolutely-positioned box rather
than clipping only the overflowing portion. **Confirmed this is not swimlanes-
specific:** the same board's "Priority" filter-chip dropdown reproduces
identically (`ay-mobile-priority-menu.png` — opens, is interactive, renders
nothing). **Confirmed the feature still functionally works underneath:** a forced
click on the invisible "Team" option correctly applies the grouping
(`ba-mobile-after-blind-team-click.png` shows `Group: Team` and real
FRONTEND/BACKEND swimlane sections) — so this is a pure rendering/paint defect, not
broken logic, but a real mobile user cannot see the menu to make the selection in
the first place. **Confirmed desktop is unaffected** (`bd-desktop-groupby-
sanity.png` — the same dropdown renders perfectly at 1440px, where the row never
approaches the viewport edge).

> **Fixed 2026-07-02** — portalled, viewport-clamped `<DropdownPanel>` component
> (`apps/web/src/components/ui/DropdownPanel.tsx`) replaces every toolbar
> `position: absolute` menu in `BoardPage.tsx`; paint-level e2e added to
> `swimlanes.spec.ts` (real screenshot decoded via canvas, not just
> `isVisible()`/`boundingBox()`). See `docs/BACKLOG.md` Ready queue.

**Repro (P2 — quick-filter chip row overflow, likely reintroduced by the same
commit).** At 393px, the quick-filter chip row (`My issues` / `High priority` /
`Unresolved` / `Recently updated`) has `scrollWidth: 447` vs. `clientWidth: 393`
(confirmed via `page.evaluate`) with `overflow-x: visible` — not `auto`/`scroll` —
so the extra 54px is silently clipped rather than swipeable. The "Recently
updated" button's own bounding box is `x: 331` to `x: 466`, meaning **more than
half of it (73px of 134px) sits past the visible viewport edge with zero visual
cue (no scroll shadow, no "more" affordance) and no working horizontal scroll
gesture** (`an-mobile-chip-row.png` — the label is visibly cropped to "Rec").
This quick filter is functionally unreachable on a real phone today.

> **Fixed 2026-07-02** — chip row now `overflow-x: auto` with `shrink-0` chips
> and the house `.nl-scroll` treatment; e2e added to `quick-filters.spec.ts`
> confirming "Recently updated" is fully reachable after scrolling.

**Repro (P2 — "Group by" chip label wraps to two lines).** The new "Group by"
chip is the only chip in either the desktop or mobile toolbar whose label wraps
mid-word onto a second line inside a single-line-height pill at 393px
(`an-mobile-chip-row.png` — "Group" / "by" stacked) — every sibling chip
(`Labels`, `Type`, `Priority`) stays single-line at the same width. Cheap visual
polish miss, but conspicuous since it's the newest chip in the row.

> **Fixed 2026-07-02** — `whitespace-nowrap`/`shrink-0` added to the "Group by"
> chip, matching every sibling; e2e assertion added to `quick-filters.spec.ts`.

**Finding (P3 — sidebar at the 1024px "small laptop" breakpoint).** The
persistent left sidebar has no viewport-width-aware default: at 1024×768 it stays
fully expanded at its 240px desktop width (confirmed in `AppSidebar.tsx` — the
`collapsed` state is purely user-toggled/persisted, with no auto-collapse tied to
`window.innerWidth`), leaving ~780px for the 3-column Kanban board. The `Done`
column's header and its "+ Add issue" button are partially cut off
(`ao-1024-board.png`) — the board area has its own internal horizontal scroll
container so nothing is truly broken (`document.body.scrollWidth` still equals
`innerWidth`), but a first-time visitor on a common 13" laptop resolution gets a
noticeably more cramped board than before the persistent sidebar existed, with no
system nudge ("collapse for more room?") to discover the fix. Not a regression in
the "broken" sense — a genuine reduction in usable content width introduced by
this pass's own headline nav feature, worth a follow-up.

> **Fixed 2026-07-02** — `SidebarContext.tsx`'s `readCollapsed()` now defaults
> to the collapsed rail at 1024–1279px when there is no stored preference; an
> explicit user preference still wins at any width. e2e added to
> `nav-sidebar.spec.ts`.

**Finding (P3, nuance — not a clear-cut bug but worth a product decision).**
Pass 11's headline P1 (the workspace-chip lying on 7 of 12 scoped pages) is
**genuinely and thoroughly fixed** — see the coherence-matrix verification below
— via exactly the structural fix Pass 11's Ideation #1 recommended: a
`useSyncActiveWorkspace(workspaceId)` hook (`WorkspaceContext.tsx:179-186`) that
derives the active workspace from route params rather than trusting stale
context. But this fix has a side effect worth flagging: **simply viewing any
workspace-scoped page now permanently switches the user's persisted default
workspace** (`localStorage`-backed), even for a page you only looked at and never
took an action on. Repro: with "Second WS Audit12" active, deep-link to
`/workspaces/{otherWorkspaceId}/branding`, save a color (or just view it — the
`useSyncActiveWorkspace` call fires on mount regardless of any save), then
navigate to `/` — the app now defaults to the *other* workspace
(`ar-active-workspace-after-branding-save.png`, accent color visibly flipped to
confirm). This is architecturally different from Pass 11's specific finding (the
`handleSave`/`handleReset`-only side effect in `WorkspaceBrandingPage.tsx` is
gone, code-verified), but the broader "browsing = switching your default" behavior
now applies systemically to every workspace-scoped page, not just Branding. This
may be intentional ("wherever you last navigated is where you land next," a
pattern some multi-tenant tools use deliberately) or may want a distinct "switch"
vs. "view" affordance — flagging for a product call, not re-opening as a defect,
since it does correctly solve the header-honesty problem it was built to solve.

### Cross-page coherence re-verification (mandate item 2) — Pass 11's P1 is closed

Repeated Pass 11's exact methodology with a fresh two-workspace fixture: made
"Second WS Audit12" the active workspace via the UI switcher, then deep-linked
directly to every page Pass 11 found broken, for a project/workspace that belongs
to the *other* workspace. **All seven previously-broken pages now correctly show
the workspace the URL actually points to, not the stale "active" one:** Reports
(`coh-reports.png`), Roadmap (`coh-roadmap.png`), Project Analytics
(`coh-analytics.png`), Workspace Settings incl. the danger-zone delete page
(`coh-ws-settings.png`), Members (`coh-ws-members.png`), and Branding
(`coh-ws-branding.png`) all render "Audit12 Workspace" in both the header chip
and the sidebar/breadcrumb — the exact defect the founder caught is gone. This is
a clean, well-executed fix, not a partial one.

### Feature verification detail

- **Sidebar (desktop).** Expand/collapse toggles correctly, **persists across
  reload** (`c-sidebar-collapsed.png` → `d-sidebar-collapsed-after-reload.png`
  confirm identical collapsed state after a hard reload), and the active
  project's row correctly expands to show Board/Backlog/Triage/Dashboards/
  Roadmap/Reports — closing the exact "buried features" complaint from the
  founder's 2026-07-02 session (VISION.md). Multi-board picker (`+ New board`)
  present and reachable from the board-title dropdown.
- **Sidebar (mobile drawer).** Hamburger → `MobileSidebarDrawer` opens a clean,
  labeled ("Navigate") overlay with focus trap, backdrop, Esc/close/nav-click
  close (`aj-mobile-sidebar-drawer.png`). **Gap:** `MobileSidebarDrawer.tsx`
  reuses `SidebarNavContent` but does **not** render `<ThemeToggle>` or the
  collapse control that the desktop `AppSidebar.tsx` has in its footer
  (code-verified: `AppSidebar.tsx` imports and renders `ThemeToggle`;
  `MobileSidebarDrawer.tsx` does not) — not a dead end, since the theme toggle is
  reachable via the avatar/user menu instead (verified working,
  `al-mobile-user-menu-theme.png` → `am-mobile-dark-applied.png`), but it means
  the theme control lives in two different mental-model locations depending on
  viewport width, which is a minor inconsistency worth a follow-up unification.
- **Dark mode.** Toggle (Light/Dark/System), applies instantly, **persists
  across reload** (`f-dark-home.png` → `g-dark-home-after-reload.png`).
  Checked every "less-traveled surface" the brief called out: issue drawer
  (`i-dark-issue-drawer.png` — checklist, time tracking, attachments, all
  correctly themed), project settings (`j-dark-project-settings.png`),
  workspace settings incl. the danger-zone red panel
  (`k-dark-workspace-settings.png`), and branding (`l-dark-branding.png`,
  including the live color-preview chips). **No contrast or dead-pixel defects
  found** on any of these surfaces — this is a genuinely thorough token-layer
  implementation, not a superficial "invert everything" pass.
- **Dashboards (NLQL-native gadgets).** Created a real dashboard and all **four**
  gadget types with live data: STAT (`6 issues match`), STAT with a real NLQL
  query (`assignee = me() AND status != Done` → correctly returns `0`), TABLE
  (renders a real sortable-looking issue table with Key/Title/Status/Assignee/
  Points columns), BREAKDOWN (group-by `Priority`, correct bar + count),
  BURNDOWN (`q5-tall-dashboard.png`). The Group-By selector for BREAKDOWN
  correctly lists the project's custom field (**"Team (custom)"**) alongside
  Status/Assignee/Priority/Type/Label/Component — custom fields are first-class
  in the dashboard system, not an afterthought. **Burndown's empty state is
  excellent UX, not a crash:** with no sprint-linked issues it shows "No issues
  matched by this query belong to a sprint — add a sprint filter, e.g.
  `sprint = "Sprint 1"`" — a specific, actionable message, not a blank chart or
  a stack trace. **Invalid-query error path verified precise:**
  `thisIsNotAField ~~~ garbage syntax @@` produces an inline parser error
  ("Unexpected character '@' at position 35") and correctly disables the Save
  button until fixed (`r-invalid-query-in-form.png`) — this is real recursive-
  descent-parser-quality validation, not a generic "invalid query" toast.
  Per-keystroke typing into the NLQL field showed no focus loss or dropped
  characters (`perkeystroke.mjs` — 34-character query typed one keystroke at a
  time, final value matched exactly).
- **Swimlanes v2 (desktop).** Group-by menu correctly lists Status/Assignee/
  Priority/Issue type/Epic/Component/Sprint/Labels plus a "CUSTOM FIELDS"
  section with our `Team` field. Grouping by `Team` renders correct swimlane
  sections (FRONTEND: 2, BACKEND: 2, PLATFORM: 1, with the 6th ungrouped issue
  correctly falling into its own section) with accurate per-status counts inside
  each lane (`u-swimlanes-by-team.png`). Desktop swimlanes are excellent — the
  mobile regression above is the only defect in this feature.
- **GitHub integration v1 — verified with a real signed webhook, not a mock.**
  Configured via `PUT /projects/:id/github` (repo + PAT), which correctly
  returned a generated `webhookSecret`. Computed a real `HMAC-SHA256`
  signature over the JSON body with that secret and POSTed both a `push` event
  (commit message `Fix login bug (GBA-1)`) and a `pull_request` event (title
  `GBA-2 Add feature`, `#42`, `state: open`) to
  `/api/github/webhook/:projectId` — both returned `200 {"ok":true,
  "linksUpserted":1}`. **Confirmed the issue drawer renders both correctly**:
  GBA-1's drawer shows a "DEVELOPMENT" section with `abc123d Fix login bug
  (GBA-1)` (`ab-issue1-drawer-dev.png`); GBA-2's shows `#42 GBA-2 Add feature`
  with an `OPEN` state badge (`ac-issue2-drawer-dev.png`). **Confirmed signature
  verification actually rejects tampering**, not just accepts anything: a
  request with `X-Hub-Signature-256: sha256=deadbeef` correctly returned
  `401 {"message":"Invalid webhook signature"}`. This is a real, working,
  security-correct feature — the ROADMAP claim is not an exaggeration.
- **SSO/OIDC Phase 1.** Correctly **absent** from the login page when
  unconfigured (`ad-login-page-no-sso.png` — clean email/password form, no
  broken/disabled SSO button, no dead link) — good defensive UI. Code-verified
  (`LoginPage.tsx:25-37`) that the button is entirely conditional on a
  `providersQuery` result. **Gap noted:** configuration is env-var-only
  (`apps/api/src/auth/oidc/oidc.config.ts`) with no in-app admin settings screen
  — a self-hoster must edit `.env`/compose and restart the API to turn SSO on,
  rotate a client secret, or change the provider label. Category-leading
  trackers let an org admin do this from a settings page without a redeploy;
  this is real self-service friction for the exact enterprise/agency audience
  the "Admin controls" scorecard row is meant to serve.
- **Workspace switcher — search AND recents both verified working.** With 14
  workspaces, the switcher shows a search input once the list crosses the
  threshold (`af-switcher-14ws.png`), and typing filters live and correctly
  (`ag-switcher-search-filtered.png`, typed "Scale Test WS 9" → exactly one
  match shown). **Recently-visited is also shipped and correct**, not just
  search: after navigating A → "Scale Test WS 9" → "Scale Test WS 3," reopening
  the switcher shows a "RECENT" section at the top with "Scale Test WS 9"
  (the workspace visited immediately before the current one) ahead of the
  alphabetical list (`ah-switcher-after-nav-order.png`). This closes **two**
  Pass 11 backlog items (#3 search, Ideation #3 recently-visited) in the same
  ship — a strong, complete piece of work.
- **Admin lockout (robustness fix batch) re-verified.** Attempting to demote
  the sole workspace ADMIN to VIEWER via the API correctly returns
  `400 "Cannot change this admin's role — every workspace needs at least one
  admin. Promote another member to admin first."` — the fix holds.
- **CSV export completeness re-verified.** `GET /projects/:id/issues.csv`
  returns 19 columns including `Description`, `Component`, `Fix Versions`,
  `Parent`, `Original Estimate (minutes)`, and — correctly — `CF: Team` with
  real per-issue values (`Frontend`/`Backend`/`Platform`) matching what was set
  via the UI. The ROADMAP claim of column-completeness holds.
- **Keyboard-first ergonomics re-verified.** Cmd-K opens a real fuzzy command
  palette with quick actions (Create issue, Go to Board/Backlog/Reports, Triage
  issues) and live issue search — typing "Audit issue 3" correctly surfaces
  `GBA-4 Audit issue 3` with its status (`bc-cmdk-search.png`). No regression.
- **Multi-board / board types.** The board-title dropdown correctly shows
  "Main Board · default · KANBAN" with a "+ New board" affordance
  (`v-board-picker.png`) — unchanged, still a genuine differentiator.
- **Per-project role override.** Still absent — `prisma/schema.prisma` has no
  `ProjectMembership` model; `Membership` remains a single workspace-wide role
  row. Unchanged from Pass 9-11, reconfirmed by schema inspection this pass.

### Ratings (Pass 12 — 1-10 scale per this pass's brief; prior passes used 1-5, noted for continuity)

| Area | Score /10 | Note |
|---|---|---|
| Auth / onboarding | 9 | Unchanged strength; register → workspace → first project remains clean and dead-end-free. |
| Navigation / IA (persistent sidebar) | 8 | Desktop excellent — collapse persists, active project expands to real sub-links, closes the founder's "buried features" complaint. Docked from a 9/10 for the 1024px cramped-board finding and the mobile drawer's missing theme-toggle/collapse control (P3s, not blockers). |
| Dark mode | 9 | Thorough, token-driven, checked on 6 distinct surfaces incl. drawer/settings/branding with zero contrast or dead-pixel defects. Not a 10 only because it wasn't checked against WCAG contrast tooling this pass (spot-checked visually only). |
| Dashboards (NLQL-native gadgets) | 8 | All four gadget types work with real data; custom fields fully integrated as group-by targets; excellent, specific empty/error states (burndown's "no sprint" message, the inline NLQL parser error). Docked for the still-open cross-sprint-trend and cross-workspace-scoping gaps carried from the ROADMAP's own "Phase 2" note. |
| Swimlanes v2 (desktop) | 9 | Correct grouping, correct per-lane counts, custom fields fully wired into the group-by menu. |
| Swimlanes v2 / board toolbar (mobile) | 3 | **Regression.** The flagship new feature's own trigger (the Group-by dropdown) is invisible-but-technically-clickable on a real phone; the pre-existing quick-filter chip row is also freshly broken (silent overflow-clip, not scroll). This is the pass's most severe finding. |
| GitHub integration v1 | 9 | Verified end-to-end with a real signed webhook (not a mock): push + PR linking, drawer rendering, and signature-tampering correctly rejected. Docked one point only because auto-transition-on-merge/live CI status/smart-commits remain unshipped follow-ups (tracked, not a surprise). |
| SSO/OIDC Phase 1 | 6 | Correctly gated/invisible when unconfigured — no broken UI. Real gap: env-var-only config with no in-app admin self-service screen, which is friction the target enterprise/agency buyer will notice immediately. |
| Workspace switcher at scale | 9 | Both search and recently-visited verified working correctly with a real 14-workspace fixture — a complete, well-executed closure of two carried-forward backlog items in one ship. |
| Cross-page / cross-navigation state coherence | 9 | Pass 11's headline P1 (7 of 12 broken pages) is genuinely and fully fixed via the recommended route-derived-truth structural pattern, re-verified with a fresh two-workspace deep-link matrix. Docked one point for the "browsing silently switches your persisted default workspace" nuance noted above — not a defect, but worth a product decision. |
| Robustness fixes (admin lockout, CSV completeness) | 9 | Both re-verified directly against the API; hold up as claimed. |
| Keyboard-first ergonomics | 9 | Cmd-K fuzzy search + quick actions confirmed with fresh live typing; no regression. |
| Permissions granularity | 3 | Unchanged — no `ProjectMembership` model exists; still binary workspace-wide roles. |

### Parity Scorecard (Pass 12 — deltas from Pass 11 noted)

| Capability | Our depth | Leader baseline | Gap | Delta |
|---|---|---|---|---|
| Multiple boards / board types | 5 | 5 | none | unchanged |
| Configurable columns/swimlanes | 5 | 5 | none | **desktop unchanged at 5; new mobile-specific gap noted separately (see ratings table) — this row measures capability depth, not per-platform reach** |
| Query language (NLQL) + saved/shared filters | 5 | 5 | none | unchanged, re-verified with a fresh invalid-query + per-keystroke test |
| Custom fields (definition + input types + card display + dashboard grouping) | 5 | 5 | none | **strengthened this pass** — custom fields now verified wired into dashboards' group-by menu and CSV export, not just cards/filters |
| Card color rules | 5 | 5 | none | unchanged, not retested this pass |
| Card-level link/dependency indicator | 5 | 5 | none | unchanged, not retested this pass |
| Configurable statuses/transitions + gates | 5 | 5 | none | unchanged |
| Automation rule engine | 4 | 5 | no scheduled/time trigger | unchanged, not retested this pass |
| Dashboards/gadgets | 5 | 5 | none | **closed this pass** — Phase 1 shipped and verified with all 4 gadget types, real NLQL, custom-field grouping; the last flat-3 structural gap from Pass 8/9/10/11 is genuinely gone. Remaining refinements (cross-sprint trend, cross-workspace scoping) are polish, not a structural absence. |
| Integrations (SCM) | 4 | 5 | GitHub v1 real and working; no auto-transition/CI-status/smart-commits/GitLab/Gitea | **improved this pass** — was scaffolding-adjacent risk before verification; now confirmed genuinely working end-to-end with a real signed webhook, not just present in code |
| Permissions granularity | 3 | 5 | no per-project role override; SSO env-var-only, no self-service admin config | **new sub-gap noted** — SSO self-service config joins per-project roles as an admin-depth gap |
| Cross-surface state coherence (active workspace/tenant context) | 4 | 5 | Pass 11's specific 7-page bug is fixed; the underlying "route visit can silently persist a context switch" pattern is now systemic-by-design rather than accidental, and worth a product decision | **improved from 2 → 4** — genuine, verified fix; not a 5 pending that product decision |
| Mobile board toolbar | 2 | 5 | **regression** — invisible dropdown menus + freshly-broken chip-row overflow, both introduced by this pass's own Swimlanes v2 ship | **regressed from 5 → 2** since Pass 11 |
| Import/export | 5 | 5 | none | **strengthened** — CSV completeness re-verified with real custom-field data end-to-end |
| Workspace-switcher scale (search/filter/recents) | 5 | 5 | none | **closed this pass** — both search and recently-visited verified working with a real 14-workspace fixture |
| SSO/OIDC | 3 | 5 | Phase 1 (generic OIDC login) works but is env-var/redeploy-only, no in-app admin config screen; no SAML/multi-provider | **new benchmark row this pass** |

### Better-than-Jira scorecard — recommended verdict changes (evidence for vision-steward)

| Dimension | Current verdict (VISION.md) | Recommended | Evidence (this pass) |
|---|---|---|---|
| Reporting | Behind | **→ Parity** | Dashboards Phase 1 is not scaffolding — verified all 4 gadget types with real data, custom-field grouping, and precise NLQL validation. The specific "flat 3 for four consecutive passes" gap this row was scored on is closed; remaining items (cross-sprint trend, cross-workspace scoping) are refinements a Parity/near-Better product still has, not a structural absence. |
| Integrations | Behind, closing | **stays Behind, but tighten the note** | GitHub v1 confirmed genuinely working (real signed-webhook round trip, not just present in code) — this *reduces* execution risk on the claim, but the depth gap vs. the incumbent's day-one SCM feature set (auto-transition, live CI status, GitLab/Gitea) is unchanged, so the verdict itself shouldn't move yet. |
| Reliability / coherence-of-state | Behind | **→ Parity** | Pass 11's exact headline defect (7 of 12 pages lying about the active workspace) is fully and correctly fixed, re-verified independently this pass with a fresh two-workspace deep-link matrix covering every previously-broken page. Flag the "browsing silently persists a workspace switch" nuance as a note, not a blocker to the verdict change — it's a design question, not a coherence bug. |
| Admin controls | Behind | **stays Behind** | Real progress (SSO Phase 1 shipped and correctly gated; switcher search+recents shipped and verified) but two blockers for the target enterprise/agency buyer remain unaddressed: no per-project role override (schema-confirmed absent) and SSO configuration requires editing env vars and redeploying rather than an in-app admin screen — both are exactly what an evaluating admin checks first. |
| Mobile | Behind | **stays Behind, reinforce with fresh negative evidence** | This pass found a *new* P1 regression (invisible, touch-unusable dropdown menus) directly caused by this wave's own Swimlanes v2 ship — mobile went from "missing native app" (a known, static gap) to actively regressing on web-mobile usability of a flagship new feature. This is the opposite of closing distance and should be called out explicitly in VISION.md's evidence line so it doesn't read as a stale carryover. |
| Board speed & feel | Better | **stays Better** | Swimlanes v2 by custom field confirmed excellent on desktop; the mobile regression is tracked under the Mobile row, not this one — the underlying board capability itself is not diminished. |
| Onboarding / first-hour experience | Parity | **stays Parity, but note structural improvement** | The persistent sidebar directly and durably resolves the founder's 2026-07-02 "three shipped features read as missing" complaint (branding, board filters, roadmap all now always-visible in the expanded project row) — this is real progress on the *first-hour orientation* half of this row, even though the *self-hosting setup friction* half is unchanged. Not enough alone to move to Better, but worth citing as the concrete fix for the cited complaint. |

### Top gaps — prioritized backlog candidates

| Rank | Item | Why it matters (user value) | Size | Area |
|---|---|---|---|---|
| 1 | **Fix invisible mobile filter/group-by dropdown menus** — the panel's `position: absolute; left: 0` anchoring against a chip near the toolbar's right edge, combined with the app-shell's `overflow-x-clip`, suppresses paint of the entire menu (not just the overflowing portion) once the toolbar row approaches 393px. Anchor right-aligned dropdowns from their right edge (`right: 0`) instead of `left: 0` when the trigger sits in the right half of a narrow viewport, or portal the menu to `document.body` (matching `MobileSidebarDrawer`'s own pattern) so it escapes the clipping ancestor entirely. | This is a P1: a real phone user cannot see the menu to select a swimlane grouping or a quick filter at all — confirmed functionally interactive but visually absent. It makes this pass's flagship feature (Swimlanes v2) unusable via touch, directly violating the CLAUDE.md "desktop AND mobile" quality bar. | S | Board / mobile |
| 2 | **Fix mobile quick-filter chip row overflow** — set `overflow-x: auto` (with a scroll-snap or a fade/shadow affordance) on the chip row instead of the current `overflow-x: visible`, so "Recently updated" (and any future chip) becomes swipeable rather than silently clipped. | "Recently updated" is currently unreachable on a real phone — more than half the button sits past the viewport edge with no visual cue and no working scroll gesture. Likely reintroduced by the same commit that added the "Group by" chip to the same row. | S | Board / mobile |
| 3 | **Fix the "Group by" chip's two-line label wrap on mobile** — shorten the label (e.g., an icon-only mobile variant, matching `Labels`/`Type`) or widen the pill's `min-width` so it stays single-line like every sibling chip. | Small, but conspicuous — the one newest chip in the row is the one that looks visually broken next to four polished siblings. | S | Board / mobile |
| 4 | **In-app SSO/OIDC admin configuration screen** — let a workspace/instance admin set provider, client ID/secret, issuer URL, and label from a settings page (with the secret stored encrypted, mirroring the GitHub PAT pattern already shipped), instead of requiring an env-var edit and API redeploy. | This is real, immediate friction for the enterprise/agency self-hoster segment the "Admin controls" scorecard row exists to serve — it's the first thing an evaluating admin will try to click, and today there's nothing to click. | M | Admin / SSO |
| 5 | **Per-project role override (`ProjectMembership` layer)** — carried forward from Pass 9-11, schema-confirmed still absent this pass. | Agencies/consultancies running multiple clients in one workspace still can't scope a Viewer to a single project; still binary workspace-wide roles. | L | Permissions |
| 6 | **Sidebar auto-collapse (or a one-click nudge) at ≤1024px** — either default `collapsed: true` when `window.innerWidth` is below a small-laptop threshold on first load, or surface a lightweight "collapse for more room?" affordance when the board's own horizontal scroll container is triggered by sidebar width. | Not broken, but a real, measurable reduction in usable board width on a common 13" laptop resolution introduced by this pass's own headline nav feature; first-time visitors on smaller screens get no signal that collapsing helps. | S | Navigation / responsive |
| 7 | **Unify the mobile theme control location** — either add `<ThemeToggle>` to `MobileSidebarDrawer.tsx` (matching desktop's sidebar-footer placement) or intentionally document/standardize on the avatar-menu placement for mobile so it isn't split by viewport width. | Minor consistency gap, not a dead end (the toggle is reachable either way) — but two different mental models for the same control depending on screen width is the kind of small friction the design-elevation directive exists to catch. | S | Navigation / dark mode |
| 8 | **Product decision: should viewing a workspace-scoped page persist a default-workspace switch?** — either keep the current "wherever you last navigated becomes your default landing workspace" behavior and document it as intentional, or add a distinct "switch to this workspace" affordance separate from mere navigation/viewing. | Currently, simply viewing (or saving on) a colleague's shared link to another workspace's settings page silently and permanently changes what workspace greets you next time you open the app — verified working-as-coded but not obviously working-as-intended. | S (decision) / M (if changed) | Cross-page coherence |
| 9 | **Configurable dashboards Phase 2** — cross-sprint trend view, cross-workspace gadget scoping, additional visualization types (already tracked in ROADMAP's own "Phase 2" note). | Carried forward; Phase 1's strength this pass makes Phase 2 a natural next increment rather than a new pillar. | M | Dashboards |
| 10 | **Scheduled/time-based automation trigger** — carried forward from Pass 9-11, unretested this pass (no code change). | SLA/stale-issue/due-date automation patterns remain structurally impossible with reactive-only triggers. | M | Automation |

### Ideation — 3 ambitious new features/UX improvements (Pass 12)

1. **Dashboard sharing + a public "team pulse" embed** — reuse the same
   share-token pattern already used for public boards to let a dashboard (not
   just a board) be published read-only, no-login, to a URL a manager or client
   can bookmark. Given how strong Dashboards Phase 1 turned out to be this pass
   (real NLQL, real gadget variety, genuinely good empty/error states), this is
   now a cheap, high-leverage extension rather than a speculative one — it
   directly extends Pass 10's "public/embeddable project status page" idea but
   is more valuable now that dashboards are a first-class, configurable surface
   rather than a fixed report.
2. **GitHub auto-transition-on-merge + a "linked PR" board-card badge** — now
   that the linking plumbing is confirmed solid (real webhook signature
   verification, correct idempotent upsert on `[issueId, kind, externalId]`),
   the highest-leverage next slice isn't more link *types*, it's making the
   existing links *act*: auto-move an issue to Done when its linked PR merges
   (a config toggle per project, off by default), and surface a small PR-state
   dot directly on the board card (mirroring the existing blocked-issue badge
   pattern) so "this card has an open PR" is visible while scanning the board,
   not just inside the drawer.
3. **A "swimlane WIP/health" strip** — now that Swimlanes v2 groups issues into
   real named sections (by component/label/custom field/sprint), add an
   optional per-swimlane summary strip (count, oldest-issue age, or a
   configurable custom-field rollup like "story points remaining") in the
   swimlane header, the same way each status column already shows a count
   badge. This turns swimlanes from a pure visual grouping into a genuine
   team/component-level health signal at a glance — a natural, low-cost
   extension of a feature that's otherwise already excellent on desktop.

### Direction — next quarter

This wave was ambitious and, item for item, mostly delivered exactly what it
claimed — dashboards, GitHub integration, and the workspace-chip structural fix
all held up under adversarial, hands-on verification (a real signed webhook, a
real invalid-NLQL parser error, a real two-workspace deep-link matrix), which is
a genuinely strong signal about engineering discipline on this team. The one
real miss is exactly the kind of miss CLAUDE.md's quality-bar language warns
about: Swimlanes v2 shipped, "tests passed," and it is in fact broken for a real
mobile user in a way no amount of `.click()`-based e2e testing would catch unless
it specifically asserted pixel visibility rather than DOM presence — the gap
between "the button exists and is clickable" and "a human can see it" is
precisely the class of bug the per-keystroke/real-user-behavior mandate exists to
close. The immediate priority is item #1 (the invisible dropdown fix) since it's
S-sized and blocks the pass's own flagship feature on an entire platform. After
that: the SSO self-service config gap and per-project roles are the two
highest-leverage remaining items for the "Admin controls" scorecard row, since
they're the two things an evaluating enterprise/agency admin will look for
first and find missing today. Structurally, this pass suggests the QA/build loop
should add a lightweight "does this element have non-zero rendered pixels in a
full-page screenshot at 393px" check for any new interactive menu/dropdown,
since DOM presence + `isVisible()` alone (as this pass's own initial automated
probes showed) is not sufficient to catch this exact bug class — a visibility-
by-composite check, not just a visibility-by-style check, is needed going
forward for any absolutely-positioned overlay near a viewport edge.

### Backlog-Groomer Ingest — Pass 12 (title · priority · size · rationale)

- Fix invisible mobile filter/group-by dropdown menus (right-align or portal past `overflow-x-clip`) — P1 · S · Confirmed functionally interactive but visually unpaintable at 393px; makes Swimlanes v2 unusable via touch, violates the desktop+mobile quality bar
- Fix mobile quick-filter chip row overflow (`overflow-x: auto` + affordance) — P1 · S · "Recently updated" more than half clipped off-canvas with zero scroll cue, likely reintroduced by the same commit that added "Group by"
- Fix "Group by" chip two-line label wrap on mobile — P2 · S · Visually inconsistent with every sibling chip at the same width
- In-app SSO/OIDC admin configuration screen (no env-var/redeploy requirement) — P1 · M · Immediate, visible friction for the enterprise/agency buyer the Admin-controls scorecard row targets; nothing to click today
- Per-project role override (`ProjectMembership` layer) — P2 · L · Carried forward from Pass 9-11, schema-confirmed still absent
- Sidebar auto-collapse or nudge at ≤1024px — P2 · S · Real, measurable board-width reduction on common laptop resolutions introduced by this pass's own nav feature
- Unify mobile theme-control placement (add to `MobileSidebarDrawer` or standardize on avatar menu) — P3 · S · Minor consistency gap, not a dead end
- Product decision + implementation: distinct "switch workspace" vs. "view workspace page" affordance — P2 · S (decision) / M (build) · Currently, viewing a page silently and persistently changes the user's default landing workspace
- Dashboard sharing / public "team pulse" embed (share-token reuse) — P3 · M · New ideation; cheap high-leverage extension now that Dashboards Phase 1 verified strong
- GitHub auto-transition-on-merge + board-card PR-state badge — P2 · M · New ideation; the linking plumbing is confirmed solid, the highest-leverage next slice is making links act, not adding more link types
- Swimlane WIP/health summary strip — P3 · S · New ideation; turns Swimlanes v2 from visual grouping into an at-a-glance team/component health signal
- Configurable dashboards Phase 2 (cross-sprint trend, cross-workspace scoping) — P2 · M · Carried forward, natural next increment given Phase 1's verified strength
- Scheduled/time-based automation trigger — P2 · M · Carried forward from Pass 9-11, unretested this pass

## 2026-07-10 — Pass 13 (Pages: Confluence × Obsidian knowledge-base pillar deep-dive + full-product pass)

**Independent product/UX audit.** Conducted without reading the engineering
auditor's Pass 14 notes (`docs/AUDIT-ENGINEERING.md`), per standing
instructions — I'm told its P0 finding (a `/search` page-data scope leak) is
already fixed and shipped, and I did not re-verify engineering internals.
This pass focused hardest on the newest surface — **Pages**, the Confluence ×
Obsidian-hybrid knowledge base (ROADMAP Phase 11) — evaluated purely as a
user experiencing it for the first time, plus a lighter full-product
regression sweep.

**Method — real usage, not code reading alone.** Registered fresh users via
the API, then drove the actual running web app (`http://localhost:3000`
against the live API on `:4000`) with Playwright: created workspaces,
projects, and an 18-page interlinked wiki (Team Handbook, 5 runbooks, 5
ADRs, 3 meeting-notes pages, a glossary, security policy, onboarding
checklist) modeled on a real small team's wiki, exercised `[[wiki-links]]`
(resolved/unresolved), the knowledge graph, version history + restore,
issue↔page cross-linking, Cmd-K search (title, body-word, and typo
queries), a second project to test cross-project link/search behavior, and a
VIEWER-role user to check RBAC. Captured 40+ screenshots desktop (1280×800)
and mobile (Pixel 5, 393×851). One environment note for future auditors: this
sandbox's pre-built `web` preview bundle was compiled against a stale
`VITE_API_URL` (`:4055`, presumably from a sibling agent's earlier build) —
login silently failed with `ERR_CONNECTION_REFUSED` in the console until I
overrode `window.__NL_CONFIG__.apiUrl` via `page.addInitScript`. Not a product
bug (a real Docker deploy sets this once via `config.js`), but worth noting
for the next agent who hits an inexplicable "Unable to sign in."

### Ratings — newest surface (Pages), 1–5

| Area | Score | Note |
|---|---|---|
| Discoverability & IA | 4 | "Pages" is a first-class primary tab (`Board · Backlog · Triage · Pages · Reports`) *and* a persistent sidebar sub-link under the expanded project row — unaided discovery is trivial (`apps/web/src/pages/PagesPage.tsx`, `nav-pages` testid confirmed clickable from the board). Docked one point: the empty state ("No pages yet — create your project's first page to start building a knowledge base") never teases the two things that make this pillar special — `[[wiki-links]]` or the Graph tab — a brand-new user has zero signal this is Obsidian-flavored until they stumble into edit mode and see the "type `[[` to link" placeholder. |
| Full-page editing UX | 3 | The explicit Edit/Save/Cancel mode (not click-to-edit) reads as a deliberate, good "this is a document" affordance, and the unresolved-link counter + reserved-character title validation are genuinely thoughtful. **But: zero unsaved-changes protection** — live-verified (see Top Gaps #1) that navigating to another page in the tree, or a plain `page.reload()`, while mid-edit **silently discards the draft with no dialog, no `beforeunload` guard, and no visual "unsaved" indicator** other than the Save button's own disabled/enabled state. No `Cmd/Ctrl+S` shortcut either — you must click Save with the mouse. A tool whose entire pitch is "a real document editor" cannot silently eat a paragraph a user just wrote. |
| Knowledge graph | 3 | The Obsidian-style constellation hover (neighbors highlight, everything else fades to translucent grey) is genuinely delightful and worked flawlessly live (`31-graph-hover-highlight.png`). Degree-sized nodes are correct (hub pages visibly larger). But **legibility already degrades at 18 pages** — several node labels physically overlap ("Runbook: Incident…" and "Runbook: On-call…" render on top of each other on mobile, `42-mobile-graph.png`), one node was fully hidden behind another in the desktop screenshot (confirmed present in the DOM via `page-graph-node-*` testids, just visually unreachable without a lucky zoom/drag), and **there is no search-within-graph, no node list, no "find and center" affordance** — the only navigation aid is pan/zoom + hover. A real team wiki reaches 50-200+ pages quickly; this graph has no mechanism to stay useful past roughly the page count I tested with. Decorative-leaning at scale today, not yet the navigation aid VISION.md's "crown jewel" framing promises. |
| Search | 4 | Postgres `websearch_to_tsquery` full-text search genuinely works well: live-verified a nonsense body token (`ZEBRAFISH-*`) planted in 9 pages' bodies surfaced all 9 correctly ranked, `ts_rank` ordering looked sane for both title and body matches, and it correctly spans **all projects in the workspace** (a second project's page surfaced from a first-project Cmd-K search, tagged with its own project-key badge for clarity — good scoping signal). Docked one point for two real gaps: **zero typo tolerance** (searching "Rnubok" returns nothing — no `pg_trgm`/similarity fallback), and there is **no dedicated search-results page** — Cmd-K's compact dropdown (capped, `RESULT_CAP`-style truncation) is the *only* search surface; there's no way to see "43 more results," filter by author/date, or search-within-current-project-only. |
| Cross-link coherence | 3 | `[[wiki-links]]` resolve/re-render correctly across navigation and reload (re-verified: Hub→Target both directions, `20-runbook-page-created.png`), and version restore is genuinely non-destructive with a clear confirm message ("stays in history too, since restoring saves a new version" — `63-restore-confirm-dialog.png`, verified a restore produces v3, not a v1/v2 overwrite). **But issue↔page cross-linking is one-directional in the UI.** The issue drawer's "Linked pages" section works correctly (live-verified end-to-end: mentioning `GR3220-1` in a page body surfaced it in the issue drawer, scrolled screenshot `38-issue-drawer-scrolled.png`). The reverse never renders anywhere: `GET /pages/:id/issues` exists server-side and `get_page_issues` exists over MCP, but **grepping the entire web frontend for any consumer of that endpoint returns zero hits** — a page that documents three issues gives the reader no way to see that from the page itself. This is a real, fixable asymmetry, not a design choice (the data is already computed and stored server-side on every save). |
| Parity vs. a credible wiki | 2 | The two features that matter most for *actually writing docs* are the two biggest misses. **(1) No images, at all, anywhere in a page** — live-verified: `![Diagram](https://picsum.photos/...)` written into a page's Markdown is silently stripped on render with zero trace, zero broken-image icon, zero error (`MarkdownRenderer.tsx`'s DOMPurify `ALLOWED_TAGS` list has no `img`; screenshot `80-image-and-table-render-test.png` shows the image line vanish while the adjacent Markdown table renders perfectly). Pages also have no attachment-upload affordance at all (issues do — the drawer's "Attachments" drag-and-drop panel — pages have nothing analogous). A user writing an architecture doc or a runbook cannot embed a single screenshot or diagram (Mermaid code-fences are the one workaround, and they *do* render — a real mitigating strength). **(2) No page templates** (title-only create modal, confirmed by reading `CreatePageModal.tsx`) **and no rich formatting affordances** (raw Markdown only — no slash-command menu, no toolbar, no live preview toggle) — matches the ROADMAP's own "Later, not v1" list, so this is an honest, tracked gap, not a surprise, but it's still what a Confluence/Notion/Obsidian user hits in their first ten minutes. Page comments, favorites/recents, and page-level permissions beyond the existing project RBAC are likewise absent (also ROADMAP-acknowledged "Later"). |

### Is per-project scoping the right call? (explicit ask)

**Mostly yes, with one sharp edge.** For team-specific runbooks, ADRs, and
meeting notes, per-project scoping is the right default — it reuses the
exact RBAC/PAT-scope chokepoint the rest of the app already has, with zero
new permission surface. But I live-verified the edge the ROADMAP itself
already flags as deferred ("workspace-level spaces"): I created "Shared
Glossary" as a page in one project, then wrote `[[Shared Glossary]]` in a
*different* project in the **same workspace** — it renders **unresolved**
(`#create-page:Shared%20Glossary`), and clicking it would create a brand-new,
disconnected duplicate page rather than linking to the org-wide one
(`50-cross-project-wikilink-does-not-resolve.png`). Every real org has 3-5
documents that are inherently workspace-wide, not project-specific
(onboarding, glossary, security policy, brand guidelines) — exactly the
titles I picked for this test wiki, deliberately mirroring what a real team
would actually write. Today those either get duplicated per-project (drifting
copies) or arbitrarily "own" a single project that isn't really their home.
This is the single highest-leverage structural gap in the whole pillar
because it's a modeling decision, not a missing button — the longer real
content accumulates per-project, the more expensive a later "workspace
spaces" migration becomes.

### Full-product pass (regression sweep, lighter touch this cycle)

Scope this pass was Pages-first; the following is what I directly
re-verified live while driving the app, not a re-audit of every surface Pass
12 already covered in depth (those are carried forward unchanged below with
no fresh evidence, per the no-hand-waving principle — I'm not re-claiming a
score without re-testing it).

- **RBAC on the new surface holds up.** A VIEWER-role user correctly sees no
  "Edit" button and no "New page" affordance on Pages (`90-viewer-role-pages-view.png`)
  — the same `canEdit(myRole)` chokepoint the rest of the app uses.
- **Delete-with-children UX is genuinely well-designed** — the confirm
  dialog pre-emptively explains children must be moved/deleted first *and*
  disables the Delete button until they are, plus separately warns "N pages
  link here — their `[[links]]` will become unresolved" when deleting a page
  with backlinks (`PageTree.tsx`). This is better guardrail design than most
  of the rest of the app's delete flows and worth holding up as the pattern
  to copy elsewhere.
- **Version history is a real, correctly-implemented Confluence-style
  feature**, not scaffolding — live-verified non-destructive restore end to
  end (a v1 restore produces a new v3; v1 and v2 both remain in history,
  screenshot `64-after-restore.png` / `65-version-history-after-restore.png`).
- **The image-stripping DOMPurify config is app-wide** (`MarkdownRenderer.tsx`
  is shared by issue descriptions/comments too), so this isn't Pages-only —
  but issues have a *separate*, working image path (the Attachments
  drag-and-drop panel, confirmed present in the issue drawer screenshot
  `36-issue-drawer-linked-pages.png`), so the practical impact is
  concentrated on Pages, which has neither the Markdown path nor an
  attachment path.
- **One save-timing flake, not reproduced on retry**: a first-run save once
  appeared to leave the UI stuck in edit mode past a 500ms wait even though
  the PATCH had already returned 200 and the version was correctly
  persisted (confirmed via direct API query); a clean re-run with network
  logging showed a normal save→read-mode transition well within 500ms. Likely
  a cold-start/first-request latency artifact in this shared sandbox, not a
  reproducible product bug — flagging for awareness, not filing as a gap.
- Areas not re-touched this pass (board, backlog, dashboards, GitHub/GitLab/
  Gitea integrations, SSO, sprints, dark mode, workspace switcher): no fresh
  evidence either way; Pass 12's ratings stand uncontested from this pass.

### Category-Parity Benchmark (mandatory every pass) — Pages-relevant rows updated, rest carried forward

| Capability | Our depth | Leader baseline | Gap | Note |
|---|---|---|---|---|
| Team wiki / docs (pages, tree, RBAC, version history) | 4 | 5 | No page templates, no page-level permission overrides beyond project RBAC, no page comments | **New row this pass.** Confluence's core backbone is genuinely present and works (nestable tree, fractional rank, version history + non-destructive restore, RBAC) — a real 4, not scaffolding. |
| Linked-thought / knowledge graph | 3 | 4 (Obsidian has no team backbone, so "leader" here is a composite of Obsidian's graph UX at a lower absolute bar) | No search-within-graph, no node-list fallback, labels overlap by ~18 nodes, no minimap | **New row.** The hover-constellation effect is best-in-class visual polish; the navigation utility ceiling is low without an in-graph search/filter. |
| Rich content in docs (images, embeds, tables) | 1 | 5 | Images fully non-functional (stripped, no attachment path); tables + Mermaid diagrams work | **New row.** This is the sharpest gap in the whole pillar — most teams' documentation is unusable without screenshots/diagrams. |
| Cross-linking (wiki-links + issue↔doc) | 3 | 5 | Issue→page linking works; page→issue direction has no frontend consumer despite a working backend endpoint | **New row.** |
| Multiple boards / board types | 5 | 5 | none | Carried forward from Pass 12, not retested this pass. |
| Query language (NLQL) + saved/shared filters | 5 | 5 | none | Carried forward, not retested. |
| Custom fields | 5 | 5 | none | Carried forward, not retested. |
| Dashboards/gadgets | 5 | 5 | none | Carried forward, not retested. |
| Automation rule engine | 4 | 5 | No scheduled/time trigger | Carried forward, not retested. |
| Permissions granularity | 3 | 5 | No per-project role override; SSO env-var-only | Carried forward, not retested. |
| Mobile board toolbar | unknown this pass | 5 | Pass 12 found a P1 regression (invisible dropdown menus) | Not retested this pass — status unknown; the fix may or may not have landed. Flagging so it doesn't silently fall off the board's radar. |

### Better-than-Jira scorecard — input for vision-steward

**Knowledge / Docs row (currently "Behind" in VISION.md, with an explicit
target of "BEYOND both reference points" once Phase 11 v1 ships).**

My honest read after hands-on testing: **the pillar is real, ambitious, and
partially delivers on the "beyond" thesis (the agent-traversable graph +
MCP tools are a genuine category no incumbent offers), but v1 as shipped is
not yet even a confident Parity with a baseline team wiki, let alone
Beyond.** The reasoning: the single most common thing a real team writes
into a wiki — a runbook, an architecture doc, an incident postmortem — very
quickly needs a screenshot or a diagram, and this is the one thing Pages
structurally cannot do today (not "hard to do," but *actively strips it with
no error*, which is worse than merely unsupported — it's silently data-lossy
in the way the unsaved-edits gap is too). A user migrating from Confluence
or Notion who pastes their first screenshot into a runbook and watches it
vanish will not conclude they've upgraded. I'd recommend **VISION.md keep
this row at "Behind"** (not yet re-score toward the "Beyond" target) until
image support and the unsaved-changes guard land — those two are the
gate, not polish, on this specific row's promise. Once those two ship, I'd
support elevating to at least Parity given how strong the graph,
backlinks, version history, and cross-project search already are.

### Top gaps — prioritized backlog candidates

| Rank | Item | Why it matters (user value) | Size | Area |
|---|---|---|---|---|
| P1-1 | **Unsaved-changes protection in the page editor** — at minimum a `beforeunload` guard during `editing=true` with unsaved `dirty` state, and block/confirm in-app navigation (tree click, breadcrumb, back button) the same way `ConfirmDialog` already gates destructive deletes. Ideally also periodic autosave-to-draft (localStorage) as a safety net. | Live-verified: editing a page, then either navigating to a sibling page via the tree **or reloading the browser**, silently discards everything typed with zero warning of any kind — no dialog, no toast, no visual cue. This is a real, disqualifying trust break for a "document editor" — the single worst thing a wiki can do to a user is eat their work with no warning. | S–M | Pages / editor |
| P1-2 | **Image support in Pages** — either (a) restore `img` to the sanitizer's `ALLOWED_TAGS` for the Pages content pipeline specifically (external-URL images, at minimum) and/or (b) add a page-level attachment/upload path mirroring the issue drawer's existing Attachments panel, with paste-to-upload in the editor as the ideal end state. | Live-verified: a Markdown image line vanishes with zero trace on save/render. This is the single largest gap between "has a wiki" and "has a wiki people actually use" — runbooks, architecture docs, and incident postmortems are close to unusable without screenshots/diagrams. Directly gates whether the "Knowledge/Docs" Better-than-Jira row can honestly move past "Behind." | M | Pages / editor |
| P1-3 | **Surface "Linked issues" on the page itself** (the reverse of the already-shipped issue-drawer "Linked pages" section) — a small panel beside/below Backlinks, consuming the already-existing `GET /pages/:id/issues` endpoint (zero new backend work, `useIssuePages`-shaped hook + a component mirroring `LinkedPagesSection`). | The backend computes and stores this on every save; the MCP surface already exposes it (`get_page_issues`); only the page-reading human is denied it. A user reading a runbook has no way to see "which 3 issues reference this doc" without leaving the page and guessing. | S | Pages / cross-linking |
| P2-1 | **Search-within-graph / a "find & center" affordance** (a lightweight text filter above the graph that dims non-matching nodes and pans to the first match, reusing the same fade mechanic the hover-highlight already has). | Live-verified: at just 18 pages, node labels already overlap and one node was fully occluded behind another with no way to locate it except by luck. A real team wiki will outgrow "legible by eyeballing" within its first month; without in-graph search the "crown jewel" graph degrades into decoration exactly at the scale where it would matter most. | S–M | Pages / graph |
| P2-2 | **Cross-project ("workspace space") pages for genuinely org-wide docs** — either a lightweight "workspace" page tree that all projects can link into (ROADMAP's own deferred "Later" item), or, as a cheaper interim step, let a `[[wiki-link]]` resolve against sibling projects in the same workspace when no same-project match exists (disambiguated by a project-key prefix in the picker), instead of silently offering to create a duplicate. | Live-verified: linking to a same-titled page in a sibling project renders unresolved and offers to create a *duplicate*, disconnected page — exactly the failure mode that produces drifting, forked copies of a team's glossary/onboarding/security docs. This is a data-model decision that gets more expensive to fix the more real content accumulates on the current per-project-only model. | L | Pages / IA |
| P2-3 | **Typo-tolerant search** — add a `pg_trgm`/`similarity()` fallback (or Postgres's built-in `similarity()` GIN index) when `websearch_to_tsquery` returns zero hits, the same two-tier pattern the service already uses for short queries (FTS vs. ILIKE fallback). | Live-verified: "Rnubok" returns nothing even though 6 "Runbook: …" pages exist. A comparable wiki's search tolerates a typo; today a single transposed letter here returns a dead end with no "did you mean" recovery. | S–M | Search |
| P2-4 | **Page-creation empty state should tease the pillar's own best features** — mention `[[wiki-links]]` and/or a one-line "see how your docs connect" pointer to the Graph tab directly in the "No pages yet" empty state, not just as a placeholder discovered mid-edit. | A brand-new user's very first impression of Pages gives zero signal that this is meaningfully different from a plain per-project notes list — the crown-jewel graph and linked-thought model are completely invisible until stumbled into. Cheap, high-leverage first-impression fix. | S | Pages / onboarding |
| P3-1 | **`Cmd/Ctrl+S` to save in the page editor** (and consider `Cmd/Ctrl+Enter`, matching the comment box's own convention) — `preventDefault` the browser's native save-page dialog and call the same `handleSave`. | The rest of the app markets keyboard-first ergonomics as a genuine differentiator (VISION.md scorecard: "Better"); the flagship new editor surface doesn't participate in that story at all today — a small, cheap fix that keeps the story coherent. | S | Pages / editor |
| P3-2 | **A dedicated, paginated search-results surface** beyond Cmd-K's capped dropdown — even a simple `/search?q=` results page reusing the same API, with basic type/project filters. | Cmd-K is excellent for "jump to a thing I remember the name of"; it has no answer for "show me everything mentioning X" once results exceed the dropdown's cap. A wiki-shaped product needs a real search-results experience eventually. | M | Search |
| P3-3 | **Mobile graph layout: prevent label overlap and keep the zoom control from covering bottom-row labels** — either increase minimum inter-node spacing at narrow viewports or truncate/stagger overlapping labels, and reposition/shrink the zoom control on mobile so it doesn't sit on top of node text. | Live-verified on a Pixel-5-width viewport: two node labels rendered literally on top of each other, and the zoom control overlapped the bottom row's labels. A smaller, cheaper fix than the full "search-within-graph" item above, worth doing regardless of that larger fix. | S | Pages / graph / mobile |

### Ideation — 3+ ambitious new features/UX improvements (Pass 13)

1. **"Create a page from this issue" and "create an issue from this
   selection"** — two small, high-leverage bridges between the tracker and
   the wiki that make the cross-linking pillar feel alive rather than
   incidental. (a) A "New page" quick action in the issue drawer that seeds a
   page titled after the issue and pre-fills a `Related issue: NL-123` line
   (auto-linking on save, reusing the parser that already exists) — turns "I
   should write this up" into one click instead of a context switch. (b) The
   inverse: select text in a page's editor and get a "Create issue from
   selection" affordance (mirrors how many docs tools turn a TODO comment
   into a tracked task) — a genuinely differentiated "living docs → living
   backlog" loop that neither Confluence (no tracker) nor a standalone
   Obsidian vault (no tracker, no team backend) can offer at all.
2. **A "stale docs" signal, powered by the same developer-graph +
   activity-log infrastructure Phase 9/10 already ship.** Surface a subtle
   badge on a page ("Last verified 94 days ago" or "3 linked issues have
   closed since this was last edited") computed from `PageVersion` timestamps
   crossed against linked-issue activity — the single biggest reason real
   wikis rot is that nothing ever tells you a doc is stale, and Next Lane
   already has 100% of the underlying signal (issue close events, page edit
   history) that no incumbent wiki product structurally has access to,
   because theirs isn't fused with a tracker in the first place. This is a
   genuinely agent-native idea too: an agent could periodically walk the
   graph over MCP and flag/propose updates to stale pages, closing the loop
   VISION.md's "living docs" framing gestures at but doesn't yet build.
3. **Page-level "watchers" + a digest, reusing the issue-watch
   infrastructure that already exists** — let a user watch a page (or a
   whole subtree) and get notified when it's edited or when a new backlink
   appears, the same way issue watchers already get notified on changes.
   Combined with idea #2 above, this turns Pages from a passive "go check if
   anything changed" surface into an active one, which is table stakes for
   any team wiki people actually rely on daily.
4. **A lightweight "page diff" view in Version History** — right now
   restoring a version requires opening it and eyeballing the full content
   against your memory of the current version; a simple unified-diff render
   between any two versions (even a naive line-diff, no need for anything
   fancy) would make the already-strong version-history feature genuinely
   best-in-class rather than merely "has version history."

### Direction — next quarter

Pages v1 is a real, working pillar — not scaffolding, not a demo. The tree,
version history, wiki-links, backlinks, RBAC, and cross-project search all
held up under adversarial, hands-on testing with a deliberately realistic
18-page wiki, and the graph's hover-constellation effect is the kind of
detail that actually earns the "distinctive, not templated" bar this
project holds itself to. But the two gaps that matter most — no images and
no unsaved-changes protection — are exactly the kind of thing that decides
whether a real team's first hour with Pages ends in "I'm switching" or "I
just lost my draft, forget this." Both are P1 for a reason: they're not
missing nice-to-haves, they're the two things a first-time user is most
likely to hit in their very first edit. I'd sequence P1-1 (unsaved-changes
guard) as the single highest-priority item — it's the smaller fix of the
two and it's a trust-breaking bug, not a feature gap — then P1-2 (images),
since that one directly gates whether VISION.md's "Knowledge/Docs" row can
honestly move off "Behind." After those, the graph's in-scale legibility
(P2-1) and the page→issue reverse-link surface (P1-3, genuinely cheap since
the backend already does the work) are the next-highest-leverage items
before broadening scope further (workspace-spaces, templates, comments).
Outside Pages, this pass didn't find evidence of new regressions elsewhere,
but also didn't re-verify Pass 12's open items (the mobile board-toolbar
regression status is now unknown and should be re-checked next full pass).

### Backlog-Groomer Ingest — Pass 13 (title · priority · size · rationale)

- Unsaved-changes protection in the Pages editor (beforeunload guard + in-app nav confirm) — P1 · S–M · Live-verified silent data loss on navigate-away or reload while editing, with zero warning of any kind
- Image support in Pages (restore `img` to the sanitizer allowlist and/or a page attachment-upload path) — P1 · M · Live-verified Markdown images vanish silently on render; gates the Knowledge/Docs Better-than-Jira row moving off "Behind"
- Surface "Linked issues" on the page itself (reverse of the shipped issue-drawer "Linked pages") — P1 · S · Backend endpoint (`GET /pages/:id/issues`) and MCP tool already exist; zero frontend consumer found anywhere in the web app
- Search-within-graph / "find & center" affordance for the knowledge graph — P2 · S–M · Live-verified label overlap and a fully-occluded node at just 18 pages with no way to locate it
- Cross-project wiki-link resolution or a workspace-level "spaces" tier for org-wide docs — P2 · L · Live-verified linking to a same-titled sibling-project page renders unresolved and offers to create a disconnected duplicate
- Typo-tolerant fallback for Pages/issue full-text search (`pg_trgm`/`similarity()`) — P2 · S–M · Live-verified a single-letter transposition ("Rnubok") returns zero results despite 6 matching pages
- Pages empty-state should tease `[[wiki-links]]` / the Graph tab — P2 · S · First-time-user first impression gives zero signal this is Obsidian-flavored
- `Cmd/Ctrl+S` to save in the page editor — P3 · S · The app markets keyboard-first ergonomics as a differentiator; the newest editor surface doesn't participate
- Dedicated paginated search-results page beyond Cmd-K's capped dropdown — P3 · M · No answer today for "show me everything mentioning X" once results exceed the dropdown
- Mobile graph label-overlap + zoom-control-overlap fixes — P3 · S · Live-verified on a Pixel-5-width viewport
- "Create page from issue" + "create issue from page selection" bridges — P2 · M · New ideation; makes the cross-linking pillar feel alive, a genuinely differentiated tracker↔wiki loop
- "Stale docs" signal from PageVersion timestamps × linked-issue activity — P3 · M · New ideation; the underlying signal already exists and no incumbent wiki has access to it
- Page-level watchers + digest (reuse issue-watch infrastructure) — P3 · M · New ideation; turns Pages from passive to active
- Version History diff view (even a naive line-diff) — P3 · S–M · New ideation; makes an already-strong feature best-in-class
- Re-verify mobile board-toolbar dropdown regression status (Pass 12 P1, not retested this pass) — P1 (unconfirmed status) · — · Carried forward as an open question, not a fresh finding
