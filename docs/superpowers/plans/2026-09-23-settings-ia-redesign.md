# Settings IA redesign — Phase 1 implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace project settings' single 19-section scroll with six grouped routes behind one shared `SettingsLayout`, which the workspace, personal and instance scopes adopt in later phases.

**Architecture:** `settingsGroups.ts` is the single source of truth for the project's settings groups (the same pattern `components/project/projectViews.ts` already establishes for project views). `SettingsLayout` renders a grouped rail plus an `<Outlet />`; `SettingsPage` becomes a thin layout route that fetches the project once and hands everything to its children through a typed outlet context. Each group is a small page that composes existing `components/settings/*` sections — the sections themselves are not rewritten.

**Tech Stack:** React 18, react-router-dom v6 (nested routes + `useOutletContext`), TanStack Query, Tailwind, Vitest (node environment, pure logic only), Playwright.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-09-23-settings-ia-redesign-design.md`. Read it first.
- **This is an IA change, not a rewrite.** Every `data-testid`, `role`, `aria-label`, element `id` (`#settings-name`, `#webhook-url`, `#cf-name`) and e2e-asserted string inside the existing section components is preserved exactly. Moving a section between files must not change one character of its JSX.
- **`<h1>Settings</h1>` renders on every project settings group route.** Fourteen e2e call sites assert `getByRole('heading', { name: /settings/i })` (some with `level: 1`, some `/^settings$/i`) purely as a "the page loaded" gate. `SettingsLayout` owning that `h1` keeps all of them passing.
- **Vitest only runs `src/**/*.test.ts` in the `node` environment.** `.test.tsx` files are silently not collected. Do NOT write React component tests — component and flow coverage is Playwright's job in this repo. Only `settingsGroups.ts` gets a vitest file.
- **UI work MUST invoke the `frontend-design` skill** (CLAUDE.md). That applies to Task 4.
- **Fonts self-hosted, responsive to 393px, visible keyboard focus, `prefers-reduced-motion` honoured, WCAG-AA contrast.**
- **Definition of done** (CLAUDE.md): builds + typecheck + unit/e2e green desktop AND mobile + `docs/ROADMAP.md` and `docs/BACKLOG.md` updated in the same commit + committed and pushed.

### Environment recipe (follow exactly — each line is a bug someone already hit)

```bash
# 1. shared must be built before anything typechecks against it
pnpm --filter @next-lane/shared build

# 2. api: stale tsbuildinfo makes `nest build` exit 0 and emit nothing
cd apps/api && rm -rf dist *.tsbuildinfo && pnpm build

# 3. start the API in its OWN Bash call. It reads API_PORT, not PORT.
API_PORT=4000 RATE_LIMIT_DISABLED=true node apps/api/dist/main.js

# 4. Playwright. PW_API_URL points the request fixture; VITE_API_URL only the
#    browser bundle. The sandbox Chromium is older than the pinned Playwright.
PW_CHROMIUM_PATH=/opt/pw-browsers/chromium PW_API_URL=http://localhost:4000 \
  pnpm --filter @next-lane/web exec playwright test <spec>
```

