import { useMemo } from 'react';
import type { FlowPointDto } from '@next-lane/shared';

/**
 * Hand-rolled responsive SVG dual-line chart: created vs completed per day.
 * Matches the CumulativeFlowChart / BurndownChart style — fixed viewBox, no
 * charting library, pure Tailwind token classes for colours.
 */
export function FlowChart({ series }: { series: FlowPointDto[] }) {
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
      ...series.map((s) => Math.max(s.created, s.completed)),
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

  const xOf = (i: number) =>
    padX + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yOf = (v: number) => padTop + plotH - (v / max) * plotH;

  const createdPath = series
    .map((s, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i)} ${yOf(s.created)}`)
    .join(' ');
  const completedPath = series
    .map((s, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i)} ${yOf(s.completed)}`)
    .join(' ');

  // Filled area for completed (below the line)
  const completedArea =
    series.length > 0
      ? `${completedPath} L ${xOf(n - 1)} ${padTop + plotH} L ${xOf(0)} ${padTop + plotH} Z`
      : '';

  const labelStep = Math.max(1, Math.ceil(n / 7));

  // Visually-hidden table for screen readers
  const srSummary =
    series
      .map((s) => `${s.date}: created ${s.created}, completed ${s.completed}`)
      .join('; ') || 'No data';

  return (
    <div className="w-full" data-testid="flow-chart">
      <span className="sr-only" role="note">
        Flow data — {srSummary}
      </span>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="Flow chart: issues created versus completed per day"
      >
        {/* Y-axis grid + labels */}
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

        {/* Completed area fill */}
        {completedArea && (
          <path d={completedArea} className="fill-brand-600" opacity={0.12} />
        )}

        {/* Created line (dashed, ink-400) */}
        <path
          d={createdPath}
          fill="none"
          stroke="#8b95a8"
          strokeWidth={2}
          strokeDasharray="5 3"
          strokeLinejoin="round"
        />

        {/* Completed line (brand-600 solid) */}
        <path
          d={completedPath}
          fill="none"
          className="stroke-brand-600"
          strokeWidth={2.5}
          strokeLinejoin="round"
        />

        {/* Dots on completed */}
        {series.map((s, i) => (
          <circle
            key={s.date}
            cx={xOf(i)}
            cy={yOf(s.completed)}
            r={2.5}
            className="fill-brand-600"
          >
            <title>{`${s.date}: created ${s.created}, completed ${s.completed}`}</title>
          </circle>
        ))}

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
      </svg>

      {/* Legend */}
      <div className="mt-2 flex items-center justify-center gap-4">
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-[2px] w-4 bg-brand-600" />
          <span className="text-xs text-slate-500">Completed</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="inline-block h-0 w-4 border-t-2 border-dashed border-gray-400"
            aria-hidden="true"
          />
          <span className="text-xs text-slate-500">Created</span>
        </div>
      </div>
    </div>
  );
}

function niceStep(max: number): number {
  const rough = max / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(1, rough))));
  const norm = rough / pow;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * pow;
}

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
