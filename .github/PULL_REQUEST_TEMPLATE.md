<!--
  Thanks for contributing to Next Lane! Please fill out the sections below.
  See CONTRIBUTING.md for setup, conventions, and the workflow.
-->

## What does this PR do?

A clear, concise description of the change and the motivation behind it.

## Related issues

<!-- e.g. "Closes #123" / "Relates to #456" -->

## Type of change

- [ ] 🐛 Bug fix
- [ ] ✨ New feature
- [ ] ♻️ Refactor (no functional change)
- [ ] 📝 Documentation
- [ ] 🧪 Tests / CI
- [ ] 🔧 Chore / build / infra

## How was this tested?

Describe the tests you ran and how to verify the change. For UI changes, please
confirm **desktop AND mobile**.

- [ ] `pnpm build` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm test` passes
- [ ] Verified manually in the running app (desktop + mobile if UI)

## Screenshots (for UI changes)

| Before | After |
|--------|-------|
|        |       |

## Checklist

- [ ] My code follows the project conventions (see [CONTRIBUTING.md](../CONTRIBUTING.md) and [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md))
- [ ] Strict TypeScript — no unjustified `any`
- [ ] Database changes go through Prisma migrations (no manual SQL)
- [ ] Shared types live in `packages/shared` (not duplicated)
- [ ] I updated relevant docs (`docs/ROADMAP.md` / `docs/BACKLOG.md`) if this ships a feature/fix
- [ ] PR is focused on a single feature or fix
