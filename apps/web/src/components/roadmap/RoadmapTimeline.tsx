import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  SprintState,
  StatusCategory,
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
/**
 * Left-rail width. On a 393px phone the fixed 248px rail left ~145px of
 * timeline, so the chart rendered five epic rows and not one bar — the
 * roadmap's entire payload was off-screen with no hint it existed. The rail
 * gives up most of its width on narrow viewports; the bars carry the titles
 * anyway, and the rail keeps the key and the expand control.
 */
const RAIL_W = 248;
const RAIL_W_NARROW = 132;
/** Below this viewport width the rail is not affordable. */
const NARROW_PX = 640;
/*
 * Resize bounds for the rail.
 *
 * 248px fits about twenty characters, so real story titles ("Metering
 * pipeline hardening", "Saved views and sharing") truncated on a chart whose
 * left column exists precisely to name things — founder report: "story titles
 * are getting cut off". The floor keeps the expand chevron and a usable stub
 * of title; the ceiling stops the rail from eating the timeline it labels.
 */
const RAIL_MIN = 160;
const RAIL_MAX = 560;
const RAIL_W_KEY = 'nl_roadmap_rail_w';
const AXIS_H = 44;
const LANE_GAP = 8;
/** Pointer movement below this is a click, above it is a drag. */
const DRAG_THRESHOLD_PX = 4;

const SPRINT_COLORS: Record<SprintState, { bar: string; dot: string; label: string }> = {
  [SprintState.PLANNED]: { bar: 'bg-ink-200 text-ink-700', dot: 'bg-ink-400', label: 'Planned' },
  [SprintState.ACTIVE]: { bar: 'bg-signal-500 text-white', dot: 'bg-signal-500', label: 'Active' },
  [SprintState.COMPLETED]: { bar: 'bg-emerald-500 text-white', dot: 'bg-emerald-500', label: 'Completed' },
};

/**
 * Epic bars. `RoadmapEpicDto.statusCategory` has always shipped — its own
 * comment says "for tinting the row" — and the bar ignored it, so an epic you
 * had marked Done stayed the same blue as one nobody had started. The story
 * bars beneath it went green; their parent didn't, which read as a bug in the
 * data rather than a gap in the chart.
 *
 * `track`/`fill` keep the progress bar in the same family as the bar it sits
 * on, so a done epic isn't a green bar with a blue stripe under it.
 */
const EPIC_COLORS: Record<
  StatusCategory,
  { bar: string; text: string; track: string; fill: string; grip: string }
> = {
  [StatusCategory.TODO]: {
    bar: 'border-ink-300 bg-ink-100 hover:shadow-card focus-visible:ring-ink-400',
    text: 'text-ink-800',
    track: 'bg-ink-200',
    fill: 'bg-ink-400',
    grip: 'bg-ink-400',
  },
  [StatusCategory.IN_PROGRESS]: {
    bar: 'border-signal-300 bg-signal-100 hover:shadow-card focus-visible:ring-signal-400',
    text: 'text-signal-900',
    track: 'bg-signal-200',
    fill: 'bg-signal-500',
    grip: 'bg-signal-500',
  },
  [StatusCategory.DONE]: {
    bar: 'border-emerald-400 bg-emerald-100 hover:shadow-card focus-visible:ring-emerald-500',
    text: 'text-emerald-900',
    track: 'bg-emerald-200',
    fill: 'bg-emerald-500',
    grip: 'bg-emerald-500',
  },
};

/**
 * Story bars used to be one flat grey outline whatever their state, so a
 * finished story and a not-started one were pixel-identical. On a roadmap the
 * first question is "are we on track", and the chart could not answer it
 * without opening every row. Colour carries the status category instead.
 */
const CHILD_COLORS: Record<StatusCategory, { bar: string; dot: string; label: string }> = {
  [StatusCategory.TODO]: {
    bar: 'border-ink-300 bg-ink-100 text-ink-700',
    dot: 'bg-ink-300',
    label: 'To do',
  },
  [StatusCategory.IN_PROGRESS]: {
    bar: 'border-signal-400 bg-signal-200 text-signal-900',
    dot: 'bg-signal-400',
    label: 'In progress',
  },
  [StatusCategory.DONE]: {
    bar: 'border-emerald-400 bg-emerald-200 text-emerald-900',
    dot: 'bg-emerald-400',
    label: 'Done',
  },
};

/** One rendered line of the chart, with its y offset inside the lanes box. */
type RoadmapRow =
  | { kind: 'epic'; epic: RoadmapEpicDto; y: number }
  | { kind: 'child'; epicId: string; child: RoadmapChildDto; y: number }
  | { kind: 'child-note'; epicId: string; text: string; y: number }
  | { kind: 'add-child'; epicId: string; y: number }
  | { kind: 'add-epic'; y: number };

/**
 * Sentinel for "has no assignee". A filter list that offers every person but
 * not "nobody" cannot answer the question you usually have on a roadmap —
 * which of this plan has an owner at all.
 */
const UNASSIGNED = '__unassigned__';

type DragMode = 'move' | 'resize-start' | 'resize-end';

interface DragState {
  id: string;
  mode: DragMode;
  pointerId: number;
  originX: number;
  dayDelta: number;
  moved: boolean;
  /**
   * Reparenting, for a CHILD drag only.
   *
   * A child bar carries two independent meanings on this chart: where it sits
   * horizontally is its schedule, and which epic's block it sits in is its
   * parent. Dragging already expressed the first; this expresses the second
   * with the same gesture, because moving a story to a different epic and
   * moving it to a different week are the same kind of act — replanning — and
   * needing a modal for one of them is the split this screen exists to close.
   *
   * `null` when the pointer is over the child's current parent or over nothing
   * droppable; only ever set to a DIFFERENT epic.
   */
  overEpicId?: string | null;
  /** Vertical travel, so a pure reparent registers as a drag at all. */
  originY?: number;
}

export interface RoadmapTimelineProps {
  data: RoadmapDto;
  onOpenEpic: (epicId: string) => void;
  /** Commit a new window for an issue. Absent = read-only (no drag affordances). */
  onSchedule?: (input: {
    issueId: string;
    startDate: string;
    dueDate: string;
    /** The epic this item belongs to NOW — used to refresh the right rows. */
    parentEpicId?: string;
    /** Set only when the drag also moved the item to a different epic. */
    newParentEpicId?: string;
  }) => void;
  projectId?: string;
  /** True while a schedule write is in flight, to damp the UI. */
  isSaving?: boolean;
  /** Create an epic, or a story under one. Absent = read-only. */
  onCreate?: (input: { title: string; parentEpicId?: string }) => Promise<void>;
  /** Move an issue to a different epic, changing nothing else. */
  onReparent?: (input: {
    issueId: string;
    fromEpicId: string;
    toEpicId: string;
  }) => void;
  /** People and labels for the filter pickers. Empty = that picker is hidden. */
  users?: { id: string; name: string }[];
  labels?: { id: string; name: string; color?: string | null }[];
  /** Draw a BLOCKS dependency between two epics. Absent = read-only. */
  onLink?: (input: { fromEpicId: string; toEpicId: string }) => void;
  /** Remove a dependency by its link id. Absent = read-only. */
  onUnlink?: (input: {
    linkId: string;
    fromEpicId: string;
    toEpicId: string;
  }) => void;
}

