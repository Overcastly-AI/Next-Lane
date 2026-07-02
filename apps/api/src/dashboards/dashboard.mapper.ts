import type { Prisma } from '@prisma/client';
import type {
  DashboardDto,
  DashboardGadgetConfig,
  DashboardGadgetDto,
  DashboardSummaryDto,
} from '@next-lane/shared';
import { DashboardGadgetVisualization } from '@next-lane/shared';

/** Prisma Dashboard row shape (subset needed for mapping). */
export interface DashboardRow {
  id: string;
  projectId: string;
  name: string;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Prisma DashboardGadget row shape (subset needed for mapping). */
export interface DashboardGadgetRow {
  id: string;
  dashboardId: string;
  title: string;
  query: string;
  visualization: string;
  config: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Parse a gadget's stored `config` JSON into the typed shape, defaulting to `{}`. */
export function parseGadgetConfig(
  config: Prisma.JsonValue | null,
): DashboardGadgetConfig {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return {};
  return config as unknown as DashboardGadgetConfig;
}

/** A gadget's grid position — used to sort a dashboard's gadgets for display. */
export function gadgetPosition(row: DashboardGadgetRow): number {
  const cfg = parseGadgetConfig(row.config);
  return typeof cfg.position === 'number' ? cfg.position : 0;
}

export function toDashboardGadgetDto(row: DashboardGadgetRow): DashboardGadgetDto {
  return {
    id: row.id,
    dashboardId: row.dashboardId,
    title: row.title,
    query: row.query,
    visualization: row.visualization as DashboardGadgetVisualization,
    config: parseGadgetConfig(row.config),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toDashboardSummaryDto(
  row: DashboardRow,
  gadgetCount: number,
): DashboardSummaryDto {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    order: row.order,
    gadgetCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Sort gadgets by their config-derived grid position, then creation order. */
export function sortGadgets(gadgets: DashboardGadgetRow[]): DashboardGadgetRow[] {
  return [...gadgets].sort((a, b) => {
    const diff = gadgetPosition(a) - gadgetPosition(b);
    if (diff !== 0) return diff;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}

export function toDashboardDto(
  row: DashboardRow,
  gadgets: DashboardGadgetRow[],
): DashboardDto {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    order: row.order,
    gadgets: sortGadgets(gadgets).map(toDashboardGadgetDto),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
