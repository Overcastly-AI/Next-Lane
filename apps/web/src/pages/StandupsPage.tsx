/**
 * Async Standups page — /projects/:projectId/standups
 *
 * Layout:
 *   - Date selector (defaults to today)
 *   - "My standup" editor card (gated: VIEWER = read-only)
 *   - Team digest: everyone's entries for the selected date
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { IssueDto, StandupEntryDto } from '@next-lane/shared';
import { Role } from '@next-lane/shared';
import {
  useStandups,
  useMyStandup,
  useSubmitStandup,
  useStandupPrefill,
} from '@/api/standups';
import { useProjectIssues } from '@/api/issues';
import { useMyRole } from '@/api/workspaces';
import { useProject } from '@/api/projects';
import { AppHeader } from '@/components/AppHeader';
import { ProjectBreadcrumb } from '@/components/project/ProjectBreadcrumb';
import { ProjectNav } from '@/components/project/ProjectNav';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';
import { Avatar } from '@/components/ui/Avatar';
import { ErrorState, LoadingState, EmptyState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errorMessage';
import { cn } from '@/lib/cn';

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/** Format a Date as YYYY-MM-DD in local time. */
function toLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayLocal(): string {
  return toLocalDate(new Date());
}

/** Offset a YYYY-MM-DD string by `days` (positive = forward, negative = back). */
function offsetDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toLocalDate(d);
}

