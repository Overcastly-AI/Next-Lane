/**
 * Workflow API hooks — Phase 3 frontend slice.
 *
 * REST contract:
 *   GET  /projects/:projectId/workflow          → WorkflowDto
 *   PATCH /projects/:projectId/workflow          → WorkflowDto  (ADMIN)
 *   POST /projects/:projectId/workflow/transitions → WorkflowTransitionDto (ADMIN)
 *   PATCH /workflow/transitions/:id              → WorkflowTransitionDto (ADMIN)
 *   DELETE /workflow/transitions/:id             → 204           (ADMIN)
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  WorkflowDto,
  WorkflowGateDto,
  WorkflowTransitionDto,
  IssueType,
} from '@next-lane/shared';
import { request } from './client';
import { qk } from './keys';

// ---------------------------------------------------------------------------
// Query key (co-located so WorkflowSection can import it directly)
// ---------------------------------------------------------------------------

export const workflowKeys = {
  workflow: (projectId: string) => ['workflow', projectId] as const,
};

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export function useWorkflow(projectId: string) {
  return useQuery({
    queryKey: workflowKeys.workflow(projectId),
    queryFn: () => request<WorkflowDto>(`/projects/${projectId}/workflow`),
    enabled: !!projectId,
  });
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface SetWorkflowEnforcedInput {
  enforced: boolean;
}

export interface CreateWorkflowTransitionInput {
  fromStatusId: string | null;
  toStatusId: string;
  issueType?: IssueType | null;
  name?: string;
  gates?: WorkflowGateDto[];
}

export interface UpdateWorkflowTransitionInput {
  fromStatusId?: string | null;
  toStatusId?: string;
  issueType?: IssueType | null;
  name?: string | null;
  gates?: WorkflowGateDto[];
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Toggle workflow enforcement on/off. */
export function useSetWorkflowEnforced(projectId: string) {
  const qc = useQueryClient();
  return useMutation<WorkflowDto, Error, SetWorkflowEnforcedInput>({
    mutationFn: (input) =>
      request<WorkflowDto>(`/projects/${projectId}/workflow`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: (data) => {
      // Update workflow cache directly from response.
      qc.setQueryData(workflowKeys.workflow(projectId), data);
      // Invalidate the project query too because ProjectDto.workflowEnforced changed.
      void qc.invalidateQueries({ queryKey: qk.project(projectId) });
    },
  });
}

/** Create a new transition rule. */
export function useCreateWorkflowTransition(projectId: string) {
  const qc = useQueryClient();
  return useMutation<WorkflowTransitionDto, Error, CreateWorkflowTransitionInput>({
    mutationFn: (input) =>
      request<WorkflowTransitionDto>(
        `/projects/${projectId}/workflow/transitions`,
        { method: 'POST', body: input },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: workflowKeys.workflow(projectId),
      });
    },
  });
}

/** Update an existing transition (partial). */
export function useUpdateWorkflowTransition(projectId: string) {
  const qc = useQueryClient();
  return useMutation<
    WorkflowTransitionDto,
    Error,
    { id: string } & UpdateWorkflowTransitionInput
  >({
    mutationFn: ({ id, ...patch }) =>
      request<WorkflowTransitionDto>(`/workflow/transitions/${id}`, {
        method: 'PATCH',
        body: patch,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: workflowKeys.workflow(projectId),
      });
    },
  });
}

/** Delete a transition. Returns 204. */
export function useDeleteWorkflowTransition(projectId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) =>
      request<void>(`/workflow/transitions/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: workflowKeys.workflow(projectId),
      });
    },
  });
}
