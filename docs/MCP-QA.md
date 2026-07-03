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
