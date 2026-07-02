import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  POKER_DECK,
  PokerState,
  type IssueDto,
  type PokerItemDto,
  type PokerVoteDto,
} from '@next-lane/shared';
import {
  usePokerSession,
  usePokerRealtime,
  useCastVote,
  useRevealItem,
  useCommitEstimate,
  useUpdatePokerSession,
} from '@/api/poker';
import { useIssue } from '@/api/issues';
import { useUsers } from '@/api/meta';
import { useBoard } from '@/api/issues';
import { useMyRole } from '@/api/workspaces';
import { canEdit } from '@/lib/permissions';
import { AppHeader } from '@/components/AppHeader';
import { ProjectBreadcrumb } from '@/components/project/ProjectBreadcrumb';
import { ProjectNav } from '@/components/project/ProjectNav';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { IssueTypeIcon, PriorityIcon } from '@/components/issue/issueMeta';
import { errorMessage } from '@/lib/errorMessage';
import { useAuth } from '@/auth/AuthContext';
import { cn } from '@/lib/cn';

export function PokerSessionPage() {
  const { projectId = '', sessionId = '' } = useParams();
  const sessionQuery = usePokerSession(sessionId);
  const usersQuery = useUsers();
  const boardQuery = useBoard(projectId);
  const { user } = useAuth();
  const toast = useToast();

  const myRole = useMyRole(boardQuery.data?.project.workspaceId);
  const editable = canEdit(myRole);

  // Subscribe to realtime poker events.
  usePokerRealtime(projectId, sessionId);

  const session = sessionQuery.data;
  const users = usersQuery.data ?? [];

  const updateSession = useUpdatePokerSession(sessionId, projectId);
  const revealItem = useRevealItem(sessionId);
  const commitEstimate = useCommitEstimate(sessionId);

  const [commitValue, setCommitValue] = useState<string>('');

  const activeItem = useMemo(() => {
    if (!session?.activeItemId || !session.items) return null;
    return session.items.find((i) => i.id === session.activeItemId) ?? null;
  }, [session]);

  const sortedItems = useMemo(() => {
    if (!session?.items) return [];
    return [...session.items].sort((a, b) => a.order - b.order);
  }, [session]);

  // My vote on the active item.
  const myVote = useMemo(() => {
    if (!activeItem?.votes || !user) return null;
    return activeItem.votes.find((v) => v.userId === user.id) ?? null;
  }, [activeItem, user]);

  const isClosed = session?.state === PokerState.CLOSED;
  const isRevealed = activeItem?.revealed ?? false;
  const canVote = editable && !!activeItem && !isRevealed && !isClosed;

  function handleSetActive(itemId: string) {
    if (!editable) return;
    updateSession.mutate(
      { activeItemId: itemId },
      {
        onError: (err) =>
          toast.error(errorMessage(err, 'Could not update active item.')),
      },
    );
  }

  function handleReveal() {
    if (!activeItem || !editable) return;
    revealItem.mutate(activeItem.id, {
      onError: (err) =>
        toast.error(errorMessage(err, 'Could not reveal votes.')),
    });
  }

  function handleCommit() {
    if (!activeItem || !editable) return;
    const num = parseFloat(commitValue);
    if (isNaN(num)) {
      toast.error('Enter a valid number for the estimate.');
      return;
    }
    commitEstimate.mutate(
      { itemId: activeItem.id, finalEstimate: num },
      {
        onSuccess: () => {
          toast.success('Estimate committed.');
          setCommitValue('');
          // Auto-advance to next item without a final estimate.
          const nextItem = sortedItems.find(
            (i) => i.id !== activeItem.id && i.finalEstimate === null,
          );
          if (nextItem) {
            handleSetActive(nextItem.id);
          }
        },
        onError: (err) =>
          toast.error(errorMessage(err, 'Could not commit estimate.')),
      },
    );
  }

  function handleCloseSession() {
    if (!editable) return;
    updateSession.mutate(
      { state: PokerState.CLOSED },
      {
        onSuccess: () => toast.success('Session closed.'),
        onError: (err) =>
          toast.error(errorMessage(err, 'Could not close session.')),
      },
    );
  }

  if (sessionQuery.isLoading) {
    return (
      <Shell projectId={projectId} projectName={boardQuery.data?.project.name}>
        <LoadingState label="Loading poker session…" />
      </Shell>
    );
  }

  if (sessionQuery.isError || !session) {
    return (
      <Shell projectId={projectId} projectName={boardQuery.data?.project.name}>
        <ErrorState
          error={sessionQuery.error ?? new Error('Session not found')}
          onRetry={() => sessionQuery.refetch()}
        />
      </Shell>
    );
  }

  return (
    <Shell
      projectId={projectId}
      projectName={boardQuery.data?.project.name}
      sessionName={session.name ?? 'Planning Poker'}
    >
      <div
        data-testid="poker-session"
        className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 sm:p-6"
      >
        {/* Session header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-lg font-semibold text-ink-900">
              {session.name ?? 'Planning Poker'}
            </h1>
            <p className="text-sm text-ink-500">
              {isClosed
                ? 'Session closed.'
                : session.state === PokerState.VOTING
                  ? 'Voting in progress — pick your card.'
                  : 'Cards revealed — discuss and commit.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {editable && !isClosed && (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleCloseSession}
                loading={updateSession.isPending}
              >
                Close session
              </Button>
            )}
            {isClosed && (
              <Badge className="bg-ink-100 text-ink-500">Closed</Badge>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
          {/* Left: active item + voting */}
          <div className="flex flex-col gap-4">
            {activeItem ? (
              <ActiveItemCard
                item={activeItem}
                myVote={myVote}
                canVote={canVote}
                isRevealed={isRevealed}
                editable={editable}
                isClosed={isClosed}
                sessionId={sessionId}
                users={users}
                sortedItems={sortedItems}
                commitValue={commitValue}
                onCommitValueChange={setCommitValue}
                onReveal={handleReveal}
                onCommit={handleCommit}
                onSetActive={handleSetActive}
                revealPending={revealItem.isPending}
                commitPending={commitEstimate.isPending}
              />
            ) : (
              <EmptyState
                title="No active item"
                description={
                  editable
                    ? 'Select an item from the list to begin voting.'
                    : 'Waiting for the facilitator to select an item.'
                }
              />
            )}
          </div>

          {/* Right: item list */}
          <div className="flex flex-col gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-400">
              Items ({sortedItems.length})
            </h2>
            {sortedItems.length === 0 ? (
              <EmptyState
                title="No items"
                description="Add issues to estimate."
              />
            ) : (
              <ul className="flex flex-col gap-1.5">
                {sortedItems.map((item) => (
                  <PokerItemRow
                    key={item.id}
                    item={item}
                    isActive={item.id === session.activeItemId}
                    editable={editable}
                    onClick={() => handleSetActive(item.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </Shell>
  );
}

// ── ActiveItemCard ─────────────────────────────────────────────────────────────

function ActiveItemCard({
  item,
  myVote,
  canVote,
  isRevealed,
  editable,
  isClosed,
  sessionId,
  users,
  sortedItems,
  commitValue,
  onCommitValueChange,
  onReveal,
  onCommit,
  onSetActive,
  revealPending,
  commitPending,
}: {
  item: PokerItemDto;
  myVote: PokerVoteDto | null;
  canVote: boolean;
  isRevealed: boolean;
  editable: boolean;
  isClosed: boolean;
  sessionId: string;
  users: Array<{ id: string; name: string; avatarColor: string }>;
  sortedItems: PokerItemDto[];
  commitValue: string;
  onCommitValueChange: (v: string) => void;
  onReveal: () => void;
  onCommit: () => void;
  onSetActive: (id: string) => void;
  revealPending: boolean;
  commitPending: boolean;
}) {
  const votes = item.votes ?? [];
  const votedUserIds = new Set(votes.map((v) => v.userId));

  // Distribution summary (for revealed state).
  const distribution = useMemo(() => {
    if (!isRevealed) return null;
    const counts = new Map<string, number>();
    for (const v of votes) {
      counts.set(v.value, (counts.get(v.value) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [isRevealed, votes]);

  // Average of numeric votes.
  const average = useMemo(() => {
    if (!isRevealed) return null;
    const nums = votes
      .map((v) => parseFloat(v.value))
      .filter((n) => !isNaN(n));
    if (nums.length === 0) return null;
    return (nums.reduce((s, n) => s + n, 0) / nums.length).toFixed(1);
  }, [isRevealed, votes]);

  const currentIndex = sortedItems.findIndex((i) => i.id === item.id);
  const prevItem = currentIndex > 0 ? sortedItems[currentIndex - 1] : null;
  const nextItem =
    currentIndex < sortedItems.length - 1
      ? sortedItems[currentIndex + 1]
      : null;

  const castVote = useCastVote(item.id, sessionId);

  function handleVote(card: string) {
    if (!canVote) return;
    castVote.mutate(card);
  }

  return (
    <IssueCardWrapper issueId={item.issueId}>
      {(issue) => (
        <div className="rounded-xl border border-ink-200 bg-surface shadow-card">
          {/* Issue header */}
          <div className="flex items-start gap-3 border-b border-ink-100 px-5 py-4">
            <IssueTypeIcon
              type={issue.type}
              className="mt-0.5 h-5 w-5 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-medium text-signal-600">
                  {issue.key}
                </span>
                <PriorityIcon priority={issue.priority} className="h-3.5 w-3.5" />
              </div>
              <h3 className="mt-0.5 text-base font-semibold text-ink-900">
                {issue.title}
              </h3>
              {issue.description && (
                <p className="mt-1 line-clamp-3 text-sm text-ink-500">
                  {issue.description}
                </p>
              )}
            </div>
            {item.finalEstimate !== null && (
              <span
                title="Final estimate"
                className="ml-auto shrink-0 rounded-full bg-signal-100 px-2.5 py-0.5 font-mono text-sm font-bold text-signal-700"
              >
                {item.finalEstimate} pts
              </span>
            )}
          </div>

          {/* Participant strip */}
          <div className="border-b border-ink-100 px-5 py-3">
            <p
              data-testid="poker-vote-status"
              className="mb-2 text-xs font-semibold uppercase tracking-widest text-ink-400"
            >
              Votes ({votes.length})
            </p>
            <div className="flex flex-wrap gap-3">
              {users.length === 0 ? (
                <span className="text-xs text-ink-400">No participants yet.</span>
              ) : (
                users.map((u) => {
                  const voted = votedUserIds.has(u.id);
                  const userVote = votes.find((v) => v.userId === u.id);
                  return (
                    <div
                      key={u.id}
                      className="flex flex-col items-center gap-1"
                      title={u.name}
                    >
                      <Avatar user={u} size="md" />
                      <ParticipantCard
                        voted={voted}
                        revealed={isRevealed}
                        value={userVote?.value}
                      />
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Revealed: distribution + average */}
          {isRevealed && distribution && (
            <div className="border-b border-ink-100 px-5 py-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-ink-400">
                Distribution
              </p>
              <div className="flex flex-wrap items-end gap-3">
                {distribution.map(([value, count]) => (
                  <div key={value} className="flex flex-col items-center gap-1">
                    <span className="text-xs font-semibold text-ink-600">
                      {count}×
                    </span>
                    <span
                      className={cn(
                        'flex h-9 w-9 items-center justify-center rounded-md border-2',
                        'border-ink-200 bg-ink-50 font-mono text-sm font-bold text-ink-700',
                      )}
                    >
                      {value}
                    </span>
                  </div>
                ))}
                {average !== null && (
                  <div className="ml-auto flex items-baseline gap-1.5">
                    <span className="text-xs text-ink-400">avg</span>
                    <span className="font-mono text-lg font-bold text-signal-700">
                      {average}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Deck / controls */}
          {!isClosed && (
            <div className="px-5 py-4">
              {isRevealed && editable && item.finalEstimate === null ? (
                /* Commit controls */
                <div className="flex flex-wrap items-center gap-3">
                  <label
                    htmlFor="commit-estimate"
                    className="text-sm font-semibold text-ink-700"
                  >
                    Commit estimate (pts)
                  </label>
                  <input
                    id="commit-estimate"
                    type="number"
                    min="0"
                    step="0.5"
                    value={commitValue}
                    onChange={(e) => onCommitValueChange(e.target.value)}
                    placeholder={average ?? '0'}
                    aria-label="Final estimate in story points"
                    className={cn(
                      'w-24 rounded border border-ink-200 bg-ink-50 px-2.5 py-1.5',
                      'font-mono text-sm text-ink-900 placeholder:text-ink-400',
                      'focus:border-signal-400 focus:outline-none focus:ring-2 focus:ring-signal-200',
                    )}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        onCommit();
                      }
                    }}
                  />
                  <Button
                    data-testid="poker-commit"
                    size="sm"
                    onClick={onCommit}
                    loading={commitPending}
                  >
                    Commit
                  </Button>
                </div>
              ) : !isRevealed ? (
                <div className="flex flex-col gap-3">
                  <p className="text-xs font-semibold uppercase tracking-widest text-ink-400">
                    {canVote ? 'Pick your card' : 'Spectating — view only'}
                  </p>
                  <DeckHand
                    selected={myVote?.value}
                    disabled={!canVote}
                    onPick={handleVote}
                  />
                  {editable && (
                    <div className="flex items-center justify-between pt-1">
                      <div className="flex gap-2">
                        {prevItem && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onSetActive(prevItem.id)}
                          >
                            ← Prev
                          </Button>
                        )}
                        {nextItem && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onSetActive(nextItem.id)}
                          >
                            Next →
                          </Button>
                        )}
                      </div>
                      <Button
                        data-testid="poker-reveal"
                        size="sm"
                        variant="secondary"
                        onClick={onReveal}
                        loading={revealPending}
                      >
                        Reveal cards
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                /* Revealed but viewer or already committed */
                <div className="flex items-center justify-between">
                  <p className="text-sm text-ink-500">
                    {item.finalEstimate !== null
                      ? `Committed: ${item.finalEstimate} story points.`
                      : 'Waiting for facilitator to commit an estimate.'}
                  </p>
                  {editable && (
                    <div className="flex gap-2">
                      {prevItem && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onSetActive(prevItem.id)}
                        >
                          ← Prev
                        </Button>
                      )}
                      {nextItem && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onSetActive(nextItem.id)}
                        >
                          Next →
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </IssueCardWrapper>
  );
}

// ── DeckHand ──────────────────────────────────────────────────────────────────

function DeckHand({
  selected,
  disabled,
  onPick,
}: {
  selected?: string;
  disabled: boolean;
  onPick: (card: string) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Estimation deck"
      className="flex flex-wrap gap-2"
    >
      {POKER_DECK.map((card) => {
        const isSelected = card === selected;
        return (
          <button
            key={card}
            type="button"
            data-testid={`poker-deck-card-${card}`}
            aria-label={`Card ${card}`}
            aria-pressed={isSelected}
            disabled={disabled}
            onClick={() => onPick(card)}
            className={cn(
              'flex h-12 w-9 items-center justify-center rounded-md border-2',
              'font-mono text-sm font-bold transition-all duration-[120ms]',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1',
              'active:scale-95 motion-reduce:transition-none',
              'disabled:cursor-not-allowed disabled:opacity-40',
              isSelected
                ? 'border-signal-600 bg-signal-600 text-white shadow-signal scale-110'
                : 'border-ink-200 bg-surface text-ink-700 hover:border-signal-400 hover:bg-signal-50 hover:text-signal-700',
            )}
          >
            {card}
          </button>
        );
      })}
    </div>
  );
}

// ── ParticipantCard ───────────────────────────────────────────────────────────

function ParticipantCard({
  voted,
  revealed,
  value,
}: {
  voted: boolean;
  revealed: boolean;
  value?: string;
}) {
  if (!voted) {
    return (
      <span
        aria-label="Not voted"
        className="flex h-7 w-5 items-center justify-center rounded border border-dashed border-ink-300 bg-ink-50 text-[9px] text-ink-300"
      >
        ?
      </span>
    );
  }
  if (!revealed) {
    // Face-down card: voted but hidden.
    return (
      <span
        aria-label="Voted (hidden)"
        className={cn(
          'flex h-7 w-5 items-center justify-center rounded border-2',
          'border-signal-600 bg-signal-600 text-[10px] text-white',
        )}
      >
        ✓
      </span>
    );
  }
  // Revealed — show value.
  return (
    <span
      aria-label={`Voted ${value ?? '?'}`}
      className={cn(
        'flex h-7 w-5 items-center justify-center rounded border-2',
        'border-ink-200 bg-ink-50 font-mono text-[9px] font-bold text-ink-700',
      )}
    >
      {value ?? '?'}
    </span>
  );
}

// ── PokerItemRow ──────────────────────────────────────────────────────────────

function PokerItemRow({
  item,
  isActive,
  editable,
  onClick,
}: {
  item: PokerItemDto;
  isActive: boolean;
  editable: boolean;
  onClick: () => void;
}) {
  const votes = item.votes ?? [];

  return (
    <li>
      <button
        type="button"
        data-testid={`poker-item-${item.id}`}
        onClick={editable ? onClick : undefined}
        disabled={!editable}
        className={cn(
          'w-full rounded-lg border px-3 py-2.5 text-left transition-all duration-[120ms]',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500',
          isActive
            ? 'border-signal-400 bg-signal-50 shadow-xs'
            : 'border-ink-200 bg-surface hover:border-ink-300 hover:bg-ink-50',
          !editable && 'cursor-default',
        )}
      >
        <IssueCardWrapper issueId={item.issueId}>
          {(issue) => (
            <div className="flex items-center gap-2">
              <IssueTypeIcon type={issue.type} className="h-4 w-4 shrink-0" />
              <span className="font-mono text-xs text-signal-600">
                {issue.key}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink-800">
                {issue.title}
              </span>
              <div className="ml-auto flex shrink-0 items-center gap-2">
                {item.finalEstimate !== null && (
                  <span className="rounded-full bg-signal-100 px-2 py-0.5 font-mono text-xs font-bold text-signal-700">
                    {item.finalEstimate}
                  </span>
                )}
                {item.revealed && item.finalEstimate === null && (
                  <Badge className="bg-amber-100 text-amber-700">
                    Revealed
                  </Badge>
                )}
                {!item.revealed && votes.length > 0 && (
                  <Badge className="bg-ink-100 text-ink-500">
                    {votes.length} vote{votes.length !== 1 ? 's' : ''}
                  </Badge>
                )}
              </div>
            </div>
          )}
        </IssueCardWrapper>
      </button>
    </li>
  );
}

// ── IssueCardWrapper ──────────────────────────────────────────────────────────

/**
 * Fetches the issue for a poker item and renders children with the full IssueDto.
 */
function IssueCardWrapper({
  issueId,
  children,
}: {
  issueId: string;
  children: (issue: IssueDto) => React.ReactNode;
}) {
  const issueQuery = useIssue(issueId);

  if (!issueQuery.data) {
    return (
      <div
        className="h-6 animate-pulse rounded bg-ink-100"
        aria-hidden="true"
      />
    );
  }

  return <>{children(issueQuery.data)}</>;
}

// ── Shell ─────────────────────────────────────────────────────────────────────

function Shell({
  children,
  projectId,
  projectName,
  sessionName,
}: {
  children: React.ReactNode;
  projectId: string;
  projectName?: string;
  sessionName?: string;
}) {
  return (
    <div className="flex h-screen flex-col overflow-x-clip">
      <AppHeader>
        <ProjectBreadcrumb
          primary={sessionName ?? 'Poker'}
          secondary={[
            { label: projectName ?? 'Project', to: `/projects/${projectId}/backlog` },
          ]}
        />
      </AppHeader>
      <ProjectNav projectId={projectId} />
      <main className="flex-1 overflow-y-auto bg-ink-50">{children}</main>
    </div>
  );
}
