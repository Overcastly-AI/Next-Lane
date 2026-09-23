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
        <h1 className="text-xl font-semibold text-ink-900">My Work</h1>
        <p className="mt-1 text-sm text-ink-600">
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
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-600">
          {title}
        </h2>
        <Badge>{count}</Badge>
      </div>
      {issues.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
      ) : (
        <ul className="divide-y divide-ink-100 overflow-hidden rounded-xl border border-ink-200 bg-surface">
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
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-ink-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-400"
      >
        <IssueTypeIcon type={issue.type} />
        <span className="shrink-0 font-mono text-xs text-ink-500">
          {issue.key}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-ink-800">
          {issue.title}
        </span>
        {/*
         * Fixed-width metadata columns. Everything after the title — sprint,
         * due-date/overdue, status, project, priority — sits in one grid
         * with fixed pixel tracks, so each column (StatusPill in particular)
         * always lands at the same x no matter which optional chips are
         * present in a given row, or how long any chip's own text is. A
         * single flex row with auto-width siblings can't guarantee that: the
         * flex-1 title would absorb whatever space those siblings don't use,
         * shifting every column that follows.
         * `contents` on mobile lets the (hidden) chips drop out of flow
         * entirely below `sm`, leaving just the always-visible StatusPill;
         * `sm:grid` with fixed tracks takes over at the breakpoint where the
         * rest render.
         */}
        <span
          className="contents sm:grid sm:shrink-0 sm:items-center sm:gap-2"
          style={{ gridTemplateColumns: '100px 96px 92px 56px 24px' }}
        >
          <span className="hidden min-w-0 sm:flex sm:items-center sm:justify-start">
            {issue.sprintName && (
              <Badge className="max-w-full truncate">{issue.sprintName}</Badge>
            )}
          </span>
          <span className="hidden min-w-0 sm:flex sm:items-center sm:justify-start">
            {overdue ? (
              <span
                aria-label="Overdue"
                className="inline-flex shrink-0 items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800"
              >
                {/* Calendar icon */}
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <path strokeLinecap="round" d="M16 2v4M8 2v4M3 10h18" />
                </svg>
                Overdue
              </span>
            ) : issue.dueDate ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded bg-ink-100 px-1.5 py-0.5 text-[11px] font-medium text-ink-600">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <path strokeLinecap="round" d="M16 2v4M8 2v4M3 10h18" />
                </svg>
                {new Date(issue.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
            ) : null}
          </span>
          <StatusPill category={issue.statusCategory} name={issue.statusName} />
          <span className="hidden min-w-0 sm:flex sm:items-center sm:justify-start">
            <Badge className="max-w-full truncate font-mono">{issue.projectKey}</Badge>
          </span>
          <span className="hidden min-w-0 sm:flex sm:items-center sm:justify-start">
            <PriorityIcon priority={issue.priority} className="h-4 w-4" />
          </span>
        </span>
      </button>
    </li>
  );
}

const CATEGORY_PILL: Record<StatusCategory, string> = {
  [StatusCategory.TODO]: 'bg-ink-100 text-ink-600',
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
        'inline-block max-w-full shrink-0 truncate rounded-full px-2 py-0.5 text-[11px] font-medium leading-none sm:justify-self-start',
        CATEGORY_PILL[category],
      )}
    >
      {name}
    </span>
  );
}
