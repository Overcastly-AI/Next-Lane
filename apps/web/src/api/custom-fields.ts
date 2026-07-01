import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CustomFieldDefinitionDto,
  CustomFieldValue,
  IssueType,
} from '@next-lane/shared';
import { CustomFieldType } from '@next-lane/shared';
import { request } from './client';
import { qk } from './keys';

// Re-export so consumers can import from one place.
export type { CustomFieldDefinitionDto, CustomFieldValue };
export { CustomFieldType };

// ---------------------------------------------------------------------------
// Input shapes
// ---------------------------------------------------------------------------

export interface CreateCustomFieldInput {
  name: string;
  type: CustomFieldType;
  options?: string[];
  appliesToTypes?: IssueType[];
  required?: boolean;
  showOnCard?: boolean;
}

export interface UpdateCustomFieldInput {
  name?: string;
  options?: string[];
  appliesToTypes?: IssueType[];
  required?: boolean;
  showOnCard?: boolean;
  order?: number;
}

// ---------------------------------------------------------------------------
// Query hook
// ---------------------------------------------------------------------------

/** Fetch all custom field definitions for a project, ordered by `order`. */
export function useCustomFields(projectId: string | undefined) {
  return useQuery({
    queryKey: qk.customFields(projectId ?? ''),
    enabled: !!projectId,
    queryFn: () =>
      request<CustomFieldDefinitionDto[]>(
        `/projects/${projectId}/custom-fields`,
      ),
    select: (data) => [...data].sort((a, b) => a.order - b.order),
  });
}

// ---------------------------------------------------------------------------
// Mutation hooks
// ---------------------------------------------------------------------------

/** Create a new custom field definition in a project. */
export function useCreateCustomField(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCustomFieldInput) =>
      request<CustomFieldDefinitionDto>(
        `/projects/${projectId}/custom-fields`,
        { method: 'POST', body: input },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.customFields(projectId) });
    },
  });
}

/** Update a custom field definition. Type and key are immutable — only name,
 *  options, appliesToTypes, required, and order may change. */
export function useUpdateCustomField(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: UpdateCustomFieldInput;
    }) =>
      request<CustomFieldDefinitionDto>(`/custom-fields/${id}`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.customFields(projectId) });
    },
  });
}

/** Delete a custom field definition by id. */
export function useDeleteCustomField(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<void>(`/custom-fields/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.customFields(projectId) });
    },
  });
}

/** Patch an issue's custom field values (partial merge — only provided keys
 *  change; passing null for a key clears it). Wraps the standard issue-update
 *  endpoint with the `customFields` payload fragment. */
export function useUpdateIssueCustomFields() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      issueId,
      values,
    }: {
      issueId: string;
      projectId: string;
      values: Record<string, CustomFieldValue>;
    }) =>
      request<{ id: string; customFields?: Record<string, CustomFieldValue> }>(
        `/issues/${issueId}`,
        { method: 'PATCH', body: { customFields: values } },
      ),
    onSuccess: (_updated, vars) => {
      void qc.invalidateQueries({ queryKey: qk.issue(vars.issueId) });
      void qc.invalidateQueries({ queryKey: qk.board(vars.projectId) });
    },
  });
}
