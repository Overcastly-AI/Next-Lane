# Workflow: build-vertical-slice

Take one roadmap feature from data model → API → UI → verification in coordinated phases. Run with the Claude Code `Workflow` tool.

## Inputs
`args = { feature: "<roadmap item>", notes?: "<constraints>" }`

## Phases

1. **Plan** — one agent reads `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, and the Prisma schema; produces a concrete slice plan (entities, endpoints, UI surfaces, acceptance checks). Schema-validated output.
2. **Schema** — `schema-architect` applies any Prisma changes + migration. Skipped if the model already supports the feature.
3. **Backend** — `backend-builder` implements the NestJS module(s) and Socket.io events. Must compile (`pnpm --filter @next-lane/api build`).
4. **Frontend** — `frontend-builder` implements the UI + TanStack Query hooks (+ dnd-kit if board-related). Must compile (`pnpm --filter @next-lane/web build`).
5. **Review** — `code-reviewer` reviews the diff; findings are fixed before finishing.
6. **Verify** — run the `run-stack` skill: bring the stack up, exercise the new flow, confirm acceptance checks pass.

## Script outline

```js
export const meta = {
  name: 'build-vertical-slice',
  description: 'Implement one Next Lane roadmap feature end-to-end',
  phases: [{title:'Plan'},{title:'Schema'},{title:'Backend'},{title:'Frontend'},{title:'Review'},{title:'Verify'}],
}
phase('Plan')
const plan = await agent(`Plan the slice for: ${args.feature}. ${args.notes ?? ''}`, {schema: PLAN_SCHEMA})
phase('Schema')
if (plan.needsSchema) await agent(`Apply schema changes: ${JSON.stringify(plan.schema)}`, {agentType:'schema-architect'})
phase('Backend')
await agent(`Implement backend: ${JSON.stringify(plan.backend)}`, {agentType:'backend-builder'})
phase('Frontend')
await agent(`Implement frontend: ${JSON.stringify(plan.frontend)}`, {agentType:'frontend-builder'})
phase('Review')
const review = await agent('Review the current diff.', {agentType:'code-reviewer', schema: REVIEW_SCHEMA})
// fix 🔴/🟡 findings, then verify
```

## Done when
- Both apps build, the feature works in a running stack, ROADMAP status updated, changes committed.
