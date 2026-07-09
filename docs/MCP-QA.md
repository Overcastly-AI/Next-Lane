# MCP-Consumer QA — Agent Experience (AX) passes

Findings from driving Next Lane exactly the way an external AI agent does:
`@next-lane/mcp` over stdio, real JSON tool calls, bytes and call-counts
measured per answer. Maintained by the `mcp-consumer-qa` agent
(`.claude/agents/mcp-consumer-qa.md`). Tools-only interaction; REST is used
only to *prove* a coverage gap and is always labeled as such.

---

## Pass 1 — 2026-07-03

**Scope.** (a) Acceptance of the AX batch (commits `bb6bec9` + `9313d14`:
NLQL `query` on `list_issues`, compact-default + `limit`/`offset`/`verbose`,
`create_issue` project echo + `expectedProjectKey` guard, `get_epic_overview`,
`startDate` end-to-end). (b) Acceptance of agent-context memory (`8ffc160`:
server instructions, `get_project_context`/`update_project_context`,
staleness, 64 KB cap, `skills/project-context`). (c) A fresh end-to-end PM
engagement to surface the next round of frictions.

**Method.** Built `apps/mcp` from the committed tree (dist @ commit
`8ffc160`), drove it via a stdio MCP client (`@modelcontextprotocol/sdk`
1.29.0), JWT bearer auth as `demo@nextlane.dev`, API on `:4000`. Engagement:
project **AXQ1** ("Payments Launch QA-Pass1 70311") — 1 epic + 14 children,
sprint, 3 labels, 5 blocks-links, statuses worked, 2 deliberate mistakes
corrected, then interrogated with natural PM questions. ~70 tool calls total,
every response byte-counted. (One caveat: a concurrent builder restarted the
API mid-pass; every measurement except the final staleness-increment
differential ran against the committed API build, and that differential
corroborates evidence already collected on the committed build.)

### Verdicts on the five AX-batch fixes

| Fix | Verdict | Evidence |
| --- | --- | --- |
| NLQL `query` on `list_issues` | **PASS** | `status = "In Progress" AND assignee = me()` → correct 1 item, **330 B**. `ORDER BY priority DESC` works. Parser errors are precise: `Invalid NLQL query: Expected a value after '=' at position 7`; unknown field → `Unknown field 'frobnicate'`. (But see finding 1 — two field families silently lie.) |
| Compact default + limit/offset/verbose | **PASS** | Whole-project compact list (15 issues): **3,399 B ≈ 227 B/issue** vs verbose **1,863 B/issue** (8.2×). Old field report: 150 KB/44 ≈ 3.4 KB/issue → compact is **~15× smaller per issue**. Envelope `{items,total,limit,offset,hasMore}` consistent; `total`+`hasMore` correct on 252 workspaces / 126 users. |
| `create_issue` echo + `expectedProjectKey` | **PASS** | Wrong key → **185 B** error naming both sides: `expectedProjectKey "PAYX" does not match the target project "AXQ1" (Payments Launch QA-Pass1 70311, id cmr4d…). No issue was created.` — verified nothing written (list still empty). Case-insensitive (`axq1` accepted). Every create echoes `project: {id, key, name}` — the deliberate misfile into Q2559509 was instantly visible in the response key. |
| `get_epic_overview` | **PASS** | Epic + 14 children + `statusBreakdown` + `progress {done,total,fraction}` in **one call, 3,054 B**. Works on childless issues (normal 382 B result); bogus id → clean 404. |
| `startDate` end-to-end | **PASS** | Set at create (echoed), updated via `update_issue`, filterable (`start >= "2026-07-01"` → 6 correct items), present in the compact list fields. Cross-field validation errors clearly: `startDate must be on or before dueDate`. |

### Verdict on agent-context memory (`8ffc160`)

**PASS overall** — the full handoff discipline works end-to-end as a real
MCP client:

- **Server instructions arrive at initialize** (897 B) and teach exactly the
  right loop: read `get_project_context` first, check `staleness`, update at
  milestones, hand off before ending, full-replace semantics, 64 KB cap.
- **Empty-doc first read is a normal read** (167 B, `content:""`,
  `staleness.changesSinceUpdate:0`, `contentBytes:0`) — no 404 to handle.
- **Milestone + final handoff round-trip** clean; `contentBytes` echoed on
  both read and write (837 B handoff → `contentBytes: 837`).
- **Staleness works**: 0 immediately after update; +1 after a field update,
  +1 more after a status move; after a 17-write work burst it read 8
  (it counts logged activity, not raw tool calls). *Exception → finding 5:
  comments don't count.*
- **64 KB cap**: 66,000-byte write → `content must not exceed 64 KB
  (measured in UTF-8 bytes)` — self-correctable in one retry (states the
  unit and the limit).
- **`skills/project-context/SKILL.md` consumer review**: trigger description
  is good — it names the MCP tools an agent would already be holding
  (`list_issues`, `create_issue`, boards, sprints), so it loads at session
  start/resume/wrap-up, which are the right moments. The worked example is
  concrete (real keys, a decision with a why, a gotcha) and the "Rules of
  thumb" (keys over phrasing, decisions not activity logs) are the two rules
  agents actually violate. One improvement: the skill should also warn that
  staleness does not count comments (finding 5) since it tells agents to
  trust `changesSinceUpdate` as the "verify before trusting" signal.

### New findings (this pass), ranked

**1. P1 — NLQL silently returns wrong (empty) results for the most natural
person/sprint queries.** Blocks: "what is X working on?", "what's left in
sprint N?" — the two most common PM questions after epic status.
Evidence (differentials, truth established via id-based queries):
- `assignee = "Alex Rivera"` → **0 items**; `assignee = "alex@nextlane.dev"`
  → **0 items**; `assignee = "cmqx2rt9g0001…"` → **5 items** (truth).
