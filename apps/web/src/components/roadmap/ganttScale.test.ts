import { describe, it, expect } from 'vitest';
import {
  MS_PER_DAY,
  isWeekendUTC,
  nextWorkday,
  prevWorkday,
  snapWindowToWorkdays,
  workdaysBetween,
  applyDrag,
  buildScale,
  daysBetween,
  planBounds,
  startOfWeekUTC,
  zoomById,
} from './ganttScale';

const day = (iso: string) => Date.parse(`${iso}T00:00:00.000Z`);

describe('ganttScale — axis', () => {
  it('places a date at the pixel offset its day number implies', () => {
    const scale = buildScale(day('2026-03-01'), day('2026-06-30'), zoomById('month'));
    const origin = scale.originMs;
    const tenDaysIn = origin + 10 * MS_PER_DAY;
    expect(scale.xOf(tenDaysIn)).toBeCloseTo(10 * 5, 5); // month zoom = 5px/day
  });

  it('round-trips a pixel back to the day it represents', () => {
    const scale = buildScale(day('2026-03-01'), day('2026-06-30'), zoomById('week'));
    const target = day('2026-04-15');
    expect(scale.dayAtX(scale.xOf(target))).toBe(target);
  });

  it('pads a single-day plan out to a readable span instead of a hairline', () => {
    const scale = buildScale(day('2026-05-10'), day('2026-05-10'), zoomById('month'));
    // A one-day plan would otherwise produce a ~5px-wide chart.
    expect(daysBetween(scale.originMs, scale.endMs)).toBeGreaterThanOrEqual(60);
    expect(scale.widthPx).toBeGreaterThan(200);
  });

  it('never emits an inverted axis when the end precedes the start', () => {
    const scale = buildScale(day('2026-05-10'), day('2026-01-01'), zoomById('month'));
    expect(scale.endMs).toBeGreaterThan(scale.originMs);
    expect(scale.widthPx).toBeGreaterThan(0);
  });

  it('caps tick generation so an absurd date cannot hang the tab', () => {
    // A stray year-3000 due date is a data-entry slip, not a reason to
    // generate a million DOM nodes.
    const scale = buildScale(day('2026-01-01'), day('3000-01-01'), zoomById('week'), 50);
    expect(scale.majorTicks.length).toBeLessThanOrEqual(50);
    expect(scale.minorTicks.length).toBeLessThanOrEqual(50);
  });

  it('anchors weeks to Monday', () => {
    // 2026-05-13 is a Wednesday.
    expect(new Date(startOfWeekUTC(day('2026-05-13'))).getUTCDay()).toBe(1);
    expect(startOfWeekUTC(day('2026-05-13'))).toBe(day('2026-05-11'));
    // A Monday is its own week start.
    expect(startOfWeekUTC(day('2026-05-11'))).toBe(day('2026-05-11'));
  });

  it('gives each zoom a distinct density, widest first', () => {
    const w = buildScale(day('2026-01-01'), day('2026-12-31'), zoomById('week')).widthPx;
    const m = buildScale(day('2026-01-01'), day('2026-12-31'), zoomById('month')).widthPx;
    const q = buildScale(day('2026-01-01'), day('2026-12-31'), zoomById('quarter')).widthPx;
    expect(w).toBeGreaterThan(m);
    expect(m).toBeGreaterThan(q);
  });
});

describe('ganttScale — planBounds', () => {
  it('returns null when nothing is dated, so the caller can show an empty state', () => {
    expect(planBounds([null, undefined, ''])).toBeNull();
  });

  it('always includes today, so the today marker is meaningful', () => {
    const b = planBounds(['2020-01-01T00:00:00.000Z']);
    expect(b).not.toBeNull();
    expect(b!.to).toBeGreaterThanOrEqual(Date.now() - 1000);
  });

  it('ignores unparseable dates rather than poisoning the axis with NaN', () => {
    const b = planBounds(['not-a-date', '2030-06-01T00:00:00.000Z']);
    expect(b).not.toBeNull();
    expect(Number.isFinite(b!.from)).toBe(true);
    expect(Number.isFinite(b!.to)).toBe(true);
  });
});

