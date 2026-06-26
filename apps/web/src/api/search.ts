import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { SearchResultsDto } from '@next-lane/shared';
import { request } from './client';

/**
 * Cross-project search. Disabled (and not fired) until the query has at least
 * one non-whitespace character so an empty palette doesn't hammer the API.
 */
export function useSearch(query: string) {
  const q = query.trim();
  return useQuery<SearchResultsDto, Error>({
    queryKey: ['search', q],
    enabled: q.length > 0,
    // Keep prior results on screen while the next query loads (smoother typing).
    placeholderData: keepPreviousData,
    staleTime: 10 * 1000,
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ q });
      return request<SearchResultsDto>(`/search?${params.toString()}`, {
        signal,
      });
    },
  });
}
