/**
 * graphColors — deterministic "color by project" assignment for the
 * observatory knowledge graph, plus the staleness helper that lets nodes
 * visually recede when a page hasn't been touched in a while.
 *
 * Design constraint (see `KnowledgeGraphView`'s header doc): the `signal`
 * accent is reserved for the hover/focus/select "ignition" state — a node's
 * RESTING color must never be signal, or the active-state highlight would
 * have nothing to contrast against. Project hues are drawn from the existing
 * semantic token scales (`tailwind.config.js` `varScale`) rather than new
 * colors, so every hue is dark-mode-aware for free and nothing is invented
 * outside the design-token system.
 *
 * Tailwind's JIT scanner only picks up class names that appear as LITERAL
 * strings in source — `bg-${hue}-500` template interpolation would silently
 * produce no CSS. `PROJECT_HUE_CLASSES` below spells every class out so nothing
 * gets purged.
 */

/** Curated hue set — excludes `blue` (== `signal`, reserved for the active
 * state) and `ink`/`gray`/`slate` (reserved for the workspace-docs neutral). */
export const PROJECT_HUES = ['emerald', 'amber', 'purple', 'orange', 'red', 'green'] as const;
export type ProjectHue = (typeof PROJECT_HUES)[number];

export const PROJECT_HUE_CLASSES: Record<
  ProjectHue,
  { dot: string; text: string; legendSwatch: string; var: string }
> = {
  emerald: { dot: 'bg-emerald-500', text: 'text-emerald-700', legendSwatch: 'bg-emerald-500', var: '--nl-emerald-500' },
  amber: { dot: 'bg-amber-500', text: 'text-amber-700', legendSwatch: 'bg-amber-500', var: '--nl-amber-500' },
  purple: { dot: 'bg-purple-500', text: 'text-purple-700', legendSwatch: 'bg-purple-500', var: '--nl-purple-500' },
  orange: { dot: 'bg-orange-500', text: 'text-orange-700', legendSwatch: 'bg-orange-500', var: '--nl-orange-500' },
  red: { dot: 'bg-red-500', text: 'text-red-700', legendSwatch: 'bg-red-500', var: '--nl-red-500' },
  green: { dot: 'bg-green-500', text: 'text-green-700', legendSwatch: 'bg-green-500', var: '--nl-green-500' },
};

/** Deterministic 32-bit string hash (FNV-1a) — same function shape as
 * `forceLayout.ts`'s seed hash, kept local since the two aren't meant to
 * share a module (different determinism contracts). */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Stable hue for a project id — the SAME id always maps to the same hue
 * (across reloads, across users), independent of fetch order. */
export function projectHue(projectId: string): ProjectHue {
  return PROJECT_HUES[hashString(projectId) % PROJECT_HUES.length];
}

export const WORKSPACE_DOCS_LEGEND_LABEL = 'Workspace docs';

const STALE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** True when a page's last edit is old enough to read as "stale" — the
 * graph dims/desaturates these so recency reads visually (founder directive). */
export function isStalePage(updatedAt: string): boolean {
  return Date.now() - new Date(updatedAt).getTime() > STALE_MS;
}
