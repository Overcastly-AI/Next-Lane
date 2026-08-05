/**
 * Time-axis maths for the roadmap Gantt.
 *
 * Pure functions, no React and no DOM, because every bug this file could have
 * is an arithmetic bug and arithmetic is far cheaper to test than a chart.
 *
 * The chart is laid out in PIXELS, not percentages. Percentages were fine for
 * a read-only timeline, but they make dragging incoherent: the same 40px of
 * mouse movement means a different number of days depending on how wide the
 * window happens to be, and a bar cannot be snapped to a day boundary without
 * knowing the pixel size of a day. A fixed `pxPerDay` makes both trivial and
 * gives horizontal scrolling for free.
 *
 * Everything is UTC. Rendering a plan in local time makes a bar jump a day
 * when a viewer in another timezone opens it, which for a roadmap you are
 * showing a manager is worse than useless.
 */

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type ZoomId = 'week' | 'month' | 'quarter';

export interface Zoom {
  id: ZoomId;
  label: string;
  /** Horizontal pixels one day occupies. */
  pxPerDay: number;
  /** Fine gridline cadence. */
  minor: 'day' | 'week' | 'month';
  /** Labelled header cadence. */
  major: 'week' | 'month' | 'quarter';
}

/**
 * Three densities, chosen so the labelled unit stays roughly 90–170px wide —
 * wide enough to read, narrow enough that a year is still scannable.
 */
export const ZOOMS: readonly Zoom[] = [
  { id: 'week', label: 'Week', pxPerDay: 22, minor: 'day', major: 'week' },
  { id: 'month', label: 'Month', pxPerDay: 5, minor: 'week', major: 'month' },
  { id: 'quarter', label: 'Quarter', pxPerDay: 1.6, minor: 'month', major: 'quarter' },
] as const;

export function zoomById(id: ZoomId): Zoom {
  return ZOOMS.find((z) => z.id === id) ?? ZOOMS[1];
}

// ── UTC date helpers ────────────────────────────────────────────────────────

export function startOfDayUTC(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function startOfMonthUTC(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

export function addMonthsUTC(ms: number, n: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1);
}

export function startOfQuarterUTC(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1);
}

/** Monday-anchored week start. */
export function startOfWeekUTC(ms: number): number {
  const day = startOfDayUTC(ms);
  const dow = new Date(day).getUTCDay(); // 0 = Sunday
  const backToMonday = (dow + 6) % 7;
  return day - backToMonday * MS_PER_DAY;
}

export function addDays(ms: number, n: number): number {
  return ms + n * MS_PER_DAY;
}

/** Whole days between two instants, rounded to the nearest day. */
export function daysBetween(a: number, b: number): number {
  return Math.round((b - a) / MS_PER_DAY);
}

// ── Working days ────────────────────────────────────────────────────────────

/** Saturday or Sunday, in UTC. */
export function isWeekendUTC(ms: number): boolean {
  const dow = new Date(ms).getUTCDay();
  return dow === 0 || dow === 6;
}

/** The same day, or the next Monday if it lands on a weekend. */
export function nextWorkday(ms: number): number {
  let d = startOfDayUTC(ms);
  while (isWeekendUTC(d)) d = addDays(d, 1);
  return d;
}

/** The same day, or the previous Friday if it lands on a weekend. */
export function prevWorkday(ms: number): number {
  let d = startOfDayUTC(ms);
  while (isWeekendUTC(d)) d = addDays(d, -1);
  return d;
}

/**
 * Pull a window onto working days: a start that lands on a weekend moves
 * forward to Monday, an end that lands on one moves back to Friday.
 *
 * The order matters. Snapping independently can invert a window that began
 * valid — a Saturday→Sunday range would give start=Monday, end=Friday, i.e. a
 * due date three days before its own start, which the API rejects outright. So
 * if the two ends cross, the whole thing collapses onto a single working day
 * rather than producing something unsaveable.
 */
export function snapWindowToWorkdays(
  startMs: number,
  endMs: number,
): { start: number; end: number } {
  const start = nextWorkday(startMs);
  const end = prevWorkday(endMs);
  if (end < start) {
    const day = nextWorkday(startMs);
    return { start: day, end: day };
  }
  return { start, end };
}

