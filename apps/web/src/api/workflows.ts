/**
 * workflows.ts — Per-board named workflows API hooks.
 *
 * REST contract (new Workflow model, distinct from legacy project-level workflow):
 *   GET    /projects/:projectId/workflows           → WorkflowDto[]
 *   POST   /projects/:projectId/workflows           → WorkflowDto  (ADMIN)
 *   POST   /projects/:projectId/workflows/from-template  → WorkflowDto  (ADMIN)
 *   GET    /workflows/:id                           → WorkflowDto + transitions
 *   PATCH  /workflows/:id                           → WorkflowDto  (ADMIN)
 *   DELETE /workflows/:id                           → 204          (ADMIN)
 *
 *   Workflow-scoped transitions:
 *   POST   /workflows/:id/transitions               → WorkflowTransitionDto (ADMIN)
 *   PATCH  /workflow-transitions/:id               → WorkflowTransitionDto (ADMIN)
 *   DELETE /workflow-transitions/:id               → 204                   (ADMIN)
 *
 *   Board assignment:
 *   PATCH  /boards/:id  { workflowId }             → BoardSummaryDto       (ADMIN)
 *   (re-uses useUpdateBoard from boards.ts — add useAssignBoardWorkflow convenience here)
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  WorkflowDto,
  CreateWorkflowDto,
  UpdateWorkflowDto,
  WorkflowGateDto,
  WorkflowTransitionDto,
  IssueType,
  BoardSummaryDto,
  BoardDto,
} from '@next-lane/shared';
import { request } from './client';
import { qk } from './keys';

// ---------------------------------------------------------------------------
// Template types
// ---------------------------------------------------------------------------

export type WorkflowTemplate = 'simple' | 'kanban' | 'scrum' | 'bug-triage';

export const WORKFLOW_TEMPLATES: { value: WorkflowTemplate; label: string }[] = [
  { value: 'simple', label: 'Simple (To Do → Done)' },
  { value: 'kanban', label: 'Kanban' },
  { value: 'scrum', label: 'Scrum' },
  { value: 'bug-triage', label: 'Bug Triage' },
];

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** List all named workflows for a project (with transitionCount/boardCount). */
export function useWorkflows(projectId: string) {
  return useQuery({
    queryKey: qk.workflows(projectId),
    queryFn: () => request<WorkflowDto[]>(`/projects/${projectId}/workflows`),
    enabled: !!projectId,
  });
}

/** Fetch a single workflow by id (includes its transitions). */
export function useWorkflowDetail(workflowId: string | null | undefined) {
  return useQuery({
    queryKey: qk.workflow(workflowId ?? ''),
    queryFn: () => request<WorkflowDto & { transitions: WorkflowTransitionDto[] }>(`/workflows/${workflowId}`),
    enabled: !!workflowId,
  });
}

// ---------------------------------------------------------------------------
// Workflow mutations
// ---------------------------------------------------------------------------

/** Create a new named workflow for a project. */
export function useCreateWorkflow(projectId: string) {
  const qc = useQueryClient();
  return useMutation<WorkflowDto, Error, CreateWorkflowDto>({
    mutationFn: (input) =>
      request<WorkflowDto>(`/projects/${projectId}/workflows`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.workflows(projectId) });
    },
  });
}

/** Seed a workflow from a predefined template. */
export function useCreateWorkflowFromTemplate(projectId: string) {
  const qc = useQueryClient();
  return useMutation<WorkflowDto, Error, { template: WorkflowTemplate; name?: string }>({
    mutationFn: (input) =>
      request<WorkflowDto>(`/projects/${projectId}/workflows/from-template`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.workflows(projectId) });
    },
  });
}

/** Update a named workflow (name, description, enforced). */
export function useUpdateWorkflow(projectId: string) {
  const qc = useQueryClient();
  return useMutation<WorkflowDto, Error, { id: string } & UpdateWorkflowDto>({
    mutationFn: ({ id, ...patch }) =>
      request<WorkflowDto>(`/workflows/${id}`, {
        method: 'PATCH',
        body: patch,
      }),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: qk.workflows(projectId) });
      void qc.invalidateQueries({ queryKey: qk.workflow(data.id) });
    },
  });
}

/** Delete a named workflow. */
export function useDeleteWorkflow(projectId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) =>
      request<void>(`/workflows/${id}`, { method: 'DELETE' }),
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: qk.workflows(projectId) });
      qc.removeQueries({ queryKey: qk.workflow(id) });
      // Boards that referenced this workflow may now have workflowId=null
      void qc.invalidateQueries({ queryKey: qk.boards(projectId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Workflow-scoped transition mutations
// ---------------------------------------------------------------------------

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

/** Add a transition to a named workflow. */
export function useAddWorkflowTransition(workflowId: string) {
  const qc = useQueryClient();
  return useMutation<WorkflowTransitionDto, Error, CreateWorkflowTransitionInput>({
    mutationFn: (input) =>
      request<WorkflowTransitionDto>(`/workflows/${workflowId}/transitions`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.workflow(workflowId) });
    },
  });
}

/** Update a transition that belongs to a named workflow. */
export function useUpdateWorkflowTransition(workflowId: string) {
  const qc = useQueryClient();
  return useMutation<WorkflowTransitionDto, Error, { id: string } & UpdateWorkflowTransitionInput>({
    mutationFn: ({ id, ...patch }) =>
      request<WorkflowTransitionDto>(`/workflow-transitions/${id}`, {
        method: 'PATCH',
        body: patch,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.workflow(workflowId) });
    },
  });
}

/** Delete a transition from a named workflow. */
export function useDeleteWorkflowTransition(workflowId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) =>
      request<void>(`/workflow-transitions/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.workflow(workflowId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Board workflow assignment
// ---------------------------------------------------------------------------

/**
 * Assign (or unassign) a named workflow to a board.
 * Patches PATCH /boards/:id { workflowId } and invalidates the boards list.
 */
export function useAssignBoardWorkflow(projectId: string) {
  const qc = useQueryClient();
  return useMutation<BoardSummaryDto, Error, { boardId: string; workflowId: string | null }>({
    mutationFn: ({ boardId, workflowId }) =>
      request<BoardSummaryDto>(`/boards/${boardId}`, {
        method: 'PATCH',
        body: { workflowId },
      }),
    onSuccess: (updated) => {
      // Patch the boards list cache optimistically.
      qc.setQueryData<BoardSummaryDto[]>(qk.boards(projectId), (list) =>
        list
          ? list.map((b) => (b.id === updated.id ? { ...b, ...updated } : b))
          : list,
      );
      // Patch the boardView cache if present.
      qc.setQueryData<BoardDto>(qk.boardView(updated.id), (view) =>
        view ? { ...view, board: updated } : view,
      );
      void qc.invalidateQueries({ queryKey: qk.boards(projectId) });
      void qc.invalidateQueries({ queryKey: qk.boardView(updated.id) });
    },
  });
}
