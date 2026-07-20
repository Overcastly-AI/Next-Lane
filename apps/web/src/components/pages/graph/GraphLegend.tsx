/**
 * GraphLegend — the color→project key for the workspace-wide observatory
 * graph (project scope never renders this: it's single-accent, nothing to
 * key). One swatch per distinct project actually present in the loaded
 * graph, plus a neutral "Workspace docs" entry when any node has no owning
 * project — never a static/global project list, so it never shows an entry
 * with zero nodes.
 */
import { useMemo } from 'react';
import type { PageGraphNode } from '@next-lane/shared';
import { PROJECT_HUE_CLASSES, WORKSPACE_DOCS_LEGEND_LABEL, projectHue } from './graphColors';

export interface GraphLegendProps {
  nodes: PageGraphNode[];
}

interface LegendEntry {
  key: string;
  label: string;
  swatchClass: string;
}

export function GraphLegend({ nodes }: GraphLegendProps) {
  const entries = useMemo<LegendEntry[]>(() => {
    const byProject = new Map<string, string>(); // projectId -> key/label
    let hasWorkspaceDocs = false;
    for (const n of nodes) {
      if (n.projectId) {
        if (!byProject.has(n.projectId)) byProject.set(n.projectId, n.projectKey ?? 'Project');
      } else {
        hasWorkspaceDocs = true;
      }
    }
    const list: LegendEntry[] = Array.from(byProject.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([projectId, label]) => ({
        key: projectId,
        label,
        swatchClass: PROJECT_HUE_CLASSES[projectHue(projectId)].legendSwatch,
      }));
    if (hasWorkspaceDocs) {
      list.push({ key: 'workspace', label: WORKSPACE_DOCS_LEGEND_LABEL, swatchClass: 'bg-ink-400' });
    }
    return list;
  }, [nodes]);

  if (entries.length === 0) return null;

  return (
    <div
      data-testid="page-graph-legend"
      role="group"
      aria-label="Graph color legend, by project"
      className="flex flex-wrap items-center gap-x-3 gap-y-1"
    >
      {entries.map((e) => (
        <span
          key={e.key}
          data-testid={`page-graph-legend-item-${e.key}`}
          className="flex items-center gap-1.5 text-xs font-medium text-ink-500"
        >
          <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${e.swatchClass}`} />
          {e.label}
        </span>
      ))}
    </div>
  );
}
