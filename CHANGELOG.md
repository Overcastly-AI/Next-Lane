# Changelog

All notable changes to Next Lane are documented here.
Next Lane is built and maintained by [Overcastly AI](https://overcastly.com).

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Next Lane uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

_Releases are automatic — every merge to `main` that contains a `feat:` or
`fix:` commit publishes a version and writes its section below. Nothing is
staged here by hand (see [`RELEASING.md`](./RELEASING.md))._

---

## [0.13.1] — 2026-08-05

[Compare with v0.13.0](https://github.com/Overcastly-AI/Next-Lane/compare/v0.13.0...v0.13.1)

### Bug Fixes

* **roadmap:** resizable epic column, and dependency lines behind the bars ([#77](https://github.com/Overcastly-AI/Next-Lane/issues/77)) ([5d50178](https://github.com/Overcastly-AI/Next-Lane/commit/5d50178a30c10a8cf7f0fbcaa027d1db3236e169))

## [0.13.0] — 2026-08-05

[Compare with v0.12.0](https://github.com/Overcastly-AI/Next-Lane/compare/v0.12.0...v0.13.0)

### Features

* **roadmap:** drag a story from one epic to another on the Gantt ([#76](https://github.com/Overcastly-AI/Next-Lane/issues/76)) ([cfa6f48](https://github.com/Overcastly-AI/Next-Lane/commit/cfa6f48c3cb1cbaebf60fed62614d4a47c313f29))

## [0.12.0] — 2026-08-05

[Compare with v0.11.0](https://github.com/Overcastly-AI/Next-Lane/compare/v0.11.0...v0.12.0)

### Features

* **roadmap:** presenting mode — full-bleed, read-only roadmap ([#75](https://github.com/Overcastly-AI/Next-Lane/issues/75)) ([351b5b9](https://github.com/Overcastly-AI/Next-Lane/commit/351b5b9c776441f86022a1ec0c79e862b70ddad0))

## [0.11.0] — 2026-08-05

[Compare with v0.10.3](https://github.com/Overcastly-AI/Next-Lane/compare/v0.10.3...v0.11.0)

### Features

* **roadmap:** draw and remove epic dependencies on the Gantt ([#74](https://github.com/Overcastly-AI/Next-Lane/issues/74)) ([f1f5a2d](https://github.com/Overcastly-AI/Next-Lane/commit/f1f5a2db15bedee2534efafd3dbb680bc797601c))

## [0.10.3] — 2026-08-05

[Compare with v0.10.2](https://github.com/Overcastly-AI/Next-Lane/compare/v0.10.2...v0.10.3)

### Bug Fixes

* **roadmap:** tint epic bars by status, and fix the white-on-white drag tooltip ([#73](https://github.com/Overcastly-AI/Next-Lane/issues/73)) ([3dc6495](https://github.com/Overcastly-AI/Next-Lane/commit/3dc64950e6aa1691fc4213263356f699aa0a3d04)), closes [#f3f5f8](https://github.com/Overcastly-AI/Next-Lane/issues/f3f5f8)

## [0.10.2] — 2026-08-05

[Compare with v0.10.1](https://github.com/Overcastly-AI/Next-Lane/compare/v0.10.1...v0.10.2)

### Bug Fixes

* **roadmap:** make the Gantt readable — mobile, status colour, progress, dates ([#72](https://github.com/Overcastly-AI/Next-Lane/issues/72)) ([7f86dda](https://github.com/Overcastly-AI/Next-Lane/commit/7f86dda52e104f8e5381ac9a46d7ba07738d8f65))

## [0.10.1] — 2026-08-05

[Compare with v0.10.0](https://github.com/Overcastly-AI/Next-Lane/compare/v0.10.0...v0.10.1)

### Bug Fixes

* **roadmap:** let a story show its sprint's dates AND still be draggable ([9f42d2e](https://github.com/Overcastly-AI/Next-Lane/commit/9f42d2e7bca0e9ba0962d9954e62ab0d55792c74))
* **test:** stop asserting a fixed 100% zoom on a graph that fits itself ([8f54c8d](https://github.com/Overcastly-AI/Next-Lane/commit/8f54c8d8c12046c70ec8b6f80f2259a74f01e800)), closes [#70](https://github.com/Overcastly-AI/Next-Lane/issues/70)

## [0.10.0] — 2026-08-05

[Compare with v0.9.0](https://github.com/Overcastly-AI/Next-Lane/compare/v0.9.0...v0.10.0)

### Features

* **roadmap:** fill the width at every zoom, show drag deltas, create in place ([6ae0465](https://github.com/Overcastly-AI/Next-Lane/commit/6ae0465bff2c51dd09f965f79c6dec5d9ff8ab86))
* **roadmap:** move create into the chart as rows, Jira Cloud style ([23a208c](https://github.com/Overcastly-AI/Next-Lane/commit/23a208c8ef542e6bcfbed39325d3b83145d3ea12))
* **roadmap:** skip weekends — shade them, and keep scheduled dates on working days ([b6bc139](https://github.com/Overcastly-AI/Next-Lane/commit/b6bc1398406530720faf119bd332efdca84c5b75))

### Bug Fixes

* **roadmap:** schedule undated stories on the chart, and stop leaving the page ([483e011](https://github.com/Overcastly-AI/Next-Lane/commit/483e01185a25c7f26cf05a5034dd4b94ac69ad8e))

## [0.9.0] — 2026-08-04

[Compare with v0.8.0](https://github.com/Overcastly-AI/Next-Lane/compare/v0.8.0...v0.9.0)

### Features

* **roadmap:** roll child dates up to epics, and make the Gantt editable ([b38e3a5](https://github.com/Overcastly-AI/Next-Lane/commit/b38e3a5cd970dc049dd0397f15d651e9c516f7ab))

## [0.8.0] — 2026-08-01

[Compare with v0.7.0](https://github.com/Overcastly-AI/Next-Lane/compare/v0.7.0...v0.8.0)

### Features

* **web:** board design pass — lane depth, a capacity rail, and a toolbar with a hierarchy ([38ae463](https://github.com/Overcastly-AI/Next-Lane/commit/38ae463ecd599798aa68b66be65d9ce87df9b3a4)), closes [#f4f6f9](https://github.com/Overcastly-AI/Next-Lane/issues/f4f6f9) [#eef1f6](https://github.com/Overcastly-AI/Next-Lane/issues/eef1f6)
* **web:** one source of truth for project views, a skip link, and a card footer with rhythm ([e6d8b29](https://github.com/Overcastly-AI/Next-Lane/commit/e6d8b292ef5dbfa56d6e076f869fc0322d2e9c94))

### Bug Fixes

* **web:** a workspace you cannot see says so, instead of pretending you lack admin ([4505015](https://github.com/Overcastly-AI/Next-Lane/commit/4505015f1420aed59053fbc25e6265cd21822589))
* **web:** header search trigger was 4px taller than every control beside it ([d5b1337](https://github.com/Overcastly-AI/Next-Lane/commit/d5b13374406c333d3f634a78ec266a23f1cdd3f3))
* **web:** reorganise the left nav — Home, a named Workspace group, and two labels that lied ([222eb19](https://github.com/Overcastly-AI/Next-Lane/commit/222eb19c01e62a7632aa374c61e40be491fff434))
* **web:** the knowledge graph frames itself, and a share link you just made shows up ([1a07417](https://github.com/Overcastly-AI/Next-Lane/commit/1a074173bc78d787c0ec2ee6805a7fa2e274799c))

## [0.7.0] — 2026-08-01

[Compare with v0.6.0](https://github.com/Overcastly-AI/Next-Lane/compare/v0.6.0...v0.7.0)

### Features

* **pages:** make the docs nav draggable — resize the panel, drag to reorder or nest ([7db0308](https://github.com/Overcastly-AI/Next-Lane/commit/7db0308d3c4a130699c7b4ca4301c6d74c5128fa))

## [0.6.0] — 2026-07-31

[Compare with v0.5.0](https://github.com/Overcastly-AI/Next-Lane/compare/v0.5.0...v0.6.0)

### Features

* **mcp:** agents can author doc templates, not just use them ([c70c32e](https://github.com/Overcastly-AI/Next-Lane/commit/c70c32e7d4fc07b16a5970f753e142479f705cc7))
* **pages:** images in documentation pages, addressed by id not URL ([511ff93](https://github.com/Overcastly-AI/Next-Lane/commit/511ff93dc294cdda0ab098d49b2245bb25789f2a))

### Bug Fixes

* **web:** pin jsdom to ^26 — jsdom 30 silently skipped every DOM test on CI ([c4f6c9b](https://github.com/Overcastly-AI/Next-Lane/commit/c4f6c9b0b291cc1688650daacc24d883b2c0b4e5))

## [0.5.0] — 2026-07-31

[Compare with v0.4.2](https://github.com/Overcastly-AI/Next-Lane/compare/v0.4.2...v0.5.0)

### Features

* **storage:** S3-compatible object storage — Ceph RGW, MinIO, AWS S3, R2 ([7155fe6](https://github.com/Overcastly-AI/Next-Lane/commit/7155fe6beb3c9bd89641278a433823d25b82b6a7))

## [0.4.2] — 2026-07-31

[Compare with v0.4.1](https://github.com/Overcastly-AI/Next-Lane/compare/v0.4.1...v0.4.2)

### Bug Fixes

* **api:** uploads 500 in Docker and K8s — EXDEV on cross-device rename ([312f8eb](https://github.com/Overcastly-AI/Next-Lane/commit/312f8eb750180c87cf471ea59a3466fd5765cec4))

## [0.4.1] — 2026-07-31

[Compare with v0.4.0](https://github.com/Overcastly-AI/Next-Lane/compare/v0.4.0...v0.4.1)

### Bug Fixes

* **web:** refresh the activity log from your own change, not a socket echo ([6598eed](https://github.com/Overcastly-AI/Next-Lane/commit/6598eed278c242f909684069ec788ad7e1292134))

## [0.4.0] — 2026-07-31

[Compare with v0.3.1](https://github.com/Overcastly-AI/Next-Lane/compare/v0.3.1...v0.4.0)

### Features

* **pages:** doc templates — preloadable markdown formats, workspace-wide and per-project ([7614a1c](https://github.com/Overcastly-AI/Next-Lane/commit/7614a1c006a7e45b1605dca0ac9e823cfcc665ac))

## [0.3.1] — 2026-07-30

[Compare with v0.3.0](https://github.com/Overcastly-AI/Next-Lane/compare/v0.3.0...v0.3.1)

### Bug Fixes

* **deploy:** repair the Kustomize path and gate it in CI ([c799a77](https://github.com/Overcastly-AI/Next-Lane/commit/c799a7794db21d4f958ba76dcbed47defca3ae18)), closes [#57](https://github.com/Overcastly-AI/Next-Lane/issues/57)

## [0.3.0] — 2026-07-30

[Compare with v0.2.0](https://github.com/Overcastly-AI/Next-Lane/compare/v0.2.0...v0.3.0)

### Features

* **search:** return answers, not titles — snippets, real paging, comment index ([dc0f84a](https://github.com/Overcastly-AI/Next-Lane/commit/dc0f84a243d5ba20ff75d20efdc1bf30b254eaaf)), closes [#21](https://github.com/Overcastly-AI/Next-Lane/issues/21)

## [0.2.0] — 2026-07-30

[Compare with v0.1.5](https://github.com/Overcastly-AI/Next-Lane/compare/v0.1.5...v0.2.0)

### Features

* **mcp:** expose the workspace docs space — close the org-wide memory hole ([57e3d8d](https://github.com/Overcastly-AI/Next-Lane/commit/57e3d8d0c2cdf998559870a140e8c9978b251128))

## [0.1.5] — 2026-07-30

[Compare with v0.1.4](https://github.com/Overcastly-AI/Next-Lane/compare/v0.1.4...v0.1.5)

### Bug Fixes

* **helm:** block api scaling that would silently 404 uploads ([3dbd13e](https://github.com/Overcastly-AI/Next-Lane/commit/3dbd13ed65172a603744a06f5fd3d1c1e11c3b83))

## [0.1.4] — 2026-07-30

[Compare with v0.1.3](https://github.com/Overcastly-AI/Next-Lane/compare/v0.1.3...v0.1.4)

### Bug Fixes

* **ci:** readiness probe hard-failed on a still-starting container ([16bfd8d](https://github.com/Overcastly-AI/Next-Lane/commit/16bfd8d7705b553938b2b5a1ce095695604d106e))

## [0.1.3] — 2026-07-30

[Compare with v0.1.2](https://github.com/Overcastly-AI/Next-Lane/compare/v0.1.2...v0.1.3)

### Bug Fixes

* **ci:** CSP smoke test fired on a <script> inside an HTML comment ([d1df230](https://github.com/Overcastly-AI/Next-Lane/commit/d1df2309696710170fa6bba01f91c06bfff861d2))
* **web:** reopened "New page" modal kept the previous title, splicing typed text ([9086ecc](https://github.com/Overcastly-AI/Next-Lane/commit/9086eccb71b74c162178153b1099e40568a885c7)), closes [#52](https://github.com/Overcastly-AI/Next-Lane/issues/52)

## [0.1.2] — 2026-07-29

[Compare with v0.1.1](https://github.com/Overcastly-AI/Next-Lane/compare/v0.1.1...v0.1.2)

### Bug Fixes

* **web:** built index.html shipped a CSP-blocked inline script ([203b280](https://github.com/Overcastly-AI/Next-Lane/commit/203b280fcda9294d75a631b287ecc780137d4daa))

## [0.1.1] — 2026-07-29

[Compare with v0.1.0](https://github.com/Overcastly-AI/Next-Lane/compare/v0.1.0...v0.1.1)

### Bug Fixes

* **ci:** auto-release needs Node 22 — semantic-release refuses Node 20 ([4506c12](https://github.com/Overcastly-AI/Next-Lane/commit/4506c126b2b2f7d450f72a56707389f9bd238baf))

## [0.1.0] — 2026-07-25

**First published release.** Everything below was built in the pre-release
development phase and is being tagged and published for the first time:

| Artifact | Where it lands |
| --- | --- |
| `next-lane-api`, `next-lane-web` container images (multi-arch) | `ghcr.io/overcastly-ai/…` (+ Docker Hub if the maintainer configures it) |
| `@next-lane/mcp` (120-tool MCP server) | npm, published with provenance |
| `next-lane` Helm chart | `oci://ghcr.io/overcastly-ai/charts` |

Versioned `0.1.0` rather than `1.0.0` deliberately: the product is
feature-complete against the v1 criteria in
[`docs/ROADMAP.md`](./docs/ROADMAP.md), but this is the first time anyone
outside the repo can install it, and the public interfaces most likely to move
in response to that feedback — the MCP tool schemas, the Helm values, the REST
surface — should be free to change on a minor bump. `1.0.0` is the compatibility
promise, and it follows once the published artifacts have been installed and
verified from the outside.

### Added — 2026-07-18 (Release & publish automation)

- **`.github/workflows/release.yml`** — one `v*` tag publishes every artifact:
  multi-arch images to GHCR (and Docker Hub when its secrets exist),
  `@next-lane/mcp` to npm with **provenance**, the Helm chart as an OCI
  artifact to GHCR, and a GitHub Release whose notes are this file's matching
  section. Optional publishers **skip gracefully** when their secrets are
  absent instead of failing the release; nothing publishes unless the version
  guard, the unit/typecheck gates and the image build all pass.
  `workflow_dispatch` runs the whole pipeline as a **dry run**.
- **`scripts/sync-versions.mjs`** — one source of truth for the version across
  root/api/web/mcp/shared `package.json` and the Helm chart's `version` **and**
  `appVersion`, with a `--check` mode wired into CI (`versions` job) and into
  the release pipeline, so a tag can never ship mismatched artifacts. Writing
  the guard immediately caught the chart shipping `version: 0.1.0` with
  `appVersion: "1.0.0"`.
- **`RELEASING.md`** — the maintainer runbook: required vs. optional accounts
  and secrets, how to cut a release, what publishes where, verification, and
  rollback.
- `apps/mcp` npm-page metadata (`repository`/`homepage`/`bugs`/`keywords`) and
  the MIT `LICENSE` now ship inside the published tarball.
- Fixed: the Helm chart's default image repositories and `home`/`sources` URLs
  pointed at a `next-lane/next-lane` namespace that does not exist — they now
  match what CI actually publishes (`ghcr.io/overcastly-ai/…`).
- `images.yml` no longer triggers on tags (it stays the default-branch "edge"
  build + CSP smoke test), so exactly one workflow publishes a version.

### Added — 2026-07-09 (Agent-side knowledge-base support: search_pages tool, server instructions, distributable skill)

Closing the "does the MCP side need a skill?" gap (founder question):
- **`search_pages` MCP tool** (120 tools total, 57 read / 63 write) — the
  server-side page FTS was unreachable by agents; now it's their cheapest
  discovery path (relevance-ranked over titles + content, compact refs,
  paged, optional project scope).
- **Server `instructions` now teach the knowledge-base workflow** to every
  connecting MCP client: find docs first (search_pages / get_issue_pages /
  get_page_graph), document as you work, connect with `[[wiki-links]]`,
  mention issue keys to auto-link, titles can't contain `[ ] |`, versioning
  is automatic and restore is non-destructive.
- **New distributable skill `skills/knowledge-base`** (alongside
  `project-context`) for agents that support Agent Skills: the full
  discipline — search before building, read the docs behind an issue first,
  link-first writing, where new knowledge belongs, check backlinks before
  deleting.

### Changed — 2026-07-09 (Pages: full-page document layout + full-page editing — founder directive)

A page now reads and edits like a real document, not a boxed panel:
- **Read mode** — display-size title and a centered, comfortable reading
  column; the backlinks panel anchors to the bottom of a full-height page.
- **Full-page editing** — entering Edit turns the whole pane into a
  borderless writing canvas: the editor fills every pixel down to the bottom
  (scrolls internally), the backlinks panel gets out of the way, and the
  `[[wiki-link]]` autocomplete works as before. Title and body sit in the
  same centered column, so you write on the page, not in a form field.
All 30 Pages e2e green (desktop + mobile) after the change.

### Changed — 2026-07-09 (Knowledge graph: Obsidian-style visual redesign — founder directive)

The graph view now speaks Obsidian's visual language instead of bordered
pills: every page is a **filled dot sized by its link count** (hub pages read
instantly as bigger circles) with the title in small quiet text underneath;
edges are whisper-thin and undirected-looking (arrowheads dropped); hovering
a node lights up its whole neighborhood in the signal color while everything
else hard-fades — the "constellation" effect. Dots stay centered on the
layout points so edges terminate at dot centers; hover/focus states use
brandable design tokens (no hardcoded colors); all test hooks, keyboard
focus, reduced-motion behavior, and the edge-clipping guard preserved — all
24 Pages e2e green desktop+mobile after the redesign.

### Added — 2026-07-09 (Pages full-text search + issue↔page cross-linking)

- **Full-text search over pages** — `Page` gains a Postgres `searchVector`
  generated column (title + content) with a GIN index, mirroring the issue
  FTS. Pages now appear in the ⌘K command palette and cross-project search
  under their own "Pages" group (distinct icon, archived pages muted),
  ranked by relevance and strictly tenant-scoped (a viewer never sees a page
  from a project they can't access). `websearch_to_tsquery` keeps user input
  safe; short queries fall back to ILIKE.
- **Issue ↔ page cross-linking** — a page whose body references an issue key
  (e.g. `NL-123`) auto-links to that issue on save (same project only); the
  issue drawer shows a "Linked pages" section, and two MCP tools
  (`get_page_issues` / `get_issue_pages`, 119 tools total) expose both
  directions to agents.

### Fixed — 2026-07-09 (Pages review-fix wave — reorder, graph perf, wiki-link integrity, authoritative link traversal)

Post-merge code review of the Pages frontend + MCP surfaces, findings fixed inline:
- **Optimistic page-tree reorder was inverted** — the up/down affordance
  showed no change or an overshoot until the server settled. Fixed the splice
  math and extracted it to a pure module (`pages.reorder.ts`) with unit tests.
- **Knowledge-graph layout could jank the main thread** (~280 ms in one call
  on a ~1000-node graph). Reworked `forceLayout` into a resumable stepper the
  graph view drives in per-frame chunks — no long block, same converged layout.
- **`[[wiki-link]]` integrity**: page titles containing `[`, `]`, or `|` (the
  wiki-link delimiters) silently produced dead links + missing graph edges.
  Titles now forbid those characters at write time (like Obsidian) with inline
  validation in the create dialog.
- **Authoritative outgoing links**: new `GET /pages/:id/links` returns a page's
  outgoing links straight from the stored `PageLink` rows, so `get_page` /
  `get_page_links` (MCP) can no longer disagree with the graph when two pages
  share a title. Replaces the previous client-side re-derivation.
- **MCP response bounds**: `list_pages verbose` now hydrates concurrently and
  is capped at 25 pages/call (was up to 200 sequential requests that could trip
  the rate limiter); outgoing links are capped with a `truncated` flag.
- **First unit-test runner for `apps/web`** (vitest) covering the reorder and
  force-layout logic. a11y/UX: graph SVG uses `role="group"` (keeps node
  buttons exposed), delete-with-children disables its confirm, the unresolved-
  links badge now shows a compact count on mobile.
- **Independent QA pass (desktop + mobile) — 3 defects found and fixed**, each
  with a regression test now in the suite:
  - Double-clicking **Save** double-submitted (duplicate version) and
    double-clicking **Create** made duplicate pages — added synchronous
    in-flight guards (the async pending state couldn't block a same-tick click).
  - **Knowledge-graph node labels clipped** past the canvas edge on any graph
    with >2 pages (reliable on mobile) — the layout clamped node *centers* by a
    30px margin while nodes render as 132×40 boxes. The layout now insets
    centers by the node half-extents so every label stays fully on-screen.
  - New e2e coverage: `pages-qa-extra.spec.ts` (hierarchy, reorder, title
    validation, graph pan/zoom) and `pages-adversarial.spec.ts` (double-submit,
    title overflow, delete-guard, graph clipping) — all green desktop + mobile.

### Added — 2026-07-09 (Pages frontend — tree, markdown editor with `[[wiki-links]]`, backlinks + the knowledge graph view)

**The user-facing half of the Pages pillar — a project wiki that's also an
Obsidian-style knowledge graph.**
- **Pages section** per project (nav entry beside Board/Backlog/Dashboards):
  a collapsible page **tree** sidebar, breadcrumb, create-root/create-child.
- **Markdown editor** reusing the existing renderer, with Obsidian-style
  **`[[wiki-link]]` autocomplete** (type `[[` → pick a page in the project;
  the shared `parseWikiLinks` powers both the editor and link resolution) and
  a **Document ⇄ Graph** view toggle.
- **Version history** drawer (view any past version, restore) and a
  **backlinks / "what links here"** panel on every page.
- **Force-directed knowledge graph view** — pages as nodes, `[[wiki-links]]`
  as edges, per project; hand-rolled force simulation (no external
  CDN/graph-lib — CSP-safe under the prod nginx `script-src 'self'`),
  `prefers-reduced-motion`-aware, Dispatch-tokened for light + dark, click a
  node to open the page. Renders on desktop and mobile.

### Added — 2026-07-09 (Pages MCP tools — agents read, write, AND traverse the knowledge graph)

**The crown jewel of the Pages pillar: an agent can now do over MCP what
neither Confluence (no graph/agent API) nor Obsidian (local-only) allow.**
12 new `@next-lane/mcp` tools (105 → 117):
- **CRUD** — `list_pages` (project-scoped, compact refs, `verbose: true`
  hydrates full content), `get_page`, `create_page`, `move_page`,
  `update_page`, `delete_page`.
- **Version history** — `list_page_versions`, `get_page_version`,
  `restore_page_version`.
- **Graph & backlink traversal** — `get_page_graph` (a project's whole
  page↔page link graph in one call, `truncated`-flagged), `get_page_backlinks`
  ("what links here"), `get_page_links` (this page's own outgoing
  `[[wiki-links]]`, split into resolved pages and referenced-but-not-yet-
  written titles). `get_page` also inlines outgoing-links + backlink-count
  orientation by default, so "open a page, see what it connects to" is one
  call. Tool descriptions are written to actively teach the traversal
  pattern, not just describe the shape.
- Gated by the `pages:read`/`pages:write` PAT scopes introduced alongside the
  Pages backend module (below).

### Added — 2026-07-09 (Pages — schema + backend module: Confluence × Obsidian-hybrid knowledge base)

**Kicks off the new Pages pillar (`docs/ROADMAP.md` Phase 11) — a team wiki
that's also a knowledge graph.**
- **Nestable page tree, project-scoped** — create/get/update/move/delete
  pages with fractional-index sibling ordering (`POST /projects/:id/pages`,
  `GET /projects/:id/pages/tree`, `GET/PATCH/DELETE /pages/:id`,
  `POST /pages/:id/move`), cycle-rejected reparenting, and an explicit 400
  (not a silent cascade) when deleting a page that still has children.
- **Full, restorable version history** — every create and every
  content/title-changing save writes a new immutable `PageVersion` snapshot
  (`GET /pages/:id/versions`, `GET /pages/:id/versions/:n`,
  `POST /pages/:id/versions/:n/restore` — restoring writes a NEW version,
  history is never mutated or truncated).
- **Obsidian-style `[[wiki-links]]`** — a shared `parseWikiLinks` parser
  (`packages/shared/src/wikilink.ts`) resolves `[[Page Title]]`/
  `[[Page Title|alias]]` references to pages in the same project
  case-insensitively on every save, keeping `PageLink` edges in sync
  (add/remove only the delta). A link to a not-yet-created page is a valid,
  silently-tracked state, not an error.
- **Backlinks + knowledge graph** — `GET /pages/:id/backlinks` ("what links
  here") and `GET /projects/:id/pages/graph` (the full node/edge set for a
  project, capped and truncation-flagged for very large wikis).
- Gated by new `pages:read`/`pages:write` PAT scopes from day one.
- Frontend, MCP tools, and issue↔page cross-linking are separate, upcoming
  slices — see `docs/BACKLOG.md` § Ready.

### Added — 2026-07-06 (SSO/OIDC Phase 2 — SAML + multi-provider + JIT provisioning)

**Closes the last "Admin controls" Better-than-Jira lever.**
- **SAML 2.0 login** via `@node-saml/node-saml`, alongside the existing
  generic-OIDC provider — SP-initiated flow, strict assertion validation
  (signature required and never admin-configurable off, audience always
  enforced, single-use replay protection, timestamp checks always active).
- **N simultaneously-configured providers**: a new, additive `SsoProvider`
  table + `/admin/sso-providers` REST/UI (OIDC and/or SAML rows) alongside
  the untouched Phase-1 single-provider `OidcConfig` — every existing
  single-provider deployment keeps working unmigrated. The login page shows
  one button per enabled provider.
- **Just-in-time workspace/role provisioning**: a brand-new SSO identity's
  first login can auto-join a configured default workspace at a configurable
  role (defaults to Viewer, off by default) — no pre-existing invite
  required; an already-existing user's memberships are never touched by a
  later SSO login.
- Proven end-to-end against the real `@node-saml/node-saml` library with a
  locally-generated self-signed certificate (zero network) — signature
  forgery, tampering, expiry, audience confusion, and replay are all
  live-tested rejection cases, plus a real HTTP round-trip smoke test.

### Added — 2026-07-06 (PAT-scope route-coverage guard + GitLab auto-transition e2e parity)

**Two regression-guard hardening items, closing "shipped but never
structurally regression-tested" gaps on already-shipped features.**
- **PAT-scope route-coverage test:** new `apps/api/src/pat-scope-
  coverage.integration.spec.ts` boots the real `AppModule` and walks every
  registered controller route via Nest's `DiscoveryService`/`MetadataScanner`,
  asserting each route either carries `@RequireScope` or is on a small,
  explicit, per-route-reasoned `EXEMPTIONS` allowlist (auth/oidc/health/
  public/me/personal-boards-private/webhook-receivers). The route↔scope
  matrix was extracted from `pat-scope-rollout.integration.spec.ts` into a
  shared `pat-scope-matrix.fixture.ts` (one exported constant, imported by
  both specs).
- **Real drift caught and fixed by writing the guard:** `github.controller.ts`
  and `gitlab.controller.ts` had been `@RequireScope`-gated since before the
  Hardening Night PAT-scope rollout but were never added to the matrix (12
  rows added); `GET /projects/:id/activity` was scoped but missing from the
  matrix (1 row added); `GET /workspaces/:id/logo` (a `@Public()`
  branding-asset route) had no exemption entry (added). Matrix 143→190 rows;
  full integration suite 307→393 tests, all green.
- **Both-ways proof:** temporarily removing `@RequireScope('issues:write')`
  from `IssuesController#create` made the new spec fail, naming the exact
  unscoped route; reverting made it pass again.
- **GitLab auto-transition e2e parity:** new `apps/web/e2e/gitlab-auto-
  transition.spec.ts` mirrors `pr-auto-transition.spec.ts`'s GitHub depth for
  GitLab — settings-toggle enable/persist, a locally `X-Gitlab-Token`-tokened
  `Merge Request Hook` webhook (`state: 'merged'`) driving a real status
  transition (verified via REST, not just the UI), the shared board-card
  `issue-pr-badge` flipping open→merged, the MR link visible in the issue
  drawer, disabled-by-default regression, and mobile no-overflow. 6 new e2e
  cases, desktop + mobile, zero egress, zero app-code changes (the feature
  already shipped for both providers).
- **MCP:** not applicable to either item — test-coverage-only work, no new
  API/agent surface.

See `docs/BACKLOG.md` § Already Done for full detail.

### Added — 2026-07-06 (Dashboard sharing — public read-only embed)

**A dashboard can now be published read-only, no-login, to a bookmarkable
`/share/dashboard/:token` URL — the project-board public-share pattern,
extended to dashboards.**
- **Schema:** additive `DashboardShareToken` table — a parallel model
  mirroring `ShareToken` field-for-field (not a widened `ShareToken` with a
  nullable `dashboardId`), so the already-tested board share-token surface
  needed zero changes and a dashboard link can never double as a board link.
  Migration `20260706120000_add_dashboard_share_tokens`.
- **Backend:** `DashboardShareTokensModule` (`apps/api/src/
  dashboard-share-tokens/`) — ADMIN-gated `POST/GET /dashboards/:id/
  share-tokens` (mint/list) + `DELETE /dashboards/:id/share-tokens/:tokenId`
  (revoke), mirroring the board share-token controller/service exactly
  (same scopes, same 404-not-403 cross-tenant contract). Public
  `GET /public/dashboard/:token` (new route on the existing
  `PublicController`, same rate limit as the board equivalent) delegates to
  `DashboardsService.getPublicDashboardData`, which reuses the exact same
  gadget-evaluation core the authenticated dashboard view uses — no parallel
  evaluation path.
- **`me()` degradation:** an anonymous public viewer has no signed-in
  identity; a gadget whose NLQL calls `me()` now fails loud with an explicit
  per-gadget error (new shared `queryReferencesMe()` AST check in
  `packages/shared/src/nlql/validate.ts`) instead of the evaluator's
  documented library-consumer fallback (`ctx.currentUserId ?? null`), which
  would otherwise silently render as "unassigned" — confidently wrong, not
  merely absent.
- **Frontend:** `/share/dashboard/:token` (`SharedDashboardPage.tsx`) reuses
  the authenticated dashboard's own gadget-visualization components
  (`GadgetResultBody`/`VISUALIZATION_LABELS` extracted from `GadgetCard.tsx`
  for reuse) with no add/edit/delete/reorder affordance; `DashboardShareModal.tsx`
  (mint/list/revoke UI, mirrors `ShareSection`) opens from a new ADMIN-only
  "Share" button on the Dashboards page toolbar.
- **Tests:** 24 new API unit tests (1906→1930, 88→90 suites); 6 new
  tenant-isolation + PAT-scope-rollout matrix rows (301→307 integration
  tests); 7 new shared vitest for `queryReferencesMe` (164→171); 14 new e2e
  cases (`dashboard-share-link.spec.ts`, desktop+mobile) — mint → public
  render → `me()`-gadget shows its error → revoke → error page, plus the
  admin mint/revoke UI flow; full regression (board share-link, dashboards
  Phase 1/2) re-verified green.
- **MCP:** not applicable — a public, no-token browser surface, not an
  agent action.

### Added — 2026-07-06 (Gitea integration v1 — two-way link)

**Third self-hosted forge, after GitHub (HMAC) and GitLab (shared-secret
token).** Same two-way linking shape as the shipped GitHub/GitLab v1s;
Gitea's webhook scheme is HMAC-SHA256 like GitHub's (`X-Gitea-Signature`,
hex-encoded, no "sha256=" prefix), so `GithubModule`'s verification shape is
the closer template, while the DB tables mirror both providers' parallel-table
pattern. v1 is deliberately **links-only** — no auto-transition-on-merge, no
live PR/CI status, no outbound `GiteaClient` call (unlike GitHub/GitLab's
PR-status follow-up).
- Additive `GiteaIntegration` (`giteaBaseUrl` REQUIRED — Gitea has no SaaS
  default, `repoFullName` "owner/repo", AES-256-GCM-encrypted token, generated
  HMAC webhook secret) / `IssueGiteaLink` (PR/COMMIT/BRANCH, unique on
  `[issueId, kind, externalId]`) tables, migration
  `20260706000000_add_gitea_integration` (verified zero-drift via
  `prisma migrate diff`).
- `GiteaModule` (`apps/api/src/gitea/`): ADMIN-gated `PUT/GET/DELETE
  /projects/:projectId/gitea` (GET role-shaped via `getEffectiveProjectRole`)
  + `GET /issues/:issueId/gitea-links`; public `POST /gitea/webhook/:projectId`
  verifies `X-Gitea-Signature` HMAC-SHA256 (constant-time compare) against the
  raw request body before processing `push` (commit + branch-name key scan)
  and `pull_request` (title + head-branch key scan, state open/closed/merged)
  events, scoped to the project's own issue-key prefix via the shared
  `common/issue-key.util.ts`. Two new PAT scopes (`gitea:read`/`gitea:write`),
  every route `@RequireScope`-gated.
- **Frontend:** `GiteaSection.tsx` settings card (mirrors
  Github/GitlabSection — instance URL + owner/repo + token form, webhook
  URL/secret with copy buttons; MEMBER read-only summary) and
  `GiteaLinksSection.tsx` in the issue drawer's Development area, rendered
  alongside GitHub/GitLab links (three-provider layout) — no live-status
  spinner, since v1 has none.
- **Tests:** 55 new API unit tests (signature verification, AES round-trip,
  ADMIN gating, tenant isolation, push/PR event parsing incl. wrong-project-key
  scoping and idempotent re-delivery) — 1905 total API tests green (85→88
  suites); 4 new tenant-isolation-matrix rows (all BLOCKED) + 4 new
  PAT-scope-rollout matrix rows (DENY+ALLOW) — 301 integration tests green;
  `apps/web/e2e/gitea-integration.spec.ts` (4 scenarios × desktop+mobile, 8/8
  green) — settings save + webhook URL/secret display, a **locally-HMAC-signed
  fake Gitea webhook POST** links the issue, invalid signature → 401 + no
  link, member read-only view; `github-integration`/`gitlab-integration`/
  `issue-detail`/`issue-drawer-overlay`/`settings-robustness` regression
  re-verified green (50/50). Live round-trip verified against the running API:
  valid webhook → `linksUpserted:1`; tampered signature → 401; replay →
  idempotent (same link id); missing-signature push → 401; PAT without
  `gitea:read` → 403 with the exact scope message, with it → 200; a
  cross-project issue key never links.
- **MCP:** `list_issue_gitea_links` (paged, `gitea:read`-scoped) — 105 tools
  total (was 104); `apps/mcp/README.md` scope table/tool table/counts updated.

### Fixed — 2026-07-06 (NLQL unresolved assignee/sprint name)

**A typo'd or nonexistent assignee/sprint name in an NLQL query now 400s
instead of silently matching zero issues** (MCP-QA pass 1, finding 1
residual — the deliberately-deferred half of the earlier name-resolution
fix). New shared `resolveQueryNames(query, ctx)` (`packages/shared/src/nlql`)
is a fail-loud prepare step run once per evaluation, alongside the existing
`loadNlqlEvalContext`; the pure evaluator itself is unchanged and keeps its
documented silent-fallback behavior for library consumers.
- `IssuesService.exportCsv` (also the MCP `list_issues` query-mode oracle)
  now throws a 400 naming the unresolved value, e.g. `Invalid NLQL query:
  unknown user "Alex Rivera" — use an exact display name, an id, or me();
  see list_users`.
- The dashboard-gadget evaluator flags only the offending gadget's `error`
  field — a bad query in one gadget never fails the whole dashboard read.
- The automation engine's condition eval now produces a `FAILED` run with
  the same message (was previously an indistinguishable-from-real
  `SKIPPED`), mirroring its existing invalid-condition handling.
- The board query bar's client-side validation reuses the same helper
  (existing `nlql-error` affordance) for immediate feedback while typing.
- Bonus: the CSV-export toast was silently swallowing the API's actual
  error message for every NLQL 400 (not just this one) — now surfaces it
  verbatim; the board's client-side filter context was also missing
  `sprints` entirely, so `sprint = "<name>"` never resolved there even for
  a real sprint.

### Fixed — 2026-07-06 (Hardening Night frontend batch)

**Mobile toast/modal overlap, "Merged" badge dark-mode break, dashboard
selection shadow state, and two P2 mobile/loading polish items** (all four
`docs/UI-REVIEW.md` 2026-07-06 findings):
- Toasts now bottom-anchor at every breakpoint (`ui/Toast.tsx`) instead of
  pinning to the top below `sm:`, where they covered every `Modal`'s
  header/close button for the full error-toast duration on any mutation
  failure at ≤640px (17+ modal-hosting components affected); `ui/Modal.tsx`'s
  panel is now also capped at `max-h-[calc(100dvh-4rem)]` with a sticky
  header/footer and scrollable body so a tall form's footer can't collide
  with the bottom-pinned toast either.
- `purple` joined `tailwind.config.js`'s CSS-var-backed `varScale()` palette
  (with matching `:root`/`.dark` values in `index.css`), fixing the "Merged"
  PR/MR badge — and the identical-root-cause `WorkspaceAuditLogPage`/
  `WorkspaceMembersPage` badges — rendering as a jarring, non-adapting
  stock-hex chip in dark mode; zero per-component changes needed.
- `DashboardsPage`'s active-dashboard selection moved from local `useState`
  to the `?dashboard=<id>` URL search param (mirroring `BoardPage`'s
  URL-as-source-of-truth filter pattern), so reload/deep-link/share now land
  on the same dashboard instead of always resetting to the first one.
- `GadgetCard`'s drag handle grew a ~40px touch target on mobile (was ~16px);
  the GitHub/GitLab Development sections' live PR/CI and MR/pipeline status
  polls now show a small spinner while loading instead of rendering nothing.

### Security — 2026-07-06

**IPv4-embedded IPv6 forms now blocked by the SSRF guard (review follow-up
on the DNS-pin fix):**
- `isBlockedIp`'s IPv6 branch only knew `::1`/link-local/unique-local — an
  AAAA record of `::ffff:169.254.169.254` (IPv4-mapped), `::127.0.0.1`
  (deprecated IPv4-compatible), or `64:ff9b::a9fe:a9fe` (NAT64) passed
  vetting, and the connection pin then faithfully connected to the embedded
  loopback/metadata address. All IPv4-embedded forms (dotted and pure-hex
  textual styles) now extract the inner IPv4 and re-run the IPv4 blocklist;
  `::` (unspecified) is blocked too. Bracketed IPv6 literal URLs
  (`http://[2001:db8::1]/`) are also handled correctly now instead of
  failing closed on every legitimate IPv6-literal target. GitHub/GitLab
  clients drain non-OK response bodies (socket-reclaim parity with webhook
  delivery), and the issue-create transaction's `maxWait` was tightened
  12s→5s so pool exhaustion sheds load instead of queueing pile-ups.
  16 new unit tests.

**docker-compose now forwards every documented env var to the API container
("Hardening Night", audit pass 13 finding 1):**
- The stock `docker-compose.yml` only passed 7 of the ~25 operator variables
  `.env.example` documents — `SMTP_*` never reached the container, so
  password-reset email was silently dead in every stock self-hosted deploy
  (the API logged "email was NOT delivered" in production mode);
  `CORS_ORIGINS`, `GITHUB/GITLAB_TOKEN_ENCRYPTION_KEY`,
  `OIDC_*`, `WEBHOOK_ALLOW_PRIVATE`, `THROTTLE_*`, `MAX_FILE_BYTES`, and
  `LOG_LEVEL` were equally inert. All are forwarded now; variables the code
  reads with a `?? default` get the same default in compose (an empty string
  would override `??`), and `AUTO_SEED` is overridable
  (`${AUTO_SEED:-true}`) instead of hardcoded. Verified with
  `docker compose config`.

**Config-parity CI smoke test closes the bug CLASS, not just the instance
above (engineering-auditor Pass 13 Ideation #2):** new
`scripts/smoke-config-parity.sh`, wired into CI as an early step of the
existing `docker-build` job, renders `docker compose config` with a distinct
sentinel value per `.env.example`-documented variable and asserts each one
round-trips into the rendered `api` service environment — a future variable
that's documented but never forwarded (exactly how the bug above shipped) now
fails CI immediately instead of silently doing nothing in production. The
reverse direction is checked too — every `${VAR}` the api service actually
reads must be documented — which caught (and this same change fixed) five
real, live documentation gaps: `AUTO_SEED`, `WEB_BASE_URL`,
`GITLAB_TOKEN_ENCRYPTION_KEY`, `GITLAB_WEBHOOK_BASE_URL`, and
`OIDC_CONFIG_ENCRYPTION_KEY` were all genuinely forwarded and read by code
but absent from `.env.example`. A small, explicit, reviewed ignore-list
(one reason per entry) covers variables that are legitimately not a 1:1
passthrough (`DATABASE_URL`/`REDIS_URL` composed inline, `API_PORT`/
`POSTGRES_PORT`/`REDIS_PORT`/`WEB_PORT` host-port mappings, `VITE_API_URL` a
web build arg, `UPLOADS_DIR` intentionally container-internal,
`RESET_BASE_URL` a dead fallback superseded by `WEB_BASE_URL`, and the
documented-but-not-yet-implemented `OTEL_*` stub vars).

**PAT-scope rollout completed across every controller ("Hardening Night" item 1):**
- Personal Access Tokens created with restricted scopes (e.g. `issues:read`
  only) previously fell through to full owner permissions on roughly 30
  controllers that carried no `@RequireScope` decorator at all — including
  `projects`, `workspaces`, and `reports`, so a scoped-down agent token could
  still create/delete projects, delete workspaces, and remove members. Every
  one of those controllers is now gated, mirroring the existing
  `issues.controller.ts` pattern; 6 controllers are legitimately exempt and
  documented as such in-code (`auth`, `auth/oidc`, `health`, `public` — no
  bearer principal to check a scope against — plus `me` and the read-only
  routes of `personal-boards`, which are purely caller-private data).
- Three new scope pairs added to `PAT_SCOPES`: `workspaces:read`/
  `workspaces:write`, `admin:read`/`admin:write` (instance SSO/OIDC config),
  and `tokens:read`/`tokens:write` — the last one closes a genuine
  self-escalation gap where a scoped-down token could mint itself a fresh
  *unrestricted* token via `POST /me/tokens`.
- If you already issued a narrowly-scoped PAT to an agent, it may need
  `projects:read`/`workspaces:read` added to keep working against MCP tools
  like `list_workspaces`, `list_projects`, `list_users`, and the report tools
  — those previously worked with any scope; they now enforce the matching one.
- New `pat-scope-rollout.integration.spec.ts` proves, against the real app
  with real HTTP requests, that all 143 newly-gated routes reject a
  wrong-scope token (403) and accept a correctly-scoped one; full API/shared/
  MCP test suites and `tsc --noEmit` stay green.

**DNS-rebinding TOCTOU closed in the shared SSRF guard ("Hardening Night"
wave 2, audit pass 13 Risk 3):**
- Outbound calls to a user/admin-supplied URL (webhook delivery, GitHub/GitLab
  live PR/CI status polling) previously resolved DNS once to check the target
  against a private/loopback/link-local blocklist, then let `fetch()`
  re-resolve DNS itself for the actual connection — a short-TTL attacker
  nameserver could answer the check with a public IP and the real connection
  with an internal one (`169.254.169.254`, `127.0.0.1`, ...), the classic
  DNS-rebinding SSRF bypass.
- New shared `apps/api/src/common/ssrf-safe-fetch.ts`: `ssrfSafeFetch()`
  resolves DNS exactly once and pins the actual TCP/TLS connection to that
  one vetted address via a custom undici `Agent` connector, closing the
  re-resolution window structurally. All three outbound-call families
  (webhook delivery, `GithubClient`, `GitlabClient`) now share this one path.
  `WEBHOOK_ALLOW_PRIVATE=true` still bypasses the guard entirely for
  self-hosters targeting internal infrastructure they control.

**`multer` DoS CVEs closed via a root `pnpm.overrides` ("Hardening Night"
wave 2, audit pass 13 Risk 4):**
- `@nestjs/platform-express`'s `FileInterceptor` — used by every upload
  endpoint (workspace logo, CSV import, issue attachments) — bundled its own
  transitive, unpatched `multer@2.0.2` (3 high + 1 moderate DoS advisories)
  despite the app's own direct `multer` dependency already being patched.
  A root `pnpm.overrides` now forces the patched version everywhere;
  `pnpm audit --prod` dropped from 5 high to 0 high advisories. Uploads
  verified working end-to-end (real multipart round-trip, byte-identical).

### Fixed — 2026-07-06 (Hardening Night wave 2)

- `POST /issues` intermittently returned 500 ("Transaction already closed...
  timeout 5000 ms") under concurrent load in resource-constrained
  environments. The issue-create transaction now does only the minimum work
  that must commit atomically together, and uses an explicit, longer
  timeout/max-wait to tolerate database connection-pool contention.

### Added — 2026-07-03 (2)

**PR-status + auto-transition-on-merge, with a board-card "linked PR" badge:**
- Per-project, off-by-default automation toggle on both the GitHub and
  GitLab integrations (`autoTransitionOnMerge`/`autoTransitionStatusId`,
  migration `20260703100000_add_pr_auto_transition`): a `merged` PR/MR
  webhook event moves every linked issue to a configurable target status,
  via a new token-free `PATCH /projects/:projectId/{github,gitlab}/automation`
  and reusing `IssuesService.move()`'s existing workflow-transition
  enforcement path's automation-bypass flag — the same mechanism the
  automation engine's own TRANSITION action uses. A new shared
  `common/automation-actor.util.ts` resolves a "who did this" actor for the
  webhook-triggered move (assignee → reporter → project lead → longest-
  tenured workspace ADMIN); every issue's transition is independently
  try/caught so one ineligible actor never blocks a sibling issue or fails
  the webhook response.
- Board cards now show a small "PR"/"Merged" badge (mirroring the existing
  blocked-issue badge) when the issue has linked GitHub PRs/GitLab MRs —
  `board.service.ts`'s `issueInclude` gained a compact `githubLinks`/
  `gitlabLinks` state-only select, aggregated into `IssueDto.prLinkSummary`.
- The issue drawer's Development section now polls live PR/CI status
  (GitHub) and MR/pipeline status (GitLab) on open — the first real outbound
  calls through `GithubClient`/`GitlabClient`, both routed through the same
  SSRF-guarded (`resolveAndCheckBlocked`, shared with `webhooks.service.ts`)
  fetch path used for outbound webhook delivery. Degrades gracefully (a
  quiet unavailable hint, never a hard failure) when the live call fails.
- MCP: 6 new tools — `get_issue_github_live_status`,
  `get_issue_gitlab_live_status`, `get_github_automation_config`,
  `get_gitlab_automation_config`, `set_github_automation_config`,
  `set_gitlab_automation_config` (the config reads never return the webhook
  secret/PAT, a narrower surface than the REST GET). 103 tools total.
- 69 new API unit tests (1731→1800), 4 new tenant-isolation-matrix rows
  (108/108 blocked), `apps/web/e2e/pr-auto-transition.spec.ts` (6 cases ×
  desktop+mobile, incl. a locally-HMAC-signed `merged` webhook driving a
  real status transition).

### Added — 2026-07-03 (3)

**Configurable dashboards — Phase 2: cross-sprint velocity trend, drag-to-reorder, default gadgets, engineering hardening:**
- New `VELOCITY_TREND` dashboard gadget — cross-sprint committed vs.
  completed story points (`GET /projects/:id/reports/velocity-trend?sprints=N`,
  default 6, clamped 1-24), project-wide by design (the gadget's NLQL
  `query` isn't used to scope it — there's no single issue set to filter
  across every sprint's own issues). Renders via the existing `VelocityChart`
  component the Reports page already uses — a real gadget-framework reuse,
  not a bespoke report page. Migration `20260703090000_add_velocity_trend_
  gadget_visualization` adds the enum value.
- Drag-to-reorder gadgets — the Phase-1 up/down buttons replaced with a real
  dnd-kit sortable grid (`rectSortingStrategy`, a dedicated grab handle so
  Edit/Delete stay clickable); `config.position` is now a numeric
  fractional-midpoint value computed client-side and PATCHed for only the
  moved gadget (never a renumber of the rest), with an optimistic
  client-side reorder.
- A project's very first dashboard is now pre-populated with 3 starter
  gadgets (Open issues / Status overview / My open issues) — every
  dashboard after that still starts empty.
- Engineering hardening (AUDIT-ENGINEERING.md Pass 12, P2-2):
  `MAX_DASHBOARDS_PER_PROJECT` (20) / `MAX_GADGETS_PER_DASHBOARD` (30) caps
  (`BadRequestException` before insert), and `getDashboardData`'s per-gadget
  NLQL evaluation loop parallelized with `Promise.all` (was sequential).
- Cross-workspace gadget scoping audited and verified correct (already
  project-derived, never keyed off the app's global "active workspace"); a
  real dashboard-selection race found and fixed along the way — creating a
  second dashboard while one was already selected could briefly snap back to
  dashboard #1 before the list refetch landed.
- MCP: new `get_velocity_trend_report` tool; the dashboard gadget tool
  family's `visualization`/`config` schemas extended with `VELOCITY_TREND`/
  `sprints`/fractional `position`; `create_dashboard`/`create_dashboard_gadget`
  descriptions now name the caps proactively. 104 tools total.
- New API unit tests for cap rejection, default-gadget seeding, and
  `VELOCITY_TREND` gadget/report evaluation; 1 new tenant-isolation-matrix
  row (108/108 blocked); `apps/web/e2e/dashboards-phase2.spec.ts` (6 cases ×
  desktop+mobile) covering the trend gadget, default gadgets, drag-to-reorder
  (a real `page.mouse` sequence — dnd-kit listens on Pointer Events, not
  HTML5 DnD), and cross-workspace scoping.

### Changed — 2026-07-03

**Idempotency hardened to claim-first (code-review follow-up to Agent
Experience Round 2):**
- `withIdempotency` now inserts a pending claim row BEFORE running the
  mutation — the unique constraint elects exactly one executor, and a
  concurrent duplicate (the classic client-timeout retry) polls for the
  winner's stored response instead of running the mutation a second time.
- A failed first attempt releases the claim (nothing recorded), so its retry
  genuinely re-runs instead of filing a duplicate; post-commit notification
  failures no longer fail `create` (which would have poisoned the claim).
- Reusing an `idempotencyKey` with a different request payload now returns
  409 (payload hash comparison) instead of silently replaying the first
  response.
- `atomic: true` bulk updates no longer surface a post-commit side-effect
  failure as a whole-batch error after every write already committed.
- 4 new unit tests (1727→1731 API total): concurrent-duplicate single
  execution, poll timeout 409, failed-attempt claim release, payload-mismatch
  409.

### Fixed — 2026-07-03 (activity feed blind spots)

**Sprint/parent/component/label mutations now logged to the activity feed:**
- The project activity feed and agent-context staleness measurement were
  previously blind to sprint re-scoping, parent/epic re-assignment, component
  changes, and label attach/detach — a bulk sprint re-parent or atomic
  re-assignment looked like nothing happened while a single comment
  immediately bumped staleness. Fixed at the write path:
  - `prepareUpdate` now logs sprint/parent/component field changes (both
    single-issue and bulk-update paths share it, and changes now count as
    `changedFields` for watcher notifications too).
  - Label attach/detach logs an `'label'` activity in all three paths
    (`LabelsService` add/remove, bulk `addLabelIds` classic and atomic), with
    no-op-safe semantics (a repeat attach or detach-of-unattached logs
    nothing).
- Live-verified (parent activity row written on PATCH). 9 new unit tests;
  affected suites green; tsc clean.

### Added — 2026-07-03

**Issue start date field (Agent Experience Phase A):**
- **`Issue.startDate`** — new DateTime field alongside existing `dueDate` for
  issues. Both fields support the same semantics (null clears; undefined no-op)
  and trigger activity-log entries on change.
- **API/DTOs** — `create_issue`, `update_issue` DTOs validate that
  `startDate <= dueDate` (cross-field validation). `IssueDto.startDate` in
  `packages/shared`.
- **NLQL** — `start` / `startDate` fields registered in the query language
  (allowlist, evaluator, autocomplete, docs reference) wherever `due` is
  supported.
- **Frontend** — `StartDateField` alongside `DueDateField` in the issue drawer.
  Date picker uses the same styles and accessibility patterns. Playwright test
  coverage (start-date.spec.ts, 146 lines).
- **CSV export/import** — "Start Date" column added to CSV export; CSV importer
  now maps `start_date` / `startDate` / `start` from Jira/GitHub/Linear exports.
- **Roadmap/timeline** — epic window derivation now prioritizes the epic's own
  `startDate → dueDate` range when both are set, falling back to the child-sprint
  range if the epic has no own dates.
- **Bug fix** — Playwright `getByLabel` strict-mode flake in due-date.spec.ts
  (the "Clear date" button's aria-label case-insensitively substring-matched the
  date input's label).

**MCP ergonomics sweep (Agent Experience Phase B):**
- **NLQL query evaluation** — `list_issues` gains an NLQL `query` parameter (passed
  to the CSV export's server-side parser/evaluator) as the match oracle, then
  hydrated into full issue objects via cursor-paginated GET. Invalid queries surface
  the parser's own error messages, not generic failures.
- **Token-efficiency envelope** — all 25 list_*/search_* tools now return a uniform
  `{items, total?, limit, offset?, hasMore}` envelope. Each resource supports a
  compact field set by default (minimal) and `verbose: true` for the full DTO.
  Pagination defaults to 50 items/page (max 200). Field report verified: same
  list_issues call is 11 KB (compact, NLQL-narrowed) vs. 84–150 KB (verbose).
- **Workflow safeguard** — `create_issue` now accepts `expectedProjectKey` (optional);
  if provided and the resolved project key doesn't match, the create is rejected
  *before* any database mutation.
- **Epic overview** — new `get_epic_overview` tool returns epic details, compact
  children, per-status rollup, and a progress {done, total, fraction} in a single
  call (works on any issue with children, not just EPIC-typed ones).
- **startDate exposure** — `create_issue`, `update_issue`, and `list_issues` now
  include `startDate` in request/response/compact envelopes.
- **Unit tests** — 80 total MCP tests (18 new in this phase); all green.

**Per-project agent context memory (agent handoff + skill):**
- **Schema** — new `ProjectAgentContext` model: one persistent document per
  project (64 KB content limit), `updatedById` attribution (nullable), cascades
  on project delete.
- **API endpoints** — `GET /projects/:id/agent-context` (VIEWER+ read, never
  404s—empty string before first write) and `PUT /projects/:id/agent-context`
  (MEMBER+ write via `getEffectiveProjectRole`). Both include `contentBytes`,
  `updatedBy`, `updatedAt`, and `staleness = {changesSinceUpdate, lastProjectActivityAt}`
  (measured from ActivityLog + project-scoped AuditEvent entries newer than the doc).
  Scoped to `projects:read` / `projects:write` PAT scopes. Realtime
  `project-agent-context.updated` Socket.io emit on write.
- **MCP tools** — `get_project_context` / `update_project_context`. Server-level
  MCP instructions reach every connecting client, prompting the read-first /
  hand-off-last discipline at the protocol layer.
- **Distributable skill** — new `skills/project-context/` Agent Skill bakes the
  discipline into any skills-capable agent: read context on start, update at
  milestones, always dump a structured handoff before finishing. Includes a
  worked example. Install docs in `apps/mcp/README.md` ("Ship your agent with
  memory") and main README.
- **Unit tests** — 1611 total API tests (15 new agent-context), 7/7 tenant matrix
  rows passing (with new agent-context isolation rows).

**Web UI for agent-context handoff document:**
- **Project Settings panel** — new "Agent context" section in project settings
  (alongside Members/GitLab) displays the shared agent-context markdown document.
  Edit-in-place (Edit → textarea → Save/Cancel); 64 KB size cap enforced.
  Toast on successful save, inline error on overflow. Staleness indicator
  (amber pill) shows count of changes since last update. MEMBER+ write,
  VIEWER+ read (via `getEffectiveProjectRole`).
- **Unit tests** — agent-context.service expanded with 46 new tests.

**GitLab integration v1 — two-way linking:**
- **Webhook receiver** — new `apps/api/src/gitlab/` module processes inbound
  GitLab events (push, merge_request). Commit messages, MR titles, and branch
  names referencing an issue key (e.g. `NL-123`) trigger upsert of
  `IssueGitlabLink` rows (parallel to GitHub integration).
- **Integration configuration** — new `GET/PUT /projects/:id/gitlab-integration`
  endpoints (project ADMIN gated); per-project GitLab URL (self-hosted support)
  + repo fullname + webhook secret + AES-256-GCM encrypted PAT. Cascade delete
  when project deleted.
- **Schema** — new `GitlabIntegration` and `IssueGitlabLink` models (mirrors
  GitHub pattern).
- **Tests** — 15+ unit tests covering webhook HMAC verification, issue key
  extraction, link upsert logic.

**NLQL name-resolution fix (MCP-QA finding):**
- Fixed person/sprint name resolution in NLQL queries to properly resolve
  names containing spaces (e.g. "John Smith", "Sprint One") and handle edge
  cases in the autocomplete evaluator.

**Epic swimlanes fix:**
- **Board query** — `issueInclude` now includes `parent` (IssueRef-shaped),
  so the web's epic-lane grouping (keyed on `issue.parent?.type === EPIC`)
  correctly groups cards by epic instead of putting all cards in "No epic".
  Regression test added to board.service.spec.ts.

**Agent Experience Round 2 — data integrity, idempotency, activity, comment gating:**
- **Cross-project write validation** — `create_issue` now shares `update()`
  and `move()`'s `assertSameProject` guard for statusId/sprintId/parentId.
  Confirmed live P1: a foreign statusId would 201 and render on no column.
  Fixed secondary gap: `bulkUpdate`'s `addLabelIds` lacked project scope check
  (new `assertLabelsInProject` guard).
- **Idempotency keys** — new `IdempotencyRecord` table (~24h window TTL,
  opportunistic cleanup); optional `idempotencyKey` on `create_issue` /
  `add_comment` — a retry replays the original response, zero duplicate.
- **Bulk parenting & transactions** — `parentId` now bulk-updatable (cross-project
  guarded); `atomic: true` validates whole batch before writing inside a shared
  transaction (all-or-nothing). `update()` refactored into `prepareUpdate` /
  `writeIssueUpdate` / `finishUpdate` phases to support this.
- **Dry-run mode** — `dryRun: true` (with or without `atomic`) returns per-item
  verdicts; zero writes.
- **Comment edit/delete gating** — REST gating upgraded from author-only to
  author-or-effective-project-ADMIN (mirrors work logs). New MCP
  `update_comment` / `delete_comment` tools.
- **Project activity feed** — new `GET /projects/:id/activity` (VIEWER+)
  cursor-paginated k-way merge of ActivityLog + Comment + WorkLog entries
  ordered chronologically. + MCP `list_project_activity` tool.
- **expectedProjectKey hardening** — upgraded to MUST-pass language everywhere
  (tool description, server instructions, project-context skill) + optional
  `NEXT_LANE_MCP_STRICT_PROJECT_KEY` env var for hard enforcement.
- **Folded-in features** — agent-context staleness now counts comments +
  worklogs; `list_users` gained server-side `q` filter; new `create_project` /
  `create_workspace` MCP tools.
- **Test coverage** — 44 new API unit tests (1683→1727), 13 new MCP tests
  (84→97), 1 new tenant-isolation row (103/103 BLOCKED). All live-verified
  against running API (cross-project statusId 400s, idempotent replay same id,
  atomic bulk parented 30 tickets in one call, dryRun wrote nothing).
- **MCP surface** — 97 total tools (41 read, 56 write).

### Added — 2026-07-02

**In-app SSO/OIDC admin configuration:**
- **Admin settings screen** — new `/admin/sso` page (instance-admin gated) allows
  operators to configure SSO/OIDC provider details (issuer URL, client ID, client
  secret) directly in the app, with live effect (no API restart needed). Environment
  variables (`OIDC_*`) take precedence for air-gapped deployments.
- **Instance-admin concept** — `User.isInstanceAdmin` flag (auto-set for first user
  on fresh install, or oldest user on existing install) gates instance-wide settings
  distinct from workspace-level ADMIN role. Used to protect SSO configuration from
  inadvertent changes by workspace admins.
- **Shared secret encryption** — new `common/crypto/secret-crypto.util.ts` (AES-256-GCM)
  replaces GitHub integration's inline encryption pattern; both OIDC and GitHub PAT
  secrets now use the same secure-at-rest pattern.
- **Backend** — new `apps/api/src/admin-settings/` module with `OidcConfigService`
  (singleton management), controller (GET/PUT for config mutation), and 40+ unit tests.
  Schema: new `OidcConfig` model (id='default', instance-wide singleton).
- **Frontend e2e tests** — 12 desktop/mobile tests covering admin SSO screen: label
  field display, form submission, secret masking, env-override detection, success toast,
  login button re-render after config change.

**Per-project role overrides (Phase 2):**
- **Backend authorization layer** — new `apps/api/src/project-memberships/` module
  with `getEffectiveProjectRole()` (single source of truth for project-scoped authz)
  and three MCP tools (list_project_members, set_project_role_override,
  remove_project_role_override). Workspace ADMINs bypass overrides. Non-admin members
  can be elevated to project ADMIN or restricted to project VIEWER.
- **API endpoints** — `GET /projects/:id/members` (list with overrides), `PUT
  /projects/:id/members/:userId/role` (set override), `DELETE
  /projects/:id/members/:userId/role` (clear override). All scoped `projects:read` /
  `projects:write` PAT scopes.
- **Frontend UI** — new Members section in project settings (admin-gated); displays
  workspace members with override badges; inline role dropdown (VIEWER/MEMBER/ADMIN)
  with create/edit/delete audit trail.
- **Schema** — new `ProjectMembership` model (sparse, unique on projectId+userId);
  enables per-project role restriction/elevation without duplication of workspace
  members.
- **Authorization consistency** — all project-scoped writes/reads now call
  `assertProjectRole()`, which resolves effective role via the new override layer;
  includes work-logs GitHub route and new endpoints, PAT-scoped.
- **E2E tests** — 11 desktop tests: Members section display, override creation,
  effective role resolution, ADMIN bypass, deletion, audit events.
- **MCP tools** — 3 new tools (now 88 total: 37 read, 51 write).

**Configurable dashboards (Phase 1):**
- **NLQL-native dashboards** — per-project dashboards where every gadget is an
  NLQL query plus a visualization (STAT, TABLE, BREAKDOWN, or BURNDOWN). Gadgets
  render with per-visualization configuration (grid layout, field grouping, column
  selection, row limits). Invalid/unresolvable queries return per-gadget errors
  instead of 500s.
- **Dashboard UI** — new `/projects/:id/dashboards` page with gadget grid, create
  modal, edit modal, and drag-and-drop gadget reordering. Sidebar/ProjectNav
  navigation entries added (MEMBER+ to view, VIEWER read-only).
- **MCP tooling** — 9 new dashboard and gadget CRUD tools (list/get/create/update
  /delete dashboards and gadgets, plus get_dashboard_data for server-side
  evaluation). MCP server now 88 tools (37 read, 51 write).
- **Backend** — `apps/api/src/dashboards/` module with controller, service, DTOs,
  and gadget evaluator (reuses shared validateQuery/filterIssues). 40+ new unit
  tests. Schema: additive `Dashboard` and `DashboardGadget` models
  (migration 20260702010000_add_dashboards).
- **E2E tests** — 10 new desktop/mobile tests for dashboard create, STAT gadget
  display, BREAKDOWN visualization, VIEWER read-only, per-gadget error handling,
  and 393px no-overflow.

### Fixed — 2026-07-02

**Settings robustness sweep:**
- **Admin lockout guard** (P1) — workspace Members invite form no longer silently
  self-demotes a solo admin. Inviting an already-member email returns a friendly
  409; role changes moved to new `PATCH /workspaces/:id/members/:membershipId`
  endpoint, which enforces a last-admin invariant (workspace never locked out of
  admin access).
- **Branding color validation** (P2) — hex input now normalizes 3-digit CSS
  shorthand to 6-digit before submit instead of server 400.
- **Status & label uniqueness** (P2) — statuses and labels now reject case-insensitive
  duplicate names per project with friendly 409 errors.

**Workflow robustness sweep:**
- **Unified status-change enforcement** (P1) — Triage's "s" picker, issue drawer
  status dropdown, and bulk edit no longer silently bypass board-assigned named
  workflows or project-level workflow enforcement. All surfaces now route through
  a single `IssuesService#enforceStatusChange()` that resolves and checks both
  named and legacy workflow gates before allowing a transition.
- **REQUIRE_FIELD gate resolution** (P2) — custom-field gates now resolve field
  names/keys case-insensitively to definition IDs; field input in the gate editor
  is a curated `<select>` instead of freeform text.
- **Gate validation** (P2) — REQUIRE_FIELD and REQUIRE_LINK gates reject blank
  field keys with 400; gate editor disables Save until field is chosen; already-stored
  blank-key gates render a "misconfigured" warning.
- **Workflow rename UI** (P2) — named workflows now have an inline rename affordance
  (pencil icon → per-keystroke edit → Enter/blur saves, Escape cancels).
- **Settings disambiguation** (P3) — legacy WorkflowSection and new WorkflowsManager
  now have distinct headings, explanations, and uniquely labeled "+ Add transition"
  buttons.

**CSP & realtime updates (Pass-12 engineering batch):**
- **CSP artifact hardening** (P1) — dark-mode bootstrap moved from a CSP-blocked
  inline `<script>` to a self-hosted `public/theme-init.js` loaded as a static
  asset via `<script src>`, satisfying strict `script-src 'self'` outright.
- **Dashboards realtime coverage** (P1) — dashboards had zero real-time Socket.io
  coverage. Added `SocketEvents.DashboardUpdated`, emitted from every
  `DashboardsService` CRUD mutation; dashboard gadgets refresh automatically when
  any project issue changes (no page reload needed).
- **BulkUpdate N+1 query fix** (P2) — `resolveEnforcedWorkflowId` in bulk-edit
  was issuing one board/sprint query per issue. Fixed via
  `buildBulkWorkflowResolution()` (O(1) queries per batch, not O(issues)).

**Mobile board toolbar regressions (Pass-12 product batch):**
- **Invisible dropdowns** (P1) — board toolbar menus (Group by, Labels, Type, Priority,
  saved filters, NLQL help) were plain `position: absolute` boxes that painted zero
  pixels on a real 393px phone. Fixed with a new portalled, viewport-clamped
  `<DropdownPanel>` component (positions `fixed` instead, flipping above the trigger
  when there's no room below).
- **Filter chip row scrolling** — quick-filter chip row now scrolls properly
  (`overflow-x: auto` + `shrink-0` chips + `.nl-scroll` thin-scrollbar treatment);
  was silently clipping "Recently updated" off-canvas.
- **Sidebar auto-collapse at 1024px** — sidebar now collapses to icon rail by default
  at the 1024-1279px "small laptop" breakpoint (unless user has an explicit preference
  saved); fixes cramped 3-column board at 1024x768 resolution.

**Docs-site mobile menu:**
- Fixed dead mobile navigation menu on the docs site. The hamburger now opens a
  full-height menu (backdrop-filter containing-block fix).

### Added — Navigation & UI

**Persistent left sidebar (Navigation & IA Phase 1):**
- **Desktop** (lg+) gains a fixed persistent sidebar: workspace switcher (shared state
  with header), active workspace's projects, personal section (My Work / My Board /
  Insights / Notifications), and workspace settings utility area. Collapsible to an
  icon rail with state persisted across reloads (no flash).
- **Mobile** (below lg) uses an overlay drawer opened from the header hamburger button;
  header slims to remove duplicate nav links on desktop.
- Full keyboard accessibility (aria-current focus rings, Escape closes drawer),
  prefers-reduced-motion respected, mounted via `SidebarContext` above per-page
  remount boundaries.

**Navigation & IA Phase 2 — sidebar elevation:**
- **Per-project views in sidebar** — Board, Backlog, Roadmap, Reports now expand
  directly under the active project in the sidebar; the Gantt-style Roadmap,
  previously two clicks deep in ProjectNav's "More" dropdown, is one click away.
- **Branding as first-class link** — admin-gated workspace Branding settings now sit
  beside Workspace settings in the sidebar utility area (no longer buried in Project Settings).
- **Board default filter affordance** — the board toolbar's default-filter chip is now
  clickable, opening BoardSettingsModal's filter field with a "+ Default filter" empty-state
  prompt when none is set. Closes founder-reported discoverability gap for filter
  persistence.

**Light / dark mode — full token-layer theming:**
- **Dark palette** — Dispatch design system color scales (ink/slate/red/amber/emerald/
  green/blue/gray/orange/signal/brand) are now CSS custom-property-backed with contrast-verified
  dark values; canvas/surface/shadow semantic tokens re-derived for each mode; ink-scale
  shade roles fixed across light and dark.
- **Theme preferences** — ThemeContext stores user preference (light/dark/system) in
  localStorage (`nl.theme`); System preference auto-applies on first visit.
- **No-flash bootstrap** — synchronous inline script in `index.html` applies `.dark`
  class before first paint, preventing UI flash on theme toggle or reload.
- **Dark-aware workspace branding** — custom workspace brand colors compose correctly
  in dark mode; `applyBrandColor()` handles contrast and token composition.
- **ThemeToggle** rendered in sidebar utility area and header user menu. ~190 hardcoded
  bg-white/ring-white/border-white utilities migrated to surface tokens; modal/drawer
  backdrops pinned to mode-invariant scrim token.

### Added — Agent-native / MCP

**MCP coverage parity sweep:**
- **21 new tools** closing the founder-flagged gap between shipped features and MCP
  exposure. New tools: GitHub issue links (read-only, PAT scope aware), quick links
  (personal shortcuts), personal boards (list + create/move cards via /me identity),
  issue templates (list + create-issue-from-template), time-tracking original estimate
  field, CSV export (get_project_csv, raw text), bulk update (bulk_update_issues),
  project/personal analytics + velocity/burndown/CFD reports, notifications (list +
  mark read). 
- **Total: 76 tools** (33 read, 43 write), up from 55. Every new tool live-tested
  against the running API with a fresh demo-user PAT before commit; 33 new unit tests
  added (53 total, green).

### Added — Boards & project tracking

- **Multiple boards per project** with Kanban and Scrum board types.
- **Drag-and-drop card ordering** using fractional indexing (no full-column
  renumber on every move).
- **Custom statuses / columns** per project.
- **Live presence indicators** (Socket.io; who else is looking at this board
  right now).
- **Backlog view** with keyboard triage mode (j/k/s/p/a/l shortcuts).
- **Sprints** — create, start, complete; sprint goals and date ranges.
- **Kanban sections by field — Swimlanes v2** — group board issues by Assignee,
  Priority, Issue type, Epic, Component, Sprint, Labels, or custom SELECT fields.
  Each board has an optional `defaultGroupBy` setting; URL parameter `?group=`
  overrides. Labels surfaces each issue in every one of its label lanes. Custom
  SELECT fields render one lane per option (field order) plus a "None" lane for
  unset values.

### Added — Issues

- Issue types: Task, Bug, Story, Epic, Sub-task.
- **Epics and sub-tasks** (parent/child hierarchy).
- Labels, story points, due dates, assignee, reporter, priority.
- **Custom fields** — project-scoped typed field definitions (Text, Number,
  Select, …); values stored in JSONB.
- Markdown descriptions and threaded comments.
- File attachments (uploaded to the API; named Docker volume or PVC on k8s).
- **Issue links** — directed relationships: BLOCKS, RELATES_TO, DUPLICATES, and
  more.
- **Watchers** — watch any issue and receive in-app notifications on changes.

### Added — NLQL query language + saved filters

- **NLQL** (Next Lane Query Language) — a real structured query language for
  filtering issues: `assignee = me() AND priority in (High, Highest)`.
- **Saved filters** — persist, name, and share queries; boards can be pinned
  to a saved filter.
- **Conditional card colors** — rule-based color highlighting on board cards
  (driven by NLQL conditions).

### Added — Agile rituals

- **Planning poker** — real-time estimation sessions via Socket.io; facilitator
  controls reveal; per-session history.
- **Async standups** — team standups with per-member responses and a team
  digest; personal and team views.

### Added — Reports & analytics

- Burndown, velocity, and cumulative-flow diagram (CFD) charts.
- **Timeline / roadmap view** (Gantt-style, per-project).
- **Personal analytics** — individual velocity and throughput.
- **Team analytics** — team pulse and aggregate metrics.
- **Project analytics** tab per project.

### Added — Search & navigation

- **Full-text search** (Postgres `tsvector` with GIN index) across all issues.
- Cross-project search.
- **Command palette** (Cmd/Ctrl + K).
- Filtering by assignee, status, priority, labels, sprint, and custom fields.

### Added — Collaboration & notifications

- In-app notifications and @mention support in comments.
- Activity log per issue.
- **"My Work"** dashboard — issues assigned to the current user across projects.
- **Team Pulse** dashboard — team-wide activity feed.

### Added — Personal boards

- **Personal board** — a private Kanban for todos and personal tasks, separate
  from project boards.
- "Promote to issue" — convert a personal card into a real project issue with
  one click; the card shows a promoted badge with the new issue key.
- **Public read-only project share link** — mint a `ShareToken` for a project
  board and share a read-only view with anyone (no login required).

### Added — Bulk edit & export

- **Bulk edit** — multi-select issues in Backlog and Triage; bulk update
  assignee, status, priority, labels, sprint.
- **CSV export** — download all project issues as a CSV file from the board or
  backlog.

### Added — Automation engine (Glass Box)

- **Trigger → Condition → Action** rule engine; conditions reuse NLQL syntax.
- Actions: change status, assignee, priority, labels; post a comment.
- **Glass Box run log** — every automation execution is recorded with trigger
  data, evaluated conditions, and action outcomes; full audit trail.
- Unlimited automation runs (runs on your hardware — no per-run billing).

### Added — Workspace branding

- **Workspace branding** — custom workspace name, accent color (CSS variable
  token system applied at runtime), and logo upload (served directly by the
  API).

### Added — Auth & security

- Email/password authentication with JWT access tokens.
- **SSO/OIDC** — generic, provider-agnostic OIDC login (Okta, Auth0, Keycloak, Authentik, Google, etc.) with PKCE/CSRF protection and JIT user provisioning.
- **Personal API tokens (PATs)** for programmatic and agent access.
- Password reset via SMTP email (link logged to console when SMTP is not
  configured — safe for development).
- Role-based access control: Admin, Member, Viewer.
- **Workspace audit log** — member actions recorded and viewable by admins.
- **HMAC-signed outbound webhooks** with configurable SSRF guard.
- Rate limiting (per client IP; configurable; off switch for dev/NAT).

### Added — Deployment & ops

- **One-command Docker Compose** (`docker compose up -d --build`); auto-runs
  `prisma migrate deploy` + optional demo seed on first boot.
- **Helm chart** (`deploy/helm/next-lane`) — migration pre-install Job, HPA,
  PodDisruptionBudget, cert-manager TLS, bundled or external PostgreSQL/Redis.
- **Kustomize overlays** (`deploy/kustomize`) — dev and prod overlays.
- Multi-arch GHCR image builds (linux/amd64, linux/arm64) via GitHub Actions.
- SPDX SBOM attestation and Trivy image scan on every image publish.
- Structured JSON logs (pino) with request correlation IDs (`X-Request-Id`).
- Health and liveness probes (`GET /health`, `GET /health/live`).
- Redis-backed Socket.io adapter for horizontal API scaling.
- BullMQ webhook delivery queue for durable, retried webhook fan-out.

### Added — Workflow automation (SDLC)

- **Configurable per-project workflows** — define issue types, statuses, and transitions for your project's SDLC.
- **Per-board workflow assignment** — assign different workflows to different boards within the same project.
- **Workflow visual graph editor** — design your SDLC with a drag-and-drop graph interface (nodes for statuses, edges for transitions).
- **Workflow templates** — seed from built-in templates (simple, kanban, scrum, bug-triage).
- **Transition gates** — require assignee, description, custom fields, issue links, or no open blockers before allowing a move.
- **Issue templates** — create reusable issue templates (with default values for fields, description boilerplate, etc.); create issues from templates.

### Added — Issues & estimation

- **Checklists** — sub-task-like items within issues; track progress and completion.
- **Time tracking / work logs** — log time spent on issues; track original estimate vs. actual hours; per-issue and per-sprint rollup.
- **Components** — project-scoped issue groupings (e.g., "API", "UI", "Docs") with optional default assignee.
- **Versions / Releases** — project-scoped release tracking (UNRELEASED / RELEASED / ARCHIVED states); M:N relationship with issues.
- **WIP limits** — per-status column limits with visual warnings.
- **Custom field values pinned as chips on cards** — show selected custom field values directly on board cards.
- **Blocked badge** — visual indicator on cards with unresolved blocking issue links.

### Added — Board & views

- **Board swimlanes / grouping** — group issues by assignee, custom field, component, or version; URL-persisted.
- **Per-board default filter** — auto-apply an NLQL filter when viewing a board.
- **Filter state URL persistence** — board filters (including swimlane grouping) persist in the URL; shareable filtered views.

### Added — Personal & quick links

- **Personal board enhancements** — drag-to-reorder columns · card colors (user-selected) · due dates on personal cards · click-to-open detail drawer · column colors.
- **Quick links** — personal shortcuts in the header with accent colors and collapsible groups.
- **Workspace quick links** — per-user quick link bar for fast navigation.

### Added — NLQL & markdown

- **NLQL autocomplete** — intelligent suggestions for NLQL queries; reused in automation conditions and custom field filters.
- **Mermaid diagram support** — render Mermaid diagrams in markdown descriptions and comments; lightbox zoom (click to view full-screen).

### Added — Import & export

- **CSV import** — import issues from Jira, GitHub, or Linear CSV exports with dry-run preview.
- **Tracker importers** — dedicated importers for Jira, GitHub, and Linear; map fields and preserve issue relationships.
- **CSV export completeness** — export all issue fields and metadata to CSV.

### Added — Notifications

- **Notifications center page** (`/notifications`) — unified inbox for all in-app notifications.
- **Email notification delivery** — receive email digests for issue assignments, mentions, watchers, status changes, and automation actions.
- **Notification preferences** — per-user granular control over email delivery.

### Added — Workspace & collaboration

- **Workspace settings page** — unified workspace management UI.
- **Workspace member management** — invite, remove, and manage member roles.
- **Workspace search & recents in header** — quick workspace switcher with search and recent workspace list.

### Added — MCP (Model Context Protocol)

- **MCP server** (`@next-lane/mcp`, 55 tools) — AI agents (Claude Desktop, Claude Code, any MCP host) can read and write workspace state via the same REST API.
- **Tools for workflows/SDLC** — list, create, update, delete workflows · manage transitions and gates · assign workflows to boards.
- **Tools for issues & tracking** — create, update, move, link issues · manage checklists, worklogs, and issue links.
- **Tools for board management** — list/create/update boards · assign workflows · manage board-level filters and settings.
- **Tools for org entities** — manage sprints, statuses, labels, components, versions, automations, saved filters, custom fields.
- **Tool for user lists** — list workspace members (for @mention and assignee suggestions in agents).

### Added — GitHub integration (Phase 9 — Developer Graph v1)

- **Per-project GitHub repo linking** — two-way connection with GitHub repositories; PRs, commits, and branches referencing an issue key (e.g. `NL-123`) automatically appear in the issue's Development section.
- **Webhook receiver** — HMAC-verified inbound GitHub webhooks (Push and Pull Request events) with project-scoped issue-key extraction.
- **Encrypted PAT storage** — GitHub Personal Access Tokens stored at rest with AES-256-GCM encryption; tokens never returned by any API response after saving.
- **Settings UI** — project admins configure the repo and PAT from **Project Settings → GitHub**; webhook URL and secret auto-generated and displayed for GitHub repo setup.
- **Development section on issues** — PR and commit links show in the issue drawer with title, state, author, and GitHub URL.

### Added — Developer experience

- pnpm monorepo: `apps/api` (NestJS), `apps/web` (React + Vite), `apps/mcp` (MCP server), `packages/shared`.
- Prisma schema as single source of truth; all changes via migrations.
- Shared TypeScript types in `packages/shared` — no duplication.
- Playwright e2e suite (desktop + mobile); CI workflow (typecheck + build + unit
  tests) + E2e workflow with Postgres/Redis service containers.
- Claude Code agents, skills, and workflows (`.claude/`) for AI-assisted
  development.
- **Cross-page state-coherence QA gates** — ensure workspace/board changes propagate correctly across all surfaces (navigation, deep-link, reload).

---

[Unreleased]: https://github.com/Overcastly-AI/Next-Lane/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Overcastly-AI/Next-Lane/releases/tag/v0.1.0