export function RoadmapTimeline({
  data,
  onOpenEpic,
  onSchedule,
  projectId,
  isSaving,
  onCreate,
  onLink,
  onUnlink,
  users = [],
  labels = [],
  onReparent,
}: RoadmapTimelineProps) {
  const [zoomId, setZoomId] = useState<ZoomId>('month');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<DragState | null>(null);
  /*
   * Drawing a dependency. Held here rather than in the bar because the gesture
   * spans two bars and a rubber-band line that belongs to neither: the source
   * releases the pointer the moment you leave it.
   *
   * `x`/`y` are in GRID coordinates (the scrolling content, not the viewport),
   * so the rubber band stays glued to the calendar if the grid scrolls
   * mid-drag — which it does, because dragging toward the edge is how you
   * reach an epic that is off-screen.
   */
  const [linking, setLinking] = useState<{
    fromEpicId: string;
    pointerId: number;
    x: number;
    y: number;
    overEpicId: string | null;
  } | null>(null);
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
  /** Which side of the time grid still has timeline off-screen. */
  const [edges, setEdges] = useState({ left: false, right: false });
  /*
   * Filters.
   *
   * The chart is capped at 500 epics and, until now, drew every one of them —
   * which is unreadable, and the reason "is this better than Jira" was still a
   * no on a real backlog. Filtering is CLIENT-side on purpose: the payload is
   * already bounded by the cap, so re-querying the server to hide rows would
   * add a round trip and a loading state to a control that should feel like a
   * switch. It also means the rollups, the overrun marks and the dependency
   * arrows keep being computed from the WHOLE plan — hiding a row must not
   * quietly change what the remaining rows say about it.
   */
  const [hideDone, setHideDone] = useState(false);
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null);
  const [labelFilter, setLabelFilter] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const filtersActive =
    hideDone || !!assigneeFilter || !!labelFilter || query.trim() !== '';

  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < NARROW_PX,
  );
  const [railPref, setRailPref] = useState(() => {
    if (typeof window === 'undefined') return RAIL_W;
    const stored = Number(window.localStorage.getItem(RAIL_W_KEY));
    return Number.isFinite(stored) && stored >= RAIL_MIN && stored <= RAIL_MAX
      ? stored
      : RAIL_W;
  });
  /** Live width during a drag; null when not resizing. */
  const [railDrag, setRailDrag] = useState<number | null>(null);
  // The narrow layout is a different design (no key, no percentage), not a
  // smaller version of this one — so it is not resizable and ignores the
  // stored preference rather than fighting it.
  const railW = narrow ? RAIL_W_NARROW : (railDrag ?? railPref);
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
  const lanesRef = useRef<HTMLDivElement>(null);
  /** The sticky axis viewport, whose scrollLeft mirrors the grid's. */
  const axisRef = useRef<HTMLDivElement>(null);
  /*
   * Live mirrors of render-time values that the window-level pointermove
   * handler needs.
   *
   * Refs, not deps: the handler is attached once per drag, and re-subscribing
   * it every time a row list or a lane offset changes would tear down and
   * rebuild the listener mid-gesture. They are also declared up here rather
   * than beside the values they mirror, because the drag effect is defined
   * well above where `rows` is computed.
   */
  const rowsRef = useRef<RoadmapRow[]>([]);
  const laneOffsetRef = useRef(0);
  /** 'epic' | 'child' — only a child drag can reparent. */
  const dragKindRef = useRef<'epic' | 'child' | null>(null);
  /** The epic the dragged child belongs to right now. */
  const dragParentRef = useRef<string | null>(null);

  /*
   * Rail resize. Window listeners plus pointer capture, for the same reason
   * every other drag on this chart uses them: a 6px-wide handle loses the
   * pointer the instant the gesture outruns a re-render.
   *
   * Committed to localStorage on release rather than on every move — a write
   * per pointermove is a hundred writes per drag, and the preference is only
   * meaningful once you have stopped.
   */
  const railStartRef = useRef({ x: 0, w: RAIL_W });
  const startRailResize = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      railStartRef.current = { x: e.clientX, w: railPref };
      const clamp = (v: number) => Math.min(RAIL_MAX, Math.max(RAIL_MIN, v));
      const onMove = (ev: PointerEvent) => {
        setRailDrag(clamp(railStartRef.current.w + (ev.clientX - railStartRef.current.x)));
      };
      const onUp = (ev: PointerEvent) => {
        const next = clamp(
          railStartRef.current.w + (ev.clientX - railStartRef.current.x),
        );
        setRailDrag(null);
        setRailPref(next);
        window.localStorage.setItem(RAIL_W_KEY, String(next));
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [railPref],
  );

  /** Keyboard equivalent, so the rail is not mouse-only. */
  const nudgeRail = useCallback(
    (e: React.KeyboardEvent) => {
      const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (dir === 0) return;
      e.preventDefault();
      const next = Math.min(
        RAIL_MAX,
        Math.max(RAIL_MIN, railPref + dir * (e.shiftKey ? 40 : 8)),
      );
      setRailPref(next);
      window.localStorage.setItem(RAIL_W_KEY, String(next));
    },
    [railPref],
  );

  /*
   * Dragging an UNDATED story to another epic.
   *
   * It cannot ride the normal child drag, because that gesture is built on a
   * window — an undated story has no bar to grab and nothing to move
   * horizontally. Its row is a scheduling surface (drag across it to paint
   * dates), so the reparent handle is a separate grip at the left of the row
   * and this is its own small gesture: vertical only, one field written.
   */
  const [reparenting, setReparenting] = useState<{
    childId: string;
    fromEpicId: string;
    pointerId: number;
    overEpicId: string | null;
  } | null>(null);

  useEffect(() => {
    if (!reparenting) return;
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== reparenting.pointerId) return;
      const lanes = lanesRef.current;
      if (!lanes) return;
      const y =
        e.clientY - lanes.getBoundingClientRect().top - laneOffsetRef.current;
      const row = rowsRef.current.find((r) => y >= r.y && y < r.y + ROW_H);
      const owner =
        row === undefined
          ? null
          : row.kind === 'epic'
            ? row.epic.id
            : 'epicId' in row
              ? row.epicId
              : null;
      const over = owner && owner !== reparenting.fromEpicId ? owner : null;
      setReparenting((p) => (p && p.overEpicId !== over ? { ...p, overEpicId: over } : p));
    };
    const onUp = () => {
      setReparenting((p) => {
        if (p?.overEpicId && onReparent) {
          onReparent({
            issueId: p.childId,
            fromEpicId: p.fromEpicId,
            toEpicId: p.overEpicId,
          });
        }
        return null;
      });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setReparenting(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [reparenting, onReparent]);

  const startReparent = useCallback(
    (childId: string, fromEpicId: string, e: React.PointerEvent) => {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      setReparenting({
        childId,
        fromEpicId,
        pointerId: e.pointerId,
        overEpicId: null,
      });
    },
    [],
  );

  const onDragKind = useCallback((kind: 'child', fromEpicId: string) => {
    dragKindRef.current = kind;
    dragParentRef.current = fromEpicId;
  }, []);

  const epicKeyById = useMemo(
    () => new Map(data.epics.map((e) => [e.id, e.key])),
    [data.epics],
  );
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

  const matchesFilters = useCallback(
    (e: { statusCategory: StatusCategory; assigneeId: string | null; labelIds: string[]; title: string; key: string }) => {
      if (hideDone && e.statusCategory === StatusCategory.DONE) return false;
      if (assigneeFilter === UNASSIGNED) {
        if (e.assigneeId) return false;
      } else if (assigneeFilter && e.assigneeId !== assigneeFilter) {
        return false;
      }
      if (labelFilter && !e.labelIds.includes(labelFilter)) return false;
      const q = query.trim().toLowerCase();
      if (
        q &&
        !e.title.toLowerCase().includes(q) &&
        !e.key.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    },
    [hideDone, assigneeFilter, labelFilter, query],
  );

  const datedEpics = useMemo(
    () => data.epics.filter((e) => e.start && e.end).filter(matchesFilters),
    [data.epics, matchesFilters],
  );
  /** How many dated epics the filters are currently hiding. */
  const hiddenCount = useMemo(
    () =>
      data.epics.filter((e) => e.start && e.end).length - datedEpics.length,
    [data.epics, datedEpics.length],
  );
  const noDateEpics = useMemo(
    () => data.epics.filter((e) => !e.start || !e.end).filter(matchesFilters),
    [data.epics, matchesFilters],
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

  /**
   * The span the plan's DATA actually covers. Distinct from `rawBounds`, which
   * `planBounds` deliberately stretches to include today so the today marker
   * always has somewhere to land — that makes it useless for asking "is today
   * anywhere near this plan", which the initial scroll below needs.
   */
  const dataExtent = useMemo(() => {
    const stamps = [
      ...data.sprints.flatMap((s) => [s.startDate, s.endDate]),
      ...data.epics.flatMap((e) => [e.start, e.end, e.rollupStart, e.rollupEnd]),
      ...data.milestones.map((m) => m.releaseDate),
    ]
      .map((s) => (s ? Date.parse(s) : NaN))
      .filter((n) => Number.isFinite(n));
    return stamps.length
      ? { from: Math.min(...stamps), to: Math.max(...stamps) }
      : null;
  }, [data]);

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
    const measure = () => {
      setGridWidth(el.clientWidth);
      const remaining = el.scrollWidth - el.scrollLeft - el.clientWidth;
      setEdges({ left: el.scrollLeft > 8, right: remaining > 8 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(`(max-width: ${NARROW_PX - 1}px)`);
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  // Zooming out can make the whole plan fit, which must clear the fades — a
  // ResizeObserver on the viewport never fires for that, only the content grew
  // or shrank.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const remaining = el.scrollWidth - el.scrollLeft - el.clientWidth;
    setEdges({ left: el.scrollLeft > 8, right: remaining > 8 });
  }, [scale?.widthPx]);

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
      const dy = drag.originY === undefined ? 0 : e.clientY - drag.originY;
      // The EFFECTIVE day width, not the nominal zoom one — a stretched
      // scale would otherwise move the bar further than the cursor.
      const dayDelta = Math.round(dx / (scale?.pxPerDay ?? zoom.pxPerDay));
      /*
       * Which epic's block is under the cursor.
       *
       * Resolved from the row geometry we already computed rather than by
       * hit-testing the DOM: the dragged bar follows the pointer and would be
       * the topmost element at that point for most of the gesture, so
       * `elementFromPoint` would keep answering "the thing you are dragging".
       * The rows array knows every row's y and which epic owns it, which is
       * the same question asked of data that cannot lie.
       */
      let overEpicId: string | null = null;
      if (dragKindRef.current === 'child' && lanesRef.current) {
        const box = lanesRef.current.getBoundingClientRect();
        const y = e.clientY - box.top - laneOffsetRef.current;
        const row = rowsRef.current.find(
          (r) => y >= r.y && y < r.y + ROW_H,
        );
        const owner =
          row === undefined
            ? null
            : row.kind === 'epic'
              ? row.epic.id
              : 'epicId' in row
                ? row.epicId
                : null;
        overEpicId = owner && owner !== dragParentRef.current ? owner : null;
      }
      setDrag((d) =>
        d &&
        (d.dayDelta !== dayDelta ||
          !d.moved ||
          (d.overEpicId ?? null) !== overEpicId)
          ? {
              ...d,
              dayDelta,
              overEpicId,
              moved:
                d.moved ||
                Math.abs(dx) > DRAG_THRESHOLD_PX ||
                Math.abs(dy) > DRAG_THRESHOLD_PX,
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
      newParentEpicId?: string,
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
        newParentEpicId,
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
      // `dayDelta === 0` is no longer enough to call it a no-op: a story can be
      // dragged straight up into another epic without shifting a single day,
      // and that is a real change.
      const reparent = d.overEpicId ?? undefined;
      if (!d.moved || (d.dayDelta === 0 && !reparent)) return;
      suppressClickRef.current = true;
      const next = applyDrag(
        Date.parse(item.start),
        Date.parse(item.end),
        d.mode,
        d.dayDelta,
      );
      const where = fmtRange(next.start, next.end);
      commit(
        item.id,
        next.start,
        next.end,
        parentEpicId,
        reparent
          ? `Moved to ${epicKeyById.get(reparent) ?? 'another epic'}, ${where}`
          : `Moved to ${where}`,
        reparent,
      );
    },
    [commit, epicKeyById],
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

  /**
   * Extend the future horizon when the user reaches the right-hand edge, and
   * track which sides still have content off-screen.
   *
   * The second half exists because bars simply vanished at the panel's right
   * edge with nothing to say more timeline was there — the scrollbar sits
   * below the fold on a tall chart, so the only cue was a bar that looked
   * truncated. The fades restore the "there is more this way" signal.
   */
  const onGridScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const remaining = el.scrollWidth - el.scrollLeft - el.clientWidth;
    if (remaining < 240) setHorizonMonths((m) => Math.min(m + 3, 48));
    setEdges({ left: el.scrollLeft > 8, right: remaining > 8 });
    // Keep the sticky axis over the columns it names. Written directly rather
    // than through state: this runs on every scroll frame, and a re-render per
    // frame would make the axis lag the grid it is labelling.
    if (axisRef.current) axisRef.current.scrollLeft = el.scrollLeft;
  }, []);

  const scrollToDate = useCallback(
    (ms: number) => {
      if (!scale || !scrollRef.current) return;
      const x = scale.xOf(ms);
      scrollRef.current.scrollTo({
        left: Math.max(0, x - scrollRef.current.clientWidth / 2),
        behavior: 'smooth',
      });
      // `scrollTo` fires scroll events, so `onGridScroll` mirrors the axis for
      // the whole smooth animation; nothing to do here.

    },
    [scale],
  );

  const scrollToToday = useCallback(() => scrollToDate(Date.now()), [scrollToDate]);

  /*
   * Land on today the first time the grid is measurable.
   *
   * The grid used to open scrolled hard left, at the start of the plan's whole
   * horizon. On a wide desktop that happened to include today; on a phone —
   * where the visible window is a few weeks — it opened on an empty stretch of
   * past calendar and you had to scroll blind to find any work at all.
   *
   * Gated on today actually falling inside the plan. A plan that is entirely
   * in the past or entirely in the future would otherwise open on a view with
   * nothing in it, which is the same failure with the sign flipped; for those,
   * the start of the plan IS the interesting end.
   */
  const landedRef = useRef(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (landedRef.current || !scale || !dataExtent || !el || el.clientWidth === 0)
      return;
    landedRef.current = true;
    const now = Date.now();
    if (now < dataExtent.from || now > dataExtent.to) return;
    el.scrollLeft = Math.max(0, scale.xOf(now) - el.clientWidth / 3);
    if (axisRef.current) axisRef.current.scrollLeft = el.scrollLeft;
  }, [scale, dataExtent, gridWidth]);

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
    const out: RoadmapRow[] = [];
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

  /*
   * Drawing a dependency: window-level pointer tracking, same reasoning as the
   * schedule drag. The gesture starts on the source bar's connector dot and
   * ends anywhere — pointer capture on the source plus window listeners is the
   * only way it survives leaving a 20px-tall element.
   *
   * The drop target is resolved with `elementFromPoint` rather than per-bar
   * enter/leave handlers: the source bar has pointer capture, so the bars
   * underneath the cursor never receive a pointerover at all.
   */
  useEffect(() => {
    if (!linking) return;
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== linking.pointerId) return;
      const lanes = lanesRef.current;
      if (!lanes) return;
      const box = lanes.getBoundingClientRect();
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      const bar = hit?.closest?.('[data-epic-id]') as HTMLElement | null;
      const over = bar?.dataset.epicId ?? null;
      setLinking((prev) =>
        prev
          ? {
              ...prev,
              x: e.clientX - box.left,
              y: e.clientY - box.top,
              overEpicId: over && over !== prev.fromEpicId ? over : null,
            }
          : prev,
      );
    };
    const onUp = () => {
      setLinking((prev) => {
        if (prev?.overEpicId && onLink) {
          onLink({ fromEpicId: prev.fromEpicId, toEpicId: prev.overEpicId });
        }
        return null;
      });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLinking(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [linking, onLink]);

  const startLink = useCallback(
    (epicId: string, e: React.PointerEvent) => {
      const lanes = lanesRef.current;
      if (!lanes) return;
      const box = lanes.getBoundingClientRect();
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      setLinking({
        fromEpicId: epicId,
        pointerId: e.pointerId,
        x: e.clientX - box.left,
        y: e.clientY - box.top,
        overEpicId: null,
      });
    },
    [],
  );

  const laneOffset = data.sprints.length > 0 ? ROW_H + LANE_GAP : 0;
  rowsRef.current = rows;
  laneOffsetRef.current = laneOffset;

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

        {/*
         * The legend used to be three unlabelled swatches — Planned / Active /
         * Completed — which read as story statuses but were actually SPRINT
         * states, describing exactly one row of the chart. Each group now says
         * what it applies to.
         */}
        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-500">
          <span className="flex items-center gap-1.5">
            <span className="font-medium text-ink-400">Sprints</span>
            {(Object.keys(SPRINT_COLORS) as SprintState[]).map((st) => (
              <span key={st} className="flex items-center gap-1">
                <span className={cn('inline-block h-2.5 w-2.5 rounded-sm', SPRINT_COLORS[st].dot)} />
                {SPRINT_COLORS[st].label}
              </span>
            ))}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="font-medium text-ink-400">Epics &amp; stories</span>
            {(Object.keys(CHILD_COLORS) as StatusCategory[]).map((sc) => (
              <span key={sc} className="flex items-center gap-1">
                <span className={cn('inline-block h-2.5 w-2.5 rounded-sm', CHILD_COLORS[sc].dot)} />
                {CHILD_COLORS[sc].label}
              </span>
            ))}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-0.5 bg-red-500" />
            Today
          </span>
          {/*
           * Two entries, not one.
           *
           * The legend said "Blocks" beside a grey line and stopped there, so
           * the solid red state — the one that means the plan is impossible —
           * was undocumented. Founder, having to ask: "why do some links show
           * up as a red line and others are dotted". A legend that explains
           * only the healthy case is why.
           */}
          <span className="flex items-center gap-1.5">
            <svg width="18" height="4" aria-hidden="true">
              <line
                x1="0"
                y1="2"
                x2="18"
                y2="2"
                strokeWidth="1.5"
                strokeDasharray="3 3"
                className="stroke-ink-400"
              />
            </svg>
            Blocks
          </span>
          <span className="flex items-center gap-1.5">
            <svg width="18" height="4" aria-hidden="true">
              <line
                x1="0"
                y1="2"
                x2="18"
                y2="2"
                strokeWidth="1.5"
                className="stroke-red-500"
              />
            </svg>
            Blocker ends too late
          </span>
          <span className="flex items-center gap-1.5">
            <span className="nl-gantt-overrun inline-block h-2.5 w-4 rounded-sm" />
            Overruns plan
          </span>
        </div>
      </div>

      {/*
       * Filters, on their own row.
       *
       * Not merged into the zoom/Today row: those change how you LOOK at the
       * plan, these change what the plan IS on screen, and running them
       * together made a single strip nobody could scan. The row also carries
       * the count of what it is hiding — a filtered chart that looks like a
       * short plan is the failure mode here, and a number is cheaper than
       * discovering it later.
       */}
      <div className="flex flex-wrap items-center gap-2" data-testid="roadmap-filters">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by title or key"
          aria-label="Filter epics by title or key"
          data-testid="roadmap-filter-query"
          className="w-48 rounded-md border border-ink-200 bg-surface px-2.5 py-1 text-xs text-ink-800 placeholder:text-ink-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400"
        />
        <button
          type="button"
          role="switch"
          aria-checked={hideDone}
          data-testid="roadmap-filter-hide-done"
          onClick={() => setHideDone((v) => !v)}
          className={cn(
            'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
            hideDone
              ? 'border-signal-300 bg-signal-50 text-signal-700'
              : 'border-ink-200 bg-surface text-ink-500 hover:bg-ink-100 hover:text-ink-900',
          )}
        >
          Hide done
        </button>
        {users.length > 0 && (
          <select
            value={assigneeFilter ?? ''}
            onChange={(e) => setAssigneeFilter(e.target.value || null)}
            aria-label="Filter by assignee"
            data-testid="roadmap-filter-assignee"
            className={'rounded-md border border-ink-200 bg-surface px-2 py-1 text-xs font-medium text-ink-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400'}
          >
            <option value="">Anyone</option>
            <option value={UNASSIGNED}>Unassigned</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        )}
        {labels.length > 0 && (
          <select
            value={labelFilter ?? ''}
            onChange={(e) => setLabelFilter(e.target.value || null)}
            aria-label="Filter by label"
            data-testid="roadmap-filter-label"
            className={'rounded-md border border-ink-200 bg-surface px-2 py-1 text-xs font-medium text-ink-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400'}
          >
            <option value="">Any label</option>
            {labels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
        {filtersActive && (
          <>
            <span
              data-testid="roadmap-filter-hidden-count"
              className="text-xs text-ink-500"
            >
              {hiddenCount === 0
                ? 'No epics hidden'
                : `${hiddenCount} epic${hiddenCount === 1 ? '' : 's'} hidden`}
            </span>
            <button
              type="button"
              data-testid="roadmap-filter-clear"
              onClick={() => {
                setHideDone(false);
                setAssigneeFilter(null);
                setLabelFilter(null);
                setQuery('');
              }}
              className="rounded-md px-2 py-1 text-xs font-medium text-signal-600 hover:bg-signal-50"
            >
              Clear
            </button>
          </>
        )}
      </div>

      {editable && (
        <p className="text-xs text-ink-400">
          Drag a bar to move it, drag either edge to resize. With a bar focused,
          Alt + ← / → moves it a day and Alt + Shift + ← / → changes its end.
          {onLink && (
            <>
              {' '}
              Drag a story onto another epic's row to move it there. Hover an
              epic and drag the dot past its right edge onto another epic to
              say it blocks that one; hover a dependency line to remove it.
            </>
          )}
        </p>
      )}

      {/*
       * Chart.
       *
       * `overflow-clip` rather than `overflow-hidden`, purely so the sticky
       * header below actually sticks: `hidden` makes this a scroll container,
       * and a sticky element resolves against its nearest scrollport — which
       * would be this box, which never scrolls. `clip` gives the same rounded
       * corners without creating a scrollport, so the header sticks to the
       * page (or, in presenting mode, to that view's scroll pane) instead.
       */}
      <div className="overflow-clip rounded-lg border border-ink-200">
        {/*
         * The date axis, lifted out of the scrolling grid into a sticky band.
         *
         * It used to live inside the horizontal scroller, one flow item above
         * the lanes, so scrolling a long plan carried the months off the top
         * of the screen and left you reading bars with no idea what quarter
         * you were in. It cannot simply be `sticky` where it was: that
         * scroller is a scroll container on BOTH axes, so sticking to it
         * means sticking to something that never moves vertically.
         *
         * So it sits here as its own row, and its horizontal scroll is
         * mirrored from the grid's in `onGridScroll` — one scroller stays
         * authoritative for every x coordinate on the chart.
         */}
        <div
          data-testid="roadmap-axis-header"
          /*
           * `top: 0`, with no offset for the app header — and that is not an
           * oversight.
           *
           * The scrolling ancestor here is `<main>`, and the app header and
           * project nav are siblings ABOVE it, outside the scrollport
           * entirely. So the top of the scrollport already sits directly under
           * the chrome. An offset for the header's height (which I measured
           * and published as a CSS variable before checking what actually
           * scrolls) pushed the axis 37px down and opened a band of chart rows
           * sliding through above it.
           *
           * Presenting mode scrolls its own pane with no chrome above it at
           * all, so `0` is right there too.
           *
           * `z-30` so the bars scroll UNDER it. `z-20` is not enough: the
           * bars are `z-20` too and come later in tree order, so they tie and
           * win, and a bar sliding up over the month labels is the one thing
           * a sticky axis exists to prevent. The grid's edge fades are also
           * `z-30` but live in the body, which no longer contains the axis, so
           * they never meet.
           */
          className="sticky top-0 z-30 flex bg-surface"
        >
          <div
            className={cn(
              'flex shrink-0 items-end border-b border-ink-200 bg-ink-50/60 px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400',
              narrow && 'border-r',
            )}
            style={{ width: railW, height: AXIS_H }}
          >
            Epic
          </div>
          {/* Matches the resize handle's width so the axis stays aligned with
              the grid it labels. */}
          {!narrow && (
            <div
              className="w-1.5 shrink-0 border-b border-ink-200 bg-surface"
              aria-hidden="true"
            />
          )}
          <div
            ref={axisRef}
            className="min-w-0 flex-1 overflow-hidden border-b border-ink-200"
          >
            <div className="relative" style={{ width: scale.widthPx, height: AXIS_H }}>
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
                <MilestoneMarker
                  key={m.id}
                  milestone={m}
                  x={scale.xOf(Date.parse(m.releaseDate))}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="flex">
        {/* Left rail */}
        <div
          data-testid="roadmap-rail"
          className={cn(
            'shrink-0 bg-ink-50/60',
            // The resize handle draws the divider when it is present, so the
            // rail must not draw a second one beside it.
            narrow && 'border-r border-ink-200',
          )}
          style={{ width: railW }}
        >
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
                narrow={narrow}
              />
            ) : r.kind === 'child' ? (
              <div
                key={`rail-${r.child.id}`}
                className={cn(
                  'flex items-center gap-1.5 border-b border-ink-100 bg-ink-50/40 pr-2',
                  narrow ? 'pl-4' : 'pl-8',
                )}
                style={{ height: ROW_H }}
                title={`${r.child.key} · ${r.child.title}`}
              >
                {!narrow && (
                  <span className="nl-issue-key shrink-0 text-[10px]">{r.child.key}</span>
                )}
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

        {/*
         * The rail/grid divider is the resize handle.
         *
         * A separate 6px column rather than a border on the rail: a 1px border
         * is not a pointer target, and widening the border to be grabbable
         * would put a visible slab between the two halves of one table. This
         * reads as the same divider until you approach it.
         */}
        {!narrow && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the epic column"
            aria-valuenow={railW}
            aria-valuemin={RAIL_MIN}
            aria-valuemax={RAIL_MAX}
            tabIndex={0}
            data-testid="roadmap-rail-resize"
            onPointerDown={startRailResize}
            onKeyDown={nudgeRail}
            onDoubleClick={() => {
              // Double-click resets, the convention for a resizable divider —
              // and the only way back if you have dragged it somewhere silly.
              setRailPref(RAIL_W);
              window.localStorage.setItem(RAIL_W_KEY, String(RAIL_W));
            }}
            title="Drag to resize · double-click to reset"
            className={cn(
              'group/rz relative z-30 -ml-px w-1.5 shrink-0 cursor-col-resize',
              'focus:outline-none',
            )}
          >
            <span
              className={cn(
                'absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-ink-200 transition-colors',
                'group-hover/rz:bg-signal-400 group-focus-visible/rz:bg-signal-500',
                railDrag !== null && 'bg-signal-500',
              )}
              aria-hidden="true"
            />
          </div>
        )}

        {/* Scrollable time grid */}
        <div className="relative min-w-0 flex-1">
          {edges.left && (
            <div
              className="pointer-events-none absolute inset-y-0 left-0 z-30 w-6 bg-gradient-to-r from-surface to-transparent"
              aria-hidden="true"
            />
          )}
          {edges.right && (
            <div
              data-testid="roadmap-grid-fade-right"
              className="pointer-events-none absolute inset-y-0 right-0 z-30 w-8 bg-gradient-to-l from-surface to-transparent"
              aria-hidden="true"
            />
          )}
        <div
          ref={scrollRef}
          onScroll={onGridScroll}
          className="min-w-0 flex-1 overflow-x-auto"
        >
          {/* `minWidth: 100%` so a short plan at Month or Quarter still fills
              the panel instead of leaving a wide empty gutter to its right.
              Bars stay pixel-positioned off the scale either way. */}
          <div style={{ width: scale.widthPx }}>
            {/* Lanes */}
            <div ref={lanesRef} className="relative bg-surface">
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
                  className="pointer-events-none absolute top-0 bottom-0 z-[25] w-px bg-red-500"
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
                          'absolute z-20 flex items-center overflow-hidden rounded px-2 text-[11px] font-medium shadow-xs',
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
                onUnlink={onUnlink}
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
                    linkable={!!onLink}
                    linking={linking?.fromEpicId === r.epic.id}
                    linkTarget={linking?.overEpicId === r.epic.id}
                    reparentTarget={
                      drag?.overEpicId === r.epic.id ||
                      reparenting?.overEpicId === r.epic.id
                    }
                    onLinkStart={(e) => startLink(r.epic.id, e)}
                    drag={drag?.id === r.epic.id ? drag : null}
                    onDragStart={(mode, e) => {
                      dragKindRef.current = 'epic';
                      dragParentRef.current = null;
                      setDrag({
                        id: r.epic.id,
                        mode,
                        pointerId: e.pointerId,
                        originX: e.clientX,
                        originY: e.clientY,
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
                    onDragKind={onDragKind}
                    epicKeyOf={(id) => epicKeyById.get(id) ?? 'epic'}
                    reparentingId={reparenting?.childId ?? null}
                    onReparentStart={
                      onReparent
                        ? (e) => startReparent(r.child.id, r.epicId, e)
                        : undefined
                    }
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

              {/*
               * The rubber band. Drawn last so it is above every bar — a line
               * that disappears behind the thing you are aiming at tells you
               * nothing. Dashed and violet to match the handle, and distinct
               * from both the grey committed arrows and the red violated ones.
               */}
              {linking && (
                <svg
                  className="pointer-events-none absolute inset-0 z-40"
                  width={scale.widthPx}
                  height={
                    totalRowsHeight +
                    (data.sprints.length > 0 ? ROW_H + LANE_GAP : 0)
                  }
                  aria-hidden="true"
                  data-testid="roadmap-link-rubberband"
                >
                  {(() => {
                    const epic = datedEpics.find(
                      (e) => e.id === linking.fromEpicId,
                    );
                    const y0 = epicYById.get(linking.fromEpicId);
                    if (!epic?.end || y0 === undefined) return null;
                    const laneOffset =
                      data.sprints.length > 0 ? ROW_H + LANE_GAP : 0;
                    const x0 = scale.xOf(Date.parse(epic.end));
                    return (
                      <path
                        d={`M ${x0} ${y0 + laneOffset + ROW_H / 2} L ${linking.x} ${linking.y}`}
                        fill="none"
                        strokeWidth={2}
                        strokeDasharray="4 3"
                        strokeLinecap="round"
                        className={
                          linking.overEpicId
                            ? 'stroke-violet-600'
                            : 'stroke-violet-400'
                        }
                      />
                    );
                  })()}
                </svg>
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

      {/*
       * Milestone list — the diamonds are a glance, this is the detail.
       *
       * Each chip scrolls the grid to its release date. A release two quarters
       * out is off-screen by definition, so the chip was previously the only
       * place you could see it existed and there was no way to get from the
       * chip to the marker.
       */}
      {data.milestones.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {data.milestones.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => scrollToDate(Date.parse(m.releaseDate))}
              title={`Jump to ${m.name}`}
              data-testid="roadmap-milestone-chip"
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs text-amber-800 transition-colors hover:border-amber-300 hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
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
            </button>
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
  narrow,
}: {
  epic: RoadmapEpicDto;
  expanded: boolean;
  onToggle: () => void;
  onOpen: () => void;
  /** Expanding a CHILDLESS epic is still useful when you can create one. */
  canCreate: boolean;
  /**
   * Phone-width rail. The key badge and the percentage together consume the
   * whole 116px, leaving the title at zero width — the badge literally
   * overlapped the percentage. Both are dropped here: the title is what
   * identifies the work, the key is still on the bar's tooltip and in the
   * detail drawer, and the percentage is now drawn as a track along the bar.
   */
  narrow: boolean;
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
        {!narrow && (
          <span className="nl-issue-key shrink-0 text-[10px]">{epic.key}</span>
        )}
        <span className="truncate text-xs font-medium text-ink-800">{epic.title}</span>
      </button>
      {!narrow && (
        <span className="shrink-0 text-[10px] font-semibold tabular-nums text-ink-400">
          {Math.round(epic.progress * 100)}%
        </span>
      )}
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
  linkable,
  linking,
  linkTarget,
  reparentTarget,
  onLinkStart,
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
  /** Dependencies can be drawn (MEMBER+). Separate from `editable` only so a
   *  read-only chart never shows a handle that would fail on drop. */
  linkable: boolean;
  /** This bar is the source of the dependency currently being drawn. */
  linking: boolean;
  /** The pointer is over this bar while a dependency is being drawn. */
  linkTarget: boolean;
  /** A story is being dragged and would land in this epic on release. */
  reparentTarget: boolean;
  onLinkStart: (e: React.PointerEvent) => void;
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
  const tone = EPIC_COLORS[epic.statusCategory];

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
    <div
      className={cn(
        'relative border-b border-ink-100',
        // The whole ROW highlights, not the bar: you are dropping into an
        // epic, and an epic occupies its entire lane whatever its bar's
        // length. Lighting only the bar would suggest you had to hit it.
        reparentTarget && 'bg-violet-500/10 ring-1 ring-inset ring-violet-400',
      )}
      data-reparent-target={reparentTarget ? 'true' : undefined}
      style={{ height: ROW_H }}
    >
      {overrunX !== null && (
        <div
          className="nl-gantt-overrun pointer-events-none absolute z-20 rounded-r"
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
          'group absolute z-20 flex items-center overflow-visible rounded-md border text-left shadow-xs transition-shadow',
          'focus:outline-none focus-visible:ring-2',
          tone.bar,
          editable && 'cursor-grab active:cursor-grabbing',
          drag?.moved && 'z-30 shadow-card ring-2 ring-signal-400',
          linkTarget && 'z-30 ring-2 ring-violet-500',
          linking && 'ring-2 ring-violet-400',
        )}
        style={{ left, width, top: (ROW_H - BAR_H) / 2, height: BAR_H }}
      >
        {/*
         * Progress. Two problems with the old full-height `signal-300/70`
         * wash: against a `signal-100` bar it was a ~1.1:1 step, invisible at
         * a glance, so the bar never showed the completion the rail was
         * reporting in text — and raising the contrast made the fill's edge
         * slice through the title mid-word.
         *
         * A track pinned to the bottom edge solves both: strong enough to read
         * across the row, and it never competes with the label above it.
         */}
        <span
          className={cn(
            'absolute inset-x-0 bottom-0 h-1 overflow-hidden rounded-b-md',
            tone.track,
          )}
          aria-hidden="true"
        >
          <span
            className={cn('block h-full rounded-r-sm', tone.fill)}
            style={{ width: `${fill}%` }}
          />
        </span>
        {/* Live feedback while dragging: how many days you have moved, and
            what the window becomes. Without it a drag is guesswork — you drop
            the bar and only then find out where it landed. */}
        {drag?.moved && (
          <span className="pointer-events-none absolute -top-6 left-0 z-40 whitespace-nowrap rounded bg-ink-900 px-1.5 py-0.5 text-[10px] font-semibold text-surface shadow-card">
            {signedDays(drag.dayDelta)} · {fmtRange(preview.start, preview.end)}
            {skipWeekends && (
              <span className="ml-1 opacity-70">
                ({workdaysBetween(preview.start, preview.end)}wd)
              </span>
            )}
          </span>
        )}
        <span className="relative z-10 flex w-full items-center gap-1.5 overflow-hidden px-1.5">
          <span className={cn('truncate text-[11px] font-medium', tone.text)}>
            {epic.title}
          </span>
          {/* The window in words. Until now the only way to read an epic's
              dates was to hover it, so a glanced-at or printed roadmap carried
              no dates at all.

              Left-aligned right after the title, NOT right-aligned in the bar:
              at week zoom a quarter-long epic is several viewports wide, so
              anything pinned to its right edge is permanently off-screen.
              Suppressed on narrow bars, where it would crowd out the title,
              and while dragging, where the tooltip says it more precisely. */}
          {width >= 170 && !drag?.moved && (
            <span
              data-testid="roadmap-epic-dates"
              className={cn(
                'shrink-0 whitespace-nowrap text-[10px] tabular-nums opacity-80',
                tone.text,
              )}
            >
              {fmtRange(preview.start, preview.end)}
            </span>
          )}
          {/*
           * Gated on the number it is about to print, not on
           * `childrenOutside`. Those are different questions: a child that
           * starts BEFORE its epic is outside the window but contributes
           * `underrunDays`, not `overrunDays` — so the badge rendered a
           * meaningless "+0d". It now says which end is spilling, and says
           * nothing when neither does.
           */}
          {(epic.overrunDays > 0 || epic.underrunDays > 0) && (
            <span
              data-testid="roadmap-epic-spill"
              title={[
                epic.underrunDays > 0
                  ? `Children start ${epic.underrunDays}d before this epic`
                  : null,
                epic.overrunDays > 0
                  ? `Children run ${epic.overrunDays}d past this epic`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              className="ml-auto shrink-0 rounded bg-amber-400/90 px-1 text-[9px] font-bold text-amber-950"
            >
              {epic.underrunDays > 0 && `−${epic.underrunDays}d`}
              {epic.underrunDays > 0 && epic.overrunDays > 0 && ' '}
              {epic.overrunDays > 0 && `+${epic.overrunDays}d`}
            </span>
          )}
        </span>

        {editable && (
          <>
            <ResizeGrip
              side="start"
              tone={tone.grip}
              onPointerDown={(e) => onDragStart('resize-start', e)}
            />
            <ResizeGrip
              side="end"
              tone={tone.grip}
              onPointerDown={(e) => onDragStart('resize-end', e)}
            />
          </>
        )}

        {/*
         * Dependency handle. Sits OUTSIDE the bar's right edge, past the
         * resize grip, so the two gestures can't be confused: grabbing the
         * edge resizes, grabbing the dot draws a dependency.
         *
         * Visible on hover and focus only — one dot per epic, always shown,
         * would add a column of noise to a chart whose whole problem is
         * density. It stays visible for the duration of a draw so you can see
         * where the line is anchored.
         */}
        {linkable && (
          <span
            role="button"
            tabIndex={-1}
            data-testid="roadmap-link-handle"
            data-link-from={epic.id}
            title={`Drag to an epic that ${epic.key} blocks`}
            aria-label={`Draw a dependency from ${epic.key}`}
            onPointerDown={(e) => {
              if (!canDragWith(e)) return;
              e.stopPropagation();
              e.preventDefault();
              onLinkStart(e);
            }}
            // A pointerdown on the handle never becomes a click on the bar,
            // but the browser still fires one on pointerup; swallow it so
            // finishing a draw doesn't also open the issue drawer.
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'absolute top-1/2 z-30 -mt-[5px] -mr-[13px] right-0 h-2.5 w-2.5 cursor-crosshair rounded-full',
              'border-2 border-surface bg-violet-500 shadow-xs transition-opacity',
              linking
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
            )}
          />
        )}
      </button>

    </div>
  );
}

function ResizeGrip({
  side,
  onPointerDown,
  tone,
}: {
  side: 'start' | 'end';
  onPointerDown: (e: React.PointerEvent) => void;
  /** Matches the bar it grips, so a done epic's handle isn't blue. */
  tone: string;
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
        'absolute inset-y-0 z-20 w-2 cursor-ew-resize transition-opacity',
        side === 'start' ? 'left-0 rounded-l-md' : 'right-0 rounded-r-md',
        tone,
        'opacity-0 group-hover:opacity-40',
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
  onDragKind,
  epicKeyOf,
  onReparentStart,
  reparentingId,
}: {
  child: RoadmapChildDto;
  epicId: string;
  /** Tells the timeline what kind of thing is being dragged, and from where. */
  onDragKind: (kind: 'child', fromEpicId: string) => void;
  /** Resolves an epic id to its key, for the reparent tooltip. */
  epicKeyOf: (epicId: string) => string;
  /** Begin dragging an UNDATED story to another epic. Absent = not allowed. */
  onReparentStart?: (e: React.PointerEvent) => void;
  /** Id of the story currently being dragged between epics, if any. */
  reparentingId?: string | null;
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
        onReparentStart={onReparentStart}
        moving={reparentingId === child.id}
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
          onDragKind('child', epicId);
          setDrag({
            id: child.id,
            mode: 'move',
            pointerId: e.pointerId,
            originX: e.clientX,
            originY: e.clientY,
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
          'group absolute z-20 flex items-center overflow-hidden rounded text-left text-[10px] font-medium shadow-xs',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400',
          'border',
          CHILD_COLORS[child.statusCategory].bar,
          // Dashed = "these dates are the sprint's, not the story's own". It is
          // a property of where the window came from, so it rides on the border
          // style and leaves the fill free to carry status.
          child.fromSprint && 'border-dashed opacity-80',
          draggable && 'cursor-grab active:cursor-grabbing hover:ring-1 hover:ring-signal-400',
          drag?.moved && 'z-30 ring-2 ring-signal-400',
        )}
        style={{ left, width, top: (ROW_H - 16) / 2, height: 16 }}
      >
        <span className="truncate px-1.5">{child.title}</span>
        {drag?.moved && (
          <span className="pointer-events-none absolute -top-6 left-0 z-40 whitespace-nowrap rounded bg-ink-900 px-1.5 py-0.5 text-[10px] font-semibold text-surface shadow-card">
            {/* Naming the destination epic matters more than the day count
                when you are reparenting: the rows all look alike, and "which
                epic am I about to drop this into" is the thing you cannot
                verify from the bar's position alone. */}
            {drag.overEpicId && (
              <span className="mr-1 text-violet-300">
                → {epicKeyOf(drag.overEpicId)}
              </span>
            )}
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
  onReparentStart,
  moving,
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
  /** Absent when the chart cannot reparent — then no grip is drawn. */
  onReparentStart?: (e: React.PointerEvent) => void;
  /** This row is the one currently being dragged to another epic. */
  moving?: boolean;
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
        <span className="pointer-events-none absolute -top-1 z-40 whitespace-nowrap rounded bg-ink-900 px-1.5 py-0.5 text-[10px] font-semibold text-surface shadow-card" style={{ left }}>
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
        <>
          {/*
           * The reparent grip.
           *
           * An undated story had no bar, so it was the one thing on this chart
           * you could not move between epics — the row itself is a scheduling
           * surface, and hijacking it for a second gesture would have made
           * "drag here to schedule" a lie. A separate grip keeps both:
           * anywhere on the row paints dates, the grip moves the story.
           */}
          {editable && onReparentStart && (
            <span
              role="button"
              tabIndex={-1}
              data-testid="roadmap-unscheduled-grip"
              data-reparent-child={child.id}
              title={`Drag ${child.key} onto another epic to move it there`}
              aria-label={`Move ${child.key} ${child.title} to another epic`}
              onPointerDown={(e) => {
                if (!canDragWith(e)) return;
                // The row underneath would otherwise start painting a window.
                e.stopPropagation();
                e.preventDefault();
                onReparentStart(e);
              }}
              className={cn(
                'absolute left-1.5 top-1/2 z-30 flex h-4 w-4 -translate-y-1/2 cursor-grab items-center justify-center rounded text-ink-400 transition-opacity active:cursor-grabbing',
                'hover:bg-ink-200 hover:text-ink-700',
                moving ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
              )}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <g fill="currentColor">
                  <circle cx="3" cy="2" r="1" />
                  <circle cx="7" cy="2" r="1" />
                  <circle cx="3" cy="5" r="1" />
                  <circle cx="7" cy="5" r="1" />
                  <circle cx="3" cy="8" r="1" />
                  <circle cx="7" cy="8" r="1" />
                </g>
              </svg>
            </span>
          )}
          <span className="pointer-events-none absolute left-7 top-1/2 -translate-y-1/2 text-[10px] italic text-ink-400">
            {editable ? 'drag here to schedule' : 'no dates'}
          </span>
        </>
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
      // Fully inside the axis band. It used to straddle the axis/lane boundary
      // with `translate-y-1/2`, which was fine when the axis was just another
      // row in the grid — now that the band is its own clipped viewport, the
      // overhanging half was sliced off and the diamond read as a triangle.
      className="absolute bottom-1 z-10 h-2.5 w-2.5 -translate-x-1/2 rotate-45 border border-amber-600 bg-amber-400"
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
  onUnlink,
}: {
  data: RoadmapDto;
  scale: Scale;
  epicYById: Map<string, number>;
  height: number;
  offsetY: number;
  /** Absent on a read-only chart: no hover target, no remove control. */
  onUnlink?: (input: {
    linkId: string;
    fromEpicId: string;
    toEpicId: string;
  }) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
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

    /*
     * Where the remove control sits. On a forward elbow that is the vertical
     * run between the two rows; on a backward one it is the gutter segment.
     * Both are gaps between bars by construction, which is the whole point —
     * a control parked on top of a bar would be unreachable at the density
     * this chart runs at.
     */
    const midX = forward
      ? Math.max(x1 + STUB, x2 - STUB)
      : (x1 + STUB + (x2 - STUB)) / 2;
    const midY = forward ? (y1 + y2) / 2 : gutterY;

    /*
     * What this line means, in words, on hover.
     *
     * Colour and dash pattern encode it, and the legend now names both states
     * — but neither tells you WHICH two epics, or by how much a red one
     * misses. That is the question you actually have when you spot a red line
     * on someone else's plan.
     */
    const endsOn = fmtDay(Date.parse(from.end));
    const startsOn = fmtDay(Date.parse(to.start));
    const label = dep.violated
      ? `${from.key} blocks ${to.key}, but ${from.key} ends ${endsOn} — after ${to.key} starts ${startsOn}`
      : `${from.key} blocks ${to.key} — ends ${endsOn}, before ${to.key} starts ${startsOn}`;

    return [
      {
        key: `${dep.fromEpicId}-${dep.toEpicId}`,
        id: dep.id,
        fromEpicId: dep.fromEpicId,
        toEpicId: dep.toEpicId,
        d,
        violated: dep.violated,
        label,
        arrowX: x2,
        arrowY: y2,
        midX,
        midY,
      },
    ];
  });

  if (paths.length === 0 || height === 0) return null;

  return (
    <svg
      /*
       * Above the row backgrounds, BELOW the bars.
       *
       * This used to carry a comment claiming it sat under the bars while
       * being `z-10` against bars with no z-index at all — and a positive
       * z-index paints above `z-auto` whatever the DOM order, so every arrow
       * was drawn straight over the cards it connects. Founder report: "lines
       * overlapping certain gantt items."
       *
       * The fix is to raise the BARS to `z-20`, not to lower this layer.
       * Dropping it to `z-0` looks like the obvious move and is wrong: `z-0`
       * and `z-auto` share one painting layer ordered by tree position, and
       * this overlay is emitted before the rows — so `z-0` put the arrows, and
       * their pointer targets, behind every row div. The remove control became
       * unhittable, which the e2e caught.
       */
      className="pointer-events-none absolute left-0 z-10"
      style={{ top: offsetY }}
      width={scale.widthPx}
      height={height}
      aria-hidden={onUnlink ? undefined : true}
      data-testid="roadmap-dependency-layer"
    >
      {paths.map((p) => (
        <g key={p.key}>
          <title>{p.label}</title>
          {/*
           * A 1.5px line is not a pointer target. This invisible 14px-wide
           * twin carries the hover, and only the STROKE is hittable — the
           * layer stays `pointer-events-none` overall, so the large empty
           * bounding box of an elbow never steals a click meant for a bar.
           */}
          {onUnlink && (
            <path
              d={p.d}
              fill="none"
              stroke="transparent"
              strokeWidth={14}
              style={{ pointerEvents: 'stroke' }}
              onPointerEnter={() => setHovered(p.key)}
              onPointerLeave={() =>
                setHovered((h) => (h === p.key ? null : h))
              }
            />
          )}
          <path
            d={p.d}
            fill="none"
            strokeWidth={hovered === p.key ? 2.5 : 1.5}
            strokeDasharray={p.violated ? undefined : '3 3'}
            className={p.violated ? 'stroke-red-500' : 'stroke-ink-400'}
          />
          <circle
            cx={p.arrowX}
            cy={p.arrowY}
            r={3}
            className={p.violated ? 'fill-red-500' : 'fill-ink-400'}
          />
          {onUnlink && hovered === p.key && (
            <g
              data-testid="roadmap-dependency-remove"
              data-link-id={p.id}
              role="button"
              tabIndex={-1}
              aria-label="Remove dependency"
              style={{ pointerEvents: 'all', cursor: 'pointer' }}
              onPointerEnter={() => setHovered(p.key)}
              onClick={() =>
                onUnlink({
                  linkId: p.id,
                  fromEpicId: p.fromEpicId,
                  toEpicId: p.toEpicId,
                })
              }
            >
              <title>Remove dependency</title>
              <circle
                cx={p.midX}
                cy={p.midY}
                r={7}
                className="fill-surface stroke-ink-400"
                strokeWidth={1}
              />
              <path
                d={`M ${p.midX - 3} ${p.midY - 3} L ${p.midX + 3} ${p.midY + 3} M ${p.midX + 3} ${p.midY - 3} L ${p.midX - 3} ${p.midY + 3}`}
                strokeWidth={1.5}
                strokeLinecap="round"
                className="stroke-ink-600"
              />
            </g>
          )}
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
/** A single date, in the same short form the bars use for their windows. */
function fmtDay(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

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
