/**
 * Sprint date formatting helpers shared by the board badge and the backlog
 * sprint sections. All inputs are ISO strings (or null) straight off SprintDto;
 * everything degrades gracefully when dates are missing.
 */

/** Whole-day difference between `date` and now (positive = future, negative = past). */
function daysFromNow(date: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((startOfDay(date) - startOfDay(new Date())) / MS_PER_DAY);
}

/** Short month/day, e.g. "Jun 26". Year is omitted to stay compact. */
export function formatShortDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** "Jun 26 – Jul 10", a single bound, or null when neither date is set. */
export function formatDateRange(
  start: string | null,
  end: string | null,
): string | null {
  const s = formatShortDate(start);
  const e = formatShortDate(end);
  if (s && e) return `${s} – ${e}`;
  if (s) return `Starts ${s}`;
  if (e) return `Ends ${e}`;
  return null;
}

export interface EndDateStatus {
  /** Human label, e.g. "ends in 5d", "ends today", "5d overdue". */
  label: string;
  /** Tone hint so callers can pick a color: ok < soon < overdue urgency. */
  tone: 'ok' | 'soon' | 'overdue';
}

/**
 * Relative status for a sprint end date. Returns null when there's no end date.
 * "soon" within 2 days (inclusive), "overdue" once the day has passed.
 */
export function endDateStatus(end: string | null): EndDateStatus | null {
  if (!end) return null;
  const d = new Date(end);
  if (Number.isNaN(d.getTime())) return null;
  const days = daysFromNow(d);
  if (days < 0) {
    const n = Math.abs(days);
    return { label: `${n}d overdue`, tone: 'overdue' };
  }
  if (days === 0) return { label: 'ends today', tone: 'soon' };
  if (days <= 2) return { label: `ends in ${days}d`, tone: 'soon' };
  return { label: `ends in ${days}d`, tone: 'ok' };
}
