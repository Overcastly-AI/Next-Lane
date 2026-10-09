import { useMemo } from 'react';
import {
  SprintState,
  StatusCategory,
  type ProjectDto,
  type UserDto,
} from '@next-lane/shared';
import { Avatar } from '@/components/ui/Avatar';
import { useSprints } from '@/api/meta';
import { useBoard } from '@/api/issues';
import { cn } from '@/lib/cn';

const MAX_AVATARS = 4;

/**
 * Sprint-aware project tile.
 *
 * Zero extra network cost: it reads the same `useSprints` / `useBoard` query
 * keys the dashboard's "Active sprints" card already fetches, so TanStack Query
 * dedupes them into one request per project. Anything that fails to load is
 * simply omitted — the card is still a perfectly good link.
 */
export function ProjectCard({
  project,
  onClick,
}: {
  project: ProjectDto;
  onClick: () => void;
}) {
  const sprintsQuery = useSprints(project.id);
  const boardQuery = useBoard(project.id);
  const loading = sprintsQuery.isLoading || boardQuery.isLoading;

  const stats = useMemo(() => {
    const board = boardQuery.data;
    if (!board) return null;
    const isDone = (statusId: string) =>
      board.statuses.find((s) => s.id === statusId)?.category ===
      StatusCategory.DONE;
    const open = board.issues.filter((i) => !isDone(i.statusId));
    const sprint =
      (sprintsQuery.data ?? []).find((s) => s.state === SprintState.ACTIVE) ??
      null;
    const sprintIssues = sprint
      ? board.issues.filter((i) => i.sprintId === sprint.id)
      : [];
    const done = sprintIssues.filter((i) => isDone(i.statusId)).length;
    const people = new Map<string, UserDto>();
    for (const i of open) {
      if (i.assignee && !people.has(i.assignee.id)) {
        people.set(i.assignee.id, i.assignee);
      }
    }
    return {
      open: open.length,
      truncated: board.issuesTruncated,
      sprint,
      done,
      total: sprintIssues.length,
      people: [...people.values()],
    };
  }, [boardQuery.data, sprintsQuery.data]);

  const pct =
    stats && stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;

  const summary = stats
    ? [
        `${stats.open}${stats.truncated ? '+' : ''} open`,
        stats.sprint
          ? `${stats.done} of ${stats.total} done in ${stats.sprint.name}`
          : 'no active sprint',
      ].join(', ')
    : '';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${project.name}, ${project.key}${summary ? `, ${summary}` : ''}`}
      className="group flex min-h-[10.5rem] flex-col gap-3 rounded-xl border border-ink-200 bg-surface p-4 text-left shadow-card transition-all duration-[120ms] hover:-translate-y-0.5 hover:border-signal-200 hover:shadow-cardHover focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      <span className="flex items-center justify-between gap-2">
        <span className="rounded border border-signal-100 bg-signal-50 px-2 py-0.5 font-mono text-xs font-semibold tracking-wide text-signal-700 transition-colors duration-[120ms] group-hover:bg-signal-100">
          {project.key}
        </span>
        {stats && (
          <span
            data-testid="project-card-open"
            className="text-xs tabular-nums text-ink-600"
          >
            <span className="font-semibold text-ink-800">
              {stats.open}
              {stats.truncated ? '+' : ''}
            </span>{' '}
            open
          </span>
        )}
      </span>

      <span className="min-w-0">
        <span className="block truncate font-semibold text-ink-900 transition-colors duration-[120ms] group-hover:text-signal-700">
          {project.name}
        </span>
        {project.description && (
          <span className="mt-0.5 line-clamp-2 block text-sm text-ink-600">
            {project.description}
          </span>
        )}
      </span>

      <span className="mt-auto block space-y-2 pt-1">
        {loading && (
          <span className="block space-y-2" aria-hidden="true">
            <span className="block h-3 w-1/2 animate-pulse rounded bg-ink-100" />
            <span className="block h-1.5 w-full animate-pulse rounded-full bg-ink-100" />
          </span>
        )}
        {!loading && stats?.sprint && (
          <span className="block space-y-1.5">
            <span className="flex items-baseline justify-between gap-2 text-xs">
              <span className="min-w-0 truncate font-medium text-ink-700">
                {stats.sprint.name}
              </span>
              <span className="shrink-0 tabular-nums text-ink-600">
                {stats.done}/{stats.total}
              </span>
            </span>
            <span
              aria-hidden="true"
              className="block h-1.5 w-full overflow-hidden rounded-full bg-ink-100"
            >
              <span
                className={cn(
                  'block h-full rounded-full transition-all motion-reduce:transition-none',
                  pct === 100 ? 'bg-green-500' : 'bg-brand-500',
                )}
                style={{ width: `${pct}%` }}
              />
            </span>
          </span>
        )}
        {!loading && stats && !stats.sprint && (
          <span className="block text-xs text-ink-500">No active sprint</span>
        )}
        {!loading && stats && stats.people.length > 0 && (
          <span className="flex items-center" aria-hidden="true">
            <span className="flex -space-x-1">
              {stats.people.slice(0, MAX_AVATARS).map((u) => (
                <Avatar key={u.id} user={u} size="sm" />
              ))}
            </span>
            {stats.people.length > MAX_AVATARS && (
              <span className="ml-1.5 text-xs text-ink-600">
                +{stats.people.length - MAX_AVATARS}
              </span>
            )}
          </span>
        )}
      </span>
    </button>
  );
}

/** Dashed "+ New project" cell that closes out the projects grid. */
export function NewProjectTile({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="new-project-tile"
      className="group flex min-h-[10.5rem] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-ink-300 bg-transparent p-4 text-center text-ink-600 transition-colors duration-[120ms] hover:border-signal-300 hover:bg-signal-50 hover:text-signal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400"
    >
      <span
        className="flex h-9 w-9 items-center justify-center rounded-full border border-current text-lg leading-none"
        aria-hidden="true"
      >
        +
      </span>
      <span className="text-sm font-semibold">New project</span>
      <span className="text-xs text-ink-500">
        A board, backlog and sprints
      </span>
    </button>
  );
}