/** Format a YYYY-MM-DD string as a human-readable label. */
function formatDateLabel(date: string): string {
  const today = todayLocal();
  const yesterday = offsetDate(today, -1);
  if (date === today) return 'Today';
  if (date === yesterday) return 'Yesterday';
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function StandupsPage() {
  const { projectId = '' } = useParams();
  const [date, setDate] = useState(todayLocal);

  const projectQuery = useProject(projectId);
  const digestQuery = useStandups(projectId, date);
  const myStandupQuery = useMyStandup(projectId, date);
  const myRole = useMyRole(projectQuery.data?.workspaceId);
  const isViewer = myRole === Role.VIEWER;

  return (
    <Shell
      projectId={projectId}
      projectName={projectQuery.data?.name}
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
        {/* Page header + date selector */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-lg font-semibold text-ink-900">
              Async Standups
            </h1>
            <p className="text-sm text-ink-500">
              Share what you did, what you plan, and any blockers.
            </p>
          </div>
          <DateSelector date={date} onChange={setDate} />
        </div>

        {/* My standup editor */}
        {!isViewer && (
          <MyStandupCard
            projectId={projectId}
            date={date}
            entry={myStandupQuery.data ?? null}
            isLoading={myStandupQuery.isLoading}
            isError={myStandupQuery.isError}
            error={myStandupQuery.error}
            onRetry={() => myStandupQuery.refetch()}
          />
        )}

        {/* Team digest */}
        <TeamDigest
          projectId={projectId}
          date={date}
          entries={digestQuery.data ?? []}
          isLoading={digestQuery.isLoading}
          isError={digestQuery.isError}
          error={digestQuery.error}
          onRetry={() => digestQuery.refetch()}
          isViewer={isViewer}
        />
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// DateSelector
// ---------------------------------------------------------------------------

function DateSelector({
  date,
  onChange,
}: {
  date: string;
  onChange: (d: string) => void;
}) {
  const today = todayLocal();

  return (
    <div
      className="flex items-center gap-1"
      role="group"
      aria-label="Select standup date"
    >
      <button
        type="button"
        aria-label="Previous day"
        onClick={() => onChange(offsetDate(date, -1))}
        className="inline-flex h-8 w-8 items-center justify-center rounded border border-ink-200 bg-surface text-ink-500 hover:bg-ink-50 hover:text-ink-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-200 transition-colors duration-[120ms]"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6" />
        </svg>
      </button>

      <label htmlFor="standup-date" className="sr-only">
        Standup date
      </label>
      <input
        id="standup-date"
        data-testid="standup-date"
        type="date"
        value={date}
        max={today}
        onChange={(e) => {
          if (e.target.value) onChange(e.target.value);
        }}
        className="h-8 rounded border border-ink-200 bg-surface px-2 text-sm text-ink-900 focus:border-signal-500 focus:outline-none focus:ring-2 focus:ring-signal-200 transition-all duration-[120ms]"
      />

      <span className="min-w-[4.5rem] text-center text-sm font-medium text-ink-700">
        {formatDateLabel(date)}
      </span>

      <button
        type="button"
        aria-label="Next day"
        disabled={date >= today}
        onClick={() => onChange(offsetDate(date, 1))}
        className="inline-flex h-8 w-8 items-center justify-center rounded border border-ink-200 bg-surface text-ink-500 hover:bg-ink-50 hover:text-ink-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-200 disabled:cursor-not-allowed disabled:opacity-40 transition-colors duration-[120ms]"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 18l6-6-6-6" />
        </svg>
      </button>

      {date !== today && (
        <button
          type="button"
          onClick={() => onChange(today)}
          className="ml-1 rounded px-2 py-1 text-xs font-medium text-signal-600 hover:bg-signal-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-200 transition-colors duration-[120ms]"
        >
          Today
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MyStandupCard — editor + prefill
// ---------------------------------------------------------------------------

interface MyStandupCardProps {
  projectId: string;
  date: string;
  entry: StandupEntryDto | null;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
}

function MyStandupCard({
  projectId,
  date,
  entry,
  isLoading,
  isError,
  error,
  onRetry,
}: MyStandupCardProps) {
  const toast = useToast();
  const submitMutation = useSubmitStandup(projectId);
  const prefillQuery = useStandupPrefill(projectId);
  const issuesQuery = useProjectIssues(projectId);

  // Form state — initialised from the existing entry, if any.
  const [yesterday, setYesterday] = useState(entry?.yesterday ?? '');
  const [today, setToday] = useState(entry?.today ?? '');
  const [blockers, setBlockers] = useState(entry?.blockers ?? '');
  const [blockerIssueIds, setBlockerIssueIds] = useState<string[]>(
    entry?.blockerIssueIds ?? [],
  );

  // Track whether the current form values differ from the last saved entry.
  const [savedAt, setSavedAt] = useState<Date | null>(
    entry ? new Date(entry.updatedAt) : null,
  );

  // When the entry loads (or changes due to a refetch), seed the form ONLY if
  // the user hasn't started typing — represented by `dirty` state.
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (!entry || dirtyRef.current) return;
    setYesterday(entry.yesterday ?? '');
    setToday(entry.today ?? '');
    setBlockers(entry.blockers ?? '');
    setBlockerIssueIds(entry.blockerIssueIds ?? []);
    setSavedAt(new Date(entry.updatedAt));
  }, [entry]);

  const handleChange = useCallback(() => {
    dirtyRef.current = true;
  }, []);

  const handlePrefill = useCallback(async () => {
    try {
      const result = await prefillQuery.refetch();
      if (result.data) {
        setYesterday(result.data.yesterday);
        setToday(result.data.today);
        dirtyRef.current = true;
        toast.success('Form pre-filled from your recent activity.');
      }
    } catch (err) {
      toast.error(errorMessage(err, 'Could not load prefill suggestions.'));
    }
  }, [prefillQuery, toast]);

  const handleSave = useCallback(async () => {
    try {
      await submitMutation.mutateAsync({
        date,
        yesterday: yesterday || undefined,
        today: today || undefined,
        blockers: blockers || undefined,
        blockerIssueIds,
      });
      dirtyRef.current = false;
      setSavedAt(new Date());
      toast.success('Standup saved.');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not save standup.'));
    }
  }, [submitMutation, date, yesterday, today, blockers, blockerIssueIds, toast]);

  if (isLoading) {
    return (
      <section
        aria-label="My standup"
        className="rounded-xl border border-ink-200 bg-surface p-5 shadow-card"
      >
        <LoadingState label="Loading your standup…" />
      </section>
    );
  }

  if (isError) {
    return (
      <section
        aria-label="My standup"
        className="rounded-xl border border-ink-200 bg-surface p-5 shadow-card"
      >
        <ErrorState error={error} onRetry={onRetry} />
      </section>
    );
  }

  const issues: IssueDto[] = issuesQuery.data ?? [];
  const isPending = submitMutation.isPending;

  return (
    <section
      aria-labelledby="my-standup-heading"
      className="rounded-xl border border-ink-200 bg-surface shadow-card"
    >
      {/* Card header */}
      <div className="flex items-center justify-between gap-3 border-b border-ink-100 px-5 py-3">
        <h2
          id="my-standup-heading"
          className="text-sm font-semibold text-ink-900"
        >
          My standup
          {savedAt && (
            <span className="ml-2 text-xs font-normal text-ink-400">
              Saved {savedAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </h2>
        <button
          type="button"
          data-testid="standup-prefill"
          aria-label="Prefill from my recent activity"
          disabled={prefillQuery.isFetching || isPending}
          onClick={() => void handlePrefill()}
          className={cn(
            'inline-flex items-center gap-1.5 rounded border border-ink-200 bg-surface px-3 py-1.5 text-xs font-medium text-ink-600',
            'hover:bg-ink-50 hover:border-ink-300 hover:text-ink-900',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-200',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'transition-colors duration-[120ms]',
          )}
        >
          {prefillQuery.isFetching ? (
            <span className="h-3 w-3 animate-spin rounded-full border border-ink-400 border-t-transparent" aria-hidden="true" />
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          )}
          Prefill from my activity
        </button>
      </div>

      {/* Fields */}
      <div className="flex flex-col gap-4 px-5 py-4">
        <div>
          <label
            htmlFor="standup-yesterday"
            className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-500"
          >
            What did I do yesterday?
          </label>
          <Textarea
            id="standup-yesterday"
            data-testid="standup-yesterday"
            rows={3}
            placeholder="Completed the auth module, reviewed 2 PRs…"
            value={yesterday}
            onChange={(e) => {
              setYesterday(e.target.value);
              handleChange();
            }}
            disabled={isPending}
          />
        </div>

        <div>
          <label
            htmlFor="standup-today"
            className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-500"
          >
            What will I do today?
          </label>
          <Textarea
            id="standup-today"
            data-testid="standup-today"
            rows={3}
            placeholder="Implement the standup page, write e2e tests…"
            value={today}
            onChange={(e) => {
              setToday(e.target.value);
              handleChange();
            }}
            disabled={isPending}
          />
        </div>

        <div>
          <label
            htmlFor="standup-blockers"
            className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-500"
          >
            Blockers
            <span className="ml-1.5 text-[10px] font-normal normal-case text-ink-400">
              optional
            </span>
          </label>
          <Textarea
            id="standup-blockers"
            data-testid="standup-blockers"
            rows={2}
            placeholder="Waiting on API spec from the backend team…"
            value={blockers}
            onChange={(e) => {
              setBlockers(e.target.value);
              handleChange();
            }}
            disabled={isPending}
          />
        </div>

        {/* Blocker issue picker */}
        <BlockerIssuePicker
          issues={issues}
          selected={blockerIssueIds}
          onChange={(ids) => {
            setBlockerIssueIds(ids);
            handleChange();
          }}
          disabled={isPending}
        />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-3 border-t border-ink-100 px-5 py-3">
        <Button
          data-testid="standup-save"
          loading={isPending}
          onClick={() => void handleSave()}
        >
          {entry ? 'Update standup' : 'Save standup'}
        </Button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// BlockerIssuePicker — combobox to tag issue IDs as blockers
// ---------------------------------------------------------------------------

interface BlockerIssuePickerProps {
  issues: IssueDto[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}

function BlockerIssuePicker({
  issues,
  selected,
  onChange,
  disabled,
}: BlockerIssuePickerProps) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selectedSet = new Set(selected);
  const term = search.trim().toLowerCase();
  const filtered = issues
    .filter((i) => {
      if (!term) return true;
      return (
        i.key.toLowerCase().includes(term) ||
        i.title.toLowerCase().includes(term)
      );
    })
    .slice(0, 20);

  function toggle(id: string) {
    onChange(
      selectedSet.has(id) ? selected.filter((x) => x !== id) : [...selected, id],
    );
  }

  const selectedIssues = issues.filter((i) => selectedSet.has(i.id));

  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">
        Blocker issues
        <span className="ml-1.5 text-[10px] font-normal normal-case text-ink-400">
          optional — link tracked issues
        </span>
      </p>

      {/* Selected chips */}
      {selectedIssues.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selectedIssues.map((issue) => (
            <span
              key={issue.id}
              className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800"
            >
              <span className="font-mono">{issue.key}</span>
              <span className="max-w-[12rem] truncate text-amber-700">
                {issue.title}
              </span>
              <button
                type="button"
                aria-label={`Remove blocker ${issue.key}`}
                disabled={disabled}
                onClick={() => toggle(issue.id)}
                className="ml-0.5 rounded-full text-amber-600 hover:text-amber-900 focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-400 disabled:cursor-not-allowed"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <path strokeLinecap="round" d="M6 6l12 12M6 18L18 6" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}

      <div ref={containerRef} className="relative">
        <input
          type="text"
          role="combobox"
          aria-label="Search blocker issues"
          aria-expanded={open}
          aria-haspopup="listbox"
          placeholder="Search issues by key or title…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={() => setOpen(true)}
          disabled={disabled}
          className={cn(
            'h-9 w-full rounded border border-ink-200 bg-surface px-3 text-sm text-ink-900',
            'placeholder:text-ink-400 transition-all duration-[120ms]',
            'hover:border-ink-300',
            'focus:border-signal-500 focus:outline-none focus:ring-2 focus:ring-signal-200',
            'disabled:cursor-not-allowed disabled:bg-ink-50 disabled:text-ink-400',
          )}
        />
        {open && filtered.length > 0 && (
          <ul
            role="listbox"
            aria-label="Blocker issue options"
            className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border border-ink-200 bg-surface py-1 shadow-cardHover"
          >
            {filtered.map((issue) => {
              const checked = selectedSet.has(issue.id);
              return (
                <li key={issue.id} role="option" aria-selected={checked}>
                  <button
                    type="button"
                    onClick={() => toggle(issue.id)}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-ink-50',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal-200',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                        checked
                          ? 'border-signal-600 bg-signal-600 text-white'
                          : 'border-ink-300',
                      )}
                      aria-hidden="true"
                    >
                      {checked && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                    <span className="font-mono text-xs text-ink-500">
                      {issue.key}
                    </span>
                    <span className="min-w-0 truncate text-ink-800">
                      {issue.title}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {open && term && filtered.length === 0 && (
          <div className="absolute z-20 mt-1 w-full rounded-lg border border-ink-200 bg-surface p-3 shadow-cardHover">
            <p className="text-sm text-ink-400">No issues match "{search}".</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TeamDigest — everyone's entries for the selected date
// ---------------------------------------------------------------------------

interface TeamDigestProps {
  projectId: string;
  date: string;
  entries: StandupEntryDto[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  isViewer: boolean;
}

function TeamDigest({
  projectId,
  entries,
  isLoading,
  isError,
  error,
  onRetry,
  isViewer,
  date,
}: TeamDigestProps) {
  return (
    <section aria-labelledby="digest-heading">
      <div className="mb-3 flex items-center justify-between">
        <h2
          id="digest-heading"
          className="text-sm font-semibold text-ink-900"
        >
          Team digest
          {entries.length > 0 && (
            <span className="ml-2 rounded-full bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-500">
              {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
            </span>
          )}
        </h2>
      </div>

      {isLoading ? (
        <LoadingState label="Loading team standup…" />
      ) : isError ? (
        <ErrorState error={error} onRetry={onRetry} />
      ) : entries.length === 0 ? (
        <EmptyState
          title="No standups yet"
          description={
            isViewer
              ? `No one has posted a standup for ${formatDateLabel(date)}.`
              : `No one has posted a standup yet. Be the first!`
          }
          icon={
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          }
        />
      ) : (
        <ul className="flex flex-col gap-3" role="list">
          {entries.map((entry) => (
            <li key={entry.id}>
              <StandupEntryCard entry={entry} projectId={projectId} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// StandupEntryCard
// ---------------------------------------------------------------------------

function StandupEntryCard({
  entry,
  projectId,
}: {
  entry: StandupEntryDto;
  projectId: string;
}) {
  const hasBlockers = !!(entry.blockers || entry.blockerIssueIds?.length);

  return (
    <article
      data-testid="standup-entry"
      aria-label={`Standup entry by ${entry.user?.name ?? 'Unknown'}`}
      className={cn(
        'rounded-xl border bg-surface shadow-card',
        hasBlockers ? 'border-amber-200' : 'border-ink-200',
      )}
    >
      {/* Entry header */}
      <div className="flex items-center gap-3 border-b border-ink-100 px-4 py-3">
        <Avatar user={entry.user ?? null} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink-900">
            {entry.user?.name ?? 'Team member'}
          </p>
          <p className="text-xs text-ink-400">
            {new Date(`${entry.date}T00:00:00`).toLocaleDateString(undefined, {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            })}
          </p>
        </div>
        {hasBlockers && (
          <span
            aria-label="Has blockers"
            title="Has blockers"
            className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path strokeLinecap="round" d="M12 9v4M12 16h.01" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            Blocked
          </span>
        )}
      </div>

      {/* Entry body */}
      <div className="flex flex-col gap-3 px-4 py-3">
        {entry.yesterday && (
          <EntryField
            label="Yesterday"
            value={entry.yesterday}
          />
        )}
        {entry.today && (
          <EntryField
            label="Today"
            value={entry.today}
          />
        )}
        {(entry.blockers || (entry.blockerIssueIds?.length ?? 0) > 0) && (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-600">
              Blockers
            </p>
            {entry.blockers && (
              <p className="whitespace-pre-wrap text-sm text-ink-700">
                {entry.blockers}
              </p>
            )}
            {(entry.blockerIssueIds?.length ?? 0) > 0 && (
              <BlockerIssueLinks
                entry={entry}
                projectId={projectId}
              />
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function EntryField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-ink-400">
        {label}
      </p>
      <p className="whitespace-pre-wrap text-sm text-ink-800">{value}</p>
    </div>
  );
}

function BlockerIssueLinks({
  entry,
  projectId,
}: {
  entry: StandupEntryDto;
  projectId: string;
}) {
  // If the server returned the full blockerLinks with issue refs, use those.
  // Otherwise fall back to rendering the raw IDs.
  const links = entry.blockerLinks;

  if (links && links.length > 0) {
    return (
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {links.map((link) => (
          <Link
            key={link.id}
            to={`/projects/${projectId}/board?issue=${link.issueId}`}
            className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-100 hover:text-amber-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 transition-colors duration-[120ms]"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
            </svg>
            {link.issue?.key ?? link.issueId}
          </Link>
        ))}
      </div>
    );
  }

  // Fallback: render raw IDs as links to the board with issue drawer
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {(entry.blockerIssueIds ?? []).map((id) => (
        <Link
          key={id}
          to={`/projects/${projectId}/board?issue=${id}`}
          className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-2 py-0.5 font-mono text-xs text-amber-700 hover:bg-amber-100 hover:text-amber-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 transition-colors duration-[120ms]"
        >
          {id}
        </Link>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

function Shell({
  children,
  projectId,
  projectName,
}: {
  children: React.ReactNode;
  projectId: string;
  projectName?: string;
}) {
  return (
    <div className="flex h-screen flex-col overflow-x-clip">
      <AppHeader>
        <ProjectBreadcrumb primary={projectName} />
      </AppHeader>
      <ProjectNav projectId={projectId} />
      <main className="flex-1 overflow-y-auto bg-ink-50">{children}</main>
    </div>
  );
}
