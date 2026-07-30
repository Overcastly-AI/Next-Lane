# Research — Next Lane as agent memory

> **Status:** research / proposal. No application code changed by this document.
> **Date:** 2026-07-30. **Branch:** `research/cognee-memory`.
> **Commissioned by the founder**, verbatim framing across two messages:
> *"look into cognee and some of the features that we might be able to include
> in this repo for our AI agents. I feel like they are not relying on our
> graphing feature for memory."* → and then the sharpening that reframed the
> whole deliverable: *"I don't want to pull their features. But I want to
> reference them so we can have certain features that help improve our project.
> **We should be using Next Lane as memory for the LLMs. That was the original
> goal.**"*
>
> Evidence base: the repo at `e9c9be1` (`main`), the three
> `mcp-consumer-qa` passes in `docs/MCP-QA.md`, and a source-level read of
> cognee 1.4.0 (Apache-2.0) fetched from `raw.githubusercontent.com`. Every
> claim below about our own surface was verified by reading the code, not
> recalled.

---

## 1. The thesis

Next Lane already *is* a project's long-term memory. It stores what was
decided (comments, agent-context handoffs), what was learned (pages), what is
true now (issues, statuses, sprints), how things relate (`[[wiki-links]]`,
issue links, page↔issue links, the page tree), and what changed when
(page versions, ActivityLog, audit log). It is self-hosted, permissioned
per-tenant, and free. Nobody has to *build* a memory substrate for their
agents — they already run one, and they call it their tracker.

The product question is therefore not "should we add memory?" It is:

> **If an agent's long-term memory were a Next Lane workspace, what would it
> need that we don't have?**

The answer, established below, is short and unglamorous: *the memory is
almost entirely there; the recall path is the weak link, and one whole
memory space is invisible to agents.*

---

## 2. Verdict on the founder's hypothesis

> *"I feel like they are not relying on our graphing feature for memory."*

**The instinct is right, but the cause is not the one you'd guess.** Three
candidate explanations — not exposed, not useful, not populated — and the
evidence lands mostly on a fourth.

| Hypothesis | Verdict | Evidence |
|---|---|---|
| **The graph isn't exposed to agents** | **Partly true — and where it's true, it's decisive.** | Per-project graph traversal is *excellently* exposed: `get_page_graph`, `get_page_backlinks`, `get_page_links`, `get_page_issues`, `get_issue_pages`, plus `get_page` bundling backlink-count + split outgoing links into one call. But the **org-wide graph is completely invisible over MCP**. `GET /workspaces/:id/pages/graph`, `/workspaces/:id/pages/tree` and `POST /workspaces/:id/pages` all exist and ship (Phase 11 slices 13–17, 2026-07-10 → 2026-07-17) — and **not one of them has an MCP tool** (`apps/mcp/src/tools/index.ts` only ever calls `/projects/:id/pages/*`). The company handbook / runbook / ADR space — literally the org's durable memory — cannot be listed, read as a graph, or written to by an agent. This is tracked as ROADMAP Phase 11 **item 18, still ⬜**. |
| **The graph isn't useful to agents** | **False.** | `mcp-consumer-qa` Pass 3 drove the whole graph from tool descriptions alone, with **every graph question answered in ≤ 1 call and single-digit KB** (whole 9-node graph 2,333 B; backlinks 675 B; outgoing links 572 B). It called `get_page_graph` "the crown-jewel traversal call" and `get_page` "the single best-shaped read on the Pages surface." When agents can see the graph, they use it well. |
| **The graph isn't populated** | **Not a product defect, but a real cold-start problem.** | Edges only exist where a human or agent typed `[[Title]]` or an issue key. There is no derived edge of any kind. A fresh install's graph is empty and stays empty until someone does link hygiene by hand. Compare: the tracker's *other* relationships (parent/child, sprint, blocked-by, component) are never rendered into the graph at all, so the richest structure we already own is absent from the surface we call "the knowledge graph." |
| **↳ The real answer: agents aren't taught the graph is memory, and the recall path doesn't reward them for trying** | **This is the crux.** | Our own MCP server instructions (`apps/mcp/src/index.ts`) tell an agent that a project's memory is **`get_project_context` — a single flat 64 KB markdown blob, full-content-replace, one per project**. The graph is mentioned second, as *documentation you should also write*. So the memory affordance we actively prompt for is a scratchpad, not the graph. And when an agent does try to recall from the graph, `search_pages` returns **titles only — no excerpt, no snippet, no `ts_headline`** (`apps/api/src/search/search.service.ts` `searchPagesFts`), hard-capped at **20 results with no real pagination** (`RESULT_CAP = 20`), so "what do we know about X?" costs one search plus N full-page fetches of up to 256 KB each. An agent that tries the graph once and pays that bill learns to stop. |

