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
independent Pass-12 audits (`docs/AUDIT-PRODUCT.md`, `docs/AUDIT-ENGINEERING.md`,
both 2026-07-02, verifying the founder-wave: persistent left sidebar,
dark mode, NLQL-native dashboards, Swimlanes v2, GitHub v1, SSO/OIDC Phase 1,
MCP 85 tools). Re-scored by the vision-steward whenever the roadmap
materially changes.

| Dimension | Verdict | Evidence |
|---|---|---|
| Board speed & feel | **Better** | Re-affirmed this pass: Swimlanes v2 (group-by Component/Label/custom SELECT field/Sprint, not just the original Assignee/Priority/Type/Epic set) is "excellent" on desktop with correct per-lane counts and full custom-field wiring (AUDIT-PRODUCT.md Pass 12, 9/10). It still runs with zero network hop to a third-party cloud and zero per-seat automation throttling. **Caveat:** this same ship introduced a mobile-only paint regression in the board toolbar's dropdown menus — tracked under the Mobile row below, not scored against this one, since the underlying board capability itself isn't diminished. |
| Workflow flexibility | **Better** | Re-affirmed: the `enforceStatusChange` unification (board-context path → resolved-workflow path → legacy path, automation bypass checked first) is engineering-verified "genuinely well-designed" (AUDIT-ENGINEERING.md Pass 12) — enforcement is airtight across every entry point, not just the common one. Per-board named workflows, visual graph editor, transition gates, templates (Phase 5) remain readable *and editable* over MCP by an AI agent (`@next-lane/mcp`, now 85 tools). No closed per-seat tracker exposes its SDLC to an agent this way. |
| Keyboard-first ergonomics | **Better** | Re-verified this pass with fresh live typing: Cmd-K's fuzzy command palette + quick actions + live issue search worked with no regression (AUDIT-PRODUCT.md Pass 12). Still goes deeper than the incumbent's shortcut set — a genuine power-user differentiator, not table stakes. |
| Search & query power | **Better** | Elevated from Parity this pass. NLQL is no longer just a search/filter language — it is now the single query language spanning board grouping (Swimlanes v2), saved/shared filters, automation conditions, **and** the new dashboard gadget system (STAT/TABLE/BREAKDOWN/BURNDOWN, all defined as an NLQL query + a visualization, with autocomplete and precise recursive-descent parser errors verified live, AUDIT-PRODUCT.md Pass 12). The capability-parity scorecard still shows "none" gap vs. the leader baseline — but this pass's evidence shows genuine differentiation, not just parity: the incumbent configures search (JQL), automation conditions, and dashboards through three separate, non-interchangeable mechanisms, where here one query language does all four jobs. The remaining incumbent edge is 20-year ecosystem/muscle-memory maturity, not capability — the same category of gap "Workflow flexibility" already claims Better despite. |
| Onboarding / first-hour experience | Parity | Stays Parity, but with real structural progress: the persistent left sidebar (Nav & IA Phases 1+2, shipped 2026-07-02) durably resolves the founder's "three shipped features read as missing" complaint — branding, board default filters, and the Gantt-style roadmap are now always-visible in the sidebar's expanded project row, re-verified this pass (AUDIT-PRODUCT.md Pass 12: "closes the exact 'buried features' complaint"). In-app onboarding itself remains a rated strength (9/10, unchanged). Not enough to move to Better: self-hosting setup friction (Docker Compose, env config) is unchanged, and the mobile drawer's own sidebar still lacks the desktop footer's theme-toggle/collapse control (a fresh, minor inconsistency this pass found). |
| Reporting | **Parity** | Elevated from Behind this pass. Configurable dashboards Phase 1 is not scaffolding: all four gadget types (STAT/TABLE/BREAKDOWN/BURNDOWN) verified live with real data, custom fields fully wired into group-by, an excellent specific empty state ("no sprint" burndown message) and precise inline parser-error validation (AUDIT-PRODUCT.md Pass 12, 8/10) — the flat-3-for-four-passes structural gap is genuinely closed. Not yet Better: no scheduled/emailed reports, no cross-project/cross-workspace dashboard scoping, no dashboard sharing (a public/read-only embed link) — and engineering flagged the feature as currently having **zero realtime coverage** (gadget numbers can go stale indefinitely with the tab open; AUDIT-ENGINEERING.md Pass 12, P1), a fix already queued. |
| Integrations | Behind | Stays Behind, note strengthened. GitHub integration v1 is confirmed genuinely working end-to-end — a real HMAC-SHA256 signed webhook round trip (push + pull_request), correct idempotent issue linking, and signature tampering correctly rejected with 401 (AUDIT-PRODUCT.md Pass 12: "not an exaggeration"). This reduces execution risk on the claim but not the depth gap: auto-transition-on-merge, live CI status, smart-commits, and GitLab/Gitea remain unshipped, and the incumbent's 20-year day-one SCM feature set is still ahead. |
| Mobile | Behind | Stays Behind, reinforced with fresh negative evidence. This pass's own flagship feature, Swimlanes v2, shipped a P1 regression: the board's "Group by" and filter-chip dropdown menus are functionally clickable but render **completely invisible** on a real 393px phone (`overflow-x-clip` suppresses the paint of an absolutely-positioned menu that extends past the viewport) — the pre-existing quick-filter chip row also regressed to silently clipping "Recently updated" off-canvas with no scroll cue (AUDIT-PRODUCT.md Pass 12). Mobile went from "missing a native app" (a static, known gap) to actively regressing on web-mobile usability of a brand-new feature; the fix is queued as the top-priority item. |
| Reliability / coherence-of-state | **Parity** | Elevated from Behind this pass. Pass-11's headline defect — the workspace/tenant context lying to the header chip on up to 7 of 15 routes — is genuinely and fully fixed via the recommended structural pattern: `useSyncActiveWorkspace` hoisted into route-level `WorkspaceScopedLayout`/`ProjectScopedLayout` wrappers so every scoped route derives truth from the URL instead of opt-in context sync, "CONFIRMED FIXED — structurally" by engineering and independently re-verified by product with a fresh two-workspace deep-link matrix covering every previously-broken page (both AUDIT-PRODUCT.md and AUDIT-ENGINEERING.md, Pass 12). Not yet Better: the same wave shipped a fresh P1 in the same "green tests, broken shipped artifact" failure class that already burned this project once — the dark-mode no-flash bootstrap script is silently blocked by the production CSP's `script-src` (no hash/nonce/`unsafe-inline`), so every reload with a dark preference flashes light first and logs a CSP violation in real deployments (AUDIT-ENGINEERING.md Pass 12, P1). A fix (CSP hash allowlist + a Docker-artifact Playwright gate) is in flight. |
| Admin controls | Behind | Stays Behind. SSO/OIDC Phase 1 shipped and is correctly gated (no broken UI when unconfigured) and the workspace-switcher search/recents closed a second admin-adjacent gap — but two blockers an evaluating enterprise/agency admin checks first remain unaddressed: SSO configuration is env-var/redeploy-only with no in-app admin settings screen, and per-project role override is still schema-confirmed absent, unchanged since Pass 9 (AUDIT-PRODUCT.md Pass 12). |

