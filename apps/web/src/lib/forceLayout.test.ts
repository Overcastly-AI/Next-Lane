import { describe, expect, it } from 'vitest';
import { computeForceLayout, createForceSimulation } from './forceLayout';

const nodeIds = Array.from({ length: 12 }, (_, i) => `n${i}`);
const edges: Array<readonly [string, string]> = [
  ['n0', 'n1'],
  ['n1', 'n2'],
  ['n2', 'n3'],
  ['n0', 'n4'],
  ['n5', 'n6'],
  ['n7', 'n8'],
];
const opts = { width: 800, height: 600 };

describe('createForceSimulation', () => {
  it('running the budget in chunks converges to the exact same layout as one shot', () => {
    const oneShot = computeForceLayout(nodeIds, edges, opts);

    const sim = createForceSimulation(nodeIds, edges, opts);
    // Advance in irregular chunks until settled.
    while (sim.ranIterations < sim.totalIterations) sim.runIterations(7);
    const chunked = sim.positions();

    expect(chunked.size).toBe(oneShot.size);
    for (const [id, p] of oneShot) {
      const c = chunked.get(id)!;
      expect(c.x).toBeCloseTo(p.x, 6);
      expect(c.y).toBeCloseTo(p.y, 6);
    }
  });

  it('is deterministic across runs (stable layout on refetch/reload)', () => {
    const a = computeForceLayout(nodeIds, edges, opts);
    const b = computeForceLayout(nodeIds, edges, opts);
    for (const [id, p] of a) {
      expect(b.get(id)!.x).toBeCloseTo(p.x, 10);
      expect(b.get(id)!.y).toBeCloseTo(p.y, 10);
    }
  });

  it('places positions within the canvas bounds', () => {
    const result = computeForceLayout(nodeIds, edges, opts);
    for (const p of result.values()) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(opts.width);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(opts.height);
    }
  });

  it('handles the single-node and empty cases', () => {
    expect(createForceSimulation([], [], opts).positions().size).toBe(0);
    const one = computeForceLayout(['solo'], [], opts);
    expect(one.get('solo')).toEqual({ x: 400, y: 300 });
  });
});
