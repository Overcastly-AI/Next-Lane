# Workflow: autonomous-dev-loop

The full Next Lane "org" loop. Two independent auditors set direction, the groomer maintains the board, and the build loop ships the top items — each fully reviewed and QA'd. It loops **on completion** (start the next batch as soon as the current one finishes), not on a fixed timer.

## Cadence — completion-driven, not time-based
Each invocation runs **one batch** (audit → groom → build N items). When the batch finishes, the orchestrator immediately launches the next batch (re-invoke on completion / `ScheduleWakeup` with the floor delay), so iterations chain back-to-back. There is no wall-clock interval. Stop only when the board's Ready queue is empty and the auditors propose nothing new, or the user says stop.

## Phases per batch
1. **Audit (parallel, independent)** — `product-auditor` and `engineering-auditor` deeply review the current app and append ratings + prioritized recommendations to their audit docs. They do not see each other's output first.
2. **Groom** — `backlog-groomer` ingests both audits + `docs/UI-REVIEW.md` + roadmap + git history, dedupes, reprioritizes, and refreshes the **Ready** queue in `docs/BACKLOG.md`.
3. **Build (sequential, commit-safe)** — pull the top N Ready items; for each: implement via `backend-builder` / `frontend-builder`, then `code-reviewer`, then **`qa-tester`** (functional, desktop + mobile) and a `frontend-qa` spot-check. Commit + tick the board **only if green**; otherwise revert and leave it on the board.

## Guardrails
- Never push a red build. One commit per item; build sequentially so commits don't collide.
- Bounded batch size (N≈2–3) so each run is reviewable; the loop continues across batches.
- Read-only roles (auditors, QA) never touch app code.
- Keep the seeded demo working. Never reintroduce trademarked terms.

## Script outline
```js
export const meta = { name:'autonomous-dev-loop', description:'Audit → groom → build, looping on completion',
  phases:[{title:'Audit'},{title:'Groom'},{title:'Build'}] }
phase('Audit')
await parallel([
  () => agent('Deep product audit; append docs/AUDIT-PRODUCT.md; return ready items.', {agentType:'product-auditor'}),
  () => agent('Deep engineering audit; append docs/AUDIT-ENGINEERING.md; return ready items.', {agentType:'engineering-auditor'}),
])
phase('Groom')
await agent('Refresh docs/BACKLOG.md Ready queue from audits+UI review+roadmap.', {agentType:'backlog-groomer'})
phase('Build')
const ready = /* parse top N from docs/BACKLOG.md */ []
for (const item of ready) {
  await agent(`Implement, QA (desktop+mobile), and commit-if-green: ${item}. Revert on failure.`)
}
// on completion: orchestrator launches the next batch
```
