import { useActivity } from '@/api/comments';
import { Spinner } from '@/components/ui/States';
import { titleCase } from '@/components/issue/issueMeta';

export function ActivityPanel({ issueId }: { issueId: string }) {
  const activityQuery = useActivity(issueId);

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
          {activityQuery.data.map((a) => (
            <li key={a.id} className="text-xs text-gray-500">
              <span className="font-medium text-gray-700">{a.actor.name}</span>{' '}
              changed <span className="font-medium">{titleCase(a.field)}</span>
              {a.from && (
                <>
                  {' '}
                  from <span className="text-gray-600">{a.from}</span>
                </>
              )}
              {a.to && (
                <>
                  {' '}
                  to <span className="text-gray-600">{a.to}</span>
                </>
              )}
              <span className="ml-1 text-gray-400">
                · {new Date(a.createdAt).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-gray-400">No activity yet.</p>
      )}
    </div>
  );
}
