import type React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { StatusCategory, type MyWorkIssueDto } from '@next-lane/shared';
import { AppHeader } from '@/components/AppHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { IssueTypeIcon, PriorityIcon } from '@/components/issue/issueMeta';
import { useMyWork } from '@/api/me';
import { cn } from '@/lib/cn';

/** True when an issue is past its due date and not in a Done-category status. */
function isIssueOverdue(issue: MyWorkIssueDto): boolean {
  if (!issue.dueDate) return false;
  if (issue.statusCategory === StatusCategory.DONE) return false;
  return new Date(issue.dueDate) < new Date();
}

/** Sort overdue issues to the top, then by updatedAt descending (default API order). */
function sortByOverdueThenUpdated(issues: MyWorkIssueDto[]): MyWorkIssueDto[] {
  return [...issues].sort((a, b) => {
    const aOver = isIssueOverdue(a) ? 0 : 1;
    const bOver = isIssueOverdue(b) ? 0 : 1;
    if (aOver !== bOver) return aOver - bOver;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

export function MyWorkPage() {
  const navigate = useNavigate();
  const query = useMyWork();

  const open = (issue: MyWorkIssueDto) =>
    navigate(`/projects/${issue.projectId}/board?issue=${issue.id}`);

  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">My Work</h1>
        <p className="mt-1 text-sm text-slate-500">
          Your issues across every project you belong to.
        </p>
      </div>

      {query.isLoading && <LoadingState label="Loading your work…" />}

      {query.isError && (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      )}

      {query.isSuccess && (
        <div className="space-y-8">
          {query.data.assigned.length === 0 &&
            query.data.reported.length === 0 && (
              <div data-testid="my-work-empty">
                <EmptyState
                  title="No work items yet"
                  description="Issues assigned to you or reported by you across all projects will appear here."
                  icon={
                    <svg
                      className="h-10 w-10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      aria-hidden="true"
                    >
                      <rect x="3" y="4" width="18" height="16" rx="2" />
                      <path strokeLinecap="round" d="M7 9h10M7 13h6" />
                    </svg>
                  }
                />
              </div>
            )}
          <Section
            title="Assigned to me"
            count={query.data.assigned.length}
            issues={sortByOverdueThenUpdated(query.data.assigned)}
            onOpen={open}
            emptyTitle="Nothing assigned to you yet"
            emptyDescription="Issues assigned to you will show up here."
            emptyAction={
              <Link to="/">
                <Button size="sm" variant="secondary">
                  Go to board
                </Button>
              </Link>
            }
          />
          <Section
            title="Reported by me"
            count={query.data.reported.length}
            issues={sortByOverdueThenUpdated(query.data.reported)}
            onOpen={open}
            emptyTitle="You haven't reported any issues"
            emptyDescription="Issues you create will show up here."
            emptyAction={
              <Link to="/">
                <Button size="sm" variant="secondary">
                  Go to board
                </Button>
              </Link>
            }
          />
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-4xl px-4 py-8">{children}</main>
    </div>
  );
}

function Section({
  title,
  count,
  issues,
  onOpen,
  emptyTitle,
  emptyDescription,
  emptyAction,
}: {
  title: string;
  count: number;
  issues: MyWorkIssueDto[];
  onOpen: (issue: MyWorkIssueDto) => void;
  emptyTitle: string;
  emptyDescription: string;
  emptyAction?: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {title}
        </h2>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
          {count}
        </span>
      </div>
      {issues.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {issues.map((issue) => (
            <IssueRow key={issue.id} issue={issue} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </section>
  );
}

function IssueRow({
  issue,
  onOpen,
}: {
  issue: MyWorkIssueDto;
  onOpen: (issue: MyWorkIssueDto) => void;
}) {
  const overdue = isIssueOverdue(issue);
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(issue)}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-slate-50"
      >
        <IssueTypeIcon type={issue.type} />
        <span className="shrink-0 font-mono text-xs text-slate-400">
          {issue.key}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-slate-800">
          {issue.title}
        </span>
        {overdue && (
          <span
            aria-label="Overdue"
            className="hidden shrink-0 items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 sm:inline-flex"
          >
            {/* Calendar icon */}
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path strokeLinecap="round" d="M16 2v4M8 2v4M3 10h18" />
            </svg>
            Overdue
          </span>
        )}
        {!overdue && issue.dueDate && (
          <span className="hidden shrink-0 items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 sm:inline-flex">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path strokeLinecap="round" d="M16 2v4M8 2v4M3 10h18" />
            </svg>
            {new Date(issue.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </span>
        )}
        {issue.sprintName && (
          <Badge className="hidden sm:inline-flex">{issue.sprintName}</Badge>
        )}
        <StatusPill category={issue.statusCategory} name={issue.statusName} />
        <Badge className="hidden font-mono sm:inline-flex">
          {issue.projectKey}
        </Badge>
        <PriorityIcon priority={issue.priority} className="hidden h-4 w-4 sm:flex" />
      </button>
    </li>
  );
}

const CATEGORY_PILL: Record<StatusCategory, string> = {
  [StatusCategory.TODO]: 'bg-slate-100 text-slate-600',
  [StatusCategory.IN_PROGRESS]: 'bg-blue-100 text-blue-700',
  [StatusCategory.DONE]: 'bg-green-100 text-green-700',
};

function StatusPill({
  category,
  name,
}: {
  category: StatusCategory;
  name: string;
}) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium leading-none',
        CATEGORY_PILL[category],
      )}
    >
      {name}
    </span>
  );
}
