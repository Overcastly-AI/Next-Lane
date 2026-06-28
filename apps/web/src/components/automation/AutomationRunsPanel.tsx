/**
 * AutomationRunsPanel — Glass Box transparency surface.
 *
 * Renders the run audit trail for a project's automations (or a single rule).
 * Newest-first: rule name, issue key (linked), trigger, matched, status badge,
 * actionsApplied summary, error (if FAILED), timestamp.
 */
import { useNavigate } from 'react-router-dom';
import {
  AutomationRunStatus,
  AUTOMATION_TRIGGER_LABELS,
} from '@next-lane/shared';
import type { AutomationRunDto } from '@next-lane/shared';
import { useAutomationRuns } from '@/api/automations';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { Spinner } from '@/components/ui/States';
import { cn } from '@/lib/cn';

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<AutomationRunStatus, string> = {
  [AutomationRunStatus.SUCCESS]:
    'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  [AutomationRunStatus.SKIPPED]:
    'bg-ink-100 text-ink-500 ring-1 ring-ink-200',
  [AutomationRunStatus.FAILED]:
    'bg-red-50 text-red-700 ring-1 ring-red-200',
};

const STATUS_LABEL: Record<AutomationRunStatus, string> = {
  [AutomationRunStatus.SUCCESS]: 'Success',
  [AutomationRunStatus.SKIPPED]: 'Skipped',
  [AutomationRunStatus.FAILED]: 'Failed',
};

function RunStatusBadge({ status }: { status: AutomationRunStatus }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-[10px] font-semibold leading-none tracking-wide',
        STATUS_STYLES[status],
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Run row
// ---------------------------------------------------------------------------

function RunRow({ run, projectId }: { run: AutomationRunDto; projectId: string }) {
  const navigate = useNavigate();

  const ts = new Date(run.createdAt).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  function goToIssue() {
    if (!run.issueKey) return;
    navigate(`/projects/${projectId}/board?issue=${run.issueId}`);
  }

  return (
    <li
      data-testid="automation-run-row"
      className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-b border-ink-100 px-4 py-3 last:border-0 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
    >
      {/* Main info */}
      <div className="min-w-0 space-y-0.5">
        {/* Rule name + issue key */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="truncate text-sm font-semibold text-ink-800">
            {run.ruleName ?? run.ruleId}
          </span>
          {run.issueKey && (
            <button
              type="button"
              onClick={goToIssue}
              className="shrink-0 rounded text-xs font-mono font-semibold text-signal-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-300"
              title={`Open issue ${run.issueKey}`}
            >
              {run.issueKey}
            </button>
          )}
        </div>

        {/* Trigger + match */}
        <p className="text-xs text-ink-500">
          {AUTOMATION_TRIGGER_LABELS[run.trigger]} &middot;{' '}
          {run.matched ? (
            <span className="text-emerald-600">condition matched</span>
          ) : (
            <span className="text-ink-400">condition not matched</span>
          )}
        </p>

        {/* Actions applied */}
        {run.actionsApplied.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {run.actionsApplied.map((a, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-ink-500">
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  aria-hidden="true"
                  className="mt-0.5 shrink-0 text-emerald-500"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span>
                  <span className="font-medium">{a.type}</span>
                  {a.detail ? ` — ${a.detail}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* Error */}
        {run.status === AutomationRunStatus.FAILED && run.error && (
          <p className="mt-1 rounded bg-red-50 px-2 py-1 text-xs text-red-700">
            {run.error}
          </p>
        )}
      </div>

      {/* Status badge */}
      <div className="flex items-start pt-0.5">
        <RunStatusBadge status={run.status} />
      </div>

      {/* Timestamp — hidden on mobile, visible sm+ */}
      <div className="hidden items-start pt-0.5 sm:flex">
        <time
          dateTime={run.createdAt}
          className="whitespace-nowrap text-xs text-ink-400"
        >
          {ts}
        </time>
      </div>

      {/* Timestamp — visible mobile only below */}
      <p className="col-span-2 text-xs text-ink-400 sm:hidden">{ts}</p>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export interface AutomationRunsPanelProps {
  projectId: string;
  ruleId?: string;
  limit?: number;
}

export function AutomationRunsPanel({
  projectId,
  ruleId,
  limit = 50,
}: AutomationRunsPanelProps) {
  const runsQuery = useAutomationRuns(projectId, { ruleId, limit });

  if (runsQuery.isLoading) {
    return <LoadingState label="Loading run history…" />;
  }

  if (runsQuery.isError) {
    return (
      <ErrorState
        error={runsQuery.error}
        onRetry={() => void runsQuery.refetch()}
      />
    );
  }

  const runs = runsQuery.data ?? [];

  if (runs.length === 0) {
    return (
      <EmptyState
        title="No runs yet"
        description="When automations fire, each evaluation appears here — whether it matched, what it did, and any errors."
        icon={
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2" />
          </svg>
        }
      />
    );
  }

  return (
    <div data-testid="automation-runs">
      <div className="mb-2 flex items-center justify-between px-4 pt-1">
        <p className="text-xs text-ink-400">
          Showing {runs.length} most-recent evaluation{runs.length !== 1 ? 's' : ''} — newest first.
        </p>
        {runsQuery.isFetching && <Spinner className="h-4 w-4" />}
      </div>
      <ul className="divide-y divide-ink-100">
        {runs.map((run) => (
          <RunRow key={run.id} run={run} projectId={projectId} />
        ))}
      </ul>
    </div>
  );
}
