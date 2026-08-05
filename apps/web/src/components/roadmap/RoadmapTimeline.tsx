import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  SprintState,
  VersionState,
  type RoadmapChildDto,
  type RoadmapDto,
  type RoadmapEpicDto,
} from '@next-lane/shared';
import { cn } from '@/lib/cn';
import { useExpandedEpicChildren } from '@/api/roadmap';
import {
  MS_PER_DAY,
  ZOOMS,
  addDays,
  applyDrag,
  buildScale,
  daysBetween,
  planBounds,
  snapWindowToWorkdays,
  startOfDayUTC,
  weekendBands,
  workdaysBetween,
  zoomById,
  type Scale,
  type ZoomId,
} from './ganttScale';

/**
 * The roadmap Gantt.
 *
 * A fixed left rail of row labels beside a horizontally scrolling time grid —
 * the conventional Gantt shape, because a stakeholder should not have to learn
 * a novel one. Everything on the right is positioned in pixels off a shared
 * `Scale` (see ganttScale.ts), which is what makes dragging, day-snapping and
 * three zoom levels all fall out of the same arithmetic.
 *
 * What it draws, and why each earns its place:
 *  - EPIC BARS, draggable to move and resizable from either edge. Writes land
 *    on the epic's own startDate/dueDate.
 *  - THE OVERRUN MARK. When an epic states a window and its children spill
 *    past it, the bar keeps its committed length and grows a hatched tail to
 *    where the work actually reaches. Widening the bar silently would erase
 *    the single most useful fact on the chart.
 *  - CHILD ROWS, on expanding an epic. A child whose window comes from its
 *    sprint rather than its own dates is drawn differently and is not
 *    draggable — dragging it would silently detach it from its sprint.
 *  - MILESTONES, from dated project Versions, as diamonds with full-height
 *    guide lines.
 *  - DEPENDENCY ARROWS between epics that BLOCK one another, drawn red when
 *    the blocker is scheduled to finish after the thing it blocks starts.
 *
 * Dragging is pointer-based and also fully keyboard-operable: focus a bar and
 * Alt+← / Alt+→ moves it a day, Alt+Shift+← / → resizes the end. A planning
 * tool where the plan can only be changed with a mouse is not one everybody
 * can use.
 */

const ROW_H = 34;
const BAR_H = 20;
const RAIL_W = 248;
const AXIS_H = 44;
const LANE_GAP = 8;
/** Pointer movement below this is a click, above it is a drag. */
const DRAG_THRESHOLD_PX = 4;

const SPRINT_COLORS: Record<SprintState, { bar: string; dot: string; label: string }> = {
  [SprintState.PLANNED]: { bar: 'bg-ink-200 text-ink-700', dot: 'bg-ink-400', label: 'Planned' },
  [SprintState.ACTIVE]: { bar: 'bg-signal-500 text-white', dot: 'bg-signal-500', label: 'Active' },
  [SprintState.COMPLETED]: { bar: 'bg-emerald-500 text-white', dot: 'bg-emerald-500', label: 'Completed' },
};

type DragMode = 'move' | 'resize-start' | 'resize-end';

interface DragState {
  id: string;
  mode: DragMode;
  pointerId: number;
  originX: number;
  dayDelta: number;
  moved: boolean;
}

export interface RoadmapTimelineProps {
  data: RoadmapDto;
  onOpenEpic: (epicId: string) => void;
  /** Commit a new window for an issue. Absent = read-only (no drag affordances). */
  onSchedule?: (input: {
    issueId: string;
    startDate: string;
    dueDate: string;
    parentEpicId?: string;
  }) => void;
  projectId?: string;
  /** True while a schedule write is in flight, to damp the UI. */
  isSaving?: boolean;
  /** Create an epic, or a story under one. Absent = read-only. */
  onCreate?: (input: { title: string; parentEpicId?: string }) => Promise<void>;
}

