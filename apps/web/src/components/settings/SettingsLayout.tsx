import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { Select } from '@/components/ui/Select';
import type { SettingsGroup } from './settingsGroups';

export interface SettingsLayoutProps {
  /** Rail entries, in order. */
  groups: readonly SettingsGroup[];
  /** Prefix each group's `to` is appended to, no trailing slash. */
  basePath: string;
  /** The `h1`. The project scope passes `"Settings"` — see below. */
  title: string;
  description?: string;
  children: React.ReactNode;
}

/**
 * The shared shell for every settings surface (project today; workspace,
 * personal and instance in Phases 2–3 — see
 * `docs/superpowers/specs/2026-09-23-settings-ia-redesign-design.md`).
 *
 * It generalises the pattern `WorkspaceSettingsNav` already proved: a
 * grouped rail of real routes, one section frame, one responsive collapse.
 * `groups` and `basePath` are props rather than baked in specifically so the
 * later phases can point the same shell at `/workspaces/:id`, `/me` and
 * `/admin`.
 *
 * DESIGN — derived from two conventions this codebase already established,
 * not a new visual language:
 *  - `ProjectNav`'s active-tab marker is a `border-signal-600` accent on the
 *    edge the tab sits against (bottom, for its horizontal strip). This rail
 *    is vertical, so the same marker rotates to a left-edge `border-l-2` —
 *    one "how do you show the active nav item" language across the whole
 *    app instead of a second one invented for this surface.
 *  - `WorkspaceSettingsNav`'s active wash (`bg-signal-50 text-signal-700`)
 *    is kept verbatim, layered under the accent bar.
 *
 * A11Y — the rail is a `<nav>` of real `NavLink`s (not a listbox widget), so
 * `aria-current="page"` comes for free from react-router and every entry is
 * a normal Tab stop with the app's standard cobalt focus-visible ring.
 *
 * MOBILE — below `md` the rail (label + description per entry, six entries)
 * would eat the entire 393px viewport before any settings content appeared,
 * so it collapses to the shared `Select` primitive with a visible label.
 * `Select` already carries the app's focus/hover treatment and reduced-motion
 * handling; the label keeps the control from being the exact "unlabelled
 * select" bug this redesign exists to remove.
 */
export function SettingsLayout({
  groups,
  basePath,
  title,
  description,
  children,
}: SettingsLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const activeGroup =
    groups.find((group) => {
      const to = `${basePath}/${group.to}`;
      return location.pathname === to || location.pathname.startsWith(`${to}/`);
    }) ?? groups[0];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6 md:flex-row md:items-start md:gap-10">
      {/* Rail column */}
      <div className="flex shrink-0 flex-col gap-4 md:w-60">
        <div>
          <h1 className="text-lg font-semibold text-ink-900">{title}</h1>
          {description && (
            <p className="mt-1 text-sm text-ink-500">{description}</p>
          )}
        </div>

        {/* Below `md`: a labelled select stands in for the rail. */}
        <div className="md:hidden">
          <label
            htmlFor="settings-rail-select"
            className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500"
          >
            Settings section
          </label>
          <Select
            id="settings-rail-select"
            data-testid="settings-rail-select"
            aria-label="Settings section"
            value={activeGroup?.to ?? ''}
            onChange={(e) => navigate(`${basePath}/${e.target.value}`)}
          >
            {groups.map((group) => (
              <option key={group.to} value={group.to}>
                {group.label}
              </option>
            ))}
          </Select>
        </div>

        {/* `md` and up: the full rail, hidden on small screens so it never
            competes with the select for space or focus order. */}
        <nav
          aria-label="Settings navigation"
          data-testid="settings-rail"
          className="hidden md:block"
        >
          <ul className="flex flex-col gap-0.5 border-l border-ink-100">
            {groups.map((group) => {
              const to = `${basePath}/${group.to}`;
              return (
                <li key={group.to}>
                  <NavLink
                    to={to}
                    data-testid={`settings-rail-${group.to}`}
                    className={({ isActive }) =>
                      cn(
                        '-ml-px block rounded-r-md border-l-2 py-2 pl-3.5 pr-2',
                        'transition-colors duration-150 motion-reduce:transition-none',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-300 focus-visible:ring-offset-1',
                        isActive
                          ? 'border-signal-600 bg-signal-50'
                          : 'border-transparent hover:border-ink-300 hover:bg-ink-50',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <span
                          className={cn(
                            'block text-sm font-medium',
                            isActive ? 'text-signal-700' : 'text-ink-800',
                          )}
                        >
                          {group.label}
                        </span>
                        <span
                          className={cn(
                            'mt-0.5 block text-xs leading-snug',
                            isActive ? 'text-signal-700/70' : 'text-ink-500',
                          )}
                        >
                          {group.description}
                        </span>
                      </>
                    )}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>

      {/* Content column */}
      <div className="flex min-w-0 max-w-3xl flex-1 flex-col gap-6">
        {children}
      </div>
    </div>
  );
}
