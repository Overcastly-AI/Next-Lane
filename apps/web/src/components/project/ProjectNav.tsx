import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/cn';

/**
 * Per-project sub-navigation shown under the app header. Switches between the
 * kanban Board (active-sprint + backlog) and the Backlog/sprint-planning view.
 */
export function ProjectNav({ projectId }: { projectId: string }) {
  const tabs = [
    { to: `/projects/${projectId}/board`, label: 'Board' },
    { to: `/projects/${projectId}/backlog`, label: 'Backlog' },
    { to: `/projects/${projectId}/reports`, label: 'Reports' },
  ];
  return (
    <nav className="flex items-center gap-1 border-b border-gray-200 bg-white px-4">
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          className={({ isActive }) =>
            cn(
              'relative -mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-gray-500 hover:text-gray-800',
            )
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
