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
