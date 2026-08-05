import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { IssueLinkType } from '@next-lane/shared';
import type {
  IssueDto,
  RoadmapChildDto,
  RoadmapDto,
  RoadmapEpicChildrenDto,
} from '@next-lane/shared';
import { request } from './client';
import { qk } from './keys';

/**
 * Roadmap timeline payload for a project: epics (with derived windows +
 * progress), dated sprints, release milestones and BLOCKS dependencies —
 * composed server-side so the client just renders.
 */
export function useRoadmap(projectId: string | undefined) {
  return useQuery({
    queryKey: ['roadmap', projectId ?? ''],
    enabled: !!projectId,
    // `signal` so a refetch triggered by a drag can supersede an in-flight
    // read instead of racing it — the same class of failure that hid freshly
    // created share links (see api/share-tokens.ts).
    queryFn: ({ signal }) =>
      request<RoadmapDto>(`/projects/${projectId}/roadmap`, { signal }),
  });
}

/**
 * Children of one epic, fetched only when its row is expanded. Deliberately
 * not part of the roadmap payload: on a 500-epic project that would be tens of
 * thousands of rows on a read most people never expand.
 */
export function useEpicChildren(
  projectId: string | undefined,
  epicId: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['roadmap-epic-children', projectId ?? '', epicId ?? ''],
    enabled: !!projectId && !!epicId && enabled,
    queryFn: ({ signal }) =>
      request<RoadmapEpicChildrenDto>(
        `/projects/${projectId}/roadmap/epics/${epicId}/children`,
        { signal },
      ),
  });
}

/**
 * Children for EVERY currently-expanded epic, in one hook.
 *
 * The chart needs these at the top, not inside each row: the dependency-arrow
 * overlay is absolutely positioned, so the parent has to know exactly how tall
 * each expanded block is to compute row offsets. When each row fetched its own
 * children, the parent had no way to know a row was 3 children tall, every
 * epic below an expanded one got an offset that was too small, and the arrows
 * pointed at empty space.
 *
 * `useQueries` rather than a hook-in-a-loop because the set of expanded epics
 * changes at runtime and hook order may not.
 */
export function useExpandedEpicChildren(
  projectId: string | undefined,
  epicIds: string[],
): Map<string, RoadmapChildDto[] | undefined> {
  const results = useQueries({
    queries: epicIds.map((epicId) => ({
      queryKey: ['roadmap-epic-children', projectId ?? '', epicId],
      enabled: !!projectId,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        request<RoadmapEpicChildrenDto>(
          `/projects/${projectId}/roadmap/epics/${epicId}/children`,
          { signal },
        ),
    })),
  });

  const map = new Map<string, RoadmapChildDto[] | undefined>();
  epicIds.forEach((id, i) => map.set(id, results[i]?.data?.children));
  return map;
}

export interface ScheduleInput {
  issueId: string;
  /** ISO date, or null to clear. */
  startDate: string | null;
  /** ISO date, or null to clear. */
  dueDate: string | null;
  /** The epic whose expanded child list should refresh, when dragging a child. */
  parentEpicId?: string;
  /**
   * Set only when the drag also moved the item into a DIFFERENT epic. Sent as
   * `parentId`, which the issues endpoint already validates for
   * same-project-ness and hierarchy cycles.
   */
  newParentEpicId?: string;
}

/**
 * Commit a bar drag: write the new window onto the issue itself.
 *
 * Reuses `PATCH /issues/:id` rather than inventing a roadmap-specific write —
 * that endpoint already carries the permission checks, the start-before-due
 * validation, the activity log, and the realtime/webhook fan-out. A parallel
 * path would have had to re-earn all of it, and would have drifted.
 *
 * Refetching the roadmap afterwards is not bookkeeping: dragging a CHILD can
 * widen its parent epic server-side (`IssuesService.growParentEpicToFit`), so
 * the epic bar on screen is stale the moment the write lands, and no amount of
 * local optimism can predict the new window.
 */
export function useScheduleIssue(projectId: string) {
  const qc = useQueryClient();
  return useMutation<IssueDto, Error, ScheduleInput>({
    mutationFn: ({ issueId, startDate, dueDate, newParentEpicId }) =>
      request<IssueDto>(`/issues/${issueId}`, {
        method: 'PATCH',
        body: {
          startDate,
          dueDate,
          ...(newParentEpicId ? { parentId: newParentEpicId } : {}),
        },
      }),
    onSuccess: async (_updated, vars) => {
      await qc.cancelQueries({ queryKey: ['roadmap', projectId] });
      await qc.invalidateQueries({ queryKey: ['roadmap', projectId] });
      // BOTH epics, when a story changed hands: the one it left has a row too
      // many until it refetches, and the one it joined has a row too few.
      for (const epicId of [vars.parentEpicId, vars.newParentEpicId]) {
        if (!epicId) continue;
        void qc.invalidateQueries({
          queryKey: ['roadmap-epic-children', projectId, epicId],
        });
      }
      void qc.invalidateQueries({ queryKey: qk.issue(vars.issueId) });
      void qc.invalidateQueries({ queryKey: qk.board(projectId) });
    },
  });
}

/**
 * Create a BLOCKS dependency between two epics by dragging on the chart.
 *
 * The server owns every rule worth enforcing — self-links, cross-project
 * targets, duplicates and reverse-duplicates all come back as 400/404/409 with
 * a usable message — so this deliberately validates nothing beyond what the
 * gesture already guarantees, and surfaces the server's own wording.
 */
export function useLinkEpics(projectId: string) {
  const qc = useQueryClient();
  return useMutation<unknown, Error, { fromEpicId: string; toEpicId: string }>({
    mutationFn: ({ fromEpicId, toEpicId }) =>
      request(`/issues/${fromEpicId}/links`, {
        method: 'POST',
        body: { target: toEpicId, type: IssueLinkType.BLOCKS },
      }),
    onSuccess: async (_r, vars) => {
      await qc.cancelQueries({ queryKey: ['roadmap', projectId] });
      await qc.invalidateQueries({ queryKey: ['roadmap', projectId] });
      void qc.invalidateQueries({ queryKey: qk.issueLinks(vars.fromEpicId) });
      void qc.invalidateQueries({ queryKey: qk.issueLinks(vars.toEpicId) });
    },
  });
}

/** Remove a dependency drawn on the chart, by its `IssueLink` id. */
export function useUnlinkEpics(projectId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, { linkId: string; fromEpicId: string; toEpicId: string }>({
    mutationFn: ({ linkId }) =>
      request<void>(`/issue-links/${linkId}`, { method: 'DELETE' }),
    onSuccess: async (_r, vars) => {
      await qc.cancelQueries({ queryKey: ['roadmap', projectId] });
      await qc.invalidateQueries({ queryKey: ['roadmap', projectId] });
      void qc.invalidateQueries({ queryKey: qk.issueLinks(vars.fromEpicId) });
      void qc.invalidateQueries({ queryKey: qk.issueLinks(vars.toEpicId) });
    },
  });
}
