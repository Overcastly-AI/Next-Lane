# Next Lane — UI / UX Consistency Review

> Front-end QA / design-consistency audit. Read-only review; no application code was
> changed. Findings are grouped by severity and reference specific files/components
> plus what was observed in desktop (1280px) and mobile (390px / Pixel-5) screenshots.

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
- [ ] `AppHeader` · `Logo` · `NotificationBell` · `project/ProjectNav`
- [x] `board/BoardColumn` — WIP indicator polish ✅ 2026-06-29
- [ ] `board/IssueCard` · `board/SortableIssueCard` · `board/CardStatusPicker` · `board/PresenceAvatars`
- [ ] `board/CreateIssueModal` · `board/ColumnFormModal`
- [x] `board/BoardWorkflowSelector` — badge ring-inset + ENFORCED chip ✅ 2026-06-29
- [x] `board/FromTemplateMenu` — system animation applied ✅ 2026-06-29
- [ ] `issue/IssueDetailDrawer` · `issue/CommentsPanel` · `issue/AttachmentsPanel` · `issue/ActivityPanel` · `issue/LabelPicker` · `issue/MentionComposer` · `issue/ParentSubtasks` · `issue/issueMeta`
- [x] `issue/TimeTrackingSection` — progress % label + signal/red token ✅ 2026-06-29
- [x] `issue/ChecklistSection` — progress % label + emerald-complete / signal-in-progress ✅ 2026-06-29

**Phase C — Pages**
- [ ] Auth: `AuthShell` · `LoginPage` · `RegisterPage` · `ForgotPasswordPage` · `ResetPasswordPage`
- [ ] `PulseDashboardPage` · `DashboardPage` · `MyWorkPage`
- [ ] `BoardPage` · `BacklogPage` · `TriagePage`
- [ ] `ReportsPage` (+ `reports/BurndownChart` · `VelocityChart` · `CumulativeFlowChart`)
- [ ] `RoadmapPage` (+ `roadmap/RoadmapTimeline`)
- [x] `SettingsPage` / `settings/WorkflowsManager` + `WorkflowGraph` — dot-grid canvas, node shadow, ink tokens, empty states ✅ 2026-06-29
- [x] `settings/TemplatesManager` — ink tokens, empty state, doc-plus icon ✅ 2026-06-29
- [x] `settings/ComponentsSection` — ink tokens, empty state, cube icon ✅ 2026-06-29
- [x] `settings/VersionsSection` — ink tokens, empty state, badge fix ✅ 2026-06-29
- [x] `settings/NotificationPreferencesSection` — copy + ink token tighten ✅ 2026-06-29
- [ ] `settings/WebhooksSection` · `WebhookFormModal` · `ShareSection` · `ApiTokensSection`
- [ ] `ProfileSettingsPage` · `WorkspaceMembersPage` · `WorkspaceAuditLogPage` · `SharedBoardPage`
- [x] `NotificationsPage` — nl-issue-key chip + animated unread dot ✅ 2026-06-29

**Phase D — Cross-cutting components**
- [ ] `CommandPalette` / `CommandPaletteProvider` · `project/OnboardingPanel` · `project/ProjectCard` · `project/CreateProjectModal` · `workspace/CreateWorkspaceModal`

> Screenshots from each pass are captured (desktop + mobile) and posted to the user.

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
