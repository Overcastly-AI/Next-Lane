# Features

This page describes the headline features of Next Lane that are live in the
current build. For the full status of shipped and planned work see
[`docs/ROADMAP.md`](https://github.com/Overcastly-AI/Next-Lane/blob/main/docs/ROADMAP.md).

---

## Boards

Next Lane supports multiple boards per project. Each board is independently
configured.

**Board types:**

- **Kanban** — continuous flow; cards move between columns as work progresses.
- **Scrum** — sprint-based; cards are planned into a sprint and the board shows
  the active sprint.

**Key capabilities:**

- Drag and drop cards between columns with fractional-index ordering (no full
  column renumber on every move).
- Custom statuses and columns per project — add, rename, and reorder them in
  Project Settings.
- Board switcher (multiple boards per project; switch with the top-left picker).
- **Live presence** — avatars show who else is currently viewing the board,
  updated in real time via Socket.io.
- **Conditional card colors** — define color rules (driven by NLQL conditions)
  that highlight cards matching criteria. Example: highlight all blocking issues
  in red.
- Pin a board to a **saved filter** so it always shows a filtered view.

![Board view](/screenshots/board-desktop.png)

---

## Issues

Issues are the core unit of work. Every issue belongs to a project and has:

- **Type:** Task, Bug, Story, Epic, Sub-task
- **Title, description** (Markdown rendered)
- **Status** (maps to a project column), **priority**, **assignee**, **reporter**
- **Labels**, **story points**, **due date**, **component**, **version/release**
- **Custom fields** — project-defined typed fields (Text, Number, Select, …);
  values are stored per-issue in JSONB
- **Comments** and an **activity log** (every field change is recorded)
- **File attachments**
- **Issue links** — directed relationships: BLOCKS, RELATES_TO, DUPLICATES,
  IS_BLOCKED_BY, and more
- **Watchers** — watch an issue to receive in-app notifications when it changes
- **Parent/child** — epics contain stories; stories contain sub-tasks

The issue detail drawer opens in-panel without leaving the board.

![Issue detail drawer](/screenshots/drawer-desktop.png)

---

## NLQL query language

NLQL (Next Lane Query Language) is a structured filter language for issues.
It powers saved filters, board filtering, and the automation engine's conditions.

**Example queries:**

```
assignee = me()
priority in (High, Highest) AND status != Done
label = "backend" AND sprint = active()
due < 7d AND assignee = me()
type = Bug AND created > 14d
```

**Operators:** `=`, `!=`, `in`, `not in`, `<`, `>`, `<=`, `>=`

**Special functions:** `me()` (current user), `active()` (active sprint),
`today()`, relative durations (`7d`, `30d`)

**Fields:** `assignee`, `reporter`, `status`, `priority`, `type`, `label`,
`sprint`, `component`, `version`, `due`, `created`, `updated`, `storyPoints`,
`parent`, and custom field keys.

### Saved filters

Save any NLQL query with a name and optionally share it across a project. Saved
filters appear in the filter picker and can be pinned to boards.

---

## Automation engine (Glass Box)

The automation engine lets you define **trigger → condition → action** rules
that run automatically when events occur.

**Triggers:**

- Issue created
- Issue status changed
- Issue assigned
- Issue priority changed
- Comment added

**Conditions** (optional, NLQL-based):

```
priority in (High, Highest) AND label = "customer-reported"
```

**Actions:**

- Change status
- Change assignee
- Change priority
- Add or remove a label
- Post a comment

**Glass Box run log:** every rule execution is recorded — the trigger event,
which conditions were evaluated (and whether they passed), and what actions were
taken. The log is viewable in the Automations tab. Nothing runs silently.

Automation runs are unlimited because they execute on your own hardware.

---

## Planning poker

Real-time estimation sessions for Scrum teams.

1. A facilitator starts a poker session from the Sprint or Backlog view.
2. Participants join and vote privately on story-point estimates.
3. The facilitator reveals all votes simultaneously.
4. The team discusses and the facilitator records the agreed estimate back to
   the issue.

Votes sync in real time via Socket.io — no page refresh needed.

---

## Async standups

Lightweight asynchronous standups that work across time zones.

- Each team member answers: what did you do? what are you doing next? any
  blockers? — submitted via the Standups tab in any project.
- A date picker lets you navigate to any past date to review previous entries.
- Blockers can be linked to real issues (resolved to issue key + title).
- The "Prefill from my activity" button pre-populates the form from yesterday's
  ActivityLog and today's in-progress assignments.
- The team digest shows all members' entries for the selected date with blocker
  emphasis.

---

## Personal boards

Every user has a private personal board — a Kanban for todos, personal tasks,
and scratch work that is separate from project boards. Cards are visible only to
you. You can promote a personal card to a real project issue (Task) with one
click via the "Promote to issue" action.

---

## Reports and analytics

**Per-project reports:**

- **Burndown chart** — remaining story points vs. time for the active sprint.
- **Velocity chart** — story points completed per sprint over time.
- **Cumulative flow diagram (CFD)** — issue counts per status category over time.
- **Timeline / roadmap view** — Gantt-style view of issues with due dates.

**Personal analytics:**

- Issues completed over time, story points delivered, cycle time.
- Accessible at `/me/analytics`.

**Team analytics:**

- Aggregate throughput and velocity for a team.
- Team pulse — recent activity across all team members.

---

## Search

- **Full-text search** powered by Postgres `tsvector` columns with GIN indexes.
  Searches issue titles, descriptions, and comments.
- **Cross-project search** — search across all projects in a workspace.
- **Command palette** (Cmd/Ctrl + K) for fast navigation to any issue, project,
  or board.
- Multi-field filtering (assignee, status, priority, labels, sprint, custom
  fields) on board and backlog views.

---

## Bulk edit

Select multiple issues in the Backlog or Triage view with checkboxes, then use
the sticky action bar to bulk-update:

- Assignee
- Status
- Priority
- Labels
- Sprint

---

## CSV export

Download all issues in a project as a CSV file from the board or backlog view.
The export includes all standard fields and custom field values.

---

## Workspace branding

Admins can customize the workspace appearance:

- **Name** — displayed in the header and browser tab.
- **Accent color** — applied as a CSS variable token across the entire UI at
  runtime (no rebuild required).
- **Logo** — uploaded and served directly by the API; displayed in the app header.

Branding is per-workspace and applies to all members.

---

## Notifications and mentions

- In-app notifications for: issue assignments, @mentions in comments, watcher
  events (status change, new comment).
- @mention any workspace member in a comment — they receive a notification.
- Notification badge in the app header; click to see the full list.

---

## Webhooks

Outbound webhooks deliver issue events to external systems (CI, chat, custom
integrations).

- HMAC-signed payloads (verify with the shared secret).
- SSRF guard enabled by default — webhooks cannot reach private/loopback IP
  ranges unless `WEBHOOK_ALLOW_PRIVATE=true` is explicitly set.
- Durable delivery via BullMQ (retries with backoff) when Redis is configured.

---

## Auth and roles

- Email/password authentication with JWT access tokens.
- **Personal API tokens (PATs)** — generate long-lived tokens for scripting
  and agent access. Manage them in Profile Settings.
- **Roles per workspace:** Admin, Member, Viewer.
- Password reset via SMTP email (link logged to the API console in dev mode
  when SMTP is not configured).
- **Workspace audit log** — admin-viewable log of member actions.
