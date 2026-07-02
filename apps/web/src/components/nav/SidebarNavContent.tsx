/**
 * Shared list content for the persistent left sidebar — rendered by both the
 * desktop rail (`AppSidebar`) and the mobile overlay (`MobileSidebarDrawer`)
 * so the two surfaces can never drift apart.
 *
 * Sections, top to bottom:
 *  1. Workspace — active workspace + a switcher trigger that reuses
 *     `WorkspaceSwitcherMenuContent` (the exact same search/recent/list the
 *     header chip uses — same underlying `WorkspaceContext` state, no copy).
 *  2. Projects — every project in the active workspace, linking to its
 *     board. The project whose route is currently open gets the signature
 *     rail tick + `aria-current="page"`.
 *  3. Personal — My Work / My Board / Insights / Notifications.
 *  4. Utility — workspace settings (bottom-pinned).
 *
 * DISPATCH signature: a 3px cobalt "rail tick" flush to the sidebar's own
 * left edge marks the active row — an extension of the product's existing
 * lane/dispatch vocabulary (the logo's three lane bars, the board's
 * `nl-lane-divider` motif) rather than a generic filled-pill active state.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, matchPath } from 'react-router-dom';
import type { ProjectDto } from '@next-lane/shared';
import { cn } from '@/lib/cn';
import { useProjects } from '@/api/projects';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { useSwitchWorkspace } from '@/lib/useSwitchWorkspace';
import { WorkspaceSwitcherMenuContent } from './WorkspaceSwitcherMenuContent';
import {
  ChevronDownSmallIcon,
  InsightsIcon,
  MyBoardIcon,
  MyWorkIcon,
  NotificationsIcon,
  SettingsIcon,
} from './sidebarIcons';

// ---------------------------------------------------------------------------
// Active-row rail tick — the one signature accent element
// ---------------------------------------------------------------------------

function RailTick({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-sm bg-signal-600 transition-opacity duration-[120ms]',
        active ? 'opacity-100' : 'opacity-0',
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Row primitive
// ---------------------------------------------------------------------------

interface SidebarRowProps {
  to: string;
  active: boolean;
  icon: React.ReactNode;
  label: string;
  collapsed: boolean;
  onNavigate?: () => void;
  testId?: string;
  trailing?: React.ReactNode;
}

function SidebarRow({ to, active, icon, label, collapsed, onNavigate, testId, trailing }: SidebarRowProps) {
  return (
    <Link
      to={to}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      data-testid={testId}
      title={collapsed ? label : undefined}
      className={cn(
        'relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors duration-[120ms]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1',
        collapsed && 'justify-center px-0',
        active ? 'text-signal-700 font-semibold' : 'text-ink-600 hover:bg-ink-50 hover:text-ink-900',
      )}
    >
      <RailTick active={active} />
      <span className={cn('shrink-0', active ? 'text-signal-600' : 'text-ink-400')}>{icon}</span>
      <span className={collapsed ? 'sr-only' : 'min-w-0 flex-1 truncate'}>{label}</span>
      {!collapsed && trailing}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Project row (mono key chip — reuses the .nl-issue-key signature class)
// ---------------------------------------------------------------------------

function ProjectRow({
  project,
  active,
  collapsed,
  onNavigate,
}: {
  project: ProjectDto;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      to={`/projects/${project.id}/board`}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      data-testid="nav-sidebar-project"
      title={collapsed ? project.name : undefined}
      className={cn(
        'relative flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors duration-[120ms]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1',
        collapsed && 'justify-center px-0',
        active
          ? 'bg-signal-50 font-semibold text-signal-700'
          : 'text-ink-600 hover:bg-ink-50 hover:text-ink-900',
      )}
    >
      <RailTick active={active} />
      {/* Collapsed rail: truncate to 2 chars (matches the existing
          ProjectCard key-badge convention) so long keys never overflow the
          56px rail. Expanded: full key, as everywhere else in the product. */}
      <span className="nl-issue-key shrink-0">
        {collapsed ? project.key.slice(0, 2) : project.key}
      </span>
      {!collapsed && <span className="min-w-0 flex-1 truncate">{project.name}</span>}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Workspace section
// ---------------------------------------------------------------------------

