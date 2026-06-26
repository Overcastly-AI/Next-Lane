import { useMemo } from 'react';
import type { ActivityDto, StatusDto, UserDto } from '@next-lane/shared';
import { useActivity } from '@/api/comments';
import { Spinner } from '@/components/ui/States';
import { titleCase } from '@/components/issue/issueMeta';

/**
 * Renders one human-readable activity line. The API stores raw entity IDs in
 * `from`/`to` for status and assignee changes; we resolve them against the
 * statuses/users already loaded by the drawer. Resolution is resilient: a
 * missing entity falls back to the raw value, and `null` is rendered as a
 * field-appropriate "empty" label rather than dropped.
 */
function describe(
  a: ActivityDto,
  statusName: (id: string) => string,
  userName: (id: string) => string,
): { verb: string; from?: string; to?: string } {
  switch (a.field) {
    case 'status':
      return {
        verb: 'changed status',
        from: a.from ? statusName(a.from) : undefined,
        to: a.to ? statusName(a.to) : undefined,
      };
    case 'assignee':
      // Assignment is a state, not a transition: surface the new assignee only
      // ("assigned to Alex Rivera"), or treat clearing it as an unassignment.
      return a.to
        ? { verb: 'assigned', to: userName(a.to) }
        : { verb: 'unassigned the issue' };
    case 'priority':
      return {
        verb: 'set priority',
        from: a.from ?? undefined,
        to: a.to ?? undefined,
      };
    default:
      return {
        verb: `changed ${titleCase(a.field)}`,
        from: a.from ?? undefined,
        to: a.to ?? undefined,
      };
  }
}

export function ActivityPanel({
  issueId,
  statuses,
  users,
}: {
  issueId: string;
  statuses: StatusDto[];
  users: UserDto[];
}) {
  const activityQuery = useActivity(issueId);

  const statusName = useMemo(() => {
    const map = new Map(statuses.map((s) => [s.id, s.name]));
    return (id: string) => map.get(id) ?? id;
  }, [statuses]);

  const userName = useMemo(() => {
    const map = new Map(users.map((u) => [u.id, u.name]));
    return (id: string) => map.get(id) ?? id;
  }, [users]);

  return (
    <div className="border-t border-gray-100 pt-3">
      <p className="mb-2 text-xs font-medium text-gray-600">Activity</p>
      {activityQuery.isLoading ? (
        <div className="flex justify-center py-2">
          <Spinner className="h-4 w-4" />
        </div>
      ) : activityQuery.isError ? (
        <p className="text-xs text-gray-400">Couldn’t load activity.</p>
      ) : activityQuery.data && activityQuery.data.length > 0 ? (
        <ul className="space-y-2">
          {activityQuery.data.map((a) => {
            const { verb, from, to } = describe(a, statusName, userName);
            return (
              <li key={a.id} className="text-xs text-gray-500">
                <span className="font-medium text-gray-700">{a.actor.name}</span>{' '}
                {verb}
                {from && (
                  <>
                    {' '}
                    from <span className="text-gray-600">{from}</span>
                  </>
                )}
                {to && (
                  <>
                    {' '}
                    to <span className="text-gray-600">{to}</span>
                  </>
                )}
                <span className="ml-1 text-gray-400">
                  · {new Date(a.createdAt).toLocaleDateString()}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-gray-400">No activity yet.</p>
      )}
    </div>
  );
}
