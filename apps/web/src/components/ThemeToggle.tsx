/**
 * ThemeToggle — Light / Dark / System 3-way control.
 *
 * Shared between two placements per the light/dark-mode acceptance criteria:
 *  - The sidebar's utility area (`AppSidebar.tsx`, next to the Collapse
 *    button) — `collapsed` follows the sidebar's own rail state (icon-only).
 *  - The header user menu (`AppHeader.tsx`) — always full-label.
 *
 * A plain `role="group"` of toggle buttons (not `radiogroup`/roving-tabindex)
 * — each is independently reachable by Tab and activated by Enter/Space,
 * which is simpler and just as accessible for a 3-item control this size.
 */
import { useTheme } from '@/contexts/ThemeContext';
import { cn } from '@/lib/cn';
import type { ThemePreference } from '@/lib/theme';
import { MoonIcon, SunIcon, SystemThemeIcon } from './nav/sidebarIcons';

const OPTIONS: Array<{
  value: ThemePreference;
  label: string;
  Icon: (props: { className?: string }) => React.ReactElement;
}> = [
  { value: 'light', label: 'Light', Icon: SunIcon },
  { value: 'dark', label: 'Dark', Icon: MoonIcon },
  { value: 'system', label: 'System', Icon: SystemThemeIcon },
];

export interface ThemeToggleProps {
  /** Icon-only, no text labels (matches the sidebar's collapsed rail). */
  collapsed?: boolean;
  className?: string;
}

export function ThemeToggle({ collapsed = false, className }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="group"
      aria-label="Theme"
      data-testid="theme-toggle"
      className={cn(
        'flex items-center gap-0.5 rounded-md border border-ink-200 bg-ink-50 p-0.5',
        collapsed ? 'flex-col' : 'flex-row',
        className,
      )}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => setTheme(value)}
            aria-pressed={active}
            aria-label={`${label} theme`}
            title={label}
            data-testid={`theme-toggle-${value}`}
            className={cn(
              'flex h-7 items-center justify-center gap-1.5 rounded px-2 text-xs font-medium transition-colors duration-[120ms]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1',
              active
                ? 'bg-surface text-signal-700 shadow-xs'
                : 'text-ink-500 hover:text-ink-800',
              collapsed ? 'w-7 px-0' : 'flex-1',
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            {!collapsed && <span>{label}</span>}
          </button>
        );
      })}
    </div>
  );
}
