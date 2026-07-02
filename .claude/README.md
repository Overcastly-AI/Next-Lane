# Claude Code tooling for Next Lane

This directory contains Claude Code **skills**, **agents**, and **workflows** tuned for building Next Lane. They encode the project's conventions so AI-assisted contributions stay consistent.

## Vendored: Superpowers skills

The 14 skills below come from **[obra/superpowers](https://github.com/obra/superpowers)** v6.0.3 by Jesse Vincent (MIT licensed — see `skills/SUPERPOWERS-LICENSE`). They were downloaded via `raw`/`codeload` GitHub endpoints and vendored here so the team and CI have them without needing the plugin installed:

`brainstorming`, `dispatching-parallel-agents`, `executing-plans`, `finishing-a-development-branch`, `receiving-code-review`, `requesting-code-review`, `subagent-driven-development`, `systematic-debugging`, `test-driven-development`, `using-git-worktrees`, `using-superpowers`, `verification-before-completion`, `writing-plans`, `writing-skills`.

To get upstream updates (and the session-start hook) directly, you can also run `/plugin marketplace add obra/superpowers`.

> The Hunter-and-Fisher sibling repo was also requested as a source but was unreachable from this build environment (its GitHub host is outside the session's allowed scope).

## Agents (`agents/`)

| Agent | Use it for |
|-------|-----------|
| `backend-builder` | Implementing NestJS modules (controller/service/dto) against the Prisma schema |
| `frontend-builder` | Building React + Vite UI: pages, components, TanStack Query hooks, dnd-kit boards |
| `schema-architect` | Designing/evolving the Prisma data model and migrations |
| `code-reviewer` | Reviewing a diff for correctness, conventions, and security |
| `qa-tester` | Independent Playwright QA / user-acceptance testing on desktop + mobile |
| `frontend-qa` | Front-end QA / UX: component consistency, a11y, responsive audit → `docs/UI-REVIEW.md` |
| `product-auditor` | Independent deep product/UX audit; rates features, steers backlog → `docs/AUDIT-PRODUCT.md` |
| `engineering-auditor` | Independent deep engineering audit (quality/security/debt); steers backlog → `docs/AUDIT-ENGINEERING.md` |
| `backlog-groomer` | Maintains the dev board `docs/BACKLOG.md` from auditor + QA input; keeps a ready queue |
| `vision-steward` | Turns the founder's plain-language ideas into `docs/VISION.md` / ROADMAP / BACKLOG entries; owns the Better-than-Jira scorecard (writes docs only) |
| `doc-syncer` | Cheap-model (haiku) commit-driven reconciler for ARCHITECTURE.md, CHANGELOG.md, docs-site facts, README claims — run at the end of every build-loop iteration |
| `oss-curator` | OSS credibility & DX: owns README + community/meta docs (CONTRIBUTING, SECURITY, templates, badges); truth-only, never app code |

## Skills (`skills/`)

| Skill | Trigger |
|-------|---------|
| `add-domain-module` | "Add a new backend domain module" (e.g., labels, sprints) |
| `add-board-feature` | Work on the kanban/scrum board, drag-and-drop, or rank ordering |
| `run-stack` | Bring the app up locally and verify it works end-to-end |
| `playwright-qa` | QA / user-acceptance testing in a real browser, desktop + mobile |
| `ui-consistency-review` | Design/UX audit of components → prioritized feedback in `docs/UI-REVIEW.md` |
| `frontend-design` | ANY UI work (mandatory per CLAUDE.md's design-elevation directive) — distinctive, intentional visual design; vendored Anthropic skill (see its `LICENSE.txt`) |

Plus the vendored Superpowers skills (TDD, systematic-debugging, writing-plans, subagent-driven-development, verification-before-completion, …) listed above.

## Workflows (`workflows/`)

| Workflow | Purpose |
|----------|---------|
| `build-vertical-slice` | Take one backlog item from schema → API → UI → review → QA, in coordinated phases |
| `nightly-build-loop` | Pull the next roadmap item and implement it, looping until the MVP is complete |
| `autonomous-dev-loop` | The org loop: 2 independent auditors → groom the board → build the top items with QA → repeat **on completion** (not on a timer) |

Workflows here are documented as orchestration recipes. In Claude Code they are run with the `Workflow` tool (see each file for the script outline).
