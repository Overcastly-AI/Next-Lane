/**
 * A small, self-contained force-directed graph layout — hand-rolled instead
 * of pulling in d3-force / cytoscape / sigma / etc so the Pages knowledge
 * graph has ZERO runtime dependency on an external script/CDN (the prod
 * nginx CSP is `script-src 'self'`) and adds a couple KB to the bundle
 * instead of a whole layout library. Pure functions, no DOM/canvas access —
 * `KnowledgeGraphView` renders the result as SVG.
 *
 * Algorithm: classic spring-electrical model — pairwise repulsion (Coulomb),
 * spring attraction along edges (Hooke), a weak centering force, velocity
 * damping, and linear cooling over the iteration budget so the layout
 * converges instead of jittering forever.
 */

export interface Point {
  x: number;
  y: number;
}

export interface ForceLayoutOptions {
  width: number;
  height: number;
  /** Simulation steps to run. More = better-settled layout, more CPU. */
  iterations?: number;
}

/**
 * A resumable force simulation. `runIterations(n)` advances the shared node
 * state by `n` steps (carrying velocity/position forward), and `positions()`
 * snapshots the current layout. This lets `KnowledgeGraphView` spread a large
 * graph's iteration budget across animation frames — a few steps per frame —
 * instead of one long blocking `computeForceLayout` call that janks the main
 * thread (the O(n²) repulsion at ~1000 nodes is ~280ms in one shot). Because
 * state carries forward, running the budget in chunks converges to the exact
 * same layout as running it all at once.
 */
export interface ForceSimulation {
  /** Total steps this simulation will run before it's fully settled. */
  readonly totalIterations: number;
  /** Steps already run. */
  readonly ranIterations: number;
  /** Advance the simulation by up to `count` more steps (clamped to remaining). */
  runIterations(count: number): void;
  /** Snapshot the current node positions, clamped within the canvas. */
  positions(): Map<string, Point>;
}

/** Deterministic 32-bit string hash (FNV-1a) so each node's seed position is
 * stable across re-renders/reloads of the SAME graph (no visual "jump" on
 * refetch, and reproducible layouts for e2e). */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Compute a force-directed layout for `nodeIds` connected by `edges`
 * (pairs of node ids; unknown ids in an edge are ignored). Synchronous —
 * runs the full iteration budget in one call and returns final positions,
 * clamped within `[0, width] x [0, height]`.
 *
 * Deterministic for a given (nodeIds, edges, options): calling it again with
 * a LARGER `iterations` budget re-runs from the same seeded start and
 * produces the next-more-settled frame, which is what powers the
 * motion-safe "settle in" animation (see `useGraphLayout`) — and lets the
 * `prefers-reduced-motion` path just call it once with the full budget and
 * render only the final frame.
 */
export function computeForceLayout(
  nodeIds: string[],
  edges: Array<readonly [string, string]>,
  options: ForceLayoutOptions,
): Map<string, Point> {
  const sim = createForceSimulation(nodeIds, edges, options);
  sim.runIterations(sim.totalIterations);
  return sim.positions();
}

/**
 * Build a resumable force simulation (see `ForceSimulation`). The full
 * iteration budget produces the same layout whether you run it in one
 * `runIterations(total)` call (what `computeForceLayout` does) or in chunks
 * across frames (what the graph view does for large graphs to stay smooth).
 */
export function createForceSimulation(
  nodeIds: string[],
  edges: Array<readonly [string, string]>,
  { width, height, iterations = 220 }: ForceLayoutOptions,
): ForceSimulation {
  const n = nodeIds.length;

  // Degenerate cases: nothing to simulate — fixed positions, zero iterations.
  if (n === 0 || width <= 0 || height <= 0) {
    return { totalIterations: 0, ranIterations: 0, runIterations() {}, positions: () => new Map() };
  }
  if (n === 1) {
    const only = new Map([[nodeIds[0], { x: width / 2, y: height / 2 }]]);
    return {
      totalIterations: 0,
      ranIterations: 0,
      runIterations() {},
      positions: () => new Map(only),
    };
  }

  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.max(20, Math.min(width, height) * 0.35);

  interface SimNode {
    id: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
  }

  const nodes: SimNode[] = nodeIds.map((id) => {
    // Deterministic seed position: spread around a circle, angle/radius
    // derived from a hash of the id (stable regardless of array order).
    const h = hashString(id);
    const angle = ((h % 3600) / 3600) * Math.PI * 2;
    const r = radius * (0.4 + ((h >>> 8) % 100) / 166); // ~0.4..1.0 * radius
    return { id, x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r, vx: 0, vy: 0 };
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));

  // Ideal spring length shrinks as the graph gets denser so it doesn't
  // sprawl past the canvas.
  const idealLength = Math.max(36, Math.min(width, height) / Math.max(4, Math.sqrt(n)));
  const repulsion = idealLength * idealLength * 6;

  // O(n^2) repulsion is fine at realistic sizes; for very large graphs
  // (approaching the API's MAX_GRAPH_NODES truncation cap) spend fewer
  // iterations rather than adding spatial partitioning.
  const totalIterations = n > 300 ? Math.min(iterations, 60) : iterations;
  const margin = Math.min(30, Math.min(width, height) / 6);
  let ran = 0;

  function stepOnce(iter: number): void {
    const temp = 1 - iter / totalIterations; // linear cooling, 1 -> 0

    // Repulsion — every pair pushes apart.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let distSq = dx * dx + dy * dy;
        if (distSq < 0.01) {
          // Deterministically nudge apart exactly-coincident points.
          dx = 0.1;
          dy = 0.1;
          distSq = 0.02;
        }
        const dist = Math.sqrt(distSq);
        const force = repulsion / distSq;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
    }

    // Attraction — edges act as springs toward `idealLength`.
    for (const [sourceId, targetId] of edges) {
      const a = byId.get(sourceId);
      const b = byId.get(targetId);
      if (!a || !b || a === b) continue;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dist = Math.max(0.01, Math.sqrt(dx * dx + dy * dy));
      const force = (dist - idealLength) * 0.02;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx -= fx;
      a.vy -= fy;
      b.vx += fx;
      b.vy += fy;
    }

    // Weak centering force keeps isolated/disconnected clusters from
    // drifting off-canvas; integrate velocity with cooling + damping.
    for (const node of nodes) {
      node.vx += (cx - node.x) * 0.002;
      node.vy += (cy - node.y) * 0.002;

      const maxStep = 12 * Math.max(temp, 0.05);
      const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy) || 1;
      const scale = Math.min(1, maxStep / speed);
      node.x += node.vx * scale;
      node.y += node.vy * scale;
      node.vx *= 0.85;
      node.vy *= 0.85;

      node.x = Math.min(width - margin, Math.max(margin, node.x));
      node.y = Math.min(height - margin, Math.max(margin, node.y));
    }
  }

  return {
    totalIterations,
    get ranIterations() {
      return ran;
    },
    runIterations(count: number) {
      const end = Math.min(totalIterations, ran + Math.max(0, count));
      for (; ran < end; ran++) stepOnce(ran);
    },
    positions() {
      const result = new Map<string, Point>();
      for (const node of nodes) result.set(node.id, { x: node.x, y: node.y });
      return result;
    },
  };
}
