import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/cn';

/**
 * Per-project sub-navigation shown under the app header. Switches between the
 * kanban Board (active-sprint + backlog) and the Backlog/sprint-planning view.
 *
 * DISPATCH nav — IBM Plex Sans at medium weight; cobalt signal underline on
 * active tab; ink surface, no background fill on the nav bar.
 */
export function ProjectNav({ projectId }: { projectId: string }) {
  const tabs: Array<{ to: string; label: string; testId?: string }> = [
    { to: `/projects/${projectId}/board`, label: 'Board' },
    { to: `/projects/${projectId}/backlog`, label: 'Backlog' },
    { to: `/projects/${projectId}/triage`, label: 'Triage' },
    { to: `/projects/${projectId}/reports`, label: 'Reports' },
    { to: `/projects/${projectId}/analytics`, label: 'Analytics' },
    { to: `/projects/${projectId}/roadmap`, label: 'Roadmap' },
    { to: `/projects/${projectId}/poker`, label: 'Poker' },
    { to: `/projects/${projectId}/standups`, label: 'Standup' },
    { to: `/projects/${projectId}/automations`, label: 'Automation', testId: 'nav-automation' },
    { to: `/projects/${projectId}/settings`, label: 'Settings' },
  ];
  return (
    <nav className="flex items-center gap-1 overflow-x-auto border-b border-ink-200 bg-white px-4">
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          data-testid={tab.testId}
          className={({ isActive }) =>
            cn(
              'relative -mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors duration-[120ms]',
              isActive
                ? 'border-signal-600 text-signal-700 font-semibold'
                : 'border-transparent text-ink-500 hover:text-ink-800',
            )
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
