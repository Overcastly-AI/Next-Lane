import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IssueLinkType, type IssueLinkDto } from '@next-lane/shared';
import { request } from './client';
import { qk } from './keys';

export { IssueLinkType };

export function useIssueLinks(issueId: string | undefined) {
  return useQuery({
    queryKey: qk.issueLinks(issueId ?? ''),
    enabled: !!issueId,
    queryFn: () => request<IssueLinkDto[]>(`/issues/${issueId}/links`),
  });
}

export interface AddIssueLinkInput {
  /** Issue key (e.g. "NL-5") or id of the target issue. */
  target: string;
  type: IssueLinkType;
}

export function useAddIssueLink(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AddIssueLinkInput) =>
      request<IssueLinkDto>(`/issues/${issueId}/links`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.issueLinks(issueId) });
      void qc.invalidateQueries({ queryKey: qk.issue(issueId) });
    },
  });
}

export function useRemoveIssueLink(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (linkId: string) =>
      request<void>(`/issue-links/${linkId}`, { method: 'DELETE' }),
    onMutate: async (linkId) => {
      await qc.cancelQueries({ queryKey: qk.issueLinks(issueId) });
      const previous = qc.getQueryData<IssueLinkDto[]>(
        qk.issueLinks(issueId),
      );
      qc.setQueryData<IssueLinkDto[]>(qk.issueLinks(issueId), (prev) =>
        prev?.filter((l) => l.id !== linkId),
      );
      return { previous };
    },
    onError: (_err, _linkId, context) => {
      if (context?.previous) {
        qc.setQueryData(qk.issueLinks(issueId), context.previous);
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.issueLinks(issueId) });
      void qc.invalidateQueries({ queryKey: qk.issue(issueId) });
    },
  });
}
