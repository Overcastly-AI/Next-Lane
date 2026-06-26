---
name: playwright-qa
description: Run QA and user-acceptance testing for Next Lane with Playwright across desktop AND mobile viewports. Use when verifying a feature works in the real UI, writing/extending end-to-end tests, doing acceptance testing before merge, or reproducing a UI bug. Owned primarily by the QA agent.
---

# Playwright QA & User-Acceptance Testing

This skill drives the real Next Lane web app in a browser to verify behavior — the last line of defense before a feature is called "done". Always test on **both desktop and mobile**.

## Environment

Chromium is pre-installed in CI/dev sandboxes:
- `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`, `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`.
- Do **not** run `playwright install`. If a pinned `@playwright/test` needs a browser, launch with `executablePath: '/opt/pw-browsers/chromium'`.

The Playwright config lives at `apps/web/playwright.config.ts` and defines projects:
- `chromium-desktop` (1280×800)
- `mobile-chrome` (Pixel 5 viewport)
- `mobile-safari` (iPhone 13 viewport, WebKit if available)

Tests live in `apps/web/e2e/`.

## Preconditions (the app must be running)

```bash
# 1) datastores + API
docker compose up -d db redis        # or a local Postgres/Redis
pnpm --filter @next-lane/api build && pnpm db:migrate && pnpm db:seed
node apps/api/dist/main.js &          # API on :4000

# 2) web (built + previewed, or dev server)
pnpm --filter @next-lane/web build
pnpm --filter @next-lane/web preview -- --port 3000 &
# Playwright baseURL = http://localhost:3000, API at http://localhost:4000
```

The seeded login is `demo@nextlane.dev` / `nextlane`.

## Running

```bash
pnpm --filter @next-lane/web test:e2e                 # all projects (desktop + mobile)
pnpm --filter @next-lane/web test:e2e --project=mobile-chrome
pnpm --filter @next-lane/web test:e2e --headed         # watch it
pnpm --filter @next-lane/web exec playwright show-report
```

## What to cover (acceptance flows)

Treat each as a user story; assert on visible outcomes, not implementation:

1. **Auth** — register a new user; log in as demo; bad password shows an error; logout returns to login.
2. **Dashboard** — workspace is present/created; create a project (key + name); it appears and opens.
3. **Board** — columns render from statuses; seeded issues appear in the right columns; card shows key, title, assignee, priority.
4. **Create issue** — create via the column/top button; it appears in the target column immediately.
5. **Drag & drop** — move a card to another column; it stays after reload (rank persisted). On mobile, verify the drag works via touch or that an equivalent move affordance exists.
6. **Issue detail** — open a card; edit title/status/assignee/priority and see it persist; add a comment; activity log updates.
7. **Search/filter** — filtering by text/assignee narrows the visible cards.
8. **Realtime (optional)** — a change in one context appears in another without manual refresh.

## Mobile-specific checks

- Layout is usable at 390×844 (no horizontal overflow, columns scroll, modals fit).
- Tap targets are reachable; the issue drawer is full-width and dismissible.
- Drag-and-drop: dnd-kit supports pointer/touch sensors — verify a touch drag reorders, or document the mobile move path.

## Writing tests — conventions

- One spec per area (`auth.spec.ts`, `board.spec.ts`, `issue-detail.spec.ts`).
- Use a shared `login()` helper and Playwright **storageState** to skip re-login.
- Prefer role/label/text locators (`getByRole`, `getByLabel`, `getByText`) over CSS.
- Use web-first assertions (`await expect(locator).toBeVisible()`) — they auto-wait. Never use fixed `sleep`.
- Keep tests independent and idempotent; create the data they need, don't depend on order.
- On failure, capture a screenshot/trace (config enables `trace: 'on-first-retry'`).

## Reporting (for the QA agent)

Return a verdict per acceptance flow: ✅ pass / ❌ fail (with the failing assertion + screenshot path) / ⚠️ blocked. Test **both** a desktop and a mobile project before declaring a feature accepted. Never claim a flow passes without having run it — evidence before assertions (see the `verification-before-completion` skill).