**One-line answer for the founder:** agents aren't ignoring the graph because
the graph is bad — the per-project graph is the best-shaped surface we have.
They're ignoring it because (a) the org-wide half of it doesn't exist over
MCP, (b) we point them at a flat 64 KB text file and call *that* the memory,
and (c) recall returns titles, so reading the memory is expensive enough to
not be worth it.

---

## 3. Inventory — reachable by an agent (MCP) vs UI/REST-only

`@next-lane/mcp` exposes **121 tools (58 read / 63 write)**. The MCP server is
a thin authenticated passthrough over REST (`apps/mcp/src/client.ts` adds base
URL + bearer token and nothing else), so anything the REST API enforces, MCP
inherits — and anything REST exposes but MCP has no tool for is invisible to
agents.

### 3.1 Reachable today (the memory that works)

| Memory capability | MCP tools |
|---|---|
| Project page graph (nodes + edges, one call, 1000-node cap) | `get_page_graph` |
| Backlinks ("what links here") | `get_page_backlinks` |
| Outgoing `[[wiki-links]]`, split resolved / unresolved | `get_page_links`, and bundled by default into `get_page` |
| Page ↔ issue bridge, both directions | `get_page_issues`, `get_issue_pages` |
| Issue → issue typed links (blocks / duplicates / relates) | `list_issue_links` (per issue) |
| Page tree / hierarchy (project) | `list_pages` |
| Page full text (markdown) | `get_page` |
| Full-text search over pages (title + body) | `search_pages` |
| Full-text search over issues (title + description) | `search_issues` |
| Structured query over issues (NLQL) | `list_issues` `query` mode |
| Version history of a page, and any historical snapshot | `list_page_versions`, `get_page_version` |
| Chronological "what changed" feed incl. sprint/parent/label | `list_project_activity` |
| Per-project agent handoff doc + staleness signal | `get_project_context`, `update_project_context` |
| Writing memory: pages, comments, issues, links | `create_page`, `update_page`, `add_comment`, `create_issue`, `link_issues`, … |

### 3.2 NOT reachable by an agent (UI/REST-only) — the gap list

| Capability | Exists at | MCP tool? | Why it matters for memory |
|---|---|---|---|
| **Workspace-level docs space** (`POST/GET /workspaces/:id/pages`, `/pages/tree`) | REST + web Docs nav | **None** | The handbook/runbook/ADR space — the org's *non-project* memory — cannot be listed, read, or written by an agent at all. |
| **Workspace-wide (org) page graph** (`GET /workspaces/:id/pages/graph`) | REST + web observatory | **None** | The cross-project graph VISION calls "a strictly bigger moat" is agent-invisible. An agent can't answer "what's connected to this handbook page across every project?" — the exact crown-jewel question item 18 names. |
| **Workspace audit log** (`GET /workspaces/:id/audit-log`, ADMIN-only) | REST | **None** | Workspace-scope temporality (who changed structure, when) is agent-invisible. Defensible as ADMIN-only, but should be a stated policy, not an accident. |
| **Search snippets / excerpts** | Nowhere — the SQL never selects body text | n/a | See §4.1. This is the single biggest recall defect. |
| **Comment/worklog/checklist/page-version/agent-context full-text search** | Nowhere — `searchVector` covers `Issue(title, description)` and `Page(title, content)` only | n/a | The place humans and agents actually record decisions (comments) is unsearchable. |
| **Project-wide link/blocked view** | Nowhere | n/a | "What's blocked?" is still 1+N calls — open since MCP-QA Pass 1, re-confirmed Pass 2. |
| **Cross-project issue move** | Nowhere | n/a | Open since Pass 1; misfiled memory is unrecoverable except by lossy delete+recreate. |

