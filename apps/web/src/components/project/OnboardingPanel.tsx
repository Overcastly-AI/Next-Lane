import type React from 'react';
import { Button } from '@/components/ui/Button';

/**
 * Onboarding welcome panel shown on the Dashboard when the user has no projects.
 * Gives a brief description of Next Lane and a primary CTA to create their first
 * project. Keeps the same visual language as the rest of the app (brand colours,
 * shadcn-style rounded corners, dashed-border motif from EmptyState).
 */
export function OnboardingPanel({
  onCreate,
}: {
  onCreate: () => void;
}) {
  return (
    <div
      data-testid="onboarding-panel"
      className="mx-auto max-w-lg rounded-2xl border border-dashed border-brand-200 bg-surface px-8 py-10 text-center shadow-card"
    >
      {/* Brand mark */}
      <div className="mb-5 flex justify-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-sm">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M5 19V5m7 14V9m7 10V12"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
        </span>
      </div>

      <h1 className="text-2xl font-bold tracking-tight text-slate-900">
        Welcome to Next Lane
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-slate-500">
        Next Lane is a self-hosted issue and project tracker for agile teams.
        Plan sprints, track bugs and tasks on a Kanban board, measure velocity,
        and keep your whole team in sync — all running on your own
        infrastructure.
      </p>

      <div className="mt-8">
        <Button
          data-testid="onboarding-create-project"
          onClick={onCreate}
          className="w-full sm:w-auto"
        >
          Create your first project
        </Button>
      </div>

      {/* Feature highlights */}
      <ul
        aria-label="Key features"
        className="mt-8 grid grid-cols-1 gap-3 text-left sm:grid-cols-3"
      >
        {HIGHLIGHTS.map((h) => (
          <li
            key={h.label}
            className="flex flex-col gap-1 rounded-xl bg-slate-50 px-4 py-3"
          >
            <span className="h-5 w-5 text-slate-400" aria-hidden="true">
              {h.icon}
            </span>
            <span className="text-xs font-semibold text-slate-800">
              {h.label}
            </span>
            <span className="text-xs text-slate-500">{h.description}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Inline SVG for Kanban board: three vertical bars at different heights */
const KanbanIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
    <rect x="3" y="3" width="4" height="14" rx="1" />
    <rect x="10" y="3" width="4" height="10" rx="1" />
    <rect x="17" y="3" width="4" height="18" rx="1" />
  </svg>
);

/** Inline SVG for Sprints / calendar: a simple calendar outline */
const SprintsIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="17" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </svg>
);

/** Inline SVG for Reports: a simple bar/trend chart */
const ReportsIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 20h18M6 20V13m4 7V9m4 11V5m4 15v-7" />
  </svg>
);

const HIGHLIGHTS: { icon: React.ReactNode; label: string; description: string }[] = [
  {
    icon: KanbanIcon,
    label: 'Kanban board',
    description: 'Drag and drop issues across custom columns.',
  },
  {
    icon: SprintsIcon,
    label: 'Sprints & backlog',
    description: 'Plan work in time-boxed sprints with a prioritised backlog.',
  },
  {
    icon: ReportsIcon,
    label: 'Reports',
    description: 'Track velocity and burndown to understand team pace.',
  },
];
