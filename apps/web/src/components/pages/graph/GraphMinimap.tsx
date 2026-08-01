/**
 * GraphMinimap — corner overview for graphs too big to hold in your head at
 * once (Obsidian has no equivalent — you just get lost). Renders every node
 * as a speck at 1/10th scale, draws the current camera viewport as a
 * rectangle, and lets you click anywhere to jump the main canvas there.
 */
import type { Point } from '@/lib/forceLayout';

export interface GraphMinimapProps {
  positions: Map<string, Point>;
  /**
   * The WORLD pixel dimensions the positions are laid out within. For a dense
   * graph the world is deliberately larger than the visible canvas (the
   * layout needs room to spread), so this is NOT the same as the viewport —
   * which is exactly why the minimap exists.
   */
  width: number;
  height: number;
  /**
   * The VIEWPORT (visible canvas) pixel dimensions. The camera transform is
   * anchored on the viewport's centre, so the "what you can currently see"
   * rectangle has to be derived from these, not from the world size.
   */
  viewportWidth: number;
  viewportHeight: number;
  camera: { x: number; y: number; scale: number };
  activeId: string | null;
  onJump: (worldX: number, worldY: number) => void;
}

const MAX_W = 132;
const MAX_H = 96;

export function GraphMinimap({
  positions,
  width,
  height,
  viewportWidth,
  viewportHeight,
  camera,
  activeId,
  onJump,
}: GraphMinimapProps) {
  if (width <= 0 || height <= 0 || viewportWidth <= 0 || viewportHeight <= 0) return null;
  const aspect = width / height;
  let mmW = MAX_W;
  let mmH = Math.round(MAX_W / aspect);
  if (mmH > MAX_H) {
    mmH = MAX_H;
    mmW = Math.round(MAX_H * aspect);
  }
  const scale = mmW / width;

  // Invert the canvas camera transform to get the world coordinates of the
  // viewport's two corners. The transform pivots on the VIEWPORT centre
  // (see `groupTransform` in KnowledgeGraphView), so that is the centre used
  // here — mixing in the world centre would skew the rectangle whenever the
  // world is bigger than the canvas.
  const cx = viewportWidth / 2;
  const cy = viewportHeight / 2;
  const topLeft = {
    x: (0 - camera.x - cx) / camera.scale + cx,
    y: (0 - camera.y - cy) / camera.scale + cy,
  };
  const bottomRight = {
    x: (viewportWidth - camera.x - cx) / camera.scale + cx,
    y: (viewportHeight - camera.y - cy) / camera.scale + cy,
  };
  const rect = {
    x: topLeft.x * scale,
    y: topLeft.y * scale,
    w: (bottomRight.x - topLeft.x) * scale,
    h: (bottomRight.y - topLeft.y) * scale,
  };

  function handleClick(e: React.MouseEvent<SVGSVGElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left;
    const py = e.clientY - box.top;
    onJump(px / scale, py / scale);
  }

  return (
    <div
      data-testid="page-graph-minimap"
      aria-label="Graph overview — click to jump"
      className="overflow-hidden rounded-md border border-ink-200 bg-surface/90 shadow-sm backdrop-blur-sm"
      style={{ width: mmW, height: mmH }}
    >
      <svg
        width={mmW}
        height={mmH}
        viewBox={`0 0 ${mmW} ${mmH}`}
        onClick={handleClick}
        role="button"
        aria-label="Jump to this part of the graph"
        tabIndex={0}
        data-testid="page-graph-minimap-canvas"
        className="cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal-400"
        onKeyDown={(e) => {
          // Keyboard equivalent of a click: jump to the minimap's center.
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onJump(width / 2, height / 2);
          }
        }}
      >
        <rect x={0} y={0} width={mmW} height={mmH} className="fill-canvas" />
        {Array.from(positions.entries()).map(([id, p]) => (
          <circle
            key={id}
            cx={p.x * scale}
            cy={p.y * scale}
            r={id === activeId ? 2.25 : 1.4}
            className={id === activeId ? 'fill-signal-500' : 'fill-ink-400'}
          />
        ))}
        <rect
          data-testid="page-graph-minimap-viewport"
          x={rect.x}
          y={rect.y}
          width={Math.max(2, rect.w)}
          height={Math.max(2, rect.h)}
          className="fill-signal-500/10 stroke-signal-500"
          strokeWidth={1}
        />
      </svg>
    </div>
  );
}
