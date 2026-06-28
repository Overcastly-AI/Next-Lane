import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AutomationRuleDto,
  AutomationRunDto,
  AutomationActionDto,
} from '@next-lane/shared';
import { AutomationTrigger } from '@next-lane/shared';
import { request } from './client';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const automationKeys = {
  list: (projectId: string) => ['automations', projectId] as const,
  detail: (projectId: string, ruleId: string) =>
    ['automations', projectId, ruleId] as const,
  runs: (projectId: string, ruleId?: string) =>
    ruleId
      ? (['automationRuns', projectId, ruleId] as const)
      : (['automationRuns', projectId] as const),
};

// ---------------------------------------------------------------------------
// Input shapes
// ---------------------------------------------------------------------------

export interface CreateAutomationInput {
  name: string;
  description?: string;
  enabled?: boolean;
  trigger: AutomationTrigger;
  condition?: string | null;
  actions: AutomationActionDto[];
  order?: number;
}

export type UpdateAutomationInput = Partial<CreateAutomationInput>;

// ---------------------------------------------------------------------------
// Query hooks
// ---------------------------------------------------------------------------

/** List all automation rules for a project. */
export function useAutomations(projectId: string | undefined) {
  return useQuery({
    queryKey: automationKeys.list(projectId ?? ''),
    enabled: !!projectId,
    queryFn: () =>
      request<AutomationRuleDto[]>(`/projects/${projectId}/automations`),
  });
}

/** Fetch a single automation rule. */
export function useAutomation(
  projectId: string | undefined,
  ruleId: string | undefined,
) {
  return useQuery({
    queryKey: automationKeys.detail(projectId ?? '', ruleId ?? ''),
    enabled: !!projectId && !!ruleId,
    queryFn: () =>
      request<AutomationRuleDto>(
        `/projects/${projectId}/automations/${ruleId}`,
      ),
  });
}

/** Recent run log — pass ruleId to scope to one rule, omit for project-wide. */
export function useAutomationRuns(
  projectId: string | undefined,
  opts: { ruleId?: string; limit?: number } = {},
) {
  const { ruleId, limit = 50 } = opts;
  const path = ruleId
    ? `/projects/${projectId}/automations/${ruleId}/runs?limit=${limit}`
    : `/projects/${projectId}/automations/runs?limit=${limit}`;
  return useQuery({
    queryKey: automationKeys.runs(projectId ?? '', ruleId),
    enabled: !!projectId,
    queryFn: () => request<AutomationRunDto[]>(path),
  });
}

// ---------------------------------------------------------------------------
// Mutation hooks
// ---------------------------------------------------------------------------

/** Create a new automation rule. */
export function useCreateAutomation(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAutomationInput) =>
      request<AutomationRuleDto>(`/projects/${projectId}/automations`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: automationKeys.list(projectId),
      });
    },
  });
}

/** Update an existing automation rule (partial). */
export function useUpdateAutomation(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      ruleId,
      input,
    }: {
      ruleId: string;
      input: UpdateAutomationInput;
    }) =>
      request<AutomationRuleDto>(
        `/projects/${projectId}/automations/${ruleId}`,
        { method: 'PATCH', body: input },
      ),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({
        queryKey: automationKeys.list(projectId),
      });
      void qc.invalidateQueries({
        queryKey: automationKeys.detail(projectId, vars.ruleId),
      });
    },
  });
}

/** Delete a rule (204 response). */
export function useDeleteAutomation(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ruleId: string) =>
      request<void>(`/projects/${projectId}/automations/${ruleId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: automationKeys.list(projectId),
      });
    },
  });
}

/**
 * Toggle enabled/disabled — optimistically updates the list cache so the
 * switch feels instant.
 */
export function useToggleAutomation(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ruleId, enabled }: { ruleId: string; enabled: boolean }) =>
      request<AutomationRuleDto>(
        `/projects/${projectId}/automations/${ruleId}`,
        { method: 'PATCH', body: { enabled } },
      ),
    onMutate: async ({ ruleId, enabled }) => {
      // Cancel any in-flight refetches so they don't overwrite the optimistic update.
      await qc.cancelQueries({
        queryKey: automationKeys.list(projectId),
      });
      const previous = qc.getQueryData<AutomationRuleDto[]>(
        automationKeys.list(projectId),
      );
      if (previous) {
        qc.setQueryData<AutomationRuleDto[]>(
          automationKeys.list(projectId),
          previous.map((r) => (r.id === ruleId ? { ...r, enabled } : r)),
        );
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        qc.setQueryData(automationKeys.list(projectId), ctx.previous);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({
        queryKey: automationKeys.list(projectId),
      });
    },
  });
}
