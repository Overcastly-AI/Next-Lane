# Screenshots

> ⚠️ **Placeholder — no curated product screenshots have been captured yet.**
> The README references images in this folder; a maintainer needs to capture them
> from a running instance. (The PNGs under `apps/web/playwright-report/` are test
> artifacts, **not** suitable for the README.)

## What to capture

Run the app (`docker compose up -d --build`, log in as `demo@nextlane.dev` /
`nextlane`) and capture both **desktop** and **mobile** viewports for each:

| File | View |
|------|------|
| `board-desktop.png` / `board-mobile.png` | The Kanban board with the seeded demo issues |
| `issue-drawer-desktop.png` / `issue-drawer-mobile.png` | An issue detail drawer (description, comments, attachments) |
| `reports-desktop.png` / `reports-mobile.png` | The burndown / velocity / CFD reports |

## Then wire them in

Replace the placeholder block near the top of the root `README.md` (it's marked
with an HTML comment showing the intended `<img>` layout) with references to the
files above.

Keep images reasonably sized (web-optimized PNG) and **self-hosted in this repo** —
no external CDN links.
