/**
 * KnowledgeGraphView — the "observatory": a full-page, immersive knowledge
 * graph (founder directive, 2026-07-20: "a distinct full-page feel, better
 * than Obsidian" — replacing the old 420–560px boxed panel behind the
 * Document/Graph toggle).
 *
 * Design language: a deep, atmospheric canvas (a soft vignette + a faint
 * dot-grid "star field", both derived from the `ink`/`canvas` design tokens
 * so it's theme-aware for free) with thin tapered filaments for edges and
 * quiet graphite dots for nodes at rest. The ONE signature moment
 * (`nl-graph-pulse-line`, `src/index.css`): hovering OR focusing a node
 * ignites its neighborhood — neighbors brighten to the `signal` accent, a
 * single light pulse travels each connecting filament, and everything else
 * recedes. `prefers-reduced-motion` gets the instant highlight with no
 * traveling pulse (the overlay line is simply never rendered).
 *
 * Nodes encode real signal, not decoration:
 *  - Color: the workspace-wide graph colors each node by its owning
 *    project (stable hue per `projectId`, a neutral gray for workspace-docs
 *    pages — see `graphColors.ts` + `GraphLegend`); the per-project graph
 *    stays single-accent (nothing to key by).
 *  - Size: inbound-link count ("authority") — a page many others reference
 *    reads as a bigger, softly-glowing hub.
 *  - Opacity/saturation: a page not edited in 30+ days recedes visually
 *    (`isStalePage`), so recency reads at a glance.
 *
 * Navigation (Obsidian's weak spot — it has none of this):
 *  - `GraphSearch` — search-to-fly: typing highlights every title match on
 *    the canvas; picking one flies the camera to center it.
 *  - Focus/orbit — clicking OR focusing (mouse, Tab, or arrow-key
 *    traversal between a node's neighbors) a node re-centers the canvas on
 *    it and opens `GraphSideRail` (title, backlinks, outgoing links, an
 *    explicit "Open page" action). `Enter` on a focused node navigates
 *    straight there.
 *  - `GraphMinimap` — a corner overview with a click-to-jump viewport
 *    rectangle, shown once a graph is too big to hold in your head.
 *
 * Opening a page routes to the node's OWN scope directly — `PageGraphNode`
 * now carries `projectId` (org-level-docs epic; `null` = a workspace-docs
 * page), so unlike the old implementation this needs NO on-demand
 * `fetchPageScope` round trip: `projectId` set → that project's Pages
 * route; `projectId` null → the CURRENT workspace's Docs route (every node
 * in a workspace-wide graph is guaranteed to belong to that same
 * workspace, whether it's one of its projects' pages or a workspace-docs
 * page itself).
 *
 * The SVG's `viewBox` is sized to the container's ACTUAL measured pixel
 * dimensions (not a fixed large "world" that gets shrunk to fit) — so node
 * labels render at a legible, constant pixel size on mobile too. Every
 * rendered node center is ADDITIONALLY clamped to the canvas bounds at
 * render time (`clampCenter`), independent of the force layout's own
 * margin math — a defensive guarantee that a node box can never render
 * clipped past the canvas edge, regardless of simulation internals.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PageGraphNode } from '@next-lane/shared';
import { createForceSimulation, type Point } from '@/lib/forceLayout';
import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { usePageGraph, useWorkspacePageGraph } from '@/api/pages';
import type { PagesScope } from '@/api/keys';
import type { PageScopeRef } from '@/lib/pageRoute';
import { cn } from '@/lib/cn';
import { GraphSearch } from './GraphSearch';
import { GraphLegend } from './GraphLegend';
import { GraphMinimap } from './GraphMinimap';
import { GraphSideRail } from './GraphSideRail';
import { PROJECT_HUE_CLASSES, isStalePage, projectHue } from './graphColors';

const MIN_SCALE = 0.35;
const MAX_SCALE = 3;
const TOTAL_ITERATIONS = 220;
const ANIMATE_NODE_CAP = 150; // above this, skip incremental frames even with motion allowed
const MINIMAP_NODE_THRESHOLD = 8; // below this, an overview panel is just clutter

// Node geometry: a filled DOT centered exactly on the layout point (so
// edges terminate at dot centers), with the page title in small, quiet text
// UNDERNEATH — not a bordered pill. Diameter scales with inbound-link count
// ("authority"), so heavily-referenced pages read instantly as bigger,
// glowing hubs.
const NODE_W = 108;
/** Vertical slot the dot is centered in (box top → dot center = half this). */
const NODE_DOT_SLOT = 26;
/** Full box height: dot slot + label line(s). */
const NODE_H = 54;
/** Dot diameter range — min for un-referenced pages, max for the densest hubs. */
const DOT_MIN = 9;
const DOT_MAX = 28;
/** Inbound-link count at/above which a node gets the soft hub glow. */
const HUB_AUTHORITY = 3;
/** Inbound-link count that saturates the size scale. */
const AUTHORITY_CAP = 10;