### 3.3 Two live description defects found while reading

Not proposals — corrections, both in `apps/mcp/src/tools/index.ts` /
`apps/mcp/src/index.ts`, both cheap:

1. **Server instructions are stale on link scope.** They tell every connecting
   agent *"links resolve within the project"*. Since 2026-07-17
   (`syncWikiLinks`, `apps/api/src/pages/pages.service.ts`) resolution is
   **workspace-wide** with a same-scope-first / any-workspace-fallback pass.
   We are actively instructing agents that cross-project memory links don't
   work.
2. **`get_page_graph`'s description undersells its own payload.** It says nodes
   are `{id, title}`. `PageGraphNode` (`packages/shared/src/types.ts`) also
   carries `projectId`, `projectKey`, and `updatedAt` — i.e. the graph already
   answers "which project does this belong to" and "how stale is it" and no
   agent is told so. (`updatedAt` on graph nodes also silently closes Pass-3
   finding 2, "what changed recently?", for anyone who knows to look.)

---

## 4. Gaps against the five memory axes

### 4.1 Recall — **the weakest axis. This is where memory dies.**

*Can an agent ask "what do we know about X?" and get a useful, small answer?*

**Today: no.** Three compounding problems, all verified in source:

- **No snippets.** `searchPagesFts` selects `id, title, workspaceId,
  projectId, archived, projectKey` — it computes `ts_rank` over the indexed
  body but never returns a byte of it, and never calls `ts_headline`. The
  issue path is the same shape. So the answer to "what do we know about
  rate-limiting?" is a list of titles.
- **Hard 20-result ceiling, no real pagination.** `RESULT_CAP = 20` in
  `search.service.ts`; the MCP `limit`/`offset` params only slice those 20
  client-side. Beyond 20 matches, memory silently truncates with no signal.
- **Follow-up reads are unbounded.** The only way to see whether a hit is
  relevant is `get_page`, which returns the full markdown body — capped at
  **256 KiB** (`PAGE_CONTENT_MAX_BYTES`). Three candidate pages can cost
  three-quarters of a megabyte to disambiguate.

Net cost of one recall question today: **1 + N calls, where the N reads are
each potentially enormous.** Compare the numbers the same QA agent measured on
surfaces we *did* shape for agents: "who is Alex" = 1 call / 332 B; "what
happened since I last looked" = 1 call / 4.6 KB; whole page graph = 1 call /
2.3 KB. Recall is an order of magnitude worse than everything around it.

**A memory you must paginate through — and then fully materialise to
evaluate — is not memory.**

Also missing from recall entirely: **comments**. Decisions get recorded in
comments (the QA passes deliberately tested a "Decision: Stripe" comment) and
comments are not in any full-text index. `list_comments` is per-issue only. So
the most natural place a human or agent writes down *why* is the one place
search cannot reach.

### 4.2 Write path — **structurally fine, ergonomically wrong.**

*Can an agent durably record "we tried X and it failed" so a future agent
finds it?*

Everything needed exists: `create_page`/`update_page` (versioned on every
save, `[[wiki-links]]` and `NL-123` mentions auto-reconciled inside the same
transaction), `add_comment`, `update_project_context`. Write **safety** here is
genuinely excellent and independently verified — `expectedProjectKey`
pre-write guard, `idempotencyKey` with Stripe-grade replay semantics under real
concurrency, atomic bulk with `dryRun`, per-item cross-project rejection.

The problem is what we tell agents to do with it. Our server instructions make
**`update_project_context` the headline memory verb**: one document per
project, **full-content replace**, 64 KB cap, explicitly *"not a log."* That is
a scratchpad with a size limit and a lossy write. Recording a durable learning
the *right* way — a page, in the right scope, linked to the issue and to the
related docs — is a multi-call ceremony an agent must assemble itself
(`create_page` + edit the content to include `[[links]]` + know the exact
target titles + hope they resolve).

