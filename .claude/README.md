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

## Skills (`skills/`)

| Skill | Trigger |
|-------|---------|
| `add-domain-module` | "Add a new backend domain module" (e.g., labels, sprints) |
| `add-board-feature` | Work on the kanban/scrum board, drag-and-drop, or rank ordering |
| `run-stack` | Bring the app up locally and verify it works end-to-end |
| `playwright-qa` | QA / user-acceptance testing in a real browser, desktop + mobile |

Plus the vendored Superpowers skills (TDD, systematic-debugging, writing-plans, subagent-driven-development, verification-before-completion, …) listed above.

## Workflows (`workflows/`)

| Workflow | Purpose |
|----------|---------|
| `build-vertical-slice` | Take one roadmap feature from schema → API → UI → verify, in coordinated phases |
| `nightly-build-loop` | Pull the next roadmap item and implement it, looping until the MVP is complete |

Workflows here are documented as orchestration recipes. In Claude Code they are run with the `Workflow` tool (see each file for the script outline).
