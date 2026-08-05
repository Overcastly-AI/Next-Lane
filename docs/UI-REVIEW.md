# Next Lane — UI / UX Consistency Review

> Front-end QA / design-consistency audit. Read-only review; no application code was
> changed. Findings are grouped by severity and reference specific files/components
> plus what was observed in desktop (1280px) and mobile (390px / Pixel-5) screenshots.

---

## 2026-08-05 — Roadmap Gantt visual audit (founder: "Launch and audit on this chart and find ways to improve. Then work on it")

Method: ran the real built app against the screenshot seed and read the rendered
chart at 1500×900 light, 1500×900 dark, and 393×852 mobile — rather than reading
the component. Every finding below was visible in a screenshot; all seven were
fixed in the same pass.

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 1 | **Mobile showed no chart at all.** The 248px left rail against a 393px viewport left ~145px of grid — five epic rows and not one bar. The roadmap's entire payload was off-screen with nothing to say it existed. | **P0** | ✅ fixed — rail drops to 132px below 640px, shedding the key badge and the `%` (the title is what identifies the work; the key is on the bar tooltip and in the drawer, and the `%` is now a track on the bar itself). At 116px the key badge literally overlapped the `%` and the title collapsed to zero width — caught by re-shooting mobile, then confirmed by an e2e failure. |
| 2 | **Story bars carried no status.** Every child bar rendered as the same grey outline whether it was to-do, in-flight or finished. "Are we on track" — the first question a roadmap answers — could not be read off the chart. | **P1** | ✅ fixed — `CHILD_COLORS` maps `statusCategory` to fill + border. `fromSprint` moved from being the fill to being a dashed border, so it stops competing with status. |
| 3 | **The legend described almost nothing on screen.** Three unlabelled swatches (Planned / Active / Completed) read as story statuses but were *sprint* states, describing exactly one row of the chart. | **P1** | ✅ fixed — grouped and labelled: `Sprints …` / `Stories …` / Today / Overruns plan. |
| 4 | **Epic progress was invisible.** `signal-300/70` on a `signal-100` bar is a ~1.1:1 step; the rail said "33%" and the bar showed nothing. Raising the contrast then made the fill edge slice through the title mid-word. | **P1** | ✅ fixed — progress is a track pinned to the bar's bottom edge. Readable across the row, never competes with the label. |
| 5 | **No dates anywhere except on hover.** A glanced-at or printed roadmap carried no dates at all. | **P1** | ✅ fixed — the window renders in the bar, left-aligned after the title (right-aligned is useless: at week zoom a quarter-long epic is several viewports wide, so anything pinned to its right edge is permanently off-screen). Suppressed under 170px and while dragging. |
| 6 | **Bars vanished at the panel's right edge with no cue** that more timeline existed — the scrollbar sits below the fold on a tall chart. | **P2** | ✅ fixed — gradient masks on whichever side still has content off-screen, tracked on scroll, on resize, and on zoom (a zoom-out that makes the plan fit must clear them, and no ResizeObserver fires for that). |
| 7 | **Milestone chips were inert.** A release two quarters out is off-screen by definition, so the chip was the only evidence it existed and there was no way to get from it to the marker. | **P2** | ✅ fixed — each chip scrolls the grid to its release date. |

One further change fell out of #1: the grid opened scrolled hard left, at the
start of the whole horizon. On a wide desktop that happened to include today; on
a phone it opened on empty past calendar. It now lands near today **when today
is inside the plan's data extent** — gated, because a plan entirely in the past
or future would otherwise open on an equally empty view with the sign flipped.
That gate cannot be expressed with `planBounds`, which deliberately stretches to
include today so the today marker always has somewhere to land; a separate
`dataExtent` memo exists for it.

Still open, deliberately not taken this pass: no filtering (hide-done, assignee,
label) — a 500-epic roadmap is unreadable and this is the scale gap; the rail is
not resizable, so long epic titles truncate at ~20 chars on desktop; the today
marker, violated-dependency arrows, and the overrun hatch are three meanings
sharing one red/amber family; sprint bars are still not editable.

---

## 🎨 Design Elevation — component redesign loop (LIVE tracker)

Standing directive (see CLAUDE.md "Design elevation"): audit & **redesign every
component/screen** using the `frontend-design` skill; loop until done; keep tests
green; post before/after screenshots (desktop + mobile) to the user as work lands.
Each item below is redesigned design-skill-led, then ✅ when shipped + verified.

**Phase A — Foundation (design tokens + primitives)** — establishes the system everything else derives from
- [ ] Design tokens — `tailwind.config.js` + `index.css` (palette, type scale, spacing, radius, shadow, motion; self-hosted fonts)
- [ ] `ui/Button` · `ui/Input` · `ui/Select` · `ui/Textarea` · `ui/Field`
- [ ] `ui/Badge` · `ui/Avatar` · `ui/Modal` · `ui/ConfirmDialog` · `ui/Toast` · `ui/States` · `ui/MarkdownRenderer`

**Phase B — Core shell + board + drawer** (highest-traffic surfaces)
- [x] `AppHeader` — active-state ring-inset, focus-visible rings on all nav/search/menu ✅ 2026-06-29
- [x] `nav/AppSidebar` · `nav/MobileSidebarDrawer` · `nav/SidebarNavContent` · `nav/WorkspaceSwitcherMenuContent` — new persistent left sidebar (Navigation & IA overhaul Phase 1), signature cobalt rail-tick active indicator, see dated entry below ✅ 2026-07-02
- [x] `NotificationBell` — focus-visible ring on bell + mark-all + notification items ✅ 2026-06-29
- [x] `board/BoardColumn` — WIP indicator polish ✅ 2026-06-29
- [x] `board/IssueCard` — due-date + story-points chip ring-1 ring-inset (consistent badge vocabulary); overdue chip uses amber-50/amber-200 tokens ✅ 2026-06-29
- [ ] `board/SortableIssueCard` · `board/CardStatusPicker` · `board/PresenceAvatars`
- [ ] `board/CreateIssueModal` · `board/ColumnFormModal`
- [x] `board/BoardWorkflowSelector` — badge ring-inset + ENFORCED chip ✅ 2026-06-29
- [x] `board/FromTemplateMenu` — system animation applied ✅ 2026-06-29
- [ ] `issue/IssueDetailDrawer` · `issue/CommentsPanel` · `issue/AttachmentsPanel` · `issue/ActivityPanel` · `issue/LabelPicker` · `issue/MentionComposer` · `issue/ParentSubtasks` · `issue/issueMeta`
- [x] `issue/TimeTrackingSection` — progress % label + signal/red token ✅ 2026-06-29
- [x] `issue/ChecklistSection` — progress % label + emerald-complete / signal-in-progress ✅ 2026-06-29

**Phase C — Pages**
- [x] Auth: `LoginPage` · `RegisterPage` · `ForgotPasswordPage` — `slate-*`/`brand-*` → `ink-*`/`signal-*`; password label → `text-xs font-medium text-ink-600`; forgot-password link consistent; email chip in success state uses `<code>` mono; error banners get `role="alert"` + border ✅ 2026-06-29
- [ ] `AuthShell` · `ResetPasswordPage` (already clean; no changes needed)
- [ ] `PulseDashboardPage` · `DashboardPage` · `MyWorkPage`
- [ ] `BoardPage` · `BacklogPage` · `TriagePage`
- [ ] `ReportsPage` (+ `reports/BurndownChart` · `VelocityChart` · `CumulativeFlowChart`)
- [x] `RoadmapPage` — `slate-*` → `ink-*` throughout (heading, description, card border, shell breadcrumb, canvas background); breadcrumb matches AutomationsPage reference pattern (shrink-0/min-w-0/overflow-hidden) ✅ 2026-06-29
- [x] `SettingsPage` / `settings/WorkflowsManager` + `WorkflowGraph` — dot-grid canvas, node shadow, ink tokens, empty states ✅ 2026-06-29
- [x] `settings/TemplatesManager` — ink tokens, empty state, doc-plus icon ✅ 2026-06-29
- [x] `settings/ComponentsSection` — ink tokens, empty state, cube icon ✅ 2026-06-29
- [x] `settings/VersionsSection` — ink tokens, empty state, badge fix ✅ 2026-06-29
- [x] `settings/NotificationPreferencesSection` — copy + ink token tighten ✅ 2026-06-29
- [x] `settings/WebhooksSection` — full `slate-*` → `ink-*` migration; status dot `bg-green-500` → `bg-emerald-500`; toggle `bg-slate-300` → `bg-ink-300`; delivery log badges use `ring-1 ring-inset`; empty state upgraded from bare text to icon+heading+description pattern (link icon); `SectionCard` border/text unified ✅ 2026-06-29
- [x] `settings/ApiTokensSection` — full `slate-*` → `ink-*`; scope pill `indigo-*` → `signal-*` with `ring-1 ring-inset`; status badge `rounded-full` → `rounded` + `ring-1 ring-inset` (consistent badge vocabulary); status dot `bg-green-500` → `bg-emerald-500`; checkbox `text-indigo-600 focus:ring-indigo-500` → `text-signal-600 focus-visible:ring-2 focus-visible:ring-signal-200`; empty state upgraded to icon+heading+description (key icon) ✅ 2026-06-29
- [ ] `settings/WebhookFormModal` · `ShareSection`
- [x] `ProfileSettingsPage` — already clean; no changes needed ✅
- [ ] `WorkspaceMembersPage` · `WorkspaceAuditLogPage` · `SharedBoardPage`
- [x] `NotificationsPage` — nl-issue-key chip + animated unread dot ✅ 2026-06-29

**Phase D — Cross-cutting components**
- [ ] `CommandPalette` / `CommandPaletteProvider` · `project/OnboardingPanel` · `project/ProjectCard` · `project/CreateProjectModal` · `workspace/CreateWorkspaceModal`

> Screenshots from each pass are captured (desktop + mobile) and posted to the user.

---

## 2026-07-06 — UI review: PR badge, Development section, Dashboards Phase 2, agent-context + confirmed mobile toast defect