Consequences already observed:

- The 64 KB blob **competes with** the graph for the agent's attention, and
  wins, because it's what the protocol handshake names first.
- Two agents in the same project **overwrite each other's handoff** — full
  replace, no merge, no conflict detection.
- There is **no workspace-level equivalent**, so a learning that isn't
  project-specific has nowhere to go that an agent can reach (§3.2, row 1).
- `create_page` has no `expectedProjectKey` misfile guard, unlike
  `create_issue` (Pass-3 finding 3, still open) — so memory can be filed into
  the wrong project with no pre-write signal.

### 4.3 Traversal — **the strong axis, with a hole in the middle.**

Per-project traversal is the best part of the product from an agent's seat and
is independently proven correct under the hard cases: with two pages sharing a
title, all three graph tools resolve to the same target id, and after deleting
a hub the graph stayed internally consistent (no dangling edges) — Pass 3.

Three real holes:

1. **Org-wide traversal doesn't exist over MCP** (§3.2). Backlinks and
   `syncWikiLinks` *are* workspace-wide server-side; only the whole-graph and
   workspace-docs entry points are missing tools.
2. **Only one edge type is in the graph.** `PageLink` has no `type` column;
   `PageIssueLink` deliberately has none either. Meanwhile the tracker is full
   of typed relationships — `IssueLink` (BLOCKS/DUPLICATES/RELATES), parent↔
   child, sprint membership, component, version — **none of which appear in
   the graph or in any graph tool**. The richest relational structure we own
   is not in the thing we call the knowledge graph.
3. **`delete_page` silently orphans backlinks** and returns a bare `{id}`
   (Pass-3 finding 1, P2, open). Memory can be destroyed with no signal that N
   other memories now dangle.

### 4.4 Temporality — **better than expected; two specific gaps.**

*Can an agent ask "what did we believe about this in June?"*

Mostly **yes, and this is under-sold**:

- `list_page_versions` + `get_page_version` give an agent any historical
  snapshot of any page. Every save writes a version, from creation. This is a
  genuine "what did we believe then" primitive and it is fully agent-reachable.
- `list_project_activity` gives a cursor-paginated, `since`-filterable
  chronological feed, and the Pass-2 P1 blind spot is **fixed** — `sprint`,
  `parent`, and `label` mutations now write ActivityLog rows
  (`apps/api/src/issues/issues.service.ts`, fields logged: `created`, `status`,
  `assignee`, `priority`, `startDate`, `dueDate`, `sprint`, `parent`,
  `component`, `label`).
- `get_project_context` carries a `staleness` object counting activity newer
  than the handoff — a real "don't trust this blindly" signal.

Gaps:

