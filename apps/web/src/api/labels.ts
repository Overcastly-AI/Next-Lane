import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { BoardDto, IssueDto, LabelDto } from '@next-lane/shared';
import { request } from './client';
import { qk } from './keys';

export interface CreateLabelInput {
  name: string;
  color?: string;
}

/** Create a new project label. Refreshes the project's label list. */
export function useCreateLabel(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateLabelInput) =>
      request<LabelDto>(`/projects/${projectId}/labels`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.labels(projectId) });
    },
  });
}

/**
 * Delete a project label. The server cascade-removes it from every issue, so we
 * also refresh the board and any open issue once the deletion lands.
 */
export function useDeleteLabel(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (labelId: string) =>
      request<void>(`/labels/${labelId}`, { method: 'DELETE' }),
    onSuccess: (_data, labelId) => {
      void qc.invalidateQueries({ queryKey: qk.labels(projectId) });
      void qc.invalidateQueries({ queryKey: qk.board(projectId) });
      // Drop the deleted label from any cached issue immediately.
      qc.setQueriesData<IssueDto>({ queryKey: ['issue'] }, (issue) =>
        issue && issue.labels
          ? { ...issue, labels: issue.labels.filter((l) => l.id !== labelId) }
          : issue,
      );
    },
  });
}

interface ToggleLabelInput {
  issueId: string;
  label: LabelDto;
  /** When true attach the label, otherwise detach it. */
  attached: boolean;
}

interface ToggleContext {
  previousIssue?: IssueDto;
  previousBoard?: BoardDto;
}

/**
 * Attach / detach a label on an issue with an optimistic update applied to both
 * the open issue and the board cache, so the drawer chips and the card chips
 * update instantly. Rolls back both on error.
 */
export function useToggleIssueLabel(projectId: string) {
  const qc = useQueryClient();

  return useMutation<void, Error, ToggleLabelInput, ToggleContext>({
    mutationFn: ({ issueId, label, attached }) =>
      attached
        ? request<void>(`/issues/${issueId}/labels`, {
            method: 'POST',
            body: { labelId: label.id },
          })
        : request<void>(`/issues/${issueId}/labels/${label.id}`, {
            method: 'DELETE',
          }),
    onMutate: async ({ issueId, label, attached }) => {
      const issueKey = qk.issue(issueId);
      const boardKey = qk.board(projectId);
      await Promise.all([
        qc.cancelQueries({ queryKey: issueKey }),
        qc.cancelQueries({ queryKey: boardKey }),
      ]);

      const previousIssue = qc.getQueryData<IssueDto>(issueKey);
      const previousBoard = qc.getQueryData<BoardDto>(boardKey);

      qc.setQueryData<IssueDto>(issueKey, (issue) =>
        issue ? withLabel(issue, label, attached) : issue,
      );
      qc.setQueryData<BoardDto>(boardKey, (board) =>
        board
          ? {
              ...board,
              issues: board.issues.map((i) =>
                i.id === issueId ? withLabel(i, label, attached) : i,
              ),
            }
          : board,
      );

      return { previousIssue, previousBoard };
    },
    onError: (_err, vars, ctx) => {
      if (ctx?.previousIssue)
        qc.setQueryData(qk.issue(vars.issueId), ctx.previousIssue);
      if (ctx?.previousBoard)
        qc.setQueryData(qk.board(projectId), ctx.previousBoard);
    },
    onSettled: (_data, _err, vars) => {
      void qc.invalidateQueries({ queryKey: qk.issue(vars.issueId) });
      void qc.invalidateQueries({ queryKey: qk.board(projectId) });
    },
  });
}

/** Pure helper: add or remove a label from an issue's label list. */
function withLabel(
  issue: IssueDto,
  label: LabelDto,
  attached: boolean,
): IssueDto {
  const current = issue.labels ?? [];
  if (attached) {
    if (current.some((l) => l.id === label.id)) return issue;
    return { ...issue, labels: [...current, label] };
  }
  return { ...issue, labels: current.filter((l) => l.id !== label.id) };
}
