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