export interface KnowledgeGraphViewProps {
  scope: PagesScope;
  onOpenPage: (ref: PageScopeRef) => void;
  /** The shared Document/Graph segmented control (`PagesSurface`'s
   * `ViewToggle`) — rendered in THIS view's own top bar so "back to
   * Document" is always reachable from the full-bleed graph surface. */
  viewToggle: React.ReactNode;
}

/**
 * Measures a container's actual pixel size, re-measuring on resize.
 *
 * Uses a CALLBACK ref (not a plain `useRef` + effect keyed on that ref
 * object) deliberately: a `useRef` object's IDENTITY never changes even
 * once `.current` goes from `null` to the real node, so an effect keyed on
 * `[ref]` would run exactly once and never see the node appear. A callback
 * ref stores the node itself in state, so attachment is a real dependency
 * change that re-triggers measurement.
 */
function useContainerSize<T extends HTMLElement>(): readonly [(node: T | null) => void, { width: number; height: number }] {
  const [el, setEl] = useState<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const ref = useCallback((node: T | null) => setEl(node), []);

  useLayoutEffect(() => {
    if (!el) return;
    const measure = () => setSize({ width: Math.round(el.clientWidth), height: Math.round(el.clientHeight) });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);

  return [ref, size] as const;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Clamp a node's rendered CENTER so its full box always stays on-canvas —
 * a defensive guarantee independent of the force layout's own margins. */
function clampCenter(p: Point, width: number, height: number): Point {
  const halfW = NODE_W / 2;
  const topPad = NODE_DOT_SLOT / 2;
  const bottomPad = NODE_H - NODE_DOT_SLOT / 2;
  return {
    x: clamp(p.x, halfW, Math.max(halfW, width - halfW)),
    y: clamp(p.y, topPad, Math.max(topPad, height - bottomPad)),
  };
}

const DIRECTION_ANGLE: Record<'up' | 'down' | 'left' | 'right', number> = {
  right: 0,
  down: 90,
  left: 180,
  up: 270,
};

export function KnowledgeGraphView({ scope, onOpenPage, viewToggle }: KnowledgeGraphViewProps) {
  // Exactly one of these is enabled (the other's `enabled: !!id` guard is
  // `false`, so it never fetches) — the graph data source depends on scope,
  // but hooks must still be called unconditionally every render.
  const projectGraphQuery = usePageGraph(scope.kind === 'project' ? scope.id : undefined);
  const workspaceGraphQuery = useWorkspacePageGraph(scope.kind === 'workspace' ? scope.id : undefined);
  const graphQuery = scope.kind === 'project' ? projectGraphQuery : workspaceGraphQuery;
  const [containerRef, { width, height }] = useContainerSize<HTMLDivElement>();
  const reducedMotion = usePrefersReducedMotion();

  const nodes = useMemo(() => graphQuery.data?.nodes ?? [], [graphQuery.data]);
  const edges = useMemo(() => graphQuery.data?.edges ?? [], [graphQuery.data]);
  const truncated = graphQuery.data?.truncated ?? false;
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n] as const)), [nodes]);
  const graphNodeIds = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);

  const [positions, setPositions] = useState<Map<string, Point>>(new Map());
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchMatches, setSearchMatches] = useState<Set<string>>(new Set());
  const [camera, setCamera] = useState({ x: 0, y: 0, scale: 1 });
  const [smooth, setSmooth] = useState(false);
  const smoothTimeoutRef = useRef<number | undefined>(undefined);
  const nodeButtonRefs = useRef(new Map<string, HTMLButtonElement>());

  /** Route a clicked/opened node to its OWN scope — see the header doc
   * comment. No round trip needed: `PageGraphNode.projectId` already tells
   * us everything. */
  const openNode = useCallback(
    (n: PageGraphNode) => {
      onOpenPage({ id: n.id, projectId: n.projectId, workspaceId: scope.kind === 'workspace' ? scope.id : '' });
    },
    [onOpenPage, scope],
  );

  // Adjacency (undirected), for hover/focus neighborhood ignition + keyboard traversal.
  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const e of edges) {
      if (!map.has(e.sourceId)) map.set(e.sourceId, new Set());
      if (!map.has(e.targetId)) map.set(e.targetId, new Set());
      map.get(e.sourceId)!.add(e.targetId);
      map.get(e.targetId)!.add(e.sourceId);
    }
    return map;
  }, [edges]);

  // Authority (inbound-link count only — an intentionally DIRECTED signal,
  // distinct from the undirected `neighbors` adjacency above): drives both
  // node size and the hub glow.
  const inboundCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of edges) map.set(e.targetId, (map.get(e.targetId) ?? 0) + 1);
    return map;
  }, [edges]);

  const dotSize = useCallback(
    (id: string) => {
      const authority = inboundCount.get(id) ?? 0;
      return DOT_MIN + (DOT_MAX - DOT_MIN) * Math.sqrt(Math.min(authority, AUTHORITY_CAP) / AUTHORITY_CAP);
    },
    [inboundCount],
  );

  // Compute (and, when motion is allowed, animate) the force layout whenever
  // the graph data or the available canvas size changes. Runs in per-frame
  // chunks off a single stateful stepper so a large graph's O(n²) budget
  // never blocks the main thread in one long call.
  useEffect(() => {
    if (nodes.length === 0 || width === 0 || height === 0) {
      setPositions(new Map());
      return;
    }
    const nodeIds = nodes.map((n) => n.id);
    const edgePairs: Array<readonly [string, string]> = edges.map((e) => [e.sourceId, e.targetId] as const);
    const sim = createForceSimulation(nodeIds, edgePairs, {
      width,
      height,
      iterations: TOTAL_ITERATIONS,
      padding: { x: NODE_W / 2 + 2, y: NODE_H - NODE_DOT_SLOT / 2 + 4 },
    });
    const animate = !reducedMotion && nodes.length <= ANIMATE_NODE_CAP;
    const chunk = animate ? 8 : 20;

    if (sim.totalIterations === 0) {
      setPositions(sim.positions());
      return;
    }

    let cancelled = false;
    let raf = 0;
    const step = () => {
      if (cancelled) return;
      sim.runIterations(chunk);
      const done = sim.ranIterations >= sim.totalIterations;
      if (animate || done) setPositions(sim.positions());
      if (!done) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
    // Deliberately depend on `graphQuery.data` (stable object identity per
    // fetch) rather than the derived `nodes`/`edges` arrays, which are new
    // array literals on every render and would re-trigger this effect.
  }, [graphQuery.data, width, height, reducedMotion]);

  // Render-time safety net: clamp every node's center into the canvas so a
  // box can never render clipped past the edge (see `clampCenter`), and use
  // THIS map everywhere downstream (edges, node hit-targets, camera math,
  // the minimap) so an edge always visually terminates exactly at its
  // node's rendered dot.
  const safePositions = useMemo(() => {
    if (width === 0 || height === 0) return positions;
    const out = new Map<string, Point>();
    for (const [id, p] of positions) out.set(id, clampCenter(p, width, height));
    return out;
  }, [positions, width, height]);

  // Reset camera + selection whenever a fresh graph is loaded (new scope) so
  // the user isn't left panned off-canvas or looking at a stale rail.
  useEffect(() => {
    setCamera({ x: 0, y: 0, scale: 1 });
    setSelectedId(null);
    setHoveredId(null);
    setSearchMatches(new Set());
  }, [scope.kind, scope.id]);

  // Escape closes the side rail from anywhere — a modal-ish overlay needs a
  // keyboard way out that isn't "tab all the way to the close button".
  useEffect(() => {
    if (!selectedId) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setSelectedId(null);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selectedId]);

  const cx = width / 2;
  const cy = height / 2;

  /** Animate the camera to center world point (x, y) — the one "fly"
   * primitive shared by search-to-fly, node selection, and the minimap's
   * click-to-jump, per the observatory's navigation model. */
  const flyTo = useCallback(
    (x: number, y: number, targetScale?: number) => {
      const scale = clamp(targetScale ?? camera.scale, MIN_SCALE, MAX_SCALE);
      const next = { x: -scale * (x - cx), y: -scale * (y - cy), scale };
      if (reducedMotion) {
        setCamera(next);
        return;
      }
      window.clearTimeout(smoothTimeoutRef.current);
      setSmooth(true);
      setCamera(next);
      smoothTimeoutRef.current = window.setTimeout(() => setSmooth(false), 340);
    },
    [camera.scale, cx, cy, reducedMotion],
  );

  /** Select a node — the "focus/orbit" gesture: opens the side rail AND
   * re-centers the canvas on it. Idempotent (safe to call from both click
   * and focus handlers on the same interaction). */
  const selectNode = useCallback(
    (id: string) => {
      setSelectedId(id);
      const p = safePositions.get(id);
      if (p) flyTo(p.x, p.y);
    },
    [safePositions, flyTo],
  );

  /** Keyboard neighbor traversal: move focus (and thus selection) to the
   * neighbor whose direction from `fromId` best matches the arrow pressed —
   * spatial, not DOM-order, navigation. */
  const focusNeighbor = useCallback(
    (fromId: string, dir: 'up' | 'down' | 'left' | 'right') => {
      const nbrs = neighbors.get(fromId);
      const origin = safePositions.get(fromId);
      if (!nbrs || nbrs.size === 0 || !origin) return;
      const targetAngle = DIRECTION_ANGLE[dir];
      let best: string | null = null;
      let bestDiff = Infinity;
      for (const id of nbrs) {
        const p = safePositions.get(id);
        if (!p) continue;
        const angleDeg = (Math.atan2(p.y - origin.y, p.x - origin.x) * 180) / Math.PI;
        const norm = (angleDeg + 360) % 360;
        let diff = Math.abs(norm - targetAngle);
        if (diff > 180) diff = 360 - diff;
        if (diff < bestDiff) {
          bestDiff = diff;
          best = id;
        }
      }
      if (best) nodeButtonRefs.current.get(best)?.focus();
    },
    [neighbors, safePositions],
  );

  function handleNodeKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, n: PageGraphNode) {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      openNode(n);
      return;
    }
    const dirMap: Record<string, 'up' | 'down' | 'left' | 'right'> = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
    };
    const dir = dirMap[e.key];
    if (dir) {
      e.preventDefault();
      e.stopPropagation();
      focusNeighbor(n.id, dir);
    }
  }

  // ── Pan / zoom (pointer events unify mouse + touch) ───────────────────────
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; camX: number; camY: number } | null>(null);
  const pinchRef = useRef<{ startDist: number; startScale: number } | null>(null);

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    // Let a node's own <button> handle its own click/focus normally — if we
    // captured the pointer here regardless of target, the browser re-targets
    // the synthetic `click` that follows pointerup to the CAPTURING element
    // (this <svg>, which has no onClick), silently swallowing every node
    // click. Only start pan/pinch tracking when the press didn't originate
    // on an interactive node.
    if ((e.target as HTMLElement).closest?.('button')) return;
    (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setSmooth(false);
    window.clearTimeout(smoothTimeoutRef.current);
    if (pointers.current.size === 1) {
      dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, camX: camera.x, camY: camera.y };
    } else if (pointers.current.size === 2) {
      dragRef.current = null;
      const pts = Array.from(pointers.current.values());
      pinchRef.current = { startDist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1, startScale: camera.scale };
    }
  }
  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinchRef.current) {
      const pts = Array.from(pointers.current.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      const scale = clamp(pinchRef.current.startScale * (dist / pinchRef.current.startDist), MIN_SCALE, MAX_SCALE);
      setCamera((c) => ({ ...c, scale }));
      return;
    }
    if (dragRef.current && dragRef.current.pointerId === e.pointerId) {
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setCamera((c) => ({ ...c, x: dragRef.current!.camX + dx, y: dragRef.current!.camY + dy }));
    }
  }
  function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    pointers.current.delete(e.pointerId);
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
    if (pointers.current.size < 2) pinchRef.current = null;
  }
  function onWheel(e: React.WheelEvent<SVGSVGElement>) {
    e.preventDefault();
    setSmooth(false);
    const delta = -e.deltaY * 0.0015;
    setCamera((c) => ({ ...c, scale: clamp(c.scale * (1 + delta), MIN_SCALE, MAX_SCALE) }));
  }
  function zoomBy(factor: number) {
    setSmooth(false);
    setCamera((c) => ({ ...c, scale: clamp(c.scale * factor, MIN_SCALE, MAX_SCALE) }));
  }
  function resetCamera() {
    setSmooth(!reducedMotion);
    setCamera({ x: 0, y: 0, scale: 1 });
  }
  function onCanvasKeyDown(e: React.KeyboardEvent<SVGSVGElement>) {
    const step = 40;
    if (e.key === 'ArrowLeft') setCamera((c) => ({ ...c, x: c.x + step }));
    else if (e.key === 'ArrowRight') setCamera((c) => ({ ...c, x: c.x - step }));
    else if (e.key === 'ArrowUp') setCamera((c) => ({ ...c, y: c.y + step }));
    else if (e.key === 'ArrowDown') setCamera((c) => ({ ...c, y: c.y - step }));
    else if (e.key === '+' || e.key === '=') zoomBy(1.2);
    else if (e.key === '-' || e.key === '_') zoomBy(1 / 1.2);
    else return;
    setSmooth(false);
    e.preventDefault();
  }

  const groupTransform = `translate(${camera.x} ${camera.y}) translate(${cx} ${cy}) scale(${camera.scale}) translate(${-cx} ${-cy})`;

  // ── Ignition state (the signature "constellation" effect) ─────────────────
  const searchActive = searchMatches.size > 0;
  const activeId = hoveredId ?? selectedId;

  // Atmospheric canvas: a soft radial vignette (depth) over a faint dot-grid
  // ("star field"), both purely token-derived so it's theme-aware for free —
  // deep graphite-blue near-black in dark mode, a cool graphite wash in light.
  const observatoryStyle: React.CSSProperties = {
    backgroundColor: 'var(--nl-canvas)',
    backgroundImage:
      'radial-gradient(ellipse 75% 65% at 50% 36%, color-mix(in srgb, var(--nl-ink-100) 60%, transparent), transparent 72%), ' +
      'radial-gradient(circle, var(--nl-ink-300) 1px, transparent 1px)',
    backgroundSize: 'auto, 24px 24px',
    backgroundPosition: 'center, 0 0',
  };

  const selectedNode = selectedId ? nodeById.get(selectedId) : undefined;

  let canvasContent: React.ReactNode;
  if (graphQuery.isLoading) {
    canvasContent = (
      <div className="flex h-full items-center justify-center">
        <LoadingState label="Loading knowledge graph…" />
      </div>
    );
  } else if (graphQuery.isError) {
    canvasContent = (
      <div className="flex h-full items-center justify-center p-6">
        <ErrorState error={graphQuery.error} onRetry={() => graphQuery.refetch()} />
      </div>
    );
  } else if (nodes.length === 0) {
    canvasContent = (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState
          title="Nothing to graph yet"
          description="Create a few pages and link them with [[wiki-links]] to see the knowledge graph."
        />
      </div>
    );
  } else {
    canvasContent = (
      <>
        {width > 0 && height > 0 && (
          <svg
            role="group"
            aria-label={`Knowledge graph: ${nodes.length} pages, ${edges.length} links`}
            viewBox={`0 0 ${width} ${height}`}
            width={width}
            height={height}
            tabIndex={0}
            className="touch-none cursor-grab outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal-400 active:cursor-grabbing"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
            onKeyDown={onCanvasKeyDown}
          >
            <g
              transform={groupTransform}
              className={cn(smooth && !reducedMotion && 'transition-transform duration-300 ease-out')}
            >
              {/* Edges — thin tapered filaments; the ignited node's edges
                  light up with a traveling pulse, everything else recedes. */}
              {edges.map((e, i) => {
                const a = safePositions.get(e.sourceId);
                const b = safePositions.get(e.targetId);
                if (!a || !b) return null;
                const isActive = !searchActive && activeId !== null && (e.sourceId === activeId || e.targetId === activeId);
                const isDimmed = !searchActive && activeId !== null && !isActive;
                const len = Math.hypot(b.x - a.x, b.y - a.y);
                return (
                  <g key={`${e.sourceId}-${e.targetId}-${i}`}>
                    <line
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      strokeWidth={isActive ? 1.75 : 1}
                      strokeLinecap="round"
                      className={cn(
                        isActive ? 'stroke-signal-400' : 'stroke-ink-300',
                        'transition-opacity duration-[160ms] motion-reduce:transition-none',
                      )}
                      style={{ opacity: isDimmed ? 0.06 : isActive ? 0.95 : 0.5 }}
                    />
                    {isActive && !reducedMotion && (
                      <line
                        x1={a.x}
                        y1={a.y}
                        x2={b.x}
                        y2={b.y}
                        strokeWidth={2}
                        strokeLinecap="round"
                        className="stroke-signal-300 nl-graph-pulse-line"
                        style={{ '--nl-edge-len': `${len}px` } as React.CSSProperties}
                        aria-hidden="true"
                      />
                    )}
                  </g>
                );
              })}

              {/* Nodes — a filled dot centered ON the layout point, colored by
                  project (workspace scope) or single-accent (project scope),
                  sized by inbound-link authority, dimmed when stale. Hovering
                  or focusing hard-fades everything outside the neighborhood —
                  the "ignite the constellation" signature effect. */}
              {nodes.map((n) => {
                const p = safePositions.get(n.id);
                if (!p) return null;
                const isActive = activeId === n.id;
                const isNeighborActive = !searchActive && activeId !== null && (neighbors.get(activeId)?.has(n.id) ?? false);
                const isSearchMatch = searchActive && searchMatches.has(n.id);
                const isDimmed = searchActive ? !isSearchMatch : activeId !== null && !isActive && !isNeighborActive;
                const stale = isStalePage(n.updatedAt);
                const size = dotSize(n.id);
                const authority = inboundCount.get(n.id) ?? 0;
                const isHub = authority >= HUB_AUTHORITY;

                const dotClass =
                  isActive || isNeighborActive
                    ? isActive
                      ? 'bg-signal-500'
                      : 'bg-signal-400'
                    : scope.kind === 'workspace' && n.projectId
                      ? PROJECT_HUE_CLASSES[projectHue(n.projectId)].dot
                      : 'bg-ink-400';

                const glowVar =
                  isActive || isNeighborActive
                    ? '--nl-signal-500'
                    : scope.kind === 'workspace' && n.projectId
                      ? PROJECT_HUE_CLASSES[projectHue(n.projectId)].var
                      : '--nl-ink-500';

                const boxOpacity = isDimmed ? (stale ? 0.06 : 0.12) : stale ? 0.55 : 1;

                return (
                  <foreignObject
                    key={n.id}
                    x={p.x - NODE_W / 2}
                    y={p.y - NODE_DOT_SLOT / 2}
                    width={NODE_W}
                    height={NODE_H}
                    overflow="visible"
                    className="transition-opacity duration-[160ms] motion-reduce:transition-none"
                    style={{ opacity: boxOpacity }}
                  >
                    <button
                      type="button"
                      ref={(el) => {
                        if (el) nodeButtonRefs.current.set(n.id, el);
                        else nodeButtonRefs.current.delete(n.id);
                      }}
                      data-testid={`page-graph-node-${n.id}`}
                      aria-label={`${n.title}${isSearchMatch ? ' (search match)' : ''} — select for details, Enter to open`}
                      onClick={() => selectNode(n.id)}
                      onFocus={() => selectNode(n.id)}
                      onMouseEnter={() => setHoveredId(n.id)}
                      onMouseLeave={() => setHoveredId((h) => (h === n.id ? null : h))}
                      onKeyDown={(e) => handleNodeKeyDown(e, n)}
                      className="group flex h-full w-full flex-col items-center text-center focus:outline-none"
                    >
                      {/* Fixed-height slot keeps the dot's center pinned to the
                          layout point regardless of dot size. */}
                      <span
                        className="flex shrink-0 items-center justify-center"
                        style={{ height: NODE_DOT_SLOT }}
                        aria-hidden="true"
                      >
                        <span
                          className={cn(
                            'rounded-full transition-[background-color,box-shadow] duration-[120ms] motion-reduce:transition-none',
                            'group-focus-visible:ring-2 group-focus-visible:ring-signal-400 group-focus-visible:ring-offset-2',
                            isSearchMatch && 'ring-2 ring-signal-300 ring-offset-1',
                            dotClass,
                          )}
                          style={{
                            width: size,
                            height: size,
                            boxShadow: isHub
                              ? `0 0 ${Math.round(size * 0.85)}px 1px color-mix(in srgb, var(${glowVar}) 32%, transparent)`
                              : undefined,
                          }}
                        />
                      </span>
                      <span
                        className={cn(
                          'mt-0.5 w-full truncate px-1 text-[10.5px] font-medium leading-tight',
                          isActive ? 'text-signal-700' : 'text-ink-500',
                        )}
                      >
                        {n.title}
                      </span>
                    </button>
                  </foreignObject>
                );
              })}
            </g>
          </svg>
        )}

        {/* Zoom controls — keyboard/screen-reader reachable alternative to wheel/pinch. */}
        <div className="absolute bottom-2 right-2 z-10 flex items-center gap-1 rounded-md border border-ink-200 bg-surface/95 p-1 shadow-xs backdrop-blur-sm">
          <button
            type="button"
            aria-label="Zoom out"
            data-testid="page-graph-zoom-out"
            onClick={() => zoomBy(1 / 1.25)}
            className="flex h-7 w-7 items-center justify-center rounded text-ink-600 hover:bg-ink-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400"
          >
            −
          </button>
          <button
            type="button"
            aria-label="Reset zoom"
            data-testid="page-graph-zoom-reset"
            onClick={resetCamera}
            className="px-1.5 text-xs font-medium text-ink-500 hover:text-ink-800"
          >
            {Math.round(camera.scale * 100)}%
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            data-testid="page-graph-zoom-in"
            onClick={() => zoomBy(1.25)}
            className="flex h-7 w-7 items-center justify-center rounded text-ink-600 hover:bg-ink-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400"
          >
            +
          </button>
        </div>

        {/* Minimap — bottom-left, opposite the zoom controls; only worth the
            chrome once a graph is too big to hold in your head at once. */}
        {nodes.length >= MINIMAP_NODE_THRESHOLD && width > 0 && height > 0 && (
          <div className="absolute bottom-2 left-2 z-10">
            <GraphMinimap
              positions={safePositions}
              width={width}
              height={height}
              camera={camera}
              activeId={activeId}
              onJump={(x, y) => flyTo(x, y)}
            />
          </div>
        )}

        {/* Side rail — the "focus/orbit" companion panel for the selected node. */}
        {selectedNode && (
          <GraphSideRail
            node={selectedNode}
            scope={scope}
            graphNodeIds={graphNodeIds}
            onOpenPage={onOpenPage}
            onSelectNode={selectNode}
            onClose={() => setSelectedId(null)}
          />
        )}
      </>
    );
  }

  return (
    <div data-testid="page-graph-view" className="flex h-full min-h-0 w-full flex-col">
      {/* Its own top control bar — NOT a bordered panel toolbar, the graph's
          full-bleed canvas starts right below this. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-ink-100 bg-surface px-3 py-2 sm:px-4">
        {viewToggle}

        {nodes.length > 0 && (
          <GraphSearch nodes={nodes} onMatchesChange={setSearchMatches} onPick={(id) => selectNode(id)} />
        )}

        {truncated && (
          <p
            data-testid="page-graph-truncated-hint"
            className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700"
          >
            Showing the first {nodes.length} pages — this project has more.
          </p>
        )}

        {scope.kind === 'workspace' && nodes.length > 0 && (
          <div className="sm:ml-auto">
            <GraphLegend nodes={nodes} />
          </div>
        )}
      </div>

      <div ref={containerRef} data-testid="page-graph-canvas" className="relative min-h-0 w-full flex-1 overflow-hidden" style={observatoryStyle}>
        {canvasContent}
      </div>
    </div>
  );
}
