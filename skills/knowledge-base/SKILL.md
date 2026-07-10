---
name: next-lane-knowledge-base
description: Work with a Next Lane project's Pages knowledge base over MCP (@next-lane/mcp) — a project wiki that is also a traversable link graph. Use when researching how something works before starting a task (search_pages, get_page_graph, get_issue_pages), when writing or updating documentation (create_page, update_page with [[wiki-links]]), or when deciding where new knowledge belongs in an existing doc structure.
---

# Next Lane knowledge base — read before you build, write as you go

Every Next Lane project has a **Pages knowledge base**: markdown documents in
a tree, connected by `[[wiki-links]]` into a graph you can traverse. It is
the team's connected memory — treat it as the place you *read from* before
starting work and *write to* as you finish it.

## Finding what you need (cheapest first)

1. **`search_pages`** — full-text, relevance-ranked, over titles AND body
   content. Use when you know words that would appear in the doc ("deploy
   runbook", an error string, a feature name). Scope with `projectId`.
2. **`get_issue_pages`** — the docs behind a specific issue (pages whose
   body mentions its key). Check this before starting an issue: the spec,
   ADR, or runbook is often already written.
3. **`get_page_graph`** — the whole knowledge structure in one call: every
   page as a node, every `[[wiki-link]]` as an edge. Big nodes (many edges)
   are the load-bearing hub docs — start reading there. Orphans (no edges)
   are candidates to link up or archive.
4. From any page: **`get_page_links`** (what it references) and
   **`get_page_backlinks`** ("what links here") walk the graph one hop at a
   time. `get_page` inlines both by default (`includeLinks`).

## Writing pages that stay connected

- **Link first, write later.** Reference related docs as `[[Page Title]]`
  even if that page doesn't exist yet — an unresolved link is a valid state
  (it becomes a "create it" affordance in the UI). Create the target later
  and re-save the referencing page to resolve the edge.
- **Mention issue keys** (e.g. `NL-123`) in page text — the page auto-links
  to those issues on save (same project only), and shows up in the issue's
  "Linked pages" panel. This is how docs and tracked work stay attached.
- **Titles are link targets**: they must not contain `[`, `]`, or `|`
  (reserved for the link grammar), and duplicate titles within a project
  make `[[links]]` ambiguous (oldest page wins) — prefer distinct titles.
- **A page is a document, not a log.** Update it in place; every save
  writes an immutable version snapshot automatically. `restore_page_version`
  rolls back non-destructively (it writes a NEW version — history is never
  lost), so edit boldly.

## Where new knowledge belongs

Before creating a page, check whether it should extend an existing one:
`search_pages` for the topic, and look at the graph neighborhood of the hub
doc it would relate to. Prefer one well-linked page over three orphans. When
you do create a page, give it a parent (`parentId`) so it lands in the tree
where humans browse, AND wiki-link it from at least one existing page so it
joins the graph where agents traverse.

## Deleting — check backlinks first

Before `delete_page`, call `get_page_backlinks`. Deleting a page other pages
link to leaves their `[[links]]` dangling as unresolved references (the
graph stays consistent, but readers hit dead ends). Re-point or update the
linking pages first, or archive instead of deleting.

## Rules of thumb

- Read the docs behind an issue (`get_issue_pages`) before writing code for
  it — and if there were none, that's your cue to write the missing doc.
- After completing significant work, spend one call updating the relevant
  page — the next agent's `search_pages` only finds what you wrote down.
- Keep page content focused; split with child pages + `[[links]]` rather
  than growing one page past ~a few thousand words (content caps at 256 KB).
