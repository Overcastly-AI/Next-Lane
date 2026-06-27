import { useInfiniteQuery } from '@tanstack/react-query';
import type { AuditEventDto, PaginatedAuditEventsDto } from '@next-lane/shared';
import { request } from './client';

/** Re-export for consumers that don't import from shared. */
export type { AuditEventDto };

export function useAuditLog(workspaceId: string | undefined) {
  return useInfiniteQuery<PaginatedAuditEventsDto, Error>({
    queryKey: ['auditLog', workspaceId ?? ''],
    enabled: !!workspaceId,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: '50' });
      if (pageParam) params.set('cursor', pageParam as string);
      return request<PaginatedAuditEventsDto>(
        `/workspaces/${workspaceId!}/audit-log?${params.toString()}`,
      );
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
