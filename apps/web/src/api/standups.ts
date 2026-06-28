import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { StandupEntryDto } from '@next-lane/shared';
import { request } from './client';

// ---------------------------------------------------------------------------
// Query key factory — scoped to standups so invalidation is precise.
// ---------------------------------------------------------------------------

export const standupKeys = {
  /** All standup entries for a project on a given date (team digest). */
  digest: (projectId: string, date: string) =>
    ['standups', 'digest', projectId, date] as const,
  /** The caller's own entry for a project on a given date. */
  mine: (projectId: string, date: string) =>
    ['standups', 'mine', projectId, date] as const,
  /** Prefill suggestions derived from recent activity. */
  prefill: (projectId: string) =>
    ['standups', 'prefill', projectId] as const,
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * All standup entries for a project on `date` (everyone's, for the team
 * digest). `date` must be a YYYY-MM-DD string. Includes the `user` relation.
 */
export function useStandups(
  projectId: string | undefined,
  date: string,
) {
  return useQuery({
    queryKey: standupKeys.digest(projectId ?? '', date),
    enabled: !!projectId && !!date,
    queryFn: () =>
      request<StandupEntryDto[]>(
        `/projects/${projectId}/standups?date=${encodeURIComponent(date)}`,
      ),
  });
}

/**
 * The caller's own standup entry for a project on `date`, or `null` when they
 * have not posted yet. `date` must be a YYYY-MM-DD string.
 */
export function useMyStandup(
  projectId: string | undefined,
  date: string,
) {
  return useQuery({
    queryKey: standupKeys.mine(projectId ?? '', date),
    enabled: !!projectId && !!date,
    queryFn: () =>
      request<StandupEntryDto | null>(
        `/projects/${projectId}/standups/me?date=${encodeURIComponent(date)}`,
      ),
  });
}

export interface StandupPrefillDto {
  yesterday: string;
  today: string;
}

/**
 * Suggested text derived from the caller's recent activity (issues closed
 * yesterday, in-progress today). Used to pre-populate the standup form;
 * the user reviews and edits before saving.
 */
export function useStandupPrefill(projectId: string | undefined) {
  return useQuery({
    queryKey: standupKeys.prefill(projectId ?? ''),
    enabled: !!projectId,
    // Prefill is advisory — don't refetch on window focus so it stays stable
    // while the user is editing the form.
    refetchOnWindowFocus: false,
    // Disable automatic fetching — callers trigger this on demand via
    // queryClient.fetchQuery / refetch; we keep enabled so that data is
    // cached once fetched.
    queryFn: () =>
      request<StandupPrefillDto>(`/projects/${projectId}/standups/prefill`),
  });
}

export interface SubmitStandupInput {
  date?: string;
  yesterday?: string;
  today?: string;
  blockers?: string;
  blockerIssueIds?: string[];
}

/**
 * Upsert the caller's standup entry for a project (POST = create-or-update).
 * Invalidates both the digest and the caller's own entry for the submitted date.
 */
export function useSubmitStandup(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SubmitStandupInput) =>
      request<StandupEntryDto>(`/projects/${projectId}/standups`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: (entry) => {
      const date = entry.date;
      // Patch the caller's own-entry cache immediately so the UI reflects the
      // save without waiting for a network round-trip.
      qc.setQueryData<StandupEntryDto | null>(
        standupKeys.mine(projectId, date),
        entry,
      );
      // Patch the digest list: upsert this entry by userId so the team card
      // updates immediately.
      qc.setQueryData<StandupEntryDto[]>(
        standupKeys.digest(projectId, date),
        (prev) => {
          if (!prev) return [entry];
          const exists = prev.some((e) => e.userId === entry.userId);
          return exists
            ? prev.map((e) => (e.userId === entry.userId ? entry : e))
            : [...prev, entry];
        },
      );
      // Invalidate to reconcile with server.
      void qc.invalidateQueries({
        queryKey: standupKeys.digest(projectId, date),
      });
      void qc.invalidateQueries({
        queryKey: standupKeys.mine(projectId, date),
      });
    },
  });
}