Base URL is `http://localhost:3000` — never `127.0.0.1` (the API's CORS allowlist). Never run a bare `pkill -f 'dist/main.js'`: it matches sibling agents' processes and the harness shell itself. Use `pkill -9 -f 'dist/main[.]js'` only after checking `ps aux | grep 'dist/main[.]js'`, and kill by PID if anything there isn't yours.

---

### Task 1: `settingsGroups.ts` — one definition of the project's settings groups

**Files:**
- Create: `apps/web/src/components/settings/settingsGroups.ts`
- Test: `apps/web/src/components/settings/settingsGroups.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface SettingsGroup { to: string; label: string; description: string }`, `const PROJECT_SETTINGS_GROUPS: readonly SettingsGroup[]`, `const DEFAULT_PROJECT_SETTINGS_GROUP: string` (`'general'`). Tasks 4, 5 and 6 import these.

- [ ] **Step 1: Write the failing test**

`apps/web/src/components/settings/settingsGroups.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROJECT_SETTINGS_GROUP,
  PROJECT_SETTINGS_GROUPS,
} from './settingsGroups';

describe('PROJECT_SETTINGS_GROUPS', () => {
  it('covers the six groups the spec defines', () => {
    expect(PROJECT_SETTINGS_GROUPS.map((g) => g.to)).toEqual([
      'general',
      'people',
      'work',
      'templates',
      'integrations',
      'agents',
    ]);
  });

  it('has a unique route segment per group', () => {
    const segments = PROJECT_SETTINGS_GROUPS.map((g) => g.to);
    expect(new Set(segments).size).toBe(segments.length);
  });

  it('gives every group a label and a description for the rail', () => {
    for (const group of PROJECT_SETTINGS_GROUPS) {
      expect(group.label.length).toBeGreaterThan(0);
      expect(group.description.length).toBeGreaterThan(0);
    }
  });

  // The default is what `/projects/:id/settings` redirects to. If it ever
  // named a group that does not exist, that redirect would 404 into the
  // catch-all route and the old URL — which is in docs, the README and MCP
  // output — would silently stop working.
  it('defaults to a group that exists', () => {
    expect(PROJECT_SETTINGS_GROUPS.map((g) => g.to)).toContain(
      DEFAULT_PROJECT_SETTINGS_GROUP,
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @next-lane/web exec vitest run src/components/settings/settingsGroups.test.ts
```

Expected: FAIL — `Failed to resolve import "./settingsGroups"`.

- [ ] **Step 3: Write the module**

`apps/web/src/components/settings/settingsGroups.ts`:

```ts
/**
 * The canonical list of a project's settings groups — ONE list, consumed by
 * the rail, the routes and the e2e suite.
 *
 * It exists for the same reason `components/project/projectViews.ts` does: the
 * app used to disagree with itself about what it contained. Project settings
 * was nineteen sections in one unnavigable scroll with no list anywhere, so
 * "which settings does a project have" had no answer you could read — only a
 * 909-line file you could scroll. Adding a settings section now means adding
 * it to one group here.
 */
export interface SettingsGroup {
  /** Route segment under `/projects/:id/settings/`. */
  to: string;
  /** Rail label and the group page's section heading. */
  label: string;
  /** One line under the label, explaining what lives in the group. */
  description: string;
}

export const PROJECT_SETTINGS_GROUPS: readonly SettingsGroup[] = [
  {
    to: 'general',
    label: 'General',
    description: 'Name, description, sharing and archiving.',
  },
  {
    to: 'people',
    label: 'People',
    description: 'Who can see and change this project.',
  },
  {
    to: 'work',
    label: 'Work structure',
    description: 'Columns, labels, components, versions, fields and workflow.',
  },
  {
    to: 'templates',
    label: 'Templates',
    description: 'Starting points for new issues and pages.',
  },
  {
    to: 'integrations',
    label: 'Integrations',
    description: 'GitHub, GitLab, Gitea and outgoing webhooks.',
  },
  {
    to: 'agents',
    label: 'Agents',
    description: 'What AI agents can read and change here.',
  },
];

/**
 * Where a bare `/projects/:id/settings` lands. That URL is in the docs site,
 * the README, MCP output and every existing deep link, so it redirects here
 * rather than 404ing.
 */
export const DEFAULT_PROJECT_SETTINGS_GROUP = 'general';
```

- [ ] **Step 4: Run it and watch it pass**

```bash
pnpm --filter @next-lane/web exec vitest run src/components/settings/settingsGroups.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/settings/settingsGroups.ts \
        apps/web/src/components/settings/settingsGroups.test.ts
git commit -m "feat(settings): define the project settings groups in one place"
```

---

### Task 2: `SettingsSection` — the shared section frame

Today every settings section invents its own card. `SettingsPage.tsx` has a private `Section` helper (line 226) using `border-slate-200`; `WorkspaceSettingsPage.tsx` writes the card inline with `border-ink-200`; several `components/settings/*` files write their own again. One frame, exported, is what makes four scopes look like one product.

**Files:**
- Create: `apps/web/src/components/settings/SettingsSection.tsx`

**Interfaces:**
- Consumes: `cn` from `@/lib/cn`.
- Produces: `SettingsSection({ title, description, action, children, id, 'data-testid': testId })` — a `<section>` with `aria-labelledby` wired to its `<h2>`. Tasks 3 and 5 import it.

- [ ] **Step 1: Write the component**

`apps/web/src/components/settings/SettingsSection.tsx`:

```tsx
import { useId } from 'react';
import { cn } from '@/lib/cn';

export interface SettingsSectionProps {
  title: string;
  description?: string;
  /** Right-aligned control in the header — usually an "Add…" button. */
  action?: React.ReactNode;
  children: React.ReactNode;
  /** Extra classes for the rare section that needs a different border. */
  className?: string;
  'data-testid'?: string;
}

/**
 * The one card every settings section sits in, across every scope.
 *
 * The heading is wired to the section through `aria-labelledby` rather than
 * left as a loose `<h2>`: with a rail of six groups, a screen-reader user
 * landing mid-page needs the region to announce which setting they are in.
 */
export function SettingsSection({
  title,
  description,
  action,
  children,
  className,
  'data-testid': testId,
}: SettingsSectionProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      data-testid={testId}
      className={cn(
        'rounded-xl border border-ink-200 bg-surface p-4 shadow-card sm:p-5',
        className,
      )}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 id={headingId} className="text-sm font-semibold text-ink-900">
            {title}
          </h2>
          {description && (
            <p className="mt-0.5 text-xs text-ink-500">{description}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @next-lane/shared build && pnpm --filter @next-lane/web exec tsc --noEmit
```

Expected: no errors. (Unused-export is not a tsc error; the component is consumed in Task 3.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/settings/SettingsSection.tsx
git commit -m "feat(settings): add the shared section frame"
```

---

### Task 3: Extract the four inline sections out of `SettingsPage.tsx`

`SettingsPage.tsx` is 909 lines because four sections are defined inside it. They must become files before the page can be split. **This task changes no behaviour and no markup** — it is a move, and the existing e2e suite passing unchanged is the proof.

**Files:**
- Create: `apps/web/src/components/settings/ProjectDetailsSection.tsx` (from `SettingsPage.tsx:255-340`, `DetailsSection`)
- Create: `apps/web/src/components/settings/ColumnsSection.tsx` (from `SettingsPage.tsx:341-511`, `ColumnsSection`, plus the `CATEGORY_LABEL` and `CATEGORY_DOT` maps at lines 42-54 and the `IconButton` helper at 858-889)
- Create: `apps/web/src/components/settings/LabelsSection.tsx` (from `SettingsPage.tsx:512-777`, `EditLabelForm` + `LabelsSection`, plus the `SWATCHES` array at lines 55-66)
- Create: `apps/web/src/components/settings/ProjectDangerZone.tsx` (from `SettingsPage.tsx:778-857`, `DangerZone`)
- Modify: `apps/web/src/pages/SettingsPage.tsx` — delete the moved code, import the four new components, replace the private `Section` helper with `SettingsSection` from Task 2.

**Interfaces:**
- Consumes: `SettingsSection` (Task 2).
- Produces, for Task 5:
  - `ProjectDetailsSection({ projectId: string; projectKey: string; name: string; description: string | null; editable: boolean })`
  - `ColumnsSection({ projectId: string; editable: boolean; isAdmin: boolean })`
  - `LabelsSection({ projectId: string; editable: boolean; isAdmin: boolean })`
  - `ProjectDangerZone({ projectId: string; projectName: string; archived: boolean; isAdmin: boolean })`

  Read the exact prop types off the current definitions and keep them — do not retype them from this list if it disagrees with the source.

- [ ] **Step 1: Record the green baseline before touching anything**

```bash
PW_CHROMIUM_PATH=/opt/pw-browsers/chromium PW_API_URL=http://localhost:4000 \
  pnpm --filter @next-lane/web exec playwright test \
  settings-robustness board-columns label-rename share-link --reporter=line
```

Expected: PASS. Write the pass count down — Step 4 must match it exactly.

- [ ] **Step 2: Move the code**

Cut each block into its new file. Add the imports it needs (each new file imports only what its own block references). Export the component. Change nothing inside the JSX — same `data-testid`s, same element `id`s (`#settings-name`, `#settings-description`), same class strings.

Where a moved block used the private `Section` helper, import `SettingsSection` from `./SettingsSection` and rename the usage. `Section` used `border-slate-200`, `SettingsSection` uses `border-ink-200`; that is the intended convergence, and it is a token swap, not a structural change.

- [ ] **Step 3: Rewrite `SettingsPage.tsx`'s body to import them**

Delete the moved definitions and the private `Section` helper. The page's render tree keeps all 19 sections in the same order — the split into groups is Task 5, not this task.

- [ ] **Step 4: Prove nothing moved but the code**

```bash
pnpm --filter @next-lane/web exec tsc --noEmit
pnpm --filter @next-lane/web exec vitest run
PW_CHROMIUM_PATH=/opt/pw-browsers/chromium PW_API_URL=http://localhost:4000 \
  pnpm --filter @next-lane/web exec playwright test \
  settings-robustness board-columns label-rename share-link --reporter=line
```

Expected: typecheck clean, vitest green, and the **same pass count** as Step 1. A different count means the move changed behaviour — find out why before continuing; do not proceed on "probably fine".

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/settings/ProjectDetailsSection.tsx \
        apps/web/src/components/settings/ColumnsSection.tsx \
        apps/web/src/components/settings/LabelsSection.tsx \
        apps/web/src/components/settings/ProjectDangerZone.tsx \
        apps/web/src/pages/SettingsPage.tsx
git commit -m "refactor(settings): extract the four inline project settings sections"
```

---

### Task 4: `SettingsLayout` — the shell

**REQUIRED SKILL: `frontend-design`.** This is the one genuinely new visual surface in the plan. Invoke the skill before writing the component; derive from the existing tokens and `src/components/ui/*` rather than introducing a parallel visual language.

**Files:**
- Create: `apps/web/src/components/settings/SettingsLayout.tsx`

**Interfaces:**
- Consumes: `SettingsGroup` (Task 1), `cn` from `@/lib/cn`, `NavLink`/`useNavigate`/`useLocation` from `react-router-dom`.
- Produces: `SettingsLayout({ groups, basePath, title, description, children })`. Task 5 wraps the project settings outlet in it; Phases 2 and 3 reuse it for the workspace, personal and instance scopes, which is why `groups` and `basePath` are props rather than hard-coded.

```ts
export interface SettingsLayoutProps {
  /** Rail entries, in order. */
  groups: readonly SettingsGroup[];
  /** Prefix each group's `to` is appended to, no trailing slash. */
  basePath: string;
  /** The `h1`. Keep it "Settings" for the project scope — see below. */
  title: string;
  description?: string;
  children: React.ReactNode;
}
```

Requirements the component must satisfy:

- Renders `<h1>{title}</h1>`. **The project scope passes `title="Settings"`** — fourteen e2e call sites gate on that heading.
- Rail is a `<nav aria-label="Settings navigation" data-testid="settings-rail">` of `NavLink`s to `` `${basePath}/${group.to}` ``, each carrying `data-testid={`settings-rail-${group.to}`}` and rendering the group's `label` with its `description` underneath.
- Active entry marked visually **and** with `aria-current="page"` — `NavLink` supplies the latter; do not suppress it.
- Keyboard navigable with a visible `focus-visible` ring; no `focus:outline-none` without a `focus-visible` fallback.
- **Below `md`** the rail collapses to a labelled `<select data-testid="settings-rail-select">` whose `onChange` navigates to the chosen group. A rail of six descriptions eats the whole viewport at 393px. Give the select a visible `<label>` or an `aria-label`; an unlabelled select is the accessibility bug this redesign is supposed to remove, not add.
- Honours `prefers-reduced-motion` on any transition.
- Content column is `max-w-3xl` — matching what the settings surfaces already use — and the sections stack with `gap-6`.

- [ ] **Step 1: Invoke the `frontend-design` skill and write the component**

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @next-lane/shared build && pnpm --filter @next-lane/web exec tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/settings/SettingsLayout.tsx
git commit -m "feat(settings): add the shared settings shell"
```

---

### Task 5: Split project settings into six group routes

The big one, and it is atomic on purpose: the moment `/projects/:id/settings` stops mounting all 19 sections, 56 e2e call sites need their new URL. Splitting in one commit and migrating in another means shipping a red build in between.

**Files:**
- Create: `apps/web/src/pages/settings/ProjectSettingsGeneral.tsx`
- Create: `apps/web/src/pages/settings/ProjectSettingsPeople.tsx`
- Create: `apps/web/src/pages/settings/ProjectSettingsWork.tsx`
- Create: `apps/web/src/pages/settings/ProjectSettingsTemplates.tsx`
- Create: `apps/web/src/pages/settings/ProjectSettingsIntegrations.tsx`
- Create: `apps/web/src/pages/settings/ProjectSettingsAgents.tsx`
- Create: `apps/web/src/pages/settings/projectSettingsContext.ts`
- Modify: `apps/web/src/pages/SettingsPage.tsx` — becomes the layout route
- Modify: `apps/web/src/App.tsx:287` — the one `<Route path="settings">` becomes a nested block
- Modify: 22 e2e spec files (see the migration table)

**Interfaces:**
- Consumes: `PROJECT_SETTINGS_GROUPS`, `DEFAULT_PROJECT_SETTINGS_GROUP` (Task 1); `SettingsLayout` (Task 4); the four extracted sections (Task 3) and the existing `components/settings/*` sections.
- Produces: `useProjectSettings(): ProjectSettingsContext` — how each group page gets its data.

- [ ] **Step 1: Write the outlet context**

`apps/web/src/pages/settings/projectSettingsContext.ts`:

```ts
import { useOutletContext } from 'react-router-dom';
import type { Role, StatusDto } from '@next-lane/shared';

/**
 * What the settings layout route fetches once and every group page reads.
 *
 * It is an outlet context rather than six pages each running their own
 * `useProject`/`useMyRole`/`useStatuses` because the rail makes switching
 * groups a route change: per-page fetching would re-suspend the whole screen
 * on every rail click, which is exactly the "it feels slow and jumpy" the
 * redesign is meant to remove.
 */
export interface ProjectSettingsContext {
  projectId: string;
  /** The project, guaranteed loaded — the layout renders its own loading and
   *  error states and only mounts the outlet once this exists. */
  project: NonNullable<ReturnType<typeof useProjectSettings>>['project'];
  myRole: Role | undefined;
  /** ADMIN or MEMBER. */
  editable: boolean;
  isAdmin: boolean;
  /** Sorted by `order` — WorkflowSection and the integrations expect that. */
  statuses: StatusDto[];
  /** Workspace members, for the components section's assignee picker. */
  workspaceUsers: { id: string; name: string; email: string }[];
}

export function useProjectSettings(): ProjectSettingsContext {
  return useOutletContext<ProjectSettingsContext>();
}
```

Replace the self-referential `project` type and the inlined `workspaceUsers` shape with the real DTO types read off `@/api/projects` and `@/api/workspaces` — the current `SettingsPage.tsx:79` and `:84` show exactly what those queries return. Do not use `any`.

- [ ] **Step 2: Turn `SettingsPage.tsx` into the layout route**

Keep every hook it has today (`useProject`, `useMyRole`, `useWorkspaceMembers`, `useBoardRealtime`, `useStatuses` and the `statusesForWorkflow` memo) and its existing `LoadingState` / `ErrorState` branches. Replace the 19-section body with:

```tsx
return (
  <Shell projectId={projectId} projectName={project.name}>
    <SettingsLayout
      groups={PROJECT_SETTINGS_GROUPS}
      basePath={`/projects/${projectId}/settings`}
      title="Settings"
      description="Configure this project."
    >
      <Outlet context={context satisfies ProjectSettingsContext} />
    </SettingsLayout>
  </Shell>
);
```

Keep the existing `readonly-hint` "View only" badge — `viewer-aware-ui.spec.ts` and `role-enforcement.spec.ts` assert it. Render it inside the layout so it shows on every group.

- [ ] **Step 3: Write the six group pages**

Each is a small component: call `useProjectSettings()`, render its sections in the order the spec's grouping table gives, stacked in a `<div className="flex flex-col gap-6">`. Move each section's JSX across **unchanged** — same props, same order of props, same conditionals (`{isAdmin && <ShareSection …/>}`, `{editable && <ProjectDangerZone …/>}`).

| Page | Sections, in order |
|---|---|
| `ProjectSettingsGeneral` | `ProjectDetailsSection`, `ShareSection` (admin only), `ProjectDangerZone` (editable only) |
| `ProjectSettingsPeople` | `MembersSection` |
| `ProjectSettingsWork` | `ColumnsSection`, `LabelsSection`, `ComponentsSection`, `VersionsSection`, `CustomFieldsSection`, `WorkflowSection`, `WorkflowsManager` |
| `ProjectSettingsTemplates` | `TemplatesManager`, `PageTemplatesSection` (scope `{ kind: 'project', id: projectId }`) |
| `ProjectSettingsIntegrations` | `GithubSection`, `GitlabSection`, `GiteaSection`, `WebhooksSection` |
| `ProjectSettingsAgents` | `AgentContextSection`, `AgentAccessSection` |

- [ ] **Step 4: Wire the routes**

In `apps/web/src/App.tsx`, replace line 287's `<Route path="settings" element={<SettingsPage />} />` with:

```tsx
<Route path="settings" element={<SettingsPage />}>
  <Route
    index
    element={<Navigate to={DEFAULT_PROJECT_SETTINGS_GROUP} replace />}
  />
  <Route path="general" element={<ProjectSettingsGeneral />} />
  <Route path="people" element={<ProjectSettingsPeople />} />
  <Route path="work" element={<ProjectSettingsWork />} />
  <Route path="templates" element={<ProjectSettingsTemplates />} />
  <Route path="integrations" element={<ProjectSettingsIntegrations />} />
  <Route path="agents" element={<ProjectSettingsAgents />} />
  <Route
    path="*"
    element={<Navigate to={DEFAULT_PROJECT_SETTINGS_GROUP} replace />}
  />
</Route>
```

The trailing `path="*"` matters: without it an unknown group segment falls through to the app-level catch-all at `App.tsx:314` and throws the user out to `/`, losing the project entirely.

- [ ] **Step 5: Migrate the e2e call sites**

Each site keeps everything it does today; only the URL gains a segment. Where a spec has a local `gotoSettings(page, projectId)` helper, give the helper a `group` parameter rather than inlining the URL at each call.

| Spec file | Lines | Group |
|---|---|---|
| `agent-context.spec.ts` | 37 (helper) | `agents` |
| `agent-read-only.spec.ts` | 52, 123 | `agents` |
| `board-columns.spec.ts` | 24 (helper) | `work` |
| `board-workflows.spec.ts` | 56, 222 | `work` |
| `components.spec.ts` | 52, 149, 176, 218 | `work` |
| `custom-fields.spec.ts` | 64, 226 | `work` |
| `gitea-integration.spec.ts` | 64, 220, 245 | `integrations` |
| `github-integration.spec.ts` | 55, 201, 225 | `integrations` |
| `gitlab-auto-transition.spec.ts` | 143 | `integrations` |
| `gitlab-integration.spec.ts` | 52, 228, 252 | `integrations` |
| `issue-templates.spec.ts` | 64, 100, 127, 230 | `templates` |
| `label-rename.spec.ts` | 24 (helper) | `work` |
| `pr-auto-transition.spec.ts` | 132 | `integrations` |
| `project-members.spec.ts` | 34 (helper) | `people` |
| `settings-robustness.spec.ts` | helper at 33 — **takes a `group` param**; call sites: 58 `work`, 108 `integrations`, 145 `integrations`, 184 `work`, 216 `general`, 255 `general`, 369 `work`, 407 `work` | mixed |
| `share-link.spec.ts` | 196, 261 | `general` |
| `versions.spec.ts` | 55, 91, 188, 215, 257 | `work` |
| `webhooks-ui.spec.ts` | 35, 99 | `integrations` |
| `wip-limits.spec.ts` | 74 | `work` |
| `workflow-graph.spec.ts` | 75 | `work` |
| `workflow-robustness.spec.ts` | 176, 208, 274, 294, 343, 373, 495, 537, 554, 793, 828, 886 | `work` |
| `workflow.spec.ts` | 63, 160 | `work` |

Line numbers are from `main` at `336024d` and will drift as you edit — treat them as a checklist of *how many* sites each file has, and find them with `grep -n "/settings\`)" <file>`. When you are done, `grep -rn "settings\`)" apps/web/e2e/*.spec.ts` must return **no** project-settings URL without a group segment.

`webhooks-ui.spec.ts:99` is the viewer case: it asserts the Settings heading renders while the Webhooks heading does not. Point it at `integrations` — the heading assertion still passes because `SettingsLayout` owns the `h1`, and the `toHaveCount(0)` assertion becomes stronger, not weaker, since the viewer is now on the very page the section would be on.

- [ ] **Step 6: Run the full gate**

```bash
pnpm --filter @next-lane/shared build
pnpm --filter @next-lane/web exec tsc --noEmit
pnpm --filter @next-lane/web exec vitest run
PW_CHROMIUM_PATH=/opt/pw-browsers/chromium PW_API_URL=http://localhost:4000 \
  pnpm --filter @next-lane/web exec playwright test --reporter=line
```

Expected: all green. This is the whole suite, not a slice — a settings split touches role enforcement, viewer-aware UI, the nav and the command palette, and those specs are not in the migration table precisely because they should not have needed changing. If one of them fails, that is a real regression.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/settings apps/web/src/pages/SettingsPage.tsx \
        apps/web/src/App.tsx apps/web/e2e
git commit -m "feat(settings): split project settings into six grouped routes"
```

---

### Task 6: An e2e spec for the IA itself

The migration in Task 5 proves the sections still work. Nothing yet proves the *navigation* works — and the rail, the redirect and the mobile collapse are the whole deliverable.

**Files:**
- Create: `apps/web/e2e/settings-ia.spec.ts`

**Interfaces:**
- Consumes: `setupIsolatedProject`, `login`, `registerNewUser` from `./helpers`; `PROJECT_SETTINGS_GROUPS` is NOT imported — the spec names the six segments literally, so that a typo in the source list fails the test instead of being mirrored by it.

- [ ] **Step 1: Write the spec**

Cover exactly these, each as its own `test`:

1. **The old URL still resolves.** `goto('/projects/:id/settings')` ends on `…/settings/general` and shows the details section. This is the one that protects every deep link in the docs, the README and MCP output.
2. **An unknown group does not eject you.** `goto('/projects/:id/settings/nonsense')` lands on `…/settings/general`, still inside the project — assert the URL, not just that something rendered.
3. **Every group is reachable from the rail and shows its content.** Loop the six segments: click `settings-rail-<to>`, assert the URL, and assert one `data-testid` that only that group renders (`components-section` for `work`, `github-section` for `integrations`, `templates-manager` for `templates`, `agent-context-section` for `agents`, `#settings-name` for `general`, the members section for `people`).
4. **Deep links work cold.** `goto` each of the six URLs directly after a fresh page load and assert the same marker. A rail that only works after client-side navigation is a rail that breaks on refresh — the exact class of bug the workspace-switcher suite exists to catch.
5. **The active entry is marked.** After navigating to `work`, `settings-rail-work` has `aria-current="page"` and no other rail entry does.
6. **393px.** With `page.setViewportSize({ width: 393, height: 852 })`: the rail select is visible, the rail list is not, choosing a group navigates, and the page has no horizontal overflow (`document.documentElement.scrollWidth <= clientWidth`).

Use `setupIsolatedProject` — this spec creates nothing but must not collide with parallel runs. Unique-suffix any workspace or project name.

- [ ] **Step 2: Run it desktop and mobile**

```bash
PW_CHROMIUM_PATH=/opt/pw-browsers/chromium PW_API_URL=http://localhost:4000 \
  pnpm --filter @next-lane/web exec playwright test settings-ia --reporter=line
```

Expected: PASS on every configured project. If the suite has desktop and mobile projects configured, both must pass; check `playwright.config.ts` for the project names and run them explicitly if the default run does not include mobile.

- [ ] **Step 3: Commit**

```bash
git add apps/web/e2e/settings-ia.spec.ts
git commit -m "test(settings): cover the settings rail, redirects and mobile collapse"
```

---

### Task 7: Docs, screenshots and the push

**Files:**
- Modify: `docs/ROADMAP.md`
- Modify: `docs/BACKLOG.md`
- Modify: `docs/UI-REVIEW.md` (tick the settings surfaces off the component checklist)

- [ ] **Step 1: Capture before/after, desktop and mobile**

The founder asked to *see* the redesign land. Capture `/projects/:id/settings` at 1280px and 393px, before (from `main`) and after. Send them with the file-sending mechanism.

- [ ] **Step 2: Reconcile the docs against `git log`**

Per CLAUDE.md this is not optional and not a follow-up: tick the settings-IA item in `docs/BACKLOG.md`, advance `docs/ROADMAP.md`'s phase status and "Current focus" line if this completes one, and check `git log` for anything else that shipped without being recorded.

Note in both that this is **Phase 1 of 3** — the workspace, personal and instance scopes are still on their own layouts until Phases 2 and 3 land. A roadmap that reads "settings redesign: done" after this commit is exactly the stale-doc defect CLAUDE.md calls out.

- [ ] **Step 3: Commit and push**

```bash
git add docs/ROADMAP.md docs/BACKLOG.md docs/UI-REVIEW.md
git commit -m "docs: record the settings IA redesign, phase 1 of 3"
git push -u origin feat/settings-ia-redesign
```

On a network failure, retry up to four times with 2s/4s/8s/16s backoff. On a rejection, `git pull --rebase` and retry.

---

## Self-review

**Spec coverage.** Shell → Task 4. Grouping table → Tasks 1 and 5. `/projects/:id/settings` still resolving → Tasks 1, 5 and 6. Blast radius (22 files, ~40 sites — the survey found 56 including the multi-group helper) → Task 5 Step 5. Testids preserved → the global constraint plus Task 3's baseline comparison. Mobile 393px → Tasks 4 and 6.

**Not in this plan, by design.** The workspace, personal and instance scopes moving onto `SettingsLayout` are Phases 2 and 3 of the spec; `WorkspaceSettingsNav` is therefore still alive at the end of this plan and is deleted in Phase 2. Cross-scope search was dropped from the spec entirely during the correction pass — it was justified by a findability problem that the rail solves for the scope that actually had it.

**Type consistency.** `SettingsGroup { to, label, description }` is used verbatim by `SettingsLayout`'s `groups` prop and by the route table. `useProjectSettings()` returns `ProjectSettingsContext` and is the only way group pages read data. The four extracted components' prop types are specified as "read them off the source" rather than restated, because restating them is how a plan introduces a signature that does not exist.
