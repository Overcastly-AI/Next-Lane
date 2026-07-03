# Screenshots

Curated product screenshots captured from a **live Next Lane instance** (dressed demo
workspace "Nova Analytics", project `NOVA`, mid-flight Sprint 14). Desktop shots are
1440×900 CSS px @2x; mobile shots are 393×852 @2x. All PNGs are optimized with pngquant.

Last reshoot: **2026-07-03** (post-sidebar, dark mode, and design-elevation work).

## Index

| File | Surface |
|------|---------|
| `board-desktop.png` | Kanban/Scrum board hero — sidebar, sprint pill, WIP limits (4/4, 3/3), blocked badge, card color rules, labels, avatars (light) |
| `board-dark-desktop.png` | Same board in dark mode |
| `board-swimlanes-desktop.png` | Swimlanes — board grouped by issue type with per-lane counts |
| `nlql-autocomplete-desktop.png` | NLQL filter bar mid-autocomplete (`priority = HIGH` + keyword suggestions), board live-filtered |
| `backlog-desktop.png` | Backlog & sprint planning — active sprint with points and per-issue status |
| `dashboard-desktop.png` | Dashboards — all four gadget types (STAT, BREAKDOWN, BURNDOWN, TABLE) on real sprint data |
| `drawer-desktop.png` | Issue drawer — markdown description, checklist progress, start/due dates, watchers |
| `drawer-worklogs-desktop.png` | Issue drawer scrolled — checklist items, time tracking (6h30m of 16h), work log entries |
| `roadmap-desktop.png` | Roadmap / Gantt — epics with date-range bars and % complete, sprint bars, today line |
| `workflow-graph-desktop.png` | Named workflow graph builder — enforced Engineering Flow with transition graph |
| `agent-context-desktop.png` | Agent context panel (project settings) — persistent AI-agent handoff doc with staleness pill |
| `home-desktop.png` | Workspace home — active sprint progress, assigned-to-me, recent activity |
| `login-desktop.png` | Login screen |
| `board-mobile.png` | Board on mobile (393×852) |
| `home-mobile.png` | Workspace home on mobile |
| `login-mobile.png` | Login on mobile |
| `sidebar-mobile.png` | Mobile navigation drawer open |

## Consumers

- Root `README.md` references `home/board/backlog/drawer/login` desktop + `home/board/login` mobile.
- `docs-site/` uses **copies** under `docs-site/public/screenshots/` (`board-desktop.png`,
  `drawer-desktop.png`, `backlog-desktop.png` — including the landing-page hero). After a
  reshoot here, those copies must be refreshed too.

## Reshooting

Run the stack locally (see `docs/` or `CLAUDE.md`), stage presentable demo data, and
capture with Playwright at the viewports above (full viewport, network-idle, no
skeletons/spinners in frame). Keep images web-optimized and **self-hosted in this repo** —
no external CDN links.
