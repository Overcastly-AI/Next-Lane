---
name: next-lane-project-context
description: Persistent per-project memory for agents working in Next Lane over MCP (@next-lane/mcp). Use when starting work on a Next Lane project, resuming or planning work with Next Lane MCP tools (list_issues, create_issue, boards, sprints), or wrapping up a Next Lane work session — read the project's agent context first, keep it updated at milestones, and always dump a handoff before finishing.
---

# Next Lane project context — read first, hand off last

Every Next Lane project keeps **one shared agent-context document**: the
persistent memory that survives between your runs and carries across to
other agents (and humans — it's visible and editable in the project UI).
Two MCP tools manage it: `get_project_context` and `update_project_context`.

## At session start — always

1. Call `get_project_context` for the project **before doing anything else**.
   Its content is the handoff from whoever worked here last.
2. Check the `staleness` field. `changesSinceUpdate > 0` means real project
   activity happened after the handoff was written — verify the claims you
   care about against current state (`list_issues` with an NLQL `query`,
   `get_epic_overview`) before trusting them.
3. An empty document means you're first: after orienting yourself, write the
   initial context so the next run doesn't start blind.

## During work

After a significant milestone, decision, or change of direction, update the
context. Don't wait for the end of a long session — a crash loses everything
you didn't write down.

## Before ending — never skip

Call `update_project_context` with a concise handoff. It is a
**full-content replace**, not an append log: carry forward what still
matters, drop what's resolved, and stay well under the 64 KB cap.

Structure the handoff like this:

```markdown
## Current goal
Ship the Q3 billing revamp epic (NL-142) by July 20.

## State & decisions
- Backend issues (NL-143..NL-149) are DONE; NL-150 (webhooks) in review.
- Decided to gate rollout behind the `billing_v2` flag — see NL-151 comments.

## In-flight
- NL-150 awaiting review from @dana; CI was red on the retry test, fixed in
  latest push.

## Next steps
1. When NL-150 merges, move NL-152 (migration runbook) to In Progress.
2. Create QA issues for the flag-off path — not filed yet.

## Gotchas
- Sprint "July-B" dates are wrong (ends 07-18, not 07-25) — don't trust
  sprint-based deadlines until someone with admin fixes it.
```

## Rules of thumb

- Write for a reader with **zero context** — the next agent may not be you.
- Prefer issue keys (NL-150) over descriptions; keys survive, phrasing doesn't.
- Record *decisions and why*, not activity logs — the tracker already has those.
- If you did something surprising (worked around a bug, mis-filed and
  corrected issues), say so in Gotchas.

## MUST: confirm the target project on every `create_issue` call

A field report confirmed an agent without this habit filed an issue into the
wrong project, with no way to detect the mistake after the fact — there is no
undo. Pass `expectedProjectKey` (the project key you believe `projectId`
resolves to, e.g. `"NL"`) on **every** `create_issue` call, not just when
something feels ambiguous. A mismatch fails BEFORE anything is created, with a
clear error naming both keys. The response also always echoes the resolved
`project: {id, key, name}` as a second, after-the-fact check — but treat that
as a backstop, not a substitute for passing `expectedProjectKey` up front.
Some Next Lane MCP servers enforce this as a hard requirement
(`NEXT_LANE_MCP_STRICT_PROJECT_KEY`); assume it may be enforced and pass the
key regardless.

## Retrying after a network error/timeout

If a `create_issue` or `add_comment` call fails ambiguously (timeout, network
error, no clear success/failure response), generate an `idempotencyKey` (any
string, e.g. a UUID) the FIRST time you make the call and reuse the SAME key
if you retry it. A retry with the same key replays the original result
instead of creating a duplicate issue or comment. Omit it for a normal,
non-retried call.

## Checking what changed since you last looked

Before assuming your mental model of a project's state is current — especially
after resuming a session or before making a bulk change — call
`list_project_activity` with `since` set to a known timestamp (or your prior
`nextCursor`) instead of polling `list_issues`/`get_issue` one at a time. It
returns a chronological, compact feed of issue field changes, comments, and
work logs across the whole project in one call.
