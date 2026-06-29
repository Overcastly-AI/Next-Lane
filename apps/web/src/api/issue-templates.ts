import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateIssueTemplateDto,
  IssueDto,
  IssueTemplateDto,
  UpdateIssueTemplateDto,
} from '@next-lane/shared';
import { request } from './client';
import { qk } from './keys';

/** Fetch all issue templates for a project (member+). */
export function useIssueTemplates(projectId: string | undefined) {
  return useQuery({
    queryKey: qk.issueTemplates(projectId ?? ''),
    enabled: !!projectId,
    queryFn: () =>
      request<IssueTemplateDto[]>(`/projects/${projectId}/issue-templates`),
  });
}

/** Create a new issue template (ADMIN only). */
export function useCreateIssueTemplate(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateIssueTemplateDto) =>
      request<IssueTemplateDto>(`/projects/${projectId}/issue-templates`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.issueTemplates(projectId) });
    },
  });
}

/** Update an existing issue template (ADMIN only). */
export function useUpdateIssueTemplate(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateIssueTemplateDto }) =>
      request<IssueTemplateDto>(`/issue-templates/${id}`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.issueTemplates(projectId) });
    },
  });
}

/** Delete an issue template (ADMIN only). */
export function useDeleteIssueTemplate(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<void>(`/issue-templates/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.issueTemplates(projectId) });
    },
  });
}

/** Create an issue from a template (member+). Invalidates the board + issues. */
export function useCreateIssueFromTemplate(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      templateId,
      overrides = {},
    }: {
      templateId: string;
      overrides?: {
        title?: string;
        description?: string;
        assigneeId?: string;
        componentId?: string;
        priority?: string;
        statusId?: string;
        sprintId?: string;
        labelIds?: string[];
      };
    }) =>
      request<IssueDto>(`/issue-templates/${templateId}/create-issue`, {
        method: 'POST',
        body: overrides,
      }),
    onSuccess: () => {
      // Invalidate all project-scoped issue caches so the new issue surfaces.
      void qc.invalidateQueries({ queryKey: qk.projectIssues(projectId) });
      void qc.invalidateQueries({ queryKey: qk.board(projectId) });
      // Also invalidate any board-view caches (by partial key prefix).
      void qc.invalidateQueries({ queryKey: ['boardView'] });
    },
  });
}
