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
| `pages-graph-desktop.png` *(planned — not yet captured)* | Pages knowledge graph view — force-directed node/edge layout of a project's wiki (desktop) |
| `pages-graph-mobile.png` *(planned — not yet captured)* | Pages knowledge graph view on mobile (touch pan/pinch) |

## Consumers

- Root `README.md` — hero (`home-desktop`), a light/dark board pair
  (`board-desktop` + `board-dark-desktop`), a mobile trio (`board-mobile` +
  `sidebar-mobile` + `home-mobile`), `drawer-desktop` + `backlog-desktop`, and
  a collapsible "More screenshots" section covering `dashboard-desktop`,
  `roadmap-desktop`, `workflow-graph-desktop`, `agent-context-desktop`,
  `board-swimlanes-desktop`, `nlql-autocomplete-desktop`,
  `drawer-worklogs-desktop`, and `login-desktop`.
- `docs-site/` uses **copies of every file in this directory** under
  `docs-site/public/screenshots/` — the landing-page hero and og:image use
  `board-dark-desktop.png` (the site's default theme is dark); `index.md`,
  `guide/features.md`, and `guide/agents-mcp.md` each reference the shots
  relevant to what they document. After a reshoot here, re-copy the whole
  directory (`cp docs/screenshots/*.png docs-site/public/screenshots/`) and
  re-run `pnpm --filter @next-lane/docs docs:build` before pushing.
- `pages-graph-desktop.png` / `pages-graph-mobile.png` are placeholders for
  the Pages knowledge-graph view (`docs-site/guide/features.md` "Pages —
  project knowledge base" and the root README both have marked HTML-comment
  slots for them). Capture per the recipe below, drop the two files in this
  directory **and** `docs-site/public/screenshots/`, then swap the comments
  for real `![alt](...)` / `<img>` references in both places.

## Reshooting

Run the stack locally (see `docs/` or `CLAUDE.md`), stage presentable demo data, and
capture with Playwright at the viewports above (full viewport, network-idle, no
skeletons/spinners in frame). Keep images web-optimized and **self-hosted in this repo** —
no external CDN links.
