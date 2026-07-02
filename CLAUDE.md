# CLAUDE.md — Next Lane

Guidance for Claude Code (and other AI agents) working in this repository.

## What this is

Next Lane is an **open-source, self-hosted issue & project tracker** that runs locally via Docker. Fully MIT-licensed, intended for the public to use and self-host. It is a TypeScript monorepo.

**North star: `docs/VISION.md`.** The product thesis — beat the dominant paid
incumbent by exploiting four structural advantages it can't match (free &
unlimited; your data/your compute; open & extensible; AI-native & agent-native).
The founder dreams in plain language; the **vision-steward** agent
(`.claude/agents/vision-steward.md`) turns those ideas into VISION/ROADMAP/BACKLOG
entries. Read VISION.md to understand *why* we're building what's in the roadmap.

## Operating principles (own the outcome)

You run this team. Do not wait to be told to optimize, fix process, or raise quality — that is your job.

1. **Be proactive.** If the workflow, an agent, or a skill is slowing us down or letting defects through, change it (update `.claude/` and these docs) without being asked. Owning the org means improving it.
2. **Ship quality the *user* feels.** "Tests pass" ≠ "works for the user." QA must exercise the **real artifact** and **real-user behavior**: per-keystroke typing (not `.fill()`), desktop AND mobile, the actual `docker compose` build, real flows end-to-end, and **cross-page state coherence** — change global state on one surface, then verify every other surface after navigation, deep-link, AND reload (see `apps/web/e2e/workspace-switcher.spec.ts` for the canonical suite). The bugs that reached the user (focus loss, compose syntax, mobile overflow, missing UI, the workspace-selector desync) all passed "green" tests — close that gap.
3. **No hand-waving.** Never dismiss a failing test/bug as "pre-existing" or "unrelated" without root-causing it. If it's real, fix it.
4. **Parallel by default.** Use isolated worktrees + per-instance DBs/ports (`dev-up-instance.sh N`) to build multiple disjoint features at once. Serial is the exception.
5. **Converge.** Drive toward the v1 release criteria in `docs/ROADMAP.md`, then polish — don't generate endless backlog without finishing.
6. **Keep docs honest** (see below) and **never push a red build.**

## Design elevation — CURRENT TOP PRIORITY (UI/UX)

The product is functionally complete; the focus now is making it **look and feel
premium, distinctive, and intentional** — not templated. This is a standing,
looping directive until told otherwise.

1. **Audit & redesign every component.** Go through **each and every** component
   and screen (`apps/web/src/components/**`, `apps/web/src/pages/**`), review it
   against the design system, and **redesign it** where it reads as generic,
   inconsistent, or dated. A redesign is *encouraged* — don't settle for tweaks.
   Track progress as a component checklist in `docs/UI-REVIEW.md` and work it down.
2. **Always use the `frontend-design` skill.** Any UI work MUST invoke the
   Anthropic `frontend-design` skill: establish a distinctive token system
   (palette / type / layout / **one signature element**), avoid AI-default looks
   (generic SaaS indigo; cream-serif-terracotta; near-black-acid-green;
   broadsheet hairlines), spend boldness in one place, keep the rest disciplined.
3. **Loop on this direction.** audit → redesign a component (design-skill led) →
   verify (tests stay green + screenshots) → next component → repeat,
   continuously, the same way the build loop works.
4. **Surface screenshots to the user during progression.** Capture before/after,
   **desktop AND mobile**, and post them back to the user as the redesign lands
   (use the file-sending mechanism) — the user wants to *see* it evolve.
5. **Cohesion first.** The design tokens + `src/components/ui/*` primitives are
   the single source of truth; every component derives from them. Fix the system,
   then ripple it outward.
6. **Never break the product.** This is a *visual* elevation: preserve every test
   hook (`data-testid`, roles, `aria-label`, accessible names, e2e-asserted text)
   so the e2e + unit suites stay green. Fonts must be **self-hosted** (the prod
   nginx CSP restricts `font-src` to `'self'`); no runtime font CDN. Quality
   floor: responsive to mobile, visible keyboard focus, `prefers-reduced-motion`,
   WCAG-AA contrast.

## Stack (do not change without updating docs/ARCHITECTURE.md)

- **Backend:** NestJS + Prisma + PostgreSQL, REST + Socket.io
- **Frontend:** React + Vite + TypeScript, Tailwind + shadcn/ui, TanStack Query, dnd-kit
- **Infra:** Docker Compose (db, redis, api, web); Redis 7; Postgres 16
- **Monorepo:** pnpm workspaces — `apps/api`, `apps/web`, `packages/shared`

## Layout

```
apps/api        NestJS backend (module/controller/service/dto per domain)
apps/web        React + Vite SPA
packages/shared Shared TS types & contracts (import in both api and web)
docs/           ARCHITECTURE.md, ROADMAP.md, RESEARCH.md
.claude/        skills, agents, workflows
```

## Commands

```bash
pnpm install
pnpm dev                 # api + web with hot reload
pnpm build               # build all packages
pnpm lint && pnpm test
pnpm db:migrate          # prisma migrate dev
pnpm db:seed             # seed demo data
docker compose up -d --build   # full stack
```

## Conventions (important)

- **Strict TypeScript.** No `any` without justification.
- **Data model = Prisma schema.** All DB changes via `prisma migrate`, never raw SQL.
- **Shared domain enums/types live in `packages/shared`.** Never duplicate them.
- **Board/sprint ordering uses fractional indexing** (rank string between neighbors). Never renumber all rows.
- **NestJS module pattern** for every domain. DTOs validated with `class-validator`.
- Keep changes scoped.

