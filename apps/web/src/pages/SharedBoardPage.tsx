import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import type { IssueDto, StatusDto } from '@next-lane/shared';
import { usePublicBoard } from '@/api/share-tokens';
import { IssueCard } from '@/components/board/IssueCard';
import { LoadingState } from '@/components/ui/States';
import { cn } from '@/lib/cn';

// ── Column status dot ────────────────────────────────────────────────────────

const CATEGORY_DOT: Record<string, string> = {
  TODO: 'bg-gray-400',
  IN_PROGRESS: 'bg-blue-500',
  DONE: 'bg-green-500',
};

// ── Read-only board column ────────────────────────────────────────────────────

function ReadOnlyColumn({
  status,
  issues,
}: {
  status: StatusDto;
  issues: IssueDto[];
}) {
  return (
    <div className="flex w-72 shrink-0 flex-col rounded-xl bg-gray-100/70">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span
          className={cn(
            'h-2 w-2 rounded-full',
            CATEGORY_DOT[status.category] ?? 'bg-gray-400',
          )}
        />
        <span className="truncate text-xs font-semibold uppercase tracking-wide text-gray-600">
          {status.name}
        </span>
        <span className="ml-auto rounded-full bg-gray-200 px-1.5 text-xs font-medium text-gray-500">
          {issues.length}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
        {issues.length === 0 ? (
          <p className="py-6 text-center text-xs text-gray-400">No issues</p>
        ) : (
          issues.map((issue) => (
            <IssueCard
              key={issue.id}
              issue={issue}
              // No onClick — read-only, no drawer
              style={{ cursor: 'default' }}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── Error / invalid token view ────────────────────────────────────────────────

function ShareErrorView({ message }: { message: string }) {
  const isRevoked =
    message.toLowerCase().includes('revoked') ||
    message.toLowerCase().includes('not found');
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 shadow-card text-center">
        <div className="mb-4 flex justify-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-red-500"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <path strokeLinecap="round" d="M15 9l-6 6M9 9l6 6" />
            </svg>
          </span>
        </div>
        <h1 className="mb-2 text-lg font-semibold text-gray-900">
          {isRevoked ? 'Link revoked or invalid' : 'Board unavailable'}
        </h1>
        <p className="text-sm text-gray-500">
          {isRevoked
            ? 'This share link has been revoked or is no longer valid. Please ask the project owner for a new link.'
            : message}
        </p>
      </div>
    </div>
  );
}

// ── Main shared board page ────────────────────────────────────────────────────

/**
 * Standalone read-only board view at /share/:token. No authentication required.
 *
 * Fetches the public board snapshot and renders a non-interactive board:
 * - No drag-and-drop (DndContext omitted entirely)
 * - No "create issue" button
 * - No drawer / edit affordances
 * - A read-only banner across the top
 *
 * Existing authenticated BoardPage behavior is not touched.
 */
export function SharedBoardPage() {
  const { token = '' } = useParams();
  const boardQuery = usePublicBoard(token);
  const board = boardQuery.data;

  // Sort statuses by order and group issues per column.
  const statuses = useMemo<StatusDto[]>(
    () => (board ? [...board.statuses].sort((a, b) => a.order - b.order) : []),
    [board],
  );

  const issuesByStatus = useMemo(() => {
    const map = new Map<string, IssueDto[]>();
    if (!board) return map;
    for (const s of statuses) map.set(s.id, []);
    for (const issue of board.issues) {
      const arr = map.get(issue.statusId);
      if (arr) arr.push(issue);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
    }
    return map;
  }, [board, statuses]);

  // ── Loading ────────────────────────────────────────────────────────────────

  if (boardQuery.isLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50">
        <LoadingState label="Loading shared board…" />
      </div>
    );
  }

  // ── Error / not found ──────────────────────────────────────────────────────

  if (boardQuery.isError || !board) {
    const message =
      boardQuery.error?.message ?? 'This share link is not valid.';
    return <ShareErrorView message={message} />;
  }

  // ── Board ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen flex-col overflow-x-clip bg-gray-50">
      {/* Read-only banner */}
      <header
        data-testid="shared-board-header"
        className="flex shrink-0 items-center justify-between gap-4 border-b border-gray-200 bg-white px-4 py-3 shadow-sm"
      >
        <div className="flex min-w-0 items-center gap-3">
          {/* Minimal brand mark */}
          <span className="text-lg font-bold tracking-tight text-brand-600">
            Next Lane
          </span>
          <span className="text-gray-300">|</span>
          <span className="min-w-0 truncate text-sm font-semibold text-gray-900">
            {board.project.name}
          </span>
          <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-500">
            {board.project.key}
          </span>
        </div>

        {/* Read-only badge */}
        <span
          data-testid="readonly-badge"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-medium text-gray-500"
          aria-label="Read-only shared view"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          Read-only shared view
        </span>
      </header>

      {/* Board columns */}
      <main className="flex flex-1 gap-4 overflow-x-auto p-4">
        {statuses.length === 0 ? (
          <div className="flex w-full items-center justify-center">
            <p className="text-sm text-gray-400">This board has no columns yet.</p>
          </div>
        ) : (
          statuses.map((status) => (
            <ReadOnlyColumn
              key={status.id}
              status={status}
              issues={issuesByStatus.get(status.id) ?? []}
            />
          ))
        )}
      </main>
    </div>
  );
}
