import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ProjectDto } from '@next-lane/shared';
import { useProjectIssues } from '@/api/issues';
import { useWorkspaceMembers } from '@/api/workspaces';
import { useCommandPalette } from '@/components/CommandPaletteProvider';
import { isSampleProject } from '@/lib/sampleProject';
import { cn } from '@/lib/cn';

interface Stored {
  dismissed?: boolean;
  palette?: boolean;
  agent?: boolean;
}

const keyFor = (workspaceId: string) => `nl_getting_started:${workspaceId}`;

function load(workspaceId: string): Stored {
  try {
    const raw = localStorage.getItem(keyFor(workspaceId));
    return raw ? (JSON.parse(raw) as Stored) : {};
  } catch {
    return {};
  }
}

function save(workspaceId: string, value: Stored): void {
  try {
    localStorage.setItem(keyFor(workspaceId), JSON.stringify(value));
  } catch {
    /* storage unavailable: state stays in memory for this session */
  }
}

interface Item {
  id: string;
  label: string;
  hint: string;
  done: boolean;
  to?: string;
  onActivate?: () => void;
  cta: string;
}

/**
 * "Getting started" checklist on the dashboard. Completion is derived from
 * real data where cheap (projects, issues, members) and from localStorage for
 * the two steps that leave no server trace (opening the palette, visiting the
 * agent surface). Dismissible; hides itself once everything is done.
 */
export function GettingStartedCard({
  workspaceId,
  projects,
}: {
  workspaceId: string;
  projects: ProjectDto[];
}) {
  const [stored, setStored] = useState<Stored>(() => load(workspaceId));
  useEffect(() => setStored(load(workspaceId)), [workspaceId]);

  const update = useCallback(
    (patch: Stored) =>
      setStored((prev) => {
        const next = { ...prev, ...patch };
        save(workspaceId, next);
        return next;
      }),
    [workspaceId],
  );

  const real = projects.filter((p) => !isSampleProject(p));
  const target = real[0] ?? projects[0];
  const issues = useProjectIssues(real[0]?.id);
  const members = useWorkspaceMembers(workspaceId);

  // Opening the palette (via shortcut or header button) ticks the step.
  const palette = useCommandPalette();
  useEffect(() => {
    if (palette.isOpen && !stored.palette) update({ palette: true });
  }, [palette.isOpen, stored.palette, update]);

  const items: Item[] = [
    {
      id: 'project',
      label: 'Create a project',
      hint: 'Your own, beyond the sample.',
      done: real.length > 0,
      cta: 'New project',
    },
    {
      id: 'issue',
      label: 'Create an issue',
      hint: 'Press C on a board, or use the + in a column.',
      done: (issues.data?.length ?? 0) > 0,
      to: real[0] ? `/projects/${real[0].id}/board` : undefined,
      cta: 'Open board',
    },
    {
      id: 'invite',
      label: 'Invite a teammate',
      hint: 'Work is better shared.',
      done: (members.data?.length ?? 0) > 1,
      to: `/workspaces/${workspaceId}/members`,
      cta: 'Invite',
    },
    {
      id: 'agent',
      label: 'Connect an AI agent via MCP',
      hint: 'Let Claude read and write your work.',
      done: !!stored.agent,
      to: target ? `/projects/${target.id}/agents` : undefined,
      onActivate: () => update({ agent: true }),
      cta: 'Set up',
    },
    {
      id: 'palette',
      label: 'Try the command palette',
      hint: 'Press Ctrl/Cmd + K from anywhere.',
      done: !!stored.palette,
      onActivate: () => palette.open(),
      cta: 'Try it',
    },
  ];

  const doneCount = items.filter((i) => i.done).length;
  if (stored.dismissed || doneCount === items.length) return null;

  return (
    <section
      data-testid="getting-started"
      aria-labelledby="getting-started-heading"
      className="rounded-xl border border-ink-200 bg-surface shadow-card"
    >
      <div className="flex items-center justify-between gap-3 border-b border-ink-100 px-4 py-3">
        <div className="min-w-0">
          <h2 id="getting-started-heading" className="text-sm font-semibold text-ink-800">
            Getting started
          </h2>
          <p className="text-xs text-ink-500" data-testid="getting-started-progress">
            {doneCount} of {items.length} done
          </p>
        </div>
        <button
          type="button"
          data-testid="getting-started-dismiss"
          onClick={() => update({ dismissed: true })}
          className="shrink-0 rounded px-2 py-1 text-xs font-medium text-ink-500 hover:bg-ink-100 hover:text-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
        >
          Dismiss
          <span className="sr-only"> getting started checklist</span>
        </button>
      </div>
      <div
        role="progressbar"
        aria-label="Getting started progress"
        aria-valuemin={0}
        aria-valuemax={items.length}
        aria-valuenow={doneCount}
        className="h-0.5 bg-ink-100"
      >
        <div
          className="h-full bg-signal-600 transition-[width] motion-reduce:transition-none"
          style={{ width: `${(doneCount / items.length) * 100}%` }}
        />
      </div>
      <ul className="divide-y divide-ink-100">
        {items.map((i) => (
          <li
            key={i.id}
            data-testid={`getting-started-${i.id}`}
            data-done={i.done}
            className="flex items-center gap-3 px-4 py-2.5"
          >
            <span
              aria-hidden="true"
              className={cn(
                'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                i.done
                  ? 'border-signal-600 bg-signal-600 text-white'
                  : 'border-ink-300 text-transparent',
              )}
            >
              <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3.5 8.5l3 3 6-7" />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn('text-sm font-medium', i.done ? 'text-ink-400 line-through' : 'text-ink-800')}>
                {i.label}
                <span className="sr-only">{i.done ? ' (done)' : ' (to do)'}</span>
              </p>
              <p className="hidden truncate text-xs text-ink-500 sm:block">{i.hint}</p>
            </div>
            {!i.done && (i.to || i.onActivate) && (
              i.to ? (
                <Link
                  to={i.to}
                  onClick={i.onActivate}
                  className="shrink-0 rounded px-2 py-1 text-xs font-semibold text-signal-700 hover:bg-signal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
                >
                  {i.cta}
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={i.onActivate}
                  className="shrink-0 rounded px-2 py-1 text-xs font-semibold text-signal-700 hover:bg-signal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
                >
                  {i.cta}
                </button>
              )
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
