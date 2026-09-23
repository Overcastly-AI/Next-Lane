# Settings IA redesign — one shell, four doors, nothing homeless

**Date:** 2026-09-23
**Status:** approved (founder: "all the above" → level B → "just go")
**Founder report:** *"Can we redesign the way settings are handled. It feels like they are all over the place."*

## The problem, measured

Settings live in five places, each with a different organising pattern:

| Where | Route | Shape |
|---|---|---|
| Project | `/projects/:id/settings` | **909 lines, 15 sections**, one scroll |
| Workspace | `/workspaces/:id/settings` | tab strip + doc templates + danger zone |
| Workspace members | `/workspaces/:id/members` | **a separate route** from the settings governing it |
| Instance | `/admin/sso` (`/admin` redirects) | single bare page |
| Personal | `/me/settings` + `/developers` | split across two routes |

The founder named all four frictions at once: *can't find it*, *junk drawer*, *why is this here and not there*, *every screen behaves differently*. They are one problem — nobody ever designed this layer; it accreted, and things have migrated back and forth ever since (SSO out of the nav in #80, Branding back into a tab strip, Agent access out of the Settings basement last week).

The sprawl tangles two independent axes: **scope** (personal → project → workspace → instance) and **kind** (people & access, work structure, integrations, templates, appearance, danger). Navigation follows neither consistently.

## Approach chosen

**Scope-local entry points, one shared shell.** Settings stay adjacent to the thing they configure. Every surface renders the same `SettingsLayout`: a grouped left rail, consistent section patterns, and a search that spans all scopes. Individual settings are re-homed where they are misplaced, with redirects.

**Rejected: one `/settings` app with a scope switcher.** This repo has already run that experiment in both directions and been burned each time — #80 pulled Branding and SSO *out* of the main nav because once-a-year config was holding permanent space beside the board, and the change before it had pushed them *in* for discoverability. Moving all config into a separate app is the same trade in a new coat. Consistency does not require one route; it requires one shell.

**Rejected: task-oriented ("Invite someone", "Connect a repo").** Best findability for a newcomer, but it punishes people who already know where things live, does not scale past ~30 settings, and drifts out of honesty as features land. The audience is technical self-hosters who will learn the model once.

## The shell

One `SettingsLayout` in `apps/web/src/components/settings/`, used by every settings surface:

- **Grouped left rail** — sections under group headings, active state, keyboard navigable. Replaces the 909-line scroll.
- **Consistent section frame** — one heading treatment, one description slot, one save/dirty affordance. Today each section invents its own.
- **Search** — filters across *every* scope, not just the current one, and can jump you to another scope's setting. This is the piece that actually fixes findability; a menu tree never will.
- **Responsive** — rail collapses to a select/drawer at 393px, as the existing nav patterns do.

Derive from existing tokens and `src/components/ui/*`. No parallel visual language.

## Grouping

**Project** (`/projects/:id/settings`)
- General — details, archive
- People & access — members, per-project role overrides
- Work structure — columns/statuses, workflow, labels, custom fields, components, versions
- Integrations — GitHub, GitLab, Gitea, webhooks
- Templates — page templates, issue templates
- Danger zone

**Workspace** (`/workspaces/:id/settings`)
- General — name, slug
- People & access — **members (folded in from its own route)**, roles
- Appearance — branding
- Templates — doc templates
- Audit log
- Danger zone

**Instance** (`/admin`)
- Authentication — SSO / OIDC / SAML

**Personal** (`/me/settings`)
- Profile
- Notifications
- **API tokens & agents — tokens and the MCP config generator together** (today split between `/me/settings` and `/developers`, though they are one task)

## Re-homing map

| Setting | From | To | Why |
|---|---|---|---|
| Workspace members | `/workspaces/:id/members` | section of workspace settings | A separate route from the settings that govern it is the clearest instance of "why is this here and not there" |
| MCP config generator | `/developers` | Personal → API tokens & agents | Minting a token and configuring the client that uses it are one task, currently two routes |
| SSO/OIDC | `/admin/sso` | `/admin` → Authentication | `/admin` already redirects to it; make the hub real so instance settings have somewhere to grow |

**Every old route redirects.** `/workspaces/:id/members`, `/developers` and `/admin/sso` are in `docs-site`, the README and e2e assertions. Redirects are not optional politeness — they are the escape hatch if a placement turns out wrong.

**Explicitly NOT moved:** Agent access and Agent context stay on the project **Agents** tab. They were promoted out of the Settings basement last week for good reason — they are a daily surface, not configuration. Recorded here so nobody re-buries them in a future tidy-up.

## Sequencing

1. **Shell + project settings.** The 909-line page is the worst offender and proves the pattern.
2. **Workspace + members fold-in.** The re-homing with the clearest payoff.
3. **Personal + `/developers` + instance hub.** Smaller surfaces onto the same shell.
4. **Cross-scope search.** Last, because it indexes whatever the previous three produced.

Each slice ships independently and leaves the app coherent.

## Done when

- All four surfaces render the same shell; no surface keeps a bespoke layout.
- The project settings scroll is replaced by grouped navigation.
- Every re-homed route redirects, verified by a test rather than by hand.
- Search finds a setting in any scope from any scope.
- `data-testid` / role / `aria-label` / e2e-asserted strings preserved — this is an IA change, not a rewrite.
- e2e green desktop **and** mobile; `docs-site` references updated for anything whose canonical URL changed.
