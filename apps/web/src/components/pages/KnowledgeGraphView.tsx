/**
 * KnowledgeGraphView — the Obsidian-style force-directed graph of a
 * project's pages (nodes) and `[[wiki-link]]` references (edges).
 *
 * Deliberately hand-rolled on plain SVG (`createForceSimulation`,
 * `src/lib/forceLayout.ts`) instead of a graph library (d3-force/cytoscape/
 * sigma/...) — self-hosted-friendly, zero extra runtime dependency, and the
 * production nginx CSP is `script-src 'self'` (no external script/CDN).
 *
 * Interaction:
 *  - Pan: drag (mouse or touch) on the canvas background.
 *  - Zoom: mouse wheel, pinch (two-finger touch), or the +/−/Reset buttons
 *    (keyboard/screen-reader reachable — wheel/pinch alone wouldn't be).
 *  - Hover/focus a node: dims everything except that node and its direct
 *    neighbors, so a dense graph's local structure is readable at a glance.
 *  - Click/Enter a node: opens that page.
 *
 * The SVG's `viewBox` is sized to the container's ACTUAL measured pixel
 * dimensions (not a fixed large "world" that gets shrunk to fit) — so node
 * labels render at a legible, constant pixel size on mobile too, instead of
 * scaling down with a narrower viewport. The layout itself is recomputed to
 * fit whatever canvas size is available; users pan/zoom to explore a graph
 * too dense for the visible area.
 *
 * `prefers-reduced-motion`: the settle-in animation is skipped — the layout
 * still runs to full convergence (chunked across frames so it never blocks
 * the main thread on a large graph) but only the final, settled frame is
 * published, so the user sees no incremental motion.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createForceSimulation, type Point } from '@/lib/forceLayout';
import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { usePageGraph } from '@/api/pages';
import { cn } from '@/lib/cn';

const MIN_SCALE = 0.35;
const MAX_SCALE = 3;
const TOTAL_ITERATIONS = 220;
const ANIMATE_NODE_CAP = 150; // above this, skip incremental frames even with motion allowed

export interface KnowledgeGraphViewProps {
  projectId: string;
  onOpenPage: (pageId: string) => void;
}

/**
 * Measures a container's actual pixel size, re-measuring on resize.
 *
 * Uses a CALLBACK ref (not a plain `useRef` + effect keyed on that ref
 * object) deliberately: this component's container only mounts once the
 * graph finishes loading (it's behind `isLoading`/`isError`/empty early
 * returns), and a `useRef` object's IDENTITY never changes even once
 * `.current` goes from `null` to the real node — so an effect keyed on
 * `[ref]` would run exactly once, while the container is still unmounted,
 * see `.current` as `null`, and never re-run once the node actually
 * appears. A callback ref stores the node itself in state, so its
 * attachment is a real dependency change that re-triggers measurement.
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

export function KnowledgeGraphView({ projectId, onOpenPage }: KnowledgeGraphViewProps) {
  const graphQuery = usePageGraph(projectId);
  const [containerRef, { width, height }] = useContainerSize<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const reducedMotion = usePrefersReducedMotion();

  const nodes = useMemo(() => graphQuery.data?.nodes ?? [], [graphQuery.data]);
  const edges = useMemo(() => graphQuery.data?.edges ?? [], [graphQuery.data]);
  const truncated = graphQuery.data?.truncated ?? false;

  const [positions, setPositions] = useState<Map<string, Point>>(new Map());
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [camera, setCamera] = useState({ x: 0, y: 0, scale: 1 });

  // Adjacency, for hover-neighbor highlighting.
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

  // Compute (and, when motion is allowed, animate) the force layout whenever
  // the graph data or the available canvas size changes. The simulation runs
  // in per-frame chunks off a single stateful stepper so a large graph's
  // O(n²) budget never blocks the main thread in one long call — whether we
  // publish intermediate frames (motion, small graph) or only the settled
  // result (reduced motion, or a big graph) it stays responsive throughout.
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
    });
    const animate = !reducedMotion && nodes.length <= ANIMATE_NODE_CAP;
    // Small graphs animate in fine steps; large/reduced-motion graphs take
    // bigger chunks (no motion shown) — either way each frame's slice of
    // O(n²) work stays short enough to keep the thread responsive.
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
      // When animating, publish every frame so the graph visibly settles;
      // otherwise publish only the final, converged frame (no motion).
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
    // array literals on every render and would re-trigger this effect (and
    // restart the settle animation) on every unrelated re-render.
  }, [graphQuery.data, width, height, reducedMotion]);

  // Reset the camera whenever a fresh graph is loaded (new project, or the
  // node set materially changed) so the user isn't left panned off-canvas.
  useEffect(() => {
    setCamera({ x: 0, y: 0, scale: 1 });
  }, [projectId]);

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
    const delta = -e.deltaY * 0.0015;
    setCamera((c) => ({ ...c, scale: clamp(c.scale * (1 + delta), MIN_SCALE, MAX_SCALE) }));
  }
  function zoomBy(factor: number) {
    setCamera((c) => ({ ...c, scale: clamp(c.scale * factor, MIN_SCALE, MAX_SCALE) }));
  }
  function resetCamera() {
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
    e.preventDefault();
  }

  const cx = width / 2;
  const cy = height / 2;
  const groupTransform = `translate(${camera.x} ${camera.y}) translate(${cx} ${cy}) scale(${camera.scale}) translate(${-cx} ${-cy})`;

  if (graphQuery.isLoading) return <LoadingState label="Loading knowledge graph…" />;
  if (graphQuery.isError) {
    return <ErrorState error={graphQuery.error} onRetry={() => graphQuery.refetch()} />;
  }
  if (nodes.length === 0) {
    return (
      <EmptyState
        title="Nothing to graph yet"
        description="Create a few pages and link them with [[wiki-links]] to see the knowledge graph."
      />
    );
  }

  return (
    <div className="flex flex-col gap-2" data-testid="page-graph-view">
      {truncated && (
        <p
          data-testid="page-graph-truncated-hint"
          className="inline-flex w-fit items-center gap-1.5 self-start rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700"
        >
          Showing the first {nodes.length} pages — this project has more.
        </p>
      )}

      <div
        ref={containerRef}
        className={cn(
          'relative h-[420px] w-full overflow-hidden rounded-xl border border-ink-200 bg-ink-50 sm:h-[560px]',
        )}
        style={{
          backgroundImage: 'radial-gradient(circle, var(--nl-ink-200) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
        }}
      >
        {width > 0 && height > 0 && (
          <svg
            ref={svgRef}
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
            <defs>
              <marker id="pg-arrow" markerWidth={7} markerHeight={7} refX={6} refY={3.5} orient="auto" markerUnits="strokeWidth">
                <path d="M0,0 L7,3.5 L0,7 z" className="fill-ink-300" />
              </marker>
              <marker id="pg-arrow-active" markerWidth={7} markerHeight={7} refX={6} refY={3.5} orient="auto" markerUnits="strokeWidth">
                <path d="M0,0 L7,3.5 L0,7 z" className="fill-signal-500" />
              </marker>
            </defs>

            <g transform={groupTransform}>
              {/* Edges */}
              {edges.map((e, i) => {
                const a = positions.get(e.sourceId);
                const b = positions.get(e.targetId);
                if (!a || !b) return null;
                const isActive = hoveredId !== null && (e.sourceId === hoveredId || e.targetId === hoveredId);
                const isDimmed = hoveredId !== null && !isActive;
                return (
                  <line
                    key={`${e.sourceId}-${e.targetId}-${i}`}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    strokeWidth={isActive ? 2 : 1.25}
                    className={isActive ? 'stroke-signal-500' : 'stroke-ink-300'}
                    style={{ opacity: isDimmed ? 0.15 : 1 }}
                    markerEnd={`url(#${isActive ? 'pg-arrow-active' : 'pg-arrow'})`}
                  />
                );
              })}

              {/* Nodes */}
              {nodes.map((n) => {
                const p = positions.get(n.id);
                if (!p) return null;
                const isHovered = hoveredId === n.id;
                const isNeighbor = hoveredId !== null && (neighbors.get(hoveredId)?.has(n.id) ?? false);
                const isDimmed = hoveredId !== null && !isHovered && !isNeighbor;
                const w = 132;
                const h = 40;
                return (
                  <foreignObject
                    key={n.id}
                    x={p.x - w / 2}
                    y={p.y - h / 2}
                    width={w}
                    height={h}
                    overflow="visible"
                    style={{ opacity: isDimmed ? 0.25 : 1 }}
                  >
                    <button
                      type="button"
                      data-testid={`page-graph-node-${n.id}`}
                      aria-label={`Open page ${n.title}`}
                      onClick={() => onOpenPage(n.id)}
                      onMouseEnter={() => setHoveredId(n.id)}
                      onMouseLeave={() => setHoveredId((h2) => (h2 === n.id ? null : h2))}
                      onFocus={() => setHoveredId(n.id)}
                      onBlur={() => setHoveredId((h2) => (h2 === n.id ? null : h2))}
                      className={cn(
                        'flex h-full w-full items-center gap-1.5 rounded-full border px-3 py-1.5 text-left shadow-xs',
                        'transition-colors duration-[120ms] motion-reduce:transition-none',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400',
                        isHovered
                          ? 'border-signal-400 bg-signal-50 text-signal-800'
                          : 'border-ink-200 bg-surface text-ink-700 hover:border-signal-300 hover:bg-signal-50/60',
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn('h-1.5 w-1.5 shrink-0 rounded-full', isHovered ? 'bg-signal-500' : 'bg-ink-300')}
                      />
                      <span className="min-w-0 truncate text-xs font-medium leading-tight">{n.title}</span>
                    </button>
                  </foreignObject>
                );
              })}
            </g>
          </svg>
        )}

        {/* Zoom controls — keyboard/screen-reader reachable alternative to wheel/pinch. */}
        <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded-md border border-ink-200 bg-surface/95 p-1 shadow-xs backdrop-blur-sm">
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
      </div>
    </div>
  );
}