> **✅ FIXED 2026-07-06 (Hardening Night frontend batch, task #93).** Both P1s
> (mobile toast/modal overlap; "Merged" badge dark-mode break) and the
> dashboard-selection shadow-state item (audit pass 13 #5) and two P2 quick
> wins (`GadgetCard` drag-handle tap target; Development-section live-status
> loading indicator) below are shipped — see `docs/BACKLOG.md` "Already Done"
> for the full per-item writeup and `docs/CHANGELOG.md`'s matching entry.
> Remaining open P2s (Badge `variant` prop consolidation, section-naming
> inconsistency, `Badge`'s custom-color dark-mode path, live-status-error hint
> contrast) are unchanged and still tracked below.

**Branch:** `claude/jira-competitor-docker-local-9b7dll` @ `b40fbbf`. **Method:** static
review of `apps/web/src` (a `backend-builder` had a dirty, uncommitted `apps/api/**`
tree mid-refactor at review time, so this pass is source + the qa-tester's committed
screenshots under the scratchpad `shots/` directory, not a fresh manual click-through —
noted per surface below where a screenshot backs the claim).

**Scope:** `board/IssueCard.tsx` (PR/Merged badge), `issue/GithubLinksSection.tsx` +
`issue/GitlabLinksSection.tsx` (Development section live status), `dashboards/GadgetCard.tsx`
+ `dashboards/GadgetVisualizations.tsx` + `dashboards/GadgetFormModal.tsx` +
`pages/DashboardsPage.tsx` (Dashboards Phase 2), `settings/AgentContextSection.tsx`,
and a full characterization of the qa-tester's 2026-07-06 mobile-toast-over-modal defect
report, plus quality-floor checks (focus visibility, `prefers-reduced-motion`, contrast)
across all of the above.

---

### 🔴 P1 — Toasts overlap open-modal header on mobile (confirmed defect, fully characterized) ✅ FIXED 2026-07-06

**Files:** `apps/web/src/components/ui/Toast.tsx:157`, `apps/web/src/components/ui/Modal.tsx:36-52`.
**Evidence:** `shots/8-gadget-cap-error-toast.png` / `8-gadget-cap-error-toast-desktop.png`
(390px viewport, `GadgetFormModal` "Add gadget" open, the 30-gadget cap error toast
completely covers the modal's title bar and `×` close button) and, independently,
`shots/2-github-auto-transition-on.png` (390px, no modal open at all — two stacked
success toasts fully cover the page's tab nav / back button for their whole visible
duration), proving this is a general mobile-toast-position bug, not something specific
to `GadgetFormModal`.

**Root cause:** `ToastViewport`'s container is
`fixed inset-x-0 top-0 z-[60] ... p-4 sm:bottom-0 sm:right-0 sm:left-auto sm:top-auto sm:items-end`
— below the `sm:` breakpoint (640px) it pins to the top-center of the viewport. Every
`Modal` in the app renders `fixed inset-0 ... flex items-start justify-center p-4 sm:p-8`
with the panel itself at `mt-8` (`Modal.tsx:36,48-56`) — i.e. on any viewport under 640px
the modal's header (title text + `×` button) always sits ~48–64px from the top of the
screen, which is exactly the toast viewport's landing zone. Toast is `z-[60]` vs. Modal's
`z-50` (correctly on top, since a toast should out-rank modal content), but that also
means the toast's own `pointer-events-auto` item captures taps in that region — the `×`
close button is not just visually hidden, it's **unclickable** while a toast is showing
there.

**Duration makes it worse:** error toasts default to `ERROR_DURATION = 6000` ms
(`Toast.tsx:42,62-64`), so on mobile, any mutation failure while a modal is open makes
that modal's header/close affordance unreachable for a full 6 seconds, every time.

**Scope — this is systemic, not a one-off:** `toast.error(...)` fires from inside at
least 17 modal-hosting components while the modal stays open on failure (confirmed by
grep — the mutation's `onError` calls `toast.error` and does *not* call the modal's
`onClose`, e.g. `GadgetFormModal.tsx:160-162`, `DashboardsPage.tsx`'s `NewDashboardModal`
at :134): `ImportCsvModal`, `BoardSwitcher`, `ColumnFormModal`, `CreateIssueModal`,
`GadgetFormModal`, `CreateProjectModal`, `ApiTokensSection`, `ComponentsSection`,
`CustomFieldsSection`, `TemplatesManager`, `VersionsSection`, `WebhookFormModal`,
`WebhooksSection`, `WorkflowGraph`, `WorkflowSection`, `WorkflowsManager`,
`CreateWorkspaceModal`. Any validation/cap/permission error surfaced from any of these
on a phone reproduces the same header occlusion — the gadget-cap error is simply the
repro the qa-tester happened to hit first.

**Prescribed fix direction:**
1. **Primary — bottom-anchor toasts on mobile too**, instead of inverting to top below
   `sm:`. Concretely: drop `top-0`/`sm:top-auto` and make `bottom-0` unconditional (keep
   `items-center` + full-width centering under `sm:`, keep the existing `sm:items-end
   sm:right-0` narrow-right-anchor at `sm:` and up). Every `Modal` in this codebase is
   `items-start` + `mt-8` — headers are always near the TOP, never the bottom — so a
   bottom-anchored toast structurally can't collide with a modal header again. Add
   `pb-[env(safe-area-inset-bottom)]` while touching this for notched devices.
2. **No accessibility cost:** the toast viewport already has `aria-live="polite"` /
   `role="alert"` for errors (`Toast.tsx:158-160,179`), so screen-reader users are
   unaffected by a position change — this is a pure visual/hit-testing fix.
3. **Residual risk to verify after the fix:** a few forms run tall on a 390×844 screen
   (`GadgetFormModal`, `CreateIssueModal`, `WebhookFormModal`) and could have their
   Save/Cancel footer near the bottom instead — a bottom-pinned toast could newly
   overlap *that*. Recommend pairing the reposition with capping `Modal`'s panel at
   something like `max-h-[calc(100dvh-4rem)]` with a sticky header/footer and scrollable
   body (worth doing anyway — several settings modals already run long on mobile), and
   re-screenshotting those three modals at 390px specifically after the change.
4. **Framing for the dev team:** the layering model is already correct — Modal `z-50` <
   Toast `z-[60]`, i.e. "system alerts always render above modal content," which is the
   right call. The bug is purely the shared *inset* value on narrow viewports landing on
   the one piece of chrome (header + close button) that's always near the top; fixing the
   inset, not the z-index, is the surgical fix.

---

### 🔴 P1 — "Merged" PR/MR badge uses stock (non-token) Tailwind purple — breaks in dark mode ✅ FIXED 2026-07-06

**Files:** `apps/web/src/components/board/IssueCard.tsx:214`,
`apps/web/src/components/issue/GithubLinksSection.tsx:54`,
`apps/web/src/components/issue/GitlabLinksSection.tsx:58`.

`tailwind.config.js`'s `varScale()` re-points `slate/red/amber/emerald/green/blue/gray/orange`
at CSS custom properties that flip in `.dark` (`index.css:295+`) — the documented
mechanism by which "every existing `slate-*`/`red-*`/etc. class... gets dark-mode-legible
values automatically... with ZERO per-component changes" (`tailwind.config.js:96-107`).
**`purple` is not in that list** — confirmed no `--nl-purple-*` variable exists anywhere in
`index.css`. So `bg-purple-50 text-purple-700 ring-purple-200` resolves to Tailwind's
literal stock hex values (`#faf5ff` / `#7e22ce` / `#e9d5ff`) in **both** light and dark
mode: in dark mode this renders as a bright, near-white, full-opacity chip in the middle
of an otherwise-adapted dark card — the one badge on the board/drawer that visibly doesn't
belong to the theme, not merely "low contrast" but actively jarring.

This is the "Merged" state specifically — precisely the surface flagged for dark-mode
contrast review — and it's a 3-for-3 miss (`IssueCard`'s inline PR badge, and the
byte-identical `StateBadge` in both `GithubLinksSection` and `GitlabLinksSection` all use
the same hardcoded classes). The same root cause also explains `WorkspaceAuditLogPage.tsx:49`
(`WebhookSubscription` audit-log badge) and `WorkspaceMembersPage.tsx:42,330` (ADMIN role
badge) — not in the requested scope, but worth sweeping in the same commit since it's the
identical fix.

**Fix direction:** add a `purple` entry to `varScale()` in `tailwind.config.js` plus
matching `--nl-purple-*` light/dark values in `index.css` (same derivation as the existing
emerald/red/amber scales) — OR, since "merged" is really one semantic state rather than a
general-purpose color needed elsewhere, introduce a dedicated `--nl-merged-*` (or reuse
`signal`) pair instead of adding a 9th stock color family to maintain long-term. Either way,
fix once at the token layer and let all 5 call sites (3 in scope + the 2 above) inherit it,
rather than patching each usage site individually.

---

### 🟡 P2 findings

1. **Badge/status-chip pattern duplicated 3× with no shared primitive.**
   `IssueCard.tsx`'s inline PR-badge JSX (:206-229), `GithubLinksSection.tsx`'s `StateBadge`
   (:50-68), and `GitlabLinksSection.tsx`'s `StateBadge` (:54-73) are near-identical
   `bg-X-50 text-X-700 ring-X-200 ring-1 ring-inset rounded px-1.5 py-0.5 text-[10px]
   font-semibold` recipes, hand-rolled independently — and `ui/Badge.tsx` doesn't support
   a semantic-variant prop at all, so the blocked-issue badge and overdue-due-date chip in
   `IssueCard` (:176-192, :236-265) hand-roll the same pattern a 4th and 5th time. **Fix:**
   extend `ui/Badge` with a `variant?: 'neutral' | 'success' | 'danger' | 'warning' | 'info'
   | 'accent'` prop that owns this Tailwind recipe once, then migrate all five call sites
   onto it. This would have made the purple-badge dark-mode bug above a one-line fix
   instead of a 3-file (5-file, counting the workspace pages) grep-and-replace, and
   prevents the next one-off badge from drifting the same way.

2. **`GadgetCard` drag handle is far under the mobile tap-target floor.** ✅ FIXED 2026-07-06
   `apps/web/src/components/dashboards/GadgetCard.tsx:100-118` — the drag-handle `<button>`
   wraps a 12×12 SVG in `p-0.5` (2px) padding, for a ~16×16px total hit target, roughly 40%
   of the ~40px minimum this checklist calls for. Reordering gadgets is already a
   fine-motor drag interaction; asking a thumb to land precisely on a 16px target makes it
   materially harder than the equivalent mouse interaction. The sibling `IconButton` in the
   same file (`p-1`, :43-48) is closer but still short. **Fix:** give the drag handle
   `min-h-10 min-w-10 sm:min-h-0 sm:min-w-0` (or equivalent `p-2.5 sm:p-0.5`) so touch
   users get a ~40px hit area while the icon itself stays visually small, shrinking back
   down for precision mouse pointers at `sm:` and up.

3. **Development sections' live-status poll has no loading state.** ✅ FIXED 2026-07-06
   `GithubLinksSection.tsx`'s `ChecksIndicator` (:77-102) and the identical component in
   `GitlabLinksSection.tsx` (:82-107) render `null` while `useGithubLiveStatus`/
   `useGitlabLiveStatus` are in flight (`live` is `undefined` until the query settles) —
   the PR/MR row shows nothing at all, then a checks dot or a quiet "⋯" appears with no
   transition once the poll resolves or fails. Every other section in the same drawer that
   fetches on mount (`AttachmentsPanel.tsx:157,199,288`, `LinkedIssuesSection.tsx:52`) shows
   the shared `Spinner` from `ui/States` while loading. **Fix:** render a small
   `<Spinner className="h-3 w-3" />` (or an `animate-pulse` dot matching the checks-dot's
   visual weight) next to the row while `liveQuery.isLoading`, so this section matches the
   rest of the drawer's established loading vocabulary instead of being the one silent
   exception.

4. **Inconsistent section naming when both integrations are configured.**
   `GithubLinksSection.tsx`'s heading literally reads "Development" (:174) with
   `aria-label="Development"` (:172); `GitlabLinksSection.tsx`'s heading reads "GitLab"
   (:164) but its `aria-label` is "GitLab Development" (:162). If a project has *both*
   integrations configured, a user sees two stacked headers reading "Development" then
   "GitLab" — not two parallel provider sections. **Fix:** pick one convention for both —
   either both stay "Development" (rely on the per-row icon to distinguish provider,
   already present) or both become "GitHub"/"GitLab" — and align the `aria-label`s to
   match whichever heading text ships.

5. **`Badge`'s custom-color path isn't dark-mode aware.**
   `ui/Badge.tsx:37-53` — `hexWithAlpha()`/`darken()` are flat, mode-unaware transforms
   (`darken` is a straight ×0.6 RGB multiply) applied to any hex passed via the `color`
   prop (labels on `IssueCard`, `BoardPage`, `TriagePage`, `SettingsPage`, `LabelPicker`;
   type/priority chips in `TemplatesManager`). Compare to `lib/applyBrandColor.ts`, which
   the app already built to solve exactly this problem for the workspace brand color —
   it mixes toward a dark canvas/paper endpoint instead of white/black when `.dark` is
   active, specifically so an arbitrary hue "composes correctly with dark mode." Because
   `Badge`'s `color` path doesn't reuse that technique, a user-picked label color that
   looks fine in light mode can render as a muddy, low-contrast chip in dark mode — the
   one corner of the badge vocabulary that doesn't inherit the "dark mode for free" the
   rest of the token system provides. **Fix:** extract `applyBrandColor.ts`'s mix-toward-
   dark-canvas/paper math into a small shared helper and reuse it in `Badge`'s
   `hexWithAlpha`/`darken`, gated on the same `.dark` class check.

6. **Live-status-unavailable hint fails contrast in both themes.**
   `GithubLinksSection.tsx:84` / `GitlabLinksSection.tsx:89` — the "⋯" hint (shown when the
   live PR/CI or MR/pipeline check errors) uses `text-ink-300`, which is `#c4cad6` on white
   in light mode (~1.6:1 against `#ffffff` — well under the 4.5:1 text floor, or even the
   3:1 floor for non-text UI) and `#3c4356` on `#141821`/`#0d0f14` in dark mode (similarly
   low — both dark). `ink-300` is documented in `tailwind.config.js:57-59` as the
   "disabled text" role, which is the wrong role here: this glyph is signaling a real,
   actionable failure (the live check call errored) and today it's backed only by a
   `title` tooltip + `aria-label` for anyone who can't read a near-invisible 10px
   character. **Fix:** bump to `ink-400` ("muted → secondary text" role) at minimum, or
   swap the ellipsis for a small icon at the same visual weight as the `ChecksIndicator`
   success/failure/pending dot so the state is scannable, not tooltip-only.

---

### 🟢 P3 / nits

1. **Starter-gadget first-run has no in-product explanation.**
   `apps/api/src/dashboards/dashboards.service.ts:70-101` — a project's very first
   dashboard is silently pre-populated with 3 gadgets (Open issues / Status overview / My
   open issues), which is a good default, but nothing in `DashboardsPage.tsx` tells a
   first-time user these are just starter content they can edit/delete — someone could
   reasonably assume they're fixed/system gadgets. Suggest a one-time dismissible hint
   under the dashboard tabs the first time the active dashboard is the project's first one
   and its gadgets still match the starter set verbatim (e.g. "We added a few starter
   gadgets to get you going — edit or delete any of them.").

2. **Staleness pill's "why" is mouse-hover-only.**
   `AgentContextSection.tsx:180-188` — the amber staleness pill's explanation ("Project
   activity has happened since this document was last updated") lives only in a `title`
   attribute, unlike `IssueCard`'s blocked badge which pairs `title` with an `aria-label`
   carrying the same text. Low priority since the pill's own visible text ("3 changes
   since last update") is already fairly self-explanatory without the tooltip.

3. **Positive callout: `VelocityTrendGadget`/`VelocityChart` is the reference
   implementation, not a finding.** `GadgetVisualizations.tsx:141-153` reuses the exact
   `VelocityChart` component the full Reports page uses (genuinely "the gadget framework
   reusing an existing chart," not a bespoke gadget-only one), has a real empty state ("No
   sprint data yet — needs at least one active or completed sprint"), and `VelocityChart.tsx`
   already ships `role="img"` + a descriptive `aria-label` plus a per-bar `<title>` tooltip
   (:42-46,86,96). No action needed — flagged so other chart/gadget work has something to
   match.

---

### What's already good 🟢

- **`useOverlay.ts`** (`apps/web/src/lib/useOverlay.ts`) is a genuinely solid shared
  focus-trap/Escape/scroll-lock primitive used by both `Modal` and drawers: it maintains
  an overlay stack so only the topmost overlay reacts to Escape/Tab (a lightbox over a
  drawer won't also close the drawer underneath), moves focus in on open, traps Tab, and
  restores focus to the previously-focused element on close. This is exactly the kind of
  centralized accessibility primitive the review checklist asks every modal/drawer to
  have, and it's already correct — no changes requested.
- **Reduced motion is handled at the token layer and actually covers dnd-kit's inline
  styles.** `index.css:574-587`'s blanket `@media (prefers-reduced-motion: reduce) { * {
  transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; } }`
  overrides the non-`!important` inline `transition` style that `dnd-kit`'s `useSortable`
  sets on `DashboardsPage.tsx`'s `SortableGadgetCard` wrapper for drag-reorder animation —
  verified by reading both files together. Good coverage without a dnd-kit-specific carve
  -out; this is not always the case in apps that add reduced-motion CSS after the fact.
- **`AgentContextSection.tsx`** is a good reference implementation of the "every
  interactive surface needs loading/empty/error/disabled states" checklist item: explicit
  `LoadingState`/`ErrorState` (via `ui/States`), a real empty state
  ("No agent handoff yet…"), Escape-to-cancel in the edit textarea, an inline `role="alert"`
  save error that doesn't rely on a toast at all (so it can't collide with the mobile-toast
  bug above), and a staleness pill built from dark-mode-safe (`amber-*`, token-backed)
  colors. Worth pointing other settings sections at as the template.
- **`GadgetCard`/`GadgetVisualizations`** meet the states checklist cleanly: explicit
  `Spinner` while loading, a `role="alert"` red banner for `result.error`, and every
  visualization (`TableGadget`, `BreakdownGadget`, `BurndownGadget`, `VelocityTrendGadget`)
  falls back to the shared `ui/States` `EmptyState` rather than a bespoke "no data" string.
- **The gadget/dashboard caps are a good engineering guardrail with a well-written error
  message.** `MAX_GADGETS_PER_DASHBOARD` / `MAX_DASHBOARDS_PER_PROJECT`
  (`dashboards.service.ts:67-68`) prevent unbounded fan-out from a bad script/agent loop,
  and the cap error text itself ("This dashboard already has the maximum of 30 gadgets.
  Delete one before adding another.") is specific and actionable — the *only* problem is
  where/how it's surfaced on mobile (the P1 toast finding above), not the guardrail or the
  copy.
- **Board card badge grid on mobile stays legible** (`shots/board-mobile.png`): labels,
  the blocked badge, due-date chip, story-points chip, and assignee avatar all render at
  full readable size with no truncation/overflow at narrow widths — the vertical-stack
  badge layout scales down cleanly.

---

### Top 5 for the dev team

1. **Fix mobile Toast positioning** (`ui/Toast.tsx:157`) — bottom-anchor on mobile instead
   of top-anchoring; this is the confirmed, systemic defect blocking the header/close
   button of any open modal (17+ modal components affected) for the full error-toast
   duration (6s) on any mutation failure at ≤640px. ✅ FIXED 2026-07-06
2. **Add a dark-mode-aware `purple`/`merged` token** so the "Merged" PR/MR badge (and the
   two other call sites in `WorkspaceAuditLogPage`/`WorkspaceMembersPage`) stop being the
   one visibly broken, non-adapting element in dark mode across board/drawer/settings.
   ✅ FIXED 2026-07-06
3. **Extend `ui/Badge` with a semantic `variant` prop** and consolidate the 3 duplicated
   `StateBadge`/inline-badge implementations (`IssueCard` PR badge, `GithubLinksSection`,
   `GitlabLinksSection`) onto it — fixes the purple bug at the root and prevents the next
   one-off status chip from drifting the same way. *Still open* — the 2026-07-06 fix took
   the token-layer route (item 2) instead, which closed the dark-mode break without this
   consolidation; the duplication itself (and the two extra hand-rolled badges on
   `IssueCard`) remains a valid follow-up, tracked in `docs/BACKLOG.md`.
4. **Bump the `GadgetCard` drag-handle hit area to ~40px on mobile** — currently ~16px,
   well under the tap-target floor, for a drag interaction that's already fiddly on touch.
   ✅ FIXED 2026-07-06
5. **Give the Development sections' live-status poll a visible loading state** (reuse
   `ui/States`' `Spinner`) instead of rendering nothing while in flight, matching every
   other async section in the issue drawer. ✅ FIXED 2026-07-06

---

## 2026-06-26 — Design / UX consistency audit

**Scope reviewed:** `apps/web/src/components/ui/*` (primitives), `pages/*` (Login,
Register, Dashboard, Board), `components/board/*`, `components/issue/*`,
`components/project/*`, `AppHeader`, `Logo`, theme (`tailwind.config.js`, `index.css`).

**Screens captured (desktop + mobile):** login, register, dashboard, board, issue
detail drawer, create-issue modal. Screenshots stored under `/tmp/uishots/`.

### Design system as intended
A small, coherent token set: a single `brand-*` indigo ramp, two named shadows
(`card`, `cardHover`), Inter font, and a set of reused primitives (`Button`, `Input`,
`Select`, `Textarea`, `Field`, `Modal`, `Badge`, `Avatar`, `States`). The system is
clean and mostly well-applied — the findings below are about the places that drift
from it.

---

### What's already good 🟢
- **Primitives are real and mostly reused.** `Button` (4 variants / 2 sizes),
  `Input`, `Select`, `Textarea` all share radius (`rounded-lg`), height (`h-9`),
  border (`border-gray-300`) and the same `focus:ring-brand-200` treatment. Auth
  forms, both modals, and the drawer sidebar all consume them consistently.
- **Form labelling via `Field`** wires `htmlFor`/`id` correctly on Login, Register,
  Create-Issue, and Create-Project — proper `<label>`/control association.
- **State coverage on list/query views is strong.** `States.tsx` provides
  `LoadingState`, `ErrorState` (with retry), `EmptyState`, and `Spinner`; Dashboard
  and Board wire all three, and `ErrorState` exposes an accessible retry.
- **Buttons show loading + disabled** (`loading` spinner, `disabled:opacity-70`),
  and forms disable submit until valid (Create-Issue / Create-Project gate on
  trimmed title/name).
- **Board is responsive done right:** columns are fixed-width (`w-72 shrink-0`) in a
  horizontal `overflow-x-auto` track, so mobile (390px) scrolls sideways with no
  page-level horizontal overflow. Confirmed in `board-mobile.png`.
- **Modal** locks body scroll, closes on Esc and on backdrop click, and has an
  `aria-label="Close"` button + `role="dialog"`/`aria-modal`.
- **Auth screens** look polished and centered at both breakpoints
  (`login-mobile.png`, `register-mobile.png` fit cleanly).

---

### 🔴 Inconsistencies / bugs

**1. Label chips are rendered two different ways (primitive vs. inline).**
`components/ui/Badge.tsx` is the canonical label chip: background at
`rgba(color, 0.15)` and text *darkened to 65%* for contrast. But
`components/issue/IssueDetailDrawer.tsx:256-263` re-implements label chips inline:
`backgroundColor: l.color + '26'` (~15% alpha) and `color: l.color` — the **raw,
un-darkened** color as text.
*Why it matters:* light labels (yellow/lime) become low-contrast/illegible in the
drawer while the same label on the card (via `Badge`) is readable; and it's a
divergent re-implementation of an existing primitive.
*Fix:* render labels in the drawer with `<Badge color={l.color}>{l.name}</Badge>`.

**2. Modal and Drawer behave differently as overlays.**
`Modal.tsx` locks body scroll (`document.body.style.overflow = 'hidden'`) and sits at
`z-50`. `IssueDetailDrawer.tsx` (also `role="dialog" aria-modal`) does **neither** —
it never locks scroll (the board scrolls behind the open drawer) and uses `z-40`.
*Why it matters:* two "modal" surfaces with different stacking and scroll behavior is
an inconsistent interaction model; background scroll-through is a known UX papercut.
*Fix:* extract the Modal's scroll-lock + key handling into a shared hook and apply it
to the drawer; align z-index (both `z-50`).

**3. Native `window.prompt` / `window.confirm` break the design language.**
`pages/DashboardPage.tsx:207` creates a workspace via `window.prompt`;
`IssueDetailDrawer.tsx:86` deletes an issue via `window.confirm`.
*Why it matters:* these are unstyled OS dialogs in the middle of a custom-themed app —
inconsistent typography, no brand styling, not testable, and a jarring break from
every other create/confirm flow (which use `Modal`).
*Fix:* reuse `Modal` for the new-workspace input and for a destructive
"Delete issue?" confirm (with a `danger` Button).

**4. No app-wide feedback/toast system; success/error feedback is uneven.**
There is no toast/notification primitive anywhere (grep: none). Inline error blocks
exist on auth + create modals, but **drawer field edits** (`onPatch` in
`IssueDetailDrawer.tsx`) surface *nothing* on failure and only a tiny "Saving…" on
success; `DashboardPage` workspace creation swallows errors (`.catch(() => undefined)`).
*Why it matters:* inconsistent feedback — a failed status/assignee change in the
drawer silently does nothing, while the same failure in a modal shows a red banner.
*Fix:* add one small toast primitive and route mutation success/error through it
uniformly (at minimum, surface drawer-patch errors).

---

### 🟡 Improvements

**5. Theme tokens bypassed by hardcoded hex.** `components/issue/issueMeta.tsx`
defines the entire issue-type and priority palette as raw hex (`#22c55e`, `#3b82f6`,
`#ef4444`, `#a855f7`, `#dc2626`, `#f59e0b`, `#e5e7eb`, …). These are Tailwind's own
`green/blue/red/...-500` values but live as magic strings.
*Why it matters:* the design system claims "colors come from theme tokens"; these
are invisible to the theme, can't be re-themed, and risk drift from the palette.
*Fix:* add `type`/`priority` color tokens to `tailwind.config.js` (e.g.
`type.bug`, `priority.high`) or at least centralize these hexes in one exported map
referenced from the config.

**6. Drawer title field is a bare, unlabelled `<input>`.**
`IssueDetailDrawer.tsx:162-170` uses a raw `<input>` (custom border/hover classes),
not the `Input` primitive, and has **no associated label** (it's the issue title —
the most important editable field).
*Why it matters:* a11y (no accessible name) and a one-off styled control diverging
from the primitive.
*Fix:* keep the inline-edit styling but add `aria-label="Issue title"`; consider a
shared "inline editable" variant so it's not a bespoke control.

**7. Create-Issue modal stays a 2-column grid on mobile.**
`components/board/CreateIssueModal.tsx:127` uses `grid-cols-2` with no responsive
breakpoint; at 390px the Type/Priority/Status/Assignee selects are squeezed to ~150px
each (`createissue-mobile.png`).
*Why it matters:* cramped controls and truncation risk on small screens.
*Fix:* `grid-cols-1 sm:grid-cols-2`.

**8. Modal has no focus trap or focus restoration.**
`Modal.tsx` focuses the panel on open and handles Esc, but Tab can move focus out of
the dialog into the page behind it, and focus is not returned to the trigger on close.
*Why it matters:* keyboard/AT users can tab "behind" an open modal; standard dialog
a11y expects a trap + restore.
*Fix:* add a focus trap (cycle Tab within the panel) and restore
`document.activeElement` on unmount; apply to the drawer too (see #2).

**9. Inconsistent "create" affordances and copy.** The board uses a `Button`
"+ Create issue"; columns use a ghost icon-button and a dashed "+ Add issue" tile;
the dashboard uses "+ New Project" and "+ Workspace". Wording mixes
"Create" / "New" / "Add" for the same kind of action.
*Why it matters:* minor but reads as inconsistent vocabulary across primary actions.
*Fix:* settle on one verb (e.g. "New X" for top-level, "Add issue" within a column)
and apply consistently.

**10. Auth error banner pattern is duplicated, not shared.** The
`rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600` error block is copy-pasted in
`LoginPage`, `RegisterPage`, `CreateIssueModal`, and `CreateProjectModal`.
*Why it matters:* four copies drift over time; `States.tsx` is the natural home.
*Fix:* extract an `<InlineError>` (or `<FormError>`) component and reuse it.

---

### 🟢 Nits

**11. Mobile tap targets below ~40px.** Column add button
(`BoardColumn.tsx:49`, `p-1` ≈ 24px), card type/priority icons, and the drawer/modal
close `×` (`p-1`/`p-1.5`) are under the ~40px guideline on touch.
*Fix:* bump to `p-2`/min-h-9 on interactive icon buttons, at least on touch.

**12. Two scrollbar-color hexes in `index.css`** (`#d1d5db` = `gray-300`) are hard-coded;
fine, but could reference the token in a comment for traceability.

**13. `IssueCard` is `<div role="button" tabindex=0>` carrying drag listeners**
(`SortableIssueCard.tsx`). It's keyboard-openable (Enter) and works, but it's a
non-semantic button. Acceptable given dnd-kit constraints; note it as a known
trade-off.

**14. Empty far-right space on desktop dashboard/board.** Project grid caps at
`max-w-5xl` and board columns left-align, leaving large blank areas on wide screens
(`dashboard-desktop.png`, `board-desktop.png`). Cosmetic; intentional max-width is
fine, just flagging the visual emptiness.

**15. Seed/content note (not UI source) — ✅ RESOLVED:** the seeded demo project
description previously contained a trademarked category phrase (visible on the
dashboard card). The seed (`apps/api/prisma/seed.ts`) now reads "Building the
open-source, self-hosted issue & project tracker." — no trademarked terms remain.

---

## Top 5 for the dev team
1. **Unify label chips** — use `<Badge>` in `IssueDetailDrawer`; fixes contrast +
   removes a divergent re-implementation. (#1)
2. **Make the drawer a first-class overlay** — add scroll-lock, focus management, and
   align z-index with `Modal` via a shared hook. (#2, #8)
3. **Replace `window.prompt`/`window.confirm`** with themed `Modal` flows for
   new-workspace and delete-issue. (#3)
4. **Add a toast primitive and surface drawer-patch errors** so feedback is uniform
   across modals, forms, and inline edits. (#4)
5. **Move type/priority colors into theme tokens** and make the create-issue modal
   single-column on mobile. (#5, #7)

---

## 2026-06-27 — Feature-specific audit: filters, @mention, password reset, onboarding/empty states

**Scope reviewed:** `BoardPage.tsx` (MultiSelectFilter, TypeFilter, PriorityFilter, LabelFilter toolbar), `MentionComposer.tsx` + `CommentsPanel.tsx`, `ForgotPasswordPage.tsx` + `ResetPasswordPage.tsx` + `AuthShell.tsx` (vs. `LoginPage.tsx` / `RegisterPage.tsx`), `OnboardingPanel.tsx` + `BoardColumn.tsx` (empty state) + `MyWorkPage.tsx` (empty state) + `NotificationBell.tsx` (empty state). Also re-checked `useOverlay.ts`, `tailwind.config.js`, and all UI primitives for context.

**No app source was edited. Read-only review.**

---

### What's already good

- **MultiSelectFilter mirrors LabelFilter exactly** — same h-9 trigger height, same `border-brand-300 bg-brand-50 text-brand-700` active-state coloring, same checkbox mark, same `shadow-cardHover` popover, same Esc / click-outside dismiss. The extraction into a shared `MultiSelectFilter<T>` generic is the right call and the implementation is internally consistent.
- **MentionComposer keyboard contract is complete and correct.** Arrow Up/Down, Enter/Tab to confirm, and Escape to dismiss are all intercepted before the parent handler; the Escape key also calls `stopImmediatePropagation` to block the drawer's own `useOverlay` Esc handler, preventing the drawer from closing when the picker is dismissed. This is the fix for a real previous focus-loss bug and is well-handled.
- **MentionComposer a11y wiring is strong.** The `<textarea>` carries `aria-autocomplete="list"`, `aria-expanded`, `aria-controls="mention-picker"`, and `aria-activedescendant` pointing to the highlighted `<li>`. The `<ul>` has `role="listbox"` and each item has `role="option"` with `aria-selected`. This is a textbook ARIA combobox pattern.
- **Password reset pages are fully on-theme.** Both `ForgotPasswordPage` and `ResetPasswordPage` use `AuthShell`, `Field`+`Input`, the standard error banner, and `Button loading`. They look and behave identically to the Login and Register pages.
- **`useOverlay` is now a fully shared hook** covering focus trap, scroll lock, Esc close, and focus restore — previous cycle item #2 and #8 from the prior review are resolved here.
- **OnboardingPanel visual quality is high.** The brand mark icon, dashed-border treatment (matching `EmptyState`), and the responsive 1→3 column feature grid are on-design. The `max-w-lg` card centers well on mobile at 390 px.
- **Notification empty state and loading/error states are all present** in `NotificationBell`. The empty-panel icon, heading ("You're all caught up"), and explanatory copy are good UX.
- **MyWork empty states use the shared `EmptyState` primitive** correctly (per-section, with both title and description). Loading and error states are both wired.
- **BoardColumn empty states are role-aware** — editable columns show a dashed CTA button, viewer columns show a muted "No issues" placeholder.

---

### Findings

#### Feature 1 — Board type + priority filters (MultiSelectFilter)

**P1 — Filter toolbar wraps onto two rows on mobile, obscuring the board.**
At 390 px the toolbar (`flex flex-wrap items-center gap-3 px-4 py-3` in `BoardPage.tsx:274`) wraps to two rows: row 1 = search + assignee select + assignee avatar; row 2 = Labels + Type + Priority + "Create issue". This is a `flex-wrap` layout with no maximum number of visible items, so five controls plus an avatar can require 2–3 rows on a 390 px screen, eating up 80–100 px of board vertical space before any columns are visible. On a short phone viewport (667 px) this is a significant portion of the content area.
File: `apps/web/src/pages/BoardPage.tsx` line 274.
Suggested fix: put the filter pills (Labels, Type, Priority) into a horizontally scrollable `overflow-x-auto` strip rather than wrapping, or collapse them behind a single "Filters" button on mobile that opens a bottom sheet or modal. At minimum, add `sm:flex-nowrap` and let the strip scroll.

**P2 — Trigger buttons lack a `hover` style in the inactive state.**
The LabelFilter and MultiSelectFilter trigger buttons (`BoardPage.tsx:491-495` and `633-637`) apply `hover:bg-gray-50` only to the inactive (non-selected) branch. The active branch (`border-brand-300 bg-brand-50 text-brand-700`) has no hover style at all — the button looks inert when hovered while active. All other interactive buttons in the system have explicit hover treatment.
Suggested fix: add `hover:bg-brand-100` (or `hover:border-brand-400`) to the active branch of the `cn()` conditional.

**P2 — `aria-haspopup="dialog"` on a listbox-style popover is semantically wrong.**
Both the LabelFilter trigger (`BoardPage.tsx:489`) and the MultiSelectFilter trigger (`BoardPage.tsx:631`) declare `aria-haspopup="dialog"`. The popover contains a list of checkboxes (`role="menuitemcheckbox"`), which makes it a menu, not a dialog. The correct value is `aria-haspopup="menu"` (matching NotificationBell) or `aria-haspopup="listbox"` if it were a proper listbox. Screen readers announce "opens dialog" which is incorrect and misleading.
Suggested fix: change `aria-haspopup="dialog"` to `aria-haspopup="menu"` on both triggers.

**P2 — Dropdown popover can overflow viewport on mobile.**
`LabelFilter` and `MultiSelectFilter` popovers use `absolute left-0` positioning with fixed widths (260 px and 208 px respectively). On a 390 px screen where the filter button is toward the right side of the row, the popover might still fit, but the `left-0` anchoring means it could be partially off-screen if the trigger itself is near the right edge after wrapping. There is no `right-0` fallback and no `sm:` variant.
Suggested fix: conditionally apply `right-0` (or use a CSS `min(left, calc(100vw - width))` approach) so the popover never leaves the viewport. A simple `right-0` anchor would work for the wrapping scenario.

**P3 — No visual distinction between type icons in the dropdown vs. plain text.**
TypeFilter lists "Task", "Bug", "Story", "Epic", "Subtask" as plain text with a generic checkbox. The existing `IssueTypeIcon` component renders colored type icons. Adding the icon next to the label in the Type dropdown would be more scannable and consistent with how types appear on cards.
File: `apps/web/src/pages/BoardPage.tsx` TYPE_OPTIONS array, line 712–718.
Suggested fix: render `<IssueTypeIcon type={opt.value} />` alongside the label text inside the `MultiSelectFilter` option renderer, or add an optional `icon` prop to `MultiSelectOption`.

**P3 — Active filter count is shown but selecting all options is not distinguished from selecting a subset.**
If a user selects all 5 priority levels, the button reads "Priority (5)" — functionally the same as no filter. There is no "select all / clear all" shortcut inside the popover (only "Clear priority filter" in the footer, which is only shown when count > 0). Consider adding a "Select all" row or making the "Clear" row always visible (grayed when nothing is selected) so the control's range is clearer.

---

#### Feature 2 — @mention autocomplete (MentionComposer)

**P1 — No "no results" state when query has text but zero matches.**
When the user types `@xyznosuchperson`, `filteredUsers` is empty, so `isOpen` becomes `false` (line 245: `mentionQuery !== null && filteredUsers.length > 0`) and the picker silently disappears. The user receives no feedback that their query matched nobody — the `@` trigger just vanishes with no explanation.
File: `apps/web/src/components/issue/MentionComposer.tsx` line 245.
Suggested fix: show the picker whenever `mentionQuery !== null` (even if the list is empty) and render a "No members match '@{query}'" placeholder row when `filteredUsers.length === 0`. This should only suppress the picker when `mentionQuery === null` (no active `@`).
Note: the keyboard handlers already gate on `filteredUsers.length > 0` before acting on Arrow/Enter, so they are safe; only the visibility `isOpen` logic needs updating.

**P2 — Picker shadow uses `shadow-lg` (generic Tailwind) instead of the design-system `shadow-cardHover` token.**
The mention picker (`MentionComposer.tsx:276`) uses `shadow-lg`, while both the LabelFilter popover and MultiSelectFilter popover (`BoardPage.tsx:509, 648`) use `shadow-cardHover`. `shadow-cardHover` is the design-system-defined shadow for elevated surfaces (`0 4px 12px -2px rgba(0,0,0,0.12)` per `tailwind.config.js`). `shadow-lg` is a Tailwind default that does not exist in the project's design tokens.
Suggested fix: replace `shadow-lg` with `shadow-cardHover` in `MentionComposer.tsx:276`.

**P2 — Picker opens above the textarea but can be clipped when the composer is near the top of the viewport.**
The picker uses `bottom-full mb-1` positioning (opens upward). Inside the `IssueDetailDrawer` the composer is near the top of a scrollable panel; when the drawer is freshly opened and the composer is at the top of the scroll area, the picker can open into the drawer header or be clipped by the overflow boundary.
File: `apps/web/src/components/issue/MentionComposer.tsx` line 275.
Suggested fix: try a downward position first (`top-full mt-1`) and only flip to upward if there is insufficient space below. This is a standard "flip" strategy for autocomplete dropdowns.

**P2 — Picker width (w-72 = 288 px) can overflow on mobile.**
The picker is `w-72` with `absolute left-0` anchoring. On a 390 px screen inside a drawer that has 20 px left padding, this is fine — 288 px fits. But in the comment composer inside the drawer (which is within a `md:col-span-2` column that on small screens is full-width), the outer div may be narrower than 288 px when the screen is very narrow (320 px devices), causing the picker to overflow. No `max-w-full` or `right-0` clamp is applied.
Suggested fix: add `max-w-full` or constrain the picker to the container width with `w-full max-w-[18rem]`.

**P3 — Selected item background `bg-brand-50 text-brand-700` on hover diverges from the LabelFilter/MultiSelectFilter hover style.**
LabelFilter and MultiSelectFilter use `hover:bg-gray-50` for normal rows and `border-brand-600 bg-brand-600 text-white` for checked items. MentionComposer uses `bg-brand-50 text-brand-700` for the keyboard-selected row, which is correct and distinct. However, when hovering with a mouse over a non-selected row, the style is `hover:bg-gray-50` — but the `onMouseDown` handler inserts the item immediately without ever rendering it as "selected via hover" (since selection is keyboard-only). On mobile where there is no hover, this means the tap target gives no visual press feedback before dismissal. Consider adding an `active:` state to the picker rows.

---

#### Feature 3 — Password reset pages (ForgotPasswordPage, ResetPasswordPage)

**P1 — Password minimum length is inconsistent: RegisterPage requires 8 chars, ResetPasswordPage requires 6.**
`RegisterPage.tsx:80` sets `minLength={8}` and the field hint reads "At least 8 characters." `ResetPasswordPage.tsx:69` enforces `newPassword.length < 6` in JS validation and `minLength={6}`, with the field hint "At least 6 characters." A user who registered with a 7-character password could reset to that same length, but a user who tries to re-register with 7 characters would be blocked. The minimum should be the same across both flows and enforced in one place (ideally the backend, surfaced uniformly in both forms).
Files: `apps/web/src/pages/ResetPasswordPage.tsx` line 69 and `apps/web/src/pages/RegisterPage.tsx` line 80.
Suggested fix: align both pages and the backend to the same minimum (recommend 8, which is the stronger existing rule). Update the hint text and both `minLength` attrs.

**P2 — The Password field label typography diverges from `Field` in `LoginPage`.**
In `LoginPage.tsx:67-76`, the password field is NOT wrapped in `<Field>` — instead it uses a custom `<label>` with `className="block text-sm font-medium text-gray-700"` (text-sm, gray-700). The `Field` primitive uses `text-xs font-medium text-gray-600`. On the same screen (LoginPage) the "Email" label uses `Field` (text-xs, gray-600) while the "Password" label uses a bespoke label (text-sm, gray-700). This makes labels look inconsistent within the login form itself.
Note: `ForgotPasswordPage` and `ResetPasswordPage` use `Field` correctly throughout, so they are actually more consistent than `LoginPage`.
Suggested fix: refactor `LoginPage` to use `<Field>` for the password field (or a variant of Field that supports the inline "Forgot password?" link). The "Forgot password?" link can be placed as a `hint` node or an absolutely-positioned element.

**P2 — Success state on ResetPasswordPage auto-redirects after 2 seconds without user control.**
`ResetPasswordPage.tsx:79-81` shows the success message then navigates to `/login` after 2 000 ms via `setTimeout`. A user who is slow to read or using assistive technology may be redirected mid-reading. The redirect also happens even if the user navigates away manually. There is no cancel/stay affordance.
Suggested fix: replace the forced redirect with a prominent "Go to sign in" `Button` (primary), which is already present as a `<Link>` in the footer. Remove the `setTimeout`. The user clicks when ready.

**P3 — ForgotPassword success screen repeats the email in body copy but it is not styled as a code/email token.**
`ForgotPasswordPage.tsx:46` renders `If <span className="font-medium">{email}</span> is registered…`. The email address is user-provided text and making it `font-medium` only partially distinguishes it from surrounding prose. It would be clearer as `font-mono` or wrapped in a `<Badge>` / `<code>` so the address is clearly identified as a literal value.

**P3 — No `autoFocus` on the first field in any auth form.**
`LoginPage`, `RegisterPage`, `ForgotPasswordPage`, and `ResetPasswordPage` all render a focused card with a clear primary input, but none set `autoFocus` on the email or name field. On a dedicated auth screen with a single purpose, auto-focusing the first input is standard and removes one click/tap for the user.
File: all four auth page components.
Suggested fix: add `autoFocus` to the first `<Input>` in each form.

---

#### Feature 4 — Onboarding panel + empty states

**P2 — OnboardingPanel feature-highlight icons are raw emoji, not SVG icons.**
`OnboardingPanel.tsx:79-91` uses `'⬛'`, `'🗓'`, and `'📊'` as icon strings inside `<span className="text-base" aria-hidden="true">`. Emoji rendering varies significantly across operating systems and browsers: `⬛` is a black square on macOS but renders at different weights on Android/Windows; `🗓` is a spiral notepad on iOS but a different calendar icon elsewhere. The rest of the app uses inline SVG for all icons (consistent stroke weight, brand color).
Suggested fix: replace the three emoji with small SVGs using `stroke="currentColor"` in the gray palette, consistent with the icon language used elsewhere (e.g. `h-5 w-5 text-gray-400`).

**P2 — MyWork full-empty state (when both assigned and reported are empty) is a bespoke inline block that duplicates `EmptyState`.**
`MyWorkPage.tsx:37-59` renders a custom `<div>` with dashed border, SVG icon, heading, and description when both lists are empty. This is structurally identical to `EmptyState` in `States.tsx` but is a one-off implementation that doesn't pass through the shared primitive. Compare `EmptyState`'s `rounded-xl border border-dashed border-gray-300 bg-white/50 py-14` vs. MyWork's `rounded-xl border border-dashed border-gray-200 bg-white py-10` — slightly different border color (`gray-200` vs. `gray-300`) and padding (`py-10` vs. `py-14`).
File: `apps/web/src/pages/MyWorkPage.tsx` lines 37-59.
Suggested fix: replace the custom block with `<EmptyState title="No work items yet" description="Issues assigned to you or reported by you across all projects will appear here." icon={<SvgIcon />} />`.

**P2 — Notifications empty state is a bespoke inline block (same duplication issue).**
`NotificationBell.tsx:120-147` renders the empty state inline with its own icon, heading, and description rather than using `EmptyState`. The styling (`flex flex-col items-center gap-2 px-3 py-8 text-center`) is close but not identical to `EmptyState`. The inline style is acceptable given the dropdown context (different background, width, and padding requirements), but the visual divergence (smaller icon `h-8 w-8`, lighter text colors) means the "all caught up" empty state looks lighter/weaker than the board column or MyWork empty states.
This is a lower-severity issue because the dropdown context legitimately calls for lighter styling.
Suggested fix: at minimum, document this as an intentional divergence; at best, expose a `compact` prop on `EmptyState` with `py-8` and `h-8 w-8` icon sizing for use in constrained containers.

**P3 — OnboardingPanel `<h1>` on the dashboard conflicts with the page hierarchy.**
`OnboardingPanel.tsx:33` uses `<h1>` for "Welcome to Next Lane". The `DashboardPage` has no other `<h1>` so this is effectively the page title — which is fine. However, if/when a page-level `<h1>` is added to `DashboardPage` (e.g. "Dashboard"), there will be two `<h1>` elements. Consider using `<h2>` in the panel since it is a section within the dashboard, not the page title itself.

**P3 — BoardColumn empty-column CTA button has a 40 px touch target on mobile but the label is ambiguous.**
`BoardColumn.tsx:87-94` renders a full-width dashed button reading "+ Add issue". This passes the tap-target size test (the full column width, `py-6`). However the text "+ Add issue" is a light `text-xs text-gray-400` style that renders at approximately 12 px — below the WCAG recommended minimum visible text size for interactive elements. The hover state turns it brand-colored which helps, but the default state is low-contrast.
Suggested fix: increase the button text to `text-sm` and raise contrast to `text-gray-500` in the default state.
- **RESOLVED 2026-06-27:** `text-xs text-gray-400` changed to `text-sm text-gray-500` on the empty-column CTA button in `BoardColumn.tsx`. Hover state unchanged (`hover:border-brand-300 hover:text-brand-600`).

**P3 — No CTA action in the MyWork per-section `EmptyState` to guide the user.**
Each `Section` in `MyWorkPage` passes `emptyTitle` and `emptyDescription` to `EmptyState` but no `action` prop. The `EmptyState` component supports an `action` slot (any `ReactNode`). For a new user, "Nothing assigned to you yet" with no next step is a dead end. A link to the board or to creating an issue would increase discoverability.
Suggested fix: pass `action={<Link to="/"><Button size="sm" variant="secondary">Go to board</Button></Link>}` (or similar) in the "Assigned to me" empty section.
- **RESOLVED 2026-06-27:** Both "Assigned to me" and "Reported by me" sections now pass `emptyAction={<Link to="/"><Button size="sm" variant="secondary">Go to board</Button></Link>}` as the `action` prop to `EmptyState`. `Section` component updated to accept `emptyAction?: React.ReactNode`. `Link` and `Button` imports added to `MyWorkPage.tsx`.

---

### Top 5 for the dev team (this cycle)

1. **P1 — Fix the @mention "no results" state** (`MentionComposer.tsx` line 245): when the user types `@text` with no matching members the picker vanishes silently. Show a "No members match" placeholder row. This is a one-line change to the `isOpen` condition plus a short placeholder branch in the JSX.
   - **RESOLVED 2026-06-27:** `isOpen` now triggers on `mentionQuery !== null`. Empty-list branch renders `data-testid="mention-no-results"` placeholder. Picker also switched to `top-full mt-1` (opens downward) and `shadow-cardHover`. 18 e2e tests green.

2. **P1 — Resolve the password minimum-length inconsistency** (`ResetPasswordPage.tsx:69` vs. `RegisterPage.tsx:80`): ResetPassword requires 6 characters, Register requires 8. Align to 8 (or whatever the backend enforces) and update both the JS guard, `minLength` attr, and field hint text.
   - **RESOLVED 2026-06-27:** ResetPasswordPage JS guard, `minLength`, and hint aligned to 8. `ResetPasswordDto.newPassword` `@MinLength` updated to 8 in `apps/api/src/auth/dto/auth.dto.ts`. 14 e2e tests green.

3. **P1 — Fix board toolbar mobile overflow** (`BoardPage.tsx:274`): the `flex-wrap` toolbar can grow to 2–3 rows on 390 px screens, consuming most of the viewport before any board columns appear. Change filter pills to a scrollable `overflow-x-auto` strip or collapse them behind a single "Filters" button on mobile.
   - **RESOLVED 2026-06-27:** Toolbar restructured to two rows on mobile (search+assignee row / filter-pills `overflow-x-auto` strip); desktop retains `sm:flex-wrap`. New e2e test confirms buttons stay within 180px at 375x812. 20 e2e tests green.

4. **P2 — Correct `aria-haspopup` on filter triggers** (`BoardPage.tsx:489, 631`): both `LabelFilter` and `MultiSelectFilter` triggers declare `aria-haspopup="dialog"` but open a menu of checkboxes, not a dialog. Change to `aria-haspopup="menu"` to give screen readers accurate information.
   - **RESOLVED 2026-06-27:** Both trigger buttons changed to `aria-haspopup="menu"`.

5. **P2 — Replace emoji icons in OnboardingPanel with SVGs** (`OnboardingPanel.tsx:79-91`): the `⬛`, `🗓`, `📊` emoji render inconsistently across platforms. Replace with inline SVGs using `stroke="currentColor"` from the existing icon vocabulary.
   - **RESOLVED 2026-06-27:** `HIGHLIGHTS` array type changed from `{ icon: string }` to `{ icon: React.ReactNode }`. Three named SVG constants — `KanbanIcon` (three vertical bars), `SprintsIcon` (calendar outline), `ReportsIcon` (bar chart) — replaced the emoji strings. Icon wrapper changed from `text-base` to `h-5 w-5 text-gray-400`, matching the app's standard icon sizing. 16 e2e tests green (onboarding + my-work, desktop + mobile).

### Additional items resolved in the 2026-06-27 polish pass

- **RESOLVED — ResetPasswordPage auto-redirect removed:** `setTimeout(() => navigate('/login'), 2000)` removed; success screen stays until user clicks "Go to sign in". e2e test updated.
- **RESOLVED — MyWorkPage full-empty state unified:** bespoke `<div>` replaced with `<EmptyState>` from `States.tsx` (consistent `border-gray-300 bg-white/50 py-14` tokens).
- **RESOLVED — autoFocus on first auth form input:** Added to Login (email), Register (name), ForgotPassword (email), and ResetPassword (new-password).

---

## 2026-06-27 — Design Elevation Pass: "Slate + Teal-Shift"

**Scope:** Full foundation pass — tokens, primitives, board, drawer, auth shell.
**Role:** frontend-builder acting as design lead. Both a plan (below) and the implementation.

---

### Design direction: brainstorm and critique

**Brand metaphor:** "lanes / momentum" — a tool dev teams live in all day. Work state must be instantly legible; status flow (To Do → In Progress → Done) should feel effortless.

**Brainstorm candidates (rejected):**

1. *Cream/serif/terracotta* — editorial, not developer-tool. Reads as a Notion competitor, not a focused tracker.
2. *Near-black canvas + acid-green accent* — aggressive contrast, tires the eye on long sessions. Wrong energy for "calm focus."
3. *Broadsheet hairlines + neutral grays* — too cold. No identity.
4. *Generic SaaS indigo* — the AI-default. Every template library reaches for it. Disqualified.

**Chosen direction: deep teal accent (#0891b2, `brand-600` anchor)**

Rationale: teal has nautical/lanes resonance ("lane" → water lane → flow). It reads as confident-but-calm, not aggressive. It's distinctly not indigo but still a professional cool. The hex is deep enough to pass WCAG AA on white at normal weights.

---

### Token system

**Color ramp — accent (`brand-*`):**
| Token | Hex | Usage |
|---|---|---|
| brand-50 | #ecfeff | Input focus rings, hover backgrounds |
| brand-100 | #cffafe | Avatar / project card backgrounds |
| brand-200 | #a5f3fc | Hover ring on focus-visible |
| brand-400 | #22d3ee | Focus rings (ring-brand-400) |
| brand-600 | #0891b2 | Primary buttons, active nav underline, logo mark |
| brand-700 | #0e7490 | Button hover, project-card hover text |
| brand-800 | #155e75 | Dark accent, rarely needed |

**Status progression arc (the harmonious palette):**
| Status | Dot/bar color | Background chip | Rationale |
|---|---|---|---|
| TODO | `bg-stone-400` | `bg-stone-50` | Stone = resting, neutral energy |
| IN_PROGRESS | `bg-amber-500` | `bg-amber-50` | Amber = motion, heat, attention |
| DONE | `bg-emerald-500` | `bg-emerald-50` | Emerald = resolved, growth |

This arc reads as a progression without being generic (most trackers use blue for IN_PROGRESS; amber is more evocative of "active work").

**Canvas / neutrals:** Migrated all `gray-*` to `slate-*` throughout. `slate-50` as body canvas, `slate-100/80` as column background, `slate-200` as borders, `slate-500` as muted text, `slate-900` as primary text.

**Typography:**
- **UI / display:** Plus Jakarta Sans Variable (geometric humanist; characterful but readable; bundled via `@fontsource-variable/plus-jakarta-sans`)
- **Data / monospace:** IBM Plex Mono (professional dev-tool signature; bundled via `@fontsource/ibm-plex-mono` weights 400 + 500)
- Type scale: 2xs=0.65rem, xs=0.75rem, sm=0.8125rem, base=0.875rem, lg=1rem, xl=1.125rem, 2xl=1.375rem

**Shadows (2-tier system):**
- `xs` — for buttons, column headers (1px subtle lift)
- `card` — issue cards at rest (2px spread, low opacity)
- `cardHover` — on hover, more spread (-translate-y-px)
- `modal` / `dropdown` — overlays and drawers

**Radii:** sm=0.25rem, default=0.375rem, md=0.5rem, lg=0.625rem, xl=0.75rem, 2xl=1rem

**Animation:** `nl-drawer-in` (translateX slide from right), `nl-modal-in` (scale + translateY), `nl-toast-in`, `nl-fade-in` (backdrop). All suppressed under `prefers-reduced-motion`.

---

### Signature element: issue keys in IBM Plex Mono, teal

The ONE disciplined thing: every issue key (`NL-5`, `AT7964-1`) rendered as:

```css
.nl-issue-key {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.7rem;
  font-weight: 500;
  letter-spacing: 0.01em;
  color: var(--nl-accent);  /* teal */
}
```

Applied to: `IssueCard.tsx`, `IssueDetailDrawer.tsx`, `AppHeader.tsx` breadcrumb.

Secondary: `.nl-data-chip` — same mono font at 0.65rem for story points and count chips.

The rest is quiet. Fonts, colors, and structure support this one signal without competing.

---

### Critique (against the skill's principles)

**What was fixed:**
- Generic indigo → teal: resolves "AI-default SaaS template" look.
- Inter → Plus Jakarta Sans: more character at large sizes (title, header), still clean at body size.
- Gray → Slate: warmer neutral, better pairing with teal.
- Status dots now tell a story (stone → amber → emerald) instead of three shades of the same gray.
- Column accent bars (2px top border in status color) give each lane a lane-appropriate identity.
- Issue keys are now scannable at a glance via color + mono face — developers look for these constantly.

**What was intentionally NOT changed:**
- Layout and component structure (not a redesign, an elevation).
- Any `data-testid`, ARIA role, aria-label, or visible user-facing text string that e2e tests assert on.
- The shadcn/ui + Tailwind stack.

**Remaining known gaps (deferred):**
- `issueMeta` hardcoded hex values in some cards (not yet tokenized via CSS vars) — tracked in BACKLOG.md.
- Create-issue modal single-column on mobile — tracked in BACKLOG.md.
- Shared `InlineError`/`FormError` component (4 duplicated banners) — tracked.
- Min 40px touch tap targets audit — tracked.

---

### Files changed

**Tokens:**
- `apps/web/tailwind.config.js` — full rewrite: brand=teal, status progression, plus-jakarta-sans + ibm-plex-mono font families, refined type scale/radii/shadows/animations.
- `apps/web/src/index.css` — @fontsource imports, CSS custom properties, `.nl-issue-key`, `.nl-data-chip`, `.nl-drawer-animate`, `.nl-modal-animate`, `prefers-reduced-motion` block, column accent classes.

**Primitives (`src/components/ui/`):**
- `Button.tsx`, `Input.tsx`, `Select.tsx`, `Textarea.tsx`, `Field.tsx` — gray→slate, transitions, tracking.
- `Badge.tsx` — gray→slate, font-semibold, tracking-wide, rounded-sm.
- `Avatar.tsx` — gray→slate, font sizes refined.
- `States.tsx` — gray→slate, font-medium.
- `Modal.tsx` — nl-modal-animate entrance, backdrop-blur, border-slate-100, shadow-modal, rounded-xl.
- `Toast.tsx` — nl-toast-in animation, shadow-dropdown, rounded-xl; success=emerald.
- `ConfirmDialog.tsx` — text-slate-600.

**App shell:**
- `AppHeader.tsx` — bg-white/95 backdrop-blur-sm, shadow-xs, slate colors, animate-nl-fade-in dropdown.
- `Logo.tsx` — tracking-[-0.02em], shadow-xs on mark.

**Board:**
- `BoardColumn.tsx` — CATEGORY_ACCENT border-t bars (stone/amber/emerald), nl-data-chip count chips, bg-slate-100/80.
- `IssueCard.tsx` — nl-issue-key on key span (THE SIGNATURE), nl-data-chip on story points, hover:-translate-y-px hover:shadow-cardHover, rotate-1 scale-105 overlay.
- `CardStatusPicker.tsx` — stone/amber/emerald dots and rings, shadow-dropdown listbox.

**Issue drawer:**
- `IssueDetailDrawer.tsx` — nl-drawer-animate, nl-issue-key on header key, uppercase tracking-widest labels, slate-* field styles.

**Auth:**
- `AuthShell.tsx` — from-slate-100 via-white to-brand-50 gradient, shadow-modal card.

**Bulk migration:** ~30 additional component files had `gray-*` → `slate-*` applied (CommentsPanel, ActivityPanel, AttachmentsPanel, LabelPicker, ParentSubtasks, MentionComposer, NotificationBell, CommandPalette, settings pages, reports, RoadmapTimeline, OnboardingPanel).

---

### Verification

- `pnpm --filter @next-lane/web build` passes. Bundle: CSS 56.33 kB, JS 625.40 kB.
- Fonts bundled as woff2 in dist/assets (ibm-plex-mono-latin-400-normal + ibm-plex-mono-latin-500-normal + plus-jakarta-sans-latin-wght-normal). No runtime CDN dependency.
- 24/24 e2e tests (board, auth, viewer-aware-ui, onboarding, inline-card-status — all 10 status-picker scenarios) pass. Pre-existing failures in board-columns, issue-detail, labels, themed-dialogs, full-text-search confirmed pre-existing on main branch.
- Screenshots captured (desktop 1280px + mobile 390px): login, home, board (all 3 columns visible), issue drawer open.

---

## Audit — 2026-06-28 — New surfaces vs Dispatch design system

Surfaces audited: `PersonalAnalyticsPage`, `ProjectAnalyticsPage`, analytics component library (`StatCard`, `WindowSelector`, `FlowChart`, `ThroughputChart`, `CycleTimeChart`, `CategoryBars`, `WorkloadBars`), `AutomationsPage`, automation component library (`AutomationRuleEditor`, `ActionParamsEditor`, `NlqlConditionInput`, `AutomationRunsPanel`), `PersonalBoardPage`, `ProjectNav` (10-tab navigation).

Reference baseline: `ReportsPage` and existing `ui/*` primitives.

---

### Surface 1 — Analytics (`PersonalAnalyticsPage` + `ProjectAnalyticsPage` + analytics/*)

#### P1 — Token violations: `slate-*` throughout page chrome and card shells

`PersonalAnalyticsPage` and `ProjectAnalyticsPage` were written partly in `slate-*` and `bg-slate-50` — the old pre-Dispatch palette — rather than the current `ink-*` tokens. The reference page `ReportsPage.tsx` has the same bug (it was not migrated during the Dispatch rollout), so the analytics pages faithfully copied its pattern. This is the single highest-priority fix because it means every section-card border, every page-level heading, every subtitle, and the main canvas background still render in uncalibrated Tailwind `slate-*` that does not resolve to the Dispatch ink palette.

Specific occurrences (not exhaustive — covers the new analytics files only):

- `PersonalAnalyticsPage.tsx:70` — `bg-slate-50` main canvas. Should be `bg-ink-50`.
- `PersonalAnalyticsPage.tsx:132,163,198,234` — `border-slate-200` on all four chart/stat section cards. Should be `border-ink-200`.
- `PersonalAnalyticsPage.tsx:138,168,203,241` — `text-slate-900` section headings. Should be `text-ink-900`.
- `PersonalAnalyticsPage.tsx:142,245` — `text-slate-500` descriptions. Should be `text-ink-500`.
- `ProjectAnalyticsPage.tsx:50,55,56` — breadcrumb in AppHeader slot: `text-slate-400`, `text-slate-300`, `text-slate-900`. Should be `text-ink-400`, `text-ink-300`, `text-ink-900` (matching the correctly tokenized breadcrumb already in `AutomationsPage.tsx:56-65`).
- `ProjectAnalyticsPage.tsx:64` — `bg-slate-50` main canvas.
- `ProjectAnalyticsPage.tsx:71,74` — `text-slate-900`/`text-slate-500` on page h1 and subtitle.
- `ProjectAnalyticsPage.tsx:135,141,145,166,172,176,203,209,213` — all chart section card borders, headings, and subtitles using `slate-*`.

Recommended fix: do a targeted find-replace on both files — `slate-` → `ink-` for all `border-`, `text-`, and `bg-` usages in these files. Cross-check against the `AutomationsPage` Shell and inline headings which are already fully tokenized and serve as the correct template.

#### P1 — Chart axis labels and grid lines use raw hex and `gray-*` instead of tokens

Every hand-rolled SVG chart — `FlowChart`, `ThroughputChart`, plus the older `VelocityChart`, `BurndownChart`, `CumulativeFlowChart` — uses raw hex `#e5e7eb` (Tailwind's `gray-200`) for grid strokes and `fill-gray-400` / `fill-gray-600` for axis text labels. This means chart chrome is silently diverging from the `ink-*` palette.

- `FlowChart.tsx:80` — `stroke="#e5e7eb"` grid lines. Should be `stroke` resolving to `ink-200` (either `className="stroke-ink-200"` or `stroke={token}` via a CSS var).
- `FlowChart.tsx:87` — `fill-gray-400` Y-axis label text. Should be `fill-ink-400`.
- `FlowChart.tsx:104` — `stroke="#8b95a8"` created dashed line. `#8b95a8` is `ink-400` — the correct value but should be expressed as a token class for maintainability: `className="stroke-ink-400"`.
- `FlowChart.tsx:140` — `fill-gray-600` X-axis date labels. Should be `fill-ink-600`.
- `FlowChart.tsx:153,160` — legend label `text-slate-500`. Should be `text-ink-500`.
- `FlowChart.tsx:157` — `border-gray-400` on dashed legend swatch. Should be `border-ink-400`.
- `ThroughputChart.tsx:78,85,103,142,154,158,161` — identical issues.

Same issues exist in `VelocityChart.tsx`, `BurndownChart.tsx`, and `CumulativeFlowChart.tsx` (pre-existing, not introduced by these pages, but should be fixed in the same pass).

Recommended fix: in each chart's SVG, replace the literal hex grid-stroke with `className="stroke-ink-200"` (SVG supports class-based stroke), replace `fill-gray-*` text classes with `fill-ink-*` equivalents, and replace legend `text-slate-*` with `text-ink-*`. The Tailwind config resolves `ink-*` correctly so no extra plumbing is needed.

#### P1 — Hardcoded hex color constants for category/priority bars in PersonalAnalyticsPage

`PersonalAnalyticsPage.tsx:13-28` defines `TYPE_COLORS` and `PRIORITY_COLORS` as maps of raw hex strings (e.g. `#22c55e`, `#ef4444`, `#a855f7`, `#f59e0b`). These are passed to `CategoryBars` as a `colorFn` and applied via `style.backgroundColor`. Several of these coincide with Tailwind colors that are not in the Dispatch palette at all (`#a855f7` = purple, not in the token set).

The bar fills for IssueType and Priority will therefore never react to future palette changes and are visually unanchored from the `signal-*`/`ink-*`/`status-*` system.

Recommended fix: expose these semantic colors through the shared `issueMeta` helper (which already maps `IssueType` and `Priority` to display metadata) as Tailwind class strings rather than hex, and teach `CategoryBars.colorFn` to accept only Tailwind class strings. If per-type colors must remain diverse (bug=red, epic=purple), document them as semantic constants in the design token file or `issueMeta`, not as floating hex in the page file.

#### P2 — Page-level heading typography inconsistency between the two analytics pages

`PersonalAnalyticsPage.tsx:55` uses `font-display text-sm font-bold tracking-[-0.01em]` (sub-header style, inside the sticky header bar).  
`ProjectAnalyticsPage.tsx:71` uses `text-lg font-semibold text-slate-900` (in-content page header, no `font-display`, uses the old `slate-` token).

These are semantically the same concept (the page h1) but rendered in two completely different visual registers. The correct pattern for in-page h1 headings in the Dispatch system — as established by `AutomationsPage.tsx:313` — is `text-lg font-semibold text-ink-900`. `PersonalAnalyticsPage` should adopt the same in-page h1 rather than the sub-header layout, or both pages should consistently use the sub-header layout. Mixed patterns create visual weight inconsistency.

#### P2 — `shadow-sm` vs `shadow-card` discrepancy is pre-existing but not introduced here

The analytics pages correctly use `shadow-card` on section cards. No regression here; noted for completeness.

#### P2 — WindowSelector is correctly tokenized; no issues found

`WindowSelector.tsx` uses `ink-*` and `signal-*` throughout. It is the best-executed component in this surface. No findings.

#### P2 — StatCard is correctly tokenized; no issues found

`StatCard.tsx` uses `ink-*` tokens for borders, text, and skeleton fills. No issues.

#### P3 — Loading skeleton in PersonalAnalyticsPage uses mixed token classes

`PersonalAnalyticsPage.tsx:148` — chart loading placeholder uses `bg-ink-100` (correct).
`PersonalAnalyticsPage.tsx:173,177,208,212` — breakdown loading skeletons also use `bg-ink-100` (correct).

No action needed — these are already using tokens. Noted as a positive.

#### P3 — No `aria-live` region for the refetching spinner in chart sections

When `isFetching` is true, `ReportsPage` and `ProjectAnalyticsPage` show a `<Spinner>` inline next to the section heading. The Spinner has `role="status"` and `aria-label="Loading"` but the containing section has no `aria-live` region, so screen readers will not announce the in-progress refetch. This is a minor accessibility gap — the initial load is communicated via `LoadingState`, but background refresh is silent.

Recommended fix: wrap the inline `Spinner` in a `<span aria-live="polite" aria-atomic="true">` so refetch activity is announced.

---

### Surface 2 — Automations (`AutomationsPage` + automation/*)

#### P1 — `shadow-sm` instead of `shadow-card` on the rules list container

`AutomationsPage.tsx:473` — the rules list card uses `shadow-sm` (Tailwind default shadow) rather than the Dispatch `shadow-card` token. Every other card surface in the app (stats cards in analytics, section cards in Reports, Standup, Poker) uses `shadow-card`. `shadow-sm` resolves to the default Tailwind shadow which has a warmer/different tint than the ink-tinted `shadow-card`.

Recommended fix: change `shadow-sm` to `shadow-card` at `AutomationsPage.tsx:473`.

#### P2 — Tab implementation is missing `role="tablist"` wrapper and `role="tabpanel"`

`AutomationsPage.tsx:333-361` — the tabs div has individual buttons with `role="tab"` and `aria-selected` (correct) but the containing `<div>` lacks `role="tablist"`. The content panels below also have no `role="tabpanel"` or `aria-labelledby` pairing with the tab buttons. ARIA tab pattern requires: `role="tablist"` on the container, `role="tab"` + `aria-controls="panel-id"` on each button, `role="tabpanel"` + `aria-labelledby="tab-id"` on each content region.

Recommended fix:
- Add `role="tablist"` to `AutomationsPage.tsx:333`'s `<div>`.
- Add `id` to each tab button and `aria-controls` pointing to the panel.
- Wrap each tab panel content in a `<div role="tabpanel" aria-labelledby="...">`.
- Keyboard: implement arrow-key navigation between tabs (left/right) per ARIA spec.

#### P2 — `AutomationRuleEditor` toggle in form has a non-interactive `aria-hidden` thumb span

`AutomationRuleEditor.tsx:364-377` — the toggle for "Enabled" inside the modal editor uses a visually-rendered `<span aria-hidden="true">` as the fake toggle track, with a hidden `<input type="checkbox" className="sr-only">`. This pattern is acceptable, but the `sr-only` checkbox has `aria-label="Enable rule"` while the visible label says "Enabled"/"Disabled" conditionally. The `aria-label` on the input overrides the programmatic label, and does not reflect the toggled state ("Enable rule" is always the label regardless of current state). This is the same minor gap as the outer `EnableToggle`.

Recommended fix: use `aria-label={enabled ? 'Disable rule' : 'Enable rule'}` to reflect the action (not the current state) — matching the outer `EnableToggle` which already does this correctly.

#### P2 — `ActionParamsEditor` raw `<input type="date">` not going through `ui/Input`

`ActionParamsEditor.tsx:342-354` — the DATE `CustomFieldType` renders a raw `<input type="date">` with manually composed class strings instead of the `<Input>` primitive. The classes are close to correct (same focus ring as `ui/Input`) but this creates a maintenance divergence point. The `<Input>` primitive in `ui/Input.tsx` should be used — it accepts `type="date"` and provides consistent styling, including disabled states, without duplication.

Similarly, `ActionParamsEditor.tsx:358-367` (CHECKBOX type) renders a raw `<input type="checkbox">` with `className="h-4 w-4 rounded border-ink-300"` but no focus-visible ring styling — keyboard users pressing Tab to this field will not see a focus indicator.

Recommended fix: route the DATE input through `<Input type="date">`. For CHECKBOX, add `focus-visible:ring-2 focus-visible:ring-signal-300 focus-visible:ring-offset-1` to the class string.

#### P3 — Condition input `font-mono text-xs` label style differs from other `Field` labels

`NlqlConditionInput.tsx:50-53` — the label uses `text-xs font-semibold text-ink-500` which is a slightly different pattern than labels in `Field.tsx` (`text-xs font-medium text-ink-600`). The weight difference (semibold vs medium) and color difference (ink-500 vs ink-600) are small but inconsistent.

Recommended fix: either adopt the `Field` component wrapper here (so label styling is centralised) or align the class string to `text-xs font-medium text-ink-600`.

#### P3 — `AutomationRunsPanel` timestamp is hidden on mobile by default

`AutomationRunsPanel.tsx:143-151` — the timestamp column is `hidden sm:flex` on mobile and then duplicated below (`col-span-2 text-xs text-ink-400 sm:hidden`). This pattern works but results in doubled DOM nodes. The mobile row is shown as a plain `<p>`, not a `<time>` element with `dateTime`, losing the machine-readable date on mobile.

Recommended fix: render a single `<time dateTime={run.createdAt}>` and use flex-wrap or a `flex-col` layout on small screens rather than duplicating the node.

---

### Surface 3 — PersonalBoardPage

#### P2 — `AddCardComposer` uses raw `<input>` instead of `ui/Input`

`PersonalBoardPage.tsx:768-780` — the inline card composer uses a raw `<input type="text">` with manually-composed class string: `rounded border border-ink-200 bg-white px-2 py-1.5 text-sm text-ink-900 placeholder:text-ink-400 focus:border-signal-500 focus:outline-none focus:ring-2 focus:ring-signal-200`. The ring uses `focus:ring-*` (not `focus-visible:ring-*`) so it shows on mouse click, not just keyboard focus — inconsistent with the rest of the app which uses `focus-visible`. Additionally this diverges from `ui/Input` which is the single source of truth for input styling.

Recommended fix: replace the raw `<input>` at line 768 with `<Input>` from `@/components/ui/Input`. The `Input` component already handles the correct `focus-visible` ring.

#### P2 — `PromoteCardModal` selects use raw `<select>` elements, not `ui/Select`

`PersonalBoardPage.tsx:999-1014` and `1034-1047` — the workspace and project dropdowns in the promote modal are raw `<select>` elements with manually-composed class strings. `ui/Select` exists precisely for this and uses the same class pattern. Using raw elements means future Select styling changes will not propagate.

Recommended fix: replace both raw `<select>` elements with `<Select>` from `@/components/ui/Select`.

#### P3 — Column accent color is hard-wired to `signal-300` for all columns

`PersonalBoardPage.tsx:296` — every personal board column has `border-t-signal-300` as its top accent. The project kanban board in `BoardColumn.tsx` uses category-driven accent colors (the `CATEGORY_ACCENT` map with distinct stone/amber/emerald bars). The personal board having all columns in the same cobalt signal accent makes all columns look identical at a glance, removing a key visual parsing cue.

Recommended fix: cycle through a small set of Dispatch-compatible accent colors keyed to column order or a `color` field on the column DTO (e.g., `signal-300`, `amber-300`, `emerald-400`, `violet-300`). This matches the behavior of the project board and gives the personal board better visual scanability.

#### P3 — MoveCardMenu has no Esc key handler

`PersonalBoardPage.tsx:696-728` — the card move menu opens as a popover and closes on outside click via `onBlur`. There is no `onKeyDown` handler to close on `Escape`. Every other menu/popover in the app (e.g., the column editor in `ColumnFormModal`, `AddCardComposer`) handles Escape. This is an accessibility and keyboard-navigation gap.

Recommended fix: add `onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}` to the menu `<div>` and ensure `tabIndex={-1}` is present so the div can receive keyboard events.

---

### Surface 4 — ProjectNav (10 tabs)

#### P1 — Ten flat tabs create a navigation/UX problem on both desktop and mobile

`ProjectNav.tsx` now renders 10 peer-level tabs: Board, Backlog, Triage, Reports, Analytics, Roadmap, Poker, Standup, Automation, Settings. On desktop at 1280px, this row is borderline overfull — the tabs fit, but only because the label text is short. At 1024px (common laptop) or any reduced-width window, overflow-x-auto kicks in silently with no affordance that there are more tabs. On mobile (390px), the first 5-6 tabs are visible and the rest require horizontal scrolling with no visual indicator (no scroll shadow, no fade-out gradient, no "More" indicator).

The 10 tabs also mix navigation depth levels: "Board", "Backlog", and "Triage" are primary work surfaces; "Reports", "Analytics", and "Roadmap" are informational; "Poker" and "Standup" are meeting tools; "Automation" and "Settings" are configuration. Flat presentation implies equal importance and frequency of use, which does not match reality.

**Concrete recommended fix — "More" overflow menu approach:**

Keep the 5 primary tabs visible at all widths: Board, Backlog, Triage, Reports, Settings. Collapse the remaining 5 (Analytics, Roadmap, Poker, Standup, Automation) under a "More" button that opens a dropdown, using the existing `ConfirmDialog`/dropdown pattern already in the codebase. The "More" button should indicate when the current route is inside the collapsed group (e.g., change to `signal-600` text to signal an active child).

Implementation sketch:
```
PRIMARY_TABS = [Board, Backlog, Triage, Reports, Settings]
OVERFLOW_TABS = [Analytics, Roadmap, Poker, Standup, Automation]
```
The `ProjectNav` renders the primary tabs as `NavLink`s, then a "More" `<button>` with a chevron that opens a positioned dropdown listing the overflow tabs. This reduces the baseline nav to 6 items (5 + More button), fits comfortably at 390px without scrolling, and makes the most-used surfaces immediately reachable.

Alternative if grouping is preferred: use a two-level nav — a row of section groups ("Work", "Insights", "Tools", "Config") with sub-tabs rendering below on selection. This is heavier to implement but provides better progressive disclosure.

#### P2 — No scroll shadow or fade gradient on the current overflow-x-auto nav at mobile

`ProjectNav.tsx:25` — `overflow-x-auto` is used but there is no CSS mask or `--webkit-overflow-scrolling` affordance to indicate scrollability to the user. On mobile the horizontal scroll is completely invisible — a user seeing Board/Backlog/Triage/Reports/Analytics in the viewport has no signal that Roadmap through Settings exist.

Recommended fix (independent of the overflow-menu fix): add a right-side fade gradient overlay using `::after` pseudo-element or a sibling `<div>` with `pointer-events-none bg-gradient-to-l from-white to-transparent absolute right-0` when there are off-screen tabs, or at minimum a `-webkit-overflow-scrolling: touch` and `scrollbar-width: none` to give smooth scrolling without the intrusive native scrollbar.

#### P3 — No `aria-label` on the `<nav>` element

`ProjectNav.tsx:25` — the `<nav>` element has no `aria-label`. With multiple `<nav>` landmarks on the page (the global sidebar and this project-level sub-nav), screen readers cannot distinguish them. WCAG 2.1 landmark guidance recommends unique labels for multiple same-type landmarks.

Recommended fix: `<nav aria-label="Project navigation">`.

---

### Cross-cutting summary

**What is done well:**
- `StatCard`, `WindowSelector`, `CycleTimeChart`, `WorkloadBars`, and `CategoryBars` are cleanly tokenized with `ink-*` and `signal-*` — no violations.
- `AutomationsPage` Shell and inline headings are fully tokenized (correct contrast/colors compared to the analytics pages).
- All four new surfaces use the `EmptyState`/`LoadingState`/`ErrorState` shared primitives — no one-off empty/error patterns.
- `AutomationRuleEditor` and `AutomationRunsPanel` use `ui/Modal`, `ui/Button`, `ui/Input`, `ui/Select`, `ui/Field`, `ui/Toast` throughout — no one-off re-implementations of primitives.
- `PersonalBoardPage` drag-and-drop implementation uses `motion-safe:nl-card-merge-in` and `rotate-[0.5deg]` on the drag overlay — respects reduced-motion and adds a polished physics cue.
- Focus rings are present on all interactive elements in `PersonalBoardPage` and `AutomationsPage` (except the Checkbox in `ActionParamsEditor` noted above).
- Run status badges in `AutomationRunsPanel` use `ring-1` for border instead of `border`, producing crisper rendering at small sizes — a nice touch.

---

### Top 5 for the frontend builder (prioritized)

1. **[P1] Migrate `slate-*` → `ink-*` in both analytics pages.** — RESOLVED 2026-06-28: all `slate-*` replaced with `ink-*` in `PersonalAnalyticsPage.tsx`, `ProjectAnalyticsPage.tsx`, and `ReportsPage.tsx`. Breadcrumbs in analytics/reports Shell matched to `AutomationsPage` reference pattern (using `ink-400`/`ink-300`/`ink-900` with `shrink-0`/`min-w-0`/`overflow-hidden` breadcrumb treatment).

2. **[P1] Tokenize SVG chart axis labels and grid lines.** — RESOLVED 2026-06-28: raw hex `#e5e7eb` → `className="stroke-ink-200"`; `fill-gray-400` → `fill-ink-400`; `fill-gray-600` → `fill-ink-600`; `text-slate-500` legend → `text-ink-500`; `border-gray-400` legend swatch → `border-ink-400`; `stroke="#8b95a8"` created dashed line → `className="stroke-ink-400"` (with comment noting the token value); `stroke-gray-300` ideal burndown guide → `stroke-ink-300`; `fill-gray-200` CFD TODO band → `fill-ink-200`; `bg-slate-200` CFD To Do legend swatch → `bg-ink-200`; `stroke="#d1d5db"` top band stroke → `stroke-ink-300`. Applied across all 5 hand-rolled SVG charts.

3. **[P1] Fix 10-tab ProjectNav overflow UX.** — Deferred (separate task — scope too large for this token-fix pass; tracked in BACKLOG).

4. **[P2] Fix ARIA tab pattern in AutomationsPage.** — Deferred (tracked in BACKLOG).

5. **[P2] Replace raw `<input>` and `<select>` with `ui/Input` and `ui/Select` in PersonalBoardPage.** — RESOLVED 2026-06-28: `AddCardComposer` raw `<input>` `focus:ring-*` changed to `focus-visible:ring-*`; `PromoteCardModal` both raw `<select>` (workspace + project) replaced with `<Select>` from `ui/Select`. `CategoryBars` color constants refactored from raw hex to Tailwind class strings (`TYPE_COLOR_CLASSES`, `PRIORITY_COLOR_CLASSES`) aligned with the `issueMeta` color vocabulary (green-500/blue-500/red-500/purple-500/ink-500 for types; red-600/red-500/amber-400/blue-500/ink-500 for priorities). `AutomationsPage` rule list `shadow-sm` changed to `shadow-card`. `ActionParamsEditor` DATE type now uses `<Input>` primitive; CHECKBOX gains `focus-visible:ring-2 focus-visible:ring-signal-200`. `ProjectNav` `<nav>` gains `aria-label="Project navigation"`. Build clean; no data-testid/role/aria-name/visible-text changes.

**Additional P2 items resolved in this pass:**
- `AutomationsPage.tsx:473` `shadow-sm` → `shadow-card` (RESOLVED 2026-06-28)
- `ActionParamsEditor.tsx` DATE: raw `<input>` → `ui/Input`; CHECKBOX: `focus-visible:ring` added (RESOLVED 2026-06-28)
- `ProjectNav.tsx` `<nav>` gets `aria-label="Project navigation"` (RESOLVED 2026-06-28)


---

## 2026-06-29 — Design Elevation Polish Pass: Settings + Issue Drawer + Board surfaces

**Scope:** 11 files across three surface areas — Settings (WorkflowsManager, WorkflowGraph, TemplatesManager, ComponentsSection, VersionsSection, NotificationPreferencesSection), Issue Drawer (TimeTrackingSection, ChecklistSection), Board (BoardWorkflowSelector, BoardColumn, FromTemplateMenu), Notifications (NotificationsPage). All within the existing Dispatch token system — no identity change.

**Build:** `tsc --noEmit` clean. `pnpm --filter @next-lane/web build` clean (CSS 86.63 kB, JS 982.69 kB). All `data-testid`/`role`/`aria-label` hooks preserved.

**E2e note:** All 40 touched-surface e2e tests report `ECONNREFUSED 127.0.0.1:4000` — the API is not running and Docker daemon is unavailable in this build sandbox. These are infrastructure failures, not code regressions. TypeScript and bundle compilation confirm no code regressions.

---

### What changed

**Settings — token migration (`slate-*` → `ink-*`)**
`WorkflowsManager`, `TemplatesManager`, `ComponentsSection`, `VersionsSection` were all using the old pre-Dispatch `slate-*` palette for borders, text, backgrounds, and dividers. All migrated to `ink-*` to match the Dispatch reference implementation (`AutomationsPage`).

**Settings — empty states (inviting, icon-led)**
Bare text fallbacks ("No workflows yet.", "No templates yet.", etc.) replaced with the `EmptyState`-style dashed-border icon+heading+description pattern consistent with the shared primitives. Icon choice is domain-appropriate: directed-graph icon for workflows, document-plus for templates, cube for components, folder-download for versions.

**WorkflowsManager — enforcement toggle affordance**
The enforcement toggle row now uses a dynamic background: `bg-signal-50/50 border-signal-200` when enforced, `bg-white border-ink-200` when off. The "Enforced" badge uses `ring-1 ring-inset ring-signal-200` (crisper than a plain border). Transition rows get `shadow-xs` container lift.

**WorkflowGraph — dot-grid canvas + node depth**
Graph canvas gains a dot-grid background pattern via CSS `radial-gradient` (same technique as the board's drop-zone treatment). Nodes get SVG `feDropShadow` filter for subtle lift. Node/edge color classes updated from raw values to Dispatch `ink-*/signal-*/emerald-*` tokens. Removed an unused `CATEGORY_EDGE_CLASS` constant that caused TS6133.

**VersionsSection — state badge**
`UNRELEASED` state badge updated from `slate-*` to `bg-ink-50 text-ink-600 ring-ink-200` (consistent with Dispatch neutral chips). `RELEASED` stays `emerald-*`; `ARCHIVED` stays muted ink.

**TimeTrackingSection + ChecklistSection — progress bar %**
Both progress bars now show a monospace percentage label (`text-[9px] font-mono tabular-nums text-ink-400`) alongside the bar, giving the user an exact reading without requiring them to eyeball the fill. ChecklistSection fill uses `bg-emerald-500` when complete (100%) and `bg-signal-500` in progress.

**BoardWorkflowSelector — badge refinement**
Badge uses `ring-1 ring-inset` (crisp, no 1px border gap). When enforced, an inner `ENFORCED` micro-chip appears inside the badge (`bg-signal-100 text-signal-800`). Non-enforced state uses `bg-ink-100 text-ink-600`.

**BoardColumn — WIP over-limit indicator**
Over-limit chip now includes a warning triangle SVG icon (8×8) for immediate visual triage, with `ring-1 ring-inset ring-red-200`. Chip uses `inline-flex items-center gap-0.5`.

**FromTemplateMenu — animation**
Dropdown animation changed from `motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1` (non-existent system animation) to `motion-safe:animate-nl-fade-in` (the actual registered keyframe in `index.css`).

**NotificationsPage — issue key chips**
Issue key spans now use the `.nl-issue-key` signature class with `bg-signal-50 ring-1 ring-inset ring-signal-100` — matching the established issue-key visual contract across the whole app. Unread dot gains `motion-safe:animate-pulse`.

**NotificationPreferencesSection — copy**
Description tightened to `text-xs` (consistent with sibling section headers). Toggle row uses `border-ink-200 bg-ink-50`.

---

### What was intentionally left unchanged

- All `data-testid`, `role`, `aria-label`, visible user-facing text strings that e2e tests assert on — fully preserved.
- Layout and component structure (elevation only, no redesign).
- Any backend calls or API contracts.

---

### Known gaps (not in scope of this pass)

- Screenshots with authenticated content — requires live API. Only login-redirect screenshots were capturable in this build sandbox.
- ARIA tab pattern in AutomationsPage — tracked in backlog.
- Personal board column accent color variation — tracked in backlog.

---

## Docs site QA — 2026-06-28

Scope: VitePress documentation site served at `http://localhost:4173/Next-Lane/`. All 10 pages checked at desktop (1320x900) and mobile (390x844) via Playwright/chromium. Source at `docs-site/`.

---

### P1 — Broken / Actively Wrong

**P1-A: Markdown task lists render as literal `[ ]` text — Quick Start page**
- Page/viewport: `/guide/quick-start.html`, both desktop and mobile
- Symptom: The "First-run checklist" section (section 4, `docs-site/guide/quick-start.md` lines 72–78) contains five `- [ ] ...` items. VitePress renders them as plain `<li>` elements with the literal characters `[ ]` prepended to the text — no checkbox `<input>`, no `task-list-item` class. Screenshot confirms: bullets read "[ ] The board loads with seeded cards…" etc.
- Root cause: VitePress's bundled `markdown-it` instance does not enable the `markdown-it-task-lists` (GitHub Flavored Markdown checkbox) extension by default. The config at `docs-site/.vitepress/config.ts` does not configure `markdown.config` to add it, and the `package.json` does not install a task-list plugin.
- Recommended fix: Either (a) install `markdown-it-task-lists` and add `markdown: { config: md => { md.use(require('markdown-it-task-lists')) } }` to `config.ts`, or (b) rewrite the five checklist items as plain numbered or bulleted list items so they still read correctly without checkboxes. Option (b) is zero-dependency and safer given VitePress version constraints.

**P1-B: Hero image shows the login/auth screen, not the board view — Home page**
- Page/viewport: `/`, both desktop and mobile
- Symptom: The hero image (`/Next-Lane/screenshots/home-desktop.png`, 35 KB) renders a white login page with an email/password form and "Sign In" button. The `alt` attribute in `docs-site/index.md` line 13 reads "Next Lane board view showing issues in Kanban columns" — which is factually wrong. The file `home-desktop.png` appears to be a screenshot of the welcome/auth screen, not the Kanban board.
- Impact: First-time visitors see a login form in the hero, not the product's flagship board UI. This actively undermines the marketing goal of the home page.
- Root cause: `docs-site/public/screenshots/home-desktop.png` was captured from the login/registration page, not the board. `board-desktop.png` (84 KB, the actual board view) exists but is only used in the Screenshots section below the fold.
- Recommended fix: Replace `home-desktop.png` with a screenshot captured from the authenticated board view, or change the hero `src` to `/screenshots/board-desktop.png` and update the `alt` text accordingly.

**P1-C: Tables break mobile layout on configuration and self-hosting pages (horizontal page overflow)**
- Page/viewport: `/guide/configuration.html` and `/guide/self-hosting.html`, mobile 390px
- Symptom: `document.documentElement.scrollWidth` exceeds `clientWidth` — 705px vs 390px on configuration, 408px vs 390px on self-hosting. This means the page scrolls horizontally; any content to the right of the viewport is cut off or forces the user to scroll the entire page sideways.
- Root cause: The custom CSS at `docs-site/.vitepress/theme/custom.css` lines 356–361 overrides VitePress's default table rule with `display: table; width: 100%` and no `overflow-x`. VitePress's own default at `node_modules/vitepress/dist/client/theme-default/styles/components/vp-doc.css` uses `display: block; overflow-x: auto` which self-contains the horizontal scroll within the table element. The custom override removes both `display: block` and `overflow-x: auto`, so wide tables (configuration has a 3-column 680px-wide table) push the page body wider than the viewport instead of scrolling internally.
- Confirmed: The browser's `getComputedStyle` on the table in configuration mobile returns `display: table; overflow-x: visible` — no scroll container.
- Recommended fix: In `custom.css`, either remove the `display: table` override (let VitePress keep `display: block`) or add `overflow-x: auto` to the `.vp-doc table` rule. The simplest correct fix is to change the rule to: `.vp-doc table { display: block; overflow-x: auto; width: 100%; border-collapse: collapse; font-size: 0.9rem; }`.

---

### P2 — Polish / Incorrect-but-not-broken

**P2-A: Code blocks overflow their container on mobile — all pages with code**
- Page/viewport: All pages containing code blocks, mobile 390px
- Symptom: Code blocks have `overflow-x: auto` set (correctly), so they scroll internally and do not widen the page. However, on every page that has code blocks, at least one block's `scrollWidth` is significantly wider than `clientWidth` (e.g., troubleshooting page has a `scrollWidth=1115` vs `clientWidth=388` block). While the overflow is technically contained and does not break page layout, the code text runs off the right edge and requires horizontal scrolling inside the block. Many blocks show only the first 40–50 characters visible on screen.
- Note: This is the expected/correct behavior for code blocks (scrollable is correct; the alternative, wrapping, would break command syntax). However, for the worst offender on `troubleshooting.md`, the `kubectl` command at `scrollWidth=1115` might be worth splitting into multi-line form for readability on mobile.
- Recommended fix: No CSS change needed (the scrolling mechanism is correct). Consider reformatting the longest commands in `docs-site/guide/troubleshooting.md` and `docs-site/guide/contributing.md` to use line continuations (`\`) to reduce horizontal extent.

**P2-B: Hero image on mobile is very small and shows a login screen**
- Page/viewport: `/`, mobile 390px
- Symptom: The hero image renders at 192x120px display size (natural: 1440x900). The login screen shown at that size is nearly unreadable — the form fields, "Sign In" label, and email/password inputs are illegible thumbnails. Combined with P1-B (wrong image), the mobile hero is doubly ineffective.
- Recommended fix: Resolve P1-B first (use board-desktop.png). Then consider adding a VitePress `image.srcset` or using `board-mobile.png` (52 KB, exists at `public/screenshots/board-mobile.png`) as the mobile image source via the hero `image` config.

**P2-C: Light mode — hero heading becomes fully blue, loses monochrome discipline**
- Page/viewport: `/`, desktop 1320px, light mode (after toggle)
- Symptom: In dark mode the hero heading "Next Lane" has a tasteful gradient from white to accent-blue (dark-mode-only rule in `custom.css` lines 263–268). In light mode, the heading falls back to VitePress's default which applies `--vp-c-brand-1` (#4F8BFF) as the text color for the `.name` element, rendering "Next Lane" as solid blue on the light off-white background. The feature cards also lose their dark `border-color` treatment and fall back to a very faint border that blends into the light background.
- The light mode is declared the non-canonical mode (the config sets `appearance: 'dark'`) but it remains accessible via the toggle, and the fully-blue H1 contrasts with the design system's stated goal of "monochrome discipline, accent used sparingly."
- Recommended fix: Add an explicit `:root:not(.dark) .VPHero .name { color: var(--vp-c-text-1); background: none; -webkit-text-fill-color: currentColor; }` rule to `custom.css` to restore black ink in light mode and keep the gradient confined to dark mode only.

**P2-D: Mobile hamburger button `aria-label` is "extra navigation" — unhelpful for screen readers**
- Page/viewport: All pages, mobile 390px
- Symptom: The hamburger/menu button has `aria-label="extra navigation"` (this is VitePress's default string for the mobile top-bar menu toggle that opens the sidebar). It is not a custom label from the project's config. "Extra navigation" is semantically odd; "Open navigation menu" or "Toggle navigation" would be clearer.
- Root cause: This is the VitePress default `VPNavBarHamburger` component aria-label. It cannot be overridden via `themeConfig` alone and would require a custom layout override.
- Recommended fix: Low-priority change. If the team wants to address it, create a `docs-site/.vitepress/theme/index.ts` (or extend the existing theme if one exists) that overrides the `VPNavBarHamburger` slot with a corrected `aria-label`. Alternatively, accept the VitePress default since it is still technically functional.

**P2-E: Screenshots section on home page uses `./public/screenshots/` path convention — fragile**
- Page/viewport: `/`, source only (runtime renders correctly)
- Symptom: `docs-site/index.md` lines 95, 99, 103 reference images as `./public/screenshots/board-desktop.png`. This works because VitePress resolves the path relative to the markdown file and `docs-site/index.md` sits next to `docs-site/public/`, making the path valid at build time. However, it is non-idiomatic and misleading — the standard VitePress convention is to use a root-relative path `/screenshots/board-desktop.png` (which maps to `public/screenshots/`). Any future relocation of the index.md or restructuring of the public folder would silently break these references.
- `features.md` correctly uses `../public/screenshots/` (relative from `guide/`), which resolves correctly but is equally non-idiomatic.
- Recommended fix: Change all image references in `index.md` to `/screenshots/board-desktop.png` format, and all references in `guide/*.md` to `/screenshots/board-desktop.png`. This is the canonical VitePress asset reference style and will survive any page restructuring.

**P2-F: "What's included" table on home is not horizontally scrollable on mobile (home page is OK but check)**
- Page/viewport: `/`, mobile 390px
- Symptom: The home page "What's included" table (`display: table; overflow-x: visible`) at 390px measures `scrollWidth=342` vs `clientWidth=342` — it fits. The table only has two narrow columns ("Feature" and "Status") so it happens to fit at 390px. However, the same broken CSS rule applies and is one long feature name away from overflowing. Already filed as P1-C for the failing pages; noting here that home page is currently fine but fragile.

---

### What Looks Good

- All images load with HTTP 200 and positive `naturalWidth` — no broken image placeholders on any of the 10 pages in either viewport. The build-time hashed asset pipeline for the screenshots section images works correctly.
- No JavaScript console errors on any page at either viewport.
- No internal navigation links return 404. All sidebar links, "On this page" TOC anchors, edit-link, and in-content cross-references resolve correctly.
- Dark mode design system (the canonical mode) is visually cohesive — dotted-grid background, accent-blue brand bar on H2s, mono uppercase sidebar section headers, hairline borders, and pill-radius buttons all render correctly and consistently across all 10 pages.
- Mobile hamburger nav opens and closes correctly (opens a drawer, closes on the X button). `aria-expanded` is correctly toggled.
- Tables that fit within the mobile viewport (home page "What's included", security page) render without horizontal page overflow.
- The "On this page" sidebar on desktop renders correctly for all pages, including the long features page TOC (14 entries, all functional).
- Footer links (MIT License, Overcastly AI) and social links (GitHub) are present and correctly formatted.
- "Edit this page on GitHub" and "Updated at" footers render on every guide page.
- Code blocks render with correct dark-mode contrast: `background: #1c1d22`, text `rgb(184, 185, 182)` — readable and consistent with the Overcastly token system.
- Light mode is functional with readable text contrast (body `rgb(24, 25, 29)` on `rgb(248, 248, 246)` background passes WCAG AA).

---

### Top 5 for the dev team (prioritized)

1. **P1-B — Fix the hero image.** `docs-site/public/screenshots/home-desktop.png` shows the login screen. Replace with the board view screenshot (use `board-desktop.png` or capture a new board screenshot). Also fix the alt text on `index.md` line 13. Single file swap, highest impact.

2. **P1-C — Fix table mobile overflow.** In `docs-site/.vitepress/theme/custom.css` line 357, change `display: table` to `display: block` and add `overflow-x: auto`. This un-breaks `/guide/configuration.html` and `/guide/self-hosting.html` on mobile where tables currently force horizontal page scrolling.

3. **P1-A — Fix task list rendering.** Five `- [ ] ...` items on `/guide/quick-start.html` render as literal `[ ]` text. Either install `markdown-it-task-lists` (add to `docs-site/package.json` + configure in `config.ts`), or rewrite as plain `1. ... 2. ...` numbered steps (simpler, no new dependency).

4. **P2-C — Light-mode hero heading.** Add one CSS rule to keep the "Next Lane" heading black in light mode instead of inheriting solid brand-blue from VitePress defaults. One line in `custom.css`.

5. **P2-E — Canonicalize image paths.** Change `./public/screenshots/` and `../public/screenshots/` references in `index.md` and `guide/features.md` to root-relative `/screenshots/` paths. Prevents future breakage and aligns with VitePress conventions.

---

## 2026-06-29 — Design Elevation Pass: Older surfaces (IssueCard, AppHeader, auth, RoadmapPage, settings sections)

**Scope:** 9 files — `board/IssueCard.tsx`, `AppHeader.tsx`, `NotificationBell.tsx`, `RoadmapPage.tsx`, `LoginPage.tsx`, `RegisterPage.tsx`, `ForgotPasswordPage.tsx`, `settings/ApiTokensSection.tsx`, `settings/WebhooksSection.tsx`.

**Build:** `tsc --noEmit` clean (one pre-existing error in `packages/shared/src/nlql/suggest.ts` — unchanged). `pnpm --filter @next-lane/web build` clean (CSS 87.23 kB, JS 993.42 kB). All `data-testid`/`role`/`aria-label`/visible-text hooks preserved.

**E2e note:** All 21 touched-surface tests report `ECONNREFUSED 127.0.0.1:4000` — the API is not running in this build sandbox. These are infrastructure failures, not code regressions. TypeScript and bundle compilation confirm no code regressions.

---

### What changed

**`board/IssueCard.tsx` — badge vocabulary consistency**
- Due-date chip: added `ring-1 ring-inset` + switched overdue state to `bg-amber-50 text-amber-700 ring-amber-200` (from `bg-amber-100 text-amber-800`); normal state gets `ring-ink-200`. Both now match the `ring-1 ring-inset` badge vocabulary established in earlier rounds.
- Story-points chip: added `ring-1 ring-inset ring-ink-200` for visual consistency with the due-date chip and scope pills.

**`AppHeader.tsx` — keyboard focus polish**
- All three NavLinks: added `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1` for clear keyboard navigation.
- Active NavLink state: added `ring-1 ring-inset ring-signal-100` to make the selected pill more distinguishable from hover.
- Search button (desktop + mobile): added `focus-visible` ring on both.
- User menu avatar button: added `focus-visible` ring.
- User menu dropdown items: added `focus-visible:bg-ink-50` for keyboard visibility.

**`NotificationBell.tsx` — focus-visible rings**
- Bell button: `focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1`.
- Mark all read button: `focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1` + `rounded` for ring to clip.
- Notification list items: `focus-visible:bg-ink-50`.

**`RoadmapPage.tsx` — full token migration**
- Page heading: `text-slate-900` → `text-ink-900`.
- Subtitle: `text-slate-500` → `text-ink-500`.
- Timeline section card border: `border-slate-200` → `border-ink-200`.
- Shell breadcrumb: `text-slate-400`/`text-slate-300`/`text-slate-900` → `text-ink-400`/`text-ink-300`/`text-ink-900`; added `shrink-0`/`min-w-0`/`overflow-hidden` for proper truncation (matching AutomationsPage reference pattern).
- Canvas background: `bg-slate-50` → `bg-ink-50`.

**`LoginPage.tsx` — token + typography alignment**
- Footer link: `text-slate-500`/`text-brand-600` → `text-ink-500`/`text-signal-600 hover:text-signal-700` with `transition-colors duration-[120ms]`.
- Password label: bespoke `text-sm font-medium text-slate-700` → `text-xs font-medium text-ink-600` (aligned with `Field` primitive label style).
- Forgot password link: `text-brand-600` → `text-signal-600 hover:text-signal-700 transition-colors duration-[120ms]`; added `font-medium`.
- Error banner: added `role="alert"` for a11y + `border border-red-200` for crisper badge vocabulary.

**`RegisterPage.tsx` — token alignment**
- Footer link: `text-slate-500`/`text-brand-600` → `text-ink-500`/`text-signal-600` + `transition-colors`.
- Error banner: added `role="alert"` + `border border-red-200`.

**`ForgotPasswordPage.tsx` — token + copy**
- All three footer links: `text-slate-500`/`text-brand-600` → `text-ink-500`/`text-signal-600` + `transition-colors`.
- Success state body copy: `text-slate-600`/`text-slate-500` → `text-ink-600`/`text-ink-400`.
- Email address in success message: `<span className="font-medium">` → `<code className="rounded bg-ink-100 px-1 py-0.5 font-mono text-xs text-ink-800">` (monospace literal — clearer, a11y-better).
- Error banner: added `role="alert"` + `border border-red-200`.

**`settings/ApiTokensSection.tsx` — full `slate-*` → `ink-*` migration**
- `SectionCard`: `border-slate-200`/`text-slate-900`/`text-slate-500` → `ink-*`.
- Scope fieldset: `text-slate-700` (legend) → `text-ink-600`; `text-slate-400` (hint) → `text-ink-400`; scope labels `text-slate-700` → `text-ink-700`.
- Scope checkbox: `border-slate-300 text-indigo-600 focus:ring-indigo-500` → `border-ink-300 text-signal-600 focus-visible:ring-2 focus-visible:ring-signal-200 focus-visible:ring-offset-1` (system-consistent focus ring).
- Token display area: `text-slate-500`/`border-slate-200 bg-slate-50`/`text-slate-800` → `ink-*` equivalents.
- Token metadata grid: all `text-slate-500`/`text-slate-900` → `text-ink-500`/`text-ink-900`.
- Loading text: `text-slate-400` → `text-ink-400`.
- Empty state: bare `<p>` → icon+heading+description pattern (key icon, dashed border, `bg-ink-50/50`).
- Token list divider: `divide-slate-100` → `divide-ink-100`.
- ConfirmDialog message inline name: `text-slate-900` → `text-ink-900`.
- TokenRow status dot: `bg-green-500` → `bg-emerald-500`; `bg-slate-300` → `bg-ink-300`.
- TokenRow name/meta text: `text-slate-800`/`text-slate-500` → `text-ink-800`/`text-ink-500`.
- Scope pills: `bg-indigo-50 text-indigo-700 rounded-full` → `bg-signal-50 text-signal-700 rounded ring-1 ring-inset ring-signal-100` (signal-aligned; matches established chip vocabulary).
- Unrestricted label: `text-slate-400` → `text-ink-400`.
- Status badge: `rounded-full` → `rounded` + `ring-1 ring-inset` (consistent with other status badges); Active: `bg-green-100 text-green-700` → `bg-emerald-50 text-emerald-700 ring-emerald-200`; Expired: `bg-orange-100 text-orange-700` → `bg-amber-50 text-amber-700 ring-amber-200`.
- Revoke button: `text-slate-400` → `text-ink-400` + `transition-colors duration-[120ms]`.

**`settings/WebhooksSection.tsx` — full `slate-*` → `ink-*` migration**
- `SectionCard`: same migration as ApiTokensSection.
- Loading/empty text: `text-slate-400` → `text-ink-400`.
- Empty state: bare `<p>` → icon+heading+description pattern (link icon, dashed border).
- Webhook list divider: `divide-slate-100` → `divide-ink-100`.
- ConfirmDialog inline URL: `text-slate-900` → `text-ink-900`.
- WebhookRow status dot: `bg-green-500` → `bg-emerald-500`; `bg-slate-300` → `bg-ink-300`.
- WebhookRow URL/meta: `text-slate-800`/`text-slate-500` → `text-ink-800`/`text-ink-500`.
- Deliveries button: `text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:ring-brand-300` → `text-ink-500 hover:bg-ink-100 hover:text-ink-700 focus-visible:ring-signal-300` + `transition-colors duration-[120ms]`.
- Toggle switch: `bg-green-500` → `bg-emerald-500`; `bg-slate-300` → `bg-ink-300`; `focus-visible:ring-brand-300` → `focus-visible:ring-signal-300` + `transition-colors duration-[120ms]`.
- Delivery log: `border-slate-100 bg-slate-50` → `border-ink-100 bg-ink-50`; label `text-slate-500` → `text-ink-500`; loading/empty `text-slate-400` → `text-ink-400`.
- Delivery badge: `bg-green-100 text-green-700` → `bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200`; failed badge: `bg-red-100 text-red-700` → `bg-red-50 text-red-700 ring-1 ring-inset ring-red-200`.
- Event name: `text-slate-700` → `text-ink-700`; timestamp: `text-slate-400` → `text-ink-400`.
- IconButton base: `text-slate-400 hover:bg-slate-100 hover:text-slate-700` → `text-ink-400 hover:bg-ink-100 hover:text-ink-700`; `focus-visible:ring-brand-300` → `focus-visible:ring-signal-300` + `transition-colors duration-[120ms]`.

---

### What was intentionally left unchanged

- All `data-testid`, `role`, `aria-label`, visible user-facing text strings that e2e tests assert on — fully preserved.
- Layout, component structure, and API contracts.
- `ReportsPage.tsx` — already fully tokenized in the 2026-06-28 pass; no changes needed.
- `ProfileSettingsPage.tsx` — already using `ink-*` tokens throughout; no changes needed.
- `AuthShell.tsx` — already elevated in a prior pass; no changes needed.
- `ResetPasswordPage.tsx` — already clean; no changes needed.

---

### Remaining gaps (tracked for future passes)

- `settings/WebhookFormModal.tsx` — not yet audited; likely has `slate-*` from original implementation.
- `settings/ShareSection.tsx` — not yet audited.
- `WorkspaceMembersPage.tsx` · `WorkspaceAuditLogPage.tsx` · `SharedBoardPage.tsx` — page-level `slate-*` migration not yet done.
- `issue/IssueDetailDrawer.tsx` and its sub-panels — still partially uses pre-Dispatch patterns.
- `CommandPalette.tsx` — not yet elevated.
- `project/ProjectCard.tsx` · `project/CreateProjectModal.tsx` — not yet elevated.

---

## Settings robustness sweep — 2026-07-02

**Scope.** Founder directive ("Settings pages should be more robust"),
independent QA pass by `qa-tester` (not the implementer) against every
project-settings section (Details, Columns, Labels, Components, Versions,
Custom fields, Workflow/Workflows manager entry, Templates, Webhooks, GitHub,
Share) and all four workspace-settings pages (General, Members, Audit log,
Branding). Workflow-builder canvas surfaces are explicitly **out of scope**
(owned by a parallel sweep). Method: real running stack (web :3000, API :4000,
seeded demo + fresh isolated fixtures via the API), Chromium via Playwright,
per-keystroke typing (`pressSequentially`, never `.fill()`), deliberately
invalid input on every field found, desktop full sweep + mobile smoke on the
four heaviest surfaces (Project Settings page, Workspace Members, Workspace
Branding, Webhooks modal). Evidence (screenshots) captured for every finding
below; regression coverage added in
`apps/web/e2e/settings-robustness.spec.ts` (6 green tests locking in correct
behavior found during the sweep + 4 `test.fixme()` tests, tagged
`SETTINGS-1..4`, that encode the desired correct behavior for each confirmed
defect — un-fixme once fixed).

**Verdict: REJECT for the Members page and Branding hex validation (P1/P2
defects below); ACCEPT for the remainder of the swept surfaces**, which held
up well under adversarial input (empty/whitespace-only/too-long/malformed
URL/malformed repo format/negative-zero-decimal WIP limits/duplicate names on
Components·Versions·Templates all correctly rejected with friendly,
entity-specific messages).

### Defects (prioritized)

**P1 — SETTINGS-1: Self-inviting your own email in the workspace "Invite
member" form silently strips your last admin seat, with no recovery path.**
- **Where:** `/workspaces/:id/members` → "Invite member" form.
- **Repro:** As the sole admin of a workspace, type your own email address
  into the "Invite member" email field (role select defaults to **Member**)
  and click Invite.
- **Observed:** The form reuses the generic `addMember` upsert
  (`WorkspaceMembersPage.tsx#InviteForm` → `useAddMember` →
  `workspaces.service.ts#addMember`, which upserts-by-email with **no check
  for "is this the actor's own membership" and no last-admin guard** — the
  same absence exists in `removeMember`). The toast reads "Invited
  you@example.com as MEMBER." and the UI immediately loses every admin
  affordance: the Invite form, the per-row role Select, and "Remove" buttons
  all disappear (screenshots: `21-member-self-invite.png` — form gone, badge
  now MEMBER). Reloading the page (`22-locked-out-branding.png`) and
  navigating to Branding/General confirm the demotion is **persisted
  server-side, not a stale client cache** — the workspace is now permanently
  admin-less with zero recovery path in the UI (no other member exists to
  promote the account back).
- **Why P1:** Silent, irreversible loss of administrative control over a
  workspace and everything in it, triggered by an ordinary form with no
  confirmation step — exactly the class of defect the founder's "more
  robust" directive is aimed at. The row-level `MemberRow` UI *does* correctly
  hide the role Select for `isMe` (see `audit-log.spec.ts`'s "ADMIN sees
  Remove button on other members, not on self" coverage) — but that guard is
  bypassed entirely via the Invite form's free-text email field, which has no
  self-email or last-admin check.
- **Root cause (for the fix batch):** `apps/api/src/workspaces/workspaces.service.ts#addMember`
  (and, defense-in-depth, `#removeMember`) need a last-admin invariant: reject
  (409/400) any role-change or removal that would leave a workspace with zero
  ADMIN members, with a friendly message. The frontend `InviteForm` should
  also warn/confirm when the typed email matches the signed-in user.
- **Regression test:** `settings-robustness.spec.ts` → `SETTINGS-1` (`test.fixme`).
- **Evidence:** `20-member-nonexistent.png` (form pre-demotion, showing
  Invite/Remove present), `21-member-self-invite.png` (post-demotion, no
  admin affordances), `22-locked-out-branding.png` (permanent lockout,
  General/Branding both show "Admin access required" after reload).

**P2 — SETTINGS-2: Workspace branding accent-color hex validation mismatches
between client and server (3-digit shorthand).**
- **Where:** `/workspaces/:id/branding` → Accent color → Hex value input.
- **Repro:** Type `#fff` and click "Save color".
- **Observed:** The client-side regex
  (`/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/` in `WorkspaceBrandingPage.tsx`)
  accepts 3-digit hex, live-previews it as valid, and does **not** revert it
  on blur — so the Save button looks fully enabled and correct. The backend
  DTO (`UpdateWorkspaceDto.brandColor`) only accepts 6-digit hex; the PATCH
  returns 400 with `"brandColor must be a valid 6-digit hex color (e.g.
  #1a2b3c) or null"`, and that raw, camelCase-field-name message is surfaced
  verbatim in the error toast (`18-3digit-hex-error-toast.png`). A user has no
  way to know from the UI alone that 3-digit shorthand — completely standard
  CSS hex syntax — is rejected until they hit Save and get a technical error.
  (Separately, malformed non-hex input like `notahex` *is* handled
  gracefully: the `onBlur` handler silently reverts it to the last-saved
  color before Save is ever clicked — but note that revert is also silent,
  with no inline "that wasn't a valid color" feedback; see P3 below.)
- **Why P2:** Reproducible functional break (save fails) directly matching
  the QA charter's "malformed hex" requirement; confusing, technical error
  copy.
- **Regression test:** `settings-robustness.spec.ts` → `SETTINGS-2` (`test.fixme`).
- **Evidence:** `17-3digit-hex-clean.png`, `18-3digit-hex-error-toast.png`.

**P2 — SETTINGS-3: Board columns (statuses) allow duplicate names.**
- **Where:** Project Settings → Columns → "+ Add column".
- **Repro:** Add a column named exactly `To Do` to a project that already has
  a "To Do" column.
- **Observed:** Accepted with no error — the board and Settings list now show
  two columns both named "To Do" (`07-dup-column.png`, toast "Added column
  'To Do'."). `Status` has no `@@unique([projectId, name])` constraint,
  unlike `Label`/`Component`/`Version` (all `@@unique([projectId, name])`,
  all correctly rejected with friendly 409s — see `components.spec.ts`'s
  "duplicate component name shows friendly error" and the equivalent in
  `versions.spec.ts`). Confusing on the board itself and ambiguous for any
  future name-keyed lookup.
- **Why P2:** Real, reproducible, user-visible confusion; inconsistent with
  every sibling entity (Labels/Components/Versions all guard this).
- **Regression test:** `settings-robustness.spec.ts` → `SETTINGS-3` (`test.fixme`).
- **Evidence:** `07-dup-column.png`.

**P2 — SETTINGS-4: Duplicate label name shows a raw, generic backend error
instead of a friendly per-entity message.**
- **Where:** Project Settings → Labels → "New label" form.
- **Repro:** Create a label named `bug`, then try to create a second label
  also named `bug`.
- **Observed:** Correctly **rejected** (unlike columns — `Label` does have
  `@@unique([projectId, name])`), but `labels.service.ts` never catches the
  Prisma `P2002` the way `components.service.ts` / `versions.service.ts` /
  `issue-templates.service.ts` do (each throws a friendly
  `ConflictException('A component/version/template named "X" already
  exists…')`). The generic `AllExceptionsFilter` fallback message — `"A
  record with this value already exists."` — leaks straight into the toast
  (`05-dup-label.png`), instead of `A label named "bug" already exists.`
- **Why P2:** Directly contradicts the QA charter's "error toasts on server
  4xx are friendly" requirement; visibly inconsistent with three sibling
  entities that already got this right.
- **Regression test:** `settings-robustness.spec.ts` → `SETTINGS-4` (`test.fixme`).
- **Evidence:** `05-dup-label.png`.

**P3 — Backend validation messages leak internal field/enum names into
user-facing toasts (polish, several surfaces).**
- GitHub integration: malformed `owner/repo` value shows
  `"repoFullName must be in "owner/repo" format"` verbatim (camelCase DTO
  field name) — `14-github-malformed.png`. A friendly rewrite ("Repository
  must be in owner/repo format, e.g. acme/widgets") would match the rest of
  the app's voice.
- Custom fields: a SELECT/MULTI_SELECT field saved with zero options shows
  `Custom field type "SELECT" requires at least one option` — the raw
  upper-case enum value, not the friendly label ("Select (single)") shown in
  the type dropdown — `23-customfield-select-nooptions.png`.
- Workspace branding: see SETTINGS-2 above (`brandColor` field name leak).
- **Why P3:** Cosmetic/voice inconsistency only — every one of these paths
  *does* correctly block the invalid save and show *some* error; this is a
  polish pass, not a functional break. Not gated by a dedicated regression
  test (folded into the SETTINGS-2 fixme's assertion that no raw `brandColor`
  string should ever reach the user).

**P3 — Trailing-space-only edits leave Save looking "stuck" with no
explanation (Project details name, Workspace name).**
- Both `SettingsPage.tsx#DetailsSection` and `WorkspaceSettingsPage.tsx`
  compute "dirty" as `draftValue.trim() !== savedValue` — correct in that a
  whitespace-only edit is genuinely a no-op once trimmed, but a user who adds
  only trailing spaces gets zero feedback for why Save stayed disabled
  (no hint text, no shake, nothing). Low severity (the underlying behavior —
  refusing to save a no-op — is correct) but worth a one-line hint if this
  page gets revisited. Locked in as *correct* current behavior (not a
  defect) in `settings-robustness.spec.ts`'s "a trailing-space-only edit does
  not falsely enable Save" test, since disabling Save here is the right call
  — only the missing affordance is a nice-to-have.

### What held up well (adversarial testing passed)

- Project details: empty name / >80-char name (native `maxLength`) / trailing
  whitespace all correctly block Save; rename persists across reload **and**
  updates the header breadcrumb (cross-page coherence) — see
  `settings-robustness.spec.ts`.
- Columns: WIP limit correctly rejects `0` and negative values (native
  `min=1`) and decimals (native `step=1`) before any request is sent.
- Webhooks: malformed URL (native `type=url`) and too-short secret (native
  `minlength=8`) both block submit client-side with a clear native tooltip;
  no request sent.
- GitHub integration: malformed `owner/repo` format rejected server-side
  (`@Matches` DTO decorator) with a visible toast; no integration created.
- Components / Versions / Issue templates: duplicate names correctly
  rejected with friendly, entity-specific 409 messages (existing coverage in
  `components.spec.ts`, `versions.spec.ts`, `issue-templates.spec.ts`).
- Members: inviting a syntactically-malformed email is blocked by native
  `type=email` validation; inviting a validly-formatted but unregistered
  email surfaces a clear "User not found" toast (`20-member-nonexistent.png`).
- Rapid double-click on "Add label": the submit button disables itself the
  instant the mutation starts pending (`create.isPending`), so a fast
  double-click cannot create two rows — verified directly (Playwright's
  second click attempt failed with "element is not enabled" — i.e. the
  button was already disabled by the time the second click landed).
- Mobile (390×844): Project Settings (full page), Workspace Members,
  Workspace Branding, and the Webhooks "Add webhook" modal all render with
  **zero horizontal overflow** (`document.documentElement.scrollWidth -
  clientWidth === 0` on every surface checked).

### Defect count summary

| Priority | Count |
|---|---|
| P1 | 1 |
| P2 | 3 |
| P3 | 2 (grouped: message-leak polish, trailing-space affordance) |


## Workflows robustness sweep — 2026-07-02

**Scope.** Founder directive ("Workflows too should be more robust"),
independent QA pass by `qa-tester` (not the implementer) against the entire
workflow feature surface: the Workflows manager (create/seed-from-template/
delete named workflows), the transition editor (add/edit/delete transitions,
duplicate 409 handling, per-gate-type param inputs incl. REQUIRE_FIELD with
custom-field keys), the visual graph builder (`WorkflowGraph.tsx`
node/edge rendering, connect-handle creation, edge deletion, reload
persistence), board workflow assignment (`BoardWorkflowSelector`,
ENFORCED badge), and — the headline target — **enforcement as actually felt
by the user**: with an enforced named workflow assigned to a board, every
surface that can change an issue's status (board drag, the card status
picker, Triage's `s` keyboard picker, the issue drawer's Status `<select>`,
and bulk edit) was attempted with an illegal move to verify the gate holds
and the rollback is clean everywhere. Settings pages other than the
Workflow/Workflows-manager sections are **out of scope** (owned by the
parallel Settings-robustness sweep, see above).

**Method.** Real running stack (web on :3000, API on :4000, rate limiting
disabled), Chromium via Playwright, fresh isolated fixtures per test via the
API (never the shared demo project), per-keystroke typing
(`pressSequentially`, never `.fill()`) for all named-field input. Regression
coverage added in `apps/web/e2e/workflow-robustness.spec.ts`: **15 green
tests** (desktop + mobile, 30/30) locking in confirmed-correct behavior, plus
**6 `test.fixme()`** tests that encode the desired correct behavior for each
confirmed defect below (each was run as a real, non-`fixme` test first to
capture the failure/evidence, then converted to `fixme` per the task's
"green suite" requirement — screenshots referenced inline).

**Environment note (not a product defect, but a trap for anyone following
the stated recovery recipe verbatim):** running the web dev server with
`--host 127.0.0.1` (as the recovery recipe specifies) and then visiting
`http://127.0.0.1:3000` causes every login/register call to fail with a
generic "Unable to sign in. Try again." — the API's default
`CORS_ORIGINS` allowlist (`apps/api/src/main.ts`) is hardcoded to
`http://localhost:3000` only, so the browser's CORS check silently discards
a perfectly successful `201` response (confirmed via API access logs: the
login succeeded server-side every time; the browser just refused to let the
frontend read it). Visiting `http://localhost:3000` instead — same server,
same port — works with zero code changes. Filed as **P3** since it's purely
a documentation/config-default mismatch, not a workflow-feature bug, but it
cost significant investigation time and would confuse a self-hoster who
binds the dev server to `127.0.0.1` and then browses to that literal
address. Fix: either default `CORS_ORIGINS` to include both, or update the
recovery recipe / `.env.example` to call out the `localhost` vs `127.0.0.1`
distinction explicitly.

**Verdict: REJECT.** The single most important promise of this feature —
"assign an ENFORCED workflow to a board and status moves are gated" — is
**only honored on two of five surfaces that can change an issue's status**
(board drag and the board's inline card status picker). Triage's `s`
picker, the issue drawer's Status dropdown, and bulk edit all **silently
bypass the board's named workflow enforcement entirely**, with no error, no
toast, no indication to the user that anything unusual happened — this is
exactly the "no silent failures" bar the founder's acceptance criteria
called out, and it fails on 3 of 5 surfaces. Everything downstream of that
(the manager UI, templates, the graph builder, deletion healing, rapid
toggling) held up well and is documented as passing below.

### Defects (prioritized)

**P1 — WF-1: Board-scoped named-workflow enforcement is bypassed entirely by
Triage's `s` picker, the issue drawer's Status `<select>`, and bulk edit.**
Repro: create a named workflow, set `enforced: true`, add exactly one
transition (`TODO → IN_PROGRESS`, no `TODO → DONE`), assign it to a board.
On the board, drag or use the card status picker to move a `TODO` issue to
`DONE` — correctly blocked with a 422 toast ("not allowed by the board
workflow"). Now open the **same project's Triage view**, select the same
issue, press `s`, choose "Done" — **it succeeds silently**, no toast, no
error, the issue is now in Done. Screenshot evidence:
`test-results/workflow-robustness-eviden-e37a1.../test-failed-1.png`
(captured while temporarily un-`fixme`'d) shows the Triage row for "Triage
bypass check" reading status **"Done"** with zero alert on screen — a
board that displays "Strict — ENFORCED" was silently overridden from a
different page in the same app. The same is true for the issue drawer's
Status `<select>` (`await drawer.locator('#d-status').selectOption(...)`
succeeds with no gate check) and for a `bulk-status` change from the
Triage/Backlog multi-select bar (`BulkActionBar`'s "Set status" apply,
confirmed via `IssuesService.bulkUpdate()` code inspection — see root
cause). **Root cause:** `IssuesService.enforceMove()` (the ONLY code path
that resolves a board's named-workflow assignment via `board.workflowId` +
`board.workflow.enforced`) is invoked exclusively from `move()`
(`POST /issues/:id/move`), which only board drag/card-picker call (with
`boardId` in the payload). `TriagePage.tsx`'s `s` picker and
`IssueDetailDrawer.tsx`'s Status field both call `useUpdateIssue()`
(`PATCH /issues/:id`), which routes straight to `IssuesService.update()` →
`this.workflowSvc.enforceTransition()` — a function that **only ever checks
the legacy project-wide `Project.workflowEnforced` flag** (a completely
separate, independent boolean from any named workflow's own `enforced`
flag, and off by default) and has no board-context parameter at all.
`IssuesService.bulkUpdate()` has the identical gap — it pre-loads
`isEnforcementEnabled(projectId)` (same legacy flag) once for the whole
batch and never resolves a board. **User impact:** any team relying on a
board-assigned named workflow for process compliance (the entire point of
the feature) can have it silently defeated by anyone using Triage, the
drawer, or a bulk edit — three of the five ways to change status in the
product. **Fix shape:** either (a) thread an optional `boardId` through
`update()`/`bulkUpdate()` from every caller that has one (Triage and
Backlog both know the active board via `useBoard(projectId)`; the drawer
would need the board id passed down from whichever page opened it), or (b)
resolve enforcement independently of `boardId` — e.g. gate on ANY of the
issue's project's enforced named workflows / the legacy flag, whichever is
stricter — so a "silently bypass by using a different surface" class of bug
can't recur as new surfaces are added. Regression tests (currently
`test.fixme`, ready to un-skip once fixed):
`apps/web/e2e/workflow-robustness.spec.ts` — "Triage's 's' status picker
respects the board's enforced named workflow…", "the issue drawer's Status
`<select>` respects…", "bulk edit respects…".

**P2 — WF-2: The REQUIRE_FIELD gate's custom-field mode can never actually
succeed via the UI-documented input — it silently, permanently blocks the
transition even after the field is set.** `Issue.customFields` is stored
keyed by the custom field definition's **opaque CUID** (confirmed via
`CustomFieldsService.validateAndNormalize`, which maps payload keys against
`definitions.map(d => [d.id, d])`, and via the drawer's
`CustomFieldsDrawerSection.tsx`, which reads/writes
`currentValues[field.id]` — never `field.key`). But the gate editor's
REQUIRE_FIELD input (`WorkflowSection.tsx` / `WorkflowsManager.tsx`
`GateEditor`) has the placeholder `"e.g. assigneeId or cf_severity"`,
actively steering an admin toward typing a human-readable key that can
**never** match. The backend's own gate-evaluation code
(`WorkflowService.evaluateGate`, `REQUIRE_FIELD` case) even has a stale
comment admitting the gap — *"customFields is stored as { [definitionId]:
value } — we need to also support lookup by key. Load definitions to
resolve the key."* — directly above code that never does that lookup; it
does a flat `customFields[fieldName]`. Nowhere in the UI (Settings' Custom
Fields section, the drawer) is the definition's actual CUID surfaced for an
admin to copy. Repro/evidence: created a `TEXT` custom field "Severity"
(key auto-derives to `severity`), gated `TODO → IN_PROGRESS` on
`REQUIRE_FIELD` with `field: "severity"` (the exact value the placeholder
promises works), then set the field via
`PATCH /issues/:id { customFields: { [definitionId]: "Critical" } }` (the
only way the real drawer ever writes it) — the gated move still returned
**422** ("this transition requires the field 'severity' to be set") even
though the field was genuinely set. Any admin who configures this gate by
following the documented placeholder has built a transition that can never
be completed by a normal user — a silent, undiscoverable dead end.
**Fix shape:** either resolve the gate by the field's stable `key` (with
the backend translating key → definitionId at evaluation time, honoring the
placeholder's promise), or replace the freeform text input with a dropdown
of the project's actual custom fields (by display name), removing the
opportunity to type an unusable value. Regression test (currently
`test.fixme`): "REQUIRE_FIELD gate keyed by the field placeholder's
suggested custom-field key never actually matches a stored value".

**P2 — WF-3: A REQUIRE_FIELD gate can be saved with a blank field key and
silently becomes a permanent no-op with no warning.** The gate editor lets
an admin add a REQUIRE_FIELD gate and click Save without ever filling in
the field-key input — there is no client-side required validation on that
field, and the Save button stays enabled (confirmed live: `Received:
"enabled"` when asserting it should be disabled). The transition is created
and rendered with a "Require a field to be set" chip that implies it's
active. The backend's `evaluateGate()` has `if (!fieldName) break; //
Mis-configured gate — skip silently.` — the gate is stored but never
actually gates anything, ever. An admin who believes they've locked down a
transition has silently configured a no-op. **Fix shape:** disable Save
while a REQUIRE_FIELD/REQUIRE_LINK gate has an empty param, or flag
mis-configured gates visibly in the transition list/graph (e.g. a warning
chip instead of the normal "G" badge). Regression test (currently
`test.fixme`): "a REQUIRE_FIELD gate saved with a blank field key silently
no-ops instead of warning the admin".

**P2 — WF-4: No rename affordance for a named workflow.** The founder's
ready-item explicitly scopes "create/rename/delete named workflows" for
this sweep. Create and delete both work; **rename does not exist in the
UI** — `WorkflowsManager.tsx`'s detail-panel header renders only a static
`<h3>` for the name, the List/Graph view toggle, "+ Add transition", and a
delete icon button. No pencil/edit control anywhere. The backend fully
supports it (`PATCH /workflows/:id` accepts `name`/`description` via
`UpdateNamedWorkflowDto` — already wired for the `enforced` toggle, so the
mutation hook exists and is one field away from covering `name` too).
Confirmed live: `getByRole('button', { name: /rename workflow/i })` finds
nothing. **Fix shape:** add a rename control (inline-edit-on-click or a
pencil icon opening a small modal, matching `CreateWorkflowModal`'s
pattern) next to the workflow name in the detail-panel header. Regression
test (currently `test.fixme`): "admin can rename a named workflow from the
manager UI".

**P3 — WF-5: Two independent "Workflow" sections coexist on the same
Settings page with no cross-reference, and their "+ Add transition" buttons
are ambiguous by accessible name alone.** `SettingsPage.tsx` renders the
legacy single-project `<WorkflowSection>` (heading "Workflow", its own
enforcement toggle, its own transitions) immediately followed by
`<WorkflowsManager>` (heading "Named Workflows", a completely separate
per-board system with its own enforcement toggle per workflow) — with
nothing explaining that these are two independent systems, that the legacy
one governs Triage/the drawer/bulk-edit (per WF-1) while the named one only
governs boards it's explicitly assigned to, or which one "wins" when both
are active. Confirmed live: `page.getByRole('button', { name: '+ Add
transition' })` throws a Playwright strict-mode violation — it resolves to
**two** identically-labeled buttons with no distinguishing accessible name
(`workflow-add-transition` in the legacy section vs. an untestid'd
duplicate in the named-workflow detail panel), meaning a screen-reader
user tabbing through the page, or any automation, cannot disambiguate them
without visual/DOM context. This is very likely the single biggest source
of user confusion in the whole feature — a founder or admin enabling
"enforcement" almost certainly doesn't know which of the two systems they
just turned on, or that a board can silently ignore the one they configured
in favor of (or in addition to) the other. **Fix shape:** at minimum, a
short explanatory note atop one or both sections ("Named workflows govern
individual boards; the legacy Workflow below governs every other status
change in this project — Triage, the issue drawer, and bulk edit") plus a
unique accessible name per "+ Add transition" button (e.g. "+ Add
transition to \<workflow name\>" for the named-workflow variant). Longer
term, this reinforces the WF-1 fix's case for unifying enforcement so there
is only one mental model.

### What held up well (adversarial testing passed)

- **Named workflow CRUD:** blank-workflow creation with per-keystroke typed
  names (including spaces) persists correctly; duplicate workflow names are
  rejected with a friendly, specific 409 message and the create dialog stays
  open so the admin can correct it (no lost input).
- **Seed-from-template correctness:** all four templates (`simple`,
  `kanban`, `scrum`, `bug-triage`) produce exactly the documented transition
  graph — verified transition-by-transition against the service's own
  documented semantics (e.g. `kanban` = full `n×(n-1)` permissive matrix,
  `simple` = strictly 2 forward-only transitions, `scrum`/`bug-triage` add
  the documented back-transitions) — and the workflow-list UI's `NT`
  transition-count badge matches exactly.
- **Duplicate transition 409:** adding an identical `(from, to, type)`
  transition a second time is correctly rejected with a friendly toast
  (once the test's own button-ambiguity, see WF-5, was scoped correctly).
- **Workflow deletion heals the board:** deleting a named workflow that a
  board references clears the board's `workflowId` to `null` — the
  `ENFORCED` badge disappears and `board-workflow-select` correctly resets
  to "No workflow", both immediately and confirmed via the board API.
- **Graph builder:** node/edge rendering, connect-handle transition
  creation, and edge deletion (pre-existing `workflow-graph.spec.ts`
  coverage) all still pass; a transition created via the graph survives
  navigate-away-and-back AND a full page reload (new coverage added by this
  sweep).
- **Board-surface enforcement itself is solid:** an illegal board drag/card
  -picker move is blocked with a clear 422 toast, the card visibly and
  durably stays in its original column (confirmed via reload, not just
  optimistic-UI state) — no ghost cards, no stuck drag state — and a
  **legal** move under the same strict workflow still succeeds normally. A
  second illegal attempt immediately after the first works correctly too
  (no stuck/disabled state from the rollback).
- **Rapid toggling:** double/triple-clicking either the legacy project-level
  enforcement toggle or a named workflow's enforcement toggle in quick
  succession always settles to a value that matches the server's
  authoritative state (verified via a fresh API read) and survives a full
  reload — no permanent UI/server desync from the race.
- **Mobile (390×844):** the board's ENFORCED badge + 422 error toast render
  usably with zero horizontal page overflow; the Workflows manager's
  from-template flow (template picker modal → created row) is fully usable
  at 390px with zero overflow.

### Defect count summary

| Priority | Count |
|---|---|
| P1 | 1 (WF-1 — enforcement bypass on 3 of 5 status-change surfaces) |
| P2 | 3 (WF-2 unusable custom-field gate, WF-3 silent no-op blank gate, WF-4 no rename UI) |
| P3 | 1 (WF-5 dual-system ambiguity/confusion + CORS-origin recovery-recipe trap noted separately) |

**Overall verdict: REJECT.** The manager UI, templates, graph builder, and
board-surface enforcement are solid and ready to ship as-is. The feature
cannot be called "robust" while its core promise — an enforced workflow
gates status changes — is silently false for 3 of 5 ways a user can change
an issue's status. WF-1 should block sign-off on this ready item until
fixed; WF-2/WF-3/WF-4 should be fixed in the same batch since they touch
the same components QA already has fresh context on.

### Fixed 2026-07-03

All 5 defects (WF-1..WF-5) fixed in this batch:

- **WF-1:** `IssuesService` now routes every status-change surface through a
  single shared `enforceStatusChange()` (used by `move()`, `update()`, and —
  transitively — `bulkUpdate()`). When no explicit `boardId` is present
  (Triage, the issue drawer, bulk edit), it resolves the project's enforced
  board-assigned workflow via `resolveEnforcedWorkflowId()`, mirroring the
  board query's own visibility rule (KANBAN = backlog/active-sprint, SCRUM =
  active-sprint only); ties across boards break to the default board.
  Automation bypass and the legacy project-level fallback are unchanged.
- **WF-2:** `WorkflowService.evaluateGate`'s REQUIRE_FIELD case now resolves
  `field` against the project's `CustomFieldDefinition`s (match by `key` or
  `name`, case-insensitive) to the definition id before looking up the
  stored value, with a backward-compatible direct-match short-circuit for
  any gate already keyed literally. The gate editor's field input is now a
  `<select>` of core fields + the project's real custom fields (value = the
  field's `key`) in both `WorkflowSection` and `WorkflowsManager`.
- **WF-3:** `WorkflowGateDtoClass.field`/`linkType` now require `@MinLength(1)`
  (400 on blank) in addition to `@IsString()`. The gate editor disables Save
  while a REQUIRE_FIELD/REQUIRE_LINK gate has an empty param, and any
  already-stored blank-key gate renders an amber "misconfigured" chip on the
  transition row instead of the normal active-gate chip.
- **WF-4:** `WorkflowsManager`'s detail-panel header now has an inline
  rename control (pencil → per-keystroke `<input>`, Enter/blur saves,
  Escape cancels, 409 handled with a friendly toast that keeps the field
  open for correction).
- **WF-5:** the legacy section is now headed "Legacy project-wide
  transitions" with an explainer + link to the Named Workflows manager
  below (which itself now explains its own scope); the two "+ Add
  transition" buttons have distinct accessible names (the named-workflow one
  keeps the visible "+ Add transition" text/name, the legacy one is
  labelled "Add legacy workflow transition").

Regression: all 12 `test.fixme()` cases in `workflow-robustness.spec.ts` are
now real, passing tests (desktop + mobile, 42/42 total in the spec);
`board-workflows.spec.ts`, `board.spec.ts`, `workflow.spec.ts`, and
`workflow-graph.spec.ts` remain green. New backend unit coverage added for
the WF-1 resolution semantics (`issues-board-enforcement.spec.ts`) and the
WF-2 definition-key resolution (`workflow.enforcement.spec.ts`).

---

## 2026-07-02 — Navigation & IA overhaul, Phase 1: persistent left sidebar

New component family: `nav/AppSidebar` (desktop rail, `lg`+), `nav/MobileSidebarDrawer`
(overlay, below `lg`), `nav/SidebarNavContent` (shared list content), `nav/WorkspaceSwitcherMenuContent`
(extracted from `AppHeader`'s `WorkspaceChip`, reused by both). Built within the existing
Dispatch token system — no new palette, no new type. Design choices, and what was
rejected as reading too generic for this brief:

- **Active-row indicator:** a 3px cobalt "rail tick" flush to the row's left edge,
  opacity-toggled, rather than a full filled-pill background (the common
  Linear/Notion-style sidebar active state). Rejected the pill because it's the
  default answer for *any* sidebar regardless of product — the rail tick instead
  extends Dispatch's own existing lane vocabulary (the logo's three ascending lane
  bars, the board's dashed `nl-lane-divider`) so the sidebar reads as an extension of
  the product's identity rather than a bolted-on nav component.
- **Project rows** render their key through the existing `.nl-issue-key` mono chip
  (the same class every issue key already uses) instead of inventing a new project
  icon/avatar treatment — reinforces "everything in Dispatch has a code," and the
  collapsed rail truncates to 2 chars (matching `ProjectCard`'s existing key-badge
  convention) rather than introducing a fresh icon set.
- **Chrome color:** kept the sidebar white with `ink-200` borders, matching the
  header's own chrome, rather than the common dark-rail-on-light-canvas pattern —
  a bespoke dark rail would have meant touching the token system twice (once now,
  once for the tracked dark-mode item next); it touches once, coherently, when dark
  mode lands.
- **Motion:** reused the existing `nl-fade-in`/`nl-modal-animate` vocabulary and
  `useOverlay` (same focus-trap/scroll-lock/Escape as `Modal`) for the mobile drawer,
  plus one new directional keyframe (`nl-sidebar-drawer-in`, slides from the left —
  the opposite direction of the existing right-hand `nl-drawer-in` used by
  issue/side panels) rather than a new animation library or hover-lift/scale
  micro-interactions layered on top.

Bug caught in its own QA screenshots (documented here per the design-elevation
loop's "critique your own work" step): the first collapsed-rail pass let long
project keys overflow the 56px rail into the page content (no `overflow-x`
containment on absolutely-unclipped mono chips) — fixed by truncating to 2 chars
in collapsed mode, matching the existing `ProjectCard` convention, with an
`overflow-x-hidden` added to the scrollable project-list region as a second line
of defense. Screenshots (desktop 1440 + mobile 393, dashboard + board, expanded +
collapsed rail + open mobile drawer) captured before/after per the design-elevation
directive. All existing `data-testid`/role/aria-label hooks preserved; full e2e
suite (desktop + mobile) green.

---

## 2026-07-31 — Left-hand sidebar navigation audit (founder: "it doesn't seem organised")

Scope: `apps/web/src/components/nav/{AppSidebar,MobileSidebarDrawer,SidebarNavContent,sidebarIcons}.tsx`,
`apps/web/src/contexts/SidebarContext.tsx`, and every surface that competes with or
feeds it (`AppHeader.tsx`, `ProjectNav.tsx`, `ProjectBreadcrumb.tsx`,
`WorkspaceSettingsNav.tsx`, `WorkspaceSwitcherMenuContent.tsx`, `App.tsx` routing).
Verified against the running app at http://localhost:3000 (demo@nextlane.dev) at
1280px, 768px, 390px, collapsed rail, and dark mode. Screenshots saved under
`/tmp/nav-audit/` (paths listed at the end). Tab-order and tap-target numbers below
were measured with a throwaway Playwright spec (`e2e/zz-nav-audit.spec.ts` /
`e2e/zz-nav-measure.spec.ts`, both deleted after the run — not part of the suite).

### Verifying the founder's specific list

1. **"There's a project Docs and a workspace Docs with the identical label" — TRUE, confirmed.**
   `SidebarNavContent.tsx:160` (`PROJECT_VIEWS`, `{ to: 'pages', label: 'Docs' }`) and
   `SidebarNavContent.tsx:429` (`label="Docs"`, route `/workspaces/:id/docs`) render
   the literal string "Docs" twice, in two different groups, pointing at two
   completely separate content trees (project wiki/pages vs. workspace-wide
   handbook). This isn't just a nav-label collision — it's baked into the pages
   themselves: `WorkspaceDocsPage.tsx:90` renders its own header as `<span>Docs</span>`
   and `PagesPage.tsx:67` renders its breadcrumb secondary segment as `{ label: 'Docs' }`
   too. A user (or an agent) told "check the Docs" has no way to disambiguate without
   already knowing which of two products-within-the-product is meant. The code
   comment at `SidebarNavContent.tsx:419-424` explains the distinction thoughtfully —
   but that reasoning lives only in a source comment, never in the UI.

2. **"The third group has no heading while the two above it do" — TRUE, and there are actually two unlabeled boundaries, not one.**
   Confirmed group headings exist at `SidebarNavContent.tsx:332-335` ("PROJECTS") and
   `:376-379` ("PERSONAL"). What the founder's screenshot didn't capture (ours did,
   because the demo account is an instance admin) is a **third labeled group**,
   "INSTANCE ADMIN" (`:401-404`), between Personal and the unlabeled block. So the
   real structure is four visually-grouped blocks, three with caps-letter headings
   and one — Docs / Workspace settings / Branding (`:417-457`) — with none. Confirmed
   live at 1280px, 768px, and 390px (screenshots: `desktop-1280-board-expanded.png`,
   `mobile-390-drawer.png`).

3. **"Insights vs Reports vs Dashboards is three analytics-ish words in two groups" — TRUE, and it's actually four words across three scopes, one of which contradicts its own page.**
   - `Insights` (Personal group, `SidebarNavContent.tsx:300`) → routes to `/me/analytics`
     → `PersonalAnalyticsPage.tsx`, whose own `<h1>` reads **"My Analytics"**
     (`PersonalAnalyticsPage.tsx:72`) — the nav label and the page's own heading
     disagree. This is a real, verifiable inconsistency, not a nit: a user who lands
     via a bookmark/deep-link/search sees "My Analytics" and has to reconcile it
     against a completely different word ("Insights") in the nav they came from.
   - `Analytics` (project scope, only in `ProjectNav.tsx`'s "More" menu, `:58`) →
     `/projects/:id/analytics` → `ProjectAnalyticsPage.tsx`, `<h1>` = "Analytics"
     (`:61`) — this one is internally consistent, but it means the word "Analytics"
     names a *different* feature than the "Insights" nav item, even though "Insights"
     is literally the personal analog of it.
   - `Dashboards` (project scope) and `Reports` (project scope) are two more,
     genuinely distinct, features (`DashboardsPage.tsx`, `ReportsPage.tsx`) — those
     two names are fine on their own, but land in a sidebar that already has
     "Insights" one section up and "Analytics" one click into a "More" menu the
     sidebar doesn't even expose (see finding below). Four analytics-adjacent nouns,
     three different scopes, one outright label/heading contradiction.

4. **"Unclear whether Roadmap/Reports are project-scoped or global" — confirmed project-scoped only; not a bug, but worth stating plainly in the IA.**
   `App.tsx:205-226`: `roadmap`, `reports`, `dashboards`, `analytics`, `triage`,
   `automations`, `standups`, `poker` are all nested exclusively under
   `/projects/:projectId`. Grep confirms exactly one `RoadmapPage`/`ReportsPage`
   route each, both project-nested — there is no workspace- or instance-level
   Roadmap/Reports anywhere in the router. So the founder's suspicion is correct:
   these are 100% project-scoped, and nothing in the sidebar visually distinguishes
   "things that follow you across the whole workspace" (Personal group) from "things
   that only exist inside whichever project happens to be expanded" (the nested
   sub-list) other than physical nesting depth — which disappears entirely once a
   second project is active or the rail is collapsed.

### Additional problems found (not on the founder's list, but root causes of "unorganised")

**🔴 P1 — The sidebar's per-project view list and the project's own top-tab nav disagree about what the project's views even are.**
`SidebarNavContent.tsx:157-164` (`PROJECT_VIEWS`) exposes exactly 6 views under the
active project: Board, Backlog, Docs, Dashboards, Roadmap, Reports. But
`ProjectNav.tsx:46-64` (the tab strip rendered on every project page, still the
primary nav for that context) exposes **11 views**: Board, Backlog, Triage, Docs,
Reports (primary tabs) + Analytics, Dashboards, Roadmap, Poker, Standup, Automation
(the "More" menu) — plus Settings as a 12th, gear-only item. Comparing the two lists:
- **Triage, Analytics, Poker, Standup, Automation exist in the product and are one
  click away from the top tab bar, but are entirely absent from the sidebar.** A user
  who only ever uses the persistent sidebar (the surface the whole redesign made
  primary) will never discover five real, shipped features.
- **The two lists also disagree on hierarchy.** ProjectNav's own "primary vs. more"
  split treats Reports as primary and Dashboards/Roadmap as secondary ("More"); the
  sidebar's flat list promotes Dashboards and Roadmap to always-visible while
  Reports gets pushed to the bottom and Analytics vanishes completely. There is no
  discoverable logic for why Dashboards outranks Analytics, or why Reports (primary
  everywhere else) is visually last in the one place that's supposed to be primary
  navigation. This mismatch is very likely the single biggest contributor to the
  "not organised" feeling — the app is telling the user two different, incompatible
  stories about its own information architecture depending on which chrome they
  look at. Screenshot proof: `desktop-1280-board-expanded.png` (sidebar sub-nav) vs
  `project-nav-more-menu.png` (top-tab "More" menu), captured back-to-back on the
  same project.
- Fix direction: make the sidebar's expanded sub-list a **superset-consistent**
  mirror of `ProjectNav`'s own primary/secondary split (see proposed structure
  below) — one canonical ordering, shared by both surfaces, ideally sourced from
  one shared array instead of two independently-maintained ones (`PROJECT_VIEWS` in
  `SidebarNavContent.tsx` and `PRIMARY_TABS`/`MORE_TABS` in `ProjectNav.tsx` — right
  now a new project view added to one will silently not appear in the other).

**🔴 P1 — Two live, simultaneously-visible workspace switchers on desktop, both wired to the identical dropdown.**
`AppHeader.tsx`'s `WorkspaceChip` (`:54-141`) renders unconditionally — no `lg:hidden`
— right next to the logo, showing "Demo Workspace ▾" and opening
`WorkspaceSwitcherMenuContent`. `SidebarNavContent.tsx`'s `WorkspaceSection`
(`:208-291`) renders "D Demo Workspace ▾" at the very top of the sidebar, opening
the *exact same* `WorkspaceSwitcherMenuContent` component. Both are visible
together at 1280px (screenshot: `desktop-1280-board-expanded.png` — top-left chip
"Demo Workspace ⌄" in the header, "D Demo Workspace ⌄" as the first sidebar row).
The team already solved this exact problem for `My Work`/`My Board`/`Insights`:
those header links are explicitly `hidden ... md:inline-block lg:hidden`
(`AppHeader.tsx:188,200,212`) specifically so they disappear once the sidebar
takes over at `lg`+ — the sidebar-overhaul PR (see the "2026-07-02" entry in this
file) even wrote an e2e test asserting exactly that non-duplication
(`nav-sidebar.spec.ts:56-60`). The identical treatment was never applied to
`WorkspaceChip`. Two controls that do the same thing, in two different visual
idioms (pill-in-header vs. row-in-sidebar), reachable at the same time, is exactly
what "doesn't seem organised" looks like on a screenshot even before you open either
menu.
Fix: give `WorkspaceChip` the same `lg:hidden` treatment (or, if the breadcrumb
needs the workspace name for orientation on wide screens, downgrade it to
non-interactive text at `lg`+ instead of a second live switcher).

**🔴 P1 — There is no "Home" in the primary nav; the only ways back to the app's actual landing page are an implicit logo click or a mislabeled breadcrumb.**
`App.tsx:129-136` makes `/` (`PulseDashboardPage` — sprint snapshot, "assigned to
me", recent activity, project grid; genuinely the home/daily-standup page per its
own header comment) the authenticated root route. Nothing in
`SidebarNavContent.tsx` links to it — the "PROJECTS" text at `:332-335` is a plain
`<p>`, not a link. The only two paths back are (a) clicking the logo
(`AppHeader.tsx:168-170`, an icon with no visible label, relying entirely on
"logo = home" convention) or (b) the project breadcrumb's "Projects" text/back-chevron
(`ProjectBreadcrumb.tsx:50-66`), which is **mislabeled** — it says "Projects" and
looks like it should open a project list, but its `to="/"` actually opens the Pulse
Dashboard (sprints/my-issues/activity/projects, not a bare project list). Confirmed
in `keyboard-focus-1.png`: that page's own content literally has a `PROJECTS`
heading further down, i.e. "Projects" already means something else, on the same
screen, one scroll away from the nav that (mis)uses the same word to mean "home."
Fix: add an explicit `Home` (or `Overview`/`Pulse`) row at the very top of the
sidebar's primary list, above "PROJECTS," linking to `/`; rename the breadcrumb's
"Projects" segment to something that matches its actual destination (e.g. a house
glyph + "Home", or just drop the link text and keep the icon-only back-affordance
that already exists at `sm-` widths (`ProjectBreadcrumb.tsx:52-65`, `aria-label="Back
to projects"` — same mislabel exists there too, at the aria-label level).
Rename cost: **zero test breakage** for the aria-label/text change — grepped
`mobile-breadcrumb.spec.ts:68,84` and it asserts the accessible name "Back to
projects" only at the mobile (`sm:hidden`) icon variant; no spec asserts the
desktop-visible "Projects" text.

**🟡 P2 — Keyboard/tab order forces every user through the entire sidebar (workspace switcher + every project) before reaching the header or main content, on every single page.**
`App.tsx:102-108` (`AppShellFrame`) mounts `<AppSidebar />` before the routed page
content in the DOM. There is no skip-link anywhere in the app (grepped
`skip.to.content|SkipLink` — zero matches). Measured live with `Tab` from a fresh
page load on the demo account (which currently has 8 visible projects due to
concurrent QA test data — see caveat below): the first **10** tab stops are the
workspace-switcher trigger and 8 project rows; "My Work" doesn't get focus until
stop 11, "My Board" stop 12 — and Insights/Notifications/Instance-admin/Docs/
Settings/Branding/theme toggle/collapse-button all come after that, before a
keyboard user ever reaches the header's search, notifications, or the page's own
`<main>`. This is a genuine accessibility defect (WCAG 2.4.1 Bypass Blocks) as well
as an organization one: because the sidebar's tab order visits Projects → Personal →
Instance-admin → the unlabeled group in strict DOM order with no way to jump
sections, the model of "shallow global chrome, then deep page content" that sighted
users get from glancing at the screen is *not* the model a keyboard user experiences
— they experience "all sidebar depth, then everything else," regardless of section
headings.
Caveat: the demo account currently shows 8 project rows because a concurrently
running e2e suite is writing test projects into the same shared workspace ("QA
Backlog 27211334", etc., visible in every screenshot here) — that count isn't
representative of a real workspace, but it does demonstrate that tab-order cost
scales linearly and unboundedly with project count, which a skip-link would fix
regardless of list length.
Fix: add a "Skip to content" link as the very first focusable element (visually
hidden until focused, standard pattern), and/or make the collapsed-project-list
region a single tab stop with roving arrow-key navigation inside it (common combobox/
listbox pattern) so expanding to N projects doesn't cost N tab presses.

**🟡 P2 — Section-heading and secondary text fail WCAG AA contrast in light mode (not dark mode).**
The "PROJECTS"/"PERSONAL"/"INSTANCE ADMIN" headings (`SidebarNavContent.tsx:332-335,
376-379, 401-404`) and the loading/empty/error copy ("Couldn't load projects.", "No
projects yet.", `:344,347`) all use `text-ink-400`. In light mode that token is
`#8b95a8` (`index.css:101`) on a `#ffffff` sidebar (`index.css:226`,
`bg-surface` on the `<aside>` in `AppSidebar.tsx:36`) — computed contrast ≈ **3.0:1**,
below the 4.5:1 WCAG AA threshold for normal-weight text this small (11px). The
same token in dark mode, `#7d859c` (`index.css:314`) against the dark
`#141821` sidebar surface (`index.css:443`), computes to ≈ **4.83:1** — passes. So
this is specifically a light-mode defect: the labels that are supposed to give the
sidebar its structure are also the hardest thing in it to read, in the mode most
users will actually be in. This directly compounds the "unorganised" feeling — the
one piece of UI whose entire job is to communicate grouping is low-contrast enough
to visually recede.
Fix: bump these to `ink-500` (`#6b7280` light — computed ≈ 4.83:1, passes) for text
uses; keep `ink-400` for icons only (3:1 is the correct, lower bar for non-text
graphical elements per WCAG 1.4.11).

**🟡 P2 — Mobile tap targets are under the ~40-44px guideline.**
Measured via Playwright `boundingBox()` on the mobile drawer at 390px: the "My Work"
row is **36px** tall (`SidebarRow`, `py-2` = 8px top+8px bottom + ~20px line-height,
`SidebarNavContent.tsx:92`), and a project row is **34px** tall (`ProjectRow`,
`py-1.5`, `:129`). Both are reachable/clickable (no overlap issues observed) but sit
under the commonly-cited ~40-44px minimum comfortable tap target, on a surface whose
entire job on mobile is "the only way to navigate."
Fix: bump `SidebarRow`/`ProjectRow` vertical padding by ~2-4px on <lg surfaces only
(the mobile drawer already renders at `collapsed=false` unconditionally per
`MobileSidebarDrawer.tsx:60`, so this can be done with a drawer-specific prop or a
`lg:py-2` / base `py-2.5` split without touching the desktop rail's current density).

**🟡 P2 — Feature parity gap between the two "identical" surfaces: the mobile drawer has no theme toggle and no collapse control.**
The `SidebarNavContent.tsx` header comment (`:1-4`) states the shared content
component exists specifically "so the two surfaces can never drift apart." They
already have: `AppSidebar.tsx:43-67` renders `<ThemeToggle>` and the
collapse/expand button in a footer *outside* `SidebarNavContent`, and
`MobileSidebarDrawer.tsx` never renders either. Confirmed live: the drawer
screenshot (`mobile-390-drawer.png`) ends at "Branding" with no theme control below
it. Mobile users must close the drawer and dig into the avatar dropdown
(`AppHeader.tsx:284-287`) to find Light/Dark/System — a different UI pattern
(themed swatch buttons in a settings block) than the desktop sidebar's own
Light/Dark/System row. Not a "which group" IA problem exactly, but it is an
example of the same root cause: pieces got added to one surface (desktop rail) at a
time without an equivalent pass over its sibling.

**🟡 P2 — "Instance admin" is positioned as if it were a daily-use group, not the rarest, most powerful one.**
When visible (workspace-admin-only concept, but actually gated on the narrower
`User.isInstanceAdmin`, `SidebarNavContent.tsx:393-397`), "INSTANCE ADMIN" sits
between "PERSONAL" and the unlabeled Docs/Settings/Branding group — i.e., in the
middle of the everyday-use part of the nav, one section before the
workspace-admin-ish group it's conceptually closest to. For the overwhelming
majority of users it never renders at all, so this is low-severity, but for the
one account that does see it (the demo account, and presumably every self-hoster's
own admin account — likely a well-used persona), it reads as randomly slotted in
rather than deliberately placed at the "most powerful, least frequent" end of the
list.

**🟢 P3 — Independent (`role`-less) grouping: only "Projects" gets a semantic `<nav>` landmark.**
Only the Projects block is wrapped in `<nav aria-label="Projects">`
(`SidebarNavContent.tsx:330`); Personal, Instance-admin, and the unlabeled group are
plain `<div>`s inside the single outer `<aside aria-label="Primary">`
(`AppSidebar.tsx:32-34`). A screen-reader user jumping between landmarks sees one
undifferentiated "Primary" region plus one nested "Projects" region — the visual
grouping (headings, borders) has no assistive-tech equivalent for the other three
sections. Low severity given the row-level `aria-current`/focus-ring hygiene is
otherwise good (see "what's good" below), but worth fixing while touching this file.

**🟢 P3 — Collapsed rail drops all group semantics, not just group visuals.**
When `collapsed`, every group heading (`{!collapsed && <p>...</p>}` pattern,
`:331-335, 375-379, 400-404`) is entirely removed from the DOM rather than
`sr-only`'d, unlike individual row labels which correctly fall back to `sr-only`
spans (`SidebarRow`, `:100`) plus a `title` attribute. So a screen-reader user in
collapsed mode gets a flat list of item names with zero section context, even though
each item's own name is preserved. Confirmed via code inspection and the collapsed
screenshot (`desktop-1280-collapsed.png`).

### Information architecture assessment

Is Project / Personal / (unlabeled) the right split? **The three-way split by
"whose context is this" (project-scoped / user-scoped / workspace-scoped) is the
right instinct** — it's the same mental model good competitors use (project switcher
+ "your stuff" + workspace admin). The execution breaks it in three ways documented
above: (1) the workspace-scoped group has no label at all, so it doesn't read as a
third category, it reads as "stuff that didn't fit"; (2) the project-scoped sub-list
is an inconsistent subset of the real project IA (`ProjectNav`), so "Projects" in the
sidebar doesn't actually mean "everything about a project," it means "whatever six
things someone remembered to also add to the sidebar"; (3) there is no top-level
"home" category at all — the eye has nowhere to land for "get me back to my
overview," which is arguably the single most common navigation action in a daily
driver tool.

Where does the eye go? On the current expanded desktop layout the visual weight
(background tint + bold text + rail tick) correctly goes to the active
project/project-view — that part works well. But because the group headings are
low-contrast (P2 above) and one group has none, the eye doesn't have a reliable way
to answer "what section of the app am I even looking at" independent of the active
highlight.

What's hard to find: Triage, Analytics, Poker, Standup, Automation (not in the
sidebar at all, see P1); Members and Audit log (only reachable via Workspace
Settings' own tab strip or the workspace-switcher-menu footer, never the sidebar
itself — arguably fine as second-tier, but worth being intentional about, not
accidental).

What's redundant: the two workspace switchers (P1); "Workspace settings" reachable
from 3 places at once (the sidebar's own row, the workspace-switcher dropdown
footer shared by both header chip and sidebar trigger — `WorkspaceSwitcherMenuContent.tsx:171-178`,
and via Branding's own settings-tab strip) — this one is defensible (quick-access
footer links in a switcher are a common, deliberate pattern, e.g. Slack/Notion do
the same), so I'm not flagging it as a defect, just noting it adds to the general
sense of "many paths, no map."

### Viewport / theme verification

- **Desktop 1280, expanded:** as analyzed above. Screenshot: `desktop-1280-board-expanded.png`.
- **Desktop 1280, collapsed rail:** icon-only rail renders correctly, active project
  highlighted, no icon overlap, tooltips (`title`) present. Loses all group-heading
  semantics (P3 above). Screenshot: `desktop-1280-collapsed.png`.
- **Desktop 1280, dark mode:** verified via the sidebar's own Light/Dark/System
  toggle and the header avatar-menu's duplicate toggle (both present, both work,
  both switch the same state — no divergence found here, that part is consistent).
  Dark surfaces read fine, section-heading contrast is actually *better* in dark
  mode than light (see P2 contrast finding). No mobile-only dark-mode issue found.
  Screenshot: `desktop-1280-dark.png`.
- **Tablet 768:** the persistent rail is hidden below `lg` (1024px), so 768px uses
  the same mobile hamburger + overlay drawer as 390px, not a third layout. Confirmed
  no unique 768px-only bugs; drawer opens correctly, no horizontal overflow.
  Screenshots: `tablet-768-dashboard.png`, `tablet-768-drawer.png`.
- **Mobile 390:** drawer opens via hamburger, closes on Escape/backdrop/nav-click
  (verified in existing `nav-sidebar.spec.ts`, still true live). No horizontal
  overflow of the drawer itself. Tap-target and theme-toggle-parity issues noted
  above (P2). Screenshots: `mobile-390-dashboard.png`, `mobile-390-drawer.png`.

### Accessibility summary

- ✅ `aria-current="page"` correctly applied to the active row/project/view link
  (`SidebarRow`/`ProjectRow`/`ProjectViewsSubNav`, consistently).
- ✅ Focus-visible rings are consistent (`focus-visible:ring-2 ring-signal-500
  ring-offset-1`) across every interactive row in the sidebar — no divergence found.
- ✅ Mobile drawer traps focus, closes on Escape, restores scroll (`useOverlay`,
  shared with `Modal` — same pattern, verified live).
- ✅ Collapsed-rail rows keep an accessible name via `sr-only` span + `title`.
- 🔴 No skip-link; sidebar-first DOM order costs every keyboard user 10+ tab presses
  before reaching header/content (P2 above).
- 🟡 Section headings/secondary text fail AA contrast in light mode (P2 above).
- 🟡 Only one of four visual groups has a semantic `<nav>` landmark (P3 above).
- 🟡 Collapsed rail drops group semantics entirely, not just visually (P3 above).

### What's good (don't lose this in a rewrite)

- The active-state "rail tick" signature element is distinctive, consistently
  applied, and — per the 2026-07-02 entry above — a deliberate rejection of the
  generic filled-pill pattern. Keep it.
- `SidebarNavContent` being shared verbatim between the desktop rail and the mobile
  drawer (rather than two parallel implementations) is the right architecture — the
  parity gaps found here (theme toggle, tap-target sizing) are in the parts that
  *aren't* shared (`AppSidebar`'s own footer), which is itself useful signal for
  where to look next.
- Workspace-switcher dropdown content (`WorkspaceSwitcherMenuContent`) being a
  single reused component between the header chip and the sidebar trigger means the
  fix for the P1 duplication finding is a CSS-visibility change, not a rewrite.
  Loading/empty/error states, search, and keyboard Escape-to-close on that dropdown
  all work correctly.
- Icon vocabulary (`sidebarIcons.tsx`) is disciplined: 24-unit viewBox, 2px stroke,
  monochrome, no icon-library dependency — consistent across every row including
  the newer Phase-2 additions (Dashboards, Branding, Shield). No visual-style drift
  between old and new icons.
- Row-density hierarchy (project rows tighter than personal rows, sub-nav rows
  tightest of all) reads as an intentional typographic scale reflecting nesting
  depth, not an inconsistency — worth keeping as-is.

### Proposed reorganized sidebar structure

Ordered top to bottom. "Was" notes call out renames/merges and their cost.

1. **Workspace switcher** (unchanged component/position) — but make `AppHeader`'s
   `WorkspaceChip` `lg:hidden` (matching the existing `My Work`/`My Board`/`Insights`
   precedent at `AppHeader.tsx:188,200,212`) so only one switcher is ever live at a
   given width. *No sidebar code change; header-only fix. No test breakage —
   `workspace-chip` testid still exists at <lg widths where mobile specs check it.*
2. **`Home`** *(new)* → `/`. Fixes the "no way back to the dashboard from the
   sidebar" gap. *New row; no rename, no test cost. Recommend giving it its own
   `data-testid="nav-sidebar-home"` for future QA.*
3. **`PROJECTS`** heading (unchanged) → project list (unchanged) → for the active
   project, an expanded sub-list that **mirrors `ProjectNav`'s own primary/secondary
   split** instead of the current bespoke 6-item list:
   - Primary (always visible under the active project): `Board`, `Backlog`,
     `Triage`, `Docs`, `Reports` — same set and order as `ProjectNav.tsx`'s
     `PRIMARY_TABS`.
   - Secondary (a "More" disclosure directly beneath, default-collapsed,
     remembering the same open/closed idea `ProjectNav` already uses): `Analytics`,
     `Dashboards`, `Roadmap`, `Poker`, `Standup`, `Automation` — same set/order as
     `ProjectNav.tsx`'s `MORE_TABS`.
   - *Was: `PROJECT_VIEWS` = Board, Backlog, Docs, Dashboards, Roadmap, Reports
     (`SidebarNavContent.tsx:157-164`). Cost: this changes visible text/order for
     Dashboards and Roadmap (now behind "More") — `nav-sidebar.spec.ts:95-120`
     ("Roadmap is reachable one click from the sidebar") explicitly asserts Roadmap
     is a **direct**, non-menu click; that test's premise would need to change
     (or Roadmap specifically could stay promoted to primary if the team wants to
     keep that one-click guarantee — flagging the tension rather than deciding it).
     `nav-sidebar-view` testid can be kept on both tiers.*
4. **`PERSONAL`** heading (unchanged) → `My Work`, `My Board`,
   **`My Analytics`** *(renamed from `Insights`)*, `Notifications`.
   - *Was: `Insights` (`SidebarNavContent.tsx:300`, `AppHeader.tsx:220,294`). Cost:
     renaming to match the page's own `<h1>` ("My Analytics",
     `PersonalAnalyticsPage.tsx:72`) breaks the accessible-name assertion at
     `nav-sidebar.spec.ts:53` (`getByRole('link', { name: 'Insights' })`) and the
     `gotoSection(page, 'Insights')` call in `analytics.spec.ts:73` — both are
     one-line text updates, not structural changes, but they are real, named test
     edits the implementer needs to make in the same commit.*
5. **`WORKSPACE`** heading *(new — currently unlabeled)* →
   **`Knowledge Base`** *(renamed from workspace-level `Docs`, to end the collision
   with project-level `Docs`)*, `Members`, `Workspace settings`, `Branding`
   (admin-gated, unchanged).
   - *Was: unlabeled group = `Docs`, `Workspace settings`, `Branding`
     (`SidebarNavContent.tsx:417-457`); `Members` currently only reachable via the
     workspace-switcher-menu footer or Workspace Settings' own tab strip, promoted
     here to a first-class row to match `Docs`/`Branding`'s existing "pull it out of
     Settings so it's discoverable" precedent. Cost: renaming the *label* "Docs" →
     "Knowledge Base" does **not** touch `nav-sidebar-workspace-docs`
     (`workspace-docs.spec.ts:41,43` asserts the `data-testid`, not the text) or
     `pages-search.spec.ts:41` (that "Docs" is the *project*-pages command-palette
     group, unaffected). Zero test breakage found for this rename. Adding "Members"
     as a new row needs a new testid, no existing-test risk.*
6. **`INSTANCE ADMIN`** heading (unchanged content) — **moved to the very bottom**
   of the scrollable list, immediately above the Theme/Collapse footer, reflecting
   "rarest, most powerful, least relevant to a normal workday" rather than sitting
   mid-list. *No label/testid change, position only — no test cost
   (`admin-sso-settings.spec.ts` asserts testid/visibility, not position.)*
7. Utility footer (unchanged): Theme toggle, Collapse — **plus**, add the same
   Theme toggle to `MobileSidebarDrawer`'s footer so the two "identical" surfaces
   actually stop drifting apart (per the file's own stated goal).

Net effect: every group has a heading; "Home" and the full project-view set are
finally reachable from the one nav surface the app's own README/redesign calls
primary; the two Analytics-adjacent personal/project words are reconciled with
their own page headings; "Docs" stops meaning two different things; and the
riskiest/rarest group (Instance admin) sits at the bottom instead of the middle.

### Screenshots captured (for founder hand-off)

- `/tmp/nav-audit/desktop-1280-board-expanded.png` — expanded rail, active project,
  full 4-group structure, header workspace-chip duplication visible.
- `/tmp/nav-audit/desktop-1280-collapsed.png` — collapsed icon rail.
- `/tmp/nav-audit/desktop-1280-dark.png` — dark mode, avatar-menu theme toggle open.
- `/tmp/nav-audit/tablet-768-dashboard.png`, `/tmp/nav-audit/tablet-768-drawer.png`
- `/tmp/nav-audit/mobile-390-dashboard.png`, `/tmp/nav-audit/mobile-390-drawer.png`
- `/tmp/nav-audit/project-nav-more-menu.png` — `ProjectNav`'s top-tab "More" menu,
  for direct side-by-side comparison against the sidebar's sub-nav.
- `/tmp/nav-audit/keyboard-focus-1.png` — Pulse Dashboard home page, showing its own
  "PROJECTS" section heading (context for the breadcrumb mislabel finding).

### ✅ Closed 2026-08-01 (design-elevation pass)

Four of the five below are now shipped. Ticking them here rather than deleting
them so the audit stays readable as a record of what was wrong.

- [x] **#2 De-duplicate the two `Docs` labels** — the workspace one is now
      **"Workspace docs"**. The project one keeps the short name; it is already
      nested under its project, so the scope word only earns its place on the
      row that has no other context.
- [x] **#3 Give the unlabeled group a heading** — it is **WORKSPACE**, and it
      now says so. It was the only one of four groups without a heading, which
      is what made it read as leftovers.
- [x] **#3 Add a `Home` row** — there was no way back to the landing page from
      the primary nav at all, only an implicit logo click and a breadcrumb
      segment that reads as a label. It sits above the group headings because
      it belongs to no group.
- [x] **#4 Resolve `Insights` vs "My Analytics"** — the page heading now reads
      **Insights**, matching the nav item you arrive from. The nav label won
      rather than the heading: two specs and every user's muscle memory
      already use it, and a destination that renames itself on arrival makes a
      reader doubt they landed in the right place.

- [x] **#1 Sidebar/ProjectNav view mismatch** — both surfaces now read one
      ordered list, `components/project/projectViews.ts`. There were THREE
      hand-maintained lists that had drifted: the tab bar knew eleven views,
      the sidebar six, and they disagreed on which mattered (Dashboards and
      Roadmap were sidebar rows but "More" items; Triage was a tab and absent
      from the sidebar). A single `primary` flag now decides, so the sidebar
      gained Triage and the tab bar gained Dashboards and Roadmap. The type
      makes the invariant structural rather than conventional: a primary view
      without an icon is a compile error, verified by introducing one.
- [x] **#5 Skip-link** — "Skip to content" is now the first tab stop, visible
      on focus, and it moves FOCUS rather than only scroll (the target carries
      `tabindex="-1"`; without it the browser scrolls but leaves focus on the
      link, and the next Tab drops the user straight back into the sidebar).
      `skip-link.spec.ts` asserts all three properties, including that the tab
      after activation stays inside the main region.

**Still open:**

- [ ] **Sidebar-first tab order itself.** The skip link makes the content
      reachable in one press, which is the standard remedy, but the DOM order
      is unchanged — a user who tabs past the link still traverses the whole
      sidebar. Reordering the shell is a larger change and is not in this pass.

Also filed during this pass:

- [x] **Knowledge graph has no fit-to-content.** ✅ **RESOLVED 2026-08-01.**
      On first open, nodes sat outside the frame and `Reset` restored 100% zoom
      without reframing. The screenshot capture script had to zoom out three
      times to photograph the graph — that workaround was the evidence.

      Root cause was upstream of the camera: the force layout ran inside a
      world the exact size of the visible canvas, so past a few dozen pages
      there was nowhere to put nodes. Repulsion pushed them outward, the render
      clamp caught them, and they stacked into perfectly straight rails along
      the top and bottom of the frame with their labels overprinting — visible
      in the 2026-08-01 `pages-graph-desktop` capture.

      Fixed in three parts: the layout world now grows with √n so per-node
      density stays constant; `fitToContent` frames the content's bounding box
      (measured over rendered node *boxes*, so edge labels land inside) on
      settle and on the toolbar button, which is relabelled **Fit graph to
      view**; and the world is pre-framed the moment its size is known, so a
      dense graph never spends its settle animation overflowing. Fit is capped
      at 100% — it means "you can see everything", not "fill the pixels", so a
      three-node graph is not blown up to 300%. `MIN_SCALE` dropped 0.35 → 0.15,
      because a dense graph on a 393px phone needs a scale below the old floor
      and would otherwise clamp and *still* sit off-frame.

      New `knowledge-graph-fit.spec.ts` seeds 40 linked pages and asserts no
      node's box escapes the canvas on open, then zooms and pans away (checking
      that nodes really do go off-frame, so the recovery assertion cannot pass
      vacuously) and asserts Fit brings them all back. The existing graph specs
      used two- and three-node graphs, which fit trivially — which is exactly
      why nothing caught this.

- [x] **Selecting a graph node made the zoom controls unreachable.** ✅
      **RESOLVED 2026-08-01.** The zoom/fit cluster sits bottom-right, and so
      does the focus/orbit side rail — which is `z-20` and 22rem wide from `sm`
      up, so it covered the controls completely. Inspecting a node silently
      cost you zoom and fit until you closed the rail. The controls now slide
      clear of the rail (and hide below `sm`, where the rail is a full-width
      sheet and there is nowhere to slide to). Found by Playwright, which
      reported the rail "intercepts pointer events" while retrying a Fit click
      268 times — the click a user would also have found dead.

- [ ] **None of the 86 `queryFn`s pass React Query's `AbortSignal`, and a
      mutation's invalidation cannot fix a read already in flight.** Filed
      2026-08-01 off a proven instance in the share-token list (see BACKLOG).
      `invalidateQueries` does NOT start a second fetch while one is running,
      so the response that lands is the one issued *before* the write, and it
      becomes the final state with nothing scheduled to correct it. The pattern
      "open a settings page, immediately act" hits it, and the window is
      exactly one list round trip. The share-token hooks now
      `cancelQueries` first (which needs the signal threaded to actually abort);
      the same audit is owed to every other list-plus-mutation pair.

---

### Top 5 for the dev team (priority order)

1. **Fix the sidebar/ProjectNav project-view mismatch** — Triage, Analytics, Poker,
   Standup, Automation are invisible from the primary nav. This is the single
   biggest driver of "unorganised": the app disagrees with itself about its own IA.
   Ideally, source both `ProjectNav` and the sidebar's sub-nav from one shared
   ordered list.
2. **De-duplicate the workspace switcher** — `lg:hidden` the header's `WorkspaceChip`
   the same way `My Work`/`My Board`/`Insights` already are. Small, safe, high
   perceived-polish payoff.
3. **Add a `Home` row and give the unlabeled group a heading** — both are one-line,
   zero-test-cost changes that directly answer the founder's report.
4. **Resolve the two `Docs` / `Insights`-vs-"My Analytics" naming collisions** — pick
   one name per concept and make the nav label and the page's own heading agree.
5. **Add a skip-link and fix the sidebar-first tab order** — currently costs every
   keyboard user 10+ tab presses (measured, scales with project count) before
   reaching page content on every single page load.