/** Whole weekdays from `a` to `b` inclusive of `a`, exclusive of `b`. */
export function workdaysBetween(a: number, b: number): number {
  const lo = startOfDayUTC(Math.min(a, b));
  const hi = startOfDayUTC(Math.max(a, b));
  let n = 0;
  for (let d = lo; d < hi; d = addDays(d, 1)) if (!isWeekendUTC(d)) n += 1;
  return a <= b ? n : -n;
}

/**
 * Weekend bands to shade, as [xStart, width] pairs.
 *
 * Only worth drawing when a day is wide enough to read as a band — below that
 * the stripes are visual noise on top of the gridlines, so the caller gets an
 * empty list and shades nothing.
 */
export function weekendBands(
  scale: Scale,
  minPxPerDay = 3,
): { x: number; width: number }[] {
  if (scale.pxPerDay < minPxPerDay) return [];
  const out: { x: number; width: number }[] = [];
  let guard = 0;
  for (
    let d = startOfDayUTC(scale.originMs);
    d < scale.endMs && guard < 2000;
    d = addDays(d, 1), guard += 1
  ) {
    if (!isWeekendUTC(d)) continue;
    out.push({ x: scale.xOf(d), width: scale.pxPerDay });
  }
  return out;
}

// ── Scale ───────────────────────────────────────────────────────────────────

export interface Tick {
  ms: number;
  x: number;
  label: string;
}

export interface Scale {
  /** UTC midnight the axis starts at. */
  originMs: number;
  /** UTC midnight one past the axis end. */
  endMs: number;
  pxPerDay: number;
  widthPx: number;
  /** Pixel offset of an instant from the axis origin. */
  xOf: (ms: number) => number;
  /** The instant at a pixel offset, snapped to UTC midnight. */
  dayAtX: (x: number) => number;
  majorTicks: Tick[];
  minorTicks: Tick[];
}

const MONTH_FMT: Intl.DateTimeFormatOptions = {
  month: 'short',
  timeZone: 'UTC',
};
const MONTH_YEAR_FMT: Intl.DateTimeFormatOptions = {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
};
const DAY_FMT: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  timeZone: 'UTC',
};

function quarterLabel(ms: number): string {
  const d = new Date(ms);
  return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
}

/**
 * Build the axis covering `[fromMs, toMs]` at the given zoom, padded outward to
 * whole units so the first and last labels aren't clipped mid-word.
 *
 * `maxTicks` is a hard stop, not a nicety: a plan with a stray year-3000 due
 * date would otherwise generate hundreds of thousands of tick objects and hang
 * the tab. Beyond the cap the ticks thin out rather than the chart dying.
 */
