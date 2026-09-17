import type React from 'react';
import { Button } from '@/components/ui/Button';

/**
 * Onboarding welcome panel shown on the Dashboard when the user has no projects.
 * Gives a brief description of Next Lane and a primary CTA to create their first
 * project. Keeps the same visual language as the rest of the app (brand colours,
 * shadcn-style rounded corners, dashed-border motif from EmptyState).
 *
 * Product-audit finding (docs/AUDIT-PRODUCT.md, Pass 14): this panel is the
 * very first thing a new user reads, and it used to sell "Kanban board /
 * Sprints & backlog / Reports" — three things every tracker already has,
 * with zero signal that this one is agent-native. The Reports tile is
 * replaced with the agent story: it's the one highlight here a first-time
 * user's *current* tracker genuinely cannot do, so it gets its own visual
 * weight (the signal-cobalt tile) rather than reading as a fourth generic
 * feature bullet.
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
        Next Lane is a self-hosted issue and project tracker for agile teams —
        sprints, a Kanban board, and a knowledge base your whole team can
        edit. It's also built for AI agents to work in alongside your team,
        not just report on it: a first-party MCP server reads and writes
        directly, something no other tracker offers today.
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
            data-testid={h.testId}
            className={
              'flex flex-col gap-1 rounded-xl px-4 py-3 ' +
              (h.signature
                ? 'bg-signal-50 ring-1 ring-inset ring-signal-100'
                : 'bg-slate-50')
            }
          >
            <span
              className={'h-5 w-5 ' + (h.signature ? 'text-signal-600' : 'text-slate-400')}
              aria-hidden="true"
            >
              {h.icon}
            </span>
            <span
              className={
                'text-xs font-semibold ' +
                (h.signature ? 'text-signal-800' : 'text-slate-800')
              }
            >
              {h.label}
            </span>
            <span className={h.signature ? 'text-xs text-signal-700' : 'text-xs text-slate-500'}>
              {h.description}
            </span>
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

/**
 * Inline SVG for AI agents: a chip, matching `ViewAgentsIcon`'s vocabulary
 * (nav/sidebarIcons.tsx) so the same shape means "agent" everywhere in the
 * app, from this very first screen through to the project's Agents tab.
 */
const AgentIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="7" y="7" width="10" height="10" rx="1.5" />
    <circle cx="12" cy="12" r="2" />
    <path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" />
  </svg>
);

const HIGHLIGHTS: {
  icon: React.ReactNode;
  label: string;
  description: string;
  testId: string;
  /** The one tile that gets the bold cobalt treatment — see file header. */
  signature?: boolean;
}[] = [
  {
    icon: KanbanIcon,
    label: 'Kanban board',
    description: 'Drag and drop issues across custom columns.',
    testId: 'onboarding-highlight-board',
  },
  {
    icon: SprintsIcon,
    label: 'Sprints & backlog',
    description: 'Plan work in time-boxed sprints with a prioritised backlog.',
    testId: 'onboarding-highlight-sprints',
  },
  {
    icon: AgentIcon,
    label: 'AI agents, built in',
    description: 'A first-party MCP server lets Claude read and write your work directly.',
    testId: 'onboarding-highlight-agents',
    signature: true,
  },
];
