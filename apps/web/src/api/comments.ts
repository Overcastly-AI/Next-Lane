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

export function useActivity(issueId: string | undefined) {
  return useQuery({
    queryKey: qk.activity(issueId ?? ''),
    enabled: !!issueId,
    queryFn: () => request<ActivityDto[]>(`/issues/${issueId}/activity`),
  });
}
