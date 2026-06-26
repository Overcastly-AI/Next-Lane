import { useMemo } from 'react';
import type { BurndownPointDto } from '@next-lane/shared';

/**
 * Hand-rolled responsive SVG line chart: an "ideal" linear guide line and the
 * "actual remaining" line over the sprint window. No chart dependency.
 */
export function BurndownChart({
  series,
  totalCommitted,
}: {
  series: BurndownPointDto[];
  totalCommitted: number;
}) {
  const W = 720;
  const H = 280;
  const padX = 40;
  const padTop = 16;
  const padBottom = 48;
  const plotW = W - padX * 2;
  const plotH = H - padTop - padBottom;

  const max = useMemo(() => {
    const m = Math.max(1, totalCommitted, ...series.map((s) => s.remaining));
    const step = niceStep(m);
    return Math.ceil(m / step) * step;
  }, [series, totalCommitted]);

  const ticks = useMemo(() => {
    const step = niceStep(max);
    const out: number[] = [];
    for (let v = 0; v <= max; v += step) out.push(v);
    return out;
  }, [max]);

  const n = series.length;
  const x = (i: number) =>
    padX + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => padTop + plotH - (v / max) * plotH;

  const idealPath = series
    .map((s, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(s.ideal)}`)
    .join(' ');
  const remainingPath = series
    .map((s, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(s.remaining)}`)
    .join(' ');

  // Show at most ~7 x-axis date labels so they don't overlap on long sprints.
  const labelStep = Math.max(1, Math.ceil(n / 7));

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="Burndown chart: ideal versus actual remaining story points over the sprint"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={padX}
              x2={W - padX}
              y1={y(t)}
              y2={y(t)}
              stroke="#e5e7eb"
              strokeWidth={1}
            />
            <text
              x={padX - 8}
              y={y(t) + 4}
              textAnchor="end"
              className="fill-gray-400"
              fontSize={11}
            >
              {t}
            </text>
          </g>
        ))}

        {/* ideal: dashed guide */}
        <path
          d={idealPath}
          fill="none"
          className="stroke-gray-300"
          strokeWidth={2}
          strokeDasharray="5 5"
        />
        {/* actual remaining */}
        <path
          d={remainingPath}
          fill="none"
          className="stroke-brand-600"
          strokeWidth={2.5}
          strokeLinejoin="round"
        />
        {series.map((s, i) => (
          <circle
            key={s.date}
            cx={x(i)}
            cy={y(s.remaining)}
            r={2.5}
            className="fill-brand-600"
          >
            <title>{`${s.date}: ${s.remaining} remaining`}</title>
          </circle>
        ))}

        {/* x labels */}
        {series.map((s, i) =>
          i % labelStep === 0 || i === n - 1 ? (
            <text
              key={s.date}
              x={x(i)}
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

      <div className="mt-2 flex items-center justify-center gap-4">
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-brand-600" />
          <span className="text-xs text-gray-500">Remaining</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="inline-block h-0 w-4 border-t-2 border-dashed border-gray-300"
            aria-hidden
          />
          <span className="text-xs text-gray-500">Ideal</span>
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

/** "2026-06-26" -> "Jun 26" */
function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