export function RoadmapTimeline({
  data,
  onOpenEpic,
  onSchedule,
  projectId,
  isSaving,
  onCreate,
}: RoadmapTimelineProps) {
  const [zoomId, setZoomId] = useState<ZoomId>('month');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<DragState | null>(null);
  const [liveMessage, setLiveMessage] = useState('');
  /*
   * Extra months of empty future kept on the axis beyond what the plan spans.
   *
   * Without this the timeline stopped dead at the last dated thing, so there
   * was nowhere to drag work TO — planning the next quarter meant first
   * inventing a date somewhere else. Grows when you scroll to the right edge,
   * so the horizon extends as you explore rather than rendering years nobody
   * asked for up front.
   */
  const [horizonMonths, setHorizonMonths] = useState(3);
  /** Which row's inline "add" form is open: an epic id, or 'epic' for a new epic. */
  const [creatingUnder, setCreatingUnder] = useState<string | null>(null);
  /** Measured width of the scrolling grid, so a zoom can stretch to fill it. */
  const [gridWidth, setGridWidth] = useState(0);
  /*
   * Skip weekends. Off by default because plenty of teams genuinely do run
   * across a weekend and forcing working-days on them would silently move
   * their dates; persisted per browser because it is a preference about how
   * YOU plan, not a property of the project.
   */
  const [skipWeekends, setSkipWeekends] = useState(
    () => localStorage.getItem('nl_roadmap_skip_weekends') === '1',
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  /*
   * A pointer drag is ALSO followed by a native `click` on the same element.
   * Guarding on drag state does not work: the window pointerup handler clears
   * that state first, so by the time onClick runs the component has already
   * re-rendered with `drag === null` and the guard passes. Every drag opened
   * the issue drawer. A ref survives the re-render; the click that follows the
   * drag consumes it.
   */
  const suppressClickRef = useRef(false);

  const editable = !!onSchedule;
  const canCreate = !!onCreate;
  const zoom = zoomById(zoomId);

  const expandedIds = useMemo(() => [...expanded], [expanded]);
  const childrenByEpic = useExpandedEpicChildren(projectId, expandedIds);

  const datedEpics = useMemo(
    () => data.epics.filter((e) => e.start && e.end),
    [data.epics],
  );
  const noDateEpics = useMemo(
    () => data.epics.filter((e) => !e.start || !e.end),
    [data.epics],
  );

  const rawBounds = useMemo(
    () =>
      planBounds([
        ...data.sprints.flatMap((s) => [s.startDate, s.endDate]),
        ...data.epics.flatMap((e) => [e.start, e.end, e.rollupStart, e.rollupEnd]),
        ...data.milestones.map((m) => m.releaseDate),
      ]),
    [data],
  );

  const bounds = useMemo(
    () =>
      rawBounds
        ? { from: rawBounds.from, to: addDays(rawBounds.to, horizonMonths * 30) }
        : null,
    [rawBounds, horizonMonths],
  );

  const scale = useMemo(
    () => (bounds ? buildScale(bounds.from, bounds.to, zoom, 800, gridWidth) : null),
    [bounds, zoom, gridWidth],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => setGridWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Drag plumbing ─────────────────────────────────────────────────────────
  //
  // Tracked on `window` rather than the bar: a drag that outruns React's
  // re-render leaves the 20px-tall bar and the gesture dies mid-flight. Pointer
  // capture plus window listeners means the drag survives leaving the element,
  // the row, and the scroll container.
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== drag.pointerId) return;
      const dx = e.clientX - drag.originX;
      // The EFFECTIVE day width, not the nominal zoom one — a stretched
      // scale would otherwise move the bar further than the cursor.
      const dayDelta = Math.round(dx / (scale?.pxPerDay ?? zoom.pxPerDay));
      setDrag((d) =>
        d && (d.dayDelta !== dayDelta || !d.moved)
          ? {
              ...d,
              dayDelta,
              moved: d.moved || Math.abs(dx) > DRAG_THRESHOLD_PX,
            }
          : d,
      );
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== drag.pointerId) return;
      setDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [drag, zoom.pxPerDay, scale]);

  const commit = useCallback(
    (
      issueId: string,
      startMs: number,
      endMs: number,
      parentEpicId?: string,
      label?: string,
    ) => {
      if (!onSchedule) return;
      // Snap at COMMIT time rather than during the drag: nudging the bar under
      // the cursor mid-gesture feels like the chart fighting you. It lands on
      // working days when you let go.
      const win = skipWeekends
        ? snapWindowToWorkdays(startMs, endMs)
        : { start: startMs, end: endMs };
      onSchedule({
        issueId,
        startDate: new Date(startOfDayUTC(win.start)).toISOString(),
        dueDate: new Date(startOfDayUTC(win.end)).toISOString(),
        parentEpicId,
      });
      if (label) setLiveMessage(label);
    },
    [onSchedule, skipWeekends],
  );

  /** Finish a pointer drag: commit if it actually moved, otherwise it was a click. */
  const endDrag = useCallback(
    (
      item: { id: string; start: string; end: string },
      parentEpicId: string | undefined,
      d: DragState,
    ) => {
      // A press that never moved is a click; let the native click handle it.
      if (!d.moved || d.dayDelta === 0) return;
      suppressClickRef.current = true;
      const next = applyDrag(
        Date.parse(item.start),
        Date.parse(item.end),
        d.mode,
        d.dayDelta,
      );
      commit(
        item.id,
        next.start,
        next.end,
        parentEpicId,
        `Moved to ${fmtRange(next.start, next.end)}`,
      );
    },
    [commit],
  );

  /** Alt+arrow nudging — the keyboard equivalent of a drag. */
  const nudge = useCallback(
    (
      e: React.KeyboardEvent,
      item: { id: string; start: string; end: string },
      parentEpicId?: string,
    ) => {
      if (!editable || !e.altKey) return;
      const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (dir === 0) return;
      e.preventDefault();
      const mode: DragMode = e.shiftKey ? 'resize-end' : 'move';
      const next = applyDrag(
        Date.parse(item.start),
        Date.parse(item.end),
        mode,
        dir,
      );
      commit(
        item.id,
        next.start,
        next.end,
        parentEpicId,
        `${e.shiftKey ? 'Resized' : 'Moved'} to ${fmtRange(next.start, next.end)}`,
      );
    },
    [commit, editable],
  );

  /** Commit a window painted onto an empty child row. */
  const onSchedulePainted = useCallback(
    (issueId: string, parentEpicId: string, startMs: number, endMs: number) => {
      commit(
        issueId,
        startMs,
        endMs,
        parentEpicId,
        `Scheduled ${fmtRange(startMs, endMs)}`,
      );
    },
    [commit],
  );

  /** Extend the future horizon when the user reaches the right-hand edge. */
  const onGridScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const remaining = el.scrollWidth - el.scrollLeft - el.clientWidth;
    if (remaining < 240) setHorizonMonths((m) => Math.min(m + 3, 48));
  }, []);

  const scrollToToday = useCallback(() => {
    if (!scale || !scrollRef.current) return;
    const x = scale.xOf(Date.now());
    scrollRef.current.scrollTo({
      left: Math.max(0, x - scrollRef.current.clientWidth / 2),
      behavior: 'smooth',
    });
  }, [scale]);

  function toggleExpand(epicId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(epicId)) next.delete(epicId);
      else next.add(epicId);
      return next;
    });
  }

  // ── Row layout ────────────────────────────────────────────────────────────
  //
  // One flat list of rows with explicit y offsets, built from the ACTUAL child
  // counts. The dependency overlay is absolutely positioned, so it needs real
  // offsets; an earlier version pushed an opaque "children" row without
  // advancing y, and every epic below an expanded one had an offset short by
  // the height of that block — arrows pointed into empty space.
  const rows = useMemo(() => {
    const out: Array<
      | { kind: 'epic'; epic: RoadmapEpicDto; y: number }
      | { kind: 'child'; epicId: string; child: RoadmapChildDto; y: number }
      | { kind: 'child-note'; epicId: string; text: string; y: number }
      | { kind: 'add-child'; epicId: string; y: number }
      | { kind: 'add-epic'; y: number }
    > = [];
    let y = 0;
    for (const epic of datedEpics) {
      out.push({ kind: 'epic', epic, y });
      y += ROW_H;
      if (!expanded.has(epic.id)) continue;
      const kids = childrenByEpic.get(epic.id);
      if (kids === undefined) {
        out.push({ kind: 'child-note', epicId: epic.id, text: 'Loading stories…', y });
        y += ROW_H;
      } else if (kids.length === 0) {
        out.push({ kind: 'child-note', epicId: epic.id, text: 'No child issues.', y });
        y += ROW_H;
      } else {
        for (const child of kids) {
          out.push({ kind: 'child', epicId: epic.id, child, y });
          y += ROW_H;
        }
      }
      // The create affordance sits directly under the last story of the epic
      // it belongs to, the way Jira Cloud does it — a row in the chart rather
      // than a control in a toolbar, so "add" is where the thing being added
      // will appear.
      if (canCreate && kids !== undefined) {
        out.push({ kind: 'add-child', epicId: epic.id, y });
        y += ROW_H;
      }
    }
    if (canCreate) {
      out.push({ kind: 'add-epic', y });
      y += ROW_H;
    }
    return out;
  }, [datedEpics, expanded, childrenByEpic, canCreate]);

  const totalRowsHeight = rows.length > 0 ? rows[rows.length - 1].y + ROW_H : 0;

  const epicYById = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) if (r.kind === 'epic') m.set(r.epic.id, r.y);
    return m;
  }, [rows]);

  if (!scale || !bounds) {
    return (
      <NoDatesOnly epics={noDateEpics} onOpenEpic={onOpenEpic} />
    );
  }

  const todayX = scale.xOf(Date.now());
  const todayVisible =
    Date.now() >= scale.originMs && Date.now() <= scale.endMs;

  return (
    <div className="flex flex-col gap-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div
          className="inline-flex items-center rounded-lg border border-ink-200 bg-surface p-0.5"
          role="group"
          aria-label="Timeline zoom"
        >
          {ZOOMS.map((z) => (
            <button
              key={z.id}
              type="button"
              onClick={() => setZoomId(z.id)}
              data-testid={`roadmap-zoom-${z.id}`}
              aria-pressed={zoomId === z.id}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                // Theme tokens, not a hardcoded near-black: `bg-ink-900` is
                // almost the dark theme's own surface, so the selected segment
                // vanished into the control in dark mode.
                zoomId === z.id
                  ? 'bg-signal-600 text-white shadow-xs'
                  : 'text-ink-500 hover:bg-ink-100 hover:text-ink-800',
              )}
            >
              {z.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={skipWeekends}
          data-testid="roadmap-skip-weekends"
          onClick={() => {
            const next = !skipWeekends;
            setSkipWeekends(next);
            localStorage.setItem('nl_roadmap_skip_weekends', next ? '1' : '0');
          }}
          title="Shade weekends and keep scheduled dates on working days"
          className={cn(
            'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
            skipWeekends
              ? 'border-signal-300 bg-signal-50 text-signal-700'
              : 'border-ink-200 bg-surface text-ink-500 hover:bg-ink-100 hover:text-ink-900',
          )}
        >
          Skip weekends
        </button>


        <button
          type="button"
          onClick={scrollToToday}
          data-testid="roadmap-jump-today"
          className="rounded-md border border-ink-200 bg-surface px-2.5 py-1 text-xs font-medium text-ink-600 hover:bg-ink-100 hover:text-ink-900"
        >
          Today
        </button>

        <div className="ml-auto flex flex-wrap items-center gap-3 text-xs text-ink-500">
          {(Object.keys(SPRINT_COLORS) as SprintState[]).map((st) => (
            <span key={st} className="flex items-center gap-1.5">
              <span className={cn('inline-block h-2.5 w-2.5 rounded-sm', SPRINT_COLORS[st].dot)} />
              {SPRINT_COLORS[st].label}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-0.5 bg-red-500" />
            Today
          </span>
          <span className="flex items-center gap-1.5">
            <span className="nl-gantt-overrun inline-block h-2.5 w-4 rounded-sm" />
            Overruns plan
          </span>
        </div>
      </div>

      {editable && (
        <p className="text-xs text-ink-400">
          Drag a bar to move it, drag either edge to resize. With a bar focused,
          Alt + ← / → moves it a day and Alt + Shift + ← / → changes its end.
        </p>
      )}

      {/* Chart */}
      <div className="flex overflow-hidden rounded-lg border border-ink-200">
        {/* Left rail */}
        <div
          className="shrink-0 border-r border-ink-200 bg-ink-50/60"
          style={{ width: RAIL_W }}
        >
          <div
            className="flex items-end border-b border-ink-200 px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400"
            style={{ height: AXIS_H }}
          >
            Epic
          </div>
          {data.sprints.length > 0 && (
            <div
              className="flex items-center border-b border-ink-100 px-3 text-[11px] font-semibold uppercase tracking-wide text-ink-400"
              style={{ height: ROW_H + LANE_GAP }}
            >
              Sprints
            </div>
          )}
          {rows.map((r) =>
            r.kind === 'epic' ? (
              <EpicRailRow
                key={r.epic.id}
                epic={r.epic}
                expanded={expanded.has(r.epic.id)}
                onToggle={() => toggleExpand(r.epic.id)}
                onOpen={() => onOpenEpic(r.epic.id)}
                canCreate={canCreate}
              />
            ) : r.kind === 'child' ? (
              <div
                key={`rail-${r.child.id}`}
                className="flex items-center gap-1.5 border-b border-ink-100 bg-ink-50/40 pl-8 pr-2"
                style={{ height: ROW_H }}
                title={`${r.child.key} · ${r.child.title}`}
              >
                <span className="nl-issue-key shrink-0 text-[10px]">{r.child.key}</span>
                <span className="truncate text-[11px] text-ink-600">{r.child.title}</span>
              </div>
            ) : r.kind === 'child-note' ? (
              <div
                key={`note-${r.epicId}`}
                className="border-b border-ink-100 bg-ink-50/40 pl-8 pr-2 text-[11px] text-ink-400"
                style={{ height: ROW_H, lineHeight: `${ROW_H}px` }}
              >
                {r.text}
              </div>
            ) : r.kind === 'add-child' ? (
              <AddRow
                key={`add-${r.epicId}`}
                testId={`roadmap-add-story-${r.epicId}`}
                label="Create story"
                indented
                active={creatingUnder === r.epicId}
                onActivate={() => setCreatingUnder(r.epicId)}
                onCancel={() => setCreatingUnder(null)}
                onSubmit={async (title) => {
                  await onCreate?.({ title, parentEpicId: r.epicId });
                }}
              />
            ) : (
              <AddRow
                key="add-epic"
                testId="roadmap-add-epic"
                label="Create epic"
                active={creatingUnder === 'epic'}
                onActivate={() => setCreatingUnder('epic')}
                onCancel={() => setCreatingUnder(null)}
                onSubmit={async (title) => {
                  await onCreate?.({ title });
                }}
              />
            ),
          )}
        </div>

        {/* Scrollable time grid */}
        <div
          ref={scrollRef}
          onScroll={onGridScroll}
          className="min-w-0 flex-1 overflow-x-auto"
        >
          {/* `minWidth: 100%` so a short plan at Month or Quarter still fills
              the panel instead of leaving a wide empty gutter to its right.
              Bars stay pixel-positioned off the scale either way. */}
          <div style={{ width: scale.widthPx }}>
            {/* Axis */}
            <div
              className="relative border-b border-ink-200 bg-surface"
              style={{ height: AXIS_H }}
            >
              {scale.majorTicks.map((t) => (
                <div
                  key={t.ms}
                  className="absolute bottom-1 whitespace-nowrap border-l border-ink-200 pl-1 text-[11px] font-medium text-ink-500"
                  style={{ left: t.x, top: 6 }}
                >
                  {t.label}
                </div>
              ))}
              {data.milestones.map((m) => (
                <MilestoneMarker key={m.id} milestone={m} x={scale.xOf(Date.parse(m.releaseDate))} />
              ))}
            </div>

            {/* Lanes */}
            <div className="relative bg-surface">
              {/* Weekend bands, behind everything. Only drawn when a day is
                  wide enough to read as a band — see `weekendBands`. */}
              {skipWeekends &&
                weekendBands(scale).map((b) => (
                  <div
                    key={`wk-${b.x}`}
                    className="pointer-events-none absolute top-0 bottom-0 bg-ink-200/35"
                    style={{ left: b.x, width: b.width }}
                    aria-hidden="true"
                  />
                ))}

              {/* Minor gridlines */}
              {scale.minorTicks.map((t) => (
                <div
                  key={t.ms}
                  className="pointer-events-none absolute top-0 bottom-0 w-px bg-ink-100"
                  style={{ left: t.x }}
                  aria-hidden="true"
                />
              ))}
              {/* Milestone guide lines */}
              {data.milestones.map((m) => (
                <div
                  key={`guide-${m.id}`}
                  className="pointer-events-none absolute top-0 bottom-0 w-px border-l border-dashed border-amber-400/70"
                  style={{ left: scale.xOf(Date.parse(m.releaseDate)) }}
                  aria-hidden="true"
                />
              ))}
              {todayVisible && (
                <div
                  className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-red-500"
                  style={{ left: todayX }}
                  aria-hidden="true"
                />
              )}

              {/* Sprint lane */}
              {data.sprints.length > 0 && (
                <div
                  className="relative border-b border-ink-100"
                  style={{ height: ROW_H + LANE_GAP }}
                >
                  {data.sprints.map((s) => {
                    const sStart = s.startDate ? Date.parse(s.startDate) : null;
                    const sEnd = s.endDate ? Date.parse(s.endDate) : null;
                    const from = sStart ?? sEnd ?? scale.originMs;
                    const to = sEnd ?? sStart ?? scale.originMs;
                    const left = scale.xOf(from);
                    const width = Math.max(6, scale.xOf(to) - left);
                    const c = SPRINT_COLORS[s.state as SprintState];
                    return (
                      <div
                        key={s.id}
                        data-testid="roadmap-sprint-bar"
                        title={`${s.name} (${c.label})`}
                        className={cn(
                          'absolute flex items-center overflow-hidden rounded px-2 text-[11px] font-medium shadow-xs',
                          c.bar,
                        )}
                        style={{ left, width, top: LANE_GAP, height: BAR_H }}
                      >
                        <span className="truncate">{s.name}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Dependency arrows, under the bars so they never eat a click. */}
              <DependencyLayer
                data={data}
                scale={scale}
                epicYById={epicYById}
                height={totalRowsHeight}
                // Row offsets are measured from the first EPIC row, but the
                // sprint lane renders above them inside the same container.
                // Without this the overlay sat one lane high and every arrow
                // pointed at the row above its target.
                offsetY={data.sprints.length > 0 ? ROW_H + LANE_GAP : 0}
              />

              {/* Epic + child rows */}
              {rows.map((r) =>
                r.kind === 'epic' ? (
                  <EpicBarRow
                    key={r.epic.id}
                    epic={r.epic}
                    scale={scale}
                    editable={editable}
                    drag={drag?.id === r.epic.id ? drag : null}
                    onDragStart={(mode, e) => {
                      setDrag({
                        id: r.epic.id,
                        mode,
                        pointerId: e.pointerId,
                        originX: e.clientX,
                        dayDelta: 0,
                        moved: false,
                      });
                    }}
                    onDragEnd={(d) =>
                      endDrag(
                        { id: r.epic.id, start: r.epic.start as string, end: r.epic.end as string },
                        undefined,
                        d,
                      )
                    }
                    onKeyDown={(e) =>
                      nudge(e, {
                        id: r.epic.id,
                        start: r.epic.start as string,
                        end: r.epic.end as string,
                      })
                    }
                    skipWeekends={skipWeekends}
                    onOpen={() => {
                      if (suppressClickRef.current) {
                        suppressClickRef.current = false;
                        return;
                      }
                      onOpenEpic(r.epic.id);
                    }}
                  />
                ) : r.kind === 'child' ? (
                  <ChildBar
                    key={`bar-${r.child.id}`}
                    child={r.child}
                    epicId={r.epicId}
                    scale={scale}
                    editable={editable}
                    drag={drag?.id === r.child.id ? drag : null}
                    setDrag={setDrag}
                    endDrag={endDrag}
                    nudge={nudge}
                    onSchedulePainted={onSchedulePainted}
                  />
                ) : r.kind === 'child-note' ? (
                  <div
                    key={`barnote-${r.epicId}`}
                    className="border-b border-ink-100 bg-ink-50/40"
                    style={{ height: ROW_H }}
                  />
                ) : (
                  // Spacer keeping the grid aligned with the rail's add-rows.
                  <div
                    key={r.kind === 'add-child' ? `addbar-${r.epicId}` : 'addbar-epic'}
                    className="border-b border-ink-100"
                    style={{ height: ROW_H }}
                  />
                ),
              )}

              {rows.length === 0 && (
                <div className="px-3 py-6 text-sm text-ink-400">
                  No epics with dates yet.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {isSaving && (
        <p className="text-xs text-ink-400" role="status">
          Saving…
        </p>
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </p>

      {/* Milestone list — the diamonds are a glance, this is the detail. */}
      {data.milestones.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {data.milestones.map((m) => (
            <span
              key={m.id}
              data-testid="roadmap-milestone-chip"
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs text-amber-800"
            >
              <span className="inline-block h-2 w-2 rotate-45 bg-amber-500" aria-hidden="true" />
              <span className="font-medium">{m.name}</span>
              <span className="text-amber-600">
                {new Date(m.releaseDate).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  timeZone: 'UTC',
                })}
              </span>
              {m.state === VersionState.UNRELEASED && m.openIssueCount > 0 && (
                <span className="rounded-full bg-amber-200/70 px-1.5 font-semibold">
                  {m.openIssueCount} open
                </span>
              )}
            </span>
          ))}
        </div>
      )}

      {noDateEpics.length > 0 && (
        <NoDatesLane epics={noDateEpics} onOpenEpic={onOpenEpic} />
      )}
    </div>
  );
}

// ── Left-rail rows ──────────────────────────────────────────────────────────

function EpicRailRow({
  epic,
  expanded,
  onToggle,
  onOpen,
  canCreate,
}: {
  epic: RoadmapEpicDto;
  expanded: boolean;
  onToggle: () => void;
  onOpen: () => void;
  /** Expanding a CHILDLESS epic is still useful when you can create one. */
  canCreate: boolean;
}) {
  return (
    <div
      className="group/rail flex items-center gap-1 border-b border-ink-100 pl-1 pr-2"
      style={{ height: ROW_H }}
    >
      <button
        type="button"
        onClick={onToggle}
        data-testid={`roadmap-epic-expand-${epic.id}`}
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} ${epic.key} ${epic.title}`}
        // An epic with no children was previously un-expandable, which made
        // its "Create story" row unreachable — you could never add the FIRST
        // story to an epic from the chart. Caught by e2e.
        disabled={epic.childCount === 0 && !canCreate}
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-400',
          epic.childCount === 0 && !canCreate
            ? 'invisible'
            : 'hover:bg-ink-200 hover:text-ink-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400',
        )}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          aria-hidden="true"
          className={cn('transition-transform', expanded && 'rotate-90')}
        >
          <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        title={`${epic.key} · ${epic.title}`}
      >
        <span className="nl-issue-key shrink-0 text-[10px]">{epic.key}</span>
        <span className="truncate text-xs font-medium text-ink-800">{epic.title}</span>
      </button>
      <span className="shrink-0 text-[10px] font-semibold tabular-nums text-ink-400">
        {Math.round(epic.progress * 100)}%
      </span>
    </div>
  );
}

/**
 * A create affordance shaped like a row, sitting directly beneath the things
 * it creates — "+ Create epic" under the last epic, "+ Create story" under the
 * last story of its epic. Jira Cloud puts it here and it is the right place:
 * the control lives where the result will appear, so there is no hunting in a
 * toolbar for something whose target is a specific row.
 *
 * Title only, on purpose. You place the thing by dragging it, and a modal with
 * six fields would restore exactly the context switch this screen removes.
 */
function AddRow({
  testId,
  label,
  indented,
  active,
  onActivate,
  onCancel,
  onSubmit,
}: {
  testId: string;
  label: string;
  indented?: boolean;
  active: boolean;
  onActivate: () => void;
  onCancel: () => void;
  onSubmit: (title: string) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await onSubmit(t);
      // Stay open so several can be added in a row — the common case when you
      // are filling in a plan.
      setTitle('');
    } finally {
      setBusy(false);
    }
  }

  if (!active) {
    return (
      <div
        className={cn('border-b border-ink-100', indented && 'bg-ink-50/40')}
        style={{ height: ROW_H }}
      >
        <button
          type="button"
          onClick={onActivate}
          data-testid={testId}
          className={cn(
            'flex h-full w-full items-center gap-1.5 pr-2 text-left text-[11px] font-medium text-ink-400',
            'hover:bg-ink-100 hover:text-ink-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400',
            indented ? 'pl-8' : 'pl-2',
          )}
        >
          <span aria-hidden="true" className="text-sm leading-none">+</span>
          {label}
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex items-center gap-1 border-b border-ink-100 pr-1',
        indented ? 'bg-ink-50/40 pl-7' : 'pl-1',
      )}
      style={{ height: ROW_H }}
    >
      <input
        autoFocus
        value={title}
        disabled={busy}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void submit();
          } else if (e.key === 'Escape') {
            onCancel();
          }
        }}
        onBlur={() => !title.trim() && onCancel()}
        placeholder={`${label}…`}
        aria-label={label}
        data-testid={`${testId}-input`}
        className="min-w-0 flex-1 rounded border border-signal-300 bg-surface px-1.5 py-0.5 text-[11px] text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400"
      />
    </div>
  );
}

// ── Bars ────────────────────────────────────────────────────────────────────

function EpicBarRow({
  epic,
  scale,
  editable,
  drag,
  onDragStart,
  onDragEnd,
  onKeyDown,
  onOpen,
  skipWeekends,
}: {
  epic: RoadmapEpicDto;
  scale: Scale;
  editable: boolean;
  skipWeekends: boolean;
  drag: DragState | null;
  onDragStart: (mode: DragMode, e: React.PointerEvent) => void;
  onDragEnd: (d: DragState) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onOpen: () => void;
}) {
  const baseStart = Date.parse(epic.start as string);
  const baseEnd = Date.parse(epic.end as string);
  const preview = drag
    ? applyDrag(baseStart, baseEnd, drag.mode, drag.dayDelta)
    : { start: baseStart, end: baseEnd };

  const left = scale.xOf(preview.start);
  const width = Math.max(8, scale.xOf(preview.end) - left);
  const fill = Math.round(epic.progress * 100);

  // The overrun tail: from the committed end to where the children actually
  // reach. Drawn as a separate hatched element rather than by lengthening the
  // bar, so the commitment stays legible next to the reality.
  const rollupEnd = epic.rollupEnd ? Date.parse(epic.rollupEnd) : null;
  const overrunX =
    epic.overrunDays > 0 && rollupEnd ? scale.xOf(rollupEnd) : null;

  useEffect(() => {
    if (!drag) return;
    const onUp = () => onDragEnd(drag);
    window.addEventListener('pointerup', onUp, { once: true });
    window.addEventListener('pointercancel', onUp, { once: true });
    return () => {
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [drag, onDragEnd]);

  return (
    <div className="relative border-b border-ink-100" style={{ height: ROW_H }}>
      {overrunX !== null && (
        <div
          className="nl-gantt-overrun pointer-events-none absolute rounded-r"
          style={{
            left: left + width,
            width: Math.max(4, overrunX - (left + width)),
            top: (ROW_H - BAR_H) / 2,
            height: BAR_H,
          }}
          aria-hidden="true"
        />
      )}
      <button
        type="button"
        data-testid="roadmap-epic-bar"
        data-epic-id={epic.id}
        onPointerDown={(e) => {
          if (!canDragWith(e) || !editable) return;
          onDragStart('move', e);
        }}
        data-draggable={editable ? 'true' : 'false'}
        onKeyDown={onKeyDown}
        // `onOpen` itself consumes the post-drag click (see suppressClickRef).
        onClick={onOpen}
        title={epicTitle(epic)}
        aria-label={epicTitle(epic)}
        className={cn(
          'group absolute flex items-center overflow-visible rounded-md border text-left shadow-xs transition-shadow',
          'border-signal-300 bg-signal-100 hover:shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400',
          editable && 'cursor-grab active:cursor-grabbing',
          drag?.moved && 'z-30 shadow-card ring-2 ring-signal-400',
        )}
        style={{ left, width, top: (ROW_H - BAR_H) / 2, height: BAR_H }}
      >
        <span
          className="absolute inset-y-0 left-0 rounded-l-md bg-signal-300/70"
          style={{ width: `${fill}%` }}
          aria-hidden="true"
        />
        {/* Live feedback while dragging: how many days you have moved, and
            what the window becomes. Without it a drag is guesswork — you drop
            the bar and only then find out where it landed. */}
        {drag?.moved && (
          <span className="pointer-events-none absolute -top-6 left-0 z-40 whitespace-nowrap rounded bg-ink-900 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-card">
            {signedDays(drag.dayDelta)} · {fmtRange(preview.start, preview.end)}
            {skipWeekends && (
              <span className="ml-1 opacity-70">
                ({workdaysBetween(preview.start, preview.end)}wd)
              </span>
            )}
          </span>
        )}
        <span className="relative z-10 flex w-full items-center gap-1.5 overflow-hidden px-1.5">
          <span className="truncate text-[11px] font-medium text-signal-900">
            {epic.title}
          </span>
          {epic.childrenOutside > 0 && (
            <span className="ml-auto shrink-0 rounded bg-amber-400/90 px-1 text-[9px] font-bold text-amber-950">
              +{epic.overrunDays}d
            </span>
          )}
        </span>

        {editable && (
          <>
            <ResizeGrip side="start" onPointerDown={(e) => onDragStart('resize-start', e)} />
            <ResizeGrip side="end" onPointerDown={(e) => onDragStart('resize-end', e)} />
          </>
        )}
      </button>
    </div>
  );
}

function ResizeGrip({
  side,
  onPointerDown,
}: {
  side: 'start' | 'end';
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  return (
    <span
      role="presentation"
      onPointerDown={(e) => {
        if (!canDragWith(e)) return;
        e.stopPropagation();
        onPointerDown(e);
      }}
      className={cn(
        'absolute inset-y-0 z-20 w-2 cursor-ew-resize opacity-0 transition-opacity group-hover:opacity-100',
        side === 'start' ? 'left-0 rounded-l-md' : 'right-0 rounded-r-md',
        'bg-signal-500/40',
      )}
    />
  );
}

function ChildBar({
  child,
  epicId,
  scale,
  editable,
  drag,
  setDrag,
  endDrag,
  nudge,
  onSchedulePainted,
}: {
  child: RoadmapChildDto;
  epicId: string;
  scale: Scale;
  editable: boolean;
  drag: DragState | null;
  setDrag: (d: DragState) => void;
  endDrag: (
    item: { id: string; start: string; end: string },
    parentEpicId: string | undefined,
    d: DragState,
  ) => void;
  nudge: (
    e: React.KeyboardEvent,
    item: { id: string; start: string; end: string },
    parentEpicId?: string,
  ) => void;
  onSchedulePainted: (
    issueId: string,
    epicId: string,
    startMs: number,
    endMs: number,
  ) => void;
}) {
  /*
   * Every dated story is draggable, including one showing its SPRINT's dates.
   *
   * This used to refuse them, on the theory that dragging would "silently
   * detach the story from its sprint". That was simply wrong: the sprint link
   * is its own field, and writing startDate/dueDate does not touch it. The
   * story stays in the sprint and gains explicit dates, which then take
   * precedence for display — exactly the rollup rule the rest of this feature
   * is built on.
   *
   * The practical cost of being wrong was severe: most teams put their stories
   * in sprints, so in a real project nearly every story bar refused to move,
   * which is the founder's report — "still cannot click and drag the stories
   * to fix the schedule".
   */
  const draggable = editable && !!child.start && !!child.end;

  const hasWindow = !!child.start && !!child.end;
  const baseStart = hasWindow ? Date.parse(child.start as string) : 0;
  const baseEnd = hasWindow ? Date.parse(child.end as string) : 0;
  const preview =
    drag && hasWindow
      ? applyDrag(baseStart, baseEnd, drag.mode, drag.dayDelta)
      : { start: baseStart, end: baseEnd };

  useEffect(() => {
    if (!drag || !hasWindow) return;
    const onUp = () =>
      endDrag(
        { id: child.id, start: child.start as string, end: child.end as string },
        epicId,
        drag,
      );
    window.addEventListener('pointerup', onUp, { once: true });
    window.addEventListener('pointercancel', onUp, { once: true });
    return () => {
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [drag, hasWindow, child.id, child.start, child.end, epicId, endDrag]);

  /*
   * An undated story had no affordance at all: the row rendered the words "no
   * dates" and nothing else, so the one thing you actually wanted to do on the
   * timeline — put it somewhere — was the one thing you couldn't. Founder
   * report: "if dates are not set I cannot assign or drag them into place."
   *
   * The row is now a scheduling surface. Drag across it to paint a window, or
   * click once for a default week starting at the day you clicked. Both snap
   * to whole days on the same scale as every other bar, and both go through
   * the same commit path, so the epic cascade applies exactly as it would to a
   * bar you moved.
   */
  if (!hasWindow) {
    return (
      <UnscheduledChildRow
        child={child}
        epicId={epicId}
        scale={scale}
        editable={editable}
        onSchedule={onSchedulePainted}
      />
    );
  }

  const left = scale.xOf(preview.start);
  const width = Math.max(6, scale.xOf(preview.end) - left);

  return (
    <div
      className="relative border-b border-ink-100 bg-ink-50/40"
      style={{ height: ROW_H }}
    >
      <button
        type="button"
        data-testid="roadmap-child-bar"
        data-child-id={child.id}
        onPointerDown={(e) => {
          if (!draggable || !canDragWith(e)) return;
          setDrag({
            id: child.id,
            mode: 'move',
            pointerId: e.pointerId,
            originX: e.clientX,
            dayDelta: 0,
            moved: false,
          });
        }}
        onKeyDown={(e) =>
          draggable &&
          nudge(
            e,
            { id: child.id, start: child.start as string, end: child.end as string },
            epicId,
          )
        }
        title={
          child.fromSprint
            ? `${child.key} · ${child.title} — showing ${child.sprintName ?? 'its sprint'}'s dates. Drag to give it its own; it stays in the sprint.`
            : `${child.key} · ${child.title}`
        }
        aria-label={`${child.key} ${child.title}`}
        className={cn(
          'group absolute flex items-center overflow-hidden rounded text-left text-[10px] font-medium shadow-xs',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400',
          child.fromSprint
            ? 'border border-dashed border-ink-300 bg-ink-100 text-ink-500'
            : 'border border-ink-300 bg-surface text-ink-700',
          draggable && 'cursor-grab active:cursor-grabbing hover:border-signal-400',
          drag?.moved && 'z-30 ring-2 ring-signal-400',
        )}
        style={{ left, width, top: (ROW_H - 14) / 2, height: 14 }}
      >
        <span className="truncate px-1.5">{child.title}</span>
        {drag?.moved && (
          <span className="pointer-events-none absolute -top-6 left-0 z-40 whitespace-nowrap rounded bg-ink-900 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-card">
            {signedDays(drag.dayDelta)} · {fmtRange(preview.start, preview.end)}
          </span>
        )}
      </button>
    </div>
  );
}

/**
 * The row for a story that has no dates yet — a scheduling surface rather than
 * a dead label.
 *
 * Drag across it to paint a window; click once for a default week. The painted
 * range snaps to whole days off the same `Scale` as every bar, so what you
 * release on is what gets written.
 */
function UnscheduledChildRow({
  child,
  epicId,
  scale,
  editable,
  onSchedule,
}: {
  child: RoadmapChildDto;
  epicId: string;
  scale: Scale;
  editable: boolean;
  onSchedule: (
    issueId: string,
    epicId: string,
    startMs: number,
    endMs: number,
  ) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [paint, setPaint] = useState<{ fromX: number; toX: number } | null>(null);

  /** Default length for a click rather than a drag. A week reads as a real
   *  piece of work and is trivially resized afterwards; a single day would be
   *  a sliver most people would immediately have to fix. */
  const CLICK_DAYS = 7;

  const xInRow = (clientX: number): number => {
    const box = rowRef.current?.getBoundingClientRect();
    return box ? clientX - box.left : 0;
  };

  useEffect(() => {
    if (!paint) return;
    const onMove = (e: PointerEvent) =>
      setPaint((p) => (p ? { ...p, toX: xInRow(e.clientX) } : p));
    const onUp = () => {
      setPaint((p) => {
        if (!p) return null;
        const a = scale.dayAtX(Math.min(p.fromX, p.toX));
        const b = scale.dayAtX(Math.max(p.fromX, p.toX));
        const end = b <= a ? addDays(a, CLICK_DAYS) : b;
        onSchedule(child.id, epicId, a, end);
        return null;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    window.addEventListener('pointercancel', onUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [paint, scale, child.id, epicId, onSchedule]);

  const left = paint ? Math.min(paint.fromX, paint.toX) : 0;
  const width = paint ? Math.abs(paint.toX - paint.fromX) : 0;

  return (
    <div
      ref={rowRef}
      data-testid="roadmap-child-unscheduled"
      data-child-id={child.id}
      className={cn(
        'group relative border-b border-ink-100 bg-ink-50/40',
        editable && 'cursor-crosshair hover:bg-signal-50/60',
      )}
      style={{ height: ROW_H }}
      onPointerDown={(e) => {
        if (!editable || !canDragWith(e)) return;
        const x = xInRow(e.clientX);
        setPaint({ fromX: x, toX: x });
      }}
    >
      {paint ? (
        <>
        <span className="pointer-events-none absolute -top-1 z-40 whitespace-nowrap rounded bg-ink-900 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-card" style={{ left }}>
          {Math.max(1, daysBetween(scale.dayAtX(Math.min(paint.fromX, paint.toX)), scale.dayAtX(Math.max(paint.fromX, paint.toX))))}d
        </span>
        <div
          className="pointer-events-none absolute rounded border border-signal-400 bg-signal-200/70"
          style={{
            left,
            width: Math.max(2, width),
            top: (ROW_H - 14) / 2,
            height: 14,
          }}
          aria-hidden="true"
        />
        </>
      ) : (
        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[10px] italic text-ink-400">
          {editable ? 'drag here to schedule' : 'no dates'}
        </span>
      )}
    </div>
  );
}

// ── Overlays ────────────────────────────────────────────────────────────────

function MilestoneMarker({
  milestone,
  x,
}: {
  milestone: RoadmapDto['milestones'][number];
  x: number;
}) {
  return (
    <span
      data-testid="roadmap-milestone-marker"
      title={`${milestone.name} — ${new Date(milestone.releaseDate).toLocaleDateString(undefined, { timeZone: 'UTC' })}`}
      className="absolute bottom-0 z-10 h-2.5 w-2.5 -translate-x-1/2 translate-y-1/2 rotate-45 border border-amber-600 bg-amber-400"
      style={{ left: x }}
    />
  );
}

/**
 * BLOCKS arrows between epic bars.
 *
 * Rendered as one SVG overlay beneath the bars rather than per-row elements:
 * an arrow spans two rows, so it cannot live inside either of them, and
 * `pointer-events: none` keeps it from stealing clicks meant for a bar.
 */
function DependencyLayer({
  data,
  scale,
  epicYById,
  height,
  offsetY,
}: {
  data: RoadmapDto;
  scale: Scale;
  epicYById: Map<string, number>;
  height: number;
  offsetY: number;
}) {
  const epicById = useMemo(
    () => new Map(data.epics.map((e) => [e.id, e])),
    [data.epics],
  );

  const paths = data.dependencies.flatMap((dep) => {
    const from = epicById.get(dep.fromEpicId);
    const to = epicById.get(dep.toEpicId);
    const fromY = epicYById.get(dep.fromEpicId);
    const toY = epicYById.get(dep.toEpicId);
    if (!from?.end || !to?.start || fromY === undefined || toY === undefined) {
      return [];
    }
    const x1 = scale.xOf(Date.parse(from.end));
    const y1 = fromY + ROW_H / 2;
    const x2 = scale.xOf(Date.parse(to.start));
    const y2 = toY + ROW_H / 2;
    const STUB = 10;

    /*
     * Two routes, because a violated dependency is precisely the one that runs
     * BACKWARDS in time, and the forward elbow degenerates for it.
     *
     * Forward (blocker ends before the blocked starts): the standard elbow —
     * out of the blocker's right edge, across at a midpoint, into the left
     * edge of the blocked bar.
     *
     * Backward (blocker ends AFTER the blocked starts): a midpoint elbow would
     * put a long horizontal segment along the destination row, straight
     * through whatever bars live there — it reads as a bar rather than a line,
     * which is what the first version did. Route it around instead: out right,
     * into the GUTTER between the two rows, back left, then into the target.
     * The horizontal run then follows a row divider and crosses nothing.
     */
    const forward = x2 >= x1 + 2 * STUB;
    const gutterY =
      y1 < y2 ? Math.max(y1, y2 - ROW_H / 2) : Math.min(y1, y2 + ROW_H / 2);
    const d = forward
      ? `M ${x1} ${y1} H ${Math.max(x1 + STUB, x2 - STUB)} V ${y2} H ${x2}`
      : `M ${x1} ${y1} H ${x1 + STUB} V ${gutterY} H ${x2 - STUB} V ${y2} H ${x2}`;

    return [
      {
        key: `${dep.fromEpicId}-${dep.toEpicId}`,
        d,
        violated: dep.violated,
        arrowX: x2,
        arrowY: y2,
      },
    ];
  });

  if (paths.length === 0 || height === 0) return null;

  return (
    <svg
      className="pointer-events-none absolute left-0 z-10"
      style={{ top: offsetY }}
      width={scale.widthPx}
      height={height}
      aria-hidden="true"
      data-testid="roadmap-dependency-layer"
    >
      {paths.map((p) => (
        <g key={p.key}>
          <path
            d={p.d}
            fill="none"
            strokeWidth={1.5}
            strokeDasharray={p.violated ? undefined : '3 3'}
            className={p.violated ? 'stroke-red-500' : 'stroke-ink-400'}
          />
          <circle
            cx={p.arrowX}
            cy={p.arrowY}
            r={3}
            className={p.violated ? 'fill-red-500' : 'fill-ink-400'}
          />
        </g>
      ))}
    </svg>
  );
}

// ── No-date lanes ───────────────────────────────────────────────────────────

function NoDatesLane({
  epics,
  onOpenEpic,
}: {
  epics: RoadmapEpicDto[];
  onOpenEpic: (id: string) => void;
}) {
  return (
    <div className="rounded-lg border border-dashed border-ink-300 bg-ink-50 p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
        No dates
      </p>
      <div className="flex flex-col gap-1.5">
        {epics.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => onOpenEpic(e.id)}
            data-testid="roadmap-epic-nodate"
            className="flex items-center justify-between rounded-md border border-ink-200 bg-surface px-3 py-2 text-left text-sm hover:border-signal-300 hover:bg-signal-50"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="nl-issue-key shrink-0 text-[10px]">{e.key}</span>
              <span className="truncate font-medium text-ink-800">{e.title}</span>
            </span>
            <span className="shrink-0 rounded-full bg-signal-100 px-2 py-0.5 text-[10px] font-semibold text-signal-700">
              {e.doneCount}/{e.childCount}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function NoDatesOnly({
  epics,
  onOpenEpic,
}: {
  epics: RoadmapEpicDto[];
  onOpenEpic: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-500">
        Nothing on this project has dates yet. Give an epic a start and due
        date, or put its stories in a sprint, and it will appear on the
        timeline.
      </p>
      {epics.length > 0 && <NoDatesLane epics={epics} onOpenEpic={onOpenEpic} />}
    </div>
  );
}

// ── Small helpers ───────────────────────────────────────────────────────────

/**
 * Whether this pointer should start a bar drag.
 *
 * TOUCH IS DELIBERATELY EXCLUDED. The time grid scrolls horizontally, and on a
 * phone that pan is the primary gesture — the chart is mostly something you
 * read there. Claiming a touch-drag on a bar would hijack the pan and leave
 * the rest of the timeline unreachable, which is a far worse trade than not
 * offering drag on a 393px screen. Rescheduling from a phone is still
 * available where it always was: the date fields in the issue drawer.
 */
function canDragWith(e: React.PointerEvent): boolean {
  return e.pointerType !== 'touch' && e.button === 0;
}

/** "+7d" / "−3d" — a signed day delta for the drag readout. */
function signedDays(n: number): string {
  if (n === 0) return '0d';
  return n > 0 ? `+${n}d` : `\u2212${Math.abs(n)}d`;
}

function fmtRange(startMs: number, endMs: number): string {
  const f = (ms: number) =>
    new Date(ms).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  return `${f(startMs)} – ${f(endMs)}`;
}

function epicTitle(epic: RoadmapEpicDto): string {
  const base = `${epic.key} · ${epic.title} — ${epic.doneCount}/${epic.childCount} done`;
  if (epic.overrunDays > 0) {
    return `${base}. ${epic.childrenOutside} ${
      epic.childrenOutside === 1 ? 'child runs' : 'children run'
    } ${epic.overrunDays} day${epic.overrunDays === 1 ? '' : 's'} past this window.`;
  }
  if (epic.underrunDays > 0) {
    return `${base}. Work starts ${epic.underrunDays} day${
      epic.underrunDays === 1 ? '' : 's'
    } before this window.`;
  }
  return base;
}

export { MS_PER_DAY, addDays, daysBetween };
