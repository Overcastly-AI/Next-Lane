# Next Lane — UI / UX Consistency Review

> Front-end QA / design-consistency audit. Read-only review; no application code was
> changed. Findings are grouped by severity and reference specific files/components
> plus what was observed in desktop (1280px) and mobile (390px / Pixel-5) screenshots.

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

**P3 — No CTA action in the MyWork per-section `EmptyState` to guide the user.**
Each `Section` in `MyWorkPage` passes `emptyTitle` and `emptyDescription` to `EmptyState` but no `action` prop. The `EmptyState` component supports an `action` slot (any `ReactNode`). For a new user, "Nothing assigned to you yet" with no next step is a dead end. A link to the board or to creating an issue would increase discoverability.
Suggested fix: pass `action={<Link to="/"><Button size="sm" variant="secondary">Go to board</Button></Link>}` (or similar) in the "Assigned to me" empty section.

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

### Additional items resolved in the 2026-06-27 polish pass

- **RESOLVED — ResetPasswordPage auto-redirect removed:** `setTimeout(() => navigate('/login'), 2000)` removed; success screen stays until user clicks "Go to sign in". e2e test updated.
- **RESOLVED — MyWorkPage full-empty state unified:** bespoke `<div>` replaced with `<EmptyState>` from `States.tsx` (consistent `border-gray-300 bg-white/50 py-14` tokens).
- **RESOLVED — autoFocus on first auth form input:** Added to Login (email), Register (name), ForgotPassword (email), and ResetPassword (new-password).