- **No "as of" recall.** An agent can fetch version 4 of a page it already
  knows about, but cannot *search* history ("what did the deploy runbook say in
  June?") — page versions aren't indexed and there's no time-scoped search
  parameter anywhere.
- **Workspace audit log is agent-invisible** (§3.2). Reasonable as ADMIN-only
  policy; currently it's just absent, which reads as an oversight.

### 4.5 Scoping — **the strongest axis. No action needed.**

*Can an agent accidentally recall across tenants?* Verified: no, and it's
tested adversarially.

- The MCP server holds **no authorization logic of its own** — it forwards a
  PAT to REST. Every isolation guarantee is enforced server-side, which is the
  right architecture.
- `apps/api/src/pat-scope-matrix.fixture.ts` pins a required scope to **every**
  page route including all three workspace-level ones, and `/search/pages` is
  gated on `pages:read` (not `issues:read`) — the exact fix for the 2026-07-10
  leak.
- `apps/api/src/tenant-isolation.integration.spec.ts` runs an HTTP matrix
  asserting *every* cross-tenant request is non-200, covering all 15 page
  routes plus the workspace graph/tree, and adds adversarial gates:
  a `[[link]]` whose only title match lives in another workspace **resolves to
  nothing** (indistinguishable from a nonexistent title — no id leak), and
  workspace A's graph contains no node or edge from tenant B.
- Because MCP is a passthrough over exactly those routes, the suite covers the
  agent surface by construction. **Any new MCP tool must be a new row in that
  matrix** — that's the standing rule to keep.

---

## 5. Recommendations

Four items. Ordered by leverage. All are Postgres 16 + Prisma + NestJS +
`apps/mcp`; **none introduces a new service, a new database, or any LLM
dependency**; all keep `docker compose up` as the whole install story.

---

### R1 — Recall that returns *answers*, not titles (`search_pages`/`search_issues` snippets + a lift on the cap)

**What it is.** Full-text search returns a ranked, highlighted **excerpt** of
the matching body alongside the title, so one call answers "what do we know
about X?" without a follow-up fetch.

**Why it matters here.** This is the difference between Next Lane being memory
and being a filing cabinet. Every other agent-facing surface we shaped hits
1 call / sub-5 KB; recall is the outlier at 1+N calls / up to 256 KB per hop.
It also flips a scorecard row directly: "Search & query power" is already rated
**Better** on *query* — this makes it better on *recall*, the half a memory
system is judged on. Against the daily-driver test: the incumbent's search
returns excerpts; ours returns a list of filenames.

**Concrete shape.** `ts_headline('english', pg.content,
websearch_to_tsquery('english', $q), 'MaxFragments=2, MaxWords=30,
MinWords=10')` added to the two `$queryRaw` blocks in
`apps/api/src/search/search.service.ts` (`searchPagesFts`, and the issue
equivalent over `description`); a `snippet: string` field on `SearchPageDto` /
`SearchIssueDto` in `packages/shared`; the ILIKE fallback path returns a plain
truncated window. Raise `RESULT_CAP` from 20 to a paginated `limit`/`offset`
with `total`/`hasMore` server-side (the MCP envelope already speaks that
shape). No schema change, no new index — `ts_headline` runs on the 20–50 rows
already selected. Mirror the change into the `search_pages`/`search_issues`
tool descriptions so agents know they no longer need the follow-up read.

**Effort:** **S** (a day, mostly tests). **Dependency risk:** **none** —
`ts_headline` is core Postgres, no extension. Watch: `ts_headline` re-parses
the document per row, so keep it behind the result cap and benchmark on a
256 KB page.

**Second, cheap half worth doing in the same pass:** extend the `Page`
`searchVector` concept to **comments**. A `Comment.searchVector` generated
column + GIN index + a `comments` group in `/search` makes the place decisions
actually get written findable. Effort **S–M**; one migration; same
`RequireScope` pattern.

---

### R2 — Close the org-wide memory hole (ROADMAP Phase 11 item 18)

**What it is.** Ship the three missing MCP tools — `list_workspace_pages`,
`get_workspace_page_graph`, `get_workspace_page_backlinks` — plus
`create_page`/`update_page` accepting a workspace scope, so the handbook /
runbook / ADR space is readable *and writable* by agents.

**Why it matters here.** This is the founder's hypothesis, in its true form. We
built the org-wide graph, shipped the UI for it, wrote it into VISION as "a
strictly bigger moat neither incumbent can follow into" — and then never gave
agents a door. Right now an agent's memory stops at the project boundary, which
is exactly where an org's most reusable knowledge (how we deploy, how we do
ADRs, what we decided last quarter) lives. It is also already scoped, planned,
authz-reasoned, and sitting at ⬜ in the roadmap; this is finishing work, not
new work.

**Concrete shape.** Purely `apps/mcp/src/tools/index.ts` — the REST endpoints,
DTOs, PAT scopes, and tenant-isolation tests all exist and ship. Same
compact/verbose/pagination envelope as the project tools; same
`pages:read`/`pages:write` scopes (ROADMAP states this explicitly — do **not**
mint a new scope pair). Add a `workspaceId`-aware traversal note to the tool
descriptions, and **fix the two stale descriptions in §3.3 in the same
commit** — telling agents links are project-scoped while shipping the
cross-project graph would waste the feature. Add the three new routes as rows
in `pat-scope-matrix.fixture.ts` and the isolation matrix.

