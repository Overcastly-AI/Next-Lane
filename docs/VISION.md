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

## The pillars (what "better than the incumbent" means here)

1. **Core PM parity** *(Phase 5 — largely shipped)* — be a credible daily driver
   first: multiple boards + board types, custom fields, a real query language (NLQL)
   + saved filters, conditional card colors, planning poker, issue
   links/dependencies, bulk edit, CSV export, workspace branding. Remaining gaps:
   swimlanes, workflow transitions, components/versions.
2. **Autopilot — a self-hosted AI teammate** *(Phase 6)* — private, unlimited,
   $0 AI: natural-language→NLQL, auto-triage + semantic dedupe (pgvector),
   sprint risk radar & summaries, and **MCP-native** so agents read/write issues
   from the IDE.
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
