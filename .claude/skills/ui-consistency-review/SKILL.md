---
name: ui-consistency-review
description: Audit the Next Lane web UI for visual consistency, design-system adherence, accessibility, responsive behavior, and missing component states; produce prioritized feedback for the dev team in docs/UI-REVIEW.md. Owned by the frontend-qa agent. Use for design/UX QA passes (not functional testing).
---

# UI consistency & design-QA review

A structured pass over the Next Lane front-end to catch inconsistencies and propose improvements, then hand actionable feedback to the dev team.

## Setup
Bring the app up (see `run-stack` / `playwright-qa`): API on :4000, web preview on :3000, seeded demo login `demo@nextlane.dev` / `nextlane`. Capture screenshots at **desktop 1280px** and **mobile 390px** for: login, register, dashboard (incl. empty state), board, create-issue modal, issue detail drawer.

```bash
# example capture (Playwright); view the PNGs afterward
export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome
# script logs in and screenshots each screen at both viewports
```

## Checklist

**Design system**
- [ ] Spacing follows one scale; no arbitrary one-off values.
- [ ] Colors come from theme tokens (`brand-*`, `gray-*`), not scattered hex.
- [ ] Radii / shadows / borders are uniform across cards, inputs, modals.
- [ ] Typography: consistent heading sizes, weights, muted-text color.
- [ ] Shared primitives (`Button`, `Input`, `Select`, `Modal`, `Badge`, `Avatar`) are reused — no divergent re-implementations.

**States**
- [ ] Every query view has loading, empty, and error states.
- [ ] Buttons show disabled/loading; forms show validation errors.
- [ ] Focus-visible styles on all interactive elements.

**Accessibility**
- [ ] Real `<button>`/`<a>` semantics; inputs have `<label>`s.
- [ ] Modal/drawer: focus trap + Esc close + scroll lock.
- [ ] Adequate color contrast; icons/avatars have accessible names.
- [ ] Fully keyboard-operable (tab order, Enter/Space).

**Responsive / mobile (390px)**
- [ ] No horizontal overflow; columns/lists scroll.
- [ ] Modals/drawers fit and are dismissible.
- [ ] Tap targets ≥ ~40px; nothing clipped.

**Interaction consistency**
- [ ] Hover/active/selected styling uniform across similar elements.
- [ ] Errors/toasts surfaced the same way everywhere.

## Output → feedback to the dev team
Append a dated section to `docs/UI-REVIEW.md`:
- Findings grouped 🔴 inconsistency · 🟡 improvement · 🟢 nit, each with **file/component**, the problem, why it matters, and a concrete fix.
- Call out what's already good.
- A "Top 5 for the dev team" prioritized list the `frontend-builder` can pick up.

Do not edit application code — this skill only reviews and writes the report.
