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
      className="mx-auto max-w-lg rounded-2xl border border-dashed border-brand-200 bg-white px-8 py-10 text-center shadow-card"
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

      <h1 className="text-2xl font-bold tracking-tight text-gray-900">
        Welcome to Next Lane
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-gray-500">
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
            className="flex flex-col gap-1 rounded-xl bg-gray-50 px-4 py-3"
          >
            <span className="text-base" aria-hidden="true">
              {h.icon}
            </span>
            <span className="text-xs font-semibold text-gray-800">
              {h.label}
            </span>
            <span className="text-xs text-gray-500">{h.description}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const HIGHLIGHTS: { icon: string; label: string; description: string }[] = [
  {
    icon: '⬛',
    label: 'Kanban board',
    description: 'Drag and drop issues across custom columns.',
  },
  {
    icon: '🗓',
    label: 'Sprints & backlog',
    description: 'Plan work in time-boxed sprints with a prioritised backlog.',
  },
  {
    icon: '📊',
    label: 'Reports',
    description: 'Track velocity and burndown to understand team pace.',
  },
];
