/**
 * TimeTrackingSection
 *
 * Rendered in the IssueDetailDrawer main column. Shows:
 *   - Original estimate field (editable inline input, friendly duration format)
 *   - Time-spent vs estimate progress bar
 *   - Log work form (duration + optional note; Enter or button submits)
 *   - Worklog list with author avatar, duration, note, relative time, delete
 *
 * MEMBER+ required to log / delete; VIEWER sees the summary + list read-only.
 * The estimate field uses the existing issue-update mutation (PATCH /issues/:id).
 */
import { useRef, useState, useId } from 'react';
import type { IssueDto, WorkLogDto } from '@next-lane/shared';
import { useAddWorkLog, useDeleteWorkLog, useWorkLogs } from '@/api/worklogs';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errorMessage';
import { parseDuration, formatDuration } from '@/lib/duration';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  issue: IssueDto;
  /** When false (VIEWER), add / delete controls are hidden. */
  editable: boolean;
  /** The current user's id — used to gate the "delete own log" affordance. */
  currentUserId?: string;
  /** Called when the estimate changes — routes to useUpdateIssue in the drawer. */
  onPatchEstimate: (minutes: number | null) => void;
}

// ---------------------------------------------------------------------------
// Main section
// ---------------------------------------------------------------------------

export function TimeTrackingSection({
  issue,
  editable,
  currentUserId,
  onPatchEstimate,
}: Props) {
  const worklogsQuery = useWorkLogs(issue.id);
  const worklogs = worklogsQuery.data ?? [];
  const timeSpent = issue.timeSpentMinutes ?? 0;
  const estimate = issue.originalEstimateMinutes;

  return (
    <section data-testid="time-tracking-section" aria-label="Time tracking">
      {/* Section header */}
      <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.08em] text-ink-500">
        Time Tracking
      </p>

      {/* Estimate field */}
      <EstimateField
        estimate={estimate}
        editable={editable}
        onSave={onPatchEstimate}
      />

      {/* Progress bar + summary */}
      <TimeProgress timeSpent={timeSpent} estimate={estimate} />

      {/* Log work form — member+ only */}
      {editable && <LogWorkForm issueId={issue.id} />}

      {/* Worklog list */}
      {worklogsQuery.isLoading ? (
        <p className="mt-3 text-xs text-ink-400">Loading…</p>
      ) : worklogs.length === 0 ? (
        <p className="mt-3 text-xs text-ink-400">No time logged yet.</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {worklogs.map((log) => (
            <WorklogRow
              key={log.id}
              log={log}
              issueId={issue.id}
              editable={editable}
              currentUserId={currentUserId}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Estimate inline field
// ---------------------------------------------------------------------------

function EstimateField({
  estimate,
  editable,
  onSave,
}: {
  estimate: number | null;
  editable: boolean;
  onSave: (minutes: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  function startEditing() {
    if (!editable) return;
    setValue(estimate !== null ? formatDuration(estimate) : '');
    setError('');
    setEditing(true);
    // Focus in next tick after render
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function commit() {
    const trimmed = value.trim();
    if (!trimmed) {
      // Empty → clear estimate
      onSave(null);
      setEditing(false);
      return;
    }
    const parsed = parseDuration(trimmed);
    if (parsed === null) {
      setError('Use e.g. "2h 30m", "90m", or "1.5h".');
      return;
    }
    if (parsed < 1) {
      setError('Estimate must be at least 1 minute.');
      return;
    }
    onSave(parsed);
    setEditing(false);
    setError('');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    }
    if (e.key === 'Escape') {
      setEditing(false);
      setError('');
    }
  }

  const labelId = useId();

  return (
    <div className="mb-3">
      <p id={labelId} className="mb-1 text-xs font-medium text-ink-500">
        Original estimate
      </p>

      {editing ? (
        <div>
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              data-testid="estimate-input"
              type="text"
              value={value}
              onChange={(e) => { setValue(e.target.value); setError(''); }}
              onKeyDown={handleKeyDown}
              onBlur={commit}
              placeholder="e.g. 2h 30m"
              aria-label="Original estimate"
              aria-describedby={error ? `${labelId}-err` : undefined}
              aria-invalid={!!error}
              autoComplete="off"
              className={[
                'flex-1 rounded border px-2 py-1.5 text-sm transition-colors duration-[120ms]',
                'focus:outline-none focus:ring-2 focus:ring-signal-400',
                error
                  ? 'border-red-300 bg-red-50 text-red-800'
                  : 'border-ink-200 bg-white text-ink-800 hover:border-signal-300',
              ].join(' ')}
            />
            <button
              type="button"
              onClick={commit}
              className="shrink-0 rounded border border-ink-200 bg-white px-2.5 py-1.5 text-xs font-medium text-ink-600 transition-colors duration-[120ms] hover:border-signal-400 hover:bg-signal-50 hover:text-signal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => { setEditing(false); setError(''); }}
              className="shrink-0 rounded border border-ink-200 bg-white px-2.5 py-1.5 text-xs font-medium text-ink-500 transition-colors duration-[120ms] hover:bg-ink-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-300"
            >
              Cancel
            </button>
          </div>
          {error && (
            <p id={`${labelId}-err`} role="alert" className="mt-1 text-xs text-red-600">
              {error}
            </p>
          )}
        </div>
      ) : estimate !== null ? (
        <button
          type="button"
          data-testid="estimate-input"
          aria-label={`Original estimate: ${formatDuration(estimate)}. Click to edit.`}
          onClick={startEditing}
          disabled={!editable}
          className={[
            'inline-flex items-center gap-1 rounded border px-2 py-1 text-sm font-medium transition-colors duration-[120ms]',
            editable
              ? 'cursor-pointer border-dashed border-ink-200 text-ink-700 hover:border-signal-300 hover:bg-signal-50/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400'
              : 'cursor-default border-transparent text-ink-700',
          ].join(' ')}
        >
          {/* Clock icon */}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <path strokeLinecap="round" d="M12 6v6l4 2" />
          </svg>
          {formatDuration(estimate)}
          {editable && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true" className="ml-0.5 opacity-50">
              <path strokeLinecap="round" d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          )}
        </button>
      ) : editable ? (
        <button
          type="button"
          data-testid="estimate-input"
          aria-label="Set original estimate"
          onClick={startEditing}
          className="flex items-center gap-1 rounded border border-dashed border-ink-200 px-2 py-1.5 text-xs text-ink-400 transition-colors duration-[120ms] hover:border-signal-300 hover:bg-signal-50/30 hover:text-ink-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <path strokeLinecap="round" d="M12 5v14M5 12h14" />
          </svg>
          Set estimate
        </button>
      ) : (
        <span className="text-sm text-ink-400">No estimate</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------

function TimeProgress({
  timeSpent,
  estimate,
}: {
  timeSpent: number;
  estimate: number | null;
}) {
  if (timeSpent === 0 && estimate === null) return null;

  const hasEstimate = estimate !== null && estimate > 0;
  const pct = hasEstimate ? Math.min((timeSpent / estimate) * 100, 100) : 0;
  const isOver = hasEstimate && timeSpent > estimate;

  const spentLabel = formatDuration(timeSpent);
  const estimateLabel = hasEstimate ? formatDuration(estimate) : null;

  return (
    <div className="mb-3">
      {/* Summary text */}
      <p className="mb-1.5 text-xs text-ink-500">
        {hasEstimate ? (
          <>
            <span className={isOver ? 'font-semibold text-red-600' : 'font-semibold text-ink-700'}>
              {spentLabel}
            </span>
            {' logged of '}
            <span className="text-ink-600">{estimateLabel}</span>
            {isOver && (
              <span className="ml-1.5 rounded-sm bg-red-50 px-1 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-600 ring-1 ring-inset ring-red-200">
                Over
              </span>
            )}
          </>
        ) : (
          <>
            <span className="font-semibold text-ink-700">{spentLabel}</span>
            {' logged'}
          </>
        )}
      </p>

      {/* Progress bar — only when estimate exists */}
      {hasEstimate && (
        <div
          data-testid="time-progress"
          role="progressbar"
          aria-valuenow={timeSpent}
          aria-valuemin={0}
          aria-valuemax={estimate}
          aria-label={`Time logged: ${spentLabel} of ${estimateLabel ?? 'unestimated'}`}
          className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100"
        >
          <div
            className={[
              'h-full rounded-full transition-all duration-300 motion-reduce:transition-none',
              isOver ? 'bg-red-500' : 'bg-signal-500',
            ].join(' ')}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Log work form
// ---------------------------------------------------------------------------

function LogWorkForm({ issueId }: { issueId: string }) {
  const [durationRaw, setDurationRaw] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const durationRef = useRef<HTMLInputElement>(null);
  const add = useAddWorkLog(issueId);
  const toast = useToast();

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    const trimmed = durationRaw.trim();
    if (!trimmed) {
      setError('Enter a duration, e.g. "30m" or "1h 30m".');
      return;
    }
    const minutes = parseDuration(trimmed);
    if (minutes === null || minutes < 1) {
      setError('Duration must be at least 1 minute.');
      return;
    }
    setError('');
    add.mutate(
      { minutes, note: note.trim() || undefined },
      {
        onSuccess: () => {
          setDurationRaw('');
          setNote('');
          durationRef.current?.focus();
        },
        onError: (err) => {
          toast.error(errorMessage(err, 'Could not log time.'));
        },
      },
    );
  }

  function handleDurationKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-3 rounded border border-dashed border-ink-200 p-2.5"
      aria-label="Log work"
    >
      <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.08em] text-ink-400">
        Log work
      </p>

      <div className="flex items-start gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <input
            ref={durationRef}
            type="text"
            data-testid="worklog-add-minutes"
            value={durationRaw}
            onChange={(e) => {
              setDurationRaw(e.target.value);
              setError('');
            }}
            onKeyDown={handleDurationKeyDown}
            placeholder="30m, 1h, 2h 30m…"
            autoComplete="off"
            disabled={add.isPending}
            aria-label="Time spent"
            aria-invalid={!!error}
            aria-describedby={error ? 'log-work-err' : undefined}
            className={[
              'rounded border px-2 py-1.5 text-sm transition-colors duration-[120ms]',
              'focus:outline-none focus:ring-2 focus:ring-signal-400',
              'disabled:cursor-not-allowed disabled:opacity-60',
              'placeholder:text-ink-400',
              error
                ? 'border-red-300 bg-red-50 text-red-800'
                : 'border-ink-200 bg-white text-ink-800 hover:border-signal-300',
            ].join(' ')}
          />
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
            disabled={add.isPending}
            aria-label="Work log note"
            autoComplete="off"
            className="rounded border border-ink-200 bg-white px-2 py-1.5 text-sm text-ink-800 placeholder:text-ink-400 hover:border-signal-300 focus:border-signal-400 focus:outline-none focus:ring-0 disabled:cursor-not-allowed disabled:opacity-60"
          />
          {error && (
            <p id="log-work-err" role="alert" className="text-xs text-red-600">
              {error}
            </p>
          )}
        </div>
        <button
          type="submit"
          data-testid="worklog-add-submit"
          disabled={!durationRaw.trim() || add.isPending}
          aria-label="Log time"
          className={[
            'mt-0 shrink-0 rounded border border-ink-200 bg-white px-2.5 py-1.5 text-xs font-medium text-ink-600',
            'transition-colors duration-[120ms]',
            'hover:border-signal-400 hover:bg-signal-50 hover:text-signal-700',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400',
            'disabled:cursor-not-allowed disabled:opacity-40',
          ].join(' ')}
        >
          Log
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Individual worklog row
// ---------------------------------------------------------------------------

function WorklogRow({
  log,
  issueId,
  editable,
  currentUserId,
}: {
  log: WorkLogDto;
  issueId: string;
  editable: boolean;
  currentUserId?: string;
}) {
  const remove = useDeleteWorkLog(issueId);
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Allow delete if the viewer is the author OR is a project ADMIN (editable covers both)
  const canDelete = editable && (log.userId === currentUserId || editable);

  function handleDelete() {
    remove.mutate(log.id, {
      onError: (err) => {
        setConfirmDelete(false);
        toast.error(errorMessage(err, 'Could not delete work log.'));
      },
      onSuccess: () => {
        setConfirmDelete(false);
      },
    });
  }

  return (
    <>
      <li
        data-testid="worklog-row"
        className="group flex items-start gap-2 rounded-md px-1.5 py-1.5 transition-colors duration-[120ms] hover:bg-ink-50"
      >
        {/* Author avatar */}
        <span
          aria-hidden="true"
          title={log.user.name}
          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
          style={{ backgroundColor: log.user.avatarColor || '#6366f1' }}
        >
          {log.user.name.charAt(0).toUpperCase()}
        </span>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="text-xs font-semibold text-ink-700 truncate max-w-[8rem]">
              {log.user.name}
            </span>
            <span className="shrink-0 rounded-sm bg-signal-50 px-1.5 py-0.5 text-[10px] font-bold text-signal-700 ring-1 ring-inset ring-signal-200">
              {formatDuration(log.minutes)}
            </span>
            <span className="shrink-0 text-[10px] text-ink-400" title={new Date(log.workedAt).toLocaleString()}>
              {relativeTime(log.workedAt)}
            </span>
          </div>
          {log.note && (
            <p className="mt-0.5 text-xs leading-snug text-ink-500 break-words">{log.note}</p>
          )}
        </div>

        {/* Delete button — author or admin */}
        {canDelete && (
          <button
            type="button"
            data-testid="worklog-delete"
            aria-label={`Delete work log: ${formatDuration(log.minutes)} by ${log.user.name}`}
            onClick={() => setConfirmDelete(true)}
            disabled={remove.isPending}
            className={[
              'shrink-0 rounded p-0.5 text-ink-300 transition-colors duration-[120ms]',
              'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
              'hover:bg-red-50 hover:text-red-500',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400',
              'disabled:opacity-30',
            ].join(' ')}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              aria-hidden="true"
            >
              <path strokeLinecap="round" d="M6 6l12 12M6 18L18 6" />
            </svg>
          </button>
        )}
      </li>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete work log"
        message={`Delete this ${formatDuration(log.minutes)} work log? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        loading={remove.isPending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Relative time helper
// ---------------------------------------------------------------------------

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
