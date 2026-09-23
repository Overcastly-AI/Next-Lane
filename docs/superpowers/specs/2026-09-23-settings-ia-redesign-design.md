# Settings IA redesign — one shell, four scopes, nothing homeless

**Date:** 2026-09-23
**Status:** approved (founder: "all the above" → level B → "just go")
**Founder report:** *"Can we redesign the way settings are handled. It feels like they are all over the place."*

## Correction log

The first draft of this spec was written from memory and got three things
wrong. They are recorded rather than quietly deleted, because each one would
have sent the implementation somewhere useless:

1. It called workspace settings an orphaned "tab strip" and proposed folding
   `/workspaces/:id/members` into the settings page. In fact
   `WorkspaceSettingsNav` already renders a shared nav across four routes
   (General / Members / Audit log / Branding). That surface is the one that
   got this right — it is the **model**, not the patient.
2. It claimed `/developers` hosts an MCP config generator to be re-homed into
   personal settings, and that Agent access and Agent context had been
   promoted to a project "Agents" tab. Neither is true **of `main`**:
   `/developers` is `ApiDocsPage`, the in-product API reference, already
   cross-linked both ways with `/me/settings`; and
   `components/project/projectViews.ts`, the single source of truth for
   project views, lists eleven, none of them Agents.

   Both, however, are true of **PR #103** (`feat/agent-native-discoverability`,
   open), which adds an MCP config generator leading `/developers` and
   promotes Agents to a top-level project tab at `/projects/:id/agents`,
   leaving a one-line pointer in settings. The first draft was describing
   that branch's world as though it had already landed. The intent was right;
   the tense was wrong. See **Dependency on PR #103** below.

## The problem, measured

| Where | Route(s) | Shape |
|---|---|---|
| Project | `/projects/:id/settings` | **909 lines, 19 sections, one unnavigable scroll** |
| Workspace | `/workspaces/:id/{settings,members,audit-log,branding}` | four routes behind one shared nav |
| Instance | `/admin/sso` (`/admin` redirects to it) | one bare page |
| Personal | `/me/settings` | one page, two sections |

The 19 sections of project settings, in render order: Details, Members,
Columns, Labels, Components, Issue templates, Page templates, Versions,
Custom fields, Workflow, Workflows, Webhooks, GitHub, GitLab, Gitea, Agent
context, Agent access, Share, Danger zone.

The founder named all four frictions at once — *can't find it*, *junk
drawer*, *why is this here and not there*, *every screen behaves
differently* — and the measurement says the first two are almost entirely
**one page**. There is no navigation of any kind within project settings:
finding "Gitea" means scrolling past fifteen other things, and the only
reason the workspace scope doesn't feel that way is that somebody already
built `WorkspaceSettingsNav` for it.

The fourth friction is real and separate: four scopes, four different
layouts, because the workspace pattern was never generalised.

## Approach chosen

**Generalise the pattern that already works.** Extract the shape behind
`WorkspaceSettingsNav` into one shared `SettingsLayout`, and put all four
scopes on it — project settings first, because that is where the damage is.

Each settings group becomes its own route with its own rail entry. Small
screens; deep links; a URL you can send someone.

**Rejected: one `/settings` app with a scope switcher.** This repo has
already run that experiment in both directions and been burned each time —
#80 pulled Branding and SSO *out* of the main nav because once-a-year config
was holding permanent space beside the board, and the change before it had
pushed them *in* for discoverability. Consistency does not require one
route; it requires one shell.

**Rejected: a rail that only scroll-spies the existing 19-section page.**
It is the cheap version — zero e2e churn, because every section stays
mounted — and it does not fix the problem. A 19-section scroll with a
jump-list is still a 19-section scroll, and the junk-drawer complaint
survives intact.

**Rejected: task-oriented ("Invite someone", "Connect a repo").** Best
findability for a newcomer, but it punishes people who already know where
things live, does not scale past ~30 settings, and drifts out of honesty as
features land. The audience is technical self-hosters who learn the model
once.

## The shell

One `SettingsLayout` in `apps/web/src/components/settings/`, used by every
settings surface:

- **Grouped left rail** — groups with headings, active state, keyboard
  navigable, each entry a real route.
