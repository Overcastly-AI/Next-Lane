import { useMemo } from 'react';
import type { CfdPointDto } from '@next-lane/shared';

/**
 * Hand-rolled responsive SVG stacked-area chart: three bands for TODO (gray),
 * IN_PROGRESS (brand-200/amber), and DONE (brand-600/green) issue counts per
 * day. No chart dependency — uses a fixed viewBox that stretches responsively.
 * Kept presentational; the page handles loading/empty/error states.
 */
export function CumulativeFlowChart({ series }: { series: CfdPointDto[] }) {
  const W = 720;
  const H = 280;
  const padX = 44;
  const padTop = 16;
  const padBottom = 48;
  const plotW = W - padX * 2;
  const plotH = H - padTop - padBottom;

  const n = series.length;

  const max = useMemo(() => {
    const m = Math.max(
      1,
      ...series.map((s) => s.todo + s.inProgress + s.done),
    );
    const step = niceStep(m);
    return Math.ceil(m / step) * step;
  }, [series]);

  const ticks = useMemo(() => {
    const step = niceStep(max);
    const out: number[] = [];
    for (let v = 0; v <= max; v += step) out.push(v);
    return out;
  }, [max]);

  /** X coordinate for data-point index i. */
  const xOf = (i: number) =>
    padX + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);

  /** Y coordinate for value v (note: SVG y-axis is inverted). */
  const yOf = (v: number) => padTop + plotH - (v / max) * plotH;

  // Build stacked values: bottom = 0, then todo, then +inProgress, then +done.
  // The filled area for each band is drawn as a closed polygon between its
  // top edge and the top of the band below it (or the x-axis for the lowest).
  interface StackPoint {
    x: number;
    yTodo: number;
    yInProgress: number;
    yDone: number;
  }
  const stack: StackPoint[] = series.map((s, i) => ({
    x: xOf(i),
    yTodo: yOf(s.todo + s.inProgress + s.done),
    yInProgress: yOf(s.inProgress + s.done),
    yDone: yOf(s.done),
  }));

  const baseline = padTop + plotH; // y-value of x-axis

  /**
   * Build a closed SVG path for a filled band between `topY[]` and `bottomY[]`.
   * We go left-to-right along the top edge then right-to-left along the bottom.
   */
  function bandPath(
    topY: (pt: StackPoint) => number,
    bottomY: (pt: StackPoint) => number,
  ): string {
    if (stack.length === 0) return '';
    const top = stack.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x} ${topY(pt)}`).join(' ');
    const bot = [...stack]
      .reverse()
      .map((pt) => `L ${pt.x} ${bottomY(pt)}`)
      .join(' ');
    return `${top} ${bot} Z`;
  }

  // x-axis label step (at most ~7 visible labels).
  const labelStep = Math.max(1, Math.ceil(n / 7));

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="Cumulative flow diagram: issue counts per status category over time"
      >
        {/* Y-axis grid lines + labels */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={padX}
              x2={W - padX}
              y1={yOf(t)}
              y2={yOf(t)}
              stroke="#e5e7eb"
              strokeWidth={1}
            />
            <text
              x={padX - 8}
              y={yOf(t) + 4}
              textAnchor="end"
              className="fill-gray-400"
              fontSize={11}
            >
              {t}
            </text>
          </g>
        ))}

        {/* TODO band (top — gray-200) */}
        <path
          d={bandPath(
            (pt) => pt.yTodo,
            (pt) => pt.yInProgress,
          )}
          className="fill-gray-200"
          opacity={0.85}
        />

        {/* IN_PROGRESS band (middle — amber/brand-200) */}
        <path
          d={bandPath(
            (pt) => pt.yInProgress,
            (pt) => pt.yDone,
          )}
          className="fill-brand-200"
          opacity={0.85}
        />

        {/* DONE band (bottom — brand-600 / green) */}
        <path
          d={bandPath(
            (pt) => pt.yDone,
            () => baseline,
          )}
          className="fill-brand-600"
          opacity={0.85}
        />

        {/* Stroke lines on top of each band boundary for crispness */}
        <polyline
          points={stack.map((pt) => `${pt.x},${pt.yTodo}`).join(' ')}
          fill="none"
          stroke="#d1d5db"
          strokeWidth={1.5}
        />
        <polyline
          points={stack.map((pt) => `${pt.x},${pt.yInProgress}`).join(' ')}
          fill="none"
          className="stroke-brand-300"
          strokeWidth={1.5}
        />
        <polyline
          points={stack.map((pt) => `${pt.x},${pt.yDone}`).join(' ')}
          fill="none"
          className="stroke-brand-700"
          strokeWidth={1.5}
        />

        {/* X-axis date labels */}
        {series.map((s, i) =>
          i % labelStep === 0 || i === n - 1 ? (
            <text
              key={s.date}
              x={xOf(i)}
              y={H - padBottom + 18}
              textAnchor="middle"
              className="fill-gray-600"
              fontSize={10}
            >
              {shortDate(s.date)}
            </text>
          ) : null,
        )}

        {/* Invisible tooltip overlay circles (one per day at the total stack height) */}
        {series.map((s, i) => (
          <circle
            key={s.date}
            cx={xOf(i)}
            cy={stack[i].yTodo}
            r={4}
            fill="transparent"
            stroke="transparent"
          >
            <title>{`${s.date}: To Do ${s.todo} · In Progress ${s.inProgress} · Done ${s.done}`}</title>
          </circle>
        ))}
      </svg>

      {/* Legend */}
      <div className="mt-2 flex items-center justify-center gap-4">
        <LegendSwatch color="bg-brand-600" label="Done" />
        <LegendSwatch color="bg-brand-200" label="In Progress" />
        <LegendSwatch color="bg-gray-200" label="To Do" />
      </div>
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`inline-block h-2.5 w-2.5 rounded-sm ${color}`} />
      <span className="text-xs text-gray-500">{label}</span>
    </div>
  );
}

/** A "nice" gridline step (1/2/5 * 10^n) given a max value. */
function niceStep(max: number): number {
  const rough = max / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(1, rough))));
  const norm = rough / pow;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * pow;
}

/** "2026-06-26" -> "Jun 26" */
function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