function WorkspaceSection({ collapsed }: { collapsed: boolean }) {
  const { activeWorkspace, workspaces } = useWorkspaceContext();
  const switchWorkspace = useSwitchWorkspace();
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  if (!activeWorkspace) return null;

  const hasMultiple = workspaces.length > 1;
  const initial = activeWorkspace.name.charAt(0).toUpperCase() || '·';

  return (
    <div className="relative px-2 pb-2 pt-2.5" ref={ref}>
      <button
        type="button"
        onClick={() => hasMultiple && setMenuOpen((v) => !v)}
        aria-haspopup={hasMultiple ? 'menu' : undefined}
        aria-expanded={hasMultiple ? menuOpen : undefined}
        aria-label={
          hasMultiple
            ? `Current workspace: ${activeWorkspace.name}. Switch workspace.`
            : `Workspace: ${activeWorkspace.name}`
        }
        data-testid="nav-sidebar-workspace-trigger"
        title={collapsed ? activeWorkspace.name : undefined}
        className={cn(
          'flex w-full items-center gap-2 rounded-md py-1.5 text-left transition-colors duration-[120ms]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1',
          collapsed ? 'justify-center px-0' : 'px-2 hover:bg-ink-50',
        )}
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-signal-50 font-display text-xs font-bold text-signal-700 ring-1 ring-inset ring-signal-100">
          {initial}
        </span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-900">
              {activeWorkspace.name}
            </span>
            {hasMultiple && (
              <ChevronDownSmallIcon
                className={cn(
                  'h-3.5 w-3.5 shrink-0 text-ink-400 transition-transform duration-[120ms]',
                  menuOpen && 'rotate-180',
                )}
              />
            )}
          </>
        )}
      </button>

      {menuOpen && hasMultiple && (
        <div
          role="menu"
          aria-label="Switch workspace"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setMenuOpen(false);
          }}
          className={cn(
            'absolute z-30 mt-1 w-64 overflow-hidden rounded-xl border border-ink-100 bg-white py-1 shadow-dropdown animate-nl-fade-in',
            collapsed ? 'left-full top-0 ml-2' : 'left-2 top-full',
          )}
        >
          <WorkspaceSwitcherMenuContent
            onSelect={(ws) => {
              switchWorkspace(ws);
              setMenuOpen(false);
            }}
            onNavigate={() => setMenuOpen(false)}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Personal section data
// ---------------------------------------------------------------------------

const PERSONAL_ITEMS = [
  { to: '/my-work', label: 'My Work', Icon: MyWorkIcon },
  { to: '/my-board', label: 'My Board', Icon: MyBoardIcon },
  { to: '/me/analytics', label: 'Insights', Icon: InsightsIcon },
  { to: '/notifications', label: 'Notifications', Icon: NotificationsIcon },
] as const;

// ---------------------------------------------------------------------------
// SidebarNavContent
// ---------------------------------------------------------------------------

export interface SidebarNavContentProps {
  collapsed: boolean;
  /** Called after any nav item is clicked — the mobile drawer uses this to close itself. */
  onNavigate?: () => void;
}

export function SidebarNavContent({ collapsed, onNavigate }: SidebarNavContentProps) {
  const { activeWorkspace } = useWorkspaceContext();
  const projectsQuery = useProjects(activeWorkspace?.id);
  const location = useLocation();

  const projectMatch = matchPath('/projects/:projectId/*', location.pathname);
  const activeProjectId = projectMatch?.params.projectId;

  return (
    <>
      <WorkspaceSection collapsed={collapsed} />

      <nav aria-label="Projects" className="nl-scroll flex-1 overflow-y-auto overflow-x-hidden px-2 py-1">
        {!collapsed && (
          <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
            Projects
          </p>
        )}
        {projectsQuery.isLoading && (
          <div className="space-y-1 px-2.5 py-1" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-6 animate-pulse rounded bg-ink-100" />
            ))}
          </div>
        )}
        {projectsQuery.isError && (
          <p className="px-2.5 py-2 text-xs text-ink-400">Couldn’t load projects.</p>
        )}
        {projectsQuery.data?.length === 0 && (
          <p className="px-2.5 py-2 text-xs text-ink-400">No projects yet.</p>
        )}
        <div className="space-y-0.5">
          {projectsQuery.data?.map((project) => (
            <ProjectRow
              key={project.id}
              project={project}
              active={project.id === activeProjectId}
              collapsed={collapsed}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      </nav>

      <div className="space-y-0.5 border-t border-ink-100 px-2 py-2">
        {!collapsed && (
          <p className="px-2.5 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
            Personal
          </p>
        )}
        {PERSONAL_ITEMS.map((item) => (
          <SidebarRow
            key={item.to}
            to={item.to}
            active={location.pathname === item.to}
            icon={<item.Icon className="h-4 w-4" />}
            label={item.label}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        ))}
      </div>

      {activeWorkspace && (
        <div className="border-t border-ink-100 px-2 py-2">
          <SidebarRow
            to={`/workspaces/${activeWorkspace.id}/settings`}
            active={location.pathname === `/workspaces/${activeWorkspace.id}/settings`}
            icon={<SettingsIcon className="h-4 w-4" />}
            label="Workspace settings"
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        </div>
      )}
    </>
  );
}