**Effort:** **S–M**. **Dependency risk:** **none** — no new infra, no schema,
no service. The only risk is authz drift, and the acceptance criteria for it
are already written into ROADMAP item 18 (a two-workspace fixture proving a
`pages:read` PAT in workspace A never sees a workspace-B page via any of the
three tools).

---

### R3 — One-call, low-ceremony "record a learning" (`remember`-shaped write + append-safe context)

**What it is.** A single MCP write tool that takes a durable finding and files
it correctly: `record_decision`/`record_learning` (title, body, scope,
`relatedIssueKeys[]`, `relatedPageTitles[]`) → creates or appends to a page in
the right scope, injects the `[[wiki-links]]` and issue keys so the graph and
issue bridge populate automatically, returns the page ref + what it linked.
Plus: make the agent-context doc **append-safe** (an `append` mode or an
`ifUnmodifiedSince`/version guard) instead of blind full-replace.

**Why it matters here.** Today recording a learning *properly* is a multi-step
job an agent must design itself, while recording it *improperly* — blatting the
64 KB blob — is one call and is what our own handshake recommends. We built the
graph and then made the non-graph path the path of least resistance. This is
the fix for the founder's "they're not relying on our graph" in the write
direction: make the graph-populating write the cheapest write. It also
directly serves the AI-native pillar — no other tracker has a "write this down
so the next agent finds it" verb at the protocol layer.

**Concrete shape.** No schema change: it composes `create_page`/`update_page`
over the existing transactional `syncWikiLinks` + `syncIssueLinks`. The
resolution work is small and worth doing carefully — accept issue **keys** (not
ids; Pass-2 finding 4 notes the read surface speaks keys and the write surface
speaks ids), resolve unknown page titles into `unresolvedTitles` in the
response rather than failing, and echo `expectedProjectKey`-style scope
confirmation. Then **rewrite the server instructions** so the taught loop is
"recall from the graph → do the work → record the learning into the graph →
hand off a short pointer-style context doc", not "read and rewrite the blob."
Append-safety on `update_project_context` is a small DTO/service change plus a
409 on stale writes.

**Effort:** **M**. **Dependency risk:** **none** (pure composition). Design
risk is real though: this must not become a second, parallel way to make pages
that drifts from the canonical one — it should be a thin, opinionated wrapper,
and if it can't stay thin, ship the instruction rewrite alone (which is **S**
and captures a large share of the value).

---

### R4 — Put the relationships we already have into the graph (typed edges), read-side only

**What it is.** Extend the graph payload with the edges the tracker already
stores: issue↔issue typed links (BLOCKS/RELATES/DUPLICATES), parent↔child,
and page↔issue — each carrying a `type`. Add optional per-node degree so
"which pages are hubs / orphans" is answered by the graph call itself
(Pass-3 finding 4).

**Why it matters here.** The knowledge graph today knows one thing: which page
mentions which page. The system knows far more — this epic blocks that story,
that page documents this issue, this issue is a child of that one. Typed edges
are what make a graph *reasoned over* rather than *browsed*, and they are the
one idea from the memory-systems world (see §7) that translates cleanly into a
tracker, because a tracker's relationships are **already typed and already
curated by humans** — no inference, no model, no extraction step. It is also
the direct enabler of Phase 12 (Systems Map), which VISION explicitly plans to
build on this same primitive.

**Concrete shape.** Start **read-side only, no migration**: `PageGraphEdge`
gains `type: 'WIKI_LINK' | 'PAGE_ISSUE' | 'ISSUE_LINK' | 'PARENT'` and the
graph builder optionally unions in `IssueLink` / `Issue.parentId` /
`PageIssueLink` rows behind an `include` parameter (default off, so today's
payload and the web observatory are byte-compatible). A `type` column on
`PageLink` — for typed wiki-links like `[[Decision:: X]]` — is a **later,
separate** decision; don't bundle it. Respect `MAX_GRAPH_NODES`/`MAX_GRAPH_EDGES`
and keep the truncation-consistency contract Pass 3 verified. Web: the
observatory can color edges by type; the graph legend already exists.