describe('ganttScale — applyDrag', () => {
  const start = day('2026-04-10');
  const end = day('2026-04-20');

  it('moves both ends together, preserving duration', () => {
    const r = applyDrag(start, end, 'move', 5);
    expect(r.start).toBe(day('2026-04-15'));
    expect(r.end).toBe(day('2026-04-25'));
    expect(daysBetween(r.start, r.end)).toBe(10);
  });

  it('moves backwards for a negative delta', () => {
    const r = applyDrag(start, end, 'move', -3);
    expect(r.start).toBe(day('2026-04-07'));
    expect(r.end).toBe(day('2026-04-17'));
  });

  it('resizes only the dragged end', () => {
    expect(applyDrag(start, end, 'resize-end', 4).end).toBe(day('2026-04-24'));
    expect(applyDrag(start, end, 'resize-end', 4).start).toBe(start);
    expect(applyDrag(start, end, 'resize-start', -4).start).toBe(day('2026-04-06'));
    expect(applyDrag(start, end, 'resize-start', -4).end).toBe(end);
  });

  it('refuses to invert a bar when a handle is dragged past the other end', () => {
    // Dragging the start handle 30 days right would put startDate after
    // dueDate — which the API rejects outright, so the UI must never offer it.
    const r = applyDrag(start, end, 'resize-start', 30);
    expect(r.start).toBe(end);
    expect(r.end).toBe(end);
    expect(r.start).toBeLessThanOrEqual(r.end);

    const l = applyDrag(start, end, 'resize-end', -30);
    expect(l.end).toBe(start);
    expect(l.start).toBeLessThanOrEqual(l.end);
  });

  it('is a no-op for a zero delta', () => {
    expect(applyDrag(start, end, 'move', 0)).toEqual({ start, end });
  });
});

describe('ganttScale — working days', () => {
  // 2026-05-09 is a Saturday, 05-10 a Sunday, 05-11 a Monday.
  it('identifies weekends in UTC', () => {
    expect(isWeekendUTC(day('2026-05-09'))).toBe(true);
    expect(isWeekendUTC(day('2026-05-10'))).toBe(true);
    expect(isWeekendUTC(day('2026-05-11'))).toBe(false);
    expect(isWeekendUTC(day('2026-05-08'))).toBe(false);
  });

  it('pushes a start forward to Monday and pulls an end back to Friday', () => {
    expect(nextWorkday(day('2026-05-09'))).toBe(day('2026-05-11'));
    expect(prevWorkday(day('2026-05-10'))).toBe(day('2026-05-08'));
    // A weekday is left exactly where it is.
    expect(nextWorkday(day('2026-05-12'))).toBe(day('2026-05-12'));
    expect(prevWorkday(day('2026-05-12'))).toBe(day('2026-05-12'));
  });

  it('never inverts a window that lands entirely on a weekend', () => {
    // Snapping each end independently would give start=Mon 11th, end=Fri 8th —
    // a due date three days before its own start, which the API rejects.
    const r = snapWindowToWorkdays(day('2026-05-09'), day('2026-05-10'));
    expect(r.start).toBe(r.end);
    expect(r.end).toBeGreaterThanOrEqual(r.start);
    expect(isWeekendUTC(r.start)).toBe(false);
  });

  it('snaps a normal window without moving weekday ends', () => {
    const r = snapWindowToWorkdays(day('2026-05-11'), day('2026-05-15'));
    expect(r.start).toBe(day('2026-05-11'));
    expect(r.end).toBe(day('2026-05-15'));
  });

  it('counts weekdays only, skipping the weekend in between', () => {
    // Mon 11th → Mon 18th spans 7 calendar days but only 5 working ones.
    expect(workdaysBetween(day('2026-05-11'), day('2026-05-18'))).toBe(5);
    expect(daysBetween(day('2026-05-11'), day('2026-05-18'))).toBe(7);
  });
});
