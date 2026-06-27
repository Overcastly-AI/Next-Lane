import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { BoardDto, IssueDto, LabelDto } from '@next-lane/shared';
import { request } from './client';
import { qk } from './keys';

export interface CreateLabelInput {
  name: string;
  color?: string;
}

export interface UpdateLabelInput {
  name?: string;
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
 * Update a label's name and/or color. Invalidates the project's label list and
 * patches any cached issue / board data so label chips update immediately.
 *
 * Pass `boardId` to also invalidate the board-view cache.
 */
export function useUpdateLabel(projectId: string, boardId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ labelId, input }: { labelId: string; input: UpdateLabelInput }) =>
      request<LabelDto>(`/labels/${labelId}`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: (updated) => {
      // Refresh the authoritative label list for this project.
      void qc.invalidateQueries({ queryKey: qk.labels(projectId) });
      // Patch any cached board so label chips on cards update immediately.
      void qc.invalidateQueries({ queryKey: qk.board(projectId) });
      if (boardId) {
        void qc.invalidateQueries({ queryKey: qk.boardView(boardId) });
      }
      // Patch any open issue that carries this label.
      qc.setQueriesData<IssueDto>({ queryKey: ['issue'] }, (issue) => {
        if (!issue?.labels) return issue;
        const hasLabel = issue.labels.some((l) => l.id === updated.id);
        if (!hasLabel) return issue;
        return {
          ...issue,
          labels: issue.labels.map((l) => (l.id === updated.id ? updated : l)),
        };
      });
    },
  });
}

/**
 * Delete a project label. The server cascade-removes it from every issue, so we
 * also refresh the board and any open issue once the deletion lands.
 *
 * Pass `boardId` to also invalidate the board-view cache.
 */
export function useDeleteLabel(projectId: string, boardId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (labelId: string) =>
      request<void>(`/labels/${labelId}`, { method: 'DELETE' }),
    onSuccess: (_data, labelId) => {
      void qc.invalidateQueries({ queryKey: qk.labels(projectId) });
      void qc.invalidateQueries({ queryKey: qk.board(projectId) });
      if (boardId) {
        void qc.invalidateQueries({ queryKey: qk.boardView(boardId) });
      }
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
 *
 * Pass `boardId` to also optimistically patch the `boardView` cache (the
 * board-id-keyed view used by the multi-board page).
 */
export function useToggleIssueLabel(projectId: string, boardId?: string) {
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
      const boardViewKey = boardId ? qk.boardView(boardId) : null;

      const cancelPromises = [
        qc.cancelQueries({ queryKey: issueKey }),
        qc.cancelQueries({ queryKey: boardKey }),
      ];
      if (boardViewKey) cancelPromises.push(qc.cancelQueries({ queryKey: boardViewKey }));
      await Promise.all(cancelPromises);

      const previousIssue = qc.getQueryData<IssueDto>(issueKey);
      const previousBoard = qc.getQueryData<BoardDto>(boardKey);

      // Patch helper that adds or removes the label from an issue list in a BoardDto.
      const patchBoard = (board: BoardDto): BoardDto => ({
        ...board,
        issues: board.issues.map((i) =>
          i.id === issueId ? withLabel(i, label, attached) : i,
        ),
      });

      qc.setQueryData<IssueDto>(issueKey, (issue) =>
        issue ? withLabel(issue, label, attached) : issue,
      );
      qc.setQueryData<BoardDto>(boardKey, (board) =>
        board ? patchBoard(board) : board,
      );
      if (boardViewKey) {
        qc.setQueryData<BoardDto>(boardViewKey, (board) =>
          board ? patchBoard(board) : board,
        );
      }

      return { previousIssue, previousBoard };
    },
    onError: (_err, vars, ctx) => {
      if (ctx?.previousIssue)
        qc.setQueryData(qk.issue(vars.issueId), ctx.previousIssue);
      if (ctx?.previousBoard)
        qc.setQueryData(qk.board(projectId), ctx.previousBoard);
      // Roll back boardView — just invalidate (no snapshot taken for it).
      if (boardId) {
        void qc.invalidateQueries({ queryKey: qk.boardView(boardId) });
      }
    },
    onSettled: (_data, _err, vars) => {
      void qc.invalidateQueries({ queryKey: qk.issue(vars.issueId) });
      void qc.invalidateQueries({ queryKey: qk.board(projectId) });
      if (boardId) {
        void qc.invalidateQueries({ queryKey: qk.boardView(boardId) });
      }
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