**Tally as of 2026-07-02 (Pass-12 re-score): 4 better / 3 parity / 3 behind.**
This is the honest current state, not a target. The backlog-groomer sequences
work to flip "behind" rows first — see the "Better-than-Jira gaps" note in
`docs/BACKLOG.md`, and `docs/ROADMAP.md` § Current focus for this pass's
post-wave priority order.

**Cross-cutting finding (2026-07-02, founder session):** three separately-
reported "lost features" — workspace branding, board default filters, the
Gantt-style roadmap timeline — turned out to all be *shipped and working*,
just unreachable without already knowing where to look (a "More" dropdown, a
settings-modal tab, a chip flyout). That is one root cause, not three bugs:
**Next Lane has no persistent navigation/IA surface.** Every project- and
workspace-scoped capability is reachable only through a horizontally-
collapsing top nav and nested menus, which does not scale past a handful of
projects/workspaces — exactly the "many projects and many workspaces" shape
the founder is now running. This does not change any scorecard verdict by
itself (the underlying features already work), but it is the highest-
leverage fix available for the *feel* of "better than Jira": a comparable
incumbent tracker's left sidebar is muscle memory for every daily-driver
user we're trying to win. See the "Navigation & IA overhaul" epic,
`docs/ROADMAP.md` Phase 5, sequenced with a light/dark mode pass (also
founder-requested) so the design-token system is touched once, coherently,
rather than twice.

**Update (2026-07-02, Pass 12):** the "Navigation & IA overhaul" Phases 1+2
(persistent left sidebar + surfacing branding/board filters/roadmap as
first-class sidebar links) and the light/dark mode pass have since shipped
and were independently re-verified by the product auditor as closing this
exact complaint — see the Onboarding row above. This finding's root-cause
diagnosis stands as the historical record of *why* the nav overhaul was
prioritized; it is no longer open work.

## The pillars (what "better than the incumbent" means here)

1. **Core PM parity** *(Phase 5 — largely shipped)* — be a credible daily driver
   first: multiple boards + board types, custom fields, a real query language (NLQL)
   + saved filters, conditional card colors, planning poker, issue
   links/dependencies, bulk edit, CSV export, workspace branding, components/versions,
   and **configurable workflows** — teams bake in their full SDLC as an editable
   status graph (allowed transitions + conditions/validators/gates + templates),
   readable and editable over MCP so an agent can introspect and reshape a
   project's SDLC the same as a human. Remaining gaps: **Swimlanes v2**
   (Kanban sections keyed off Component/Labels/custom SELECT fields, not just
   the shipped Assignee/Priority/Type/Epic dimensions) and **NLQL-native
   configurable dashboards** — every gadget, built-in or custom, is defined
   as an NLQL query + a visualization, not a bespoke widget type.
2. **Autopilot — a self-hosted AI teammate** *(Phase 6)* — private, unlimited,
   $0 AI: natural-language→NLQL, auto-triage + semantic dedupe (pgvector),
   sprint risk radar & summaries, and **MCP-native** so agents read/write issues
   (and the workflow definition) from the IDE — 55 tools and climbing, with MCP
   exposure now a standing part of every new feature's definition of done.
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