export function buildScale(
  fromMs: number,
  toMs: number,
  zoom: Zoom,
  maxTicks = 800,
  /**
   * Available width in px. A zoom level is a MINIMUM density, not a fixed one:
   * if the plan at this zoom would be narrower than the panel, the day width
   * stretches to fill it. Otherwise Month and Quarter left most of the chart
   * as empty gutter — the coarser the zoom, the more wasted space, which is
   * backwards.
   */
  containerPx = 0,
): Scale {
  const padUnit =
    zoom.major === 'week' ? 7 * MS_PER_DAY : zoom.major === 'month' ? 0 : 0;

  let origin =
    zoom.major === 'week'
      ? startOfWeekUTC(fromMs) - padUnit
      : zoom.major === 'month'
        ? startOfMonthUTC(fromMs)
        : startOfQuarterUTC(fromMs);

  let end =
    zoom.major === 'week'
      ? startOfWeekUTC(toMs) + 8 * MS_PER_DAY
      : zoom.major === 'month'
        ? addMonthsUTC(startOfMonthUTC(toMs), 1)
        : addMonthsUTC(startOfQuarterUTC(toMs), 3);

  if (end <= origin) end = addDays(origin, 1);

  // A single-day plan should still be a readable strip, not a hairline.
  const minSpanDays = zoom.id === 'week' ? 14 : zoom.id === 'month' ? 60 : 180;
  if (daysBetween(origin, end) < minSpanDays) {
    end = addDays(origin, minSpanDays);
  }

  const totalDays = daysBetween(origin, end);
  const pxPerDay =
    containerPx > 0 && totalDays > 0
      ? Math.max(zoom.pxPerDay, containerPx / totalDays)
      : zoom.pxPerDay;
  const widthPx = totalDays * pxPerDay;
  const xOf = (ms: number) => ((ms - origin) / MS_PER_DAY) * pxPerDay;
  const dayAtX = (x: number) =>
    startOfDayUTC(origin + (x / pxPerDay) * MS_PER_DAY);

  const majorTicks: Tick[] = [];
  const minorTicks: Tick[] = [];

  // Major (labelled) ticks.
  {
    let cur =
      zoom.major === 'week'
        ? startOfWeekUTC(origin)
        : zoom.major === 'month'
          ? startOfMonthUTC(origin)
          : startOfQuarterUTC(origin);
    let guard = 0;
    while (cur < end && guard < maxTicks) {
      majorTicks.push({
        ms: cur,
        x: xOf(cur),
        label:
          zoom.major === 'week'
            ? new Date(cur).toLocaleDateString(undefined, MONTH_YEAR_FMT) +
              ' · ' +
              new Date(cur).toLocaleDateString(undefined, DAY_FMT)
            : zoom.major === 'month'
              ? new Date(cur).toLocaleDateString(undefined, MONTH_YEAR_FMT)
              : quarterLabel(cur),
      });
      cur =
        zoom.major === 'week'
          ? cur + 7 * MS_PER_DAY
          : zoom.major === 'month'
            ? addMonthsUTC(cur, 1)
            : addMonthsUTC(cur, 3);
      guard += 1;
    }
  }

  // Minor (gridline) ticks.
  {
    let cur =
      zoom.minor === 'day'
        ? startOfDayUTC(origin)
        : zoom.minor === 'week'
          ? startOfWeekUTC(origin)
          : startOfMonthUTC(origin);
    let guard = 0;
    while (cur < end && guard < maxTicks) {
      minorTicks.push({
        ms: cur,
        x: xOf(cur),
        label: new Date(cur).toLocaleDateString(undefined, MONTH_FMT),
      });
      cur =
        zoom.minor === 'day'
          ? cur + MS_PER_DAY
          : zoom.minor === 'week'
            ? cur + 7 * MS_PER_DAY
            : addMonthsUTC(cur, 1);
      guard += 1;
    }
  }

  return { originMs: origin, endMs: end, pxPerDay, widthPx, xOf, dayAtX, majorTicks, minorTicks };
}

/**
 * The [min, max] instants the plan occupies, across every dated thing on it,
 * always including today so the "today" marker means something.
 *
 * Returns null when there is nothing dated at all — the caller then has an
 * empty state to render rather than an axis around an arbitrary date.
 */
export function planBounds(stamps: (string | null | undefined)[]): {
  from: number;
  to: number;
} | null {
  const parsed: number[] = [];
  for (const s of stamps) {
    if (!s) continue;
    const ms = Date.parse(s);
    if (Number.isFinite(ms)) parsed.push(ms);
  }
  if (parsed.length === 0) return null;
  const now = Date.now();
  return {
    from: Math.min(...parsed, now),
    to: Math.max(...parsed, now),
  };
}

/**
 * Apply a drag to a bar's window and return the new ISO dates.
 *
 * `mode` decides which ends move. Resizing is clamped so a bar can never
 * invert or vanish — dragging the left handle past the right one pins it at a
 * single day rather than producing a negative-width bar and a start date after
 * its own due date (which the API rejects anyway, so the UI must not offer it).
 */
export function applyDrag(
  startMs: number,
  endMs: number,
  mode: 'move' | 'resize-start' | 'resize-end',
  dayDelta: number,
): { start: number; end: number } {
  if (mode === 'move') {
    return { start: addDays(startMs, dayDelta), end: addDays(endMs, dayDelta) };
  }
  if (mode === 'resize-start') {
    const next = addDays(startMs, dayDelta);
    return { start: Math.min(next, endMs), end: endMs };
  }
  const next = addDays(endMs, dayDelta);
  return { start: startMs, end: Math.max(next, startMs) };
}