**Effort:** **M** read-side / **L** if it drags in a `PageLink.type` migration
and editor grammar — hence the split. **Dependency risk:** **none**
infrastructurally; the real risk is payload growth, which the `include` flag
and existing caps contain.

---

### Not recommended now (but worth naming)

- **pgvector / semantic recall.** Genuinely useful eventually, and already
  planned under Phase 6 for dedupe. But it is *not* the bottleneck: our
  bottleneck is that lexical search doesn't return the text it already matched.
  Fix R1 first and re-measure. When we do add it: `pgvector` is a Postgres
  extension, so it stays one container — but embeddings need a model, and the
  only air-gap-safe answer is a local embedder (Ollama or an in-process ONNX
  model), which must be **optional with graceful degradation to FTS**, never a
  hard dependency. Anything that makes a self-hoster get an API key to search
  their own wiki violates advantage 2 ("your data, your compute").
- **`delete_page` orphan signal, `create_page` misfile guard,
  project-wide "what's blocked", cross-project issue move.** All real, all
  already filed from the QA passes; groomer's queue, not this document's.

---

## 6. What we deliberately reject

- **Do not build an ingestion/extraction pipeline.** The "turn documents into a
  graph with an LLM" step is the heart of a memory *framework* and the wrong
  shape for us: it requires a mandatory LLM call on every write (see §7),
  produces machine-inferred nodes nobody curates, and would compete with the
  human-authored `[[wiki-link]]` graph that is our actual differentiator. Our
  edges are **declared, not inferred** — that's a feature. Keep it.
- **Do not add a second graph store.** Our graph is ~2 tables and a
  recursive-free query, capped at 1000 nodes / 5000 edges, and it answers every
  question measured in ≤ 1 call. A dedicated graph database (or an embedded
  one) buys us nothing at this scale and costs us the one-command install.
- **Do not add a Python service.** Any adoption of an external memory library
  means a second runtime, a second dependency tree, and a second thing to
  secure and upgrade, for capabilities we can express in ~200 lines of
  NestJS over data we already own.
- **Do not make any LLM mandatory anywhere.** Every recommendation above works
  with zero models configured. That is the whole point of "private, unlimited,
  $0."
- **Do not build a "memory" feature that is separate from Pages and Issues.**
  The thesis is that the tracker *is* the memory. A parallel `Memory` entity
  would immediately go stale, would need its own permissions, and would break
  the one property that makes this credible: humans and agents writing into the
  same store, seeing the same truth.
- **Do not adopt the "flat handoff blob" pattern further.** It's already the
  wrong centre of gravity (§4.2). Shrink its role to a pointer document, don't
  grow it.

---

## 7. What we learned from looking at cognee

Short by design — cognee is a reference point, not a template. Read at
**v1.4.0, Apache-2.0**, from source (`pyproject.toml`,
`cognee/api/v1/cognify/cognify.py`,
`cognee/infrastructure/databases/graph/config.py`,
`cognee/infrastructure/llm/config.py`, `cognee-mcp/src/server.py`).

**The three ideas worth internalising:**

1. **Memory has verbs, and they're few.** Their entire agent-facing API is
   `remember` / `recall` / `forget` / `improve`. Their MCP server exposes ~20
   tools against our 121. The lesson isn't "have fewer tools" — our breadth is
   an asset — it's that **the memory loop needs one obvious verb in each
   direction**, and ours currently has an obvious *write* verb pointing at the
   wrong place and no obvious *recall* verb at all. That's R3 and R1.
2. **Retrieval is hybrid by default, and it returns *text*.** Their default
   recall path finds relevant graph triplets by similarity and then resolves
   those edges **into human-readable text** before answering. Whatever the
   retrieval mechanism, the contract is: a recall call returns something you can
   read, not a list of identifiers. Our recall returns identifiers. That's the
   sharpest single indictment their design levels at ours, and it needs no
   vectors to fix — that's R1.