## Keep the docs in sync — NON-NEGOTIABLE

Stale docs are a defect. The roadmap once sat on "Phase 1" while Phases 2–3 had
shipped — that must never happen again.

- **Every commit that lands a feature/fix MUST, in the same commit, update status in BOTH `docs/ROADMAP.md` and `docs/BACKLOG.md`.** Tick the item, move the phase forward. A PR/commit that ships work but leaves the roadmap stale is incomplete.
- **`docs/ROADMAP.md` is the source of truth for "what phase are we in".** Its phase headers (✅/🚧/⬜) and "Current focus" line must always match reality (git history).
- **Audit-and-fix every cycle:** every audit/groom pass reconciles `docs/ROADMAP.md` + `docs/BACKLOG.md` against `git log` and ticks/advances anything that shipped but wasn't recorded. This is the groomer's job (see `.claude/agents/backlog-groomer.md`) and part of every build agent's definition-of-done.
- Definition of done for ANY change = builds + typecheck + unit/e2e green (desktop+mobile) **+ ROADMAP/BACKLOG updated** + committed & pushed.

## Work as a dev team (use agents, skills, workflows, hooks)

This project is built by a **team of specialized AI agents**, not one generalist. Default to delegating and orchestrating rather than doing everything inline. The tooling lives in [`.claude/`](./.claude/README.md).

**Agents** (`.claude/agents/`) — spin up the right specialist for the job:
- `schema-architect` — Prisma data model & migrations
- `backend-builder` — NestJS modules (controller/service/dto, gateways)
- `frontend-builder` — React/Vite UI, query hooks, dnd-kit board
- `code-reviewer` — review the diff before merge
- `qa-tester` — **independent** Playwright QA / user-acceptance testing (desktop + mobile). Keep QA separate from whoever wrote the code.
- `frontend-qa` — front-end QA / UX engineer: audits every component for visual consistency, design-system adherence, accessibility, responsive behavior, and missing states; files feedback to the dev team in `docs/UI-REVIEW.md` (read-only on app code).
- `doc-syncer` — cheap-model (haiku), commit-driven doc reconciler for the surfaces the same-commit rule doesn't cover (ARCHITECTURE.md, CHANGELOG.md, docs-site guide facts, README claims). Run it at the end of every build-loop iteration.

**Skills** (`.claude/skills/`) — invoke the matching skill before the work:
- Build process: `brainstorming` → `writing-plans` → `test-driven-development` / `subagent-driven-development` → `requesting-code-review` → `verification-before-completion` → `finishing-a-development-branch` (vendored from Superpowers).
- Project-specific: `add-domain-module`, `add-board-feature`, `run-stack`, `playwright-qa`, `ui-consistency-review`.
- Debugging: `systematic-debugging`. Parallel work: `dispatching-parallel-agents`.

**Direction-setting roles** (read-only on app code, they steer the project):
- `product-auditor` & `engineering-auditor` — **two independent** deep auditors. They rate features (product value / engineering health) from different lenses and recommend priorities, writing `docs/AUDIT-PRODUCT.md` / `docs/AUDIT-ENGINEERING.md`. They deliberately don't coordinate.
- `backlog-groomer` — product owner who keeps the dev board `docs/BACKLOG.md` current from the auditors + QA reviews, maintaining a "Ready" queue the build loop pulls from.
- `vision-steward` — turns the founder's plain-language ideas into VISION/ROADMAP/BACKLOG entries (writes docs only). See `docs/VISION.md`.
- `oss-curator` — open-source credibility & DX advocate: owns the first-impression surface (`README.md`, CONTRIBUTING/SECURITY/issue templates, badges, screenshots gallery) and keeps it credible + compelling as features ship. Truth-only (every badge/claim/quickstart verified); writes meta/docs only, never app code.

**Workflows** (`.claude/workflows/`) — orchestrate multi-phase work:
- `build-vertical-slice` — feature → schema → backend → frontend → review → QA, in coordinated phases.
- `nightly-build-loop` — work down the ROADMAP MVP items autonomously until done.
- `autonomous-dev-loop` — the full org loop: independent audits → groom the board → build the top backlog items (each fully QA'd) → **loop again on completion** (event-driven, not time-based).

**The loop for every feature:** plan → implement (specialist agent) → review (`code-reviewer`) → **functional QA with `qa-tester` on desktop AND mobile** → **UI/UX QA with `frontend-qa`** (consistency, a11y, responsive) feeding `docs/UI-REVIEW.md` back to the dev team → **update `docs/ROADMAP.md` + `docs/BACKLOG.md` (mandatory)** → **`oss-curator` refreshes the README/first-impression surface when shipped features change what we can credibly claim** → commit. Never mark work done without the `verification-before-completion` evidence, and never leave the roadmap or the README stale.

## Working style for autonomous build

- Track work via the task list / ROADMAP. Commit in logical, working increments.
- Prefer getting a thin vertical slice working end-to-end over broad-but-broken.
- After significant changes, ensure the project still builds and `docker compose` config is valid.
- Develop on the current `claude/*` working branch; never push to `main` without explicit permission.

## Known environment constraints (this build session)

- Outbound network is restricted to package registries (npm/pypi/etc.) and Anthropic. General GitHub and arbitrary web are **blocked** by egress policy. Use npm packages, not git clones, for dependencies.