- **Consistent section frame** — one heading treatment, one description
  slot, one save/dirty affordance. Today each section invents its own.
- **Responsive** — the rail collapses to a `<select>` at small widths, the
  way the existing nav patterns collapse, and must work at 393px.
- **Derived from existing tokens and `src/components/ui/*`.** No parallel
  visual language.

`WorkspaceSettingsNav`'s four links become `SettingsLayout` rail entries;
the component is deleted once its callers move.

## Grouping

**Project** — `/projects/:id/settings/:group`, `…/settings` redirects to
`…/settings/general`

| Group | Route segment | Sections |
|---|---|---|
| General | `general` | Details, Share, Danger zone |
| People | `people` | Members |
| Work structure | `work` | Columns, Labels, Components, Versions, Custom fields, Workflow, Workflows |
| Templates | `templates` | Issue templates, Page templates |
| Integrations | `integrations` | GitHub, GitLab, Gitea, Webhooks |
| Agents | `agents` | Agent context, Agent access |

**Workspace** — routes unchanged (`settings`, `members`, `audit-log`,
`branding`); they move onto `SettingsLayout` with groups General / People /
Appearance / Audit.

**Personal** — `/me/settings` on the shell, rail entries Notifications and
API tokens. Two entries is a thin rail, and it is still worth it: the shell
is what makes the four scopes feel like one product. `/developers` stays
where it is and keeps its existing cross-link.

**Instance** — `/admin` becomes a real hub on the shell with one rail entry,
Authentication; `/admin/sso` redirects to it.

## What is deliberately not moved

- **Workspace members** keeps `/workspaces/:id/members`. It is already a
  first-class entry in a shared nav — exactly the target pattern.
- **`/developers`** stays a top-level API reference. It is documentation,
  not configuration.
- **Agent access / Agent context** — see **Dependency on PR #103**. They are
  in project settings on `main` and leave it when that PR lands.

## Dependency on PR #103

PR #103 moves Agent access and Agent context out of project settings onto a
new top-level **Agents** tab, on the reasoning — which this spec agrees with —
that they are a daily surface, not configuration. That PR is older than this
work, already reviewed, and its only red check is one real skip-link
regression being root-caused separately.

So the **Agents** settings group in the grouping table below exists only for
as long as `main` still renders those sections in settings:

- **If #103 lands first** (preferred), project settings ships with **five**
  groups — General, People, Work structure, Templates, Integrations — and no
  Agents group, because there is nothing left in settings to put in one.
- **If this work lands first**, it ships the Agents group as described, and
  #103's merge deletes it along with the sections it held.

Either way the outcome is the same and neither branch is blocked on the other.
What must not happen is the two landing with *different* answers — Agents
reachable from a settings group **and** a nav tab, each thinking it owns the
sections. Whoever merges second reconciles to: Agents is a tab, not a settings
group.

## Blast radius

Splitting project settings into sub-routes breaks every e2e spec that lands
on `/projects/:id/settings` and expects a section to be mounted: **22 spec
files, ~40 navigation sites**. This is the real cost of the redesign and it
is paid in the same commit as the split — a spec left pointing at a URL that
no longer renders its section is a red build, not a follow-up.

`/projects/:id/settings` itself keeps working (it redirects), so deep links
in docs, the README and MCP output do not rot.

## Sequencing

1. **`SettingsLayout` + project settings split.** The whole of the damage
   and the whole of the e2e churn, in one slice, because a half-split
   settings page is worse than either end state.
2. **Workspace settings onto the shell.** Routes unchanged; delete
   `WorkspaceSettingsNav`.
3. **Personal + instance hub onto the shell.**

Each slice ships independently and leaves the app coherent.

## Done when

- All four scopes render `SettingsLayout`; no surface keeps a bespoke layout.
- No settings screen requires scrolling past an unrelated section to reach
  the one you want.
- `/projects/:id/settings`, `/admin` and `/admin/sso` still resolve, verified
  by a test rather than by hand.
- Every `data-testid`, role, `aria-label` and e2e-asserted string preserved —
  this is an IA change, not a rewrite of the sections themselves.
- e2e green desktop **and** mobile (393px).
