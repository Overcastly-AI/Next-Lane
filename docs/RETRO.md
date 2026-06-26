# Next Lane — Build Retrospective & Autonomous-Loop Spec

Date: 2026-06-26 · Author: orchestrator (Claude) · Status: action items in progress

This retro is brutally honest about the one thing that didn't work: **the build
loop was not reliably autonomous overnight.** The owner had to wake up several
times to restart it. This document analyzes why and specifies the fix.

---

## 1. Where the project actually is

- **Shipped:** full MVP (auth, workspaces, projects, kanban board w/ drag-and-drop
  fractional ranks, issues CRUD, comments, activity, labels read, sprints API,
  realtime) + a hardening wave: realtime gateway auth, tenant-FK ownership
  validation, role enforcement (VIEWER/MEMBER/ADMIN), JWT_SECRET fail-fast (+ its
  bypasses), CORS allowlist, and UI-review fixes (Badge labels, first-class drawer
  overlay, toast system, themed dialogs).
- **Quality:** 19 commits, 9 Playwright specs / 58 tests passing on desktop +
  mobile. API verified end-to-end against real Postgres.
- **Process assets:** two independent auditors, backlog groomer, frontend-QA,
  build agents, dev-team docs, a groomed `docs/BACKLOG.md`.

This part went **well**. The build *quality* and the audit→groom→build *structure*
are sound — when they ran.

## 2. What went wrong: the loop stalled and needed human restarts

Symptom: after a batch finished, the loop frequently went idle until the owner
sent a message ("Go", "Continue…", "are you sure they're running?"). For an
"overnight, while I sleep" mandate, that is a failure.

### Root causes

1. **No heartbeat / watchdog.** The loop was purely *completion-driven*: each
   finished background task re-invoked the orchestrator, which dispatched the next.
   There was **no fallback** to wake the orchestrator if a completion signal never
   arrived. Any gap → permanent idle.
2. **The `Workflow` tool died on a permission-stream error** (twice:
   "Tool permission stream closed before response received"). That was the cleanest
   continuous mechanism; losing it forced manual per-item Agent orchestration with
   more gaps.
3. **The time-based cron safety net was removed.** Per a "not time based" request I
   deleted the recurring cron — which had been the only thing that could recover a
   stall. Event-driven *without* a heartbeat has no recovery path.
4. **A barrier on a flaky step.** Builds were sequenced *behind* the audit→groom
   phase. When the `product-auditor` died on a transient "Internal server error"
   (twice), the groom never ran, and the **entire build pipeline stalled** even
   though the Ready queue was full and shippable.
5. **Single points of failure weren't retried/bypassed.** One flaky agent could
   block everything; there was no "skip and continue" or auto-retry policy.

### What went well (keep)

- Green-only commits with revert-on-failure: **no broken build was ever pushed.**
- Self-healing dev env (`dev-up.sh`) recovered the API/web every time.
- Independent auditing earned its keep: the engineering re-audit caught that the
  JWT fail-fast fix was **incomplete** (default secret still reachable) — a
  regression the implementer missed.
- Test-isolation fix prevented data-pollution from silently red-ing the suite.

## 3. The fix — spec for a loop that survives unattended

Principle: **completion-driven for speed, watchdog-backed for survival.** The
owner's "not time based" intent (don't *wait* a fixed interval between iterations)
is preserved — the watchdog is a *stall-recovery* fallback, not the pacer. It only
acts when the loop is idle; when work is in flight it no-ops and re-arms.

### 3.1 Watchdog (the missing piece)

- A recurring `CronCreate` job (~every 20 min) fires a **stall-recovery** prompt:
  1. If a build/audit agent is still running (recent transcript activity) → do
     nothing, end. (No double-dispatch.)
  2. Else if the working tree is dirty → commit/clean per policy, then continue.
  3. Else dispatch the **next Ready item** from `docs/BACKLOG.md` (build → verify →
     green-only commit).
- Idempotent and cheap: a no-op when healthy; a restart when stalled. This alone
  fixes "I had to wake you up."

### 3.2 Never barrier shipping on planning

- Build loop pulls from the **existing** `docs/BACKLOG.md` Ready queue at all times.
- Audits + groom run as an **async side-channel** (every N items or T minutes),
  refreshing the board. A dead auditor can never stall builds.

### 3.3 Resilience policy

- Transient agent failures (API 5xx) → auto-retry once; on second failure, **skip
  and continue** to the next item, logging it — never block the pipeline.
- Auditors **write-early** (append findings incrementally) so a late crash doesn't
  lose the work.
- Every iteration ends by **arming the next** (dispatch or watchdog), so the loop
  can never reach a state with nothing scheduled.

### 3.4 Definition of "autonomous" (acceptance)

The loop is autonomous iff, with **zero** human messages for 8 hours, it: keeps
the build green, ships Ready items, refreshes the board from audits, and recovers
from any single agent/tool failure on its own. Owner intervention should be
*optional* (steering), never *required* (restarting).

## 4. Action items

- [ ] Install a stall-recovery **watchdog** cron (§3.1). — *highest priority; this
      is the actual fix for the wake-ups.*
- [ ] Decouple build loop from audit/groom (§3.2): always build from the current
      Ready queue; audits refresh asynchronously.
- [ ] Add retry-once-then-skip for flaky agents (§3.3).
- [ ] Commit the pending Pass-2 engineering audit; run groom to fold in new P0s
      (assigneeId validation, GET /users tenant leak, global exception filter,
      stale socket token).
- [ ] Continue the build queue: those P0 isolation fixes, then agile features
      (backlog/sprints UI, labels UI, story-points/epics).

## 5. One-line takeaway

The work was good; the *orchestration* was fragile because it had no recovery path.
Adding a cheap idempotent watchdog + never barriering shipping on a flaky planning
step makes it genuinely run-while-you-sleep.