- `sprint = "Sprint 1 - Checkout Foundations"` → **0 items**; same by sprint
  id → **4 items** (truth).
- No error in any of the zero cases — an agent answers "Alex has nothing
  assigned" *confidently wrong in one call*.
Root cause (read-only source inspection): the shared evaluator supports
name/email resolution for `user`-kind fields (`packages/shared/src/nlql/evaluator.ts`
`resolveUserValue`, via `ctx.users`), but the server-side evaluation path used
by MCP `query` mode passes only `{currentUserId}` (`apps/api/src/issues/issues.service.ts`
`exportCsv` → `filterIssues(issueDtos, trimmedQ, { currentUserId })`), so
name/email can never resolve; and `sprint` is declared `kind: 'id'`
(`packages/shared/src/nlql/fields.ts:67`) — name matching isn't implemented
at all, while the autocomplete surface (`suggest.ts`) advertises user
name/email resolution. Fix shape: populate `ctx.users` (workspace members)
in the server evaluation context, resolve sprint names to ids at validate
time — or, minimum bar, make `user`/`id`-kind comparisons against a value
that resolves to no known entity a 400 ("unknown user 'Alex Rivera'; use an
id from list_users or me()") instead of a silent empty set.

**2. P2 — An agent cannot bootstrap an initiative: no `create_project` (or
`create_workspace`) tool.** Blocks step 1 of any greenfield engagement; this
pass had to make one labeled REST call (`POST /api/projects`) to create AXQ1
— everything after that was tools-only. Neither is listed in the README's
deliberate "not exposed by design" section, so this reads as a gap, not a
policy. Fix shape: `create_project` (workspaceId, key, name) is
non-destructive and squarely agent-appropriate; pair with the existing echo
pattern. (If it *is* policy, document it in the exclusions list.)

**3. P2 — "What's blocked right now?" costs 1+N calls.** No NLQL field for
link state, no project-level links view, and `get_epic_overview` children
don't carry a blocked flag: the only path is `list_issue_links` per issue —
**15 calls (~1.3 KB each) for a 15-issue project**, ~N calls in general.
This is the third most natural standup question. Fix shape: a `blocked`
/`hasBlockers` NLQL pseudo-field evaluated from open BLOCKED_BY links, or an
`includeLinks: true` flag on `get_epic_overview`, or `list_issue_links`
accepting `projectId`.

**4. P2 (product-wide, not MCP-specific) — a mis-filed issue cannot be moved
to the correct project; correction = delete + recreate.** `update_issue` has
no project field (the API's update DTO explicitly excludes `projectId`, and
no web-UI surface moves issues across projects either — Jira has "Move").
Measured correction path for the deliberate misfile: `delete_issue`
(Q2559509-10) + `create_issue` (AXQ1-6) = 2 calls, **losing history/comments
/links and the original key**. The `expectedProjectKey` guard prevents this
prospectively (and worked — see verdicts), but recovery after the fact is
lossy. Fix shape: a guarded `move_issue_to_project` (re-key, keep history),
or document the delete+recreate reality in `delete_issue`/`create_issue`
descriptions.

**5. P3 — Comments (and worklogs/checklist changes) do not increment context
`staleness.changesSinceUpdate`.** Measured: `add_comment` after a handoff →
staleness stayed 0 and `lastProjectActivityAt` unchanged; `update_issue`
(priority) → +1; `move_issue` → +1. A decision-bearing comment ("Decision:
Stripe") is precisely what the next agent must not miss, and the whole point
of the staleness signal is "something happened since the handoff". Fix
shape: count comment/worklog activity rows in the staleness query (they're
already per-issue data; if ActivityLog doesn't record them, include their
`createdAt` directly).

**6. P3 — Finding a user id requires paging an unfiltered list.**
`list_users` takes only `limit`/`offset`/`verbose` — no `q`. With 126
members: up to 3 calls × ~7.3 KB to find one assignee id. Because of
finding 1, an id is *required* for person queries, making this the mandatory
first hop of "what is X working on?" (naive best case today: 2 calls +
~7.3 KB; worst: 4 calls + ~22 KB). Fix shape: `q` filter over name/email on
`list_users` (server-side or tool-side).

**7. P3 — "What changed today, by whom?" is only half-answerable.**
`query: 'updated >= "2026-07-03"'` correctly returns the touched issues
(1 call — good), but nothing exposes *what* changed or *who* did it; the
product records ActivityLog (staleness counts it) but no tool reads it.
Fix shape: `list_project_activity` (projectId, since, compact
`{issueKey, field, from, to, actor, at}`).

**8. P3 — Session-start token cost of the full toolset: 91 tools ≈ 73.7 KB
of schemas** (`tools/list`), on the order of ~18K tokens before the first
call. Not blocking (hosts cache it), but it grows with every feature per the
definition-of-done. Fix shape: consider grouped/dynamic toolsets or trimmed
descriptions for the long tail; the 10 biggest descriptions are all >500 B.

**9. P3 — README nit:** `apps/mcp/README.md` lists the `update_project_context`
row twice (back-to-back, lines 232–233).

### What worked well (marketing-grade, all measured this pass)

- **The agent-memory loop is real.** Connect → the server itself teaches the
  handoff discipline at initialize (897 B) → first read of a fresh project is
  a clean empty doc → milestone + final handoffs round-trip with byte-exact
  `contentBytes` → staleness flags post-handoff activity. No other tracker
  ships agent-to-agent memory at the protocol layer.
- **Byte discipline:** routine answers cost 81 B–3.4 KB. A whole-project
  listing that used to cost ~150 KB now costs 3.4 KB compact (~15×/issue);
  "my in-progress work" is **330 bytes**.
- **One-call answers:** epic status incl. per-status breakdown + progress
  fraction = 1 call / 3 KB; "what's left in the sprint" = 1 call / 774 B
  (with the sprint id); "updated today" = 1 call.
- **Write safety a human tool doesn't give you:** `expectedProjectKey` fails
  *before* the write with both keys named; every create echoes the resolved
  project; a cross-project `statusId` is rejected (`statusId does not belong
  to this project`); cross-field date validation is explicit. 17-call work
  burst (moves, comments, worklog, checklist, re-parent, sprint pull-in):
  17/17 clean.
- **Bulk works:** labeling 8 issues = one `bulk_update_issues` call, 34 B
  response.
- **Error quality:** every error hit this pass (11 distinct) was
  self-correctable in one retry — NLQL parser errors carry position, the
  64 KB cap states its unit, `link_issues` names the missing key.

### For the groomer

- **P1** NLQL silent-empty for `assignee = <name|email>` and `sprint = <name>`
  over the server evaluation path (finding 1) — wrong answers, not friction;
  should outrank new features. Includes concrete root cause + fix shapes.
- **P2** `create_project` MCP tool (or an explicit "by design" exclusion
  entry) (finding 2).
- **P2** One-call "what's blocked" (NLQL `blocked` pseudo-field or links on
  `get_epic_overview`) (finding 3).
- **P2** Cross-project issue move (product-wide; Jira-parity "Move issue")
  (finding 4).
- **P3s:** staleness ignores comments (5); `list_users` `q` filter (6);
  project activity read tool (7); toolset token footprint (8); README dup
  row (9).

---

## Pass 2 — 2026-07-03 (AX Round 2 surface, commits `f79268f` + `66c3f0b`)

**Scope.** Acceptance of Agent Experience Round 2: idempotency keys
(claim-first hardening), `bulk_update_issues` `parentId`/`atomic`/`dryRun`,
`update_comment`/`delete_comment` gating, `list_project_activity`, the
`expectedProjectKey` MUST-mandate (+ strict mode), context staleness counting
comments/worklogs, `list_users q`, `create_project`/`create_workspace` — plus
regression checks on every pass-1 finding.

**Method.** Built `apps/mcp` from the committed tree, drove it over stdio
(`@modelcontextprotocol/sdk` 1.29.0), two authenticated clients
(`demo@nextlane.dev` ADMIN, `alex@nextlane.dev` MEMBER), API on `:4000`.
Engagement: project **AXR2** ("Mobile App GA QA-Pass2 93204") in the seeded
workspace — 1 epic + 15 children, sprint pulled/assigned/labeled via bulk,
statuses worked, comments incl. an edited decision, worklog, two context
handoffs, then interrogated. **~113 tool calls, zero REST fallbacks** (pass 1
needed one labeled REST call to create the project; `create_project` closes
that). A second stdio server instance was launched with
`NEXT_LANE_MCP_STRICT_PROJECT_KEY=1` for the strict-mode checks.

### Verdicts on the seven AX-Round-2 criteria

| Criterion | Verdict | Evidence |
| --- | --- | --- |
| `idempotencyKey` (create_issue / add_comment) | **PASS** | Replay with same key → same issue id (AXR2-2 both times, byte-identical 1,330 B response; comment replay same id, 474 B). Same key + different payload → **409, 129 B**: `This idempotencyKey was already used with a different request payload. Use a new key for each distinct request.` — one-retry actionable. **Concurrent duplicate** (two simultaneous calls, fresh key): both return 200 with the SAME id, exactly 1 row created (loser polled the winner: 46 ms vs 279 ms; comments: 27 ms vs 266 ms). Claim-release verified: failed attempt (bogus statusId, 400) then SAME key with corrected payload → creates normally (AXR2-16); identical failing retry genuinely re-runs (400 again, not replayed as success). The `66c3f0b` hardening holds under every abuse I could construct. |
| `bulk_update_issues` parentId/atomic/dryRun | **PASS** (2 misfire notes → findings 2, 3) | Bulk-parent 14 issues to the epic, `atomic:true`: one call, **53 B** response, all 14 verified via `get_epic_overview`. `dryRun:true` → `wouldUpdate` list, verified zero writes. `dryRun+atomic+bad id` → both flags echoed, per-item `failed:[{id,reason:"Issue not found"}]` AND full `wouldUpdate` (best failure envelope on the surface). Real `atomic` + bad id → `updated:0`, nothing written (verified). `atomic` + cross-project statusId → `updated:0`, per-item `statusId does not belong to this project`, target issue confirmed unmoved. Foreign `parentId` → per-item `parentId does not belong to this project`; foreign `addLabelIds` → per-item message naming the offending label id. 101 ids → clean client-side zod rejection; zero change-fields → `changes must contain at least one field to update [HTTP 400]`. |
| `update_comment` / `delete_comment` | **PASS** | Full matrix: author edits own ✓; workspace-ADMIN edits member's ✓; MEMBER non-author edit AND delete of another's → **403, 76 B**: `Only the author or a project admin can modify this comment` — states the exact rule; bogus id → 404 `Comment not found` (35 B). Author-or-admin parity with worklogs confirmed behaviorally. |
| `list_project_activity` | **MIXED** — the shape/economics are right, the coverage is not (findings 1, 2, 5, 6) | "What happened since I last looked": **1 call, 11 items, 4,639 B** vs the pass-1 assembly path (`list_issues updated>=today` 3,137 B + `list_comments` × 15 issues ≈ 16 calls / ~18 KB) — **16× fewer calls**. Cursor pagination: 20+6 items, zero overlap, ascending, `nextCursor` round-trips. `since` filter exact; bad `since` → clear 400 `since must be a valid ISO 8601 date string`. Full 27-item history = 11.1 KB (~410 B/item). BUT: sprint/parent/label changes never appear (finding 1), status/assignee summaries are raw ids (finding 2). |
| `expectedProjectKey` mandate | **PASS** for create_issue; gap on bulk (finding 3) | Server instructions (1,389 B at initialize) carry the MUST language + strict-mode warning; tool description repeats it with the field-report rationale. Wrong key → **183 B** error naming both keys + project name + id, `No issue was created.` (verified). Strict server: omitted key → **212 B** hard error, nothing created; lower-case `axr2` accepted (case-insensitive). |
| Context staleness counts comments+worklogs | **PASS** (with the finding-1 blind spot) | Fresh handoff → `changesSinceUpdate:0`; `add_comment` → **1**; `add_worklog` → 7→**8** with `lastProjectActivityAt` bumped. Pass-1 finding 5 is fixed. |
| `list_users q` / `create_project` / `create_workspace` | **PASS** | `q:"alex"` → **332 B / 1 call** (pass 1: up to 3 calls / ~22 KB against 126 users; now 128 users, unfiltered page still 7,246 B). Case-insensitive, matches email substrings, clean 81 B empty result. `create_workspace` → 193 B echo with id+slug. `create_project` → 278 B echo with id+key, statuses+board seeded (verified: board worked immediately, `list_statuses` 3 rows). Duplicate key → 409 `Project key already in use` (44 B; terse — doesn't echo the key/workspace, P3 nit). Pass-1 findings 2 and 6 are fixed. |

### Pass-1 regression sweep

- **Finding 1 (P1, NLQL silent-empty for names): FIXED.** `assignee = "Alex
  Rivera"` → 3 items (= truth by id); `sprint = "Sprint 1 — GA Blockers"` →
  7 items (= truth by id). Residual: an *unknown* name (`assignee =
  "Nonexistent Person"`) is still a silent `total:0`, not an error → carried
  as new finding 7 (P3, was P1; typos still produce confident wrong answers).
- Finding 2 (`create_project`): **FIXED** (shipped, tested above).
- Finding 3 ("what's blocked" costs 1+N): **STILL OPEN** — `get_epic_overview`
  children still carry only `{id,key,title,type,status}`; no links/blocked
  exposure anywhere cheaper than per-issue `list_issue_links`.
- Finding 4 (cross-project move): **STILL OPEN** — no move tool on the 97-tool
  surface; recovery from a misfile remains lossy delete+recreate.
- Finding 5 (staleness ignores comments): **FIXED** (comments AND worklogs).
- Finding 6 (`list_users q`): **FIXED.** Finding 7 (activity read tool):
  **SHIPPED** (with new gaps, below). Finding 9 (README dup row): **FIXED**.
- Finding 8 (toolset footprint): **GREW** — 97 tools, `tools/list` =
  **82,182 B** (pass 1: 91 tools / 73.7 KB; +11.5%). Still ~20K tokens before
  the first call.

### New findings (this pass), ranked

**1. P1 — Sprint, parent, and label changes are invisible to BOTH
`list_project_activity` and context staleness.** Blocks: "what changed since
my handoff" — the exact question the feed and `staleness` exist to answer.
The AX2 flagship op itself (bulk-parent N tickets to an epic) leaves no
trace. Measured repro: bulk-parent 14 issues (atomic) → **0 feed entries**;
bulk sprint pull of 6 → **0**; bulk label of 6 → **0**; then single-issue
`update_issue sprintId`, unparent, re-parent, `add_issue_label` → `since`
query returns **0 items (74 B)** — so it is field-level (ActivityLog never
records these fields), not a bulk-path miss. Priority/assignee/status DO log
(incl. from bulk). `changesSinceUpdate` sat unchanged through all of it: an
agent that re-scoped a sprint and re-parented an epic hands off with
staleness claiming nothing happened. Contrast: the same session's comment
bumped it within one call. Fix shape: write ActivityLog rows for
sprint/parent/label mutations in `writeIssueUpdate`/label services (they
already have before/after values in hand); the feed and staleness then pick
them up for free.

**2. P2 — Activity summaries for status/assignee are raw ids, defeating the
"skimmable summary" contract.** Measured items: `"summary": "status:
cmr4z8qvk000tskz73wmr1w7z → cmr4z8qvk000uskz7158g1hq8"`, `"assignee: (none)
→ cmqx2rt9g000113mav73zu1oc"` — while `actor` on the same row IS resolved to
a name, and priority renders readably (`priority: HIGH → LOW`). The tool
description promises a summary "cheap to skim without interpreting
field/from/to yourself"; for the two most common change kinds an agent needs
+2 joins (`list_statuses`, `list_users`) to say "moved to In Progress,
assigned to Alex". Fix shape: resolve status/user display names at feed-read
time (both tables are already joined for `actor`); keep ids in `from`/`to`.

**3. P2 — `bulk_update_issues` is the highest-blast-radius write tool (100
ids) yet has no misfire guard and a blind success envelope.** Measured: ids
from two different projects + `priority` → `{"updated":2,"failed":[]}` —
34 B, a foreign project's issue silently mutated, nothing in the response
reveals it (no keys, no project echo; only failures are itemized).
Cross-project statusId/sprintId/parentId/labels ARE caught per-item, but
project-agnostic fields (priority, assignee, type) write anywhere the caller
has access — precisely the pasted-stale-id scenario `expectedProjectKey`
exists to stop on `create_issue`. Fix shape: optional `expectedProjectKey`
on bulk (reject any id resolving outside that project) + echo
`updated: [{id,key}]` (or at least the distinct project keys touched) in the
success envelope; `dryRun.wouldUpdate` should echo keys too, ids alone can't
be eyeballed.

**4. P3 — The compact read surface speaks `key`, every write tool speaks
`id`, and nothing bridges them for free.** Compact `list_issues` items have
no `id` (by design: `{key,title,status,assignee,priority,type}`), `get_issue`
takes only ids, so acting on an issue found in a compact list costs one
extra hop: `search_issues q:"AXR2-3"` (458 B — works, key is indexed) or
re-list with `verbose:true` (8.2× bytes). This bit this very pass (a
compact-item `.id` silently serialized as `null` into a bulk call — caught
only by zod). Fix shape: add `id` to the compact issue shape (+~28 B/issue,
still ~8× under verbose) or accept issue keys anywhere an issueId is taken.

**5. P3 — COMMENT feed items carry no body preview** — `summary:
"commented"`. "What happened today" surfaces THAT someone commented on
AXR2-2 but not that it was the GA-date decision; retrieving it costs
`list_comments` per flagged issue (1,138 B here). Fix shape: first ~120
chars of the body in `summary` (the UI's activity row shows a preview too).

**6. P3 — A garbage `cursor` is silently ignored** — `cursor:"garbage"` →
full history from the beginning (10,758 B), same as omitting it. A truncated
cursor in an agent loop restarts the walk with no signal (double-processing).
Bad `since` correctly 400s; cursor should too.

**7. P3 (residual of pass-1 finding 1) — NLQL user/sprint *name* resolution
now works, but an unknown/misspelled name is still a silent empty set.**
`assignee = "Nonexistent Person"` → `total: 0`, no error (81 B). One typo →
"nothing assigned", confidently. Fix shape (unchanged from pass 1's minimum
bar): unresolvable name on a user/sprint field → 400 naming the value and
suggesting `list_users q` / `list_sprints`.

> **CLOSED 2026-07-06.** `resolveQueryNames` (`packages/shared/src/nlql`)
> now 400s an unresolved `assignee`/`reporter`/`sprint` name across every
> server evaluation path — `exportCsv` (the `list_issues` query-mode oracle),
> per-gadget on dashboards, and a `FAILED` automation run — live-verified:
> `assignee = "Alex Rivera"` (nonexistent) → 400 `unknown user "Alex Rivera"
> — use an exact display name, an id, or me(); see list_users`. See
> `docs/BACKLOG.md`'s ticked NLQL-residual entry for full detail.

**8. P3 — `tools/list` footprint grew to 82.2 KB / 97 tools** (+11.5% over
pass 1) — tracked, per-feature growth is the definition-of-done's own
side-effect; grouped/dynamic toolsets remain the fix shape.

### What worked well (marketing-grade, all measured this pass)

- **Retry-safe writes are real, under real concurrency.** Two simultaneous
  identical creates with one idempotency key → one issue, both callers get
  the same 200 (the loser transparently waits ~230 ms for the winner's
  response). Key reuse with a different payload → a precise 409. A failed
  attempt releases the key so the corrected retry just works. This is
  Stripe-grade idempotency semantics on an issue tracker, exercised from an
  agent client.
- **Atomic bulk is trustworthy:** 14 issues re-parented in one 53 B-response
  call; a poisoned batch (bad id, foreign status) writes *nothing* — verified
  by before/after reads, not by trusting the envelope. `dryRun+atomic`
  returns the complete would-pass/would-fail split for free.
- **The guardrail mandate reaches the agent at every layer:** initialize
  instructions (1,389 B), tool description, and an optional server-side hard
  mode — wrong key fails in 183 B *before* any write, naming both sides.
- **Question economics keep improving:** "who is Alex" 3 calls/22 KB → **1
  call/332 B**; "what happened here since I last looked" unanswerable → **1
  call/4.6 KB** (16× fewer calls than the assembly path); epic status still
  1 call/3.0 KB; "Alex's in-progress work" 2 calls/491 B — or now 1 call by
  plain name, since the pass-1 P1 (NLQL name resolution) is verifiably fixed.
- **Comment gating errors state the rule itself:** `Only the author or a
  project admin can modify this comment` — the agent learns the policy from
  the 403.
- **Zero REST fallbacks this pass** — `create_workspace` → `create_project`
  → plan → work → interrogate → hand off, 113 calls, all through the MCP
  surface. The agent-native claim held end-to-end.

### For the groomer

- **P1** ActivityLog blindness: sprint/parent/label mutations produce no
  activity rows → `list_project_activity` AND context `staleness` both miss
  them (finding 1). This gates trust in the two newest AX surfaces; fix at
  the write path, both consumers inherit it.
- **P2** Resolve status/assignee names in activity `summary` (finding 2).
- **P2** `expectedProjectKey` + `{id,key}` success echo on
  `bulk_update_issues` (finding 3).
- **P3s:** compact-issue `id` (or key-addressable writes) (4); comment body
  preview in feed (5); 400 on malformed cursor (6); 400 on unresolvable
  NLQL user/sprint name (7); toolset footprint 82.2 KB (8); duplicate
  project-key 409 could name the key (nit).
- **Still open from pass 1:** one-call "what's blocked" (P2), cross-project
  issue move (P2).

---

## Spot-check 2026-07-06 — finding 1 residual (pass-2 finding 7): NLQL fail-loud

**Scope.** Independent verification of the closure note above (`169f7c1` +
heuristic tightening `e7dfb20`): unresolved NLQL `assignee`/`sprint` name →
400 instead of silent-empty, with documented leniency for real-shaped stale
ids. Driven through the MCP surface only (`list_issues` query mode + the
dashboard-gadget path), agent's-seat measurements throughout.

**Method.** Built `packages/shared` + `apps/api` + `apps/mcp` from committed
HEAD `e7dfb20` in a detached worktree, API on `:4010` against the isolated
`nextlane_mcpqa` DB (demo seed: project **NL**, 12 issues, 3 users, 1 sprint),
MCP server over stdio, PAT auth as `demo@nextlane.dev`. 25 tool calls, every
response byte-counted. Zero REST fallbacks (one labeled REST call to
`/api/auth/me` for auth plumbing only, before the pass).

### Probe results

| # | Probe (`list_issues` `query`) | Result | Verdict |
| - | --- | --- | --- |
| 1 | `assignee = "Nonexistent Person"` | **400, 133 B**: `Invalid NLQL query: unknown user "Nonexistent Person" — use an exact display name, an id, or me(); see list_users [HTTP 400]` | **PASS** — names the value AND the exact recovery tool. Recovery is genuinely one call: `list_users q:"nonexist"` → 81 B empty (proves no such user); full 3-user roster 431 B. |
| 2 | `sprint = "Typo-Sprint"` | **400, 122 B**: `unknown sprint "Typo-Sprint" — use an exact sprint name or an id; see list_sprints` | **PASS** — `list_sprints` answers in 1 call / 187 B. |
| 3 | `assignee = "workflow-migration-bot-2024"` (long single-token handle, the `e7dfb20` regression case) | **400, 142 B**, same actionable shape | **PASS** — the tightened cuid/UUID-only heuristic holds; no silent-empty resurrection. |
| 4 | Stale-but-real-shaped ids: cuid-shaped assignee, cuid-shaped sprint, UUID-shaped assignee (none exist) | all **200, 81 B, `total: 0`** | **PASS** — documented leniency intact. Distinction feels right from an agent's seat: names are recalled/typed (fail-loud is correct), ids are copy-pasted from prior tool output (a 0 there means "resolved entity has nothing / is gone", and a fabricated id is not a realistic agent mistake). |
| 5 | No false positives: `assignee = <Alex's id>` (truth: 2 items) vs `"Alex Rivera"` → 2, `"ALEX rivera"` → 2, `"Alex@NextLane.dev"` → 2; `sprint = "sprint 1"` (name is "Sprint 1") → full sprint, 1,746 B | all match truth, case-insensitive on name AND email | **PASS** |
| 5b | `assignee IN ("Alex Rivera", "Nonexistent Person")` | **400, 133 B** flagging only the unknown member | **PASS** — IN-list operands are checked individually. |
| 6 | Regression: `assignee = me() AND status = "In Progress"` | **1 call, 300 B**, envelope `{items,total,limit,offset,hasMore}` intact | **PASS** — query-mode economics unchanged. |

**Bonus — dashboard per-gadget path (closure note's second call site),
verified live via MCP:** dashboard with one good gadget
(`assignee = "Alex Rivera"`, STAT) + one bad (`"Nonexistent Person"`) →
`get_dashboard_data` returns the good gadget's correct `count: 2` and the bad
gadget carries a per-gadget `error` with the identical actionable message;
the whole-dashboard read does not fail (2,067 B). The automation-FAILED-run
path was not independently re-driven (unit-tested in `169f7c1` + fixer's
live check); the two agent-facing read paths were.

### Verdict: **CONFIRMED CLOSED.**

The pass-2 closure note is accurate as written. Pass-1 finding 1 and its
residual (pass-2 finding 7) are fully resolved: a typo'd person/sprint name
can no longer produce a confident wrong answer through `list_issues` query
mode or a dashboard read, valid names (any case, name or email) still resolve
with zero false positives, and every 400 measured (122–142 B) is
self-correctable in exactly one follow-up call that the error itself names.
This is the error-quality bar the rest of the surface should be held to.

### Incidental observations (not blocking closure)

- **P3 nit:** `create_dashboard_gadget` accepts an unresolvable name at
  create time (200); the error only surfaces on the next
  `get_dashboard_data`. Defensible (the name may come to exist; per-gadget
  read-time flagging is the designed containment), but a create-time warning
  would catch the typo at the moment the agent can cheapest fix it.
- **Toolset footprint tracker (pass-1 finding 8):** now **104 tools /
  89,111 B** `tools/list` (pass 2: 97 / 82.2 KB; +8.4%). Trend unchanged.
- Two zod input errors I caused myself (`create_dashboard_gadget` with a
  pass-2-era `config.query` shape; `delete_dashboard` with `dashboardId`
  instead of `id`) were both one-retry self-correctable — the zod envelope
  named the missing paths and the enum of valid `visualization` values.
  Worth noting the id-param naming inconsistency (`dashboardId` on
  `get_dashboard_data` vs `id` on `delete_dashboard`) as a P3 polish item.

### For the groomer

- Close the NLQL fail-loud backlog entry with this spot-check as independent
  verification (pass-1 finding 1 + pass-2 finding 7: **verified closed**).
- **P3 (new):** create-time warning (or validation) for unresolvable
  names in `create_dashboard_gadget`/saved-filter queries.
- **P3 (new):** normalize id-param naming across dashboard tools
  (`dashboardId` vs `id`).

---

## Pass 3 — 2026-07-09 (Pages knowledge-graph surface, review-fix wave `79b6d32` + `e23eb47`)

**Scope.** Acceptance of the 12 Pages tools (`list_pages`, `get_page`,
`create_page`, `move_page`, `update_page`, `delete_page`,
`list_page_versions`, `get_page_version`, `restore_page_version`,
`get_page_graph`, `get_page_backlinks`, `get_page_links`) with a focus on the
crown-jewel graph-traversal surface and the just-landed review-fix wave:
(a) the three graph tools now read the AUTHORITATIVE stored `PageLink` rows
(`GET /pages/:id/links`) instead of re-deriving from the tree — they must
agree on edges/target ids, *especially* when two pages share a title;
(b) `list_pages verbose` capped at 25 hydrated pages/call, fetched
concurrently, must not 429; (c) `get_page_links` now carries a `truncated`
flag.

**Method.** Built `apps/mcp` from the committed tree (`pnpm build`), drove it
via a stdio MCP client harness (`initialize` handshake + `tools/call`, real
JSON), PAT auth (`nlp_...`, scopes `pages:read`+`pages:write`+`projects:read`)
against the shared API on `:4000` — no second API started. Fresh user +
workspace + project **KB QA Project**. Seeded 9 interlinked pages via
`create_page`/`update_page` with `[[wiki-links]]`: a hub (**Engineering
Handbook**), a 5-page cross-linked cluster (Onboarding → Dev Env → Architecture
→ API Design, plus Release Process), a **true orphan** (Scratch Notes), and —
for the ambiguity test — **two pages both titled "Glossary"** with the
Handbook linking `[[Glossary]]`. Later added 22 filler pages (31 total) for
the verbose-cap test. Traversed the graph purely through MCP tools to answer
"how does our documentation connect, and what are the hub/orphan pages?".
Every response byte-counted (payload = the tool-result text an agent sees).

### Verdicts on the three review-fix criteria

1. **Three graph tools agree on the ambiguous target id — CONFIRMED.** With
   two same-title "Glossary" pages (older `…u503ppuwtfu01fnhrv`, newer
   `…um03puuwtf2wr2w1vx`), the Handbook's `[[Glossary]]` resolves to the
   **older** page across all three reads, byte-for-byte consistent:
   - `get_page_graph` edge: `{sourceId: Handbook, targetId: …u503ppuwtfu01fnhrv}`.
   - `get_page_links` (Handbook): `resolved[].pageId = …u503ppuwtfu01fnhrv`.
   - `get_page_backlinks` on the **older** Glossary returns Handbook (1 item,
     283 B); on the **newer** Glossary returns `[]` (81 B).
   The authoritative-`PageLink` refactor holds: no tool re-derives a different
   winner. (Resolution rule = oldest page by `createdAt` wins; verified against
   `syncWikiLinks` in `pages.service.ts`.)

2. **`list_pages verbose` 25-cap + no 429 — CONFIRMED.** On the 31-page
   project: compact = 31 items / `hasMore:false` / **4,264 B**; verbose =
   **exactly 25 items** / `limit:25` / `total:31` / **`hasMore:true`** /
   **25,332 B**, `isError:false`, 140 ms (concurrent hydration, zero 429s).
   Cap and pagination signal both correct.

3. **`get_page_links` `truncated` flag — CONFIRMED.** Present on every
   `get_page_links` result and inside `get_page`'s nested `links.outgoing`
   (`truncated:false` throughout this pass; no page exceeded the cap).

### Graph internal-consistency + post-delete integrity — CONFIRMED

Whole graph (9 nodes / 14 edges) returned by one `get_page_graph` call
(2,333 B, `truncated:false`); every edge's `sourceId`/`targetId` matched a
node id. After I deleted the hub (see finding 1), a re-read returned 30 nodes
/ 6 edges — the Handbook node and **all 8 edges touching it** were dropped
atomically (no dangling edge id survived), and the three ex-linkers'
`get_page_links` flipped `[[Engineering Handbook]]` from `resolved` to
`unresolvedTitles` (re-derived from content vs the now-deleted `PageLink`
rows). The graph never went internally inconsistent.

### Calls-per-question (the PM interrogation) — all ≤ 1 MCP call

| Question | Tool | Calls | Bytes |
|---|---|---|---|
| "How do our docs connect; which are hubs/orphans?" | `get_page_graph` | 1 | 2,333 |
| "What links to the Handbook?" | `get_page_backlinks` | 1 | 675 |
| "What does the Handbook link to; any broken links?" | `get_page_links` | 1 | 572 |
| "Give me this page + its graph context" | `get_page` (default) | 1 | 1,664 |
| Walk hub → Architecture → its links (one hop) | `get_page_links` | 1 | 305 |

`get_page` bundles the page + backlink-count + split outgoing links into a
single MCP call (3 API round-trips server-side, invisible to the agent) — the
single best-shaped read on the Pages surface.

### New findings (this pass), ranked

**Finding 1 — P2: `delete_page` silently orphans inbound backlinks (no
referential guard, bare `{id}` response).** `delete_page` guards TREE
integrity (400 if the page has child pages) but not REFERENTIAL integrity. I
deleted the **Engineering Handbook** — a hub with **3 backlinks and 5
outgoing links** — and the call **succeeded**, returning `{ "id": "…" }`
(39 B) with no warning. The three pages that linked to it (Onboarding, API
Design, Release Process) were silently left with dangling `[[Engineering
Handbook]]` references (now `unresolvedTitles`). *Agent-workflow it blocks:*
an agent told "delete the old draft page" can destroy a load-bearing doc and
get zero signal that it just broke N other pages' links — the exact
information `get_page_backlinks`'s own description says to "check before
editing or archiving a page to see what would be left dangling," yet
`delete_page` neither checks nor hints it. A human in the web UI sees the page
and its Backlinks panel first; the agent sees nothing. *Evidence:* delete
returned 39 B success; graph 14→6 edges; `get_page_links` on Onboarding after:
`resolved:[DevEnv]`, `unresolvedTitles:["Engineering Handbook"]`. *Suggested
fix shape:* have `delete_page` return the count it just orphaned
(`{ id, orphanedBacklinkCount: 3 }`) so the agent can react, and/or add a
`force`-style guard that 409s when `backlinkCount > 0` unless explicitly
acknowledged; at minimum the description should instruct checking
`get_page_backlinks` first (mirroring the archive guidance).

**Finding 2 — P3: "which pages changed today / recently" is not answerable
compactly.** Compact `list_pages` refs are `{id, title, parentId, archived}`
— **no `updatedAt`** (documented: the tree endpoint carries no timestamps),
and `get_page_graph` nodes are just `{id, title}`. The only timestamped list
is `list_pages verbose`, capped at **25 pages / 25,332 B per call**. So on a
31-page project the natural agent question "what pages changed today?" costs
**2 verbose calls (~50 KB) + client-side date filtering**, or one `get_page`
per page. *Agent-workflow it blocks:* the "what changed today" standup
question that Pass-1 praised for issues has no cheap Pages equivalent.
*Suggested fix shape:* carry `updatedAt` on the compact ref (the tree query
would need to select it), or expose a lightweight recently-updated-pages
read (sortable by `updatedAt`, compact) so freshness doesn't force full
hydration.

**Finding 3 — P3: `create_page` has no misfile guard (unlike
`create_issue`).** `create_issue` gained an `expectedProjectKey` echo/guard
(Pass 1) precisely to stop agents writing to the wrong project.
`create_page` takes only `projectId` — a single opaque cuid — with no
expected-key confirmation, so writing a page into the wrong project is a
one-argument mistake caught only by inspecting the returned `projectId` after
the fact. *Agent-workflow it blocks:* multi-project agents mis-filing docs
with no pre-write safety net. *Suggested fix shape:* optional
`expectedProjectKey` on `create_page` mirroring `create_issue`
(soft-recommend, hard-fail under `NEXT_LANE_MCP_STRICT_PROJECT_KEY`).

**Finding 4 — P3: `get_page_graph` returns raw nodes+edges with no per-node
degree.** Answering "which pages are hubs/orphans" — the graph tool's own
headline use case, per its description — requires the agent to aggregate edge
degree client-side. Trivial at 9 nodes; at the 1000-node cap it is real token
+ compute the agent must spend on every "hubs?" question. *Suggested fix
shape:* optional `includeDegree:true` adding `{inbound, outbound}` per node,
or a tiny `{hubs:[…], orphans:[…]}` summary block, so the crown-jewel question
is answered by the crown-jewel call without post-processing.

### What worked well (marketing-grade, all measured this pass)

- **The tool descriptions taught the traversal pattern with zero guesswork.**
  `get_page_graph` is self-labeled the "CROWN-JEWEL traversal call" and spells
  out hub-spotting (many edges), orphan-spotting (no edges), and the
  truncation-consistency contract; `get_page_links`/`get_page_backlinks`
  cross-reference each other ("the reverse direction") and tell you to "follow
  `pageId` into another get_page/get_page_links call to keep traversing." I
  drove the entire graph walk from descriptions alone — no schema spelunking.
- **Authoritative `PageLink` reads are genuinely consistent.** The
  hardest-to-get-right case (two pages sharing a title) resolves to the same id
  across all three tools, and stays consistent through a hub deletion. This is
  the correctness bar an agent-native graph needs.
- **Compact, bounded payloads.** Whole 9-node graph = 2,333 B; backlinks =
  675 B; outgoing links = 572 B; a not-found error = 32 B (`Error: Page not
  found [HTTP 404]`). Every graph question was ≤ 1 MCP call and single-digit KB.
- **Verbose is safely bounded.** The 25-cap + concurrent hydration means an
  agent that naively asks for "all pages, full detail" on a big wiki gets a
  fast 25-KB slice + `hasMore:true`, never an unbounded dump or a 429.
- **Errors are precise and one-retry self-correctable.** Reads: `Page not
  found [HTTP 404]` (32 B), `Page version not found [HTTP 404]` (40 B), bad
  project `Not a member of this project [HTTP 403]` (46 B), self-parent
  `A page cannot be its own parent [HTTP 400]` (49 B). Input: the zod
  envelope names the missing `projectId` path (241 B). Nothing generic.

### Toolset footprint tracker (carried from Pass 2)

`tools/list` now **117 tools / 103,407 B** (Pass 2: 104 / 89,111 B; +12.5%
tools, +16% bytes — the 12 Pages tools land in this pass). Trend still upward;
worth a one-time audit of whether the full `tools/list` needs to ship every
description in full, but not blocking.

### For the groomer

- **P2 (new):** `delete_page` referential-integrity signal — return
  `orphanedBacklinkCount` (and/or 409-on-backlinks guard / description warning)
  so deleting a hub page isn't a silent, unsignalled break of N other docs.
- **P3 (new):** carry `updatedAt` on compact `list_pages` refs (or add a
  compact recently-updated-pages read) so "what pages changed today" doesn't
  force 25-cap verbose hydration.
- **P3 (new):** add optional `expectedProjectKey` misfile guard to
  `create_page`, mirroring `create_issue`.
- **P3 (new):** optional per-node degree (or `hubs`/`orphans` summary) on
  `get_page_graph` so its headline hub/orphan question needs no client-side
  aggregation.
- **Verified closed:** review-fix wave `79b6d32` + `e23eb47` — the three
  graph tools agree on the ambiguous same-title target id, `list_pages
  verbose` is 25-capped with `hasMore` and no 429, and `get_page_links` carries
  `truncated`. All independently reproduced above.
