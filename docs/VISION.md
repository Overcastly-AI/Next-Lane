# Next Lane — Product Vision (North Star)

> This is the *why* and the *where we're going*. The **how/when** lives in
> `docs/ROADMAP.md`; the **next actions** live in `docs/BACKLOG.md`. This file is
> owned by the **vision-steward** agent (`.claude/agents/vision-steward.md`):
> the founder dreams, the steward formalizes ideas into this doc + the roadmap +
> the backlog and hands them to the build loop.

## Brand hierarchy

Three layers. They must never collapse into each other:

1. **Overcastly AI** (https://overcastly.com) — the **maker and company**. Overcastly
   AI designs, builds, and maintains Next Lane. Attribution belongs here.
2. **Next Lane** — the **product**, with its own "Dispatch" design identity and
   persona. Next Lane is an open-source, MIT-licensed, self-hosted issue and project
   tracker. It has its own brand name, logo, and design system; it is not
   white-labelled to Overcastly's visual language.
3. **Self-hoster workspace branding** — the per-workspace **end-user override** layer.
   Any self-hosted instance's admin can upload their own logo and accent color; this
   third layer sits on top of and replaces Next Lane's defaults within that workspace.
   This is an architectural feature, not a marketing concept.

Attribution rule: every external surface (README, docs site, SECURITY.md) carries a
lightweight "Built by Overcastly AI · overcastly.com" credit. It does not drive visual
or token decisions — Overcastly's own brand tokens are deferred until the founder
supplies them. Do not invent Overcastly colors or logos.

## The thesis

**Build the best issue & project tracker in the world — open-source, MIT, and
self-hosted — and beat the dominant paid incumbent by doing the things a
cloud-first, per-seat-priced, closed product structurally cannot.**

We don't win by copying the incumbent's feature checklist (they have a 20-year
head start). We win on **structural advantages they can't match**:

1. **Free & unlimited.** No per-seat pricing. Unlimited users, unlimited
   automation runs, unlimited AI — because it runs on *your* hardware, the
   marginal cost is zero. The incumbent meters all three.
2. **Your data, your compute.** Everything self-hosted: private AI (local LLM),
   direct SQL/warehouse access to your own data, no egress. The one thing
   regulated/enterprise teams can't buy from the cloud at any price.
3. **Open & extensible.** MIT, no marketplace tax, code-level extensibility,
   works with self-hosted forges (Gitea/GitLab) not just the big clouds.
4. **AI-native & agent-native.** Built in the agent era: an MCP-native tracker
   that AI coding agents operate directly. (This product is itself built by a
   team of AI agents — we dogfood it.)

If a capability doesn't exploit one of those four advantages, it's table stakes
we ship to be credible — not where we differentiate.

## The operating question

Every roadmap decision, backlog item, and code review ultimately answers one
question, per the founder's direct mandate:

> **"Is this better than Jira?" If not, keep working and figure out how to be.**

This is a deliberately higher bar than "a cheaper alternative" or "an
open-source clone." The four structural advantages above are *why we can
win* — moats the incumbent cannot follow us into no matter how much it
spends. But they are not, by themselves, an answer to the operating
question. A team that has run the incumbent for years, opens Next Lane, and
finds it merely "free and good enough" has not been won. They have to feel
that their daily driver got *better* the day they switched — faster,
sharper, more theirs, more legible to the agents that now write half their
code — not just cheaper.

Concretely, the operating question resolves to a **daily-driver test**:
could we hand this instance, today, to a team that has used the incumbent
for years, and have them prefer it within the first week — not because it's
free, but because the board is faster, the search is sharper, the workflow
bends to their process instead of the other way around, and an agent can
read/write their tracker in ways the incumbent structurally cannot allow?
Where the honest answer is "not yet," that gap is the highest-priority work,
full stop — ahead of any new pillar or moonshot. The scorecard below exists
to keep that answer honest, not to flatter us.

## Better-than-Jira scorecard

Grounded in what's actually shipped (`docs/ROADMAP.md`) and the two
independent Pass-11 audits (`docs/AUDIT-PRODUCT.md`, `docs/AUDIT-ENGINEERING.md`,
both 2026-07-01/07-02). Re-scored by the vision-steward whenever the roadmap
materially changes.

| Dimension | Verdict | Evidence |
|---|---|---|
| Board speed & feel | **Better** | The DnD board has been rated 5/5 in every product-audit pass since Pass 3 — fractional-rank optimistic drag, live presence, WIP limits, swimlanes, blocked-link and custom-field card-face chips (AUDIT-PRODUCT.md Pass 11). It also runs with zero network hop to a third-party cloud and zero per-seat automation throttling — speed the incumbent can't structurally match on your own hardware. |
| Workflow flexibility | **Better** | Per-board named workflows with a visual graph editor, transition gates, and one-click templates (Phase 5, ROADMAP.md) — and, uniquely, the workflow definition is readable *and editable* over MCP by an AI agent (`@next-lane/mcp`, 18 tools). No closed per-seat tracker exposes its SDLC to an agent this way. |
| Keyboard-first ergonomics | **Better** | A command palette (Cmd-K) plus a dedicated keyboard triage mode (`j`/`k` navigate, `s`/`p`/`a`/`l` inline pickers, `?` help overlay) go deeper than the incumbent's shortcut set — a genuine power-user differentiator, not table stakes. |
| Search & query power | Parity | NLQL (query language + saved/shared filters + full-text search) shows "none" gap vs. the leader baseline in the Pass-11 parity scorecard (AUDIT-PRODUCT.md). The power is there; the incumbent's 20-year JQL install base and muscle memory is a maturity/ecosystem gap that shipping more features alone won't close. |
| Onboarding / first-hour experience | Parity | In-app onboarding is a rated strength across four consecutive audit passes ("zero dead ends," guided first-project flow, strong empty states). But self-hosting itself (Docker Compose, env config) is real setup friction a cloud incumbent's instant signup doesn't have — the two roughly cancel out today. |
| Reporting | Behind | Burndown/velocity/CFD exist per-sprint, but there is still no configurable dashboard/gadget grid — rated a flat 3 vs. 5 for four consecutive audit passes (Pass 8/9/10/11, AUDIT-PRODUCT.md) — and no cross-sprint trend reporting. Advanced/configurable reporting is a genuine incumbent strength we have not matched. |
| Integrations | Behind | Phase 9 "Developer Graph" (GitHub/GitLab/Gitea two-way linking, PR/CI status, auto-transition) is still 🔭 vision — unshipped. Import/export is file-based only, no live OAuth pull (rated 4 vs. 5, AUDIT-PRODUCT.md Pass 11). No marketplace. This is where the incumbent's 20-year ecosystem is a real, unclosed moat. |
| Mobile | Behind | Responsive web only — no native app, while the incumbent ships native iOS/Android with offline support. Pass 11 also found an open mobile-specific defect (header identity legibility during workspace/project navigation, AUDIT-PRODUCT.md) — mobile is currently our weakest coherence surface, not just a missing feature. |
| Reliability / coherence-of-state | Behind | Two *independent* Pass-11 audits (2026-07-01) found the same defect class the same day: the workspace/tenant context could silently disagree with the page you were looking at, on up to 7 of 15 routes (AUDIT-PRODUCT.md, AUDIT-ENGINEERING.md). The specific instances shipped fixed 2026-07-02 (ROADMAP.md), but the *pattern* — opt-in context sync instead of route-derived truth — is still structural and both auditors flagged it as a recurrence risk. A mature 20-year product doesn't have this bug class at all. |
| Admin controls | Behind | No SSO/OIDC; no per-project role override (rated 3 vs. 5, AUDIT-PRODUCT.md Pass 11); the workspace switcher has no search/filter at scale (rated 2 vs. 4, reproduced live at 50+ workspaces in the demo account). Admin/permission depth is where enterprise self-hosters will judge us hardest. |

**Tally as of 2026-07-02: 3 better / 2 parity / 5 behind.** This is the
honest current state, not a target. The backlog-groomer sequences work to
flip "behind" rows first — see the "Better-than-Jira gaps" note in
`docs/BACKLOG.md`.

## The pillars (what "better than the incumbent" means here)

1. **Core PM parity** *(Phase 5 — largely shipped)* — be a credible daily driver
   first: multiple boards + board types, custom fields, a real query language (NLQL)
   + saved filters, conditional card colors, planning poker, issue
   links/dependencies, bulk edit, CSV export, workspace branding. Remaining gaps:
   swimlanes, components/versions, and **configurable workflows** — let teams
   bake in their full SDLC as an editable status graph (allowed transitions +
   conditions/validators/gates + templates). This one bridges to pillar 4: the
   workflow definition is **readable and editable over MCP**, so an agent can
   introspect and reshape a project's SDLC the same as a human — an agent-legible,
   self-defined process is something closed per-seat trackers don't expose.
2. **Autopilot — a self-hosted AI teammate** *(Phase 6)* — private, unlimited,
   $0 AI: natural-language→NLQL, auto-triage + semantic dedupe (pgvector),
   sprint risk radar & summaries, and **MCP-native** so agents read/write issues
   (and the workflow definition) from the IDE.
3. **Glass Box — unlimited automation + data ownership** *(Phase 7)* — a
   trigger→condition→action engine (conditions reuse NLQL) with **unlimited
   runs** and a full audit (shipped). Remaining: rule library/templates, true
   data ownership (SQL/warehouse export, Grafana dashboards).
4. **The Unbundle** *(Phase 8)* — bundle, free, what comparable trackers sell as
   separate paid products: docs/wiki, whiteboard/story-mapping, a public
   roadmap + feature-voting portal, and intake forms.
5. **Developer Graph** *(Phase 9)* — the tracker that knows your code: two-way
   GitHub + GitLab + Gitea links, live PR/CI status on cards, auto-transition on
   merge, smart-commits.
6. **Team rituals & personal workspace** *(Phase 10 — shipped)* — async
   standups, private personal boards/scratchpads, and personal + team analytics.
   Make it the place people start their day, not just where tickets live.

## Operating principles

- **Quality the user *feels*.** Test the real artifact and real-user behavior
  (the actual Docker build, desktop + mobile, per-keystroke flows) — "tests
  pass" ≠ "works for the user."
- **Get the foundation right before stacking on it.** (E.g. the data-model
  overhaul done while there are no users, so breaking changes are free.)
- **Self-hosted-first, zero-config small installs, scale-ready big ones.**
- **Privacy by default** — AI inference local; a hard "no external calls" switch
  for regulated installs.
- **Never reference the trademarked incumbent by name** anywhere in the repo;
  frame by category ("comparable trackers").

## How ideas flow in (the founder → product loop)

The founder generates direction in plain language ("we need standups",
"personal boards + analytics", "what about automations?"). The
**vision-steward** agent ingests each idea and:
1. Decides if it's a new pillar, a roadmap phase/item, or a backlog candidate.
2. Writes it into this VISION.md (if it shifts the north star) and/or
   `docs/ROADMAP.md` + `docs/BACKLOG.md`, deduped against what exists.
3. Frames it against the four structural advantages (is this where we
   differentiate, or table stakes?).
4. Hands well-formed items to the build loop and the auditors/groomer.

The founder shouldn't have to format, file, or sequence ideas — just dream.
