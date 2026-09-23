# Workflow: improve-ui

Drive one design-elevation pass over the web UI: survey the real running app, audit
the worst surfaces independently, throw out the findings that are only taste, redesign,
and prove nothing broke. Run with the Claude Code `Workflow` tool.

Serves the standing directive in `CLAUDE.md` § *Design elevation — CURRENT TOP PRIORITY*:
audit → redesign (design-skill led) → verify → next component, continuously.

## Inputs

```
args = {
  surfaces?: ["BoardPage", "IssueDetailDrawer"],  // skip the survey and go straight at these
  count?: 3,                                       // how many surfaces to redesign (default 3)
  focus?: "density and hierarchy"                  // optional steer for the survey
}
```

## Phases

1. **Survey** — one agent stands the stack up, drives the app, and returns the surfaces
   most in need of work, ranked, each with a *reason* and a screenshot. Skipped when
   `args.surfaces` is given.
2. **Audit** — one `frontend-qa` agent per surface, in parallel. Read-only. Each returns
   concrete findings: design-system deviation, hierarchy, density, a11y, responsive,
   missing states (loading / empty / error / long-content).
3. **Sift** — one skeptic per finding, in parallel, prompted to *refute*. UI audits
   generate opinion dressed as defect; anything that cannot be tied to a rule, a token,
   a broken state or a measurement is dropped here. This phase exists to keep the
   redesign honest, and it should be expected to kill a good fraction of the findings.
4. **Redesign** — `frontend-builder`, **one surface at a time, sequentially, in the shared
   tree**. See *Why the build phase is serial* below — this is not an oversight.
5. **Verify** — per surface: e2e desktop **and** mobile, plus before/after screenshots.
6. **Record** — append the pass to `docs/UI-REVIEW.md` with what shipped, what was
   refuted, and what is left.

## Why the build phase is serial

Fanning builders out across one working tree corrupts it. Two agents running
`git add`/`commit` against a shared index will sweep each other's unstaged edits, and
concurrent `pnpm build` in the same package deletes `dist/` under a sibling mid-run.
Both have happened in this repo.

`isolation: 'worktree'` fixes the corruption but is wrong *here* for a second reason:
a design pass touches shared tokens and `src/components/ui/*` primitives, and three
agents each evolving the token system in isolation produces three incompatible designs
and three branches to reconcile. Cohesion is the point of a design pass.

So: audits and skeptics fan out wide (read-only, no tree writes), and the redesign walks
the surfaces one at a time onto one branch.

## Environment (hard-won — get these wrong and you lose an hour)

- **The API reads `API_PORT`, not `PORT`** (`apps/api/src/main.ts`). `PORT=4110` silently
  binds 4000 and collides with whatever else is up.
- **`rm -rf dist *.tsbuildinfo` before `pnpm build` in `apps/api`.** A stale
  `.tsbuildinfo` makes `nest build` exit 0 and emit nothing at all.
- **`pnpm --filter @next-lane/shared build` before typechecking `apps/api`** — the API
  compiles against shared's `dist`, so a stale one produces a wall of phantom errors.
- **Playwright needs `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium`** — the sandbox
  Chromium is older than the pinned `@playwright/test`.
- **`PW_API_URL` points the e2e *request fixture* at the API; `VITE_API_URL` only points
  the browser bundle.** Setting one and not the other yields `ECONNREFUSED 127.0.0.1:4000`
  that reads exactly like a product failure. Check *why* a spec failed before believing it.
- Give every concurrent agent its **own DB and its own ports**, and kill **only your own
  PID** at the end — never a bare `pkill -f 'dist/main.js'`, which matches siblings and
  the harness shell.

## Script outline

```js
export const meta = {
  name: 'improve-ui',
  description: 'Survey, audit, sift, redesign and verify one design-elevation pass over the web UI',
  phases: [
    { title: 'Survey' }, { title: 'Audit' }, { title: 'Sift' },
    { title: 'Redesign' }, { title: 'Verify' }, { title: 'Record' },
  ],
}
phase('Survey')
const targets = args?.surfaces ?? (await agent(SURVEY_PROMPT, {schema: SURVEY_SCHEMA})).surfaces
phase('Audit')
const audits = await parallel(targets.map((s, i) => () =>
  agent(auditPrompt(s, i), {agentType: 'frontend-qa', phase: 'Audit', schema: FINDINGS_SCHEMA})))
const findings = audits.filter(Boolean).flatMap(a => a.findings)
phase('Sift')
const kept = (await parallel(findings.map(f => () =>
  agent(refutePrompt(f), {phase: 'Sift', schema: VERDICT_SCHEMA}).then(v => v && !v.refuted ? f : null))))
  .filter(Boolean)
phase('Redesign')
for (const s of targets) {                       // SEQUENTIAL — see above
  await agent(buildPrompt(s, kept), {agentType: 'frontend-builder', phase: 'Redesign'})
}
phase('Verify') // e2e desktop + mobile, screenshots
phase('Record') // append to docs/UI-REVIEW.md
```

## Done when

- Every kept finding is either fixed or explicitly deferred with a reason.
- `pnpm --filter @next-lane/web lint` + `test` + the touched e2e green on **both** viewports.
- Before/after screenshots captured at desktop and mobile and surfaced to the founder.
- `docs/UI-REVIEW.md` records the pass; `docs/ROADMAP.md` / `docs/BACKLOG.md` updated in
  the same commit as the code.
- No test hook (`data-testid`, role, `aria-label`, e2e-asserted text) removed.
