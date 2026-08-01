# Screenshots

Curated product screenshots captured from a **live Next Lane instance** (dressed demo
workspace "Nova Analytics", project `NOVA`, mid-flight Sprint 14). Desktop shots are
1440×900 CSS px @2x; mobile shots are 393×852 @2x. All PNGs are optimized with pngquant.

Last reshoot: **2026-08-01** (post doc-images, doc-templates, and the draggable
docs nav). Reshooting is now **reproducible** — see "Reshooting" below; it used
to be a hand-staged afternoon, which is why these drifted in the first place.

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
| `pages-desktop.png` | Docs — page tree, rendered markdown, backlinks and links-out |
| `pages-image-desktop.png` | Docs — a page with an **embedded image**, resolved through an authorized fetch |
| `pages-graph-desktop.png` | Pages knowledge graph — force-directed node/edge layout of a project's wiki |
| `pages-graph-mobile.png` | Pages knowledge graph on mobile (touch pan/pinch) |
| `pages-mobile.png` | Docs on mobile |

### Reshot 2026-08-01 vs. carried over

**Reshot** (everything the capture script covers): `board-desktop`,
`board-dark-desktop`, `board-mobile`, `backlog-desktop`, `home-desktop`,
`home-mobile`, `login-desktop`, `login-mobile`, `sidebar-mobile`, and all five
`pages-*` shots (four of them brand new — the two `pages-graph-*` had been
marked "planned" since the knowledge graph shipped).

**Carried over unchanged**, because the capture script does not yet stage the
data they need — a dashboard with all four gadget types, a Gantt with epics on
date ranges, a named workflow graph, worklogs, an agent-context note:
`dashboard-desktop`, `roadmap-desktop`, `workflow-graph-desktop`,
`agent-context-desktop`, `drawer-desktop`, `drawer-worklogs-desktop`,
`board-swimlanes-desktop`, `nlql-autocomplete-desktop`. They are still accurate
as of the 2026-07-03 design pass; extending `seed-screenshots.ts` to cover them
is the next step, and until then this note is the honest account of which
images are current.

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

Two commands. The dressed dataset is a script, not a memory — that is the whole
point, since the previous set drifted two design passes behind the product
precisely because reshooting meant recreating a workspace by hand.

```bash
# 1. Stage the dressed "Nova Analytics" workspace (destructive for that
#    workspace only; every other workspace in the database is untouched).
cd apps/api
DATABASE_URL=<your-db> npx tsx prisma/seed-screenshots.ts

# 2. Capture. Needs the API on :4000 and the web build served on :3000.
cd ../web && pnpm build
PW_NO_WEBSERVER=1 npx playwright test --config=playwright.screenshots.config.ts
#   -> writes to /tmp/nl-shots (override with SHOT_DIR)

# 3. Optimize, then install into BOTH locations.
pngquant --force --quality=65-90 --speed 1 --output <f> -- <f>   # for each PNG
cp /tmp/nl-shots/*.png docs/screenshots/
cp docs/screenshots/*.png docs-site/public/screenshots/
```

Skipping step 3's `pngquant` roughly **triples** every file — the committed set
is 8-bit palette PNG, and a straight Playwright capture is 24-bit.

`apps/web/e2e/screenshots.capture.ts` is named `.capture.ts`, not `.spec.ts`, so
the normal Playwright config can never pick it up: it asserts almost nothing and
depends on the dressed data above.

Adding a shot: add it to the capture script, add a row to the index table, and —
if a doc references it — add the reference. Keep images web-optimized and
**self-hosted in this repo**; no external CDN links.