3. **Typed relationships and time are first-class.** Their graph model is
   nodes with a `type` plus typed edges, with an optional ontology to ground
   the vocabulary, and a separate temporal pipeline that extracts events with
   timestamps. We get both cheaply and *better*: our relationship types are
   human-declared domain facts (BLOCKS, parent-of, documents) rather than
   LLM-extracted guesses, and our temporality is exact (page versions,
   ActivityLog) rather than inferred. We just don't surface either in the
   graph. That's R4 and §4.4.

**What their code says about the constraints the founder asked about:**

| Question | Answer from source |
|---|---|
| Separate graph DB required? | **No.** Default `graph_database_provider = "ladybug"` (their embedded, in-process Kuzu-lineage store — a core dependency, not a service). A Postgres graph backend exists, as do Neo4j/Neptune as optional extras. So "one Postgres" is achievable — but it's *their* Postgres schema, not ours. |
| Mandatory LLM? | **Yes for building the graph.** The default cognify pipeline is `classify_documents → chunk → extract_graph_and_summarize → add_data_points`, and the middle step is an LLM call by construction. Defaults are `llm_provider = "openai"`, `llm_model = "openai/gpt-5-mini"`, `embedding_model = "openai/text-embedding-3-large"`, and `openai` is a **core, non-optional dependency**. Local inference *is* supported (LiteLLM routing, a first-class `ollama` provider with endpoint validation, `llama-cpp` and `fastembed` extras) — but there is no "no model" mode. Nothing can enter the memory without inference. **For us that is disqualifying as a dependency and instructive as a contrast:** our graph populates with zero inference. |
| Licence? | **Apache-2.0.** Permissive and compatible with shipping alongside MIT, but not with vendoring code into an MIT tree without carrying the Apache notice — a mixed-licence repo we don't want. Moot anyway: we're not taking code. |
| Runtime fit? | Python 3.10–3.14, FastAPI + SQLAlchemy + LiteLLM + LanceDB + NetworkX. Adopting it means a second runtime in `docker compose`. Rejected (§6). |

**The honest compliment:** they've thought harder than we have about what an
agent *asks* memory for. **The honest counter:** they have to build a graph
from unstructured text with a model because they start with a pile of
documents. We start with a database where a team has already declared the
entities and the relationships, by hand, as part of their day job — and kept
them current because their work depends on it. That is a better substrate than
anything extraction can produce. We just have not finished wiring an agent to
it.

---

## 8. Method / reproducibility

- Repo read at `e9c9be1` (`main`, 2026-07-30). Files cited inline; MCP tool
  counts from `grep -c "group: 'read'" / "group: 'write'"` on
  `apps/mcp/src/tools/index.ts` → 58 / 63.
- Agent-experience numbers (bytes-per-answer, calls-per-question, open
  findings) are quoted from `docs/MCP-QA.md` Passes 1–3 and the 2026-07-06
  spot-check, produced by the `mcp-consumer-qa` agent driving the real stdio
  MCP server. They are not re-measured here.
- cognee facts are from files fetched over HTTPS from
  `raw.githubusercontent.com/topoteretes/cognee/main/…` on 2026-07-30 (README,
  `pyproject.toml`, `LICENSE`, and the source paths listed in §7). GitHub's
  HTML site and PyPI were also reachable; the raw source is the citation of
  record. Nothing in §7 is from recollection.

## 9. Roadmap / backlog linkage

This document proposes; it does not tick anything. For the groomer:

- **R2 is ROADMAP Phase 11 item 18** (`docs/ROADMAP.md`, still ⬜) — no new
  entry needed, and it should be re-read as *the* answer to the founder's
  hypothesis rather than a tail-end slice.
- **R1, R3, R4** are new and belong in `docs/BACKLOG.md`; R1 additionally
  strengthens the "Search & query power" scorecard row and R4 is the
  prerequisite primitive VISION already assigns to Phase 12 (Systems Map).
- The two stale MCP descriptions in §3.3 are defects, not features — they
  should ride along with R2's commit.
