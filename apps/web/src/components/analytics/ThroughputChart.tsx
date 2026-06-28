import { useMemo } from 'react';
import type { FlowPointDto } from '@next-lane/shared';

/**
 * Hand-rolled SVG area chart showing completed issues per day (throughput),
 * with created as a secondary dashed line. Used on the personal analytics page.
 * Same visual style as the FlowChart but branded as "throughput."
 */
export function ThroughputChart({ series }: { series: FlowPointDto[] }) {
  const W = 720;
  const H = 240;
  const padX = 40;
  const padTop = 12;
  const padBottom = 44;
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
  const baseline = padTop + plotH;

  const completedLine = series
    .map((s, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i)} ${yOf(s.completed)}`)
    .join(' ');
  const completedArea =
    n > 0
      ? `${completedLine} L ${xOf(n - 1)} ${baseline} L ${xOf(0)} ${baseline} Z`
      : '';
  const createdLine = series
    .map((s, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i)} ${yOf(s.created)}`)
    .join(' ');

  const labelStep = Math.max(1, Math.ceil(n / 7));

  const srSummary =
    series
      .map((s) => `${s.date}: completed ${s.completed}`)
      .join('; ') || 'No data';

  return (
    <div className="w-full" data-testid="throughput-chart">
      <span className="sr-only" role="note">
        Throughput — {srSummary}
      </span>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="Throughput chart: issues completed per day"
      >
        {/* Grid + Y labels */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={padX}
              x2={W - padX}
              y1={yOf(t)}
              y2={yOf(t)}
              className="stroke-ink-200"
              strokeWidth={1}
            />
            <text
              x={padX - 6}
              y={yOf(t) + 4}
              textAnchor="end"
              className="fill-ink-400"
              fontSize={10}
            >
              {t}
            </text>
          </g>
        ))}

        {/* Completed area */}
        {completedArea && (
          <path d={completedArea} className="fill-brand-600" opacity={0.15} />
        )}

        {/* Created dashed (ink-400 = #8b95a8) */}
        {createdLine && (
          <path
            d={createdLine}
            fill="none"
            className="stroke-ink-400"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            strokeLinejoin="round"
          />
        )}

        {/* Completed solid */}
        {completedLine && (
          <path
            d={completedLine}
            fill="none"
            className="stroke-brand-600"
            strokeWidth={2}
            strokeLinejoin="round"
          />
        )}

        {/* Dots */}
        {series.map((s, i) => (
          <circle
            key={s.date}
            cx={xOf(i)}
            cy={yOf(s.completed)}
            r={2}
            className="fill-brand-600"
          >
            <title>{`${s.date}: completed ${s.completed}, created ${s.created}`}</title>
          </circle>
        ))}

        {/* X-axis labels */}
        {series.map((s, i) =>
          i % labelStep === 0 || i === n - 1 ? (
            <text
              key={s.date}
              x={xOf(i)}
              y={H - padBottom + 16}
              textAnchor="middle"
              className="fill-ink-600"
              fontSize={10}
            >
              {shortDate(s.date)}
            </text>
          ) : null,
        )}
      </svg>

      <div className="mt-1.5 flex items-center justify-center gap-4">
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-[2px] w-4 bg-brand-600" />
          <span className="text-xs text-ink-500">Completed</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="inline-block h-0 w-4 border-t-2 border-dashed border-ink-400"
            aria-hidden="true"
          />
          <span className="text-xs text-ink-500">Created</span>
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
