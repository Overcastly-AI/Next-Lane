import { useMemo } from 'react';
import type { VelocityPointDto } from '@next-lane/shared';

/**
 * Hand-rolled responsive SVG grouped bar chart: per sprint, a "committed" bar
 * and a "completed" bar. No chart dependency — scales to the container width via
 * a viewBox. Kept presentational; the page handles loading/empty states.
 */
export function VelocityChart({ data }: { data: VelocityPointDto[] }) {
  // Fixed viewBox; the SVG stretches responsively via width=100%.
  const W = 720;
  const H = 280;
  const padX = 40;
  const padTop = 16;
  const padBottom = 48;
  const plotW = W - padX * 2;
  const plotH = H - padTop - padBottom;

  const max = useMemo(() => {
    const m = Math.max(
      1,
      ...data.map((d) => Math.max(d.committed, d.completed)),
    );
    // Round up to a "nice" axis top.
    const step = niceStep(m);
    return Math.ceil(m / step) * step;
  }, [data]);

  const ticks = useMemo(() => {
    const step = niceStep(max);
    const out: number[] = [];
    for (let v = 0; v <= max; v += step) out.push(v);
    return out;
  }, [max]);

  const groupW = plotW / Math.max(1, data.length);
  const barW = Math.min(36, (groupW - 16) / 2);
  const y = (v: number) => padTop + plotH - (v / max) * plotH;

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="Velocity chart: committed versus completed story points per sprint"
      >
        {/* gridlines + y labels */}
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

        {/* bars */}
        {data.map((d, i) => {
          const gx = padX + i * groupW + groupW / 2;
          const committedX = gx - barW - 3;
          const completedX = gx + 3;
          return (
            <g key={d.sprintId}>
              <rect
                x={committedX}
                y={y(d.committed)}
                width={barW}
                height={Math.max(0, padTop + plotH - y(d.committed))}
                rx={3}
                className="fill-brand-200"
              >
                <title>{`${d.sprintName} — committed ${d.committed}`}</title>
              </rect>
              <rect
                x={completedX}
                y={y(d.completed)}
                width={barW}
                height={Math.max(0, padTop + plotH - y(d.completed))}
                rx={3}
                className="fill-brand-600"
              >
                <title>{`${d.sprintName} — completed ${d.completed}`}</title>
              </rect>
              <text
                x={gx}
                y={H - padBottom + 18}
                textAnchor="middle"
                className="fill-gray-600"
                fontSize={11}
              >
                {truncate(d.sprintName, 14)}
              </text>
            </g>
          );
        })}
      </svg>

      <Legend
        items={[
          { color: 'bg-brand-200', label: 'Committed' },
          { color: 'bg-brand-600', label: 'Completed' },
        ]}
      />
    </div>
  );
}

function Legend({
  items,
}: {
  items: { color: string; label: string }[];
}) {
  return (
    <div className="mt-2 flex items-center justify-center gap-4">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-1.5">
          <span className={`inline-block h-2.5 w-2.5 rounded-sm ${it.color}`} />
          <span className="text-xs text-gray-500">{it.label}</span>
        </div>
      ))}
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

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
