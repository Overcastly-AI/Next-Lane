# Workflow: nightly-build-loop

Autonomously work down `docs/ROADMAP.md`, implementing the next unfinished MVP item each iteration, until the MVP is complete or the token budget runs out. Designed for long unattended runs.

## How it operates

1. Read `docs/ROADMAP.md` and pick the next ⬜ item in Phase 1 (MVP), in order.
2. Run the **build-vertical-slice** workflow for that item.
3. Commit the result with a conventional-commit message; push to the dev branch.
4. Mark the item ✅ in `docs/ROADMAP.md`.
5. Repeat until no ⬜ MVP items remain, or `budget.remaining()` is too low to safely start another slice.

## Guardrails
- Each iteration must leave the repo in a **building, committed** state — never push a broken build.
- Use the `verification-before-completion` skill before marking anything done.
- If a slice fails twice, stop, leave a note in the commit/PR, and surface a summary instead of looping forever.
- Prefer thin, working slices over broad, broken ones.

## Script outline

```js
export const meta = {
  name: 'nightly-build-loop',
  description: 'Implement Next Lane MVP roadmap items one by one until done',
  phases: [{title:'Pick'},{title:'Build'},{title:'Commit'}],
}
let dry = 0
while (dry < 2 && (!budget.total || budget.remaining() > 120_000)) {
  phase('Pick')
  const next = await agent('Read docs/ROADMAP.md; return the next unfinished Phase 1 item or null.', {schema: ITEM_SCHEMA})
  if (!next.item) { dry++; continue }
  dry = 0
  phase('Build')
  await workflow('build-vertical-slice', { feature: next.item })
  phase('Commit')
  await agent(`Commit and push the work for "${next.item}"; mark it done in docs/ROADMAP.md.`)
}
```

## Resuming
Re-run with `resumeFromRunId` to continue from where a previous run stopped; completed slices return from cache.
