import { useQuery } from '@tanstack/react-query';
import type { MyWorkDto } from '@next-lane/shared';
import { request } from './client';
import { qk } from './keys';

/** The current user's work (assigned + reported) across all their workspaces. */
export function useMyWork() {
  return useQuery<MyWorkDto, Error>({
    queryKey: qk.myWork,
    queryFn: ({ signal }) => request<MyWorkDto>('/me/work', { signal }),
  });
}
