import { useMemo } from 'react';
import { SprintState, type RoadmapDto, type RoadmapEpicDto } from '@next-lane/shared';
import { cn } from '@/lib/cn';

/**
 * Hand-rolled responsive timeline (no Gantt dependency). The time axis is laid
 * out in CSS percentages over a derived [min, max] date window; sprints and
 * epics are absolutely-positioned bars within their lanes. A "today" marker line
 * is drawn when today falls inside the window. Epics with no date context are
 * listed in a separate "No dates" lane below. Clicking an epic calls onOpenEpic.
 */
function startOfMonthUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function addMonthsUTC(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}
function monthLabel(d: Date): string {
  return d.toLocaleDateString(undefined, {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

interface Window {
  min: number;
  max: number;
  months: { ts: number; label: string }[];
}

/** Derive the overall window from every dated sprint + dated epic, padded to
 *  whole months, with at least a one-month span so a single point is visible. */
function deriveWindow(data: RoadmapDto): Window | null {
  const stamps: number[] = [];
  for (const s of data.sprints) {
    if (s.startDate) stamps.push(Date.parse(s.startDate));
    if (s.endDate) stamps.push(Date.parse(s.endDate));
  }
  for (const e of data.epics) {
    if (e.start) stamps.push(Date.parse(e.start));
    if (e.end) stamps.push(Date.parse(e.end));
  }
  if (stamps.length === 0) return null;

  let lo = Math.min(...stamps);
  let hi = Math.max(...stamps);
  // Include "today" so the marker is always meaningful when in range-adjacent.
  const now = Date.now();
  lo = Math.min(lo, now);
  hi = Math.max(hi, now);

  let cur = startOfMonthUTC(new Date(lo));
  const end = addMonthsUTC(startOfMonthUTC(new Date(hi)), 1); // exclusive upper
  const months: { ts: number; label: string }[] = [];
  let guard = 0;
  while (cur.getTime() < end.getTime() && guard < 120) {
    months.push({ ts: cur.getTime(), label: monthLabel(cur) });
    cur = addMonthsUTC(cur, 1);
    guard += 1;
  }
  return { min: months[0].ts, max: end.getTime(), months };
}

const SPRINT_COLORS: Record<SprintState, { bar: string; dot: string; label: string }> = {
  [SprintState.PLANNED]: { bar: 'bg-slate-200 text-slate-700', dot: 'bg-gray-400', label: 'Planned' },
  [SprintState.ACTIVE]: { bar: 'bg-brand-500 text-white', dot: 'bg-brand-500', label: 'Active' },
  [SprintState.COMPLETED]: { bar: 'bg-emerald-500 text-white', dot: 'bg-emerald-500', label: 'Completed' },
};

export function RoadmapTimeline({
  data,
  onOpenEpic,
}: {
  data: RoadmapDto;
  onOpenEpic: (epicId: string) => void;
}) {
  const win = useMemo(() => deriveWindow(data), [data]);

  const datedEpics = data.epics.filter((e) => e.start && e.end);
  const noDateEpics = data.epics.filter((e) => !e.start || !e.end);

  // Position helper: clamp a timestamp to [0, 100]% of the window.
  const pct = (ts: number): number => {
    if (!win) return 0;
    const span = win.max - win.min;
    if (span <= 0) return 0;
    return Math.min(100, Math.max(0, ((ts - win.min) / span) * 100));
  };

  const todayPct = win ? pct(Date.now()) : 0;
  const todayInRange = win && Date.now() >= win.min && Date.now() <= win.max;

  return (
    <div className="flex flex-col gap-6">
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4">
        {(Object.keys(SPRINT_COLORS) as SprintState[]).map((st) => (
          <span key={st} className="flex items-center gap-1.5">
            <span className={cn('inline-block h-2.5 w-2.5 rounded-sm', SPRINT_COLORS[st].dot)} />
            <span className="text-xs text-slate-500">{SPRINT_COLORS[st].label} sprint</span>
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-0.5 bg-rose-500" />
          <span className="text-xs text-slate-500">Today</span>
        </span>
      </div>

      {win && (
        <div className="overflow-x-auto">
          <div className="min-w-[640px]">
            {/* Month axis */}
            <div className="relative mb-2 h-6 border-b border-slate-200">
              {win.months.map((m) => (
                <div
                  key={m.ts}
                  className="absolute top-0 flex h-full items-center border-l border-slate-100 pl-1 text-[11px] font-medium text-slate-400"
                  style={{ left: `${pct(m.ts)}%` }}
                >
                  {m.label}
                </div>
              ))}
            </div>

            {/* Lanes container with today marker overlay */}
            <div className="relative">
              {todayInRange && (
                <div
                  className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-rose-500"
                  style={{ left: `${todayPct}%` }}
                  aria-hidden="true"
                />
              )}

              {/* Sprints lane */}
              {data.sprints.length > 0 && (
                <Section title="Sprints">
                  {data.sprints.map((s) => {
                    const sStart = s.startDate ? Date.parse(s.startDate) : null;
                    const sEnd = s.endDate ? Date.parse(s.endDate) : null;
                    const left = pct(sStart ?? sEnd ?? win.min);
                    const right = pct(sEnd ?? sStart ?? win.min);
                    const width = Math.max(1.5, right - left);
                    const colors = SPRINT_COLORS[s.state as SprintState];
                    return (
                      <Lane key={s.id}>
                        <div
                          className={cn(
                            'absolute top-1.5 flex h-7 items-center overflow-hidden rounded-md px-2 text-xs font-medium shadow-sm',
                            colors.bar,
                          )}
                          style={{ left: `${left}%`, width: `${width}%` }}
                          data-testid="roadmap-sprint-bar"
                          title={`${s.name} (${colors.label})`}
                        >
                          <span className="truncate">{s.name}</span>
                        </div>
                      </Lane>
                    );
                  })}
                </Section>
              )}

              {/* Epics lane */}
              {datedEpics.length > 0 && (
                <Section title="Epics">
                  {datedEpics.map((e) => (
                    <EpicRow
                      key={e.id}
                      epic={e}
                      left={pct(Date.parse(e.start as string))}
                      right={pct(Date.parse(e.end as string))}
                      onOpen={() => onOpenEpic(e.id)}
                    />
                  ))}
                </Section>
              )}
            </div>
          </div>
        </div>
      )}

      {/* No-dates lane (rendered outside the time grid) */}
      {noDateEpics.length > 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            No dates
          </p>
          <div className="flex flex-col gap-1.5">
            {noDateEpics.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => onOpenEpic(e.id)}
                data-testid="roadmap-epic-nodate"
                className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-sm hover:border-brand-300 hover:bg-brand-50"
              >
                <span className="flex items-center gap-2">
                  <span className="font-mono text-xs text-slate-400">{e.key}</span>
                  <span className="truncate font-medium text-slate-800">{e.title}</span>
                </span>
                <ProgressBadge epic={e} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-slate-100 py-2 first:border-t-0">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {title}
      </p>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function Lane({ children }: { children: React.ReactNode }) {
  return <div className="relative h-10">{children}</div>;
}

function EpicRow({
  epic,
  left,
  right,
  onOpen,
}: {
  epic: RoadmapEpicDto;
  left: number;
  right: number;
  onOpen: () => void;
}) {
  const width = Math.max(2, right - left);
  const fill = Math.round(epic.progress * 100);
  return (
    <Lane>
      <button
        type="button"
        onClick={onOpen}
        data-testid="roadmap-epic-bar"
        title={`${epic.key} · ${epic.title} — ${epic.doneCount}/${epic.childCount} done`}
        className="group absolute top-1 flex h-8 items-center overflow-hidden rounded-md border border-violet-300 bg-violet-100 text-left shadow-sm transition-colors hover:border-violet-400"
        style={{ left: `${left}%`, width: `${width}%` }}
      >
        {/* progress fill */}
        <span
          className="absolute inset-y-0 left-0 bg-violet-300/70"
          style={{ width: `${fill}%` }}
          aria-hidden="true"
        />
        <span className="relative z-10 flex w-full items-center gap-2 px-2">
          <span className="truncate text-xs font-medium text-violet-900">
            <span className="font-mono text-violet-500">{epic.key}</span> {epic.title}
          </span>
          <span className="ml-auto shrink-0 text-[10px] font-semibold text-violet-700">
            {fill}%
          </span>
        </span>
      </button>
    </Lane>
  );
}

function ProgressBadge({ epic }: { epic: RoadmapEpicDto }) {
  const fill = Math.round(epic.progress * 100);
  return (
    <span className="shrink-0 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
      {epic.doneCount}/{epic.childCount} · {fill}%
    </span>
  );
}
