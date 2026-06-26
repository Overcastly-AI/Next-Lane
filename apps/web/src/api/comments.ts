import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ActivityDto, CommentDto } from '@next-lane/shared';
import { request } from './client';
import { qk } from './keys';

export function useComments(issueId: string | undefined) {
  return useQuery({
    queryKey: qk.comments(issueId ?? ''),
    enabled: !!issueId,
    queryFn: () => request<CommentDto[]>(`/issues/${issueId}/comments`),
  });
}

export function useAddComment(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      request<CommentDto>(`/issues/${issueId}/comments`, {
        method: 'POST',
        body: { body },
      }),
    onSuccess: (comment) => {
      qc.setQueryData<CommentDto[]>(qk.comments(issueId), (prev) =>
        prev ? [...prev, comment] : [comment],
      );
    },
  });
}

export function useUpdateComment(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      request<CommentDto>(`/comments/${id}`, {
        method: 'PATCH',
        body: { body },
      }),
    onMutate: async ({ id, body }) => {
      await qc.cancelQueries({ queryKey: qk.comments(issueId) });
      const previous = qc.getQueryData<CommentDto[]>(qk.comments(issueId));
      qc.setQueryData<CommentDto[]>(qk.comments(issueId), (prev) =>
        prev?.map((c) => (c.id === id ? { ...c, body } : c)),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        qc.setQueryData(qk.comments(issueId), context.previous);
      }
    },
    onSuccess: (comment) => {
      qc.setQueryData<CommentDto[]>(qk.comments(issueId), (prev) =>
        prev?.map((c) => (c.id === comment.id ? comment : c)),
      );
    },
  });
}

export function useDeleteComment(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<void>(`/comments/${id}`, { method: 'DELETE' }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: qk.comments(issueId) });
      const previous = qc.getQueryData<CommentDto[]>(qk.comments(issueId));
      qc.setQueryData<CommentDto[]>(qk.comments(issueId), (prev) =>
        prev?.filter((c) => c.id !== id),
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        qc.setQueryData(qk.comments(issueId), context.previous);
      }
    },
  });
}

export function useActivity(issueId: string | undefined) {
  return useQuery({
    queryKey: qk.activity(issueId ?? ''),
    enabled: !!issueId,
    queryFn: () => request<ActivityDto[]>(`/issues/${issueId}/activity`),
  });
}
