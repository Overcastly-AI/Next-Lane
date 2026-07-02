import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DashboardDataDto,
  DashboardDto,
  DashboardGadgetConfig,
  DashboardGadgetDto,
  DashboardGadgetVisualization,
  DashboardSummaryDto,
} from '@next-lane/shared';
import { request } from './client';
import { qk } from './keys';

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** List a project's dashboards (summaries — id/name/order/gadgetCount). */
export function useDashboards(projectId: string | undefined) {
  return useQuery({
    queryKey: qk.dashboards(projectId ?? ''),
    enabled: !!projectId,
    queryFn: () =>
      request<DashboardSummaryDto[]>(`/projects/${projectId}/dashboards`),
  });
}

/** Fetch a single dashboard with its gadgets, ordered by grid position. */
export function useDashboard(dashboardId: string | undefined) {
  return useQuery({
    queryKey: qk.dashboard(dashboardId ?? ''),
    enabled: !!dashboardId,
    queryFn: () => request<DashboardDto>(`/dashboards/${dashboardId}`),
  });
}

/** Evaluate every gadget on a dashboard server-side. */
export function useDashboardData(dashboardId: string | undefined) {
  return useQuery({
    queryKey: qk.dashboardData(dashboardId ?? ''),
    enabled: !!dashboardId,
    queryFn: () => request<DashboardDataDto>(`/dashboards/${dashboardId}/data`),
  });
}

// ---------------------------------------------------------------------------
// Mutations — dashboards
// ---------------------------------------------------------------------------

/** Create a dashboard in a project. */
export function useCreateDashboard(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      request<DashboardSummaryDto>(`/projects/${projectId}/dashboards`, {
        method: 'POST',
        body: { name },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.dashboards(projectId) });
    },
  });
}

export interface UpdateDashboardInput {
  name?: string;
  order?: number;
}

/** Rename or reorder a dashboard. */
export function useUpdateDashboard(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      dashboardId,
      patch,
    }: {
      dashboardId: string;
      patch: UpdateDashboardInput;
    }) =>
      request<DashboardSummaryDto>(`/dashboards/${dashboardId}`, {
        method: 'PATCH',
        body: patch,
      }),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: qk.dashboards(projectId) });
      void qc.invalidateQueries({ queryKey: qk.dashboard(updated.id) });
    },
  });
}

/** Delete a dashboard (its gadgets cascade). */
export function useDeleteDashboard(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dashboardId: string) =>
      request<void>(`/dashboards/${dashboardId}`, { method: 'DELETE' }),
    onSuccess: (_data, dashboardId) => {
      void qc.invalidateQueries({ queryKey: qk.dashboards(projectId) });
      qc.removeQueries({ queryKey: qk.dashboard(dashboardId) });
      qc.removeQueries({ queryKey: qk.dashboardData(dashboardId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Mutations — gadgets
// ---------------------------------------------------------------------------

export interface GadgetInput {
  title: string;
  query: string;
  visualization: DashboardGadgetVisualization;
  config?: DashboardGadgetConfig;
}

/**
 * Add a gadget to a dashboard. `projectId` is only used to refresh the
 * dashboards list's `gadgetCount` — pass it when the caller has it handy.
 */
export function useCreateGadget(dashboardId: string, projectId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: GadgetInput) =>
      request<DashboardGadgetDto>(`/dashboards/${dashboardId}/gadgets`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.dashboard(dashboardId) });
      void qc.invalidateQueries({ queryKey: qk.dashboardData(dashboardId) });
      if (projectId) void qc.invalidateQueries({ queryKey: qk.dashboards(projectId) });
    },
  });
}

/** Update a gadget's title/query/visualization/config (config is merged server-side). */
export function useUpdateGadget(dashboardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      gadgetId,
      patch,
    }: {
      gadgetId: string;
      patch: Partial<GadgetInput>;
    }) =>
      request<DashboardGadgetDto>(`/gadgets/${gadgetId}`, {
        method: 'PATCH',
        body: patch,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.dashboard(dashboardId) });
      void qc.invalidateQueries({ queryKey: qk.dashboardData(dashboardId) });
    },
  });
}

/** Delete a gadget from a dashboard. */
export function useDeleteGadget(dashboardId: string, projectId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (gadgetId: string) =>
      request<void>(`/gadgets/${gadgetId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.dashboard(dashboardId) });
      void qc.invalidateQueries({ queryKey: qk.dashboardData(dashboardId) });
      if (projectId) void qc.invalidateQueries({ queryKey: qk.dashboards(projectId) });
    },
  });
}
