/**
 * Persistent left sidebar — desktop (≥lg) primary navigation frame.
 *
 * Always mounted (App.tsx-level, a sibling of the routed page content, see
 * `AppShellFrame` in `App.tsx`) so it never remounts on navigation — its
 * width and section contents just re-render. Hidden via CSS below `lg`
 * (the mobile drawer, `MobileSidebarDrawer`, takes over there) rather than
 * conditionally mounted, so there is no viewport-detection flicker.
 *
 * Collapse state is persisted (`SidebarContext` / localStorage) and restored
 * synchronously — the very first paint already has the right width.
 */
import { cn } from '@/lib/cn';
import { useSidebarContext } from '@/contexts/SidebarContext';
import { SidebarNavContent } from './SidebarNavContent';
import { ThemeToggle } from '@/components/ThemeToggle';
import { RailChevronIcon } from './sidebarIcons';

export function AppSidebar() {
  const { collapsed, toggleCollapsed } = useSidebarContext();

  // Unlike the header chip, the sidebar frame itself does NOT wait on
  // `activeWorkspace` to resolve (e.g. the brief window right after a brand
  // new user registers, before their default workspace finishes being
  // created) — the personal-section links (My Work / My Board / Insights /
  // Notifications) don't depend on a workspace at all, and hiding the whole
  // sidebar during that window would leave `AppHeader`'s equivalent links
  // hidden (they're `lg:hidden` at this breakpoint) with NO reachable path
  // to those pages until the workspace finishes loading. Only the
  // workspace/projects sections inside `SidebarNavContent` gate on it.
  return (
    <aside
      data-testid="nav-sidebar"
      aria-label="Primary"
      className={cn(
        'sticky top-0 hidden h-screen shrink-0 flex-col border-r border-ink-200 bg-surface lg:flex',
        'transition-[width] duration-[180ms] motion-reduce:transition-none',
        collapsed ? 'w-14' : 'w-60',
      )}
    >
      <SidebarNavContent collapsed={collapsed} />

      {/* Utility area — theme toggle sits above the collapse control, mirrors
          the "Personal"/"Workspace settings" section pattern above it. */}
      <div className={cn('border-t border-ink-100 p-2', collapsed && 'flex justify-center')}>
        <ThemeToggle collapsed={collapsed} />
      </div>

      <div className="border-t border-ink-100 p-2">
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-pressed={collapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          data-testid="nav-sidebar-toggle"
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium text-ink-500 transition-colors duration-[120ms]',
            'hover:bg-ink-50 hover:text-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1',
            collapsed && 'justify-center px-0',
          )}
        >
          <RailChevronIcon
            className={cn('h-4 w-4 shrink-0 transition-transform duration-[180ms]', collapsed && 'rotate-180')}
          />
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
